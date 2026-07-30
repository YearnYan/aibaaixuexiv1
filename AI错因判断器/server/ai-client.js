const { reportSchema } = require('./schemas');
const { normalizeReportMath, validateReportMath } = require('./math-content');

class AiServiceError extends Error {
  constructor(message, status = 502, code = 'AI_SERVICE_ERROR', details = '') {
    super(message);
    this.name = 'AiServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getChatUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

function isLocalEndpoint(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

function ensureConfigured(config) {
  if (!config.apiKey && config.provider !== 'ollama' && !isLocalEndpoint(config.baseUrl)) {
    throw new AiServiceError('AI 尚未配置，请先前往 AI 配置页面填写密钥', 503, 'AI_NOT_CONFIGURED');
  }
}

function extractMessageContent(message) {
  if (typeof message?.content === 'string') return message.content;
  if (message?.content && typeof message.content === 'object' && !Array.isArray(message.content)) {
    return JSON.stringify(message.content);
  }
  if (Array.isArray(message?.content)) {
    return message.content.map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item?.text === 'string') return item.text;
      if (typeof item?.text?.value === 'string') return item.text.value;
      if (item?.json && typeof item.json === 'object') return JSON.stringify(item.json);
      return '';
    }).join('');
  }
  return '';
}

function repairJsonStringSyntax(source) {
  const latexCommands = new Set([
    'begin', 'beta', 'ce', 'circ', 'dfrac', 'frac', 'mathrm', 'mathit', 'mathbf',
    'nabla', 'neq', 'operatorname', 'overline', 'parallel', 'perp', 'pu', 'right',
    'sqrt', 'text', 'tfrac', 'theta', 'times', 'triangle', 'underline', 'vec',
  ]);
  let repaired = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (!inString) {
      repaired += character;
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      const validUnicode = character === 'u' && /^[0-9a-fA-F]{4}$/.test(source.slice(index + 1, index + 5));
      if ('"\\/bfnrt'.includes(character) || validUnicode) repaired += character;
      else repaired += `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      const command = source.slice(index + 1).match(/^([A-Za-z]+)/)?.[1];
      if (command && latexCommands.has(command)) {
        repaired += '\\\\';
        continue;
      }
      repaired += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      repaired += character;
      inString = false;
      continue;
    }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      repaired += '\\n';
      continue;
    }
    repaired += character;
  }
  return repaired.replace(/,\s*([}\]])/g, '$1');
}

function parseJsonCandidate(source) {
  try {
    return JSON.parse(repairJsonStringSyntax(source));
  } catch {
    return JSON.parse(source);
  }
}

function parseJsonContent(content) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return parseJsonCandidate(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return parseJsonCandidate(trimmed.slice(start, end + 1));
    throw new AiServiceError('模型没有返回可解析的 JSON 报告', 502, 'INVALID_AI_RESPONSE');
  }
}

async function requestChat(config, messages, { jsonMode = false, maxTokens = 6000 } = {}) {
  ensureConfigured(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const body = {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: maxTokens,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  let response;
  try {
    response = await fetch(getChatUrl(config.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AiServiceError('AI 分析超时，请检查模型服务或稍后重试', 504, 'AI_TIMEOUT');
    }
    throw new AiServiceError('无法连接 AI 服务，请检查接口地址和网络', 502, 'AI_CONNECTION_ERROR');
  } finally {
    clearTimeout(timer);
  }

  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const upstreamMessage = payload?.error?.message || responseText.slice(0, 500);
    const status = response.status === 401 || response.status === 403 ? 502 : response.status;
    throw new AiServiceError(
      `AI 服务返回错误（${response.status}）`,
      status >= 400 && status < 600 ? status : 502,
      'AI_UPSTREAM_ERROR',
      upstreamMessage,
    );
  }

  const content = extractMessageContent(payload?.choices?.[0]?.message);
  if (!content) throw new AiServiceError('AI 服务返回了空结果', 502, 'EMPTY_AI_RESPONSE');
  return content;
}

function buildSystemPrompt() {
  return `你是一名严谨的学科错因诊断专家。你的任务不是重新讲题，而是根据原题、学生原始答案与过程，找到第一个真正导致后续错误的位置。

必须遵守：
1. 不得把“粗心”“没认真”“基础差”“不会做”当作最终错因。
2. 证据只能来自用户提供的原题、学生答案、正确答案、标准过程和评分标准；不得编造学生没有写过的步骤。
3. 一道题即使有多个问题，也要优先定位第一个关键错误，并说明它如何影响后续。
4. 信息不足、图片不清、学生过程缺失或存在多种同等可能时，errorType 必须为“信息不足，无法确定”，needsTeacherReview 必须为 true。
5. timeline 固定为 4 步：1题意读取、2方法选择、3列式计算、4最终答案。每步状态只能是“正确”“首次出错”“受影响”“未判断”。能够确定时必须且只能有一个“首次出错”；信息不足时四步使用“未判断”，不得猜测首次出错。
6. errorType 只能取：知识理解或记忆错误、题意读取错误、方法选择错误、解题步骤错误、运算判断或执行错误、答案表达错误、检查动作缺失、信息不足，无法确定。
7. 纠正动作必须具体、可执行、能在下一道同类题中观察到，checklist 提供 2 至 5 个短步骤。
8. 只输出合法 JSON，不要 Markdown，不要解释性前后缀。
9. 所有学科的公式、变量关系、角标、上下标、向量、单位、化学式和反应方程式都必须使用规范 LaTeX，行内公式用 \\(...\\)，独立公式用 \\[...\\]。JSON 中的反斜杠必须按 JSON 规则正确转义。
10. 数学使用 \\frac、\\sqrt、\\triangle、\\angle、\\cong、\\parallel、\\perp、\\vec 等规范命令；物理量和矢量使用规范变量，单位放在 \\mathrm{} 中，例如 \\(v=20\\,\\mathrm{m\\,s^{-1}}\\)。
11. 化学式、离子式和反应方程式统一使用 mhchem 的 \\ce{}，例如 \\(\\ce{2H2 + O2 -> 2H2O}\\)；不得用难以辨认的字符拼接化学式。
12. 生物遗传符号、概率、浓度和生化反应使用规范上下标、分式和 \\ce{}；地理经纬度、比例尺、坡度、温度和时区计算使用规范角度、单位和公式。
13. 上述规则适用于任何学科和任何公式，不得输出裸露的 LaTeX 命令、代码围栏、HTML、错误转义或仅凭相似外形替代的乱码符号。普通中文说明保持教学场景中的标准术语。

JSON 结构：
{
  "firstError":{"stepNumber":0-4,"stepName":"步骤名；无法确定时为无法确定","description":"首错描述或信息缺口","impact":"对后续的影响；无法确定时说明不能继续推断"},
  "evidence":"直接引用或准确转述学生答案中的错误证据",
  "errorType":"限定枚举值",
  "errorTypeReason":"为什么属于该类型",
  "timeline":[
    {"stepNumber":1,"stepName":"题意读取","status":"正确/首次出错/受影响/未判断","detail":"判断依据"},
    {"stepNumber":2,"stepName":"方法选择","status":"正确/首次出错/受影响/未判断","detail":"判断依据"},
    {"stepNumber":3,"stepName":"列式计算","status":"正确/首次出错/受影响/未判断","detail":"判断依据"},
    {"stepNumber":4,"stepName":"最终答案","status":"正确/首次出错/受影响/未判断","detail":"判断依据"}
  ],
  "comparison":{"studentJudgment":"学生自判或未提供","aiJudgment":"AI错因类型","conclusion":"是否一致及原因"},
  "correction":{"action":"首要纠正动作","rationale":"为什么先做它","checklist":["动作1","动作2"]},
  "needsTeacherReview":true或false,
  "reviewReason":"复核原因；无需复核时为空字符串",
  "confidence":0到1之间的小数
}`;
}

function buildUserContent(fields, parsedFile) {
  const text = [
    `学科：${fields.subject}`,
    `学生原始答案与作答过程：\n${fields.studentAnswer || '[未提供]'}`,
    `正确答案：\n${fields.correctAnswer || '[未提供，请根据原题谨慎核对]'}`,
    `标准过程：\n${fields.standardProcess || '[未提供]'}`,
    `评分标准：\n${fields.scoringCriteria || '[未提供]'}`,
    `学生自判：${fields.selfAssessment || '未提供'}`,
    `题目文件提取文字：\n${parsedFile.text || '[题目以图片形式提供]'}`,
  ].join('\n\n');

  if (!parsedFile.images.length) return text;
  return [
    { type: 'text', text },
    ...parsedFile.images.flatMap((image) => [
      { type: 'text', text: image.label },
      { type: 'image_url', image_url: { url: image.dataUrl, detail: 'high' } },
    ]),
  ];
}

function validateReportCandidate(value) {
  const structure = reportSchema.safeParse(value);
  if (!structure.success) {
    return {
      success: false,
      issues: structure.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      kind: 'schema',
    };
  }

  const normalized = normalizeReportMath(structure.data);
  const mathErrors = validateReportMath(normalized);
  if (mathErrors.length) {
    return {
      success: false,
      issues: mathErrors.map((issue) => `${issue.path}: 公式 ${issue.formula} 无法渲染（${issue.message}）`),
      kind: 'math',
    };
  }
  return { success: true, data: normalized };
}

async function analyzeWithAi(config, fields, parsedFile) {
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserContent(fields, parsedFile) },
  ];
  const firstContent = await requestChat(config, messages, { jsonMode: true });

  let parsed;
  try {
    parsed = parseJsonContent(firstContent);
  } catch (error) {
    if (!(error instanceof AiServiceError)) throw error;
    parsed = null;
  }

  let validation = parsed
    ? validateReportCandidate(parsed)
    : { success: false, issues: ['不是合法 JSON'], kind: 'schema' };
  if (!validation.success) {
    const issues = validation.issues.join('; ');
    const repairedContent = await requestChat(config, [
      ...messages,
      { role: 'assistant', content: firstContent },
      {
        role: 'user',
        content: `上面的输出未通过报告与公式校验：${issues}。请保持诊断结论基于同一份材料，修正 JSON 结构和所有 LaTeX 公式。所有公式必须能被 KaTeX/mhchem 正确渲染，只输出 JSON。`,
      },
    ], { jsonMode: true });
    validation = validateReportCandidate(parseJsonContent(repairedContent));
  }

  if (!validation.success) {
    const code = validation.kind === 'math' ? 'INVALID_REPORT_MATH' : 'INVALID_REPORT_SCHEMA';
    const message = validation.kind === 'math'
      ? '模型返回的学科公式无法正确渲染，请重试'
      : '模型返回的诊断报告格式不完整，请重试';
    throw new AiServiceError(message, 502, code, validation.issues.join('; '));
  }

  return {
    ...validation.data,
    generatedAt: new Date().toISOString(),
  };
}

async function testConnection(config) {
  const startedAt = Date.now();
  await requestChat(config, [
    { role: 'system', content: '你是连接测试助手。' },
    { role: 'user', content: '只回复：连接成功' },
  ], { maxTokens: 20 });
  return { latencyMs: Date.now() - startedAt };
}

module.exports = {
  AiServiceError,
  analyzeWithAi,
  getChatUrl,
  testConnection,
};

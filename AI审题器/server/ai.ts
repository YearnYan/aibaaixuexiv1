import { analysisSchema, type AiConfig, type Analysis } from "./schemas.js";
import type { ParsedFiles } from "./file-parser.js";
import { validateAnalysisLatex } from "./latex-renderer.js";

const SYSTEM_PROMPT = `你是一名严谨的中小学审题训练专家。你的任务只有“审题”，不能解题，不能给出完整解题步骤或最终答案。

请读取用户上传的题目资料，结合学科、年级和补充说明，输出一个 JSON 对象，字段必须严格符合：
{
  "questionText": "完整、去除无关页眉页脚后的题目文字",
  "problemType": "简短题型",
  "confidence": 0到1的小数,
  "potentialOmissions": ["最容易被漏看、误解或混淆的原题信息"],
  "taskWords": [{"label":"问/求/说明/选择等动作标签","text":"需要完成的目标"}],
  "restrictions": ["显性的范围、数量、对象、单位、否定、至少/至多等限制"],
  "keyData": [{"label":"数据含义","value":"原题中的数值、单位或关键信息"}],
  "hiddenConditions": ["原题未直接说出、但由概念或关系必然得到的条件"],
  "distractions": ["与完成当前任务无关的信息；没有则为空数组"],
  "answerScope": "只描述应回答的对象、范围和形式，不给答案",
  "paraphrase": "用学生容易理解的话准确复述题意，不得解题",
  "highlights": [{"text":"必须原样出现在 questionText 中的短语","category":"task|restriction|data|hidden|scope"}]
}

规则：
1. 所有内容使用简体中文，数组没有内容时返回 []，不得省略字段。
2. “限制条件”只写原题显式限定；“隐藏条件”写需要根据常识、概念或关系推出的前提。
3. potentialOmissions 必须具体指出可能漏掉的词、数据、范围或关系，不得只说“认真审题”。
4. highlights 只选对理解题意真正关键的原文短语，文本必须与 questionText 完全一致。
5. 如果资料含多道题，只分析画面或文档中最主要、最完整的一道题；无法判断时在 potentialOmissions 中说明。
6. 不输出 Markdown 代码块，不输出 JSON 之外的任何文字。`;

const FORMULA_RULES = `【跨学科公式与符号强制规范】
1. 凡是公式、变量、上下标、希腊字母、向量、分式、根式、方程、函数、集合、比例、坐标、科学计数法、单位组合、化学式、反应式、离子、电荷、同位素、遗传式、经纬度或比例尺，都必须写成可渲染的 LaTeX。
2. 行内公式必须使用 \\(...\\)，独立公式必须使用 \\[...\\]。不得把 LaTeX 命令裸露在分隔符外，不得使用 Markdown 代码块。
3. 数学示例：\\(f(x)=x^2\\)、\\(A\\cap B\\)、\\(\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}\\)。
4. 物理示例：\\(F=ma\\)、\\(v=\\frac{s}{t}\\)、\\(9.8\\,\\mathrm{m/s^2}\\)、\\(\\vec{B}\\)。数值与单位之间使用 \\,，单位使用 \\mathrm{}。
5. 化学必须使用 mhchem：\\(\\ce{2H2 + O2 -> 2H2O}\\)、\\(\\ce{SO4^2-}\\)、\\(\\ce{^{14}C}\\)、\\(\\ce{NaCl(aq)}\\)。
6. 生物中的遗传式、基因型、染色体和比例使用 LaTeX：\\(AaBb\\)、\\(X^H X^h\\)、\\(3:1\\)、\\(p^2+2pq+q^2=1\\)。普通生物名称保持中文。
7. 地理中的经纬度、坡度、比例尺和高度关系使用 LaTeX：\\(30^\\circ\\mathrm{N}\\)、\\(120^\\circ\\mathrm{E}\\)、\\(1:50000\\)、\\(i=\\frac{\\Delta h}{L}\\times100\\%\\)。
8. 正确的中文、学科名称和普通标点保持自然文字，不得转换成编码、实体或乱码；不得出现 �、ï¿½、â€ 等乱码片段。
9. JSON 字符串中的反斜杠必须按 JSON 规则正确转义，解析后的内容必须仍保留完整 LaTeX。
10. 以上规则适用于 questionText、potentialOmissions、taskWords、restrictions、keyData、hiddenConditions、distractions、answerScope、paraphrase 和 highlights 的全部文本字段。`;

const FORMULA_REPAIR_PROMPT = `你是审题 JSON 的公式校对器。只修复输入 JSON 中的乱码、未成对公式分隔符和无法渲染的 LaTeX，不改变题意、不增删字段、不解题。严格遵守以下规范并只返回完整 JSON：\n${FORMULA_RULES}`;

const STRUCTURE_REPAIR_PROMPT = `你是审题 JSON 的结构校对器。只修复输入内容的 JSON 语法和缺失字段，不改变题意、不解题。数组无内容时写 []，严格按系统给定字段返回一个完整 JSON 对象，不输出 Markdown 或解释。`;

type CompletionContent = string | Record<string, unknown> | Array<
  string | { type?: string; text?: string | { value?: string }; json?: unknown }
>;

interface CompletionResponse {
  choices?: Array<{
    message?: {
      content?: CompletionContent;
    };
  }>;
}

function endpointFromBaseUrl(baseUrl: string) {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("chat/completions", normalized).toString();
}

function contentToText(content: CompletionContent | undefined) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (part?.text && typeof part.text === "object" && "value" in part.text) {
        return String(part.text.value || "");
      }
      return "";
    }).join("");
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return "";
}

function repairJsonStringSyntax(source: string) {
  const latexCommands = new Set([
    "begin", "beta", "ce", "circ", "dfrac", "frac", "mathrm", "mathit", "mathbf",
    "nabla", "neq", "operatorname", "overline", "parallel", "perp", "pu", "right",
    "sqrt", "text", "tfrac", "theta", "times", "triangle", "underline", "vec",
  ]);
  let repaired = "";
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
      const validUnicode = character === "u" && /^[0-9a-fA-F]{4}$/.test(source.slice(index + 1, index + 5));
      if ('"\\/bfnrt'.includes(character) || validUnicode) repaired += character;
      else repaired += `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      const command = source.slice(index + 1).match(/^([A-Za-z]+)/)?.[1];
      if (command && latexCommands.has(command)) {
        repaired += "\\\\";
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
    if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      repaired += "\\n";
      continue;
    }
    repaired += character;
  }
  return repaired.replace(/,\s*([}\]])/g, "$1");
}

function parseJsonCandidate(source: string) {
  try {
    return JSON.parse(repairJsonStringSyntax(source));
  } catch {
    return JSON.parse(source);
  }
}

async function requestCompletion(
  config: AiConfig,
  messages: unknown[],
  options: { structured: boolean; maxTokens?: number } = { structured: true },
) {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: options.maxTokens || config.maxTokens,
  };
  if (options.structured) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(endpointFromBaseUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 800);
    const error = new Error(`AI 接口返回 ${response.status}：${details || response.statusText}`);
    Object.assign(error, { statusCode: response.status >= 500 ? 502 : 400, providerStatus: response.status });
    throw error;
  }

  return (await response.json()) as CompletionResponse;
}

async function completeWithCompatibility(config: AiConfig, messages: unknown[], maxTokens?: number) {
  try {
    return await requestCompletion(config, messages, { structured: true, maxTokens });
  } catch (error) {
    const providerStatus = (error as { providerStatus?: number }).providerStatus;
    if (providerStatus !== 400 && providerStatus !== 422) {
      throw error;
    }
    return requestCompletion(config, messages, { structured: false, maxTokens });
  }
}

export function parseModelResponse(raw: string): Analysis {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("AI 未返回可识别的 JSON 结果");
  }

  try {
    return analysisSchema.parse(parseJsonCandidate(trimmed.slice(start, end + 1)));
  } catch (error) {
    throw new Error("AI 返回的审题结果结构不完整，请重新分析", { cause: error });
  }
}

export async function analyzeQuestion(
  config: AiConfig,
  input: { subject: string; grade: string; notes: string },
  files: ParsedFiles,
) {
  const context = [
    `学科：${input.subject}`,
    `年级：${input.grade}`,
    input.notes ? `补充说明：${input.notes}` : "补充说明：无",
    config.customInstructions ? `教师额外要求：${config.customInstructions}` : "",
    files.text ? `提取到的文档文字：\n${files.text}` : "",
    "请只做审题结构分析，不要解题。",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: context }];
  for (const image of files.images) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${image.data}`,
        detail: "high",
      },
    });
  }

  const response = await completeWithCompatibility(config, [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${FORMULA_RULES}` },
    { role: "user", content: userContent },
  ]);
  const raw = contentToText(response.choices?.[0]?.message?.content);
  if (!raw) {
    throw new Error("AI 接口没有返回审题内容");
  }
  let analysis: Analysis;
  try {
    analysis = parseModelResponse(raw);
  } catch {
    const repairedResponse = await completeWithCompatibility(
      config,
      [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${STRUCTURE_REPAIR_PROMPT}` },
        { role: "user", content: `请把下面的模型输出修复为完整审题 JSON：\n${raw}` },
      ],
      config.maxTokens,
    );
    analysis = parseModelResponse(contentToText(repairedResponse.choices?.[0]?.message?.content));
  }
  let formulaIssues = validateAnalysisLatex(analysis);
  if (formulaIssues.length > 0) {
    const repairedResponse = await completeWithCompatibility(
      config,
      [
        { role: "system", content: FORMULA_REPAIR_PROMPT },
        {
          role: "user",
          content: `需要修复的问题：${JSON.stringify(formulaIssues.slice(0, 12))}\n\n原始 JSON：${JSON.stringify(analysis)}`,
        },
      ],
      config.maxTokens,
    );
    const repairedRaw = contentToText(repairedResponse.choices?.[0]?.message?.content);
    analysis = parseModelResponse(repairedRaw);
    formulaIssues = validateAnalysisLatex(analysis);
  }

  if (formulaIssues.length > 0) {
    throw new Error("AI 返回的公式格式不规范，已阻止显示乱码，请重新分析");
  }
  return analysis;
}

export async function testAiConnection(config: AiConfig) {
  const response = await requestCompletion(
    config,
    [
      { role: "system", content: "你是连接测试助手。" },
      { role: "user", content: "只回复：连接成功" },
    ],
    { structured: false, maxTokens: 20 },
  );
  const content = contentToText(response.choices?.[0]?.message?.content).trim();
  if (!content) {
    throw new Error("接口已响应，但没有返回内容");
  }
  return content;
}

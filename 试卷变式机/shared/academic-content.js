'use strict';

/**
 * 试卷变式机的全学科学术内容契约。
 * 这里保留 LaTeX 作为唯一规范源，禁止在服务端降级为线性文本或 Unicode 拼接。
 */
const FORMULA_OUTPUT_RULE = String.raw`所有题干、选项、答案和解析都必须使用真实教学场景中的规范学科符号与公式：
1. 统一定界：行内公式只用 \(...\)，独立公式、多行推导、方程组和矩阵只用 \[...\]。不要使用 $...$、$$...$$、Markdown 代码块、HTML 标签或未包裹的 LaTeX 命令。
2. JSON 转义：最终输出是 JSON，公式中的每个反斜杠都必须按 JSON 规则双写。例如字符串内容应写成 "\\(\\frac{a}{b}\\)"，解析后的实际内容才是 \(\frac{a}{b}\)。
3. 数学：分式、根式、幂与上下标、绝对值、集合、区间、函数、数列、三角函数、对数、极限、导数、积分、向量、矩阵、方程组、排列组合、概率统计、几何关系都使用标准 LaTeX。例如 \(\frac{-b\pm\sqrt{b^2-4ac}}{2a}\)、\(A\cap B\)、\(\overrightarrow{AB}\)、\(\begin{cases}x+y=3\\x-y=1\end{cases}\)。
4. 物理：物理量、矢量、上下标、希腊字母、科学计数法、单位和角度使用标准 LaTeX；数值与单位之间使用 \,，复合单位使用 \mathrm{}。例如 \(\vec{F}=m\vec{a}\)、\(v_0=5\,\mathrm{m\,s^{-1}}\)、\(U=IR\)、\(1.6\times10^{-19}\,\mathrm{C}\)。
5. 化学：分子式、离子、电荷、同位素、电子、配平反应、可逆反应、条件和物态统一使用 mhchem，并放在公式定界符内。例如 \(\ce{H2SO4}\)、\(\ce{SO4^2-}\)、\(\ce{^{14}_{6}C}\)、\(\ce{2H2(g) + O2(g) -> 2H2O(l)}\)、\(\ce{N2 + 3H2 <=>[高温、高压][催化剂] 2NH3}\)。化学计算的量和单位可使用 \pu{}。
6. 生物：遗传基因型、杂交组合、比例、种群增长、光合与呼吸反应、浓度和倍率使用标准 LaTeX；化学反应部分使用 mhchem。例如 \(Aa\times Aa\)、\(3\mathbin{:}1\)、\(N_t=N_0\lambda^t\)、\(\ce{6CO2 + 6H2O -> C6H12O6 + 6O2}\)。
7. 地理：经纬度、方向、比例尺、坡度、温差、气压、人口密度及自然地理计算使用标准 LaTeX。例如 \(35^\circ26'\mathrm{N}\)、\(120^\circ15'\mathrm{E}\)、\(i=\frac{h}{l}\times100\%\)、\(1\mathbin{:}50000\)。
8. 其他学科：凡含变量关系、数值结构、上下标、单位、逻辑符号或专业符号，都按同一 LaTeX 契约表达；普通中文保持自然文本，不要整句塞入 \text{}。
9. 禁止降级：不要用 1/2 代替 \(\frac{1}{2}\)，不要用 x^2、H2O、SO4^2-、sqrt(x)、Delta、theta、<=、-> 等线性代码冒充排版公式，也不要输出用户可见的反斜杠命令。
10. 输出前逐字段自检：所有定界符成对、花括号配对、化学方程式配平、单位规范、公式语义正确，并确保 KaTeX + mhchem 可以直接渲染。`;

const CONTROL_COMMAND_SUFFIXES = new Map([
  ['\b', ['egin', 'eta', 'ecause', 'ig', 'ar', 'mod']],
  ['\f', ['rac', 'orall']],
  ['\t', ['ext', 'frac', 'heta', 'imes', 'riangle', 'herefore', 'au', 'an', 'o', 'op']],
  ['\n', ['eq', 'e', 'abla', 'otin', 'u']],
  ['\r', ['ight', 'ho', 'ightarrow']],
]);

const DISPLAY_DOLLAR_PATTERN = /\$\$([\s\S]*?)\$\$/g;
const INLINE_DOLLAR_PATTERN = /(^|[^\\$])\$([^$\n]+?)\$/g;
const FORMULA_DELIMITER_PATTERN = /\\[()[\]]/gu;
const ACADEMIC_TEXT_FIELDS = ['title'];
const ITEM_TEXT_FIELDS = ['stem', 'answer', 'explanation'];

function stripMarkdownFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/```\s*$/u, '');
}

function extractCompleteJsonObject(content) {
  const source = stripMarkdownFence(content);
  const start = source.indexOf('{');
  if (start < 0) throw new Error('AI 返回内容中未找到 JSON 对象');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('AI 返回的 JSON 对象未完整结束');
}

function isLikelyLatexCommand(source, slashIndex) {
  const tail = source.slice(slashIndex + 1);
  const command = tail.match(/^[A-Za-z]+/u)?.[0] || '';
  if (command.length >= 2) return true;
  return /^[()[\]{}!,;:%&#_^]/u.test(tail);
}

/**
 * 在 JSON.parse 前保护 AI 偶发漏写的 LaTeX 反斜杠。
 * 尤其防止 \frac、\theta、\neq 被 JSON 当成 \f、\t、\n 控制转义吞掉。
 */
function normalizeJsonStringSyntax(source) {
  let fixed = '';
  let inString = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (!inString) {
      fixed += ch;
      if (ch === '"') inString = true;
      continue;
    }

    if (ch === '"') {
      fixed += ch;
      inString = false;
      continue;
    }

    if (ch === '\\') {
      const next = source[i + 1] || '';
      const validUnicode = next === 'u' && /^[0-9a-fA-F]{4}$/u.test(source.slice(i + 2, i + 6));
      if (validUnicode) {
        fixed += source.slice(i, i + 6);
        i += 5;
        continue;
      }
      if (next === '"' || next === '\\' || next === '/') {
        fixed += `\\${next}`;
        i += 1;
        continue;
      }
      if (!isLikelyLatexCommand(source, i) && /[bfnrt]/u.test(next)) {
        fixed += `\\${next}`;
        i += 1;
        continue;
      }

      // 只补写 JSON 所需的一个反斜杠，命令正文交由下一轮复制。
      fixed += '\\\\';
      continue;
    }

    const code = ch.charCodeAt(0);
    if (ch === '\n') {
      fixed += '\\n';
    } else if (ch === '\r') {
      if (source[i + 1] === '\n') i += 1;
      fixed += '\\n';
    } else if (code < 0x20) {
      const escapedControl = {
        '\b': '\\b',
        '\t': '\\t',
        '\f': '\\f',
      }[ch];
      fixed += escapedControl || '';
    } else {
      fixed += ch;
    }
  }

  return fixed.replace(/,\s*([}\]])/gu, '$1');
}

function parseAcademicJson(content) {
  const jsonSource = extractCompleteJsonObject(content);
  const protectedSource = normalizeJsonStringSyntax(jsonSource);
  return JSON.parse(protectedSource);
}

function repairParsedControlEscapes(value) {
  let text = String(value ?? '');
  CONTROL_COMMAND_SUFFIXES.forEach((suffixes, controlChar) => {
    const command = { 8: 'b', 9: 't', 10: 'n', 12: 'f', 13: 'r' }[controlChar.charCodeAt(0)];
    suffixes
      .slice()
      .sort((a, b) => b.length - a.length)
      .forEach((suffix) => {
        text = text.replaceAll(`${controlChar}${suffix}`, `\\${command}${suffix}`);
      });
  });
  return text.replace(/[\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u000B\u000E-\u001F\u007F]/gu, '');
}

/**
 * 保守修复模型偶发输出的混合闭合符：\(...\] 与 \[...\)。
 * 只有已经进入公式且遇到另一类“闭合符”时才替换，不猜测缺失的公式边界。
 */
function repairMismatchedFormulaDelimiters(value) {
  const source = String(value ?? '');
  let formulaMode = null;
  let cursor = 0;
  let repaired = '';

  for (const match of source.matchAll(FORMULA_DELIMITER_PATTERN)) {
    const token = match[0];
    repaired += source.slice(cursor, match.index);

    if (!formulaMode) {
      repaired += token;
      if (token === '\\(') formulaMode = 'inline';
      if (token === '\\[') formulaMode = 'display';
    } else if (token === '\\)' || token === '\\]') {
      repaired += formulaMode === 'inline' ? '\\)' : '\\]';
      formulaMode = null;
    } else {
      // 新的起始符不能可靠判断前一个公式应在哪里结束，保留给完整性校验拒绝。
      repaired += token;
    }

    cursor = match.index + token.length;
  }

  return repaired + source.slice(cursor);
}

/**
 * 把任意公式定界符序列收敛为可安全展示的终态。
 * - 已配对定界符原样保留；
 * - 混用闭合符按起始类型修正；
 * - 孤立起始符或闭合符直接移除，公式正文完整保留给隐式 LaTeX 渲染器。
 */
function stabilizeFormulaDelimiters(value) {
  const source = String(value ?? '');
  const parts = [];
  let activeFormula = null;
  let cursor = 0;

  for (const match of source.matchAll(FORMULA_DELIMITER_PATTERN)) {
    const token = match[0];
    parts.push(source.slice(cursor, match.index));

    if (token === '\\(' || token === '\\[') {
      if (activeFormula) {
        // 新起始符意味着前一个公式没有闭合；只移除旧起始符，不吞正文。
        parts[activeFormula.partIndex] = '';
      }
      activeFormula = {
        mode: token === '\\(' ? 'inline' : 'display',
        partIndex: parts.length,
      };
      parts.push(token);
    } else if (activeFormula) {
      parts.push(activeFormula.mode === 'inline' ? '\\)' : '\\]');
      activeFormula = null;
    } else {
      // 没有对应起始符的闭合符没有语义，移除后正文仍保持可读。
      parts.push('');
    }

    cursor = match.index + token.length;
  }

  if (activeFormula) parts[activeFormula.partIndex] = '';
  parts.push(source.slice(cursor));
  return parts.join('');
}

function normalizeAcademicText(value) {
  let text = repairParsedControlEscapes(value)
    .replace(/\r\n?/gu, '\n')
    .replace(/```(?:latex|tex|math)?/giu, '')
    .replace(/\\\\(?=[()[\]])/gu, '\\');

  text = text.replace(DISPLAY_DOLLAR_PATTERN, (_, body) => `\\[${body.trim()}\\]`);
  text = text.replace(INLINE_DOLLAR_PATTERN, (_, prefix, body) => `${prefix}\\(${body.trim()}\\)`);
  return repairMismatchedFormulaDelimiters(text).trim();
}

function stabilizeAcademicText(value) {
  return stabilizeFormulaDelimiters(normalizeAcademicText(value))
    .replace(/(^|[^\\])\${1,2}/gu, '$1')
    .trim();
}

function rebuildExamAnswers(exam) {
  if (!exam || !Array.isArray(exam.questions)) return exam;
  const answers = [];
  let index = 1;
  for (const group of exam.questions) {
    if (!group || !Array.isArray(group.items)) continue;
    for (const item of group.items) {
      if (!item) continue;
      item.index = index;
      answers.push(`${index}. ${item.answer || ''} 解析：${item.explanation || ''}`.trim());
      index += 1;
    }
  }
  exam.answers = answers;
  return exam;
}

function collectAcademicTextEntries(exam) {
  const entries = [];
  if (!exam || !Array.isArray(exam.questions)) return entries;

  const addEntry = (path, owner, key) => {
    if (typeof owner?.[key] !== 'string') return;
    entries.push({
      path,
      value: owner[key],
      set(nextValue) {
        owner[key] = nextValue;
      },
    });
  };

  for (const field of ACADEMIC_TEXT_FIELDS) addEntry(field, exam, field);
  exam.questions.forEach((group, groupIndex) => {
    if (!group) return;
    addEntry(`questions[${groupIndex}].title`, group, 'title');
    (Array.isArray(group.items) ? group.items : []).forEach((item, itemIndex) => {
      if (!item) return;
      for (const field of ITEM_TEXT_FIELDS) {
        addEntry(`questions[${groupIndex}].items[${itemIndex}].${field}`, item, field);
      }
      (Array.isArray(item.options) ? item.options : []).forEach((option, optionIndex) => {
        if (typeof option !== 'string') return;
        entries.push({
          path: `questions[${groupIndex}].items[${itemIndex}].options[${optionIndex}]`,
          value: option,
          set(nextValue) {
            item.options[optionIndex] = nextValue;
          },
        });
      });
    });
  });

  return entries;
}

function normalizeExamAcademicContent(exam) {
  for (const entry of collectAcademicTextEntries(exam)) {
    entry.set(normalizeAcademicText(entry.value));
  }
  return rebuildExamAnswers(exam);
}

function stabilizeExamAcademicContent(exam, targetPaths) {
  const expectedPaths = targetPaths ? new Set(targetPaths) : null;
  const changedPaths = [];
  for (const entry of collectAcademicTextEntries(exam)) {
    if (expectedPaths && !expectedPaths.has(entry.path)) continue;
    const stabilized = stabilizeAcademicText(entry.value);
    if (stabilized === entry.value) continue;
    entry.set(stabilized);
    changedPaths.push(entry.path);
  }
  rebuildExamAnswers(exam);
  return changedPaths;
}

function countToken(text, token) {
  return String(text || '').split(token).length - 1;
}

function inspectAcademicText(value, path) {
  const text = String(value || '');
  const issues = [];
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
    issues.push({ path, code: 'CONTROL_CHARACTER', message: '包含不可见控制字符' });
  }
  if (countToken(text, '\\(') !== countToken(text, '\\)')) {
    issues.push({ path, code: 'UNBALANCED_INLINE_DELIMITER', message: '行内公式定界符不成对' });
  }
  if (countToken(text, '\\[') !== countToken(text, '\\]')) {
    issues.push({ path, code: 'UNBALANCED_DISPLAY_DELIMITER', message: '独立公式定界符不成对' });
  }
  if (/```|(^|[^\\])\$/u.test(text)) {
    issues.push({ path, code: 'NONSTANDARD_DELIMITER', message: '仍包含代码块或非标准公式定界符' });
  }
  const inlineBalanced = countToken(text, '\\(') === countToken(text, '\\)');
  const displayBalanced = countToken(text, '\\[') === countToken(text, '\\]');
  if (inlineBalanced && displayBalanced) {
    let activeMode = null;
    let malformedSequence = false;
    for (const match of text.matchAll(FORMULA_DELIMITER_PATTERN)) {
      const token = match[0];
      if (token === '\\(' || token === '\\[') {
        if (activeMode) malformedSequence = true;
        activeMode = token === '\\(' ? 'inline' : 'display';
      } else if (!activeMode) {
        malformedSequence = true;
      } else {
        const expected = activeMode === 'inline' ? '\\)' : '\\]';
        if (token !== expected) malformedSequence = true;
        activeMode = null;
      }
    }
    if (malformedSequence) {
      issues.push({ path, code: 'MALFORMED_DELIMITER_SEQUENCE', message: '公式定界符顺序或嵌套关系错误' });
    }
  }
  return issues;
}

function findAcademicContentIssues(exam) {
  if (!exam || !Array.isArray(exam.questions)) {
    return [{ path: 'questions', code: 'INVALID_EXAM', message: '缺少试题数组' }];
  }
  const issues = [];
  for (const entry of collectAcademicTextEntries(exam)) {
    issues.push(...inspectAcademicText(entry.value, entry.path));
  }
  return issues;
}

function groupAcademicContentIssues(exam) {
  const entries = new Map(collectAcademicTextEntries(exam).map((entry) => [entry.path, entry]));
  const grouped = new Map();
  for (const issue of findAcademicContentIssues(exam)) {
    if (!entries.has(issue.path)) continue;
    const current = grouped.get(issue.path) || {
      path: issue.path,
      value: entries.get(issue.path).value,
      codes: [],
      messages: [],
    };
    if (!current.codes.includes(issue.code)) current.codes.push(issue.code);
    if (!current.messages.includes(issue.message)) current.messages.push(issue.message);
    grouped.set(issue.path, current);
  }
  return [...grouped.values()];
}

function buildAcademicRepairPrompts(exam, issues, context = {}) {
  const subject = String(context.subject || exam?.analysisSummary?.subject || '未明确科目');
  const grade = String(context.grade || exam?.analysisSummary?.gradeLevel || '未明确年级');
  const fields = issues.map((issue) => ({
    path: issue.path,
    problems: issue.messages,
    value: issue.value,
  }));
  const systemPrompt = `你是 K12 全学科公式格式修复器。你的唯一任务是修复给定字段中的 LaTeX/mhchem 格式，绝不能改变题意、数值、单位、答案、推导结论、字段路径或普通文字。

${FORMULA_OUTPUT_RULE}

额外要求：
1. 逐字符检查每个 \\( 必须有 \\)，每个 \\[ 必须有 \\]，不能混用。
2. 只返回给定字段的修复结果，不得补充或删除其他内容。
3. 只返回 JSON，不返回 markdown 或解释。`;
  const userPrompt = `科目：${subject}
年级：${grade}

请只修复以下字段：
${JSON.stringify(fields, null, 2)}

输出结构：
{
  "repairs": [
    {
      "path": "原字段路径",
      "value": "仅修复公式格式后的完整字段内容"
    }
  ]
}

必须返回每个给定 path，不能返回任何其他 path。`;
  return {
    systemPrompt,
    userPrompt,
    maxTokens: Math.min(8000, Math.max(1600, 800 + issues.length * 700)),
  };
}

function applyAcademicRepairs(exam, payload, issues) {
  const expectedPaths = new Set(issues.map((issue) => issue.path));
  const entries = new Map(collectAcademicTextEntries(exam).map((entry) => [entry.path, entry]));
  const appliedPaths = [];
  for (const repair of Array.isArray(payload?.repairs) ? payload.repairs : []) {
    const path = String(repair?.path || '');
    const value = typeof repair?.value === 'string' ? repair.value.trim() : '';
    const entry = expectedPaths.has(path) ? entries.get(path) : null;
    if (!entry || !value || appliedPaths.includes(path)) continue;
    entry.set(normalizeAcademicText(value));
    appliedPaths.push(path);
  }
  rebuildExamAnswers(exam);
  return appliedPaths;
}

async function repairExamAcademicContent(exam, options = {}) {
  const requestRepair = options.requestRepair;
  const parseRepair = typeof options.parseRepair === 'function' ? options.parseRepair : JSON.parse;
  const maxAttempts = Math.max(1, Math.min(3, Number(options.maxAttempts) || 2));
  const appliedPaths = new Set();
  const errors = [];

  normalizeExamAcademicContent(exam);
  let issues = groupAcademicContentIssues(exam);
  const initialIssueCount = issues.length;

  for (let attempt = 1; attempt <= maxAttempts && issues.length > 0; attempt += 1) {
    if (typeof requestRepair !== 'function') break;
    const prompts = buildAcademicRepairPrompts(exam, issues, options.context);
    try {
      const raw = await requestRepair({ ...prompts, attempt, issues });
      const payload = typeof raw === 'string' ? parseRepair(raw) : raw;
      for (const path of applyAcademicRepairs(exam, payload, issues)) appliedPaths.add(path);
    } catch (error) {
      errors.push(String(error?.message || error));
    }
    normalizeExamAcademicContent(exam);
    issues = groupAcademicContentIssues(exam);
  }

  // 返修服务不可用或连续返回坏格式时，只移除孤立定界符，题目正文与公式源码全部保留。
  const fallbackPaths = issues.map((issue) => issue.path);
  stabilizeExamAcademicContent(exam, fallbackPaths);
  const remainingIssues = findAcademicContentIssues(exam);
  if (remainingIssues.length > 0) {
    const sample = remainingIssues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`).join('；');
    throw new Error(`学科公式内容终态修复失败：${sample}`);
  }

  const fallbackSet = new Set(fallbackPaths);
  return {
    initialIssueCount,
    repairedPaths: [...appliedPaths].filter((path) => !fallbackSet.has(path)),
    fallbackPaths,
    errors,
  };
}

function assertAcademicContentIntegrity(exam) {
  const issues = findAcademicContentIssues(exam);
  if (!issues.length) return exam;
  const sample = issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`).join('；');
  const error = new Error(`学科公式内容校验失败：${sample}`);
  error.code = 'ACADEMIC_CONTENT_INVALID';
  error.issues = issues;
  throw error;
}

module.exports = {
  FORMULA_OUTPUT_RULE,
  extractCompleteJsonObject,
  normalizeJsonStringSyntax,
  parseAcademicJson,
  repairParsedControlEscapes,
  repairMismatchedFormulaDelimiters,
  stabilizeFormulaDelimiters,
  normalizeAcademicText,
  normalizeExamAcademicContent,
  stabilizeExamAcademicContent,
  rebuildExamAnswers,
  findAcademicContentIssues,
  buildAcademicRepairPrompts,
  applyAcademicRepairs,
  repairExamAcademicContent,
  assertAcademicContentIntegrity,
};

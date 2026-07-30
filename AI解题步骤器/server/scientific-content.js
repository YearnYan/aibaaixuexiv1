import katex from 'katex';
import 'katex/contrib/mhchem';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { AppError } from './errors.js';

const parser = unified().use(remarkParse).use(remarkMath);

const INVALID_CODE_POINT = /\uFFFD|[\uE000-\uF8FF]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/u;
const RAW_SCIENTIFIC_SYMBOL = /[Α-Ωα-ω∂∆∇∑∏∫√∞≈≠≤≥±×÷∝∈∉∪∩⊂⊃⊆⊇∅∀∃∠⊥∥≡→←↔⇌⇋⇒⇔°℃℉‰′″]/u;
const RAW_SCRIPT_CHARACTER = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜ]/u;
const LATEX_COMMAND_OUTSIDE_MATH = /\\(?:[A-Za-z]+|[^\s])/u;
const ASCII_EQUATION = /(?:[A-Za-z]|\d)\s*(?:=|<|>)\s*(?:[A-Za-z]|\d|[-+])/u;
const ASCII_OPERATION = /(?:\d|[A-Za-z])\s*(?:[+*/^_]|-(?![\u4E00-\u9FFF]))\s*(?:\d|[A-Za-z])/u;
const RAW_FRACTION_OR_RATIO = /\b\d+(?:\.\d+)?\s*(?:\/|:)\s*\d+(?:\.\d+)?\b/u;
const RAW_PERCENTAGE = /\b\d+(?:\.\d+)?\s*%/u;
const RAW_UNIT = /\b\d+(?:\.\d+)?\s*(?:mm|cm|dm|km|m|ms|s|min|h|mg|kg|g|mol|mL|L|K|Pa|kPa|MPa|N|J|W|V|A|Hz|C|F|T|Wb)(?:\b|\/)/u;
const RAW_CHEMICAL_FORMULA = /\b(?:[A-Z][a-z]?\d+)(?:[A-Z][a-z]?\d*)*\b/u;
const RAW_LATIN_TOKEN = /[A-Za-z]/u;
const ACCIDENTAL_ENGLISH_ARTICLE = /([\u3400-\u9FFF，。；：、！？）])\s*(?:the|an)\s*(?=[\u3400-\u9FFF（])/giu;
const INVISIBLE_FORMAT_CHARACTER = /[\u200B-\u200D\u2060\uFEFF]/gu;

function compactSample(value) {
  return String(value).replace(/\s+/g, ' ').slice(0, 80);
}

function addIssue(issues, field, reason, value) {
  issues.push({ field, reason, sample: compactSample(value) });
}

export function normalizeScientificText(value) {
  return String(value || '')
    .replace(INVISIBLE_FORMAT_CHARACTER, '')
    .replace(ACCIDENTAL_ENGLISH_ARTICLE, '$1')
    .replace(/\\\[([\s\S]*?)\\\]/gu, (_match, formula) => `$$\n${formula.trim()}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/gu, (_match, formula) => `$${formula.trim()}$`);
}

export function normalizeScientificPlan(plan) {
  return {
    ...plan,
    problemSummary: normalizeScientificText(plan.problemSummary),
    knowledgePoints: plan.knowledgePoints.map(normalizeScientificText),
    steps: plan.steps.map((step) => ({
      ...step,
      title: normalizeScientificText(step.title),
      description: normalizeScientificText(step.description),
      task: normalizeScientificText(step.task),
      guidance: normalizeScientificText(step.guidance),
      hints: step.hints.map(normalizeScientificText),
    })),
    finalAnswer: normalizeScientificText(plan.finalAnswer),
  };
}

export function validateScientificText(value, field = '内容') {
  const source = String(value || '');
  const issues = [];
  let tree;

  try {
    tree = parser.parse(source);
  } catch {
    return [{ field, reason: 'Markdown 或 LaTeX 结构无法解析', sample: compactSample(source) }];
  }

  visit(tree, (node) => {
    if (node.type === 'inlineMath' || node.type === 'math') {
      if (!node.value.trim()) {
        addIssue(issues, field, '存在空公式', node.value);
        return;
      }
      if (node.value.length > 2000) {
        addIssue(issues, field, '单个公式过长', node.value);
        return;
      }
      try {
        katex.renderToString(node.value, {
          displayMode: node.type === 'math',
          throwOnError: true,
          strict: 'error',
          trust: false,
          maxExpand: 1000,
          output: 'htmlAndMathml',
        });
      } catch (error) {
        addIssue(issues, field, `LaTeX 编译失败：${error.message}`, node.value);
      }
      return;
    }

    if (node.type === 'html' || node.type === 'code' || node.type === 'inlineCode') {
      addIssue(issues, field, '不允许使用 HTML 或代码块代替学科表达', node.value || node.type);
      return;
    }

    if (node.type !== 'text') return;
    const text = node.value;
    if (INVALID_CODE_POINT.test(text)) addIssue(issues, field, '包含乱码或私用字符', text);
    if (text.includes('$')) addIssue(issues, field, '包含未闭合或未解析的公式定界符', text);
    if (RAW_SCIENTIFIC_SYMBOL.test(text)) addIssue(issues, field, '科学符号必须写在 LaTeX 公式中', text);
    if (RAW_SCRIPT_CHARACTER.test(text)) addIssue(issues, field, '上下标必须使用 LaTeX 表达', text);
    if (LATEX_COMMAND_OUTSIDE_MATH.test(text)) addIssue(issues, field, 'LaTeX 命令必须放在公式定界符内', text);
    if (ASCII_EQUATION.test(text)) addIssue(issues, field, '等式或不等式必须使用 LaTeX 表达', text);
    if (ASCII_OPERATION.test(text)) addIssue(issues, field, '运算式必须使用 LaTeX 表达', text);
    if (RAW_FRACTION_OR_RATIO.test(text)) addIssue(issues, field, '分数或比例必须使用 LaTeX 表达', text);
    if (RAW_PERCENTAGE.test(text)) addIssue(issues, field, '百分数必须使用 LaTeX 表达', text);
    if (RAW_UNIT.test(text)) addIssue(issues, field, '物理量和单位必须使用 LaTeX 的 \\mathrm 表达', text);
    if (RAW_CHEMICAL_FORMULA.test(text)) addIssue(issues, field, '化学式必须使用 LaTeX 的 \\ce 表达', text);
    if (RAW_LATIN_TOKEN.test(text)) addIssue(issues, field, '变量、点名、缩写和拉丁字母必须使用 LaTeX 表达', text);
  });

  return issues;
}

function planTextEntries(plan) {
  const entries = [
    ['problemSummary', plan.problemSummary],
    ...plan.knowledgePoints.map((value, index) => [`knowledgePoints[${index}]`, value]),
  ];

  plan.steps.forEach((step, stepIndex) => {
    entries.push(
      [`steps[${stepIndex}].title`, step.title],
      [`steps[${stepIndex}].description`, step.description],
      [`steps[${stepIndex}].task`, step.task],
      [`steps[${stepIndex}].guidance`, step.guidance],
      ...step.hints.map((value, hintIndex) => [`steps[${stepIndex}].hints[${hintIndex}]`, value]),
    );
  });

  entries.push(['finalAnswer', plan.finalAnswer]);

  return entries;
}

export function validateScientificPlan(plan) {
  return planTextEntries(plan).flatMap(([field, value]) => validateScientificText(value, field));
}

export function assertScientificPlan(plan) {
  const issues = validateScientificPlan(plan);
  if (!issues.length) return plan;

  const error = new AppError(
    422,
    'AI_SCIENTIFIC_NOTATION_INVALID',
    'AI 生成的学科符号或公式不规范，请重新生成。',
  );
  error.validationIssues = issues;
  throw error;
}

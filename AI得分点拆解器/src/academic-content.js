const katex = require("katex");
require("katex/contrib/mhchem");

const { AppError } = require("./errors");

const DELIMITERS = [
  { left: "\\[", right: "\\]", display: true },
  { left: "\\(", right: "\\)", display: false },
];

function normalizeAcademicText(value) {
  const text = String(value || "").normalize("NFC");
  return text
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula) => `\\[${formula.trim()}\\]`)
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_match, prefix, formula) => `${prefix}\\(${formula.trim()}\\)`)
    .trim();
}

function nextDelimiter(text, cursor) {
  let next;
  for (const delimiter of DELIMITERS) {
    const index = text.indexOf(delimiter.left, cursor);
    if (index >= 0 && (!next || index < next.index)) next = { ...delimiter, index };
  }
  return next;
}

function assertPlainText(text, field) {
  if (/\\\]|\\\)/.test(text)) {
    throw new AppError("AI_RESPONSE_INVALID", `${field} 中存在未配对的公式结束符`, 502);
  }
  if (/\\[A-Za-z]+/.test(text)) {
    throw new AppError("AI_RESPONSE_INVALID", `${field} 中的 LaTeX 命令必须放在公式定界符内`, 502);
  }
}

function tokenizeAcademicText(value, { field = "报告文本" } = {}) {
  const text = normalizeAcademicText(value);
  if (text.includes("\uFFFD")) {
    throw new AppError("AI_RESPONSE_INVALID", `${field} 中存在无法识别的损坏字符`, 502);
  }

  const tokens = [];
  let cursor = 0;
  while (cursor < text.length) {
    const opening = nextDelimiter(text, cursor);
    if (!opening) {
      const plain = text.slice(cursor);
      assertPlainText(plain, field);
      if (plain) tokens.push({ type: "text", value: plain });
      break;
    }

    const plain = text.slice(cursor, opening.index);
    assertPlainText(plain, field);
    if (plain) tokens.push({ type: "text", value: plain });

    const formulaStart = opening.index + opening.left.length;
    const formulaEnd = text.indexOf(opening.right, formulaStart);
    if (formulaEnd < 0) {
      throw new AppError("AI_RESPONSE_INVALID", `${field} 中存在未闭合的公式`, 502);
    }

    const formula = text.slice(formulaStart, formulaEnd).trim();
    if (!formula) {
      throw new AppError("AI_RESPONSE_INVALID", `${field} 中存在空公式`, 502);
    }
    tokens.push({ type: "math", value: formula, display: opening.display });
    cursor = formulaEnd + opening.right.length;
  }
  return tokens;
}

function validateAcademicText(value, { field = "报告文本" } = {}) {
  const normalized = normalizeAcademicText(value);
  const tokens = tokenizeAcademicText(normalized, { field });
  for (const token of tokens) {
    if (token.type !== "math") continue;
    try {
      katex.renderToString(token.value, {
        displayMode: token.display,
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 1000,
        maxSize: 20,
      });
    } catch {
      throw new AppError("AI_RESPONSE_INVALID", `${field} 中存在无法解析的学科公式`, 502);
    }
  }
  return normalized;
}

function truncateAcademicText(value, maxLength) {
  const normalized = normalizeAcademicText(value);
  if (normalized.length <= maxLength) return normalized;
  const tokens = tokenizeAcademicText(normalized);
  const limit = Math.max(1, maxLength - 1);
  let result = "";

  for (const token of tokens) {
    const serialized = token.type === "math"
      ? `${token.display ? "\\[" : "\\("}${token.value}${token.display ? "\\]" : "\\)"}`
      : token.value;
    if (result.length + serialized.length <= limit) {
      result += serialized;
      continue;
    }
    if (token.type === "text") result += serialized.slice(0, Math.max(0, limit - result.length));
    break;
  }
  return `${result.trimEnd()}…`;
}

function normalizeReportAcademicText(report) {
  return {
    ...report,
    contentFormat: "latex-v1",
    questionPreview: validateAcademicText(report.questionPreview, { field: "题目预览" }),
    revisionAdvice: validateAcademicText(report.revisionAdvice, { field: "整体建议" }),
    reviewNote: validateAcademicText(report.reviewNote, { field: "复核说明" }),
    scorePoints: report.scorePoints.map((point) => ({
      ...point,
      evidence: point.evidence
        ? validateAcademicText(point.evidence, { field: `${point.label}作答依据` })
        : "",
      requirement: validateAcademicText(point.requirement, { field: `${point.label}评分观察` }),
      analysis: validateAcademicText(point.analysis, { field: `${point.label}分析` }),
      suggestion: validateAcademicText(point.suggestion, { field: `${point.label}建议` }),
    })),
  };
}

module.exports = {
  normalizeAcademicText,
  normalizeReportAcademicText,
  tokenizeAcademicText,
  truncateAcademicText,
  validateAcademicText,
};

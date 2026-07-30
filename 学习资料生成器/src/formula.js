import katex from "katex";
import "katex/contrib/mhchem/mhchem.js";

const FORMULA_DELIMITERS = [
  { open: "$$", close: "$$", display: true },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$", close: "$", display: false }
];

const AUDIT_EXCLUDED_ROOT_KEYS = new Set([
  "sourceAtoms",
  "sourceEvidence",
  "sourceFiles"
]);

const CHEMICAL_ELEMENTS = new Set([
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar",
  "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr",
  "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe",
  "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu",
  "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn",
  "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr",
  "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og"
]);

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function isUsableDelimiterAt(text, index, delimiter, opening) {
  if (isEscaped(text, index)) return false;
  if (delimiter.open !== "$" || !opening) return true;
  return text[index - 1] !== "$" && text[index + 1] !== "$";
}

function findOpeningDelimiter(text, fromIndex) {
  let nearest = null;
  FORMULA_DELIMITERS.forEach((delimiter, order) => {
    let index = text.indexOf(delimiter.open, fromIndex);
    while (index >= 0 && !isUsableDelimiterAt(text, index, delimiter, true)) {
      index = text.indexOf(delimiter.open, index + delimiter.open.length);
    }
    if (index < 0) return;
    if (!nearest || index < nearest.index || (index === nearest.index && order < nearest.order)) {
      nearest = { ...delimiter, index, order };
    }
  });
  return nearest;
}

function findClosingDelimiter(text, delimiter, fromIndex) {
  let index = text.indexOf(delimiter.close, fromIndex);
  while (index >= 0) {
    const isSingleDollarPair = delimiter.close === "$" && (text[index - 1] === "$" || text[index + 1] === "$");
    if (!isEscaped(text, index) && !isSingleDollarPair) return index;
    index = text.indexOf(delimiter.close, index + delimiter.close.length);
  }
  return -1;
}

function pushTextSegment(segments, value) {
  if (!value) return;
  const previous = segments.at(-1);
  if (previous?.type === "text") previous.value += value;
  else segments.push({ type: "text", value });
}

export function splitFormulaSegments(value) {
  const text = String(value ?? "");
  const segments = [];
  let cursor = 0;

  while (cursor < text.length) {
    const opening = findOpeningDelimiter(text, cursor);
    if (!opening) {
      pushTextSegment(segments, text.slice(cursor));
      break;
    }

    const formulaStart = opening.index + opening.open.length;
    const closingIndex = findClosingDelimiter(text, opening, formulaStart);
    if (closingIndex < 0) {
      pushTextSegment(segments, text.slice(cursor));
      break;
    }

    pushTextSegment(segments, text.slice(cursor, opening.index));
    const latex = text.slice(formulaStart, closingIndex).trim();
    if (latex) {
      segments.push({
        type: "formula",
        value: latex,
        display: opening.display,
        source: text.slice(opening.index, closingIndex + opening.close.length)
      });
    } else {
      pushTextSegment(segments, text.slice(opening.index, closingIndex + opening.close.length));
    }
    cursor = closingIndex + opening.close.length;
  }

  return segments;
}

export function formulaCacheKey(latex, display = false) {
  return `${display ? "display" : "inline"}:${String(latex ?? "").trim()}`;
}

export function validateLatex(latex, display = false) {
  const source = String(latex ?? "").trim();
  if (!source) return { valid: false, error: "公式内容为空" };
  try {
    katex.renderToString(source, {
      displayMode: Boolean(display),
      output: "htmlAndMathml",
      strict(errorCode) {
        return errorCode === "unicodeTextInMathMode" ? "ignore" : "error";
      },
      throwOnError: true,
      trust: false
    });
    return { valid: true, error: "" };
  } catch (error) {
    return { valid: false, error: String(error?.message || "无法解析公式").replace(/^KaTeX parse error:\s*/iu, "") };
  }
}

function pathLabel(pathParts) {
  return pathParts.map((part) => (typeof part === "number" ? `[${part}]` : part)).join(".").replace(/\.\[/gu, "[");
}

function shouldSkipAuditPath(pathParts) {
  if (AUDIT_EXCLUDED_ROOT_KEYS.has(pathParts[0])) return true;
  const lastKey = String(pathParts.at(-1) ?? "");
  if (/^(?:id|sourceRefs|scopeType|evidenceFocus)$/u.test(lastKey) || /(?:Id|Ids)$/u.test(lastKey)) return true;
  if (pathParts[0] === "teachingFigures" && (
    pathParts.includes("elements")
    || pathParts.includes("params")
    || /^(?:svg|hash|type|subject|renderStatus|labels|constraints)$/u.test(lastKey)
  )) return true;
  return pathParts.length >= 3
    && pathParts[0] === "knowledgeDiagrams"
    && pathParts.at(-1) === "ascii";
}

function looksLikeChemicalFormula(candidate, allowSingleElement = false) {
  const source = candidate.replace(/(?:\d*[+-])$/u, "");
  const tokens = [...source.matchAll(/([A-Z][a-z]?)(\d*)/gu)];
  if (!tokens.length) return false;
  if (tokens.map((match) => match[0]).join("") !== source) return false;
  return tokens.every((match) => CHEMICAL_ELEMENTS.has(match[1]))
    && (allowSingleElement || tokens.length >= 2 || /\d/u.test(candidate) || /[+-]$/u.test(candidate));
}

function findBareChemicalFormula(text, allowSingleElement = false) {
  const candidates = [...text.matchAll(/\b(?:[A-Z][a-z]?\d*){1,12}(?:\d*[+-])?\b/gu)];
  for (const match of candidates) {
    const candidate = match[0];
    if (!looksLikeChemicalFormula(candidate, allowSingleElement)) continue;
    // 化学学科中的单字母元素（如 B、C）也可能只是选择题标签或变量；
    // 只有在“元素/原子/离子/反应物”等明确化学语境中才要求写成 \\ce{...}。
    if (allowSingleElement && candidate.length === 1) {
      const index = match.index ?? 0;
      const context = `${text.slice(Math.max(0, index - 14), index)}${text.slice(index + candidate.length, index + candidate.length + 14)}`;
      if (!/(?:元素|原子|离子|化学式|反应物|生成物|酸|碱|盐|溶液|气体|沉淀|燃烧|配平|价态|电子层|摩尔|浓度)/u.test(context)) continue;
    }
    return candidate;
  }
  return "";
}

function getPracticeItem(material, pathParts) {
  if (pathParts[0] !== "practice" || typeof pathParts[1] !== "number") return null;
  return Array.isArray(material?.practice) ? material.practice[pathParts[1]] : null;
}

function normalizeChoiceAuditText(text, pathParts, material) {
  const practice = getPracticeItem(material, pathParts);
  if (!practice) return text;
  const options = Array.isArray(practice.options) ? practice.options : [];
  const lastKey = pathParts.at(-1);
  const optionIndex = pathParts.indexOf("options");
  let normalizedText = text;

  if (options.length) {
    normalizedText = normalizedText
      .replace(/((?:选择|选项|答案|故选|应选|正确选项)(?:为|是)?\s*)[A-F](?=$|[\s，。；：、）)])/gu, "$1")
      .replace(/\b[A-F]\s*项(?=正确|错误|符合|不符合|可选|不可选)/gu, "该选项");
  }

  if (optionIndex >= 0) {
    const normalizedOptions = options.map((item) => String(item || "").trim().replace(/[。．.、:：)）]/gu, ""));
    const isLabelOnlySet = normalizedOptions.length >= 2
      && normalizedOptions.every((item, index) => item === String.fromCharCode(65 + index));
    if (isLabelOnlySet) return "";
    return normalizedText.replace(/^\s*[A-F]\s*[。．.、:：)）-]\s*/u, "");
  }

  if (lastKey === "answer" && options.length) {
    const choiceOnly = String(normalizedText || "")
      .replace(/^\s*(?:答案|选项)(?:为|是)?\s*[:：]?\s*/u, "")
      .replace(/[。.]\s*$/u, "")
      .trim();
    if (/^[A-F](?:\s*[,，、]\s*[A-F])*$/u.test(choiceOnly)) return "";
  }
  return normalizedText;
}

function auditPlainText(text, subject = "", pathParts = [], material = {}) {
  const auditedText = normalizeChoiceAuditText(text, pathParts, material)
    .replace(/\bS\d+-\d+\b/gu, " ")
    // 学习节点和教学图形的稳定编号不是学科符号；V1 不能被化学审计误判为元素钒。
    .replace(/\b[DFGNKEPMRVSCX]\d+\b/gu, " ");
  const issues = [];
  if (/�|\?{3,}|(?:â|ã|æ|ç|é|ï|ð|þ){3,}/iu.test(auditedText)) issues.push("包含乱码或不可识别字符");
  if (/[²³⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉₊₋√∑∏∫∂∇∞≈≠≤≥±×÷∝∈∉⊂⊃∪∩]/u.test(auditedText)) {
    issues.push("公式外出现 Unicode 运算符或上下标，应改为 LaTeX");
  }
  if (/[\u0370-\u03FF]/u.test(auditedText)) issues.push("公式外出现希腊字母，应改为 LaTeX 命令");
  if (/\d\s*°\s*[NSEW东西南北]?/u.test(auditedText)) issues.push("角度或经纬度未使用 LaTeX");
  if (/(?:^|[\s，。；：、（(])(?:[A-Za-z]\w*|\d+(?:\.\d+)?)\s*(?:=|<=|>=|<|>)\s*(?:[A-Za-z0-9({]|[-+])/u.test(auditedText)) {
    issues.push("等式或不等式未放入公式定界符");
  }
  if (/(?:[A-Za-z0-9})\]])\s*\^\s*(?:[-+]?\d+|[{(])/u.test(auditedText)) issues.push("幂或电荷写法未使用 LaTeX");
  if (/\\(?:ce|frac|sqrt|sum|prod|int|vec|mathrm|text|times|div|pm|le|ge|ne|approx|circ|Delta|alpha|beta)\b/u.test(auditedText)) {
    issues.push("LaTeX 命令必须放入公式定界符");
  }
  if (/\b\d+(?:\.\d+)?\s*(?:m|cm|mm|km|s|h|kg|g|N|Pa|J|W|V|A|mol|L)(?:\s*[·/]\s*(?:m|s|h|kg|N|mol|L))?(?:\s*[-+]\s*\d+)?\b/u.test(auditedText)) {
    issues.push("物理量或单位表达未使用 LaTeX");
  }
  if (/\b\d+\s*\/\s*\d+\b/u.test(auditedText)) issues.push("分数未使用 LaTeX");
  if (/\b(?:sin|cos|tan|log|ln)\b\s*(?:\([^)]*\)|[A-Za-z0-9])/iu.test(auditedText) || /\b[A-Za-z]\s*\([A-Za-z]\)\s*=/u.test(auditedText)) {
    issues.push("函数表达未使用 LaTeX");
  }
  const isChemistry = /化学/u.test(subject);
  const isMathOrPhysics = /数学|物理/u.test(subject);
  const isBiology = /生物/u.test(subject);
  const isGeography = /地理/u.test(subject);
  const bareChemical = findBareChemicalFormula(auditedText, isChemistry);
  if (bareChemical) issues.push(`化学式“${bareChemical}”应使用 \\ce{...}`);
  if (isMathOrPhysics && /(?:^|[\s，。；：、（(])(?:[A-Za-z])(?=$|[\s，。；：、）),.=+\-*/])/u.test(auditedText)) {
    issues.push("数学或物理量符号未使用 LaTeX");
  }
  if (isChemistry && /\bpH\b/u.test(auditedText)) issues.push("化学量 pH 未使用 LaTeX");
  if (isBiology && /\b[A-Za-z]{1,2}\s*[xX]\s*[A-Za-z]{1,2}\b/u.test(auditedText)) {
    issues.push("遗传组合未使用 LaTeX");
  }
  if ((isBiology || isGeography) && /\b\d+\s*:\s*\d+(?:\s*:\s*\d+)*\b/u.test(auditedText)) {
    issues.push(isGeography ? "比例尺未使用 LaTeX" : "遗传比例未使用 LaTeX");
  }
  if (/数学|物理|化学|生物|地理/u.test(subject) && /\b\d+(?:\.\d+)?\s*%/u.test(auditedText)) {
    issues.push("百分数未使用 LaTeX");
  }
  if (/\${1,2}/u.test(auditedText) || /\\[()[\]]/u.test(auditedText)) issues.push("存在未闭合或不配对的公式定界符");
  return issues;
}

export function auditFormulaContentDetailed(material, { maxIssues = 12 } = {}) {
  const issues = [];
  const subject = String(material?.meta?.subject || material?.subject || "").trim();

  const addIssue = (pathParts, message) => {
    if (issues.length >= maxIssues) return;
    issues.push({
      path: pathLabel(pathParts) || "material",
      pathParts: [...pathParts],
      message
    });
  };

  function visit(value, pathParts) {
    if (issues.length >= maxIssues || shouldSkipAuditPath(pathParts)) return;
    if (typeof value === "string") {
      const segments = splitFormulaSegments(value);
      segments.filter((segment) => segment.type === "formula").forEach((formula) => {
        if (issues.length >= maxIssues) return;
        const result = validateLatex(formula.value, formula.display);
        if (!result.valid) addIssue(pathParts, `LaTeX 无法解析：${result.error}`);
      });
      const plainText = segments.filter((segment) => segment.type === "text").map((segment) => segment.value).join(" ");
      auditPlainText(plainText, subject, pathParts, material).forEach((issue) => {
        addIssue(pathParts, issue);
      });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...pathParts, index]));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, item]) => visit(item, [...pathParts, key]));
    }
  }

  visit(material, []);
  const grouped = new Map();
  issues.forEach((issue) => {
    const previous = grouped.get(issue.path);
    if (!previous) {
      grouped.set(issue.path, issue);
      return;
    }
    if (!previous.message.includes(issue.message)) previous.message = `${previous.message}；${issue.message}`;
  });
  return [...grouped.values()].slice(0, maxIssues);
}

export function auditFormulaContent(material, options = {}) {
  return auditFormulaContentDetailed(material, options)
    .map((issue) => `${issue.path}：${issue.message}`);
}

export function collectFormulaSegments(value) {
  const formulas = [];

  function visit(item, pathParts) {
    if (shouldSkipAuditPath(pathParts)) return;
    if (typeof item === "string") {
      splitFormulaSegments(item)
        .filter((segment) => segment.type === "formula")
        .forEach((segment) => formulas.push(segment));
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((entry, index) => visit(entry, [...pathParts, index]));
      return;
    }
    if (item && typeof item === "object") {
      Object.entries(item).forEach(([key, entry]) => visit(entry, [...pathParts, key]));
    }
  }

  visit(value, []);
  return formulas;
}

const katex = require('katex');
require('katex/contrib/mhchem');

const FORMULA_DELIMITERS = [
  { open: '$$', close: '$$', display: true },
  { open: '\\[', close: '\\]', display: true },
  { open: '\\(', close: '\\)', display: false },
  { open: '$', close: '$', display: false },
];

const SCIENTIFIC_SUBJECT_PATTERN = /数学|物理|化学|生物|地理/u;
const CHEMICAL_ELEMENTS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
  'Hf', 'Ta', 'W', 'Re', 'Pt', 'Au', 'Hg', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa',
  'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs',
  'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
]);

const GREEK_LATEX = new Map([
  ['Α', 'A'], ['Β', 'B'], ['Γ', '\\Gamma '], ['Δ', '\\Delta '], ['Ε', 'E'], ['Ζ', 'Z'], ['Η', 'H'], ['Θ', '\\Theta '],
  ['Ι', 'I'], ['Κ', 'K'], ['Λ', '\\Lambda '], ['Μ', 'M'], ['Ν', 'N'], ['Ξ', '\\Xi '], ['Ο', 'O'], ['Π', '\\Pi '],
  ['Ρ', 'P'], ['Σ', '\\Sigma '], ['Τ', 'T'], ['Υ', '\\Upsilon '], ['Φ', '\\Phi '], ['Χ', 'X'], ['Ψ', '\\Psi '], ['Ω', '\\Omega '],
  ['α', '\\alpha '], ['β', '\\beta '], ['γ', '\\gamma '], ['δ', '\\delta '], ['ε', '\\varepsilon '], ['ζ', '\\zeta '],
  ['η', '\\eta '], ['θ', '\\theta '], ['ι', '\\iota '], ['κ', '\\kappa '], ['λ', '\\lambda '], ['μ', '\\mu '],
  ['ν', '\\nu '], ['ξ', '\\xi '], ['ο', 'o'], ['π', '\\pi '], ['ρ', '\\rho '], ['σ', '\\sigma '], ['τ', '\\tau '],
  ['υ', '\\upsilon '], ['φ', '\\varphi '], ['χ', '\\chi '], ['ψ', '\\psi '], ['ω', '\\omega '],
]);

const SUPERSCRIPT_MAP = new Map([
  ['⁰', '0'], ['¹', '1'], ['²', '2'], ['³', '3'], ['⁴', '4'], ['⁵', '5'], ['⁶', '6'], ['⁷', '7'], ['⁸', '8'], ['⁹', '9'],
  ['⁺', '+'], ['⁻', '-'], ['ⁿ', 'n'],
]);
const SUBSCRIPT_MAP = new Map([
  ['₀', '0'], ['₁', '1'], ['₂', '2'], ['₃', '3'], ['₄', '4'], ['₅', '5'], ['₆', '6'], ['₇', '7'], ['₈', '8'], ['₉', '9'],
  ['₊', '+'], ['₋', '-'],
]);

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function isUsableDelimiter(text, index, delimiter, opening) {
  if (isEscaped(text, index)) return false;
  if (delimiter.open !== '$' || !opening) return true;
  return text[index - 1] !== '$' && text[index + 1] !== '$';
}

function findOpeningDelimiter(text, fromIndex) {
  let nearest = null;
  FORMULA_DELIMITERS.forEach((delimiter, order) => {
    let index = text.indexOf(delimiter.open, fromIndex);
    while (index >= 0 && !isUsableDelimiter(text, index, delimiter, true)) {
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
    const isSingleDollarPair = delimiter.close === '$' && (text[index - 1] === '$' || text[index + 1] === '$');
    if (!isEscaped(text, index) && !isSingleDollarPair) return index;
    index = text.indexOf(delimiter.close, index + delimiter.close.length);
  }
  return -1;
}

function pushTextSegment(segments, value) {
  if (!value) return;
  const previous = segments[segments.length - 1];
  if (previous && previous.type === 'text') previous.value += value;
  else segments.push({ type: 'text', value });
}

function splitFormulaSegments(value) {
  const text = String(value == null ? '' : value);
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
    const formula = text.slice(formulaStart, closingIndex).trim();
    if (formula) {
      segments.push({
        type: 'formula',
        value: formula,
        display: opening.display,
        source: text.slice(opening.index, closingIndex + opening.close.length),
      });
    } else {
      pushTextSegment(segments, text.slice(opening.index, closingIndex + opening.close.length));
    }
    cursor = closingIndex + opening.close.length;
  }
  return segments.length ? segments : [{ type: 'text', value: '' }];
}

function replaceMappedRuns(source, characterPattern, valueMap, marker) {
  return source.replace(characterPattern, (run) => {
    const converted = [...run].map((character) => valueMap.get(character) || character).join('');
    return `${marker}{${converted}}`;
  });
}

function normalizeLatex(latex) {
  let normalized = String(latex == null ? '' : latex)
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[−–—]/g, '-')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/≠/g, '\\ne ')
    .replace(/≈/g, '\\approx ')
    .replace(/±/g, '\\pm ')
    .replace(/∞/g, '\\infty ')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/·/g, '\\cdot ')
    .replace(/→/g, '\\rightarrow ')
    .replace(/←/g, '\\leftarrow ')
    .replace(/↔/g, '\\leftrightarrow ')
    .replace(/⇒/g, '\\Rightarrow ')
    .replace(/⇔/g, '\\Leftrightarrow ')
    .replace(/∑/g, '\\sum ')
    .replace(/∏/g, '\\prod ')
    .replace(/∫/g, '\\int ')
    .replace(/∂/g, '\\partial ')
    .replace(/∇/g, '\\nabla ')
    .replace(/∈/g, '\\in ')
    .replace(/∉/g, '\\notin ')
    .replace(/∝/g, '\\propto ')
    .replace(/<=/g, '\\le ')
    .replace(/>=/g, '\\ge ')
    .replace(/!=/g, '\\ne ')
    .replace(/sqrt\s*\(([^()]*)\)/giu, '\\sqrt{$1}')
    .replace(/([A-Za-z0-9})\]])\s*\*\s*([A-Za-z0-9({\\])/gu, '$1\\times $2');
  normalized = [...normalized].map((character) => GREEK_LATEX.get(character) || character).join('');
  normalized = replaceMappedRuns(normalized, /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ]+/gu, SUPERSCRIPT_MAP, '^');
  normalized = replaceMappedRuns(normalized, /[₀₁₂₃₄₅₆₇₈₉₊₋]+/gu, SUBSCRIPT_MAP, '_');
  return normalized
    .replace(/\\(?:geqslant|geq)\b/g, '\\ge')
    .replace(/\\(?:leqslant|leq)\b/g, '\\le')
    .replace(/\\neq\b/g, '\\ne')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function sanitizePlainSegment(value) {
  return String(value)
    .replace(/^\s*#{1,6}\s*/gmu, '')
    .replace(/\*\*|__/g, '')
    .replace(/```(?:json|latex|tex)?/giu, '')
    .replace(/```/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n');
}

function sanitizeAcademicText(value) {
  const source = String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
  return splitFormulaSegments(source).map((segment) => {
    if (segment.type === 'text') return sanitizePlainSegment(segment.value);
    const formula = normalizeLatex(segment.value);
    return segment.display ? `\\[${formula}\\]` : `\\(${formula}\\)`;
  }).join('').replace(/\n{3,}/g, '\n\n').trim();
}

function validateLatex(latex, display = false) {
  const source = normalizeLatex(latex);
  if (!source) return { valid: false, error: '公式内容为空' };
  try {
    katex.renderToString(source, {
      displayMode: Boolean(display),
      output: 'htmlAndMathml',
      strict(errorCode) {
        return errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'error';
      },
      throwOnError: true,
      trust: false,
    });
    return { valid: true, error: '' };
  } catch (error) {
    return {
      valid: false,
      error: String(error && error.message ? error.message : '无法解析公式').replace(/^KaTeX parse error:\s*/iu, ''),
    };
  }
}

function looksLikeChemicalFormula(candidate, allowSingleElement = false) {
  const source = candidate.replace(/(?:\d*[+-])$/u, '');
  const tokens = [...source.matchAll(/([A-Z][a-z]?)(\d*)/gu)];
  if (!tokens.length || tokens.map((match) => match[0]).join('') !== source) return false;
  return tokens.every((match) => CHEMICAL_ELEMENTS.has(match[1]))
    && (allowSingleElement || tokens.length >= 2 || /\d/u.test(candidate) || /[+-]$/u.test(candidate));
}

function findBareChemicalFormula(text, allowSingleElement = false) {
  const candidates = [...text.matchAll(/\b(?:[A-Z][a-z]?\d*){1,12}(?:\d*[+-])?\b/gu)];
  for (const match of candidates) {
    const candidate = match[0];
    if (!looksLikeChemicalFormula(candidate, allowSingleElement)) continue;
    if (allowSingleElement && candidate.length === 1) {
      const index = match.index || 0;
      const context = `${text.slice(Math.max(0, index - 14), index)}${text.slice(index + 1, index + 15)}`;
      if (!/(?:元素|原子|离子|化学式|反应物|生成物|酸|碱|盐|溶液|气体|沉淀|燃烧|配平|价态|电子层|摩尔|浓度)/u.test(context)) continue;
    }
    return candidate;
  }
  return '';
}

function auditFormulaSegment(formula, subject) {
  const issues = [];
  const validation = validateLatex(formula.value, formula.display);
  if (!validation.valid) issues.push(`LaTeX 无法解析：${validation.error}`);
  if (/化学/u.test(subject) && !/\\ce\s*\{/u.test(formula.value)) {
    const formulaWithoutCommands = formula.value.replace(/\\[A-Za-z]+/gu, ' ');
    const bareChemical = findBareChemicalFormula(formulaWithoutCommands, false);
    if (bareChemical) issues.push(`化学式“${bareChemical}”应使用 \\ce{...}`);
  }
  return issues;
}

function auditPlainText(text, subject) {
  const issues = [];
  if (/�|\?{3,}|(?:â|ã|æ|ç|é|ï|ð|þ){3,}/iu.test(text)) issues.push('包含乱码或不可识别字符');
  if (/\${1,2}|\\[()[\]]/u.test(text)) issues.push('存在未闭合或不配对的公式定界符');
  if (/[²³⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉₊₋√∑∏∫∂∇∞≈≠≤≥±×÷∝∈∉⊂⊃∪∩→←↔⇒⇔∧∨¬∀∃⊥∥∠⊙℃]/u.test(text)) {
    issues.push('公式外出现 Unicode 学科符号，应改为 LaTeX');
  }
  if (/[\u0370-\u03FF]/u.test(text)) issues.push('公式外出现希腊字母，应改为 LaTeX 命令');
  if (/\d\s*°\s*[NSEW东西南北]?/u.test(text)) issues.push('角度或经纬度未使用 LaTeX');
  if (/\\[A-Za-z]+\b/u.test(text)) {
    issues.push('LaTeX 命令必须放入公式定界符');
  }
  if (/(?:^|[\s，。；：、（(])(?:[A-Za-z]\w*|\d+(?:\.\d+)?)\s*(?:=|<=|>=|<|>)\s*(?:[A-Za-z0-9({]|[-+])/u.test(text)) {
    issues.push('等式或不等式未放入公式定界符');
  }
  if (/(?:[A-Za-z0-9})\]])\s*\^\s*(?:[-+]?\d+|[{(])/u.test(text)) issues.push('幂或电荷写法未使用 LaTeX');
  if (/(?:[A-Za-z0-9})\]])\s*_\s*(?:[A-Za-z0-9{(])/u.test(text)) issues.push('下标写法未使用 LaTeX');
  if (SCIENTIFIC_SUBJECT_PATTERN.test(subject) && /\bsqrt\s*\(?\s*[A-Za-z0-9]/iu.test(text)) issues.push('根式未使用 LaTeX');
  if (SCIENTIFIC_SUBJECT_PATTERN.test(subject) && /(?:[A-Za-z0-9})\]])\s*[*\/]\s*(?:[A-Za-z0-9({\[])/u.test(text)) issues.push('乘除表达未使用 LaTeX');
  if (/\b\d+\s*\/\s*\d+\b/u.test(text)) issues.push('分数未使用 LaTeX');
  if (/\b(?:sin|cos|tan|log|ln)\b\s*(?:\([^)]*\)|[A-Za-z0-9])/iu.test(text)) issues.push('函数表达未使用 LaTeX');
  if (/\b\d+(?:\.\d+)?\s*(?:m|cm|mm|km|s|h|kg|g|N|Pa|J|W|V|A|mol|L)(?:\s*[·/]\s*(?:m|s|h|kg|N|mol|L))?(?:\s*[-+]\s*\d+)?\b/u.test(text)) {
    issues.push('物理量或单位表达未使用 LaTeX');
  }

  const isChemistry = /化学/u.test(subject);
  const isMathOrPhysics = /数学|物理/u.test(subject);
  const isBiology = /生物/u.test(subject);
  const isGeography = /地理/u.test(subject);
  const bareChemical = findBareChemicalFormula(text, isChemistry);
  if (bareChemical) issues.push(`化学式“${bareChemical}”应使用 \\ce{...}`);
  if (isMathOrPhysics && /(?:^|[\s，。；：、（(])(?:[A-Za-z])(?=$|[\s，。；：、）),.=+\-*/])/u.test(text)) {
    issues.push('数学或物理量符号未使用 LaTeX');
  }
  if (/数学/u.test(subject) && /\b[A-Za-z]\s*\([^)]{1,30}\)/u.test(text)) issues.push('函数或坐标表达未使用 LaTeX');
  if (/数学|物理/u.test(subject) && /\|\s*[A-Za-z0-9]+\s*\|/u.test(text)) issues.push('绝对值或模长未使用 LaTeX');
  if (isChemistry && /\bpH\b/u.test(text)) issues.push('化学量 pH 未使用 LaTeX');
  if (isBiology && /\b[A-Za-z]{1,2}\s*[xX]\s*[A-Za-z]{1,2}\b/u.test(text)) issues.push('遗传组合未使用 LaTeX');
  if ((isBiology || isGeography) && /\b\d+\s*:\s*\d+(?:\s*:\s*\d+)*\b/u.test(text)) {
    issues.push(isGeography ? '比例尺未使用 LaTeX' : '遗传比例未使用 LaTeX');
  }
  if (SCIENTIFIC_SUBJECT_PATTERN.test(subject) && /\b\d+(?:\.\d+)?\s*%/u.test(text)) issues.push('百分数未使用 LaTeX');
  return [...new Set(issues)];
}

function auditAcademicText(value, subject) {
  const normalized = sanitizeAcademicText(value);
  const issues = [];
  const plainText = [];
  for (const segment of splitFormulaSegments(normalized)) {
    if (segment.type === 'formula') issues.push(...auditFormulaSegment(segment, subject));
    else plainText.push(segment.value);
  }
  issues.push(...auditPlainText(plainText.join(' '), subject));
  return { text: normalized, issues: [...new Set(issues)] };
}

module.exports = {
  auditAcademicText,
  auditPlainText,
  normalizeLatex,
  sanitizeAcademicText,
  splitFormulaSegments,
  validateLatex,
};

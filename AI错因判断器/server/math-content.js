const katex = require('katex');
require('katex/contrib/mhchem');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { STATE } = require('mathjax-full/js/core/MathItem.js');
const { SerializedMmlVisitor } = require('mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

const MATH_DELIMITERS = [
  { open: '$$', close: '$$', display: true },
  { open: '\\[', close: '\\]', display: true },
  { open: '\\(', close: '\\)', display: false },
  { open: '$', close: '$', display: false },
];

const mathJaxAdaptor = liteAdaptor();
RegisterHTMLHandler(mathJaxAdaptor);
const mathJaxDocument = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: 'none' }),
});
const mathMlVisitor = new SerializedMmlVisitor();

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function findNextDelimiter(text, startIndex) {
  let best = null;
  for (const delimiter of MATH_DELIMITERS) {
    let index = text.indexOf(delimiter.open, startIndex);
    while (index >= 0 && isEscaped(text, index)) index = text.indexOf(delimiter.open, index + delimiter.open.length);
    if (index < 0) continue;
    if (!best || index < best.index || (index === best.index && delimiter.open.length > best.delimiter.open.length)) {
      best = { index, delimiter };
    }
  }
  return best;
}

function findClosingDelimiter(text, delimiter, startIndex) {
  let index = text.indexOf(delimiter.close, startIndex);
  while (index >= 0 && isEscaped(text, index)) index = text.indexOf(delimiter.close, index + delimiter.close.length);
  return index;
}

function splitMathSegments(input) {
  const text = String(input ?? '');
  const segments = [];
  let cursor = 0;

  while (cursor < text.length) {
    const next = findNextDelimiter(text, cursor);
    if (!next) {
      segments.push({ type: 'text', value: text.slice(cursor) });
      break;
    }

    if (next.index > cursor) segments.push({ type: 'text', value: text.slice(cursor, next.index) });
    const contentStart = next.index + next.delimiter.open.length;
    const closeIndex = findClosingDelimiter(text, next.delimiter, contentStart);
    if (closeIndex < 0) {
      segments.push({ type: 'text', value: text.slice(next.index) });
      break;
    }

    segments.push({
      type: 'math',
      value: text.slice(contentStart, closeIndex).trim(),
      display: next.delimiter.display,
    });
    cursor = closeIndex + next.delimiter.close.length;
  }

  return segments.length ? segments : [{ type: 'text', value: '' }];
}

function readBalancedGroup(text, startIndex, openCharacter, closeCharacter) {
  if (text[startIndex] !== openCharacter) return null;
  let depth = 0;
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === openCharacter && !isEscaped(text, index)) depth += 1;
    if (text[index] === closeCharacter && !isEscaped(text, index)) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

function consumeLatexCommand(text, startIndex) {
  const commandMatch = text.slice(startIndex).match(/^\\[A-Za-z]+/);
  if (!commandMatch) return null;
  let cursor = startIndex + commandMatch[0].length;
  let probe = cursor;
  while (probe < text.length && /\s/.test(text[probe])) probe += 1;

  if (text[probe] === '[') {
    const optionalEnd = readBalancedGroup(text, probe, '[', ']');
    if (optionalEnd) cursor = optionalEnd;
  }

  let groupCount = 0;
  while (groupCount < 3) {
    probe = cursor;
    while (probe < text.length && /\s/.test(text[probe])) probe += 1;
    if (text[probe] !== '{') break;
    const groupEnd = readBalancedGroup(text, probe, '{', '}');
    if (!groupEnd) break;
    cursor = groupEnd;
    groupCount += 1;
  }

  return { value: text.slice(startIndex, cursor), endIndex: cursor };
}

function wrapBareLatexCommands(text) {
  let result = '';
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === '\\' && /[A-Za-z]/.test(text[cursor + 1] || '')) {
      const command = consumeLatexCommand(text, cursor);
      if (command) {
        result += `\\(${command.value}\\)`;
        cursor = command.endIndex;
        continue;
      }
    }
    result += text[cursor];
    cursor += 1;
  }
  return result;
}

function wrapBareAsciiFormulas(text) {
  return text.replace(
    /(^|[\s，。；：:（(])([A-Za-z][A-Za-z0-9_]*(?:\^\{?[-+A-Za-z0-9]+\}?)?\s*=\s*[A-Za-z0-9_{}^+\-*/().\[\]\\\s]{1,48})(?=$|[，。；：:）)\s])/g,
    (match, prefix, formula) => `${prefix}\\(${formula.trim()}\\)`,
  );
}

function normalizePlainText(text) {
  const placeholders = [];
  const wrappedCommands = wrapBareLatexCommands(text).replace(/\\\([\s\S]*?\\\)/g, (formula) => {
    const placeholder = `\u0001FORMULA_${placeholders.length}\u0002`;
    placeholders.push(formula);
    return placeholder;
  });
  const withAsciiFormulas = wrapBareAsciiFormulas(wrappedCommands);
  return withAsciiFormulas.replace(/\u0001FORMULA_(\d+)\u0002/g, (match, index) => placeholders[Number(index)]);
}

function normalizeMathText(input) {
  return splitMathSegments(input).map((segment) => {
    if (segment.type === 'text') return normalizePlainText(segment.value);
    return segment.display ? `\\[${segment.value}\\]` : `\\(${segment.value}\\)`;
  }).join('');
}

function mapStrings(value, mapper, path = []) {
  if (typeof value === 'string') return mapper(value, path);
  if (Array.isArray(value)) return value.map((item, index) => mapStrings(item, mapper, [...path, index]));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, mapper, [...path, key])]));
  }
  return value;
}

function normalizeReportMath(report) {
  return mapStrings(report, (text, path) => {
    if (path[path.length - 1] === 'generatedAt') return text;
    return normalizeMathText(text);
  });
}

function renderLatexToHtml(latex, displayMode = false) {
  return katex.renderToString(latex, {
    displayMode,
    throwOnError: true,
    strict: 'error',
    trust: false,
    output: 'htmlAndMathml',
  });
}

function renderLatexToMathMl(latex, displayMode = false) {
  renderLatexToHtml(latex, displayMode);
  const root = mathJaxDocument.convert(latex, { display: displayMode, end: STATE.CONVERT });
  const mathMl = mathMlVisitor.visitTree(root);
  if (/<merror\b|data-mjx-error/i.test(mathMl)) {
    throw new Error(`公式无法转换为 MathML：${latex}`);
  }
  return mathMl;
}

function validateReportMath(report) {
  const errors = [];
  mapStrings(report, (text, path) => {
    if (path[path.length - 1] === 'generatedAt') return text;
    for (const segment of splitMathSegments(normalizeMathText(text))) {
      if (segment.type !== 'math' || !segment.value) continue;
      try {
        renderLatexToHtml(segment.value, segment.display);
      } catch (error) {
        errors.push({
          path: path.join('.'),
          formula: segment.value,
          message: error.message,
        });
      }
    }
    return text;
  });
  return errors;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRichTextToHtml(input) {
  return splitMathSegments(normalizeMathText(input)).map((segment) => {
    if (segment.type === 'text') return escapeHtml(segment.value).replace(/\r?\n/g, '<br>');
    const formulaHtml = renderLatexToHtml(segment.value, segment.display);
    return segment.display
      ? `<div class="formula formula-display">${formulaHtml}</div>`
      : `<span class="formula formula-inline">${formulaHtml}</span>`;
  }).join('');
}

module.exports = {
  escapeHtml,
  normalizeMathText,
  normalizeReportMath,
  renderLatexToHtml,
  renderLatexToMathMl,
  renderRichTextToHtml,
  splitMathSegments,
  validateReportMath,
};

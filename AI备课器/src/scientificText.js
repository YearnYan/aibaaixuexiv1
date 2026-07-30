const DELIMITERS = [
  { left: '$$', right: '$$', display: true, multiline: true },
  { left: '\\[', right: '\\]', display: true, multiline: true },
  { left: '\\(', right: '\\)', display: false, multiline: false },
  { left: '$', right: '$', display: false, multiline: false }
];

const SVG_ELEMENTS = new Map([
  ['svg', 'svg'], ['g', 'g'], ['path', 'path'], ['rect', 'rect'], ['circle', 'circle'],
  ['ellipse', 'ellipse'], ['line', 'line'], ['polyline', 'polyline'], ['polygon', 'polygon'],
  ['text', 'text'], ['tspan', 'tspan'], ['defs', 'defs'], ['clippath', 'clipPath'],
  ['mask', 'mask'], ['lineargradient', 'linearGradient'], ['radialgradient', 'radialGradient'],
  ['stop', 'stop'], ['pattern', 'pattern'], ['marker', 'marker'], ['symbol', 'symbol'], ['use', 'use'],
  ['title', 'title'], ['desc', 'desc']
]);

const SVG_ATTRIBUTES = new Set([
  'xmlns', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy',
  'r', 'rx', 'ry', 'd', 'points', 'fill', 'fill-opacity', 'fill-rule', 'stroke',
  'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'opacity', 'transform', 'font-size', 'font-family', 'font-weight',
  'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'id', 'class', 'href',
  'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end', 'offset', 'stop-color',
  'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod', 'patternunits',
  'patterncontentunits', 'patterntransform', 'preserveaspectratio', 'role', 'aria-label',
  'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'markerunits',
  'fx', 'fy', 'fr', 'clippathunits', 'maskunits', 'maskcontentunits', 'vector-effect',
  'stroke-miterlimit', 'shape-rendering', 'paint-order', 'color', 'overflow', 'visibility'
]);

const GRAPHIC_SVG_ELEMENTS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use']);
const URL_SVG_ATTRIBUTES = new Set(['fill', 'stroke', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end']);
const CHEMICAL_ELEMENTS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
  'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra',
  'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr', 'Rf', 'Db',
  'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og'
]);

function normalizeSourceText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/⟹/g, '⇒')
    .replace(/(?:⇒[ \t]*\n?[ \t]*){2,}/g, '⇒ ');
}

function balanceCurlyBraces(value) {
  let depth = 0;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}' && depth > 0) depth -= 1;
  }
  return depth > 0 ? `${value}${'}'.repeat(depth)}` : value;
}

export function normalizeLatexMath(value) {
  const normalized = normalizeSourceText(value)
    // 模型偶尔会把中文下标误写成不存在的 LaTeX 命令，统一转为可渲染文本。
    .replace(/\\([\p{Script=Han}]+)/gu, '\\text{$1}')
    .replace(/\\(?:implies|Longrightarrow)\b/g, '\\Rightarrow')
    .replace(/\\iff\b/g, '\\Leftrightarrow')
    .replace(/\\(?:gets|longleftarrow)\b/g, '\\leftarrow')
    .replace(/\\longrightarrow\b/g, '\\rightarrow')
    .replace(/⇒/g, '\\Rightarrow ')
    .replace(/⇔/g, '\\Leftrightarrow ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return balanceCurlyBraces(normalized);
}

function findUnescaped(text, token, start, limit = text.length) {
  let index = text.indexOf(token, start);
  while (index !== -1 && index < limit) {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1;
    if (slashCount % 2 === 0) return index;
    index = text.indexOf(token, index + token.length);
  }
  return -1;
}

function findNextDelimiter(text, start) {
  let match = null;
  for (const delimiter of DELIMITERS) {
    const index = findUnescaped(text, delimiter.left, start);
    if (index !== -1 && (!match || index < match.index || (index === match.index && delimiter.left.length > match.delimiter.left.length))) {
      match = { index, delimiter };
    }
  }
  return match;
}

function findRecoveredMathEnd(text, contentStart, delimiter) {
  const lineEnd = text.indexOf('\n', contentStart);
  const inlineLimit = !delimiter.multiline && lineEnd !== -1 ? lineEnd : text.length;
  const normalEnd = findUnescaped(text, delimiter.right, contentStart, inlineLimit + delimiter.right.length);
  if (normalEnd !== -1 && normalEnd <= inlineLimit) return { end: normalEnd, closed: true };

  if (!delimiter.multiline) return { end: lineEnd === -1 ? text.length : lineEnd, closed: false };
  const paragraphEnd = text.indexOf('\n\n', contentStart);
  return { end: paragraphEnd === -1 ? text.length : paragraphEnd, closed: false };
}

function isMathStart(character) {
  return /[A-Za-z0-9Α-Ωα-ω\\([{√∑∫∞∂∇⇒⇔→←]/u.test(character || '');
}

function readBalanced(text, start, open, close) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

function readBareMathCandidate(text, start) {
  let index = start;
  while (index < text.length) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
      while (index < text.length && /[A-Za-z\p{Script=Han}]/u.test(text[index])) index += 1;
      while (index < text.length && (text[index] === '{' || text[index] === '[')) {
        const open = text[index];
        index = readBalanced(text, index, open, open === '{' ? '}' : ']');
      }
      continue;
    }
    if (character === '{') {
      index = readBalanced(text, index, '{', '}');
      continue;
    }
    if (/[A-Za-z0-9Α-Ωα-ω\s()[\].,+\-*/^_=<>≤≥≠≈∝×÷·°%|:;√∑∏∫∞∂∇⇒⇔→←↔]/u.test(character)) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function trimBareMathCandidate(value) {
  const trailingMatch = value.match(/[\s,;:]+$/);
  const trailing = trailingMatch?.[0] || '';
  let body = trailing ? value.slice(0, -trailing.length) : value;
  const anchor = body.search(/\\[A-Za-z\p{Script=Han}]+|[_^=<>≤≥≠≈∝×÷⇒⇔→←↔]/u);
  let leading = '';
  if (anchor > 0) {
    const prefix = body.slice(0, anchor);
    const operand = prefix.match(/[A-Za-zΑ-Ωα-ω0-9)\]}]+\s*$/u);
    if (operand && /\s/.test(prefix.slice(0, operand.index))) {
      leading = body.slice(0, operand.index);
      body = body.slice(operand.index);
    }
  }
  return { leading, body: body.trim(), trailing };
}

function isLikelyBareMath(value) {
  const text = value.trim();
  if (!text) return false;
  if (/\\(?:[A-Za-z]+|[\p{Script=Han}]+)/u.test(text)) return true;
  if (/[A-Za-zΑ-Ωα-ω0-9)}\]]\s*[_^]\s*(?:\{|[A-Za-zΑ-Ωα-ω0-9])/u.test(text)) return true;
  if (/(?:[A-Za-zΑ-Ωα-ω0-9)}\]])\s*(?:=|<|>|≤|≥|≠|≈|∝|⇒|⇔|→|←|↔|×|÷)\s*(?:[A-Za-zΑ-Ωα-ω0-9({\[√∑∫∞])/u.test(text)) return true;
  if (/^(?:⇒|⇔|→|←|↔)$/.test(text)) return true;
  if (/\d+(?:\.\d+)?\s*(?:°|%|[a-zA-Z]+\/?[a-zA-Z]*)\b/u.test(text)) return true;
  const chemicalParts = text.split(/\s*(?:\+|->|→|⇌|=)\s*/).filter(Boolean);
  if (!chemicalParts.length) return false;
  let totalElements = 0;
  const validChemical = chemicalParts.every((part) => {
    const normalized = part
      .replace(/^\d+/, '')
      .replace(/\((?:aq|s|l|g)\)$/i, '')
      .replace(/[()\[\]{}^+\-\d]/g, '');
    if (!normalized || /[^A-Za-z]/.test(normalized)) return false;
    const symbols = normalized.match(/[A-Z][a-z]?/g) || [];
    if (symbols.join('') !== normalized || symbols.some((symbol) => !CHEMICAL_ELEMENTS.has(symbol))) return false;
    totalElements += symbols.length;
    return true;
  });
  return validChemical && (chemicalParts.length > 1 || totalElements > 1 || /\d/.test(text));
}

function mergeSegments(segments) {
  const merged = [];
  for (const segment of segments.filter((item) => item && (item.type !== 'text' || item.value !== ''))) {
    if (segment.type === 'text' && merged.at(-1)?.type === 'text') merged.at(-1).value += segment.value;
    else merged.push(segment);
  }
  return merged.length ? merged : [{ type: 'text', value: '' }];
}

function splitBareMathText(value) {
  const text = String(value || '');
  const segments = [];
  let textStart = 0;
  let cursor = 0;
  while (cursor < text.length) {
    if (!isMathStart(text[cursor])) {
      cursor += 1;
      continue;
    }
    const end = readBareMathCandidate(text, cursor);
    const candidate = text.slice(cursor, end);
    const { leading, body, trailing } = trimBareMathCandidate(candidate);
    const bodyStart = cursor + leading.length;
    if (isLikelyBareMath(body)) {
      if (bodyStart > textStart) segments.push({ type: 'text', value: text.slice(textStart, bodyStart) });
      segments.push({ type: 'math', value: normalizeLatexMath(body), display: false, recovered: true });
      if (trailing) segments.push({ type: 'text', value: trailing });
      cursor = end;
      textStart = end;
    } else {
      cursor = Math.max(cursor + 1, end);
    }
  }
  if (textStart < text.length) segments.push({ type: 'text', value: text.slice(textStart) });
  return mergeSegments(segments);
}

export function splitScientificText(value) {
  const text = normalizeSourceText(value);
  const segments = [];
  let cursor = 0;
  while (cursor < text.length) {
    const match = findNextDelimiter(text, cursor);
    if (!match) {
      segments.push(...splitBareMathText(text.slice(cursor)));
      break;
    }
    if (match.index > cursor) segments.push(...splitBareMathText(text.slice(cursor, match.index)));
    const contentStart = match.index + match.delimiter.left.length;
    const { end, closed } = findRecoveredMathEnd(text, contentStart, match.delimiter);
    const recoveredSource = text.slice(contentStart, end);
    const recoveredBoundary = !closed && !match.delimiter.multiline ? readBareMathCandidate(recoveredSource, 0) : recoveredSource.length;
    const formulaSource = recoveredSource.slice(0, recoveredBoundary);
    const formula = normalizeLatexMath(formulaSource);
    if (!formula) {
      segments.push({ type: 'text', value: match.delimiter.left });
      cursor = contentStart;
      continue;
    }
    segments.push({ type: 'math', value: formula, display: match.delimiter.display, recovered: !closed });
    if (recoveredBoundary < recoveredSource.length) segments.push(...splitBareMathText(recoveredSource.slice(recoveredBoundary)));
    cursor = closed ? end + match.delimiter.right.length : end;
  }
  return mergeSegments(segments);
}

function decodeSvgEntities(value) {
  return String(value || '')
    .replace(/&lt;|&#0*60;|&#x0*3c;/gi, '<')
    .replace(/&gt;|&#0*62;|&#x0*3e;/gi, '>')
    .replace(/&quot;|&#0*34;|&#x0*22;/gi, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function normalizeSvgSourceSyntax(value) {
  let source = String(value || '');
  // 兼容模型二次序列化后遗留的 Unicode/十六进制尖括号。
  source = source
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\x3c/gi, '<')
    .replace(/\\x3e/gi, '>');
  // 只在明确出现全角 SVG 根标签时替换全角尖括号，避免影响普通正文。
  if (/＜\s*\/?\s*svg\b/i.test(source)) source = source.replace(/＜/g, '<').replace(/＞/g, '>');
  return source
    .replace(/<\s*svg\b/gi, '<svg')
    .replace(/<\s*\/\s*svg\s*>/gi, '</svg>');
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isSafeSvgAttribute(name, value) {
  const lowerName = name.toLowerCase();
  const normalized = String(value || '').trim();
  if (!SVG_ATTRIBUTES.has(lowerName) || lowerName.startsWith('on')) return false;
  if (/javascript:|vbscript:|data:text\/html/i.test(normalized)) return false;
  if (lowerName === 'href') return /^#[A-Za-z_][\w:.-]*$/.test(normalized);
  if (URL_SVG_ATTRIBUTES.has(lowerName) && /url\s*\(/i.test(normalized)) return /^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/i.test(normalized);
  if (lowerName === 'xmlns') return normalized === 'http://www.w3.org/2000/svg';
  return !/https?:|\/\//i.test(normalized);
}

function sanitizeTagAttributes(attributes, isRoot) {
  const kept = [];
  const attributePattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = attributePattern.exec(attributes))) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (!isSafeSvgAttribute(name, value)) continue;
    const canonicalName = name.toLowerCase() === 'viewbox' ? 'viewBox'
      : name.toLowerCase() === 'preserveaspectratio' ? 'preserveAspectRatio'
        : name.toLowerCase() === 'gradientunits' ? 'gradientUnits'
          : name.toLowerCase() === 'gradienttransform' ? 'gradientTransform'
            : name.toLowerCase() === 'patternunits' ? 'patternUnits'
              : name.toLowerCase() === 'patterncontentunits' ? 'patternContentUnits'
                : name.toLowerCase() === 'patterntransform' ? 'patternTransform'
                  : name;
    kept.push(`${canonicalName}="${escapeAttribute(value)}"`);
  }
  if (isRoot && !kept.some((item) => item.startsWith('xmlns='))) kept.push('xmlns="http://www.w3.org/2000/svg"');
  if (isRoot && !kept.some((item) => item.startsWith('role='))) kept.push('role="img"');
  if (isRoot && !kept.some((item) => item.startsWith('preserveAspectRatio='))) kept.push('preserveAspectRatio="xMidYMid meet"');
  return kept.length ? ` ${kept.join(' ')}` : '';
}

export function sanitizeSvgMarkup(value) {
  let source = normalizeSvgSourceSyntax(decodeSvgEntities(value))
    .replace(/```(?:svg|xml)?/gi, '')
    .replace(/```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?(?:xml)[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<(script|foreignObject|iframe|object|embed|style|image|animate\w*)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|foreignObject|iframe|object|embed|style|image|animate\w*)\b[^>]*\/?\s*>/gi, '')
    .trim();
  // 模型响应被截断时最常见的是只缺少根闭合标签；补齐后仍需经过完整白名单净化。
  if (/<svg\b/i.test(source) && !/<\/svg\s*>/i.test(source)) source = `${source}</svg>`;
  const rootMatch = source.match(/<svg\b[\s\S]*?<\/svg\s*>/i);
  if (!rootMatch) return '';
  source = rootMatch[0];
  let graphicCount = 0;
  const sanitized = source.replace(/<\/?([A-Za-z][\w:-]*)([^>]*)>/g, (tag, rawName, attributes) => {
    const lowerName = rawName.toLowerCase();
    const canonicalName = SVG_ELEMENTS.get(lowerName);
    if (!canonicalName) return '';
    if (GRAPHIC_SVG_ELEMENTS.has(lowerName) && !tag.startsWith('</')) graphicCount += 1;
    if (tag.startsWith('</')) return `</${canonicalName}>`;
    const selfClosing = /\/\s*>$/.test(tag);
    return `<${canonicalName}${sanitizeTagAttributes(attributes, lowerName === 'svg')}${selfClosing ? ' /' : ''}>`;
  });
  if (!graphicCount || !/^<svg\b/i.test(sanitized) || !/<\/svg>$/i.test(sanitized)) return '';
  return sanitized;
}

export function svgToAccessibleText(value) {
  const source = decodeSvgEntities(value);
  const description = source.match(/<(?:title|desc)\b[^>]*>([\s\S]*?)<\/(?:title|desc)>/i)?.[1]
    ?.replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return description ? `【图示：${description}】` : '【SVG 图示，请在网页结果页查看】';
}

function prepareSvgSource(value) {
  return normalizeSvgSourceSyntax(decodeSvgEntities(normalizeSourceText(value)))
    .replace(/```(?:svg|xml)?\s*(<svg\b[\s\S]*?<\/svg\s*>)\s*```/gi, '$1')
    .replace(/```\s*(<svg\b[\s\S]*?<\/svg\s*>)\s*```/gi, '$1');
}

export function splitRichContent(value) {
  const text = prepareSvgSource(value);
  const segments = [];
  const svgStartPattern = /<svg\b/gi;
  let cursor = 0;
  let match;
  while ((match = svgStartPattern.exec(text))) {
    if (match.index > cursor) segments.push(...splitScientificText(text.slice(cursor, match.index)));
    const closingPattern = /<\/svg\s*>/gi;
    closingPattern.lastIndex = match.index + match[0].length;
    const closingMatch = closingPattern.exec(text);
    const candidateEnd = closingMatch ? closingMatch.index + closingMatch[0].length : text.length;
    const candidate = text.slice(match.index, candidateEnd);
    const safeSvg = sanitizeSvgMarkup(candidate);
    segments.push(safeSvg
      ? { type: 'svg', value: safeSvg, description: svgToAccessibleText(candidate) }
      : { type: 'text', value: '（SVG 图形无法安全显示）' });
    cursor = candidateEnd;
    svgStartPattern.lastIndex = cursor;
  }
  if (cursor < text.length) segments.push(...splitScientificText(text.slice(cursor)));
  return mergeSegments(segments);
}

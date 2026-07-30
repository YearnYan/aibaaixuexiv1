const SVG_GEOMETRY_ELEMENTS = new Set([
  'path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect'
]);

const FORBIDDEN_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'style', 'a',
  'audio', 'video', 'canvas', 'animate', 'animatemotion', 'animatetransform', 'set'
]);

const XML_PREDEFINED_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const INVALID_VISIBLE_NOTATION_PATTERN = /LATEXSLASH|@@BS@@|\[\[\s*\/?\s*LATEX\s*\]\]|\\(?:frac|sqrt|ce|mathrm|text|begin|end|vec|overline|underline|times|div|leq|geq|neq|approx|sum|int|prod|circ)\b|\\[()[\]]|\$\$?/i;
const VALID_PATH_DATA_PATTERN = /^[\sMmZzLlHhVvCcSsQqTtAa0-9.,+\-Ee]+$/;
const PATH_COMMAND_PARAMETER_COUNTS = Object.freeze({
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0
});
const NON_RENDERING_CONTAINERS = new Set([
  'defs', 'clippath', 'mask', 'marker', 'pattern', 'symbol', 'metadata', 'title', 'desc'
]);

const FIGURE_SVG_FAILURES = Object.freeze({
  EMPTY_RESPONSE: 'AI 返回了空内容',
  MISSING_SVG: 'AI 返回内容中没有 SVG 根节点',
  TRUNCATED_SVG: 'AI 返回的 SVG 未完整闭合',
  XML_MALFORMED: 'SVG 不是结构完整的 XML',
  XML_INVALID_ENTITY: 'SVG 使用了 XML 不支持的命名实体或字符引用',
  DANGEROUS_ELEMENT: 'SVG 包含不允许的元素',
  DANGEROUS_ATTRIBUTE: 'SVG 包含事件属性或不安全样式',
  EXTERNAL_RESOURCE: 'SVG 引用了外部或嵌入资源',
  INVALID_NAMESPACE: 'SVG 命名空间无效',
  INVALID_VIEWBOX: 'SVG viewBox 无效',
  INVALID_VISIBLE_NOTATION: 'SVG 可见文字包含公式源码或内部传输标记',
  INVALID_PATH_DATA: 'SVG path 路径数据无效',
  NO_GEOMETRY: 'SVG 没有真实几何图元'
});

function extractSvgCandidate(content) {
  const source = String(content || '').trim();
  if (!source) {
    return failure('EMPTY_RESPONSE', { responseLength: 0, completeSvg: false, svg: '' });
  }

  const openMatch = /<svg\b/i.exec(source);
  if (!openMatch) {
    return failure('MISSING_SVG', {
      responseLength: source.length,
      completeSvg: false,
      svg: ''
    });
  }

  const tail = source.slice(openMatch.index);
  const closeMatch = /<\/svg\s*>/i.exec(tail);
  if (!closeMatch) {
    return failure('TRUNCATED_SVG', {
      responseLength: source.length,
      completeSvg: false,
      svg: tail
    });
  }

  const endIndex = closeMatch.index + closeMatch[0].length;
  return {
    ok: true,
    code: null,
    message: '',
    responseLength: source.length,
    completeSvg: true,
    svg: tail.slice(0, endIndex)
  };
}

function analyzeGeneratedFigure(content, metadata = {}) {
  const extracted = extractSvgCandidate(content);
  const finishReason = normalizeFinishReason(metadata.finishReason);
  if (!extracted.ok) {
    const code = finishReason === 'length' && extracted.code === 'MISSING_SVG'
      ? 'TRUNCATED_SVG'
      : extracted.code;
    return failure(code, {
      ...extracted,
      finishReason
    });
  }

  return {
    ...analyzeFigureSvg(extracted.svg),
    responseLength: extracted.responseLength,
    completeSvg: true,
    finishReason,
    svg: extracted.svg
  };
}

function analyzeFigureSvg(svg) {
  const source = String(svg || '').trim();
  if (!source) return failure('EMPTY_RESPONSE', { svg: '', completeSvg: false });
  if (INVALID_VISIBLE_NOTATION_PATTERN.test(source)) {
    return failure('INVALID_VISIBLE_NOTATION', { svg: source, completeSvg: /<\/svg\s*>\s*$/i.test(source) });
  }
  if (/&(?:lt|gt);/i.test(source)) {
    return failure('XML_INVALID_ENTITY', { svg: source, completeSvg: /<\/svg\s*>\s*$/i.test(source) });
  }

  const parsed = parseXmlStructure(source);
  if (!parsed.ok) return { ...parsed, svg: source, completeSvg: /<\/svg\s*>\s*$/i.test(source) };

  if (parsed.rootName !== 'svg') return failure('XML_MALFORMED', { svg: source, completeSvg: true });
  if (parsed.namespace && parsed.namespace !== 'http://www.w3.org/2000/svg') {
    return failure('INVALID_NAMESPACE', { svg: source, completeSvg: true });
  }
  if (parsed.usesXlink && parsed.xlinkNamespace !== 'http://www.w3.org/1999/xlink') {
    return failure('INVALID_NAMESPACE', { svg: source, completeSvg: true });
  }
  if (parsed.viewBox && !isValidViewBox(parsed.viewBox)) {
    return failure('INVALID_VIEWBOX', { svg: source, completeSvg: true });
  }
  if (INVALID_VISIBLE_NOTATION_PATTERN.test(parsed.visibleText)) {
    return failure('INVALID_VISIBLE_NOTATION', { svg: source, completeSvg: true });
  }
  if (parsed.geometryCount === 0) {
    return failure('NO_GEOMETRY', { svg: source, completeSvg: true });
  }

  return {
    ok: true,
    code: null,
    message: '',
    svg: source,
    completeSvg: true,
    geometryCount: parsed.geometryCount,
    pathCount: parsed.pathCount
  };
}

function parseXmlStructure(source) {
  const stack = [];
  let cursor = 0;
  let rootName = '';
  let rootClosed = false;
  let rootAttributes = null;
  let geometryCount = 0;
  let pathCount = 0;
  let visibleText = '';
  let usesXlink = false;
  const renderableDefinitionIds = new Set();

  while (cursor < source.length) {
    if (source[cursor] !== '<') {
      const nextTag = source.indexOf('<', cursor);
      const end = nextTag === -1 ? source.length : nextTag;
      const text = source.slice(cursor, end);
      if (text.includes(']]>')) return failure('XML_MALFORMED');
      const entityError = findEntityError(text);
      if (entityError) return failure('XML_INVALID_ENTITY');
      if (stack.some((entry) => entry.lowerName === 'text' || entry.lowerName === 'tspan')) {
        visibleText += ` ${decodeXmlText(text)}`;
      } else if (rootClosed && text.trim()) {
        return failure('XML_MALFORMED');
      }
      cursor = end;
      continue;
    }

    if (source.startsWith('<!--', cursor)) {
      const commentEnd = source.indexOf('-->', cursor + 4);
      if (commentEnd === -1) return failure('XML_MALFORMED');
      cursor = commentEnd + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', cursor)) return failure('DANGEROUS_ELEMENT');
    if (/^<!DOCTYPE\b/i.test(source.slice(cursor))) return failure('DANGEROUS_ELEMENT');
    if (source.startsWith('<?', cursor) || source.startsWith('<!', cursor)) {
      return failure('XML_MALFORMED');
    }

    const tagEnd = findTagEnd(source, cursor + 1);
    if (tagEnd < 0) return failure('XML_MALFORMED');
    const tag = parseTag(source.slice(cursor + 1, tagEnd));
    if (!tag.ok) return tag;

    if (tag.closing) {
      const current = stack.pop();
      if (!current || current.name !== tag.name) return failure('XML_MALFORMED');
      if (stack.length === 0) rootClosed = true;
      cursor = tagEnd + 1;
      continue;
    }

    if (rootClosed) return failure('XML_MALFORMED');
    if (!rootName) {
      rootName = tag.lowerName;
      rootAttributes = tag.attributes;
      if (rootName !== 'svg') return failure('XML_MALFORMED');
    } else if (stack.length === 0) {
      return failure('XML_MALFORMED');
    }

    if (FORBIDDEN_ELEMENTS.has(tag.lowerName)) return failure('DANGEROUS_ELEMENT');
    if (tag.lowerName.includes(':')) return failure('INVALID_NAMESPACE');
    if (tag.attributes.some((attribute) => attribute.lowerName === 'xlink:href')) usesXlink = true;
    const attributeFailure = validateAttributes(tag.attributes);
    if (attributeFailure) return failure(attributeFailure);

    const insideDefinition = stack.some((entry) => NON_RENDERING_CONTAINERS.has(entry.lowerName));
    const hidden = stack.some((entry) => entry.hidden) || isHiddenElement(tag.attributes);
    if (tag.lowerName === 'path') {
      pathCount += 1;
      const pathData = getAttribute(tag.attributes, 'd');
      if (!isValidPathData(pathData)) return failure('INVALID_PATH_DATA');
    }
    if (SVG_GEOMETRY_ELEMENTS.has(tag.lowerName)) {
      const visibleGeometry = hasVisibleGeometry(tag)
        && !hidden
        && !isBackgroundOnlyRect(tag, rootAttributes);
      const id = getAttribute(tag.attributes, 'id');
      if (insideDefinition && id && visibleGeometry) renderableDefinitionIds.add(id);
      if (!insideDefinition && visibleGeometry) geometryCount += 1;
    }
    if (tag.lowerName === 'use' && !hidden) {
      const reference = getAttribute(tag.attributes, 'href') || getAttribute(tag.attributes, 'xlink:href');
      if (reference.startsWith('#') && renderableDefinitionIds.has(reference.slice(1))) geometryCount += 1;
    }

    if (!tag.selfClosing) {
      stack.push({ name: tag.name, lowerName: tag.lowerName, hidden });
    } else if (stack.length === 0) {
      rootClosed = true;
    }
    cursor = tagEnd + 1;
  }

  if (!rootName || !rootClosed || stack.length > 0) return failure('XML_MALFORMED');
  return {
    ok: true,
    rootName,
    namespace: getAttribute(rootAttributes, 'xmlns'),
    xlinkNamespace: getAttribute(rootAttributes, 'xmlns:xlink'),
    usesXlink,
    viewBox: getAttribute(rootAttributes, 'viewbox'),
    geometryCount,
    pathCount,
    visibleText
  };
}

function findTagEnd(source, start) {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    } else if (char === '<') {
      return -1;
    }
  }
  return -1;
}

function parseTag(rawTag) {
  const raw = String(rawTag || '').trim();
  if (!raw) return failure('XML_MALFORMED');

  if (raw.startsWith('/')) {
    const match = raw.match(/^\/\s*([A-Za-z_][\w:.-]*)\s*$/);
    if (!match) return failure('XML_MALFORMED');
    return { ok: true, closing: true, name: match[1], lowerName: match[1].toLowerCase() };
  }

  const selfClosing = /\/\s*$/.test(raw);
  const body = selfClosing ? raw.replace(/\/\s*$/, '').trimEnd() : raw;
  const nameMatch = body.match(/^([A-Za-z_][\w:.-]*)(?=\s|$)/);
  if (!nameMatch) return failure('XML_MALFORMED');

  const attributes = parseAttributes(body.slice(nameMatch[0].length));
  if (!attributes.ok) return attributes;
  return {
    ok: true,
    closing: false,
    selfClosing,
    name: nameMatch[1],
    lowerName: nameMatch[1].toLowerCase(),
    attributes: attributes.values
  };
}

function parseAttributes(source) {
  const values = [];
  const seen = new Set();
  let cursor = 0;

  while (cursor < source.length) {
    const whitespace = source.slice(cursor).match(/^\s+/);
    if (!whitespace) return failure('XML_MALFORMED');
    cursor += whitespace[0].length;
    if (cursor >= source.length) break;

    const nameMatch = source.slice(cursor).match(/^([A-Za-z_][\w:.-]*)/);
    if (!nameMatch) return failure('XML_MALFORMED');
    const name = nameMatch[1];
    const lowerName = name.toLowerCase();
    if (seen.has(lowerName)) return failure('XML_MALFORMED');
    seen.add(lowerName);
    cursor += name.length;

    cursor += (source.slice(cursor).match(/^\s*/) || [''])[0].length;
    if (source[cursor] !== '=') return failure('XML_MALFORMED');
    cursor += 1;
    cursor += (source.slice(cursor).match(/^\s*/) || [''])[0].length;

    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") return failure('XML_MALFORMED');
    const valueEnd = source.indexOf(quote, cursor + 1);
    if (valueEnd === -1) return failure('XML_MALFORMED');
    const value = source.slice(cursor + 1, valueEnd);
    if (value.includes('<')) return failure('XML_MALFORMED');
    if (findEntityError(value)) return failure('XML_INVALID_ENTITY');
    values.push({ name, lowerName, value });
    cursor = valueEnd + 1;
  }

  return { ok: true, values };
}

function validateAttributes(attributes) {
  for (const attribute of attributes || []) {
    const { lowerName, value } = attribute;
    const normalizedValue = String(value || '').trim();
    if (lowerName.includes(':')
      && lowerName !== 'xlink:href'
      && !lowerName.startsWith('xmlns:')) {
      return 'INVALID_NAMESPACE';
    }
    if (/^on[a-z]+/.test(lowerName)) return 'DANGEROUS_ATTRIBUTE';
    if (/javascript\s*:|data\s*:\s*text\/html/i.test(normalizedValue)) return 'DANGEROUS_ATTRIBUTE';

    if (lowerName === 'href' || lowerName === 'xlink:href' || lowerName === 'src') {
      if (normalizedValue && !normalizedValue.startsWith('#')) return 'EXTERNAL_RESOURCE';
    }

    if (lowerName === 'style') {
      const withoutInternalUrls = normalizedValue.replace(/url\(\s*['"]?#[^)'"]+['"]?\s*\)/gi, '');
      if (/url\s*\(|@import|expression\s*\(/i.test(withoutInternalUrls)) {
        return 'DANGEROUS_ATTRIBUTE';
      }
    }

    const externalUrl = normalizedValue.replace(/url\(\s*['"]?#[^)'"]+['"]?\s*\)/gi, '');
    if (/url\s*\(/i.test(externalUrl)) return 'EXTERNAL_RESOURCE';
  }
  return '';
}

function findEntityError(value) {
  const source = String(value || '');
  let cursor = 0;
  while (cursor < source.length) {
    const ampersand = source.indexOf('&', cursor);
    if (ampersand === -1) return '';
    const match = source.slice(ampersand).match(/^&(#x[0-9a-f]+|#\d+|[A-Za-z][\w.-]*);/i);
    if (!match) return 'XML_INVALID_ENTITY';
    const token = match[1];
    if (token.startsWith('#')) {
      const hexadecimal = token[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(token.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!isValidXmlCodePoint(codePoint)) return 'XML_INVALID_ENTITY';
    } else if (!XML_PREDEFINED_ENTITIES.has(token.toLowerCase())) {
      return 'XML_INVALID_ENTITY';
    }
    cursor = ampersand + match[0].length;
  }
  return '';
}

function decodeXmlText(value) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, token) => {
    const normalized = token.toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    const hexadecimal = normalized.startsWith('#x');
    const codePoint = Number.parseInt(normalized.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return isValidXmlCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
  });
}

function isValidXmlCodePoint(codePoint) {
  return codePoint === 0x9
    || codePoint === 0xA
    || codePoint === 0xD
    || (codePoint >= 0x20 && codePoint <= 0xD7FF)
    || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
    || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
}

function isValidPathData(value) {
  const pathData = String(value || '').trim();
  if (!/^[Mm]/.test(pathData) || !VALID_PATH_DATA_PATTERN.test(pathData) || /[<>]/.test(pathData)) {
    return false;
  }

  const tokens = tokenizePathData(pathData);
  if (!tokens || tokens.length < 3) return false;
  let cursor = 0;
  let currentCommand = '';
  let sawMove = false;

  while (cursor < tokens.length) {
    if (tokens[cursor].type === 'command') {
      currentCommand = tokens[cursor].value;
      cursor += 1;
      if (currentCommand.toUpperCase() === 'Z') {
        currentCommand = '';
        continue;
      }
    } else if (!currentCommand) {
      return false;
    }

    const command = currentCommand.toUpperCase();
    const parameterCount = PATH_COMMAND_PARAMETER_COUNTS[command];
    if (parameterCount === undefined || parameterCount === 0) return false;
    const numberStart = cursor;
    while (cursor < tokens.length && tokens[cursor].type === 'number') cursor += 1;
    const numbers = tokens.slice(numberStart, cursor).map((token) => token.value);
    if (!numbers.length || numbers.length % parameterCount !== 0) return false;
    if (command === 'A') {
      for (let index = 0; index < numbers.length; index += parameterCount) {
        if (![0, 1].includes(numbers[index + 3]) || ![0, 1].includes(numbers[index + 4])) return false;
      }
    }
    if (command === 'M') sawMove = true;
  }

  return sawMove;
}

function tokenizePathData(pathData) {
  const tokens = [];
  const tokenPattern = /([MmZzLlHhVvCcSsQqTtAa])|([+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)/g;
  let cursor = 0;
  let match;
  while ((match = tokenPattern.exec(pathData))) {
    if (!isValidPathSeparator(pathData.slice(cursor, match.index), cursor === 0)) return null;
    tokens.push(match[1]
      ? { type: 'command', value: match[1] }
      : { type: 'number', value: Number(match[2]) });
    cursor = tokenPattern.lastIndex;
  }
  if (!isValidPathSeparator(pathData.slice(cursor), false)) return null;
  if (tokens.some((token) => token.type === 'number' && !Number.isFinite(token.value))) return null;
  return tokens;
}

function isValidPathSeparator(value, isLeading) {
  if (!value) return true;
  if (isLeading) return /^\s*$/.test(value);
  return /^[\s,]*$/.test(value) && !/,\s*,/.test(value);
}

function isHiddenElement(attributes) {
  const display = getAttribute(attributes, 'display').trim().toLowerCase();
  const visibility = getAttribute(attributes, 'visibility').trim().toLowerCase();
  const opacity = Number.parseFloat(getAttribute(attributes, 'opacity'));
  const style = getAttribute(attributes, 'style').replace(/\s+/g, '').toLowerCase();
  return display === 'none'
    || visibility === 'hidden'
    || opacity === 0
    || /(?:^|;)display:none(?:;|$)/.test(style)
    || /(?:^|;)visibility:hidden(?:;|$)/.test(style)
    || /(?:^|;)opacity:0(?:\.0+)?(?:;|$)/.test(style);
}

function isBackgroundOnlyRect(tag, rootAttributes) {
  if (tag.lowerName !== 'rect') return false;
  const x = getAttribute(tag.attributes, 'x') || '0';
  const y = getAttribute(tag.attributes, 'y') || '0';
  const width = getAttribute(tag.attributes, 'width');
  const height = getAttribute(tag.attributes, 'height');
  const fill = getAttribute(tag.attributes, 'fill').replace(/\s+/g, '').toLowerCase();
  const style = getAttribute(tag.attributes, 'style').replace(/\s+/g, '').toLowerCase();
  const whiteFill = ['', '#fff', '#ffffff', 'white', 'rgb(255,255,255)'].includes(fill)
    || /(?:^|;)fill:(?:#fff|#ffffff|white|rgb\(255,255,255\))(?:;|$)/.test(style);
  if (!whiteFill || Number(x) !== 0 || Number(y) !== 0) return false;

  if (width === '100%' && height === '100%') return true;
  const viewBox = getAttribute(rootAttributes, 'viewbox').trim().split(/[\s,]+/).map(Number);
  return viewBox.length === 4
    && Number.isFinite(viewBox[2])
    && Number.isFinite(viewBox[3])
    && Number(width) === viewBox[2]
    && Number(height) === viewBox[3];
}

function hasVisibleGeometry(tag) {
  if (hasInvisiblePaint(tag.attributes)) return false;
  const number = (name, fallback = Number.NaN) => {
    const value = getAttribute(tag.attributes, name);
    return value === '' ? fallback : Number(value);
  };

  switch (tag.lowerName) {
    case 'path':
      return pathDrawsGeometry(getAttribute(tag.attributes, 'd'));
    case 'line': {
      const x1 = number('x1', 0);
      const y1 = number('y1', 0);
      const x2 = number('x2', 0);
      const y2 = number('y2', 0);
      return [x1, y1, x2, y2].every(Number.isFinite) && (x1 !== x2 || y1 !== y2);
    }
    case 'polyline':
    case 'polygon': {
      const points = parsePointList(getAttribute(tag.attributes, 'points'));
      const minimum = tag.lowerName === 'polygon' ? 3 : 2;
      return points.length >= minimum && new Set(points.map((point) => point.join(','))).size >= minimum;
    }
    case 'circle':
      return [number('cx', 0), number('cy', 0), number('r')].every(Number.isFinite) && number('r') > 0;
    case 'ellipse':
      return [number('cx', 0), number('cy', 0), number('rx'), number('ry')].every(Number.isFinite)
        && number('rx') > 0 && number('ry') > 0;
    case 'rect':
      return [number('x', 0), number('y', 0), number('width'), number('height')].every(Number.isFinite)
        && number('width') > 0 && number('height') > 0;
    default:
      return false;
  }
}

function hasInvisiblePaint(attributes) {
  const fill = getAttribute(attributes, 'fill').trim().toLowerCase();
  const stroke = getAttribute(attributes, 'stroke').trim().toLowerCase();
  const style = getAttribute(attributes, 'style').replace(/\s+/g, '').toLowerCase();
  const styleFill = style.match(/(?:^|;)fill:([^;]+)/)?.[1] || '';
  const styleStroke = style.match(/(?:^|;)stroke:([^;]+)/)?.[1] || '';
  const resolvedFill = styleFill || fill;
  const resolvedStroke = styleStroke || stroke;
  return resolvedFill === 'none' && resolvedStroke === 'none';
}

function pathDrawsGeometry(pathData) {
  const tokens = tokenizePathData(pathData);
  if (!tokens) return false;
  if (tokens.some((token) => token.type === 'command' && !['M', 'Z'].includes(token.value.toUpperCase()))) {
    return true;
  }
  const moveIndex = tokens.findIndex((token) => token.type === 'command' && token.value.toUpperCase() === 'M');
  if (moveIndex < 0) return false;
  let coordinateCount = 0;
  for (let index = moveIndex + 1; index < tokens.length && tokens[index].type === 'number'; index += 1) {
    coordinateCount += 1;
  }
  return coordinateCount >= 4;
}

function parsePointList(value) {
  const source = String(value || '').trim();
  if (!source || !/^[\s,0-9.+\-Ee]+$/.test(source)) return [];
  const numbers = source.match(/[+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?/g)?.map(Number) || [];
  if (numbers.length < 4 || numbers.length % 2 !== 0 || numbers.some((item) => !Number.isFinite(item))) return [];
  const points = [];
  for (let index = 0; index < numbers.length; index += 2) points.push([numbers[index], numbers[index + 1]]);
  return points;
}

function isValidViewBox(value) {
  const parts = String(value || '').trim().split(/[\s,]+/).map(Number);
  return parts.length === 4
    && parts.every(Number.isFinite)
    && parts[2] > 0
    && parts[3] > 0;
}

function getAttribute(attributes, name) {
  const target = String(name || '').toLowerCase();
  return (attributes || []).find((attribute) => attribute.lowerName === target)?.value || '';
}

function normalizeFinishReason(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function failure(code, details = {}) {
  return {
    ok: false,
    code,
    message: FIGURE_SVG_FAILURES[code] || 'SVG 未通过质量校验',
    ...details
  };
}

function isRenderableFigureSvg(svg) {
  return analyzeFigureSvg(svg).ok;
}

module.exports = {
  FIGURE_SVG_FAILURES,
  analyzeFigureSvg,
  analyzeGeneratedFigure,
  extractSvgCandidate,
  isRenderableFigureSvg
};

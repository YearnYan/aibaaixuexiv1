const INLINE_OPEN = '\\(';
const INLINE_CLOSE = '\\)';
const DISPLAY_OPEN = '\\[';
const DISPLAY_CLOSE = '\\]';
const SENTENCE_TERMINATORS = new Set(['。', '；', '！', '？']);
const TRAILING_PUNCTUATION = new Set(['”', '’', '）', '】', '》', '〉', '」', '』']);

function readDelimiter(source, index) {
  if (source.startsWith(INLINE_OPEN, index)) return { value: INLINE_OPEN, kind: 'open', mode: 'inline' };
  if (source.startsWith(INLINE_CLOSE, index)) return { value: INLINE_CLOSE, kind: 'close', mode: 'inline' };
  if (source.startsWith(DISPLAY_OPEN, index)) return { value: DISPLAY_OPEN, kind: 'open', mode: 'display' };
  if (source.startsWith(DISPLAY_CLOSE, index)) return { value: DISPLAY_CLOSE, kind: 'close', mode: 'display' };
  return null;
}

function createFormulaBoundaryError(message, index) {
  const error = new Error(`解析文本公式边界错误：${message}（位置 ${index}）`);
  error.code = 'FORMULA_SEGMENTATION_BOUNDARY_INVALID';
  error.index = index;
  return error;
}

function startsWithDoubleEscapedDelimiter(source, index) {
  return source.startsWith('\\\\(', index)
    || source.startsWith('\\\\)', index)
    || source.startsWith('\\\\[', index)
    || source.startsWith('\\\\]', index);
}

function splitTextOutsideLatexFormulas(value) {
  const source = String(value || '');
  const segments = [];
  let buffer = '';
  let mode = '';
  let formulaStart = -1;

  const flush = () => {
    const segment = buffer.trim();
    if (segment) segments.push(segment);
    buffer = '';
  };

  for (let index = 0; index < source.length;) {
    if (startsWithDoubleEscapedDelimiter(source, index)) {
      throw createFormulaBoundaryError('存在双重转义定界符', index);
    }

    const delimiter = readDelimiter(source, index);
    if (delimiter) {
      if (delimiter.kind === 'open') {
        if (mode) throw createFormulaBoundaryError('公式定界符发生嵌套', index);
        mode = delimiter.mode;
        formulaStart = index;
      } else {
        if (!mode) throw createFormulaBoundaryError('出现没有对应开始符的结束符', index);
        if (mode !== delimiter.mode) throw createFormulaBoundaryError('行内公式与独立公式定界符不匹配', index);
        mode = '';
        formulaStart = -1;
      }
      buffer += delimiter.value;
      index += delimiter.value.length;
      continue;
    }

    const character = source[index];
    if (!mode && (character === '\r' || character === '\n')) {
      flush();
      index += character === '\r' && source[index + 1] === '\n' ? 2 : 1;
      continue;
    }

    buffer += character;
    index += 1;
    if (!mode && SENTENCE_TERMINATORS.has(character)) {
      while (index < source.length && TRAILING_PUNCTUATION.has(source[index])) {
        buffer += source[index];
        index += 1;
      }
      flush();
    }
  }

  if (mode) throw createFormulaBoundaryError('公式缺少结束符', formulaStart);
  flush();
  return segments;
}

module.exports = {
  splitTextOutsideLatexFormulas,
  _internals: {
    readDelimiter,
    startsWithDoubleEscapedDelimiter
  }
};

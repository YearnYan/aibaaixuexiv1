function stripCodeFence(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractJsonText(value) {
  const text = stripCodeFence(value);
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
  if (start === -1) throw new Error('AI 返回内容中没有找到 JSON');
  const close = text[start] === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end < start) throw new Error('AI 返回的 JSON 不完整');
  return text.slice(start, end + 1);
}

function nextNonWhitespace(text, start) {
  for (let index = start; index < text.length; index += 1) {
    if (!/\s/.test(text[index])) return text[index];
  }
  return '';
}

export function repairJsonText(value) {
  const text = extractJsonText(value);
  let output = '';
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!inString) {
      if (char === '"') inString = true;
      output += char;
      continue;
    }

    if (char === '\\') {
      const next = text[index + 1] || '';
      if ('"\\/bfnrt'.includes(next)) {
        output += char + next;
        index += 1;
        continue;
      }
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(index + 2, index + 6))) {
        output += text.slice(index, index + 6);
        index += 5;
        continue;
      }
      output += '\\\\';
      continue;
    }

    if (char === '"') {
      const next = nextNonWhitespace(text, index + 1);
      if (!next || ':,}]'.includes(next)) {
        inString = false;
        output += char;
      } else {
        output += '\\"';
      }
      continue;
    }

    if (char === '\n') { output += '\\n'; continue; }
    if (char === '\r') { output += '\\r'; continue; }
    if (char === '\t') { output += '\\t'; continue; }
    if (char.charCodeAt(0) < 0x20) {
      output += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
      continue;
    }
    output += char;
  }

  return output.replace(/,\s*([}\]])/g, '$1');
}

export function parseModelJson(value) {
  const extracted = extractJsonText(value);
  let parsed;
  try {
    parsed = JSON.parse(extracted);
  } catch (strictError) {
    try {
      parsed = JSON.parse(repairJsonText(extracted));
    } catch (repairError) {
      const error = new Error(`AI 返回的 JSON 格式异常：${repairError.message}`);
      error.code = 'MODEL_JSON_PARSE_ERROR';
      error.cause = strictError;
      throw error;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI 返回的 JSON 根节点必须是对象');
  }
  return parsed;
}

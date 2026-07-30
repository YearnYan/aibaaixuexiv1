/**
 * 视觉选择题有时会被模型输出为无内容图片链接或失败提示。
 * 只有在调用方已经获得完整图形选项组时，才能据此过滤这些占位内容。
 */

const VISUAL_OPTION_FAILURE_HINT = /(?:blank\s+(?:equation|image)|empty\s+(?:equation|image)|空白公式|空白图片|图片选项|图形选项|选项图片|选项图|图片加载失败|图片内容未识别|公式内容无法完整解析|图片无法识别|图形内容未识别)/gi;
const DEFAULT_OPTION_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const CIRCLED_OPTION_LABELS: Record<string, string> = {
  "①": "A", "②": "B", "③": "C", "④": "D", "⑤": "E", "⑥": "F", "⑦": "G", "⑧": "H",
};

export function isVisualOptionPlaceholder(value: string) {
  let content = stripOptionLabel(String(value ?? "").trim());
  if (!content) return true;

  content = removeMarkdownImages(content)
    .replace(/<img\b[^>]*>/gi, "")
    .replace(VISUAL_OPTION_FAILURE_HINT, "")
    .replace(/\[(?:图片|图形|图|image)\]/gi, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");

  return content.length === 0;
}

export function hasVisualOptionPlaceholderSet(options: readonly string[]) {
  if (options.length < 2) return false;
  const placeholderCount = options.filter(isVisualOptionPlaceholder).length;
  return placeholderCount >= Math.max(2, Math.ceil(options.length / 2));
}

export function filterVisualOptionPlaceholders(options: readonly string[]) {
  return options.filter((option) => !isVisualOptionPlaceholder(option));
}

export function restoreVisualOptionLabels(options: readonly string[], requiredLabels: readonly string[] = []) {
  const restored = options.map((option, index) => {
    if (!isVisualOptionPlaceholder(option)) return option;
    const label = extractOptionLabel(option) || DEFAULT_OPTION_LABELS[index];
    return label ? `${label}.` : option;
  });

  const existingLabels = new Set(restored.map(extractOptionLabel).filter(Boolean));
  for (const rawLabel of requiredLabels) {
    const label = normalizeOptionLabel(rawLabel);
    if (!label || existingLabels.has(label)) continue;
    restored.push(`${label}.`);
    existingLabels.add(label);
  }

  return restored;
}

export function extractOptionLabel(value: string) {
  const match = String(value ?? "").trim().match(/^(?:选项\s*)?([A-HＡ-Ｈ①②③④⑤⑥⑦⑧])(?:\s*[.．、:：)）]|\s|$)/i);
  return match ? normalizeOptionLabel(match[1]) : "";
}

export function normalizeOptionLabel(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (CIRCLED_OPTION_LABELS[text]) return CIRCLED_OPTION_LABELS[text];
  const normalized = text
    .replace(/^选项\s*/i, "")
    .replace(/\s*(?:选项(?:图形|图片|图)?|图形|图片|图)\s*$/u, "")
    .replace(/[.．、:：)）\s]+$/g, "")
    .toUpperCase()
    .replace(/[Ａ-Ｈ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0));
  return /^[A-H]$/.test(normalized) ? normalized : "";
}

export function isOptionLabelOnly(value: string) {
  const label = extractOptionLabel(value);
  return Boolean(label && stripOptionLabel(String(value ?? "").trim()).length === 0);
}

function stripOptionLabel(value: string) {
  return value.replace(/^\s*(?:选项\s*)?(?:[A-HＡ-Ｈ]|[①②③④⑤⑥⑦⑧])\s*[.．、:：)）]?\s*/i, "");
}

function removeMarkdownImages(value: string) {
  let result = "";
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf("![", cursor);
    if (start < 0) {
      result += value.slice(cursor);
      break;
    }

    const altEnd = value.indexOf("](", start + 2);
    if (altEnd < 0) {
      result += value.slice(cursor);
      break;
    }

    const end = findMarkdownDestinationEnd(value, altEnd + 2);
    if (end < 0) {
      result += value.slice(cursor);
      break;
    }

    result += value.slice(cursor, start);
    cursor = end + 1;
  }

  return result;
}

function findMarkdownDestinationEnd(value: string, start: number) {
  let depth = 1;
  for (let cursor = start; cursor < value.length; cursor += 1) {
    if (value[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (value[cursor] === "(") depth += 1;
    if (value[cursor] === ")") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

import path from "node:path";
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  VALID_DEPTHS,
  VALID_GOALS
} from "./constants.js";

export function getExtension(filename = "") {
  return path.extname(filename).toLowerCase();
}

export function normalizeUploadFilename(filename = "") {
  const original = String(filename);
  if ([...original].some((character) => character.codePointAt(0) > 255)) return original;

  const decoded = Buffer.from(original, "latin1").toString("utf8");
  if (!decoded || decoded.includes("�")) return original;
  return decoded;
}

export function isAllowedFile(file) {
  const extensionAllowed = ALLOWED_EXTENSIONS.has(getExtension(file?.originalname));
  const mimeAllowed = ALLOWED_MIME_TYPES.has((file?.mimetype || "").toLowerCase());
  return extensionAllowed && mimeAllowed;
}

export function detectFileKind(file) {
  const extension = getExtension(file?.originalname);
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return "image";
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx") return "docx";
  if (extension === ".doc") return "doc";
  return "unknown";
}

const TEXT_FORMULA_DELIMITERS = [
  ["$$", "$$"],
  ["\\[", "\\]"],
  ["\\(", "\\)"],
  ["$", "$"]
];

function isEscapedDelimiter(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function findNextFormulaOpening(text, fromIndex) {
  let result = null;
  TEXT_FORMULA_DELIMITERS.forEach(([open, close], order) => {
    let index = text.indexOf(open, fromIndex);
    while (index >= 0) {
      const isNestedDollar = open === "$" && (text[index - 1] === "$" || text[index + 1] === "$");
      if (!isEscapedDelimiter(text, index) && !isNestedDollar) break;
      index = text.indexOf(open, index + open.length);
    }
    if (index < 0) return;
    if (!result || index < result.index || (index === result.index && order < result.order)) {
      result = { open, close, index, order };
    }
  });
  return result;
}

function findFormulaClosing(text, delimiter, fromIndex) {
  let index = text.indexOf(delimiter.close, fromIndex);
  while (index >= 0) {
    const isNestedDollar = delimiter.close === "$" && (text[index - 1] === "$" || text[index + 1] === "$");
    if (!isEscapedDelimiter(text, index) && !isNestedDollar) return index;
    index = text.indexOf(delimiter.close, index + delimiter.close.length);
  }
  return -1;
}

export function sliceTextPreservingFormulas(value, maxLength) {
  const text = String(value ?? "");
  const limit = Math.max(0, Math.floor(Number(maxLength)));
  if (!Number.isFinite(limit) || text.length <= limit) return text;
  if (!limit) return "";

  let cursor = 0;
  while (cursor < text.length) {
    const opening = findNextFormulaOpening(text, cursor);
    if (!opening || opening.index >= limit) break;
    const contentStart = opening.index + opening.open.length;
    const closingIndex = findFormulaClosing(text, opening, contentStart);
    if (closingIndex < 0) return text.slice(0, opening.index).trimEnd();
    const formulaEnd = closingIndex + opening.close.length;
    if (limit > opening.index && limit < formulaEnd) {
      return formulaEnd - limit <= 2_000
        ? text.slice(0, formulaEnd)
        : text.slice(0, opening.index).trimEnd();
    }
    cursor = formulaEnd;
  }
  return text.slice(0, limit);
}

export function cleanText(value, maxLength = 6_000) {
  if (value === null || value === undefined) return "";
  const cleaned = String(value)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*?)?\s*\/?>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return sliceTextPreservingFormulas(cleaned, maxLength);
}

export function cleanSingleLine(value, maxLength = 180) {
  return cleanText(value, maxLength).replace(/\s+/g, " ").trim();
}

export function validateOptions(body = {}) {
  const grade = cleanSingleLine(body.grade, 30) || "初中";
  const subject = cleanSingleLine(body.subject, 30) || "自动识别";
  const goal = VALID_GOALS.has(body.goal) ? body.goal : "understand";
  const depth = VALID_DEPTHS.has(body.depth) ? body.depth : "detailed";

  return { grade, subject, goal, depth };
}

function sliceFirstJsonObject(content) {
  const firstBrace = content.indexOf("{");
  if (firstBrace === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBrace; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(firstBrace, index + 1);
    }
  }

  const lastBrace = content.lastIndexOf("}");
  return lastBrace > firstBrace ? content.slice(firstBrace, lastBrace + 1) : "";
}

function escapeJsonControlCharacters(content) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (const character of content) {
    if (!inString) {
      result += character;
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      result += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      result += character;
      inString = false;
      continue;
    }
    const code = character.codePointAt(0);
    if (code < 0x20) {
      const escapedControl = {
        "\b": "\\b",
        "\t": "\\t",
        "\n": "\\n",
        "\f": "\\f",
        "\r": "\\r"
      }[character] || `\\u${code.toString(16).padStart(4, "0")}`;
      result += escapedControl;
      continue;
    }
    result += character;
  }
  return result;
}

function removeTrailingJsonCommas(content) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ",") {
      let nextIndex = index + 1;
      while (/\s/u.test(content[nextIndex] || "")) nextIndex += 1;
      if (["}", "]"].includes(content[nextIndex])) continue;
    }
    result += character;
  }
  return result;
}

export function extractJsonObject(rawContent) {
  if (typeof rawContent !== "string") {
    throw new TypeError("模型响应不是文本");
  }

  const trimmed = rawContent.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const isolated = sliceFirstJsonObject(withoutFence);
  if (!isolated) throw new Error("模型响应中未找到 JSON 对象");

  const repaired = removeTrailingJsonCommas(escapeJsonControlCharacters(isolated));
  const candidates = [...new Set([withoutFence, isolated, repaired])];
  let lastError;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(`模型响应不是合法 JSON：${lastError?.message || "未知格式错误"}`);
  error.code = "AI_CONTENT_JSON_INVALID";
  throw error;
}

export function truncateSourceText(text, limit) {
  const normalized = cleanText(text, Number.MAX_SAFE_INTEGER);
  if (normalized.length <= limit) {
    return { text: normalized, truncated: false };
  }
  return {
    text: `${normalized.slice(0, limit)}\n\n[后续内容因长度限制已省略]`,
    truncated: true
  };
}

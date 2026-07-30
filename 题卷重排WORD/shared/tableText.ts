/**
 * 识别结果中的 Markdown 表格只是一种文字转写，不等于原卷表格图像。
 * 本模块只在调用方已经拿到有效表格题图时删除重复文本，避免丢失信息。
 */

export function containsMarkdownTableBlock(value: string) {
  return findMarkdownTableLineRanges(value).length > 0;
}

export function stripMarkdownTableBlocks(value: string) {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const ranges = findMarkdownTableLineRanges(normalized);
  if (!ranges.length) return normalized.trim();

  const removed = new Set<number>();
  for (const range of ranges) {
    for (let index = range.start; index <= range.end; index += 1) {
      removed.add(index);
    }
  }

  return lines
    .filter((_line, index) => !removed.has(index))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type MarkdownTableLineRange = {
  start: number;
  end: number;
};

function findMarkdownTableLineRanges(value: string): MarkdownTableLineRange[] {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const ranges: MarkdownTableLineRange[] = [];
  let index = 0;

  while (index < lines.length - 1) {
    if (!isMarkdownTableDataLine(lines[index]) || !isMarkdownTableSeparatorLine(lines[index + 1])) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end + 1 < lines.length && isMarkdownTableDataLine(lines[end + 1])) {
      end += 1;
    }
    ranges.push({ start: index, end });
    index = end + 1;
  }

  return ranges;
}

function isMarkdownTableDataLine(value: string) {
  const cells = readMarkdownTableCells(value);
  return cells.length >= 2 && !cells.every(isMarkdownTableSeparatorCell);
}

function isMarkdownTableSeparatorLine(value: string) {
  const cells = readMarkdownTableCells(value);
  return cells.length >= 2 && cells.every(isMarkdownTableSeparatorCell);
}

function readMarkdownTableCells(value: string) {
  const trimmed = value.trim();
  if (!trimmed.includes("|")) return [];

  return splitUnescapedPipes(trimmed.replace(/^\|/, "").replace(/\|$/, ""))
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparatorCell(value: string) {
  return /^:?-{3,}:?$/.test(value);
}

function splitUnescapedPipes(value: string) {
  const cells: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && value[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (character === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells;
}

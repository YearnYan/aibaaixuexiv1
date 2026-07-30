export type LatexSegment =
  | { kind: "text"; value: string }
  | { kind: "formula"; value: string; display: boolean };

interface Delimiter {
  open: string;
  close: string;
  display: boolean;
}

const DELIMITERS: Delimiter[] = [
  { open: "\\[", close: "\\]", display: true },
  { open: "$$", close: "$$", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$", close: "$", display: false },
];

function isEscaped(text: string, index: number) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findOpening(text: string, start: number) {
  let best: { index: number; delimiter: Delimiter } | null = null;
  for (const delimiter of DELIMITERS) {
    let index = text.indexOf(delimiter.open, start);
    while (index !== -1 && isEscaped(text, index)) {
      index = text.indexOf(delimiter.open, index + delimiter.open.length);
    }
    if (index !== -1 && (!best || index < best.index || (index === best.index && delimiter.open.length > best.delimiter.open.length))) {
      best = { index, delimiter };
    }
  }
  return best;
}

function findClosing(text: string, delimiter: Delimiter, start: number) {
  let index = text.indexOf(delimiter.close, start);
  while (index !== -1 && isEscaped(text, index)) {
    index = text.indexOf(delimiter.close, index + delimiter.close.length);
  }
  return index;
}

function pushText(segments: LatexSegment[], value: string) {
  if (!value) return;
  const last = segments.at(-1);
  if (last?.kind === "text") {
    last.value += value;
  } else {
    segments.push({ kind: "text", value });
  }
}

export function tokenizeLatex(text: string): LatexSegment[] {
  if (!text) return [];
  const segments: LatexSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const opening = findOpening(text, cursor);
    if (!opening) {
      pushText(segments, text.slice(cursor));
      break;
    }

    pushText(segments, text.slice(cursor, opening.index));
    const contentStart = opening.index + opening.delimiter.open.length;
    const closingIndex = findClosing(text, opening.delimiter, contentStart);
    if (closingIndex === -1) {
      pushText(segments, text.slice(opening.index));
      break;
    }

    const formula = text.slice(contentStart, closingIndex).trim();
    if (formula) {
      segments.push({ kind: "formula", value: formula, display: opening.delimiter.display });
    } else {
      pushText(segments, text.slice(opening.index, closingIndex + opening.delimiter.close.length));
    }
    cursor = closingIndex + opening.delimiter.close.length;
  }

  return segments;
}

export function formulaKey(value: string, display: boolean) {
  return `${display ? "block" : "inline"}:${value}`;
}

export function collectFormulaSegments(texts: string[]) {
  const formulas = new Map<string, Extract<LatexSegment, { kind: "formula" }>>();
  for (const text of texts) {
    for (const segment of tokenizeLatex(text)) {
      if (segment.kind === "formula") {
        formulas.set(formulaKey(segment.value, segment.display), segment);
      }
    }
  }
  return Array.from(formulas.values());
}

export function findLatexDelimiterIssues(text: string) {
  const issues: string[] = [];
  const counts = { inlineOpen: 0, inlineClose: 0, blockOpen: 0, blockClose: 0, dollar: 0, doubleDollar: 0 };

  for (let index = 0; index < text.length; index += 1) {
    if (isEscaped(text, index)) continue;
    if (text.startsWith("\\(", index)) {
      counts.inlineOpen += 1;
      index += 1;
    } else if (text.startsWith("\\)", index)) {
      counts.inlineClose += 1;
      index += 1;
    } else if (text.startsWith("\\[", index)) {
      counts.blockOpen += 1;
      index += 1;
    } else if (text.startsWith("\\]", index)) {
      counts.blockClose += 1;
      index += 1;
    } else if (text.startsWith("$$", index)) {
      counts.doubleDollar += 1;
      index += 1;
    } else if (text[index] === "$") {
      counts.dollar += 1;
    }
  }

  if (counts.inlineOpen !== counts.inlineClose) issues.push("行内公式分隔符不成对");
  if (counts.blockOpen !== counts.blockClose) issues.push("独立公式分隔符不成对");
  if (counts.doubleDollar % 2 !== 0) issues.push("双美元公式分隔符不成对");
  if (counts.dollar % 2 !== 0) issues.push("美元公式分隔符不成对");
  return issues;
}

import katex from "katex";

/**
 * 网页预览和 Word 导出共享的公式文本契约。
 *
 * 这里刻意只保留跨 KaTeX、MathJax 和 OMML 都较稳定的 LaTeX 写法；
 * 无法可靠转换的内容会由 toReadableFormulaText 降级为用户可读文本。
 */

const KATEX_VALIDATION_CACHE_LIMIT = 800;
const katexValidationCache = new Map<string, boolean>();

const COMMAND_SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", varpi: "ϖ",
  rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", cdot: "·", bullet: "•", div: "÷", pm: "±", mp: "∓", ast: "∗",
  star: "⋆", circ: "°", degree: "°", angle: "∠", measuredangle: "∡", sphericalangle: "∢",
  triangle: "△", square: "□", parallel: "∥", perp: "⊥", bot: "⊥", top: "⊤",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈",
  sim: "∼", simeq: "≃", equiv: "≡", cong: "≅", asymp: "≍", propto: "∝",
  in: "∈", notin: "∉", ni: "∋", cap: "∩", cup: "∪", setminus: "∖",
  subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", emptyset: "∅", varnothing: "∅",
  forall: "∀", exists: "∃", neg: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨",
  oplus: "⊕", otimes: "⊗", oslash: "⊘", odot: "⊙", mid: "∣", vert: "|", Vert: "‖",
  to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔", mapsto: "↦",
  Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", implies: "⇒", iff: "⇔",
  longrightarrow: "⟶", longleftarrow: "⟵", Longrightarrow: "⟹", Longleftarrow: "⟸",
  rightleftharpoons: "⇌", uparrow: "↑", downarrow: "↓", updownarrow: "↕",
  therefore: "∴", because: "∵", partial: "∂", nabla: "∇", infty: "∞", hbar: "ℏ",
  ell: "ℓ", aleph: "ℵ", wp: "℘", Re: "Re", Im: "Im", ldots: "…", cdots: "⋯",
  vdots: "⋮", ddots: "⋱", prime: "′", primes: "‴", quad: " ", qquad: "  ",
};

const TEXT_STYLE_COMMANDS = new Set([
  "text", "mathrm", "textrm", "mathit", "mathbf", "mathsf", "mathtt", "mathcal", "mathscr",
  "mathfrak", "mathbb", "Bbb", "operatorname", "mbox", "rm", "bf", "it", "cal",
  "boldsymbol", "bm", "bold", "mathbfit", "symbf", "symbfit",
]);

const PORTABLE_STYLE_ALIASES: Array<[source: string, target: string]> = [
  ["boldsymbol", "mathbf"],
  ["mathbfit", "mathbf"],
  ["symbfit", "mathbf"],
  ["symbf", "mathbf"],
  ["bold", "mathbf"],
  ["bm", "mathbf"],
  ["Bbb", "mathbb"],
];

const DECORATION_COMMANDS: Record<string, { prefix?: string; suffix?: string }> = {
  vec: { prefix: "→" }, overrightarrow: { prefix: "→" }, overleftarrow: { prefix: "←" },
  overline: { prefix: "¯" }, underline: { suffix: "_" }, bar: { prefix: "¯" }, hat: { suffix: "̂" },
  widehat: { suffix: "̂" }, tilde: { suffix: "˜" }, widetilde: { suffix: "˜" },
  dot: { suffix: "˙" }, ddot: { suffix: "¨" }, overbrace: { prefix: "⏞(" , suffix: ")" },
  underbrace: { prefix: "⏟(" , suffix: ")" },
};

const MATRIX_ENVIRONMENTS = new Set([
  "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "smallmatrix", "array",
]);
const ALIGNMENT_ENVIRONMENTS = new Set(["aligned", "alignedat", "align", "alignat", "gathered", "split", "cases"]);

const SUPERSCRIPT_CHARACTERS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ", "°": "°", "′": "′",
};
const SUBSCRIPT_CHARACTERS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ",
  "j": "ⱼ", "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ", "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "x": "ₓ",
};

const UNICODE_SUPERSCRIPT_TO_LATEX: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i",
};
const UNICODE_SUBSCRIPT_TO_LATEX: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")", "ₐ": "a", "ₑ": "e", "ₕ": "h", "ᵢ": "i",
  "ⱼ": "j", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₒ": "o", "ₚ": "p", "ᵣ": "r", "ₛ": "s", "ₜ": "t", "ₓ": "x",
};

const EDUCATIONAL_HTML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  times: "×", divide: "÷", plusmn: "±", minus: "−", le: "≤", ge: "≥", ne: "≠",
  asymp: "≈", equiv: "≡", infin: "∞", sum: "∑", prod: "∏", int: "∫", radic: "√",
  deg: "°", micro: "μ", mu: "μ", Omega: "Ω", omega: "ω", alpha: "α", beta: "β",
  gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", pi: "π", rho: "ρ", sigma: "σ",
  phi: "φ", rarr: "→", larr: "←", harr: "↔", rArr: "⇒", lArr: "⇐", hArr: "⇔",
};

/**
 * 将 OCR、PDF 字体和富文本来源中的等价字形统一成真实教学文本。
 * 规则按 Unicode 与运算符类别工作，不以科目或有限公式样例作为白名单。
 */
export function normalizeEducationalUnicode(value: string) {
  return decodeEducationalHtmlEntities(String(value ?? ""))
    .normalize("NFC")
    .replace(/\r\n?|\u0085|\u2028|\u2029/g, "\n")
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[！-～]/g, (character) => {
      // 中文标点保留中文形态；字母、数字和运算符才折算为 ASCII。
      if ("，；：！？（）［］｛｝、".includes(character)) return character;
      return String.fromCharCode(character.charCodeAt(0) - 0xFEE0);
    })
    .replace(/[‐‑‒–—﹘﹣－]/g, "−")
    .replace(/[＋﹢]/g, "+")
    .replace(/[＝﹦]/g, "=")
    .replace(/[＜﹤]/g, "<")
    .replace(/[＞﹥]/g, ">")
    .replace(/[／⁄∕]/g, "/")
    .replace(/[＊✕✖⨯]/g, "×")
    .replace(/[∙⋅・]/g, "·")
    .replace(/≦/g, "≤")
    .replace(/≧/g, "≥")
    .replace(/[≒≃]/g, "≈")
    .replace(/[⟶➝➡]/g, "→")
    .replace(/[⟵⬅]/g, "←")
    .replace(/[↔⟷]/g, "↔")
    .replace(/\u0250/g, "a")
    // 不可见控制、双向格式、私有区与替换字符不能进入网页或 Word。
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2400-\u2426\uE000-\uF8FF\uFE00-\uFE0F\uFFF0-\uFFFF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, "");
}

function decodeEducationalHtmlEntities(value: string) {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]+));/gi, (entity, decimal, hexadecimal, named) => {
    if (decimal || hexadecimal) {
      const codePoint = Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF
        ? String.fromCodePoint(codePoint)
        : "";
    }
    return EDUCATIONAL_HTML_ENTITIES[named] ?? entity;
  });
}

/** 将识别文本中的符号和常见别名归一为跨端可移植 LaTeX。 */
export function normalizePortableLatex(value: string) {
  let formula = stripNonPortableFormulaCharacters(normalizeEducationalUnicode(value))
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/×/g, "\\times ")
    .replace(/÷/g, "\\div ")
    .replace(/·/g, "\\cdot ")
    .replace(/≤/g, "\\leq ")
    .replace(/≥/g, "\\geq ")
    .replace(/≠/g, "\\ne ")
    .replace(/≈/g, "\\approx ")
    .replace(/≡/g, "\\equiv ")
    .replace(/∝/g, "\\propto ")
    .replace(/∈/g, "\\in ")
    .replace(/∉/g, "\\notin ")
    .replace(/∩/g, "\\cap ")
    .replace(/∪/g, "\\cup ")
    .replace(/⊂/g, "\\subset ")
    .replace(/⊆/g, "\\subseteq ")
    .replace(/⊃/g, "\\supset ")
    .replace(/⊇/g, "\\supseteq ")
    .replace(/∥/g, "\\parallel ")
    .replace(/⊥/g, "\\perp ")
    .replace(/∠/g, "\\angle ")
    .replace(/△/g, "\\triangle ")
    .replace(/→/g, "\\rightarrow ")
    .replace(/←/g, "\\leftarrow ")
    .replace(/↔/g, "\\leftrightarrow ")
    .replace(/⇒/g, "\\Rightarrow ")
    .replace(/⇐/g, "\\Leftarrow ")
    .replace(/⇔/g, "\\Leftrightarrow ")
    .replace(/⇌/g, "\\rightleftharpoons ")
    .replace(/↑/g, "\\uparrow ")
    .replace(/↓/g, "\\downarrow ")
    .replace(/∞/g, "\\infty ")
    .replace(/∅/g, "\\emptyset ")
    .replace(/Ω/g, "\\Omega ")
    .replace(/μ/g, "\\mu ")
    .replace(/℃/g, "^{\\circ}\\mathrm{C}")
    .replace(/°\s*C\b/g, "^{\\circ}\\mathrm{C}")
    .replace(/°/g, "^{\\circ}")
    .replace(/′/g, "^{\\prime}")
    .replace(/″/g, "^{\\prime\\prime}")
    .replace(/\\dfrac\b|\\tfrac\b/g, "\\frac")
    .replace(/\\rm\b/g, "\\mathrm")
    .replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b/g, "")
    .replace(/\\begin\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|array|cases|aligned|alignedat|align|alignat|gathered|split)\*?\}/g, "\\begin{$1}")
    .replace(/\\\\\s*\[[^\]]*\]/g, "\\\\");

  formula = normalizeUnicodeScripts(formula);
  for (const [sourceCommand, targetCommand] of PORTABLE_STYLE_ALIASES) {
    formula = rewriteStyleCommand(formula, sourceCommand, targetCommand);
  }
  formula = replaceCommandGroups(formula, "ce", normalizeChemistryExpression);
  formula = replaceCommandGroups(formula, "xrightarrow", (content) => `\\overset{${content}}{\\rightarrow}`);
  formula = replaceCommandGroups(formula, "xleftarrow", (content) => `\\overset{${content}}{\\leftarrow}`);
  formula = replaceCommandGroups(formula, "xRightarrow", (content) => `\\overset{${content}}{\\Rightarrow}`);
  formula = replaceCommandGroups(formula, "xLeftarrow", (content) => `\\overset{${content}}{\\Leftarrow}`);
  return formula.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * 预检网页 KaTeX。失败时由调用方使用 toReadableFormulaText，避免显示原始 LaTeX。
 */
export function canRenderFormulaInKatex(latex: string, display = false) {
  const normalized = normalizePortableLatex(latex);
  const cacheKey = `${display ? "block" : "inline"}:${normalized}`;
  const cached = katexValidationCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let renderable = false;
  try {
    katex.renderToString(normalized, {
      displayMode: display,
      throwOnError: true,
      strict: "ignore",
      trust: false,
    });
    renderable = true;
  } catch {
    renderable = false;
  }

  if (katexValidationCache.size >= KATEX_VALIDATION_CACHE_LIMIT) {
    const oldestKey = katexValidationCache.keys().next().value;
    if (oldestKey) katexValidationCache.delete(oldestKey);
  }
  katexValidationCache.set(cacheKey, renderable);
  return renderable;
}

/** 把任意公式源码降级为不含反斜杠命令的用户可读线性公式。 */
export function toReadableFormulaText(value: string) {
  const readable = renderLatexToReadable(normalizePortableLatex(value));
  return readable
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/；\s*；/g, "；")
    .trim() || "公式内容无法完整解析";
}

/** 将公式降级文本安全嵌入 Markdown 正文，不触发 Markdown/HTML 语法。 */
export function escapeFormulaTextForMarkdown(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]])/g, "\\$1");
}

/** 把可信的在线 LaTeX 图片 Markdown 转为真正的公式片段，网页和 Word 共用。 */
export function normalizeFormulaImageMarkdown(value: string) {
  return replaceMarkdownImages(value, (image) => {
    const latex = decodeFormulaImageUrl(image.destination);
    if (latex) return `\\(${latex}\\)`;
    if (isFormulaImageUrl(image.destination)) return image.alt.trim() || "图片内容未识别";
    return image.raw;
  });
}

/** 清理 Word 正文中的 Markdown 表示层，避免链接、图片语法和表格分隔符裸露。 */
export function markdownTextForWord(value: string) {
  const withoutImages = replaceMarkdownImages(value, (image) => image.alt.trim() || "图片");
  const withoutLinks = withoutImages.replace(/\[([^\]]+)\]\((?:<[^>]+>|[^)]+)\)/g, "$1");
  const trimmed = withoutLinks.trim();

  if (looksLikeMarkdownTableRow(trimmed)) {
    return trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join("　");
  }

  return withoutLinks
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-+*]\s+/, "• ")
    .replace(/\*\*|__/g, "")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([*_`\[\]])/g, "$1");
}

export function isMarkdownTableSeparatorLine(value: string) {
  const trimmed = value.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = trimmed.split("|").map((cell) => cell.trim()).filter(Boolean);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/** 按自然段切分题目文本，但绝不在显式公式定界符内部拆行。 */
export function splitMathTextLines(value: string) {
  const lines: string[] = [];
  let lineStart = 0;
  let cursor = 0;
  let closingDelimiter = "";

  while (cursor < value.length) {
    if (closingDelimiter) {
      if (value.startsWith(closingDelimiter, cursor)) {
        cursor += closingDelimiter.length;
        closingDelimiter = "";
        continue;
      }
      cursor += 1;
      continue;
    }

    if (value.startsWith("\\[", cursor)) {
      closingDelimiter = "\\]";
      cursor += 2;
      continue;
    }
    if (value.startsWith("\\(", cursor)) {
      closingDelimiter = "\\)";
      cursor += 2;
      continue;
    }
    if (value.startsWith("$$", cursor)) {
      closingDelimiter = "$$";
      cursor += 2;
      continue;
    }
    if (value[cursor] === "\n") {
      lines.push(value.slice(lineStart, cursor));
      lineStart = cursor + 1;
    }
    cursor += 1;
  }

  lines.push(value.slice(lineStart));
  return lines;
}

function replaceCommandGroups(value: string, command: string, transform: (content: string) => string) {
  const marker = `\\${command}`;
  let result = "";
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf(marker, cursor);
    if (start < 0) {
      result += value.slice(cursor);
      break;
    }

    const afterCommand = start + marker.length;
    if (/[A-Za-z]/.test(value[afterCommand] ?? "")) {
      result += value.slice(cursor, afterCommand);
      cursor = afterCommand;
      continue;
    }

    const groupStart = skipWhitespace(value, afterCommand);
    const group = readBraced(value, groupStart);
    if (!group) {
      result += value.slice(cursor, afterCommand);
      cursor = afterCommand;
      continue;
    }

    result += value.slice(cursor, start);
    result += transform(group.content);
    cursor = group.end;
  }

  return result;
}

function rewriteStyleCommand(value: string, sourceCommand: string, targetCommand: string) {
  const marker = `\\${sourceCommand}`;
  let result = "";
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf(marker, cursor);
    if (start < 0) {
      result += value.slice(cursor);
      break;
    }

    const afterCommand = start + marker.length;
    if (/[A-Za-z]/.test(value[afterCommand] ?? "")) {
      result += value.slice(cursor, afterCommand);
      cursor = afterCommand;
      continue;
    }

    const argument = readFormulaArgument(value, afterCommand);
    if (!argument) {
      result += value.slice(cursor, afterCommand);
      cursor = afterCommand;
      continue;
    }

    result += value.slice(cursor, start);
    result += `\\${targetCommand}{${argument.content}}`;
    cursor = argument.end;
  }

  return result;
}

function normalizeChemistryExpression(value: string) {
  return value
    .replace(/<=>|⇌/g, "\\rightleftharpoons ")
    .replace(/->|→/g, "\\rightarrow ")
    .replace(/<-|←/g, "\\leftarrow ")
    .replace(/[＋]/g, "+")
    .replace(/([A-Za-z\)])(\d+)/g, "$1_{$2}")
    .replace(/([A-Za-z0-9\)])\^([0-9]*[+\-])/g, "$1^{$2}")
    .replace(/\s+/g, " ")
    .trim();
}

function renderLatexToReadable(source: string) {
  let result = "";
  let cursor = 0;

  while (cursor < source.length) {
    const character = source[cursor];

    if (character === "\\") {
      if (source[cursor + 1] === "\\") {
        result += "；";
        cursor += 2;
        continue;
      }

      const environment = readEnvironment(source, cursor);
      if (environment) {
        result += renderEnvironment(environment.name, environment.content);
        cursor = environment.end;
        continue;
      }

      const command = readCommand(source, cursor);
      if (!command) {
        cursor += 1;
        continue;
      }

      const rendered = renderCommand(source, command.name, command.end);
      result += rendered.value;
      cursor = rendered.end;
      continue;
    }

    if (character === "^" || character === "_") {
      const argument = readFormulaArgument(source, cursor + 1);
      if (!argument) {
        result += character;
        cursor += 1;
        continue;
      }
      const content = renderLatexToReadable(argument.content);
      result += toScript(content, character === "^" ? "superscript" : "subscript");
      cursor = argument.end;
      continue;
    }

    if (character === "{") {
      const group = readBraced(source, cursor);
      if (group) {
        result += renderLatexToReadable(group.content);
        cursor = group.end;
        continue;
      }
    }

    if (character === "}") {
      cursor += 1;
      continue;
    }

    if (character === "&") {
      result += ", ";
      cursor += 1;
      continue;
    }

    if (character === "~") {
      result += " ";
      cursor += 1;
      continue;
    }

    result += character;
    cursor += 1;
  }

  return result;
}

function renderCommand(source: string, name: string, start: number) {
  let cursor = start;
  if (name === "frac") {
    const numerator = readFormulaArgument(source, cursor);
    const denominator = numerator ? readFormulaArgument(source, numerator.end) : null;
    if (!numerator || !denominator) {
      const remainder = source.slice(cursor).replace(/[{}]/g, "");
      return { value: remainder ? `(${renderLatexToReadable(remainder)})` : "(?)", end: source.length };
    }
    return {
      value: `(${renderLatexToReadable(numerator.content)})/(${renderLatexToReadable(denominator.content)})`,
      end: denominator.end,
    };
  }

  if (name === "sqrt") {
    cursor = skipWhitespace(source, cursor);
    let index = "";
    if (source[cursor] === "[") {
      const bracket = readDelimited(source, cursor, "[", "]");
      if (bracket) {
        index = renderLatexToReadable(bracket.content);
        cursor = bracket.end;
      }
    }
    const radicand = readFormulaArgument(source, cursor);
    if (!radicand) return { value: index ? `${index}√(?)` : "√(?)", end: cursor };
    return {
      value: `${index ? `${index}` : ""}√(${renderLatexToReadable(radicand.content)})`,
      end: radicand.end,
    };
  }

  if (name === "binom" || name === "dbinom" || name === "tbinom") {
    const upper = readFormulaArgument(source, cursor);
    const lower = upper ? readFormulaArgument(source, upper.end) : null;
    if (!upper || !lower) return { value: "C(?, ?)", end: lower?.end ?? upper?.end ?? cursor };
    return {
      value: `C(${renderLatexToReadable(upper.content)}, ${renderLatexToReadable(lower.content)})`,
      end: lower.end,
    };
  }

  if (name === "left" || name === "right" || name === "middle") {
    const delimiter = readDelimiter(source, cursor);
    return { value: delimiter.value, end: delimiter.end };
  }

  if (TEXT_STYLE_COMMANDS.has(name)) {
    if (source[cursor] === "*") cursor += 1;
    const argument = readFormulaArgument(source, cursor);
    return argument
      ? { value: renderLatexToReadable(argument.content), end: argument.end }
      : { value: "", end: cursor };
  }

  const decoration = DECORATION_COMMANDS[name];
  if (decoration) {
    const argument = readFormulaArgument(source, cursor);
    return argument
      ? { value: `${decoration.prefix ?? ""}${renderLatexToReadable(argument.content)}${decoration.suffix ?? ""}`, end: argument.end }
      : { value: decoration.prefix ?? "", end: cursor };
  }

  if (name === "overset" || name === "underset" || name === "stackrel") {
    const annotation = readFormulaArgument(source, cursor);
    const target = annotation ? readFormulaArgument(source, annotation.end) : null;
    if (!annotation || !target) return { value: "", end: target?.end ?? annotation?.end ?? cursor };
    const position = name === "underset" ? "_" : "^";
    return {
      value: `${renderLatexToReadable(target.content)}${position}(${renderLatexToReadable(annotation.content)})`,
      end: target.end,
    };
  }

  if (name === "pmod") {
    const argument = readFormulaArgument(source, cursor);
    return argument
      ? { value: ` (mod ${renderLatexToReadable(argument.content)})`, end: argument.end }
      : { value: " mod ", end: cursor };
  }

  if (name === "substack") {
    const argument = readFormulaArgument(source, cursor);
    return argument
      ? { value: renderLatexToReadable(argument.content).replace(/；/g, ", "), end: argument.end }
      : { value: "", end: cursor };
  }

  if (name === "not") {
    const argument = readFormulaArgument(source, cursor);
    return argument
      ? { value: `¬${renderLatexToReadable(argument.content)}`, end: argument.end }
      : { value: "¬", end: cursor };
  }

  if (name === "mod") return { value: " mod ", end: cursor };
  if (name === "lim" || name === "min" || name === "max" || name === "sin" || name === "cos" || name === "tan"
    || name === "cot" || name === "sec" || name === "csc" || name === "ln" || name === "log" || name === "lg"
    || name === "arcsin" || name === "arccos" || name === "arctan" || name === "gcd" || name === "det"
    || name === "dim" || name === "ker" || name === "hom" || name === "deg") {
    return { value: name, end: cursor };
  }
  if (name === "sum") return { value: "∑", end: cursor };
  if (name === "prod") return { value: "∏", end: cursor };
  if (name === "int") return { value: "∫", end: cursor };
  if (name === "iint") return { value: "∬", end: cursor };
  if (name === "iiint") return { value: "∭", end: cursor };
  if (name === "oint") return { value: "∮", end: cursor };

  const symbol = COMMAND_SYMBOLS[name];
  if (symbol !== undefined) return { value: symbol, end: cursor };

  // 未知命令保留其名称而不保留反斜杠，普通用户仍能看懂内容且不会看到裸 TeX。
  return { value: name, end: cursor };
}

function readEnvironment(source: string, start: number) {
  const match = source.slice(start).match(/^\\begin\s*\{([A-Za-z*]+)\}/);
  if (!match) return null;

  const name = match[1];
  const beginEnd = start + match[0].length;
  const endMarker = `\\end{${name}}`;
  const endIndex = source.indexOf(endMarker, beginEnd);
  if (endIndex < 0) return null;

  return {
    name,
    content: source.slice(beginEnd, endIndex),
    end: endIndex + endMarker.length,
  };
}

function renderEnvironment(name: string, content: string) {
  const rows = splitTopLevel(content, "\\\\").map((row) => row.trim()).filter(Boolean);
  const renderedRows = rows.map((row) => splitTopLevel(row, "&")
    .map((cell) => renderLatexToReadable(cell).trim())
    .filter(Boolean));

  if (name === "cases") {
    // cases 中的 & 是等号/条件的对齐标记，不是并列数据单元。
    return `{ ${renderedRows.map((row) => row.join(" ")).join("；")} }`;
  }
  if (MATRIX_ENVIRONMENTS.has(name)) {
    const brackets = getMatrixBrackets(name);
    return `${brackets.left}${renderedRows.map((row) => `[${row.join(", ")}]`).join("；")}${brackets.right}`;
  }
  if (ALIGNMENT_ENVIRONMENTS.has(name)) {
    return renderedRows.map((row) => row.join(" ")).join("；");
  }
  return renderedRows.map((row) => row.join(" ")).join("；");
}

function getMatrixBrackets(name: string) {
  if (name === "pmatrix") return { left: "(", right: ")" };
  if (name === "bmatrix") return { left: "[", right: "]" };
  if (name === "Bmatrix") return { left: "{", right: "}" };
  if (name === "vmatrix") return { left: "|", right: "|" };
  if (name === "Vmatrix") return { left: "‖", right: "‖" };
  return { left: "[", right: "]" };
}

function readCommand(source: string, start: number) {
  const match = source.slice(start + 1).match(/^([A-Za-z]+)/);
  if (match) return { name: match[1], end: start + 1 + match[1].length };

  const escaped = source[start + 1];
  if (!escaped) return null;
  const escapedSymbols: Record<string, string> = {
    "{": "{", "}": "}", "_": "_", "^": "^", "%": "%", "#": "#", "&": "&", " ": " ",
    ",": " ", ";": " ", ":": " ", "!": "",
  };
  return { name: escapedSymbols[escaped] ?? escaped, end: start + 2 };
}

function readFormulaArgument(source: string, start: number) {
  const cursor = skipWhitespace(source, start);
  if (source[cursor] === "{") return readBraced(source, cursor);
  if (source[cursor] === "[") return readDelimited(source, cursor, "[", "]");
  if (cursor >= source.length) return null;
  if (source[cursor] === "\\") {
    const command = readCommand(source, cursor);
    return command ? { content: source.slice(cursor, command.end), end: command.end } : null;
  }
  return { content: source[cursor], end: cursor + 1 };
}

function readDelimiter(source: string, start: number) {
  const cursor = skipWhitespace(source, start);
  if (source[cursor] !== "\\") return { value: source[cursor] ?? "", end: Math.min(source.length, cursor + 1) };
  const command = readCommand(source, cursor);
  if (!command) return { value: "", end: cursor + 1 };
  const delimiters: Record<string, string> = {
    lbrace: "{", rbrace: "}", lbrack: "[", rbrack: "]", langle: "〈", rangle: "〉", vert: "|", Vert: "‖",
    "{": "{", "}": "}", "[": "[", "]": "]", ".": "",
  };
  return { value: delimiters[command.name] ?? COMMAND_SYMBOLS[command.name] ?? "", end: command.end };
}

function readBraced(source: string, start: number) {
  return readDelimited(source, start, "{", "}");
}

function readDelimited(source: string, start: number, open: string, close: string) {
  if (source[start] !== open) return null;
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (source[cursor] === open) depth += 1;
    if (source[cursor] === close) {
      depth -= 1;
      if (depth === 0) return { content: source.slice(start + 1, cursor), end: cursor + 1 };
    }
  }
  // 识别结果可能缺失闭合括号：保留剩余内容，但不让原始 LaTeX 泄露到界面。
  return { content: source.slice(start + 1), end: source.length };
}

function splitTopLevel(value: string, delimiter: string) {
  const values: string[] = [];
  let cursor = 0;
  let segmentStart = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  while (cursor < value.length) {
    if (braceDepth === 0 && bracketDepth === 0 && value.startsWith(delimiter, cursor)) {
      values.push(value.slice(segmentStart, cursor));
      cursor += delimiter.length;
      segmentStart = cursor;
      continue;
    }
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (value[cursor] === "{") braceDepth += 1;
    if (value[cursor] === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (value[cursor] === "[") bracketDepth += 1;
    if (value[cursor] === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    cursor += 1;
  }
  values.push(value.slice(segmentStart));
  return values;
}

function toScript(value: string, type: "superscript" | "subscript") {
  const map = type === "superscript" ? SUPERSCRIPT_CHARACTERS : SUBSCRIPT_CHARACTERS;
  const characters = [...value];
  if (characters.length && characters.every((character) => map[character] !== undefined)) {
    return characters.map((character) => map[character]).join("");
  }
  return `${type === "superscript" ? "^" : "_"}(${value})`;
}

function skipWhitespace(value: string, start: number) {
  let cursor = start;
  while (/\s/.test(value[cursor] ?? "")) cursor += 1;
  return cursor;
}

function stripNonPortableFormulaCharacters(value: string) {
  return value
    // 保留识别到的换行语义，并把各类文本行分隔符统一为 LF。
    .replace(/\r\n?|\u0085|\u2028|\u2029/g, "\n")
    // OCR/PDF 可能夹带 C0/C1 控制符、格式控制符、私有区占位符或控制图片字形。
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2400-\u2426\uE000-\uF8FF\uFE00-\uFE0F\uFFF0-\uFFFF]/g, "")
    // U+0250 常来自 PDF 字体映射残留；在中学题目公式中应按拉丁 a 处理。
    .replace(/\u0250/g, "a");
}

function normalizeUnicodeScripts(value: string) {
  return value
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+/g, (characters) => {
      const content = [...characters].map((character) => UNICODE_SUPERSCRIPT_TO_LATEX[character]).join("");
      return `^{${content}}`;
    })
    .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜₓ]+/g, (characters) => {
      const content = [...characters].map((character) => UNICODE_SUBSCRIPT_TO_LATEX[character]).join("");
      return `_{${content}}`;
    });
}

type MarkdownImageToken = {
  raw: string;
  alt: string;
  destination: string;
};

function replaceMarkdownImages(value: string, transform: (image: MarkdownImageToken) => string) {
  let result = "";
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf("![", cursor);
    if (start < 0) {
      result += value.slice(cursor);
      break;
    }

    const resolvedAltEnd = value.indexOf("](", start + 2);
    if (resolvedAltEnd < 0) {
      result += value.slice(cursor);
      break;
    }

    const destinationStart = resolvedAltEnd + 2;
    const end = findMarkdownDestinationEnd(value, destinationStart);
    if (end < 0) {
      result += value.slice(cursor);
      break;
    }

    const raw = value.slice(start, end + 1);
    const alt = value.slice(start + 2, resolvedAltEnd);
    const destination = readMarkdownDestination(value.slice(destinationStart, end));
    result += value.slice(cursor, start);
    result += transform({ raw, alt, destination });
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

function readMarkdownDestination(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("<")) {
    const closing = trimmed.indexOf(">");
    return closing >= 0 ? trimmed.slice(1, closing) : trimmed.slice(1);
  }
  const match = trimmed.match(/^(\S+)/);
  return match?.[1] ?? "";
}

function decodeFormulaImageUrl(value: string) {
  if (!value) return null;
  const destination = value.replace(/&amp;/g, "&");

  try {
    const url = new URL(destination);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    let formula = "";

    if ((host === "latex.codecogs.com" || host.endsWith(".codecogs.com"))
      && /\/(?:gif|png|svg)(?:\.latex|\.image)?$/.test(path)) {
      formula = url.searchParams.get("latex") || safeDecodeURIComponent(url.search.slice(1));
    } else if (host === "math.now.sh" || host.endsWith(".math.now.sh")) {
      formula = url.searchParams.get("from") || "";
    } else if ((host === "chart.googleapis.com" || host === "chart.apis.google.com")
      && url.searchParams.get("cht") === "tx") {
      formula = url.searchParams.get("chl") || "";
    }

    const normalized = cleanFormulaImageLatex(formula);
    return normalized || null;
  } catch {
    return null;
  }
}

function isFormulaImageUrl(value: string) {
  if (!value) return false;
  try {
    const url = new URL(value.replace(/&amp;/g, "&"));
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    return ((host === "latex.codecogs.com" || host.endsWith(".codecogs.com"))
        && /\/(?:gif|png|svg)(?:\.latex|\.image)?$/.test(path))
      || host === "math.now.sh"
      || host.endsWith(".math.now.sh")
      || host === "chart.googleapis.com"
      || host === "chart.apis.google.com";
  } catch {
    return false;
  }
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanFormulaImageLatex(value: string) {
  return value
    .replace(/\\dpi\{\d+\}/g, "")
    .replace(/\\(?:bg|fg)_[A-Za-z0-9]+\b/g, "")
    .replace(/\\(?:inline|displaystyle)\b/g, "")
    .trim();
}

function looksLikeMarkdownTableRow(value: string) {
  return value.startsWith("|") && value.endsWith("|") && (value.match(/\|/g)?.length ?? 0) >= 3;
}

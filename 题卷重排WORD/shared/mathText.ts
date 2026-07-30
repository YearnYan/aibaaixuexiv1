import {
  canRenderFormulaInKatex,
  escapeFormulaTextForMarkdown,
  normalizeEducationalUnicode,
  normalizeFormulaImageMarkdown,
  normalizePortableLatex,
  toReadableFormulaText,
} from "./formulaText.js";

const LATEX_COMMANDS = [
  "frac",
  "dfrac",
  "tfrac",
  "binom",
  "dbinom",
  "tbinom",
  "sqrt",
  "begin",
  "end",
  "left",
  "right",
  "middle",
  "big",
  "Big",
  "bigg",
  "Bigg",
  "overline",
  "underline",
  "vec",
  "overleftarrow",
  "overbrace",
  "underbrace",
  "overset",
  "underset",
  "stackrel",
  "widetilde",
  "widehat",
  "tilde",
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "ln",
  "log",
  "lg",
  "lim",
  "sum",
  "prod",
  "int",
  "iint",
  "iiint",
  "oint",
  "le",
  "ge",
  "leq",
  "geq",
  "ne",
  "neq",
  "approx",
  "sim",
  "equiv",
  "mid",
  "cap",
  "cup",
  "in",
  "notin",
  "subset",
  "subseteq",
  "supset",
  "supseteq",
  "parallel",
  "perp",
  "cdot",
  "times",
  "div",
  "pm",
  "mp",
  "angle",
  "triangle",
  "circ",
  "degree",
  "to",
  "rightarrow",
  "leftarrow",
  "leftrightarrow",
  "Longrightarrow",
  "Longleftarrow",
  "Leftrightarrow",
  "Rightarrow",
  "Leftarrow",
  "mapsto",
  "xrightarrow",
  "xleftarrow",
  "xRightarrow",
  "xLeftarrow",
  "longrightarrow",
  "longleftarrow",
  "rightleftharpoons",
  "uparrow",
  "downarrow",
  "Delta",
  "nabla",
  "partial",
  "mu",
  "ohm",
  "Omega",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "varepsilon",
  "zeta",
  "eta",
  "theta",
  "vartheta",
  "iota",
  "kappa",
  "lambda",
  "pi",
  "omega",
  "nu",
  "xi",
  "rho",
  "sigma",
  "tau",
  "upsilon",
  "phi",
  "chi",
  "psi",
  "varphi",
  "varrho",
  "varpi",
  "varsigma",
  "Gamma",
  "Theta",
  "Lambda",
  "Xi",
  "Pi",
  "Sigma",
  "Upsilon",
  "Phi",
  "Psi",
  "because",
  "therefore",
  "text",
  "mathrm",
  "mathit",
  "operatorname",
  "mathbf",
  "boldsymbol",
  "bm",
  "bold",
  "mathbfit",
  "symbf",
  "symbfit",
  "mathbb",
  "Bbb",
  "mathsf",
  "mathtt",
  "mathcal",
  "mathscr",
  "mathfrak",
  "textrm",
  "mbox",
  "overrightarrow",
  "hat",
  "bar",
  "dot",
  "ddot",
  "infty",
  "varnothing",
  "emptyset",
  "forall",
  "exists",
  "propto",
  "cong",
  "simeq",
  "asymp",
  "land",
  "lor",
  "wedge",
  "vee",
  "neg",
  "setminus",
  "ni",
  "oplus",
  "otimes",
  "oslash",
  "odot",
  "ast",
  "bullet",
  "forall",
  "exists",
  "Re",
  "Im",
  "hbar",
  "ell",
  "ldots",
  "cdots",
  "vdots",
  "ddots",
  "prime",
  "pmod",
  "substack",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "array",
  "cases",
  "aligned",
  "alignedat",
  "align",
  "alignat",
  "gathered",
  "split",
  "min",
  "max",
  "arcsin",
  "arccos",
  "arctan",
  "ce",
];

const LATEX_COMMAND_PATTERN = LATEX_COMMANDS.join("|");
const EXISTING_LATEX_MATH_PATTERN = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g;
const MARKDOWN_DISPLAY_MATH_PATTERN = /\$\$([\s\S]*?)\$\$/g;
const MARKDOWN_INLINE_MATH_PATTERN = /\$([^$\n]+)\$/g;
const BARE_LATEX_TRIGGER_PATTERN = new RegExp(
  `\\\\(?:${LATEX_COMMAND_PATTERN}|[A-Za-z]+)(?![a-zA-Z])|\\\\[{}()[\\]]|[A-Za-z][A-Za-z0-9]*[_^](?:\\{[^{}]+\\}|[A-Za-z0-9+\\-\\u4e00-\\u9fff]+)|[A-Za-z][A-Za-z0-9]*[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜₓ]`,
  "g",
);
const TRAILING_PUNCTUATION_PATTERN = /([,.;:!?，。；：！？、]+)$/;
const ASCII_UNIT_TEXT_PATTERN = /^[A-Za-z0-9/%·.,+\-^_()℃°\s]+$/;
const ELEMENT_SYMBOLS = [
  "Ac", "Ag", "Al", "Am", "Ar", "As", "At", "Au", "Ba", "Be", "Bh", "Bi", "Bk", "Br", "Ca", "Cd", "Ce", "Cf",
  "Cl", "Cm", "Cn", "Co", "Cr", "Cs", "Cu", "Db", "Ds", "Dy", "Er", "Es", "Eu", "Fe", "Fl", "Fm", "Fr", "Ga",
  "Gd", "Ge", "He", "Hf", "Hg", "Ho", "Hs", "In", "Ir", "Kr", "La", "Li", "Lr", "Lu", "Lv", "Mc", "Md", "Mg",
  "Mn", "Mo", "Mt", "Na", "Nb", "Nd", "Ne", "Nh", "Ni", "No", "Np", "Og", "Os", "Pa", "Pb", "Pd", "Pm", "Po",
  "Pr", "Pt", "Pu", "Ra", "Rb", "Re", "Rf", "Rg", "Rh", "Rn", "Ru", "Sb", "Sc", "Se", "Sg", "Si", "Sm", "Sn",
  "Sr", "Ta", "Tb", "Tc", "Te", "Th", "Ti", "Tl", "Tm", "Ts", "Xe", "Yb", "Zn", "Zr", "B", "C", "F", "H", "I",
  "K", "N", "O", "P", "S", "U", "V", "W", "Y",
];
const ELEMENT_PATTERN = ELEMENT_SYMBOLS.join("|");
const ELEMENT_TOKEN_PATTERN = new RegExp(`(?:${ELEMENT_PATTERN})`, "g");
const CHEMISTRY_TOKEN_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_\\\\])((?:(?:${ELEMENT_PATTERN}|\\([A-Za-z0-9]+\\))(?:\\d+)?){1,}(?:\\^?\\d*[+\\-]|[+\\-])?)`,
  "g",
);
const CHEMISTRY_REACTION_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_\\\\])((?:(?:\\d*\\s*)?(?:${ELEMENT_PATTERN})(?:\\d+)?|\\+|\\s+|->|<-|<=>|→|←|⇌|=){6,})`,
  "g",
);
const UNIT_PATTERN = "(?:m/s\\^?2|m/s²|m\\^?3/s|m³/s|m\\^?2/s|m²/s|km\\^?2|km²|m\\^?3|m³|m\\^?2|m²|cm\\^?3|cm³|cm\\^?2|cm²|mm\\^?2|mm²|kg/m\\^?3|kg/m³|g/cm\\^?3|g/cm³|N/m\\^?2|N/m²|W/m\\^?2|W/m²|mol[·.]?L(?:\\^?-?1|⁻¹)|mmol/L|μmol/L|mol/L|mg/mL|g/L|mL/min|L/min|km/h|N/kg|MPa|kPa|hPa|Pa|Hz|kHz|MHz|GHz|J|W|V|A|N|\\\\Omega|Ω|ohm|mol|mL|ml|kg|mg|km|cm|mm|μm|um|L|g|m|s|min|h|℃|°C|K|%)";
const LATEX_VARIABLE_MEASUREMENT_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_\\\\])((?:\\\\(?:Delta|delta|theta|mu|lambda|alpha|beta|gamma|omega|Omega)\\s*)?[A-Za-z](?:_\\{?[A-Za-z0-9\\u4e00-\\u9fff]+\\}?|[A-Za-z0-9])?\\s*=\\s*[+\\-]?\\d+(?:\\.\\d+)?\\s*)(${UNIT_PATTERN})(?![A-Za-z0-9_])`,
  "g",
);
const VARIABLE_MEASUREMENT_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_\\\\])([A-Za-z](?:_\\{?[A-Za-z0-9\\u4e00-\\u9fff]+\\}?|[A-Za-z0-9])?\\s*=\\s*[+\\-]?\\d+(?:\\.\\d+)?\\s*)(${UNIT_PATTERN})(?![A-Za-z0-9_])`,
  "g",
);
const STANDALONE_MEASUREMENT_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_\\\\])([+\\-]?\\d+(?:\\.\\d+)?\\s*)(${UNIT_PATTERN})(?![A-Za-z0-9_])`,
  "g",
);
const COORDINATE_PATTERN = /(^|[^A-Za-z0-9_\\])(\d+(?:\.\d+)?\s*(?:°|\\circ)\s*[NSEW])/g;
const CJK_PREFIX_IN_FORMULA_PATTERN = /^([\u4e00-\u9fff，。；：！？、,.;:!?\s]+)([A-Za-z0-9\\({])/;

export function normalizeRecognizedMathText(value: string) {
  const valueWithPortableFormulaImages = normalizeFormulaImageMarkdown(normalizeEducationalUnicode(value));
  const text = normalizePlainScienceOutsideMath(
    normalizeLatexEscapes(valueWithPortableFormulaImages)
      .replace(MARKDOWN_DISPLAY_MATH_PATTERN, (_match, formula: string) => `\\[${formula.trim()}\\]`)
      .replace(MARKDOWN_INLINE_MATH_PATTERN, (_match, formula: string) => `\\(${formula.trim()}\\)`),
  );

  return normalizeFormulaSegments(normalizeBareLatexSegments(text))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mathTextForMarkdown(value: string) {
  const markdown = normalizeRecognizedMathText(value)
    .replace(/\\\[((?:.|\n)*?)\\\]/g, (_match, formula: string) => formulaToMarkdown(formula, true))
    .replace(/\\\(((?:.|\n)*?)\\\)/g, (_match, formula: string) => formulaToMarkdown(formula, false));

  return prettifyResidualLatexOutsideMath(markdown);
}

export function normalizeQuestionMathFields<T extends { stemMarkdown: string; options?: string[] }>(question: T): T {
  return {
    ...question,
    stemMarkdown: normalizeRecognizedMathText(question.stemMarkdown),
    options: question.options?.map((option) => normalizeRecognizedMathText(option)) ?? [],
  };
}

function normalizeLatexEscapes(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\\\\([()[\]{}])/g, "\\$1")
    .replace(new RegExp(`\\\\\\\\(${LATEX_COMMAND_PATTERN})(?![a-zA-Z])`, "g"), "\\$1")
    .replace(/\\\\\\\\([A-Za-z]+)(?![a-zA-Z])/g, "\\$1")
    .replace(/\\text\{([^{}]+)\}/g, (_match, content: string) => {
      return ASCII_UNIT_TEXT_PATTERN.test(content) ? `\\mathrm{${content}}` : `\\text{${content}}`;
    })
    .replace(/([A-Za-z])_\{([\u4e00-\u9fff]+)\}/g, "$1_{\\text{$2}}")
    .replace(/([A-Za-z])_([\u4e00-\u9fff]+)/g, "$1_{\\text{$2}}")
    .replace(/[ \t]+/g, " ");
}

function normalizeFormulaSegments(value: string) {
  return value.replace(EXISTING_LATEX_MATH_PATTERN, (rawFormula) => {
    const display = rawFormula.startsWith("\\[");
    const formula = rawFormula.slice(2, -2);
    const normalized = normalizePortableLatex(formula);
    return display ? `\\[${normalized}\\]` : `\\(${normalized}\\)`;
  });
}

function formulaToMarkdown(formula: string, display: boolean) {
  const normalized = normalizePortableLatex(formula);
  if (!canRenderFormulaInKatex(normalized, display)) {
    return escapeFormulaTextForMarkdown(toReadableFormulaText(normalized));
  }
  return display ? `\n$$\n${normalized}\n$$\n` : `$${normalized}$`;
}

function normalizePlainScienceOutsideMath(value: string) {
  const parts: string[] = [];
  let cursor = 0;

  for (const match of value.matchAll(EXISTING_LATEX_MATH_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(normalizePlainScienceText(value.slice(cursor, index)));
    }
    parts.push(match[0]);
    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    parts.push(normalizePlainScienceText(value.slice(cursor)));
  }

  return parts.join("");
}

function normalizePlainScienceText(value: string) {
  return value
    .replace(CHEMISTRY_REACTION_PATTERN, (match, prefix: string, expression: string) => {
      if (!looksLikeChemistryReaction(expression)) return match;
      return `${prefix}\\(${normalizeChemistryExpressionToLatex(expression)}\\)`;
    })
    .replace(CHEMISTRY_TOKEN_PATTERN, (match, prefix: string, token: string) => {
      const latex = chemistryTokenToLatex(token);
      return latex ? `${prefix}\\(${latex}\\)` : match;
    })
    .replace(LATEX_VARIABLE_MEASUREMENT_PATTERN, (_match, prefix: string, left: string, unit: string) => {
      return `${prefix}\\(${normalizeVariableLeft(left)}\\ \\mathrm{${normalizeUnitLatex(unit)}}\\)`;
    })
    .replace(VARIABLE_MEASUREMENT_PATTERN, (_match, prefix: string, left: string, unit: string) => {
      return `${prefix}\\(${normalizeVariableLeft(left)}\\ \\mathrm{${normalizeUnitLatex(unit)}}\\)`;
    })
    .replace(STANDALONE_MEASUREMENT_PATTERN, (_match, prefix: string, number: string, unit: string) => {
      return `${prefix}\\(${number.trim()}\\ \\mathrm{${normalizeUnitLatex(unit)}}\\)`;
    })
    .replace(COORDINATE_PATTERN, (_match, prefix: string, coordinate: string) => {
      return `${prefix}\\(${coordinate.replace(/°|\\circ/g, "^\\circ ").replace(/\s+/g, " ").trim()}\\)`;
    });
}

function normalizeBareLatexSegments(value: string) {
  const parts: string[] = [];
  let cursor = 0;

  for (const match of value.matchAll(EXISTING_LATEX_MATH_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(wrapBareLatexInPlainText(value.slice(cursor, index)));
    }
    parts.push(match[0]);
    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    parts.push(wrapBareLatexInPlainText(value.slice(cursor)));
  }

  return parts.join("");
}

function wrapBareLatexInPlainText(value: string) {
  const parts: string[] = [];
  let cursor = 0;
  const triggerPattern = new RegExp(BARE_LATEX_TRIGGER_PATTERN);

  for (const match of value.matchAll(triggerPattern)) {
    const triggerIndex = match.index ?? 0;
    if (triggerIndex < cursor) continue;

    const range = findFormulaRange(value, triggerIndex);
    if (!range || range.end <= range.start) continue;

    const rawFormula = value.slice(range.start, range.end);
    const { prefix, formula } = detachOptionPrefix(rawFormula);
    const clean = trimFormulaEdges(formula);
    const readable = detachReadableTextPrefix(clean.formula);
    if (!readable.formula || !hasBareLatex(readable.formula)) continue;

    parts.push(value.slice(cursor, range.start));
    parts.push(prefix, clean.leading, readable.prefix, `\\(${readable.formula}\\)`, clean.trailing);
    cursor = range.end;
  }

  parts.push(value.slice(cursor));
  return parts.join("");
}

function findFormulaRange(value: string, triggerIndex: number) {
  let start = triggerIndex;
  let end = triggerIndex;

  while (start > 0 && canExpandLeft(value, start)) {
    start -= 1;
  }

  while (end < value.length && isFormulaCharacter(value[end])) {
    if (isOptionBoundary(value, end)) break;
    end += 1;
  }

  while (start < end && /\s/.test(value[start])) start += 1;
  while (end > start && /\s/.test(value[end - 1])) end -= 1;

  return { start, end };
}

function canExpandLeft(value: string, index: number) {
  const char = value[index - 1];
  if (!isFormulaCharacter(char)) return false;

  if (/\s/.test(char)) {
    const previous = previousNonSpace(value, index - 1);
    return Boolean(previous && /[A-Za-z0-9\\)}\]}>_=+\-*/|]/.test(previous));
  }

  return true;
}

function previousNonSpace(value: string, index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (!/\s/.test(value[cursor])) return value[cursor];
  }
  return "";
}

function isFormulaCharacter(char: string | undefined) {
  return Boolean(char && /[A-Za-z0-9\\{}()[\]^_+\-*/=<>|&~!#.,:;'" \t°℃·→←⇌↑↓⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜₓ\u4e00-\u9fff]/.test(char));
}

function isOptionBoundary(value: string, index: number) {
  if (!/\s/.test(value[index - 1] ?? "")) return false;
  return /^[A-H][.、]\s/.test(value.slice(index));
}

function detachOptionPrefix(value: string) {
  const match = value.match(/^([A-H][.、]\s*)([\s\S]+)$/);
  if (!match) return { prefix: "", formula: value };
  return { prefix: match[1], formula: match[2] };
}

function trimFormulaEdges(value: string) {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  let formula = value.trimStart();
  const trailingSpaces = formula.match(/\s*$/)?.[0] ?? "";
  formula = formula.trimEnd();

  const trailingPunctuation = formula.match(TRAILING_PUNCTUATION_PATTERN)?.[0] ?? "";
  if (trailingPunctuation) {
    formula = formula.slice(0, -trailingPunctuation.length);
  }

  return {
    leading,
    formula,
    trailing: `${trailingPunctuation}${trailingSpaces}`,
  };
}

function hasBareLatex(value: string) {
  return new RegExp(BARE_LATEX_TRIGGER_PATTERN).test(value);
}

function detachReadableTextPrefix(value: string) {
  const match = value.match(CJK_PREFIX_IN_FORMULA_PATTERN);
  if (!match) return { prefix: "", formula: value };
  return {
    prefix: match[1],
    formula: value.slice(match[1].length),
  };
}

function prettifyResidualLatexOutsideMath(value: string) {
  const parts: string[] = [];
  const mathPattern = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;
  let cursor = 0;

  for (const match of value.matchAll(mathPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(prettifyResidualLatex(value.slice(cursor, index)));
    }
    parts.push(match[0]);
    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    parts.push(prettifyResidualLatex(value.slice(cursor)));
  }

  return parts.join("");
}

function prettifyResidualLatex(value: string) {
  return value
    .replace(/\\(?:text|mathrm)\{([^{}]+)\}/g, (_match, content: string) => prettifyPlainUnit(content))
    .replace(/\\dfrac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\\rightarrow|\\to/g, "→")
    .replace(/\\leftarrow/g, "←")
    .replace(/\\rightleftharpoons/g, "⇌")
    .replace(/\\uparrow/g, "↑")
    .replace(/\\downarrow/g, "↓")
    .replace(/\\leq?|\\le/g, "≤")
    .replace(/\\geq?|\\ge/g, "≥")
    .replace(/\\neq?|\\ne/g, "≠")
    .replace(/\\approx/g, "≈")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\cap/g, "∩")
    .replace(/\\cup/g, "∪")
    .replace(/\\in/g, "∈")
    .replace(/\\notin/g, "∉")
    .replace(/\\subseteq/g, "⊆")
    .replace(/\\subset/g, "⊂")
    .replace(/\\supseteq/g, "⊇")
    .replace(/\\supset/g, "⊃")
    .replace(/\\parallel/g, "∥")
    .replace(/\\perp/g, "⊥")
    .replace(/\\angle/g, "∠")
    .replace(/\\triangle/g, "△")
    .replace(/\\circ/g, "°")
    .replace(/\\degree/g, "°")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\delta/g, "δ")
    .replace(/\\theta/g, "θ")
    .replace(/\\lambda/g, "λ")
    .replace(/\\mu/g, "μ")
    .replace(/\\pi/g, "π")
    .replace(/\\Omega/g, "Ω")
    .replace(/\\ohm/g, "Ω")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\ /g, " ")
    .replace(/\\([{}()[\]])/g, "$1");
}

function prettifyPlainUnit(value: string) {
  return value
    .replace(/\^2/g, "²")
    .replace(/\^3/g, "³")
    .replace(/\^-1/g, "⁻¹")
    .replace(/\^-2/g, "⁻²")
    .replace(/\^-3/g, "⁻³")
    .replace(/_/g, "");
}

function looksLikeChemistryReaction(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (!/(?:->|<-|<=>|→|←|⇌|=|\+)/.test(compact)) return false;
  const elementMatches = compact.match(ELEMENT_TOKEN_PATTERN) ?? [];
  return elementMatches.length >= 2 && /\d|->|<-|<=>|→|←|⇌|=|\+/.test(compact);
}

function normalizeChemistryExpressionToLatex(value: string) {
  return value
    .replace(/<=>|⇌/g, "\\rightleftharpoons")
    .replace(/->|→/g, "\\rightarrow")
    .replace(/<-|←/g, "\\leftarrow")
    .replace(/[＋]/g, "+")
    .replace(new RegExp(`(${ELEMENT_PATTERN}|\\))([0-9]+)`, "g"), "$1_$2")
    .replace(/\)([0-9]+)/g, ")_$1")
    .replace(/\s+/g, "");
}

function chemistryTokenToLatex(token: string) {
  const clean = token.trim();
  if (!clean || clean.length < 2) return null;
  if (!hasBalancedParentheses(clean)) return null;

  const elementMatches = clean.match(ELEMENT_TOKEN_PATTERN) ?? [];
  if (!elementMatches.length) return null;

  const hasChemistrySignal = /\d|[+-]$|\([A-Za-z0-9]+\)/.test(clean) || elementMatches.length >= 2;
  if (!hasChemistrySignal) return null;

  const rebuilt = elementMatches.join("");
  const lettersOnly = clean.replace(/[^A-Za-z]/g, "");
  if (rebuilt !== lettersOnly) return null;

  return normalizeChemistryTokenToLatex(clean);
}

function normalizeChemistryTokenToLatex(value: string) {
  const explicitCharge = value.match(/^(.*?)\^(\d*)([+-])$/);
  if (explicitCharge) {
    return `${normalizeChemistryExpressionToLatex(explicitCharge[1])}^{${explicitCharge[2]}${explicitCharge[3]}}`;
  }

  const signed = value.match(/^(.*?)([+-])$/);
  if (!signed) {
    return normalizeChemistryExpressionToLatex(value);
  }

  const body = signed[1];
  const chargeSign = signed[2];
  const trailingNumber = body.match(/^(.*?)(\d+)$/);
  if (!trailingNumber) {
    return `${normalizeChemistryExpressionToLatex(body)}^{${chargeSign}}`;
  }

  const bodyBeforeNumber = trailingNumber[1];
  const number = trailingNumber[2];
  const elementMatches = bodyBeforeNumber.match(ELEMENT_TOKEN_PATTERN) ?? [];
  const isSingleElementIon = elementMatches.length === 1 && elementMatches[0] === bodyBeforeNumber;
  if (isSingleElementIon) {
    return `${normalizeChemistryExpressionToLatex(bodyBeforeNumber)}^{${number}${chargeSign}}`;
  }

  return `${normalizeChemistryExpressionToLatex(body)}^{${chargeSign}}`;
}

function hasBalancedParentheses(value: string) {
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function normalizeVariableLeft(value: string) {
  return value
    .trim()
    .replace(/([A-Za-z])_([\u4e00-\u9fff]+)/g, "$1_{\\text{$2}}");
}

function normalizeUnitLatex(value: string) {
  return value
    .trim()
    .replace(/Ω|ohm/gi, "\\Omega")
    .replace(/μ/g, "\\mu ")
    .replace(/um\b/g, "\\mu m")
    .replace(/°C/g, "^{\\circ}C")
    .replace(/℃/g, "^{\\circ}C")
    .replace(/m\/s²/g, "m/s^2")
    .replace(/m³\/s/g, "m^3/s")
    .replace(/kg\/m³/g, "kg/m^3")
    .replace(/g\/cm³/g, "g/cm^3")
    .replace(/⁻¹/g, "^-1")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/[·⋅]/g, "\\cdot ")
    .replace(/\s+/g, " ")
    .trim();
}

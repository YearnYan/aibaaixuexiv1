import {
  BuilderElement,
  Math as OfficeMath,
  MathFraction,
  MathLimitLower,
  MathLimitUpper,
  MathPreSubSuperScript,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
  XmlComponent
} from "docx";
import JSZip from "jszip";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { STATE } from "mathjax-full/js/core/MathItem.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { formulaCacheKey, validateLatex } from "../formula.js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: AllPackages });
const svgOutput = new SVG({ fontCache: "none" });
const mathDocument = mathjax.document("", { InputJax: tex, OutputJax: svgOutput });
const mmlCache = new Map();

const NARY_OPERATORS = new Set(["∑", "∏", "∫", "∮", "⋂", "⋃", "∐"]);
const NARY_BOUNDARIES = new Set(["=", "≈", "≠", "<", ">", "≤", "≥", "≡", "∼", ",", ";"]);
const OPEN_FENCES = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["|", "|"],
  ["‖", "‖"],
  ["⟨", "⟩"],
  ["⌈", "⌉"],
  ["⌊", "⌋"]
]);
const NORMAL_TOKEN_REPLACEMENTS = new Map([
  ["∘", "°"],
  ["−", "−"],
  ["⁡", ""]
]);
const DOUBLE_STRUCK_EXCEPTIONS = new Map([
  ["C", "ℂ"], ["H", "ℍ"], ["N", "ℕ"], ["P", "ℙ"],
  ["Q", "ℚ"], ["R", "ℝ"], ["Z", "ℤ"]
]);

class OfficeMathText extends XmlComponent {
  constructor(text) {
    super("m:t");
    this.root.push(String(text));
  }
}

class StyledOfficeMathRun extends XmlComponent {
  constructor(text, style = "p") {
    super("m:r");
    if (style) {
      this.root.push(new BuilderElement({
        name: "m:rPr",
        children: [valueElement("m:sty", "m:val", style)]
      }));
    }
    this.root.push(new OfficeMathText(text));
  }
}

function valueElement(name, key, value) {
  return new BuilderElement({
    name,
    attributes: { value: { key, value } }
  });
}

function mathArgument(name, children) {
  return new BuilderElement({ name, children });
}

function getChildren(node) {
  return (node?.childNodes || []).filter(Boolean);
}

function getAttribute(node, name) {
  return node?.attributes?.get?.(name) ?? node?.attributes?.getAllAttributes?.()?.[name];
}

function getTokenText(node) {
  if (!node?.isToken) return "";
  const text = String(node.getText?.() || "");
  return NORMAL_TOKEN_REPLACEMENTS.has(text) ? NORMAL_TOKEN_REPLACEMENTS.get(text) : text;
}

function mapDoubleStruckCharacter(character) {
  if (DOUBLE_STRUCK_EXCEPTIONS.has(character)) return DOUBLE_STRUCK_EXCEPTIONS.get(character);
  const code = character.codePointAt(0);
  if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D538 + code - 65);
  if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D552 + code - 97);
  if (code >= 48 && code <= 57) return String.fromCodePoint(0x1D7D8 + code - 48);
  return character;
}

function applyMathVariant(text, variant) {
  if (variant !== "double-struck") return text;
  return [...text].map(mapDoubleStruckCharacter).join("");
}

function addRequiredText(state, text) {
  const matches = String(text).match(/[\p{L}\p{N}]+/gu) || [];
  matches.forEach((token) => {
    if (!state.requiredText.includes(token)) state.requiredText.push(token);
  });
}

function createTokenRun(node, state) {
  const rawText = getTokenText(node);
  if (!rawText) return [];
  const variant = String(getAttribute(node, "mathvariant") || "");
  const text = applyMathVariant(rawText, variant);
  addRequiredText(state, text);
  if (variant === "double-struck") return [new StyledOfficeMathRun(text, "p")];
  const style = variant === "normal"
    ? "p"
    : variant === "bold"
      ? "b"
      : variant === "bold-italic"
        ? "bi"
        : variant === "italic"
          ? "i"
          : "";
  const shouldStayPlain = ["mn", "mo", "mtext", "ms"].includes(node.kind)
    || (node.kind === "mi" && rawText.length > 1);
  return [style || shouldStayPlain
    ? new StyledOfficeMathRun(text, style || "p")
    : new MathRun(text)];
}

function hasMmlKind(node, kind) {
  if (!node) return false;
  if (node.kind === kind) return true;
  return getChildren(node).some((child) => hasMmlKind(child, kind));
}

function visibleNodeText(node) {
  if (!node || node.kind === "mphantom" || node.kind === "annotation") return "";
  if (node.isToken) return getTokenText(node);
  return getChildren(node).map(visibleNodeText).join("");
}

function createDelimiter(begin, end, children, state) {
  state.tags.add("m:d");
  return new BuilderElement({
    name: "m:d",
    children: [
      new BuilderElement({
        name: "m:dPr",
        children: [
          valueElement("m:begChr", "m:val", begin),
          valueElement("m:endChr", "m:val", end),
          valueElement("m:grow", "m:val", 1)
        ]
      }),
      mathArgument("m:e", children)
    ]
  });
}

function detectDelimiter(nodes) {
  if (nodes.length < 2) return null;
  const begin = getTokenText(nodes[0]);
  const end = getTokenText(nodes.at(-1));
  const expectedEnd = OPEN_FENCES.get(begin);
  if (!expectedEnd) return null;
  if (end === expectedEnd) return { begin, end, body: nodes.slice(1, -1) };
  if (!end && getAttribute(nodes.at(-1), "fence")) {
    return { begin, end: "", body: nodes.slice(1, -1) };
  }
  return null;
}

function createMatrix(node, state) {
  const rows = getChildren(node).filter((row) => ["mtr", "mlabeledtr"].includes(row.kind));
  if (!rows.length) throw createWordMathError("矩阵没有可编辑行", state.latex);
  state.tags.add("m:m");
  const matrixRows = rows.map((row) => {
    const cells = getChildren(row).filter((cell) => cell.kind === "mtd");
    if (!cells.length) throw createWordMathError("矩阵行没有可编辑单元格", state.latex);
    return new BuilderElement({
      name: "m:mr",
      children: cells.map((cell) => mathArgument("m:e", convertSequence(getChildren(cell), state)))
    });
  });
  return new BuilderElement({
    name: "m:m",
    children: [
      new BuilderElement({
        name: "m:mPr",
        children: [valueElement("m:baseJc", "m:val", "center")]
      }),
      ...matrixRows
    ]
  });
}

function createAccent(accent, children, state) {
  state.tags.add("m:acc");
  return new BuilderElement({
    name: "m:acc",
    children: [
      new BuilderElement({
        name: "m:accPr",
        children: [valueElement("m:chr", "m:val", accent)]
      }),
      mathArgument("m:e", children)
    ]
  });
}

function createBar(position, children, state) {
  state.tags.add("m:bar");
  return new BuilderElement({
    name: "m:bar",
    children: [
      new BuilderElement({
        name: "m:barPr",
        children: [valueElement("m:pos", "m:val", position)]
      }),
      mathArgument("m:e", children)
    ]
  });
}

function createBorderBox(node, state) {
  const notation = String(getAttribute(node, "notation") || "box");
  const properties = [];
  if (/horizontalstrike/u.test(notation)) properties.push(valueElement("m:strikeH", "m:val", 1));
  if (/verticalstrike/u.test(notation)) properties.push(valueElement("m:strikeV", "m:val", 1));
  if (/updiagonalstrike/u.test(notation)) properties.push(valueElement("m:strikeBLTR", "m:val", 1));
  if (/downdiagonalstrike/u.test(notation)) properties.push(valueElement("m:strikeTLBR", "m:val", 1));
  state.tags.add("m:borderBox");
  return new BuilderElement({
    name: "m:borderBox",
    children: [
      ...(properties.length ? [new BuilderElement({ name: "m:borderBoxPr", children: properties })] : []),
      mathArgument("m:e", convertSequence(getChildren(node), state))
    ]
  });
}

function createNoBarFraction(numerator, denominator, state) {
  state.tags.add("m:f");
  return new BuilderElement({
    name: "m:f",
    children: [
      new BuilderElement({
        name: "m:fPr",
        children: [valueElement("m:type", "m:val", "noBar")]
      }),
      mathArgument("m:num", numerator),
      mathArgument("m:den", denominator)
    ]
  });
}

function createNary(operator, subScript, superScript, body, state) {
  state.tags.add("m:nary");
  const properties = [
    valueElement("m:chr", "m:val", operator),
    valueElement("m:limLoc", "m:val", state.display ? "undOvr" : "subSup"),
    valueElement("m:grow", "m:val", 1)
  ];
  if (!subScript.length) properties.push(valueElement("m:subHide", "m:val", 1));
  if (!superScript.length) properties.push(valueElement("m:supHide", "m:val", 1));
  return new BuilderElement({
    name: "m:nary",
    children: [
      new BuilderElement({ name: "m:naryPr", children: properties }),
      mathArgument("m:sub", subScript),
      mathArgument("m:sup", superScript),
      mathArgument("m:e", body.length ? body : [new StyledOfficeMathRun(" ", "p")])
    ]
  });
}

function getNaryParts(node) {
  if (!["msubsup", "munderover", "msub", "msup", "munder", "mover"].includes(node?.kind)) return null;
  const nodes = getChildren(node);
  const operator = visibleNodeText(nodes[0]);
  if (!NARY_OPERATORS.has(operator)) return null;
  const hasSub = ["msubsup", "munderover", "msub", "munder"].includes(node.kind);
  const hasSuper = ["msubsup", "munderover", "msup", "mover"].includes(node.kind);
  return {
    operator,
    subNode: hasSub ? nodes[1] : null,
    superNode: hasSuper ? nodes[hasSub ? 2 : 1] : null
  };
}

function isNaryBoundary(node) {
  return node?.kind === "mo" && NARY_BOUNDARIES.has(getTokenText(node));
}

function convertScriptNode(node, state, output = null) {
  const nodes = getChildren(node);
  let base = convertNode(nodes[0], state);
  if (!base.length && output?.length) base = [output.pop()];
  if (!base.length) throw createWordMathError("上下标缺少可编辑主体", state.latex);
  if (node.kind === "msub") {
    state.tags.add("m:sSub");
    return new MathSubScript({ children: base, subScript: convertNode(nodes[1], state) });
  }
  if (node.kind === "msup") {
    state.tags.add("m:sSup");
    return new MathSuperScript({ children: base, superScript: convertNode(nodes[1], state) });
  }
  state.tags.add("m:sSubSup");
  return new MathSubSuperScript({
    children: base,
    subScript: convertNode(nodes[1], state),
    superScript: convertNode(nodes[2], state)
  });
}

function convertMultiScripts(node, state) {
  const nodes = getChildren(node);
  const markerIndex = nodes.findIndex((child) => child.kind === "mprescripts");
  let result = convertNode(nodes[0], state);
  const post = nodes.slice(1, markerIndex >= 0 ? markerIndex : nodes.length);
  const pre = markerIndex >= 0 ? nodes.slice(markerIndex + 1) : [];
  if (post.length) {
    state.tags.add("m:sSubSup");
    result = [new MathSubSuperScript({
      children: result,
      subScript: convertNode(post[0], state),
      superScript: convertNode(post[1], state)
    })];
  }
  if (pre.length) {
    state.tags.add("m:sPre");
    result = [new MathPreSubSuperScript({
      children: result,
      subScript: convertNode(pre[0], state),
      superScript: convertNode(pre[1], state)
    })];
  }
  return result;
}

function convertSequence(nodes, state) {
  const output = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const nary = getNaryParts(node);
    if (nary) {
      let end = index + 1;
      while (end < nodes.length && !isNaryBoundary(nodes[end])) end += 1;
      const bodyNodes = nodes.slice(index + 1, end);
      output.push(createNary(
        nary.operator,
        nary.subNode ? convertNode(nary.subNode, state) : [],
        nary.superNode ? convertNode(nary.superNode, state) : [],
        convertSequence(bodyNodes, state),
        state
      ));
      index = end - 1;
      continue;
    }
    if (["msub", "msup", "msubsup"].includes(node.kind)) {
      output.push(convertScriptNode(node, state, output));
      continue;
    }
    output.push(...convertNode(node, state));
  }
  return output;
}

function convertNode(node, state) {
  if (!node) return [];
  if (node.isToken) return createTokenRun(node, state);

  const nodes = getChildren(node);
  switch (node.kind) {
    case "math":
    case "inferredMrow":
    case "TeXAtom":
    case "mstyle":
    case "mpadded":
    case "semantics":
    case "maction":
    case "mtd":
      return convertSequence(nodes.filter((child) => child.kind !== "annotation"), state);
    case "mrow": {
      const delimiter = detectDelimiter(nodes);
      return delimiter
        ? [createDelimiter(delimiter.begin, delimiter.end, convertSequence(delimiter.body, state), state)]
        : convertSequence(nodes, state);
    }
    case "mspace": {
      const width = String(getAttribute(node, "width") || "");
      if (!width || width.startsWith("-")) return [];
      return [new StyledOfficeMathRun(/(?:1em|2em|3em)/u.test(width) ? " " : " ", "p")];
    }
    case "mphantom":
    case "annotation":
    case "annotation-xml":
    case "none":
    case "mprescripts":
    case "maligngroup":
    case "malignmark":
      return [];
    case "mfrac": {
      const numerator = convertNode(nodes[0], state);
      const denominator = convertNode(nodes[1], state);
      state.tags.add("m:f");
      return [String(getAttribute(node, "linethickness") || "") === "0"
        ? createNoBarFraction(numerator, denominator, state)
        : new MathFraction({ numerator, denominator })];
    }
    case "msqrt":
      state.tags.add("m:rad");
      return [new MathRadical({ children: convertSequence(nodes, state) })];
    case "mroot":
      state.tags.add("m:rad");
      return [new MathRadical({
        children: convertNode(nodes[0], state),
        degree: convertNode(nodes[1], state)
      })];
    case "msub":
    case "msup":
    case "msubsup":
      return [convertScriptNode(node, state)];
    case "mover": {
      const base = convertNode(nodes[0], state);
      const accent = visibleNodeText(nodes[1]);
      if (["―", "¯", "‾"].includes(accent)) return [createBar("top", base, state)];
      if (getAttribute(nodes[1], "accent") || nodes[1]?.properties?.mathaccent || ["→", "^", "~", "˙", "¨"].includes(accent)) {
        return [createAccent(accent, base, state)];
      }
      state.tags.add("m:limUpp");
      return [new MathLimitUpper({ children: base, limit: convertNode(nodes[1], state) })];
    }
    case "munder": {
      const base = convertNode(nodes[0], state);
      const under = visibleNodeText(nodes[1]);
      if (["_", "＿", "―"].includes(under)) return [createBar("bot", base, state)];
      state.tags.add("m:limLow");
      return [new MathLimitLower({ children: base, limit: convertNode(nodes[1], state) })];
    }
    case "munderover":
      state.tags.add("m:sSubSup");
      return [new MathSubSuperScript({
        children: convertNode(nodes[0], state),
        subScript: convertNode(nodes[1], state),
        superScript: convertNode(nodes[2], state)
      })];
    case "mmultiscripts":
      return convertMultiScripts(node, state);
    case "mtable":
      return [createMatrix(node, state)];
    case "menclose":
      return [createBorderBox(node, state)];
    case "merror":
      throw createWordMathError("MathJax 返回公式错误节点", state.latex);
    default:
      throw createWordMathError(`暂不支持的公式结构：${node.kind}`, state.latex);
  }
}

function createWordMathError(message, latex, cause) {
  const error = new Error(`Word 原生公式转换失败（${latex}）：${message}`);
  error.code = "WORD_MATH_CONVERSION_FAILED";
  error.cause = cause;
  return error;
}

function parseMml(latex, display) {
  const key = formulaCacheKey(latex, display);
  if (mmlCache.has(key)) return mmlCache.get(key);
  let root;
  try {
    root = mathDocument.convert(String(latex).trim(), {
      display: Boolean(display),
      end: STATE.CONVERT
    });
  } catch (error) {
    throw createWordMathError(error.message || "MathJax 无法解析", latex, error);
  }
  if (!root || hasMmlKind(root, "merror")) {
    throw createWordMathError("MathJax 未生成完整语义树", latex);
  }
  mmlCache.set(key, root);
  return root;
}

export function createEditableWordMath(latex, display = false) {
  const validation = validateLatex(latex, display);
  if (!validation.valid) throw createWordMathError(validation.error, latex);
  const root = parseMml(latex, display);
  const state = {
    latex: String(latex).trim(),
    display: Boolean(display),
    tags: new Set(),
    requiredText: []
  };
  const children = convertNode(root, state);
  if (!children.length) throw createWordMathError("公式没有可编辑内容", latex);
  return {
    math: new OfficeMath({ children }),
    metadata: {
      latex: state.latex,
      display: state.display,
      requiredTags: [...state.tags],
      requiredText: [...state.requiredText]
    }
  };
}

function decodeXmlText(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/giu, (match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/gu, (match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function normalizeComparableText(value) {
  return String(value).replace(/[\s\u2009\u2003]/gu, "");
}

export async function validateEditableWordMathPackage(buffer, formulas) {
  const expected = Array.isArray(formulas) ? formulas : [];
  const zip = await JSZip.loadAsync(buffer);
  const documentPart = zip.file("word/document.xml");
  if (!documentPart) throw createWordMathError("DOCX 缺少 word/document.xml", "document");
  const xml = await documentPart.async("string");
  const blocks = xml.match(/<m:oMath(?:\s[^>]*)?>[\s\S]*?<\/m:oMath>/gu) || [];
  if (blocks.length !== expected.length) {
    throw createWordMathError(`原生公式数量不一致，预期 ${expected.length}，实际 ${blocks.length}`, "document");
  }
  if (/<wp:docPr\b[^>]*(?:name="LaTeX:|title="(?:行内公式|独立公式)")/u.test(xml)) {
    throw createWordMathError("DOCX 仍包含旧公式图片标记", "document");
  }
  const blockDetails = blocks.map((block) => {
    if (/\$\$?|\\(?:frac|sqrt|ce|vec|mathrm|text)\b/u.test(block)) {
      throw createWordMathError("DOCX 包含未转换的原始 LaTeX", "document");
    }
    const editableText = normalizeComparableText(
      [...block.matchAll(/<m:t(?:\s[^>]*)?>([\s\S]*?)<\/m:t>/gu)]
        .map((match) => decodeXmlText(match[1]))
        .join("")
    );
    if (!editableText) throw createWordMathError("DOCX 原生公式没有可编辑字符", "document");
    return { block, editableText };
  });

  const compatibleBlocks = expected.map((formula) => blockDetails.map((detail, blockIndex) => {
    const tagsMatch = formula.requiredTags.every((tag) => detail.block.includes(`<${tag}`));
    const textMatches = formula.requiredText.every((token) => (
      detail.editableText.includes(normalizeComparableText(token))
    ));
    return tagsMatch && textMatches ? blockIndex : -1;
  }).filter((blockIndex) => blockIndex >= 0));
  const formulaOrder = expected
    .map((formula, index) => ({
      index,
      specificity: formula.requiredTags.length * 100
        + formula.requiredText.reduce((total, token) => total + token.length, 0)
    }))
    .sort((left, right) => right.specificity - left.specificity)
    .map((item) => item.index);
  const blockOwners = Array(blocks.length).fill(-1);

  const assignFormula = (formulaIndex, visited) => {
    for (const blockIndex of compatibleBlocks[formulaIndex]) {
      if (visited.has(blockIndex)) continue;
      visited.add(blockIndex);
      if (blockOwners[blockIndex] < 0 || assignFormula(blockOwners[blockIndex], visited)) {
        blockOwners[blockIndex] = formulaIndex;
        return true;
      }
    }
    return false;
  };

  formulaOrder.forEach((formulaIndex) => {
    if (assignFormula(formulaIndex, new Set())) return;
    const formula = expected[formulaIndex];
    throw createWordMathError(
      `DOCX 中没有同时满足结构 ${formula.requiredTags.join(", ") || "基础公式"} 与可编辑字符 ${formula.requiredText.join(", ") || "非空"} 的公式块`,
      formula.latex
    );
  });
  return { formulaCount: blocks.length, documentXml: xml };
}

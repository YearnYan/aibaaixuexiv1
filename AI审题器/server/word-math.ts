import katex from "katex";
import "katex/contrib/mhchem";
import { ImportedXmlComponent, convertToXmlComponent, type ParagraphChild } from "docx";
import xmlJs from "xml-js";
import type { Element as XmlElement } from "xml-js";

const { xml2js } = xmlJs;

type MathAst =
  | { kind: "text"; value: string; normal: boolean }
  | { kind: "fraction"; numerator: MathAst[]; denominator: MathAst[] }
  | { kind: "radical"; body: MathAst[]; degree?: MathAst[] }
  | { kind: "script"; base: MathAst[]; sub?: MathAst[]; sup?: MathAst[] }
  | { kind: "prescript"; base: MathAst[]; sub?: MathAst[]; sup?: MathAst[] }
  | { kind: "nary"; operator: string; body: MathAst[]; sub?: MathAst[]; sup?: MathAst[] }
  | { kind: "delimiter"; begin: string; end: string; body: MathAst[] }
  | { kind: "accent"; accent: string; body: MathAst[] }
  | { kind: "limit"; position: "lower" | "upper"; base: MathAst[]; limit: MathAst[] }
  | { kind: "matrix"; rows: MathAst[][][] };

const FENCE_PAIRS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["⟨", "⟩"],
  ["|", "|"],
  ["‖", "‖"],
]);

function elementsOf(node: XmlElement | undefined) {
  return (node?.elements || []).filter((child): child is XmlElement => child.type === "element");
}

function attribute(node: XmlElement | undefined, name: string) {
  const value = node?.attributes?.[name];
  return value === undefined ? "" : String(value);
}

function findElement(node: XmlElement, name: string): XmlElement | undefined {
  if (node.type === "element" && node.name === name) return node;
  for (const child of node.elements || []) {
    const match = findElement(child, name);
    if (match) return match;
  }
  return undefined;
}

function visibleText(node: XmlElement | undefined): string {
  if (!node || node.name === "annotation" || node.name === "mphantom") return "";
  return (node.elements || [])
    .map((child) => {
      if (child.type === "text") return String(child.text ?? "");
      return visibleText(child);
    })
    .join("");
}

function normalizeMathText(value: string) {
  return value
    .replace(/[\u2061-\u2064]/g, "")
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ")
    .replace(/\s+/g, " ");
}

function appendAst(target: MathAst[], incoming: MathAst[]) {
  for (const node of incoming) {
    if (node.kind === "text" && !node.value) continue;
    const previous = target.at(-1);
    if (previous?.kind === "text" && node.kind === "text" && previous.normal === node.normal) {
      previous.value += node.value;
    } else {
      target.push(node);
    }
  }
}

function isDetachedScript(node: XmlElement) {
  if (node.name !== "msub" && node.name !== "msup") return false;
  const base = elementsOf(node)[0];
  return attribute(base, "width") === "0px" && Boolean(findElement(base, "mphantom"));
}

function scriptFromDetached(node: XmlElement, previous: MathAst) {
  const script = nodeToAst(elementsOf(node)[1]);
  if (previous.kind === "script") {
    return node.name === "msub"
      ? { ...previous, sub: script }
      : { ...previous, sup: script };
  }
  return node.name === "msub"
    ? ({ kind: "script", base: [previous], sub: script } satisfies MathAst)
    : ({ kind: "script", base: [previous], sup: script } satisfies MathAst);
}

function sequenceToAst(nodes: XmlElement[]) {
  const result: MathAst[] = [];
  for (const node of nodes) {
    if (isDetachedScript(node)) {
      const previous = result.pop();
      if (!previous) throw new Error("分离上下标缺少可绑定的公式基底");
      appendAst(result, [scriptFromDetached(node, previous)]);
      continue;
    }
    appendAst(result, nodeToAst(node));
  }
  return result;
}

function fencedRowToAst(node: XmlElement) {
  const children = elementsOf(node).filter((child) => child.name !== "annotation");
  if (children.length < 2) return sequenceToAst(children);
  const begin = normalizeMathText(visibleText(children[0]));
  const end = normalizeMathText(visibleText(children.at(-1)));
  if (children[0].name === "mo" && children.at(-1)?.name === "mo" && FENCE_PAIRS.get(begin) === end) {
    return [{ kind: "delimiter", begin, end, body: sequenceToAst(children.slice(1, -1)) } satisfies MathAst];
  }
  return sequenceToAst(children);
}

function operatorAst(base: MathAst[], sub: MathAst[] | undefined, sup: MathAst[] | undefined): MathAst | undefined {
  const operator = astText(base).trim();
  if (["∑", "∏", "∐", "∫", "∮", "∯", "∰"].includes(operator)) {
    return { kind: "nary", operator, body: [], sub, sup };
  }
  return undefined;
}

function multiscriptsToAst(node: XmlElement) {
  const children = elementsOf(node);
  const base = nodeToAst(children[0]);
  const preIndex = children.findIndex((child) => child.name === "mprescripts");
  const post = children.slice(1, preIndex === -1 ? undefined : preIndex);
  const pre = preIndex === -1 ? [] : children.slice(preIndex + 1);
  let current: MathAst = base.length === 1 ? base[0] : { kind: "delimiter", begin: "", end: "", body: base };

  if (post.length) {
    const sub = nodeToAst(post[0]);
    const sup = nodeToAst(post[1]);
    current = { kind: "script", base: [current], sub: sub.length ? sub : undefined, sup: sup.length ? sup : undefined };
  }
  if (pre.length) {
    const sub = nodeToAst(pre[0]);
    const sup = nodeToAst(pre[1]);
    current = { kind: "prescript", base: [current], sub: sub.length ? sub : undefined, sup: sup.length ? sup : undefined };
  }
  return [current];
}

function matrixToAst(node: XmlElement) {
  const rows = elementsOf(node)
    .filter((row) => row.name === "mtr")
    .map((row) =>
      elementsOf(row)
        .filter((cell) => cell.name === "mtd")
        .map((cell) => sequenceToAst(elementsOf(cell))),
    );
  return [{ kind: "matrix", rows } satisfies MathAst];
}

function nodeToAst(node: XmlElement | undefined): MathAst[] {
  if (!node || node.name === "annotation" || node.name === "none" || node.name === "mprescripts" || node.name === "mphantom") {
    return [];
  }

  const children = elementsOf(node);
  switch (node.name) {
    case "math":
    case "span":
    case "mstyle":
    case "menclose":
    case "maction":
      return sequenceToAst(children);
    case "semantics": {
      const content = children.find((child) => child.name !== "annotation");
      return nodeToAst(content);
    }
    case "mrow":
      return fencedRowToAst(node);
    case "mpadded":
      if (attribute(node, "width") === "0px" && findElement(node, "mphantom")) return [];
      return sequenceToAst(children);
    case "mi":
    case "mn":
    case "mo":
    case "mtext": {
      const value = normalizeMathText(visibleText(node));
      if (!value) return [];
      return [{ kind: "text", value, normal: node.name === "mtext" || attribute(node, "mathvariant") === "normal" }];
    }
    case "mspace":
      return attribute(node, "width") === "0em" ? [] : [{ kind: "text", value: " ", normal: true }];
    case "mfrac":
      return [{ kind: "fraction", numerator: nodeToAst(children[0]), denominator: nodeToAst(children[1]) }];
    case "msqrt":
      return [{ kind: "radical", body: sequenceToAst(children) }];
    case "mroot":
      return [{ kind: "radical", body: nodeToAst(children[0]), degree: nodeToAst(children[1]) }];
    case "msub":
      return [{ kind: "script", base: nodeToAst(children[0]), sub: nodeToAst(children[1]) }];
    case "msup":
      return [{ kind: "script", base: nodeToAst(children[0]), sup: nodeToAst(children[1]) }];
    case "msubsup": {
      const base = nodeToAst(children[0]);
      const sub = nodeToAst(children[1]);
      const sup = nodeToAst(children[2]);
      return [operatorAst(base, sub, sup) || { kind: "script", base, sub, sup }];
    }
    case "mover": {
      const base = nodeToAst(children[0]);
      const over = nodeToAst(children[1]);
      if (!over.length) return base;
      if (attribute(node, "accent") === "true") {
        return [{ kind: "accent", accent: normalizeMathText(visibleText(children[1])).trim() || "¯", body: base }];
      }
      return [{ kind: "limit", position: "upper", base, limit: over }];
    }
    case "munder": {
      const base = nodeToAst(children[0]);
      return [{ kind: "limit", position: "lower", base, limit: nodeToAst(children[1]) }];
    }
    case "munderover": {
      const base = nodeToAst(children[0]);
      const sub = nodeToAst(children[1]);
      const sup = nodeToAst(children[2]);
      const operator = operatorAst(base, sub, sup);
      if (operator) return [operator];
      return [{ kind: "limit", position: "upper", base: [{ kind: "limit", position: "lower", base, limit: sub }], limit: sup }];
    }
    case "mfenced":
      return [{
        kind: "delimiter",
        begin: attribute(node, "open") || "(",
        end: attribute(node, "close") || ")",
        body: sequenceToAst(children),
      }];
    case "mtable":
      return matrixToAst(node);
    case "mtr":
    case "mtd":
      return sequenceToAst(children);
    case "mmultiscripts":
      return multiscriptsToAst(node);
    default: {
      if (children.length) return sequenceToAst(children);
      const value = normalizeMathText(visibleText(node));
      return value ? [{ kind: "text", value, normal: false }] : [];
    }
  }
}

function astText(nodes: MathAst[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text": return node.value;
        case "script": return astText(node.base);
        case "prescript": return astText(node.base);
        case "nary": return node.operator;
        case "delimiter": return `${node.begin}${astText(node.body)}${node.end}`;
        case "accent": return astText(node.body);
        case "limit": return astText(node.base);
        case "fraction": return `${astText(node.numerator)}/${astText(node.denominator)}`;
        case "radical": return astText(node.body);
        case "matrix": return node.rows.flatMap((row) => row.map((cell) => astText(cell))).join("");
      }
    })
    .join("");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function argument(tag: string, nodes: MathAst[]) {
  return `<m:${tag}>${astToOmml(nodes)}</m:${tag}>`;
}

function astToOmml(nodes: MathAst[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return `<m:r>${node.normal ? '<m:rPr><m:nor m:val="1"/></m:rPr>' : ""}<m:t xml:space="preserve">${escapeXml(node.value)}</m:t></m:r>`;
        case "fraction":
          return `<m:f>${argument("num", node.numerator)}${argument("den", node.denominator)}</m:f>`;
        case "radical":
          return `<m:rad><m:radPr>${node.degree?.length ? "" : '<m:degHide m:val="1"/>'}</m:radPr>${node.degree?.length ? argument("deg", node.degree) : ""}${argument("e", node.body)}</m:rad>`;
        case "script": {
          if (node.sub?.length && node.sup?.length) {
            return `<m:sSubSup><m:sSubSupPr/>${argument("e", node.base)}${argument("sub", node.sub)}${argument("sup", node.sup)}</m:sSubSup>`;
          }
          if (node.sub?.length) return `<m:sSub><m:sSubPr/>${argument("e", node.base)}${argument("sub", node.sub)}</m:sSub>`;
          if (node.sup?.length) return `<m:sSup><m:sSupPr/>${argument("e", node.base)}${argument("sup", node.sup)}</m:sSup>`;
          return astToOmml(node.base);
        }
        case "prescript":
          return `<m:sPre><m:sPrePr/>${argument("sub", node.sub || [])}${argument("sup", node.sup || [])}${argument("e", node.base)}</m:sPre>`;
        case "nary":
          return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(node.operator)}"/><m:limLoc m:val="${node.operator.includes("∫") ? "subSup" : "undOvr"}"/><m:grow m:val="1"/>${node.sub?.length ? "" : '<m:subHide m:val="1"/>'}${node.sup?.length ? "" : '<m:supHide m:val="1"/>'}</m:naryPr>${node.sub?.length ? argument("sub", node.sub) : ""}${node.sup?.length ? argument("sup", node.sup) : ""}${argument("e", node.body)}</m:nary>`;
        case "delimiter":
          if (!node.begin && !node.end) return astToOmml(node.body);
          return `<m:d><m:dPr><m:begChr m:val="${escapeXml(node.begin)}"/><m:endChr m:val="${escapeXml(node.end)}"/><m:grow m:val="1"/></m:dPr>${argument("e", node.body)}</m:d>`;
        case "accent":
          return `<m:acc><m:accPr><m:chr m:val="${escapeXml(node.accent)}"/></m:accPr>${argument("e", node.body)}</m:acc>`;
        case "limit": {
          const tag = node.position === "lower" ? "limLow" : "limUpp";
          return `<m:${tag}><m:${tag}Pr/>${argument("e", node.base)}${argument("lim", node.limit)}</m:${tag}>`;
        }
        case "matrix":
          return `<m:m><m:mPr/>${node.rows.map((row) => `<m:mr>${row.map((cell) => argument("e", cell)).join("")}</m:mr>`).join("")}</m:m>`;
      }
    })
    .join("");
}

export function latexToOmmlXml(latex: string) {
  const mathml = katex.renderToString(latex, {
    displayMode: false,
    throwOnError: true,
    strict: "ignore",
    trust: false,
    output: "mathml",
  });
  const parsed = xml2js(mathml, { compact: false, trim: false }) as XmlElement;
  const math = findElement(parsed, "math");
  if (!math) throw new Error(`公式未生成 MathML：${latex}`);
  const ast = nodeToAst(math);
  if (!ast.length) throw new Error(`公式未生成可编辑内容：${latex}`);
  return `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${astToOmml(ast)}</m:oMath>`;
}

export function createEditableWordMath(latex: string): ParagraphChild {
  const parsed = xml2js(latexToOmmlXml(latex), { compact: false, trim: false }) as XmlElement;
  const math = findElement(parsed, "m:oMath");
  if (!math) throw new Error(`公式未生成 Word 原生公式节点：${latex}`);

  const component = convertToXmlComponent(math);
  if (!(component instanceof ImportedXmlComponent)) {
    throw new Error(`公式未生成可导出的 Word 原生公式组件：${latex}`);
  }
  return component as unknown as ParagraphChild;
}

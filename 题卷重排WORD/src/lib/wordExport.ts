import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import JSZip from "jszip";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/cases/CasesConfiguration.js";
import "mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/noerrors/NoErrorsConfiguration.js";
import "mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { SerializedMmlVisitor } from "mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js";
import { mml2omml } from "mathml2omml";
import { normalizeRecognizedMathText } from "../../shared/mathText";
import {
  canRenderFormulaInKatex,
  isMarkdownTableSeparatorLine,
  markdownTextForWord,
  normalizePortableLatex,
  splitMathTextLines,
  toReadableFormulaText,
} from "../../shared/formulaText";
import {
  extractOptionLabel,
  normalizeOptionLabel,
  restoreVisualOptionLabels,
} from "../../shared/optionText";
import type { QuestionFigure, QuestionItem } from "../types";

type InlinePart =
  | { type: "text"; value: string }
  | { type: "math"; value: string; display: boolean };

type FormulaSlot = {
  token: string;
  latex: string;
  display: boolean;
};

type ExportPayload = {
  title?: string;
  questions: QuestionItem[];
};

const A4_WIDTH = 11906;
const A4_HEIGHT = 16838;
const PAGE_MARGIN = 900;
const CONTENT_WIDTH_DXA = A4_WIDTH - PAGE_MARGIN * 2;
const MAX_IMAGE_WIDTH = 460;
const MAX_OPTION_IMAGE_WIDTH = 190;
const MAX_OPTION_IMAGE_HEIGHT = 140;
const OPTION_TABLE_INDENT = 420;
const TEX_PACKAGES = ["base", "ams", "cases", "mathtools", "newcommand", "noerrors", "noundefined"];
const EMPTY_TABLE_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const WORD_TEXT_COLOR = "000000";
const BODY_FONT = "SimSun";
const TITLE_FONT = "SimSun";
const FORMULA_FONT = "Cambria Math";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const texInput = new TeX({ packages: TEX_PACKAGES });
const mathDocument = mathjax.document("", { InputJax: texInput });
const mmlVisitor = new SerializedMmlVisitor();

export async function exportQuestionsToDocx(input: ExportPayload) {
  const payload = validateExportPayload(input);
  const formulas: FormulaSlot[] = [];

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [
        new TextRun({
          text: payload.title,
          bold: false,
          color: WORD_TEXT_COLOR,
          size: 32,
          font: TITLE_FONT,
        }),
      ],
    }),
  ];

  for (const question of payload.questions) {
    const stemText = question.kind === "content"
      ? question.stemMarkdown
      : `${question.number}. ${question.stemMarkdown}`.trim();
    children.push(...buildMarkdownParagraphs(stemText, formulas));
    const visualOptionFigures = question.figures
      .filter(isVisualOptionFigure)
      .sort(compareVisualOptionFigures);
    children.push(...buildOptionBlocks(question.options, formulas, visualOptionFigures));

    for (const [figureIndex, figure] of question.figures.entries()) {
      if (isVisualOptionFigure(figure)) continue;
      const image = dataUrlToImage(figure.dataUrl);
      const size = fitImageSize(figure.width || 600, figure.height || 320);
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 60 },
        children: [
          new ImageRun({
            type: image.type,
            data: image.data,
            transformation: size,
            altText: {
              title: `${question.kind === "content" ? "资料" : `${question.number}题`}图片${figureIndex + 1}`,
              description: figure.caption || "资料图片",
              name: `${question.id}-figure-${figureIndex + 1}`,
            },
          }),
        ],
      }));
    }

    children.push(new Paragraph({ spacing: { after: 160 }, children: [blankRun()] }));
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 22, bold: false, color: WORD_TEXT_COLOR },
          paragraph: { spacing: { line: 360 } },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 32, bold: false, color: WORD_TEXT_COLOR, font: TITLE_FONT },
          paragraph: { spacing: { before: 120, after: 240 }, outlineLevel: 0 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: A4_WIDTH,
              height: A4_HEIGHT,
            },
            margin: {
              top: PAGE_MARGIN,
              right: PAGE_MARGIN,
              bottom: PAGE_MARGIN,
              left: PAGE_MARGIN,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return injectFormulaOmml(blob, formulas);
}

function validateExportPayload(input: ExportPayload) {
  const title = String(input?.title || "资料内容重排").trim() || "资料内容重排";
  const questions = Array.isArray(input?.questions) ? input.questions : [];

  if (!questions.length) {
    throw new Error("没有可导出的资料内容。");
  }

  return {
    title,
    questions: questions.map((question, index) => ({
      id: String(question.id || `q-${index + 1}`),
      kind: question.kind === "content" ? "content" as const : "question" as const,
      number: question.kind === "content" ? "" : String(question.number || index + 1),
      stemMarkdown: String(question.stemMarkdown || ""),
      options: Array.isArray(question.options) ? question.options.map(String) : [],
      figures: Array.isArray(question.figures) ? question.figures : [],
    })),
  };
}

function buildMarkdownParagraphs(
  text: string,
  formulas: FormulaSlot[],
  options: { indent?: number; compact?: boolean } = {},
) {
  const lines = splitMathTextLines(normalizeRecognizedMathText(text).replace(/\r\n/g, "\n"))
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !isMarkdownTableSeparatorLine(line));

  const paragraphs: Paragraph[] = [];

  for (const line of lines) {
    const parts = splitInlineMath(line);
    const hasDisplay = parts.some((part) => part.type === "math" && part.display);
    if (hasDisplay) {
      for (const part of parts) {
        if (part.type === "text" && part.value.trim()) {
          paragraphs.push(new Paragraph({
            indent: options.indent ? { left: options.indent } : undefined,
            children: [normalRun(part.value)],
          }));
        }
        if (part.type === "math") {
          paragraphs.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 80 },
            children: [formulaPlaceholder(part.value, formulas, true)],
          }));
        }
      }
      continue;
    }

    const children = parts.map((part) => {
      if (part.type === "text") {
        return normalRun(part.value);
      }
      return formulaPlaceholder(part.value, formulas, false);
    });

    paragraphs.push(new Paragraph({
      indent: options.indent ? { left: options.indent } : undefined,
      spacing: { after: options.compact ? 0 : 80 },
      children,
    }));
  }

  return paragraphs;
}

function buildOptionBlocks(
  options: string[],
  formulas: FormulaSlot[],
  optionFigures: VisualOptionFigure[] = [],
) {
  if (!options.length && !optionFigures.length) return [];

  if (optionFigures.length) {
    const normalizedOptions = restoreVisualOptionLabels(
      options,
      optionFigures.map((figure) => normalizeOptionLabel(figure.optionLabel)),
    );
    return [buildVisualOptionTable(normalizedOptions, formulas, optionFigures)];
  }

  if (!shouldUseOptionTable(options)) {
    return options.flatMap((option) => buildMarkdownParagraphs(option, formulas, { indent: OPTION_TABLE_INDENT }));
  }

  const tableWidth = CONTENT_WIDTH_DXA - OPTION_TABLE_INDENT;
  const leftColumnWidth = Math.floor(tableWidth / 2);
  const rightColumnWidth = tableWidth - leftColumnWidth;
  const rows: TableRow[] = [];

  for (let index = 0; index < options.length; index += 2) {
    rows.push(new TableRow({
      children: [
        optionCell(options[index], formulas, leftColumnWidth),
        optionCell(options[index + 1] || "", formulas, rightColumnWidth),
      ],
    }));
  }

  return [
    new Table({
      width: { size: tableWidth, type: WidthType.DXA },
      indent: { size: OPTION_TABLE_INDENT, type: WidthType.DXA },
      columnWidths: [leftColumnWidth, rightColumnWidth],
      layout: TableLayoutType.FIXED,
      borders: {
        top: EMPTY_TABLE_BORDER,
        bottom: EMPTY_TABLE_BORDER,
        left: EMPTY_TABLE_BORDER,
        right: EMPTY_TABLE_BORDER,
        insideHorizontal: EMPTY_TABLE_BORDER,
        insideVertical: EMPTY_TABLE_BORDER,
      },
      rows,
    }),
  ];
}

type VisualOptionFigure = QuestionFigure & { optionLabel: string };

type VisualOptionEntry = {
  text: string;
  label: string;
  figure?: VisualOptionFigure;
};

function isVisualOptionFigure(figure: QuestionFigure): figure is VisualOptionFigure {
  return figure.kind === "option" && Boolean(normalizeOptionLabel(figure.optionLabel));
}

function compareVisualOptionFigures(left: VisualOptionFigure, right: VisualOptionFigure) {
  return normalizeOptionLabel(left.optionLabel).localeCompare(normalizeOptionLabel(right.optionLabel));
}

function buildVisualOptionTable(
  options: string[],
  formulas: FormulaSlot[],
  optionFigures: VisualOptionFigure[],
) {
  const figuresByLabel = new Map(
    optionFigures.map((figure) => [normalizeOptionLabel(figure.optionLabel), figure]),
  );
  const usedLabels = new Set<string>();
  const entries: VisualOptionEntry[] = options.map((option) => {
    const label = extractOptionLabel(option);
    const figure = label ? figuresByLabel.get(label) : undefined;
    if (figure) usedLabels.add(label);
    return { text: option, label, figure };
  });

  for (const figure of optionFigures) {
    const label = normalizeOptionLabel(figure.optionLabel);
    if (!label || usedLabels.has(label)) continue;
    entries.push({ text: `${label}.`, label, figure });
    usedLabels.add(label);
  }

  const tableWidth = CONTENT_WIDTH_DXA - OPTION_TABLE_INDENT;
  const leftColumnWidth = Math.floor(tableWidth / 2);
  const rightColumnWidth = tableWidth - leftColumnWidth;
  const rows: TableRow[] = [];

  for (let index = 0; index < entries.length; index += 2) {
    rows.push(new TableRow({
      children: [
        visualOptionCell(entries[index], formulas, leftColumnWidth),
        visualOptionCell(entries[index + 1], formulas, rightColumnWidth),
      ],
    }));
  }

  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    indent: { size: OPTION_TABLE_INDENT, type: WidthType.DXA },
    columnWidths: [leftColumnWidth, rightColumnWidth],
    layout: TableLayoutType.FIXED,
    borders: {
      top: EMPTY_TABLE_BORDER,
      bottom: EMPTY_TABLE_BORDER,
      left: EMPTY_TABLE_BORDER,
      right: EMPTY_TABLE_BORDER,
      insideHorizontal: EMPTY_TABLE_BORDER,
      insideVertical: EMPTY_TABLE_BORDER,
    },
    rows,
  });
}

function visualOptionCell(
  entry: VisualOptionEntry | undefined,
  formulas: FormulaSlot[],
  width: number,
) {
  if (!entry) return optionCell("", formulas, width);

  const children: Paragraph[] = entry.text.trim()
    ? buildMarkdownParagraphs(entry.text, formulas, { compact: true })
    : [new Paragraph({ children: [normalRun(entry.label ? `${entry.label}.` : "")] })];

  if (entry.figure) {
    const image = dataUrlToImage(entry.figure.dataUrl);
    const size = fitOptionImageSize(entry.figure.width || 600, entry.figure.height || 320);
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 50, after: 50 },
      children: [
        new ImageRun({
          type: image.type,
          data: image.data,
          transformation: size,
          altText: {
            title: `${entry.label || "图片"} 选项图`,
            description: entry.figure.caption || `${entry.label || "图片"} 选项图`,
            name: entry.figure.id || `${entry.label || "visual"}-option`,
          },
        }),
      ],
    }));
  }

  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 40, bottom: 60, left: 80, right: 120 },
    borders: {
      top: EMPTY_TABLE_BORDER,
      bottom: EMPTY_TABLE_BORDER,
      left: EMPTY_TABLE_BORDER,
      right: EMPTY_TABLE_BORDER,
    },
    children,
  });
}

function shouldUseOptionTable(options: string[]) {
  if (options.length < 2) return false;
  return options.every((option) => normalizeRecognizedMathText(option).length <= 48);
}

function optionCell(option: string, formulas: FormulaSlot[], width: number) {
  const children = option.trim()
    ? buildMarkdownParagraphs(option, formulas, { compact: true })
    : [new Paragraph({ children: [blankRun()] })];

  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 40, bottom: 40, left: 80, right: 120 },
    borders: {
      top: EMPTY_TABLE_BORDER,
      bottom: EMPTY_TABLE_BORDER,
      left: EMPTY_TABLE_BORDER,
      right: EMPTY_TABLE_BORDER,
    },
    children,
  });
}

function normalRun(text: string) {
  const clean = markdownTextForWord(text);
  return new TextRun({
    text: clean,
    size: 22,
    font: BODY_FONT,
    bold: false,
    color: WORD_TEXT_COLOR,
  });
}

function blankRun() {
  return new TextRun({
    text: "",
    size: 22,
    font: BODY_FONT,
    bold: false,
    color: WORD_TEXT_COLOR,
  });
}

function formulaPlaceholder(latex: string, formulas: FormulaSlot[], display: boolean) {
  const token = `@@MATH_${formulas.length}@@`;
  formulas.push({
    token,
    latex: normalizePortableLatex(cleanLatex(latex)),
    display,
  });
  return new TextRun({
    text: token,
    size: 22,
    font: FORMULA_FONT,
    bold: false,
    color: WORD_TEXT_COLOR,
  });
}

function splitInlineMath(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, index) });
    }

    const raw = match[0];
    const display = raw.startsWith("\\[") || raw.startsWith("$$");
    parts.push({ type: "math", value: raw, display });
    cursor = index + raw.length;
  }

  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }

  return parts.length ? parts : [{ type: "text", value: text }];
}

function cleanLatex(value: string) {
  return value
    .replace(/^\\\[/, "")
    .replace(/\\\]$/, "")
    .replace(/^\\\(/, "")
    .replace(/\\\)$/, "")
    .replace(/^\$\$/, "")
    .replace(/\$\$$/, "")
    .replace(/^\$/, "")
    .replace(/\$$/, "")
    .trim();
}

function dataUrlToImage(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!match) {
    throw new Error("图形数据不是可导出的 PNG/JPG 图片");
  }
  const rawType = match[1].toLowerCase();
  const binary = atob(match[2]);
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    data[index] = binary.charCodeAt(index);
  }
  return {
    type: rawType === "jpeg" ? "jpg" as const : rawType as "png" | "jpg",
    data,
  };
}

function fitImageSize(width: number, height: number) {
  const ratio = Math.min(1, MAX_IMAGE_WIDTH / width);
  const fittedWidth = Math.max(80, Math.round(width * ratio));
  const fittedHeight = Math.max(40, Math.round(height * ratio));
  return { width: fittedWidth, height: fittedHeight };
}

function fitOptionImageSize(width: number, height: number) {
  const ratio = Math.min(1, MAX_OPTION_IMAGE_WIDTH / width, MAX_OPTION_IMAGE_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

async function injectFormulaOmml(blob: Blob, formulas: FormulaSlot[]) {
  if (!formulas.length) {
    return blob;
  }

  const replacements = new Map<string, string>();
  const conversionCache = new Map<string, string>();
  for (const formula of formulas) {
    const cacheKey = `${formula.display ? "block" : "inline"}:${formula.latex}`;
    let omml = conversionCache.get(cacheKey);
    if (!omml) {
      omml = createFormulaOmml(formula.latex, formula.display);
      conversionCache.set(cacheKey, omml);
    }
    replacements.set(formula.token, omml);
  }

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("Word 文档结构异常：缺少 word/document.xml");
  }

  let documentXml = await documentFile.async("string");
  documentXml = ensureMathNamespace(documentXml);

  for (const formula of formulas) {
    const omml = replacements.get(formula.token);
    if (!omml) continue;
    const escaped = escapeRegExp(formula.token);
    const runPattern = new RegExp(
      `<w:r(?:\\s[^>]*)?>(?:(?!<\\/w:r>)[\\s\\S])*?<w:t(?:\\s[^>]*)?>${escaped}<\\/w:t>(?:(?!<\\/w:r>)[\\s\\S])*?<\\/w:r>`,
      "g",
    );
    let replaced = false;
    documentXml = documentXml.replace(runPattern, () => {
      replaced = true;
      return omml;
    });
    if (!replaced) {
      // docx 库若改变了 run 的内部结构，至少保留可读文本，绝不让单题阻断整份下载。
      documentXml = documentXml.replace(new RegExp(escaped, "g"), escapeXml(toReadableFormulaText(formula.latex)));
    }
  }

  validateDocumentXml(documentXml);
  documentXml = normalizeWordRunAppearance(documentXml);

  zip.file("word/document.xml", documentXml);
  const stylesFile = zip.file("word/styles.xml");
  if (stylesFile) {
    const stylesXml = await stylesFile.async("string");
    zip.file("word/styles.xml", normalizeWordRunAppearance(stylesXml));
  }
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function normalizeWordRunAppearance(xml: string) {
  return xml
    .replace(/<w:color\b(?![^>]*w:val="auto")[^>]*\/>/g, `<w:color w:val="${WORD_TEXT_COLOR}"/>`)
    .replace(/<m:ctrlPr>([\s\S]*?)<\/m:ctrlPr>/g, (_match, content: string) => {
      const withColor = content.includes("<w:color")
        ? content.replace(/<w:color\b(?![^>]*w:val="auto")[^>]*\/>/g, `<w:color w:val="${WORD_TEXT_COLOR}"/>`)
        : `${content}<w:color w:val="${WORD_TEXT_COLOR}"/>`;
      return `<m:ctrlPr>${withColor}</m:ctrlPr>`;
    });
}

function validateDocumentXml(documentXml: string) {
  if (/@@MATH_\d+@@/.test(documentXml)) {
    throw new Error("Word 文档中仍有未替换的公式占位符，已停止导出以避免内容丢失");
  }
  for (const match of documentXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
    if (match[1].includes("<m:oMath")) {
      throw new Error("Word 公式结构异常，已停止导出以避免打开后丢失文字");
    }
  }
}

function latexToOmml(latex: string, display: boolean) {
  const mathNode = mathDocument.convert(latex, { display });
  const mathml = mmlVisitor.visitTree(mathNode);
  if (/<(?:merror|mpadded|maction|mphantom)\b/i.test(mathml)) {
    throw new Error("公式包含无法转换的 LaTeX 结构");
  }
  return mml2omml(mathml);
}

function createFormulaOmml(latex: string, display: boolean) {
  try {
    if (!canRenderFormulaInKatex(latex, display)) {
      throw new Error("公式无法由网页公式引擎解析");
    }
    const omml = stripXmlDeclaration(latexToOmml(latex, display));
    if (!/<m:oMath(?:\s[^>]*)?>/.test(omml) || containsRawLatexCommand(omml)) {
      throw new Error("公式转换未返回有效 OMML");
    }
    return omml;
  } catch {
    // 降级内容仍放入 OMML，对 Word 而言仍是可编辑公式对象，而不是图片或裸 LaTeX。
    return createReadableFormulaOmml(toReadableFormulaText(latex));
  }
}

function createReadableFormulaOmml(readableFormula: string) {
  return `<m:oMath><m:r><m:t xml:space="preserve">${escapeXml(readableFormula)}</m:t></m:r></m:oMath>`;
}

function ensureMathNamespace(documentXml: string) {
  if (documentXml.includes("xmlns:m=")) {
    return documentXml;
  }
  return documentXml.replace(
    "<w:document ",
    '<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ',
  );
}

function stripXmlDeclaration(value: string) {
  return value.replace(/^<\?xml[^>]*>\s*/i, "").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function containsRawLatexCommand(omml: string) {
  const text = omml.replace(/<[^>]+>/g, "");
  return /\\[A-Za-z]+/.test(text);
}

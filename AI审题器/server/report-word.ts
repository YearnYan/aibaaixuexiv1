import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  LevelFormat,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ParagraphChild,
} from "docx";
import { tokenizeLatex } from "../shared/latex.js";
import type { ReportRequest } from "./schemas.js";
import { createEditableWordMath } from "./word-math.js";

const CONTENT_WIDTH = 10_206;
const PAGE_WIDTH = 11_906;
const PAGE_HEIGHT = 16_838;
const PAGE_MARGIN = 850;
const DEFAULT_FONT = "Microsoft YaHei";

interface RichParagraphOptions {
  size?: number;
  color?: string;
  bold?: boolean;
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  numbering?: { reference: string; level: number };
  spacingAfter?: number;
}

const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: "C9D3D8" };
const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function richParagraphs(text: string, options: RichParagraphOptions = {}) {
  const paragraphs: Paragraph[] = [];
  let children: ParagraphChild[] = [];
  let paragraphCount = 0;

  const makeParagraph = (content: ParagraphChild[], alignment = options.alignment) => {
    const paragraph = new Paragraph({
      children: content.length ? content : [new TextRun("")],
      alignment,
      numbering: paragraphCount === 0 ? options.numbering : undefined,
      spacing: { after: options.spacingAfter ?? 80, line: 330 },
      widowControl: true,
    });
    paragraphCount += 1;
    paragraphs.push(paragraph);
  };

  const flush = () => {
    if (children.length > 0) {
      makeParagraph(children);
      children = [];
    }
  };

  for (const segment of tokenizeLatex(text)) {
    if (segment.kind === "formula") {
      const formula = createEditableWordMath(segment.value);
      if (segment.display) {
        flush();
        makeParagraph([formula], AlignmentType.CENTER);
      } else {
        children.push(formula);
      }
      continue;
    }

    const lines = segment.value.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) flush();
      if (line) {
        children.push(
          new TextRun({
            text: line,
            font: DEFAULT_FONT,
            size: options.size ?? 22,
            color: options.color ?? "172028",
            bold: options.bold,
          }),
        );
      }
    });
  }
  flush();
  if (paragraphs.length === 0) makeParagraph([]);
  return paragraphs;
}

function staticParagraph(text: string, options: RichParagraphOptions = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: DEFAULT_FONT,
        size: options.size ?? 22,
        color: options.color ?? "172028",
        bold: options.bold,
      }),
    ],
    alignment: options.alignment,
    spacing: { after: options.spacingAfter ?? 80, line: 320 },
  });
}

function metaParagraph(label: string, value: string) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}：`, bold: true, font: DEFAULT_FONT, size: 19, color: "5A666F" }),
      new TextRun({ text: value, font: DEFAULT_FONT, size: 19, color: "5A666F" }),
    ],
    spacing: { after: 65 },
  });
}

function sectionTable(number: string, title: string, body: Paragraph[], footer: string) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            borders,
            shading: { fill: "EAF8FA", type: ShadingType.CLEAR },
            margins: { top: 120, bottom: 105, left: 150, right: 150 },
            children: [staticParagraph(`${number}  ${title}`, { bold: true, size: 25, color: "117E8C", spacingAfter: 0 })],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            borders,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 155, bottom: 135, left: 170, right: 170 },
            children: [...body, staticParagraph(footer, { size: 18, color: "66727A", spacingAfter: 0 })],
          }),
        ],
      }),
    ],
  });
}

function spacer(height = 110) {
  return new Paragraph({ spacing: { after: height }, children: [] });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  })
    .format(date)
    .replaceAll("/", "-");
}

export async function generateWordReport(report: ReportRequest) {
  const { analysis, meta } = report;
  const warningParagraphs = analysis.potentialOmissions.length
    ? analysis.potentialOmissions.flatMap((item) =>
        richParagraphs(item, { numbering: { reference: "report-bullets", level: 0 }, color: "9F1F26" }),
      )
    : [staticParagraph("关键信息已完整提取", { color: "286F2C", bold: true })];
  const warningFill = analysis.potentialOmissions.length ? "FFF0F0" : "F1F9EF";

  const previewTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [7_300, 2_906],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 7_300, type: WidthType.DXA },
            borders,
            margins: { top: 170, bottom: 160, left: 190, right: 190 },
            children: [
              staticParagraph("【题目预览】", { bold: true, size: 25, spacingAfter: 110 }),
              ...richParagraphs(analysis.questionText, { size: 24, spacingAfter: 60 }),
            ],
          }),
          new TableCell({
            width: { size: 2_906, type: WidthType.DXA },
            borders,
            shading: { fill: "F6F8F8", type: ShadingType.CLEAR },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 160, bottom: 150, left: 150, right: 140 },
            children: [
              metaParagraph("学科", meta.subject),
              metaParagraph("年级", meta.grade),
              metaParagraph("题型", analysis.problemType),
              metaParagraph("来源", meta.source),
              metaParagraph("识别时间", formatDate(meta.recognizedAt)),
              metaParagraph("置信度", analysis.confidence.toFixed(2)),
            ],
          }),
        ],
      }),
    ],
  });

  const taskBody = analysis.taskWords.flatMap((item) => richParagraphs(`${item.label}  ${item.text}`));
  const restrictionsBody = analysis.restrictions.length
    ? analysis.restrictions.flatMap((item) => richParagraphs(item, { numbering: { reference: "report-bullets", level: 0 } }))
    : [staticParagraph("未识别到额外限制条件。")];
  const keyDataBody = analysis.keyData.length
    ? analysis.keyData.flatMap((item) => richParagraphs(`${item.label}：${item.value}`))
    : [staticParagraph("题目中没有需要单列的数值。")];
  const hiddenBody = analysis.hiddenConditions.length
    ? analysis.hiddenConditions.flatMap((item) => richParagraphs(item, { numbering: { reference: "report-bullets", level: 0 } }))
    : [staticParagraph("未识别到需要额外推断的隐藏条件。")];
  const distractionBody = analysis.distractions.length
    ? analysis.distractions.flatMap((item) => richParagraphs(item, { numbering: { reference: "report-bullets", level: 0 } }))
    : [staticParagraph("无明显干扰信息。")];

  const document = new Document({
    creator: "AI审题训练",
    title: "AI审题分析报告",
    description: "任务词、限制条件、关键数据、隐藏条件、干扰信息与作答范围",
    styles: {
      default: { document: { run: { font: DEFAULT_FONT, size: 22, color: "172028" } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 40, bold: true, font: DEFAULT_FONT, color: "121A21" },
          paragraph: { spacing: { before: 0, after: 100 }, outlineLevel: 0 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "report-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 420, hanging: 220 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "AI审题分析报告  ·  第 ", size: 17, color: "7A848B", font: DEFAULT_FONT }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 17, color: "7A848B", font: DEFAULT_FONT }),
                  new TextRun({ text: " 页", size: 17, color: "7A848B", font: DEFAULT_FONT }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: "AI审题分析报告", bold: true, size: 42, font: DEFAULT_FONT, color: "121A21" })],
            spacing: { after: 80 },
          }),
          staticParagraph(`先证明读准，再开始解题  ·  ${meta.subject}  ·  ${meta.grade}`, { size: 20, color: "66727A", spacingAfter: 170 }),
          new Table({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            columnWidths: [CONTENT_WIDTH],
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
                    borders,
                    shading: { fill: warningFill, type: ShadingType.CLEAR },
                    margins: { top: 120, bottom: 100, left: 170, right: 170 },
                    children: warningParagraphs,
                  }),
                ],
              }),
            ],
          }),
          spacer(110),
          previewTable,
          spacer(120),
          sectionTable("01", "任务词", taskBody, "明确需要完成的审题目标。"),
          spacer(),
          sectionTable("02", "限制条件", restrictionsBody, "对范围、数量与关系的限定条件。"),
          spacer(),
          sectionTable("03", "关键数据", keyDataBody, "用于判断与计算的核心信息。"),
          spacer(),
          sectionTable("04", "隐藏条件", hiddenBody, "未直接表述，但影响解题的条件。"),
          spacer(),
          sectionTable("05", "干扰信息", distractionBody, "题目中与当前任务无关的信息。"),
          spacer(),
          sectionTable("06", "作答范围", richParagraphs(`仅需求解：${analysis.answerScope}`, { color: "472976" }), "只回答题目要求的对象、范围与形式。"),
          spacer(120),
          new Table({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            columnWidths: [CONTENT_WIDTH],
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
                    borders,
                    shading: { fill: "F2F7F7", type: ShadingType.CLEAR },
                    margins: { top: 135, bottom: 120, left: 170, right: 170 },
                    children: [
                      staticParagraph("题意复述", { bold: true, color: "117E8C", size: 24 }),
                      ...richParagraphs(analysis.paraphrase),
                    ],
                  }),
                ],
              }),
            ],
          }),
          staticParagraph("AI 生成内容须由教师结合原题复核。", { size: 17, color: "7A848B", alignment: AlignmentType.RIGHT, spacingAfter: 0 }),
        ],
      },
    ],
  });

  return Packer.toBuffer(document);
}

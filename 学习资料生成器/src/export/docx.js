import { AsyncLocalStorage } from "node:async_hooks";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from "docx";
import { splitFormulaSegments } from "../formula.js";
import { renderTeachingFigurePng } from "../figures.js";
import { prepareExportMaterial } from "./common.js";
import {
  createEditableWordMath,
  validateEditableWordMathPackage
} from "./word-math.js";

const PAGE_WIDTH = 11_906;
const PAGE_HEIGHT = 16_838;
const PAGE_MARGIN_HORIZONTAL = 1_020;
const PAGE_MARGIN_TOP = 964;
const PAGE_MARGIN_BOTTOM = 1_020;
const TABLE_INDENT = 120;
const PAGE_CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN_HORIZONTAL * 2;
const CONTENT_WIDTH = PAGE_CONTENT_WIDTH - TABLE_INDENT;
const teachingFigurePngCache = new Map();
const COLORS = {
  ink: "202D33",
  inkSoft: "3D4B53",
  muted: "69777E",
  line: "D7DEE1",
  lineSoft: "E8ECEE",
  accent: "C94F38",
  accentSoft: "FFF0EB",
  highlight: "D7A72E",
  highlightSoft: "FFF8DE",
  paper: "FFFFFF",
  paperWarm: "F7F9FA",
  blue: "2F628E",
  blueSoft: "EDF4FA",
  success: "2E6B57",
  successSoft: "EDF7F1"
};
const BODY_FONT = {
  ascii: "Microsoft YaHei",
  hAnsi: "Microsoft YaHei",
  eastAsia: "微软雅黑",
  cs: "Microsoft YaHei"
};
const DISPLAY_FONT = {
  ascii: "Microsoft YaHei",
  hAnsi: "Microsoft YaHei",
  eastAsia: "微软雅黑",
  cs: "Microsoft YaHei"
};
const MONO_FONT = {
  ascii: "Consolas",
  hAnsi: "Consolas",
  eastAsia: "新宋体",
  cs: "Consolas"
};
const formulaExportStorage = new AsyncLocalStorage();

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: COLORS.line };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const borderless = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function inlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function run(text, options = {}) {
  return new TextRun({
    text: options.preserveWhitespace ? String(text ?? "").replace(/\s+/gu, " ") : inlineText(text),
    font: options.display ? DISPLAY_FONT : BODY_FONT,
    color: options.color || COLORS.ink,
    bold: options.bold,
    italics: options.italics,
    size: options.size,
    break: options.break
  });
}

function formulaRun(segment) {
  const formula = createEditableWordMath(segment.value, segment.display);
  formulaExportStorage.getStore()?.formulas.push(formula.metadata);
  return formula.math;
}

function richRuns(text, options = {}) {
  const children = splitFormulaSegments(String(text ?? "").replace(/\s+/gu, " ").trim()).map((segment) => (
    segment.type === "formula" ? formulaRun(segment) : run(segment.value, { ...options, preserveWhitespace: true })
  ));
  return children.length ? children : [run("", options)];
}

function bodyParagraph(text, options = {}) {
  const segments = splitFormulaSegments(String(text ?? "").trim());
  const isDisplayFormula = segments.length === 1 && segments[0].type === "formula" && segments[0].display;
  return new Paragraph({
    alignment: options.alignment || (isDisplayFormula ? AlignmentType.CENTER : undefined),
    keepNext: options.keepNext,
    keepLines: options.keepLines,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 140,
      line: options.line ?? 350
    },
    indent: options.indent,
    children: richRuns(text, options)
  });
}

function labelParagraph(text, color = COLORS.accent) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 0, after: 70 },
    children: richRuns(text, { bold: true, color, size: 19 })
  });
}

function headingParagraph(number, title, pageBreakBefore = false) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore,
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.line } },
    spacing: { before: 80, after: 220 },
    children: [
      run(`${String(number).padStart(2, "0")}  `, { bold: true, color: COLORS.accent, display: true, size: 23 }),
      ...richRuns(title, { bold: true, display: true, size: 40 })
    ]
  });
}

function subheadingParagraph(title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    spacing: { before: 260, after: 130 },
    children: [
      run("▌", { bold: true, color: COLORS.accent, size: 23 }),
      ...richRuns(` ${title}`, { bold: true, display: true, size: 28 })
    ]
  });
}

function tableCell(children, width, options = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: options.borders || borders,
    shading: options.fill ? { fill: options.fill, type: ShadingType.CLEAR } : undefined,
    verticalAlign: options.verticalAlign || VerticalAlign.TOP,
    margins: options.margins || { top: 130, bottom: 130, left: 160, right: 160 },
    children
  });
}

function reportTable({ rows, columnWidths, width = CONTENT_WIDTH, indent = TABLE_INDENT }) {
  const resolvedWidth = typeof width === "object" ? width.size : width;
  return new Table({
    width: { size: resolvedWidth, type: WidthType.DXA },
    indent: { size: indent, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths,
    rows
  });
}

function fullWidthBox(children, fill = COLORS.paperWarm, borderOptions = borders) {
  return reportTable({
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [tableCell(children, CONTENT_WIDTH, { fill, borders: borderOptions })]
      })
    ]
  });
}

function labelDetailTable(items, options = {}) {
  const labelWidth = options.labelWidth || 1_850;
  const detailWidth = CONTENT_WIDTH - labelWidth;
  const rows = items.map((item, index) => new TableRow({
    cantSplit: item.cantSplit !== false,
    children: [
      tableCell([
        bodyParagraph(item.label, {
          after: 0,
          bold: true,
          color: item.color || COLORS.blue,
          size: 19,
          keepLines: true
        })
      ], labelWidth, {
        fill: item.labelFill || COLORS.blueSoft,
        verticalAlign: VerticalAlign.TOP
      }),
      tableCell(Array.isArray(item.children)
        ? item.children
        : [bodyParagraph(item.text, { after: 0, ...(item.textOptions || {}) })], detailWidth, {
        fill: item.fill || (index % 2 ? COLORS.paperWarm : COLORS.paper),
        verticalAlign: VerticalAlign.TOP
      })
    ]
  }));
  return reportTable({ columnWidths: [labelWidth, detailWidth], rows });
}

function addPageBreak(children) {
  children.push(new Paragraph({ children: [new PageBreak()] }));
}

function coverChildren(material) {
  const children = [
    new Paragraph({
      spacing: { before: 100, after: 520 },
      children: [run("学习资料生成器 · 完整学习报告", { bold: true, color: COLORS.accent, size: 22 })]
    }),
    new Paragraph({
      spacing: { before: 0, after: 220, line: 660 },
      children: richRuns(material.meta.title, { bold: true, display: true, size: 60 })
    }),
    new Paragraph({
      spacing: { before: 0, after: 420, line: 390 },
      children: richRuns(material.meta.summary, { color: COLORS.inkSoft, size: 24 })
    })
  ];

  const metadata = [
    ["学科", material.meta.subject],
    ["学习阶段", material.meta.grade],
    ["建议用时", `${material.meta.estimatedMinutes} 分钟`],
    ["学习难度", material.meta.difficulty]
  ];
  const columnWidth = Math.floor(CONTENT_WIDTH / 2);
  const metadataRows = [];
  for (let index = 0; index < metadata.length; index += 2) {
    metadataRows.push(new TableRow({
      cantSplit: true,
      children: metadata.slice(index, index + 2).map(([label, value], pairIndex) => tableCell([
        labelParagraph(label, COLORS.muted),
        bodyParagraph(value, { after: 0, bold: true })
      ], pairIndex === 0 ? columnWidth : CONTENT_WIDTH - columnWidth, {
        fill: index === 0 ? COLORS.paperWarm : COLORS.paper,
        borders
      }))
    }));
  }
  children.push(reportTable({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [columnWidth, CONTENT_WIDTH - columnWidth],
    rows: metadataRows
  }));
  children.push(bodyParagraph("按“学习导航 → 重点与方法 → 例题与练习 → 掌握与复习”推进：先看清知识，再学会方法，最后用任务检验。", {
    before: 420,
    after: 0,
    color: COLORS.muted,
    italics: true,
    alignment: AlignmentType.CENTER
  }));
  addPageBreak(children);
  return children;
}

function learningTaskChildren(material) {
  const firstColumn = 1_550;
  const children = [
    bodyParagraph("先明确本节要完成的三项任务，再从第一个挑战开始。不要跳读全部栏目。", { color: COLORS.muted }),
    subheadingParagraph("学习目标"),
    reportTable({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [firstColumn, CONTENT_WIDTH - firstColumn],
      rows: material.learningGoals.map((goal, index) => new TableRow({
        cantSplit: true,
        children: [
          tableCell([
            bodyParagraph(`${String(index + 1).padStart(2, "0")}  ${goal.level}`, {
              after: 0,
              bold: true,
              color: COLORS.accent
            })
          ], firstColumn, { fill: COLORS.paperWarm }),
          tableCell([bodyParagraph(goal.text, { after: 0 })], CONTENT_WIDTH - firstColumn)
        ]
      }))
    })
  ];
  children.push(fullWidthBox([
    labelParagraph("本课核心问题", COLORS.blue),
    bodyParagraph(material.overview.coreQuestion, { after: 0, bold: true, size: 25 })
  ], COLORS.blueSoft));
  children.push(fullWidthBox([
    labelParagraph("首个挑战 · 先自己想", COLORS.accent),
    bodyParagraph(material.quickStart.firstChallenge, { after: 0, bold: true })
  ], COLORS.paperWarm));
  return children;
}

function overviewChildren(material) {
  const children = [
    fullWidthBox([
      labelParagraph("本课核心问题", COLORS.blue),
      bodyParagraph(material.overview.coreQuestion, { after: 0, bold: true, size: 26 })
    ], COLORS.blueSoft),
    bodyParagraph("", { after: 60 }),
    fullWidthBox([
      labelParagraph("怎么学更快"),
      bodyParagraph(material.overview.readingTip, { after: 0 })
    ], COLORS.paperWarm)
  ];
  children.push(subheadingParagraph("学习路径"));
  material.overview.outline.forEach((item) => {
    children.push(new Paragraph({
      numbering: { reference: "outline-numbering", level: 0 },
      spacing: { after: 120, line: 340 },
      children: richRuns(item)
    }));
  });
  return children;
}

function coreModelChildren(material) {
  const children = [];
  children.push(subheadingParagraph("核心原理"));
  children.push(fullWidthBox([
    labelParagraph("关键命题", COLORS.blue),
    bodyParagraph(material.overview.coreModel.coreClaim, {
      after: 0,
      bold: true,
      size: 25
    })
  ], COLORS.blueSoft));
  children.push(subheadingParagraph("推理链"));
  material.overview.coreModel.reasoningChain.forEach((item, index) => {
    children.push(fullWidthBox([
      labelParagraph(`第 ${index + 1} 链`, COLORS.accent),
      bodyParagraph(item.from, { after: 100, bold: true }),
      labelParagraph("因为", COLORS.muted),
      bodyParagraph(item.because, { after: 100 }),
      labelParagraph("所以", COLORS.success),
      bodyParagraph(item.therefore, { after: 0, bold: true, color: COLORS.success })
    ], index % 2 ? COLORS.paper : COLORS.paperWarm));
    children.push(bodyParagraph("", { after: 30 }));
  });
  children.push(subheadingParagraph("条件边界"));
  const half = Math.floor(CONTENT_WIDTH / 2);
  children.push(reportTable({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [half, CONTENT_WIDTH - half],
    rows: [new TableRow({
      cantSplit: true,
      children: material.overview.coreModel.boundaries.map((item, index) => tableCell([
        labelParagraph(item.when, index === 0 ? COLORS.accent : COLORS.success),
        bodyParagraph(item.rule, { after: 90 }),
        bodyParagraph(`为什么：${item.why}`, { after: 0, color: COLORS.muted, size: 19 })
      ], index === 0 ? half : CONTENT_WIDTH - half, { fill: index === 0 ? COLORS.paperWarm : COLORS.successSoft }))
    })]
  }));
  children.push(bodyParagraph("", { after: 30 }));
  children.push(fullWidthBox([
    labelParagraph(`易混辨析 · ${material.overview.coreModel.confusionPair.title}`, COLORS.accent),
    bodyParagraph(material.overview.coreModel.confusionPair.difference, { after: 100 }),
    bodyParagraph(`判断规则：${material.overview.coreModel.confusionPair.decisionRule}`, { after: 0, bold: true, color: COLORS.success })
  ], COLORS.paperWarm));
  return children;
}

function quickStartChildren(material) {
  const topicWidth = 2_100;
  const checkWidth = CONTENT_WIDTH - topicWidth;
  const children = [
    subheadingParagraph("开始前先确认"),
    reportTable({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [topicWidth, checkWidth],
      rows: material.quickStart.prerequisites.map((item, index) => new TableRow({
        cantSplit: true,
        children: [
          tableCell([bodyParagraph(`□  ${item.topic}`, {
            after: 0,
            bold: true,
            color: index === 0 ? COLORS.accent : COLORS.ink
          })], topicWidth, { fill: COLORS.paperWarm }),
          tableCell([bodyParagraph(item.check, { after: 0 })], checkWidth)
        ]
      }))
    }),
    subheadingParagraph("5 分钟时间轨")
  ];

  const timeWidth = 1_250;
  const outcomeWidth = 2_700;
  const taskWidth = CONTENT_WIDTH - timeWidth - outcomeWidth;
  const rows = material.quickStart.studyPlan.map((step, index) => new TableRow({
    cantSplit: true,
    children: [
      tableCell([bodyParagraph(`${step.minutes} 分钟`, {
        after: 0,
        bold: true,
        color: COLORS.accent
      })], timeWidth, { fill: index === 0 ? COLORS.accentSoft : COLORS.paperWarm }),
      tableCell([bodyParagraph(step.task, { after: 0, bold: true })], taskWidth),
      tableCell([
        labelParagraph("完成标志", COLORS.success),
        bodyParagraph(step.outcome, { after: 0, color: COLORS.inkSoft })
      ], outcomeWidth, { fill: COLORS.successSoft })
    ]
  }));
  children.push(reportTable({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [timeWidth, taskWidth, outcomeWidth],
    rows
  }));
  children.push(bodyParagraph("", { after: 90 }));
  children.push(fullWidthBox([
    labelParagraph("首个挑战 · 先别往下看", COLORS.blue),
    bodyParagraph(material.quickStart.firstChallenge, {
      after: 0,
      bold: true,
      size: 25
    })
  ], COLORS.blueSoft));
  return children;
}

function knowledgeMapNodeTable(material) {
  const nodes = Array.isArray(material.knowledgeMap?.nodes) ? material.knowledgeMap.nodes : [];
  return labelDetailTable(nodes.map((node, index) => ({
    label: `${String(index + 1).padStart(2, "0")}  ${node.label}`,
    color: index % 2 ? COLORS.success : COLORS.blue,
    labelFill: index % 2 ? COLORS.successSoft : COLORS.blueSoft,
    children: [
      bodyParagraph(node.detail, {
        after: node.members?.length ? 70 : 0,
        color: COLORS.inkSoft,
        size: 20
      }),
      ...(node.members?.length
        ? [bodyParagraph(`常见成员：${node.members.join("、")}`, { after: 0, color: COLORS.muted, size: 19 })]
        : [])
    ]
  })), { labelWidth: 2_300 });
}

function knowledgeMapVisualTable(material) {
  const nodes = Array.isArray(material.knowledgeMap?.nodes)
    ? material.knowledgeMap.nodes.slice(0, 6)
    : [];
  const leftWidth = Math.floor(CONTENT_WIDTH / 2);
  const rightWidth = CONTENT_WIDTH - leftWidth;
  const rows = [];

  for (let index = 0; index < nodes.length; index += 2) {
    const pair = nodes.slice(index, index + 2);
    rows.push(new TableRow({
      cantSplit: true,
      children: [0, 1].map((pairIndex) => {
        const node = pair[pairIndex];
        const width = pairIndex === 0 ? leftWidth : rightWidth;
        if (!node) return tableCell([bodyParagraph("", { after: 0 })], width, { fill: COLORS.paper });
        const nodeIndex = index + pairIndex;
        return tableCell([
          labelParagraph(`分支 ${String(nodeIndex + 1).padStart(2, "0")}`, nodeIndex % 2 ? COLORS.success : COLORS.blue),
          bodyParagraph(node.label, { after: 0, bold: true, size: 22 })
        ], width, {
          fill: nodeIndex % 2 ? COLORS.successSoft : COLORS.blueSoft
        });
      })
    }));
  }

  return [
    fullWidthBox([
      labelParagraph("核心主题", COLORS.accent),
      bodyParagraph(material.knowledgeMap.center, {
        after: 0,
        bold: true,
        size: 27,
        alignment: AlignmentType.CENTER
      })
    ], COLORS.paperWarm),
    bodyParagraph("↓", {
      after: 80,
      bold: true,
      color: COLORS.muted,
      size: 24,
      alignment: AlignmentType.CENTER
    }),
    reportTable({
      columnWidths: [leftWidth, rightWidth],
      rows
    })
  ];
}

function knowledgeMapChildren(material) {
  return [
    fullWidthBox([
      labelParagraph("本讲义覆盖范围", COLORS.accent),
      bodyParagraph(material.knowledgeMap.scope, { after: 80, color: COLORS.ink }),
      bodyParagraph(material.knowledgeMap.coverageSummary, { after: 70, color: COLORS.muted }),
      bodyParagraph(`覆盖维度：${material.knowledgeMap.coverageDimensions.join("、")}`, { after: 0, color: COLORS.inkSoft, size: 20 })
    ], COLORS.paperWarm),
    bodyParagraph("", { after: 80 }),
    bodyParagraph("下面的结构图把核心主题与关键分支放在同一张图中，复习时先看中心，再沿分支主动回忆。", {
      color: COLORS.muted
    }),
    ...knowledgeMapVisualTable(material),
    bodyParagraph("完整知识节点", { before: 100, after: 100, bold: true, color: COLORS.ink }),
    knowledgeMapNodeTable(material)
  ];
}

function keyPointsChildren(material) {
  const children = [];
  material.keyPoints.forEach((point, index) => {
    children.push(subheadingParagraph(`${String(index + 1).padStart(2, "0")}  ${point.title}`));
    children.push(labelParagraph(point.importance));
    children.push(bodyParagraph(point.explanation, { keepNext: true }));
    children.push(labelDetailTable([
      { label: "核心原理", text: point.principle, color: COLORS.blue, labelFill: COLORS.blueSoft },
      { label: "何时使用", text: point.useWhen, color: COLORS.success, labelFill: COLORS.successSoft },
      { label: "条件边界", text: point.boundary, color: COLORS.accent, labelFill: COLORS.accentSoft }
    ]));
    children.push(...teachingFiguresChildren(material, "keyPoints", point.id || `K${index + 1}`));
    children.push(subheadingParagraph("60 秒自测"));
    children.push(labelDetailTable([
      { label: "先写判断", text: point.diagnostic.prompt, color: COLORS.accent, labelFill: COLORS.accentSoft, textOptions: { bold: true } },
      { label: "核对逻辑", text: point.diagnostic.expected, color: COLORS.success, labelFill: COLORS.successSoft },
      { label: "最易误判", text: point.diagnostic.trap, color: COLORS.accent, labelFill: COLORS.accentSoft, textOptions: { color: COLORS.inkSoft } },
      { label: "答错只修", text: point.diagnostic.repair, color: COLORS.success, labelFill: COLORS.successSoft, textOptions: { color: COLORS.inkSoft } }
    ]));
    const reviewItems = [];
    if (point.example) {
      reviewItems.push({
        label: "结合资料看",
        text: point.example,
        color: COLORS.blue,
        labelFill: COLORS.blueSoft,
        textOptions: { size: 22 }
      });
    }
    if (point.memoryTip) {
      reviewItems.push({ label: "记忆小招", text: point.memoryTip, color: COLORS.highlight, labelFill: COLORS.highlightSoft });
    }
    reviewItems.push({
      label: "脱稿自问",
      text: point.retrievalQuestion,
      color: COLORS.success,
      labelFill: COLORS.successSoft,
      textOptions: { bold: true }
    });
    children.push(bodyParagraph("", { after: 30 }));
    children.push(labelDetailTable(reviewItems));
    if (index < material.keyPoints.length - 1) {
      children.push(bodyParagraph("", { after: 120 }));
    }
  });
  children.push(subheadingParagraph("高价值策略"));
  material.strategyCards.forEach((card, index) => {
    children.push(subheadingParagraph(`${String(index + 1).padStart(2, "0")}  ${card.scenario}`));
    children.push(labelDetailTable([
      { label: "触发信号", text: card.trigger, color: COLORS.accent, labelFill: COLORS.accentSoft },
      { label: "下笔第一步", text: card.firstMove, color: COLORS.success, labelFill: COLORS.successSoft, textOptions: { bold: true } }
    ]));
    children.push(subheadingParagraph("执行路线"));
    card.route.forEach((step, stepIndex) => {
      children.push(new Paragraph({
        keepNext: true,
        spacing: { before: stepIndex === 0 ? 90 : 40, after: 60, line: 340 },
        children: richRuns(`${String(stepIndex + 1).padStart(2, "0")}  ${step.action}`, { bold: true, color: COLORS.accent, size: 21 })
      }));
      children.push(bodyParagraph(`理由：${step.reason}`, { indent: { left: 420 }, after: 70, color: COLORS.inkSoft }));
    });
    children.push(labelDetailTable([
      { label: "得分证据", text: card.scoringPoints.join("；"), color: COLORS.success, labelFill: COLORS.successSoft },
      { label: "常见失分", text: card.commonLoss, color: COLORS.accent, labelFill: COLORS.accentSoft },
      { label: "变式迁移", text: card.variation, color: COLORS.blue, labelFill: COLORS.blueSoft, textOptions: { color: COLORS.success } }
    ]));
    children.push(bodyParagraph("", { after: 100 }));
  });
  return children;
}

function workedExamplesChildren(material) {
  const children = [];
  material.workedExamples.forEach((example, exampleIndex) => {
    children.push(subheadingParagraph(`${String(exampleIndex + 1).padStart(2, "0")}  ${example.title}`));
    children.push(bodyParagraph(`${example.questionType}｜触发信号：${example.trigger}`, { color: COLORS.accent, bold: true, size: 19, keepNext: true }));
    children.push(fullWidthBox([
      labelParagraph("题目", COLORS.blue),
      bodyParagraph(example.problem, { after: 0, bold: true, size: 24 })
    ], COLORS.blueSoft));
    children.push(...teachingFiguresChildren(material, "workedExamples", example.id || `E${exampleIndex + 1}`));
    children.push(bodyParagraph("", { after: 60 }));
    children.push(labelDetailTable([
      { label: "给定条件", text: example.given, color: COLORS.blue, labelFill: COLORS.blueSoft },
      { label: "本题目标", text: example.target, color: COLORS.success, labelFill: COLORS.successSoft },
      { label: "先定策略", text: example.strategy, color: COLORS.blue, labelFill: COLORS.blueSoft },
      { label: "判断规则", text: example.decisionRule, color: COLORS.success, labelFill: COLORS.successSoft, textOptions: { bold: true, color: COLORS.success } }
    ]));
    children.push(subheadingParagraph("取舍判断"));
    children.push(labelDetailTable([
      { label: "看似可行", text: example.decisionFork.temptingMove, color: COLORS.accent, labelFill: COLORS.accentSoft },
      { label: "为什么不通", text: example.decisionFork.whyItFails, color: COLORS.highlight, labelFill: COLORS.highlightSoft },
      { label: "正确回到", text: example.decisionFork.recoveryMove, color: COLORS.success, labelFill: COLORS.successSoft }
    ]));
    children.push(subheadingParagraph("分步推理"));
    example.steps.forEach((step, stepIndex) => {
      children.push(new Paragraph({
        keepNext: true,
        spacing: { before: stepIndex === 0 ? 0 : 80, after: 70, line: 340 },
        children: [
          ...richRuns(`${String(stepIndex + 1).padStart(2, "0")}  ${step.label}`, {
            bold: true,
            color: COLORS.accent,
            size: 22
          })
        ]
      }));
      children.push(bodyParagraph(example.steps[stepIndex].explanation, {
        indent: { left: 420 },
        after: 70
      }));
      children.push(bodyParagraph(`为什么：${step.rationale}`, {
        indent: { left: 420 },
        after: 50,
        color: COLORS.muted,
        size: 19
      }));
      children.push(bodyParagraph(`检查：${step.checkpoint}`, {
        indent: { left: 420 },
        after: 110,
        color: COLORS.success,
        size: 19
      }));
    });
    children.push(subheadingParagraph("答案与自检"));
    children.push(labelDetailTable([
      { label: "完整答案", text: example.answer, color: COLORS.success, labelFill: COLORS.successSoft },
      { label: "自检点", text: example.selfCheck, color: COLORS.success, labelFill: COLORS.successSoft },
      { label: "得分证据", text: example.scoringPoints.join("；"), color: COLORS.blue, labelFill: COLORS.blueSoft },
      { label: "错误路径", text: example.commonWrongPath, color: COLORS.accent, labelFill: COLORS.accentSoft },
      { label: "边界检查", text: example.boundaryCheck, color: COLORS.accent, labelFill: COLORS.accentSoft, textOptions: { color: COLORS.accent } },
      { label: "变式迁移", text: example.variation, color: COLORS.success, labelFill: COLORS.successSoft, textOptions: { color: COLORS.success } }
    ]));
    children.push(bodyParagraph("", { after: 140 }));
  });
  return children;
}

function closeReadingChildren(material) {
  const children = [];
  material.closeReading.forEach((item, index) => {
    children.push(subheadingParagraph(`${String(index + 1).padStart(2, "0")}  ${item.heading}`));
    children.push(fullWidthBox([
      labelParagraph("关键内容", COLORS.muted),
      bodyParagraph(item.original, { after: 0, display: true, size: 24 })
    ], COLORS.paperWarm));
    children.push(bodyParagraph(item.explanation, { before: 100 }));
    children.push(fullWidthBox([
      labelParagraph("想一想"),
      bodyParagraph(item.question, { after: 0, bold: true })
    ], COLORS.accentSoft));
    children.push(bodyParagraph("", { after: 80 }));
  });
  return children;
}

function conceptsChildren(material) {
  return [labelDetailTable(material.concepts.map((concept, index) => ({
    label: concept.term,
    color: index % 2 ? COLORS.success : COLORS.blue,
    labelFill: index % 2 ? COLORS.successSoft : COLORS.blueSoft,
    children: [
      bodyParagraph(concept.definition, { after: 80 }),
      bodyParagraph(`例：${concept.example}`, { after: 0, color: COLORS.muted, size: 19 })
    ]
  })), { labelWidth: 2_100 })];
}

function compareVisualTable(visual) {
  const half = Math.floor(CONTENT_WIDTH / 2);
  const rowCount = Math.max(visual.leftItems.length, visual.rightItems.length, 1);
  const rows = [
    new TableRow({
      cantSplit: true,
      children: [
        tableCell([bodyParagraph(visual.leftTitle, { after: 0, bold: true, color: COLORS.accent })], half, { fill: COLORS.accentSoft }),
        tableCell([bodyParagraph(visual.rightTitle, { after: 0, bold: true })], CONTENT_WIDTH - half, { fill: COLORS.successSoft })
      ]
    })
  ];
  for (let index = 0; index < rowCount; index += 1) {
    rows.push(new TableRow({
      cantSplit: true,
      children: [
        tableCell([bodyParagraph(visual.leftItems[index] || "", { after: 0 })], half),
        tableCell([bodyParagraph(visual.rightItems[index] || "", { after: 0 })], CONTENT_WIDTH - half)
      ]
    }));
  }
  return reportTable({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [half, CONTENT_WIDTH - half],
    rows
  });
}

function visualsChildren(material) {
  const children = [];
  material.visuals.forEach((visual, index) => {
    children.push(subheadingParagraph(`${String(index + 1).padStart(2, "0")}  ${visual.title}`));
    children.push(bodyParagraph(visual.caption, { color: COLORS.muted }));
    children.push(...teachingFiguresChildren(material, "visuals", `V${index + 1}`));
    const items = visual.type === "compare"
      ? [
        ...visual.leftItems.map((item) => `容易混淆：${item}`),
        ...visual.rightItems.map((item) => `正确理解：${item}`)
      ]
      : (visual.items.length ? visual.items : ["观察资料", "理解重点", "完成练习"]);
    items.forEach((item) => children.push(new Paragraph({
      numbering: { reference: "visual-bullets", level: 0 },
      spacing: { after: 70, line: 350 },
      children: richRuns(item, { color: COLORS.muted })
    })));
    children.push(bodyParagraph("", { after: 80 }));
  });
  return children;
}

function knowledgeDiagramsChildren(material) {
  const children = [];
  const diagrams = Array.isArray(material.knowledgeDiagrams) ? material.knowledgeDiagrams : [];

  diagrams.forEach((diagram, index) => {
    children.push(subheadingParagraph(`${String(index + 1).padStart(2, "0")}  ${diagram.title}`));
    children.push(bodyParagraph(diagram.purpose, { color: COLORS.muted }));

    children.push(...teachingFiguresChildren(material, "knowledgeDiagrams", `D${index + 1}`));
    children.push(bodyParagraph(diagram.explanation, { before: 130, color: COLORS.inkSoft }));
    (diagram.readingGuide || []).forEach((item, guideIndex) => {
      children.push(bodyParagraph(`${guideIndex + 1}. ${item}`, {
        after: guideIndex === diagram.readingGuide.length - 1 ? 180 : 60,
        indent: { left: 180 },
        color: COLORS.muted
      }));
    });
  });

  return children;
}

function teachingFiguresChildren(material, section, refId) {
  const figures = (Array.isArray(material.teachingFigures) ? material.teachingFigures : [])
    .filter((figure) => (
      figure?.placement?.section === section
      && figure?.placement?.refId === refId
      && figure?.renderStatus === "ready"
      && figure?.svg
    ));
  const children = [];
  figures.forEach((figure, index) => {
    children.push(fullWidthBox([
      labelParagraph(`学科图形 ${String(index + 1).padStart(2, "0")}`, COLORS.blue),
      bodyParagraph(figure.title, { after: 70, bold: true, size: 24 }),
      bodyParagraph(figure.purpose, { after: 0, color: COLORS.muted, size: 20 })
    ], COLORS.blueSoft));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 100 },
      keepNext: true,
      children: [new ImageRun({
        type: "png",
        data: renderTeachingFigurePngCached(figure, 1600),
        transformation: { width: 620, height: 465 },
        altText: {
          title: figure.title,
          description: figure.description || figure.purpose,
          name: `teaching-figure-${figure.hash || `${section}-${refId}-${index + 1}`}`
        }
      })]
    }));
    children.push(fullWidthBox([
      labelParagraph("读图提示", COLORS.success),
      bodyParagraph(figure.caption, { after: 0 })
    ], COLORS.successSoft));
    children.push(bodyParagraph("", { after: 80 }));
  });
  return children;
}

function renderTeachingFigurePngCached(figure, width) {
  const key = `${figure?.hash || "no-hash"}:${width}`;
  if (!teachingFigurePngCache.has(key)) {
    teachingFigurePngCache.set(key, renderTeachingFigurePng(figure, width));
  }
  return teachingFigurePngCache.get(key);
}

function knowledgeTeachingFiguresChildren(material) {
  const refIds = new Set(
    (Array.isArray(material.teachingFigures) ? material.teachingFigures : [])
      .filter((figure) => figure?.placement?.section === "knowledgeDiagrams")
      .map((figure) => figure.placement.refId)
  );
  return [...refIds].flatMap((refId) => teachingFiguresChildren(material, "knowledgeDiagrams", refId));
}

function mistakesChildren(material) {
  const children = [];
  material.mistakes.forEach((mistake, index) => {
    children.push(subheadingParagraph(`${String(index + 1).padStart(2, "0")}  易错辨析`));
    children.push(labelDetailTable([
      { label: "容易这样想", text: mistake.wrong, color: COLORS.accent, labelFill: COLORS.accentSoft },
      { label: "正确理解", text: mistake.right, color: COLORS.success, labelFill: COLORS.successSoft },
      { label: "为什么", text: mistake.reason, color: COLORS.blue, labelFill: COLORS.blueSoft, textOptions: { color: COLORS.muted } }
    ]));
  });
  return children;
}

function practiceChildren(material) {
  const children = [];
  material.practice.forEach((practice, index) => {
    children.push(subheadingParagraph(`${String(index + 1).padStart(2, "0")}  ${practice.type} · ${practice.difficulty}`));
    children.push(bodyParagraph(practice.question, { bold: true, size: 24, keepNext: true }));
    children.push(fullWidthBox([
      labelParagraph("作答顺序", COLORS.accent),
      bodyParagraph(practice.solvingPlan, { after: 0 })
    ], COLORS.paperWarm));
    children.push(...teachingFiguresChildren(material, "practice", practice.id || `P${index + 1}`));
    practice.options.forEach((option) => {
      children.push(new Paragraph({
        numbering: { reference: `practice-options-${index + 1}`, level: 0 },
        spacing: { after: 80, line: 350 },
        children: richRuns(option)
      }));
    });
    children.push(subheadingParagraph("答案与订正"));
    children.push(labelDetailTable([
      { label: "参考答案", text: practice.answer, color: COLORS.success, labelFill: COLORS.successSoft, textOptions: { bold: true } },
      { label: "思路解析", text: practice.explanation, color: COLORS.blue, labelFill: COLORS.blueSoft },
      { label: "得分点", text: practice.scoringPoints.join("；"), color: COLORS.success, labelFill: COLORS.successSoft },
      { label: "常见失分", text: practice.commonLosses.join("；"), color: COLORS.accent, labelFill: COLORS.accentSoft },
      { label: "错后修复", text: practice.repairAction, color: COLORS.success, labelFill: COLORS.successSoft }
    ]));
    children.push(bodyParagraph("", { after: 100 }));
  });
  return children;
}

function masteryChecksChildren(material) {
  const children = [
    bodyParagraph("不看讲义完成下面三关。每一关都达到通过标准，才算从“看懂”走到“会用”。", {
      color: COLORS.muted
    })
  ];
  material.masteryChecks.forEach((check, index) => {
    const markerColor = index === 0 ? COLORS.blue : (index === 1 ? COLORS.success : COLORS.highlight);
    children.push(subheadingParagraph(`第 ${index + 1} 关 · ${check.level}`));
    children.push(bodyParagraph("□  完成后在这里打勾", {
      after: 100,
      color: markerColor,
      size: 19,
      bold: true,
      keepNext: true
    }));
    children.push(labelDetailTable([
      { label: "挑战任务", text: check.task, color: COLORS.accent, labelFill: COLORS.accentSoft, textOptions: { bold: true } },
      { label: "提交证据", text: check.deliverable, color: COLORS.blue, labelFill: COLORS.blueSoft },
      { label: "通过标准", text: check.criteria, color: COLORS.success, labelFill: COLORS.successSoft },
      { label: "输出骨架", text: check.outputFrame.map((step, stepIndex) => `${stepIndex + 1}. ${step}`).join("  →  "), color: COLORS.blue, labelFill: COLORS.blueSoft },
      { label: "评分维度", text: check.rubric.join("；"), color: COLORS.success, labelFill: COLORS.successSoft },
      { label: "卡住时", text: check.ifStuck, color: COLORS.accent, labelFill: COLORS.accentSoft, textOptions: { color: COLORS.inkSoft } }
    ]));
    if (index < material.masteryChecks.length - 1) {
      children.push(bodyParagraph("", { after: 80 }));
    }
  });
  return children;
}

function reviewPlanChildren(material) {
  const reviewItems = Array.isArray(material.reviewPlan) && material.reviewPlan.length
    ? material.reviewPlan
    : [
      { day: "现在", task: "合上讲义，依次复述三个关键判断。", duration: "4 分钟" },
      { day: "今晚", task: "重做一组独立练，只核对卡住的那一步。", duration: "8 分钟" },
      { day: "第 2 天", task: "完成一项迁移任务，再回看对应知识点。", duration: "10 分钟" }
    ];
  const timeWidth = 1_600;
  const durationWidth = 1_700;
  const taskWidth = CONTENT_WIDTH - timeWidth - durationWidth;
  const reviewCellMargins = { top: 80, bottom: 80, left: 150, right: 150 };
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      tableCell([bodyParagraph("复习时间", { after: 0, bold: true, color: COLORS.blue })], timeWidth, { fill: COLORS.blueSoft, margins: reviewCellMargins }),
      tableCell([bodyParagraph("复习任务", { after: 0, bold: true, color: COLORS.blue })], taskWidth, { fill: COLORS.blueSoft, margins: reviewCellMargins }),
      tableCell([bodyParagraph("建议用时", { after: 0, bold: true, color: COLORS.blue })], durationWidth, { fill: COLORS.blueSoft, margins: reviewCellMargins })
    ]
  });
  const rows = reviewItems.map((review, index) => new TableRow({
    cantSplit: true,
    children: [
      tableCell([bodyParagraph(review.day, { after: 0, bold: true, color: COLORS.accent })], timeWidth, { fill: index === 0 ? COLORS.paperWarm : COLORS.paper, margins: reviewCellMargins }),
      tableCell([bodyParagraph(review.task, { after: 0 })], taskWidth, { fill: index === 0 ? COLORS.paperWarm : COLORS.paper, margins: reviewCellMargins }),
      tableCell([bodyParagraph(review.duration, { after: 0 })], durationWidth, { fill: index === 0 ? COLORS.paperWarm : COLORS.paper, margins: reviewCellMargins })
    ]
  }));
  return [
    reportTable({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [timeWidth, taskWidth, durationWidth],
      rows: [header, ...rows]
    }),
    new Paragraph({
      shading: { fill: COLORS.blueSoft, type: ShadingType.CLEAR },
      border: borders,
      spacing: { before: 150, after: 0, line: 350 },
      indent: { left: 160, right: 160 },
      children: [
        run("完成提醒  ", { bold: true, color: COLORS.blue, size: 19 }),
        run("最后合上讲义，用自己的话讲一遍。复述时卡住的地方，就是下一次需要精准回看的地方。", { bold: true })
      ]
    })
  ];
}

function phaseLead(title, description, action, fill) {
  const softFill = fill === COLORS.success
    ? COLORS.successSoft
    : (fill === COLORS.accent ? COLORS.accentSoft : COLORS.blueSoft);
  const titleColor = fill === COLORS.success
    ? COLORS.success
    : (fill === COLORS.accent ? COLORS.accent : COLORS.blue);
  return fullWidthBox([
    labelParagraph(title, titleColor),
    bodyParagraph(description, { after: 90, bold: true, size: 25 }),
    bodyParagraph(`本阶段完成后：${action}`, { after: 0, color: COLORS.inkSoft })
  ], softFill);
}

function orientationChildren(material) {
  return [
    phaseLead(
      "先定方向，再开始学习",
      "先确认要学会什么、关键判断是什么，以及每一步要交出什么证据。",
      "能沿一条学习图谱从目标走到第一项独立动作。",
      COLORS.ink
    ),
    subheadingParagraph("学习目标与学习图谱"),
    ...learningTaskChildren(material),
    subheadingParagraph("核心问题与学习顺序"),
    ...overviewChildren(material),
    subheadingParagraph("5 分钟启动"),
    ...quickStartChildren(material),
    subheadingParagraph("知识地图"),
    ...knowledgeMapChildren(material)
  ];
}

function modelingChildren(material) {
  return [
    phaseLead(
      "把知识建成能判断的模型",
      "先理解原理和边界，再用重点、精读、概念和图解把知识连成可调用的结构。",
      "能说清条件、理由和结论之间的关系。",
      COLORS.success
    ),
    subheadingParagraph("核心原理与边界"),
    ...coreModelChildren(material),
    subheadingParagraph("重点精讲与高价值策略"),
    ...keyPointsChildren(material),
    subheadingParagraph("逐段精读"),
    ...closeReadingChildren(material),
    subheadingParagraph("概念词典"),
    ...conceptsChildren(material),
    subheadingParagraph("图解知识点"),
    ...knowledgeDiagramsChildren(material),
    subheadingParagraph("SVG辅助图"),
    ...visualsChildren(material)
  ];
}

function practicePhaseChildren(material) {
  return [
    phaseLead(
      "先看示范，再独立练会",
      "通过完整示范建立正确起点，用错误辨析和分层练习把“看懂”变成可验证的独立完成。",
      "能完成与目标对应的练习，并说明每一步为什么这样做。",
      COLORS.accent
    ),
    subheadingParagraph("例题拆解"),
    ...workedExamplesChildren(material),
    subheadingParagraph("易错提醒"),
    ...mistakesChildren(material),
    subheadingParagraph("分层练习"),
    ...practiceChildren(material)
  ];
}

function consolidationChildren(material) {
  return [
    phaseLead(
      "脱稿证明，再安排复习",
      "用复述、应用和迁移证明自己会用，再按复习计划回看仍不稳定的判断。",
      "能提交完整答案，并知道下一次该回看哪个知识点。",
      COLORS.ink
    ),
    subheadingParagraph("掌握证明"),
    ...masteryChecksChildren(material),
    subheadingParagraph("复习计划"),
    ...reviewPlanChildren(material)
  ];
}

export async function createDocxReport({ material }) {
  const normalized = prepareExportMaterial(material);
  const exportState = { formulas: [] };
  return formulaExportStorage.run(exportState, async () => {
    const children = [...coverChildren(normalized)];
    const sections = [
      ["学习导航", orientationChildren],
      ["重点与方法", modelingChildren],
      ["例题与练习", practicePhaseChildren],
      ["掌握与复习", consolidationChildren]
    ];
    sections.forEach(([title, builder], index) => {
      children.push(headingParagraph(index + 1, title));
      children.push(...builder(normalized));
    });

    const listParagraphStyle = {
      indent: { left: 540, hanging: 280 },
      spacing: { after: 80, line: 350 }
    };
    const document = new Document({
      creator: "学习资料生成器",
      title: `${normalized.meta.title} - 完整学习报告`,
      description: "由学习资料生成器创建的完整学习报告",
      styles: {
        default: {
          document: {
            run: { font: BODY_FONT, size: 21, color: COLORS.ink },
            paragraph: { spacing: { line: 350, after: 140 } }
          }
        },
        paragraphStyles: [
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { size: 40, bold: true, font: DISPLAY_FONT, color: COLORS.ink },
            paragraph: { spacing: { before: 80, after: 220 }, keepNext: true, outlineLevel: 0 }
          },
          {
            id: "Heading2",
            name: "Heading 2",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { size: 28, bold: true, font: DISPLAY_FONT, color: COLORS.ink },
            paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 }
          },
          {
            id: "Heading3",
            name: "Heading 3",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { size: 24, bold: true, font: DISPLAY_FONT, color: COLORS.ink },
            paragraph: { spacing: { before: 120, after: 100 }, keepNext: true, outlineLevel: 2 }
          }
        ]
      },
      numbering: {
        config: [
          {
            reference: "outline-numbering",
            levels: [{
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: listParagraphStyle }
            }]
          },
          {
            reference: "visual-bullets",
            levels: [{
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: listParagraphStyle }
            }]
          },
          ...Array.from({ length: 4 }, (_, index) => ({
            reference: `practice-options-${index + 1}`,
            levels: [{
              level: 0,
              format: LevelFormat.UPPER_LETTER,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: listParagraphStyle }
            }]
          }))
        ]
      },
      sections: [{
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: {
              top: PAGE_MARGIN_TOP,
              right: PAGE_MARGIN_HORIZONTAL,
              bottom: PAGE_MARGIN_BOTTOM,
              left: PAGE_MARGIN_HORIZONTAL,
              header: 500,
              footer: 500
            }
          }
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.line } },
              spacing: { after: 70 },
              children: [run("学习资料生成器 · 完整学习报告", { bold: true, color: COLORS.muted, size: 17 })]
            })]
          })
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                run("学习资料生成器  |  第 ", { color: COLORS.muted, size: 17 }),
                new TextRun({ children: [PageNumber.CURRENT], font: BODY_FONT, color: COLORS.muted, size: 17 }),
                run(" 页", { color: COLORS.muted, size: 17 })
              ]
            })]
          })
        },
        children
      }]
    });

    const buffer = Buffer.from(await Packer.toBuffer(document));
    await validateEditableWordMathPackage(buffer, exportState.formulas);
    return buffer;
  });
}

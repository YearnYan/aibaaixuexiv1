import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import mammoth from "mammoth";
import {
  buildAttachmentHeader,
  prepareExportMaterial,
  sanitizeFilename
} from "../src/export/common.js";
import { createDocxReport } from "../src/export/docx.js";
import { buildFallbackSvg } from "../src/figures.js";
import { createMaterialTemplate } from "../src/material.js";

function assertTextInOrder(text, fragments) {
  let previousIndex = -1;
  fragments.forEach((fragment) => {
    const index = text.indexOf(fragment, previousIndex + 1);
    assert.ok(index > previousIndex, `应按顺序导出“${fragment}”`);
    previousIndex = index;
  });
}

function completeTeachingFigures(material) {
  material.teachingFigures = (material.teachingFigures || []).map((figure) => {
    const svg = figure.svg || buildFallbackSvg({ ...figure, figureType: figure.type });
    const labels = [...svg.matchAll(/<text\b[^>]*>([^<]+)<\/text>/giu)]
      .map((match) => match[1].replace(/&[^;]+;/gu, " "))
      .join(" ");
    return {
      ...figure,
      description: `${figure.description || ""} ${labels}`.trim(),
      svg,
      renderStatus: "ready"
    };
  });
  return material;
}

function createReadyDocxReport(material, { includeFigures = false } = {}) {
  if (!includeFigures) material.teachingFigures = [];
  return createDocxReport({ material: includeFigures ? completeTeachingFigures(material) : material });
}

async function readDocxDocumentXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentPart = zip.file("word/document.xml");
  assert.ok(documentPart, "DOCX 应包含 word/document.xml");
  return documentPart.async("string");
}

test("导出文件名清理系统保留字符并保留中文", () => {
  assert.equal(sanitizeFilename("语文：第一课/背影?", "pdf"), "语文 第一课 背影-完整学习报告.pdf");
  assert.match(buildAttachmentHeader("背影", "docx"), /filename\*=UTF-8''/);
});

test("无效讲义不会进入文件生成流程", () => {
  assert.throws(
    () => prepareExportMaterial({}),
    (error) => error.code === "EXPORT_INVALID_MATERIAL"
  );
});

test("Word 报告是可解析且按四大完整章节组织的 DOCX", async () => {
  const material = createMaterialTemplate({
    sources: [{
      name: "背影.docx",
      kind: "docx",
      size: 1_024,
      text: "背影\n父亲为儿子买橘子，表现深沉的父爱。"
    }],
    options: { grade: "八年级", subject: "语文", depth: "detailed" }
  });
  const buffer = await createReadyDocxReport(material);
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  assert.ok(buffer.length > 12_000);

  const extracted = await mammoth.extractRawText({ buffer });
  assert.match(extracted.value, /背影/);
  assertTextInOrder(extracted.value, ["01学习导航", "02重点与方法", "03例题与练习", "04掌握与复习"]);
  assert.match(extracted.value, /学习目标/);
  assert.match(extracted.value, /本课核心问题/);
  assert.match(extracted.value, /首个挑战/);
  assert.match(extracted.value, /知识地图/);
  assertTextInOrder(extracted.value, ["重点精讲与高价值策略", "逐段精读", "概念词典", "图解知识点"]);
  assertTextInOrder(extracted.value, ["例题拆解", "易错提醒", "分层练习"]);
  assert.match(extracted.value, /掌握证明/);
  assert.match(extracted.value, /复习计划/);
  assert.match(extracted.value, /合上讲义，依次复述三个关键判断/);
  assert.match(extracted.value, /学习资料生成器/);
  assert.doesNotMatch(extracted.value, /知页/);
  assert.doesNotMatch(extracted.value, /资料索引|资料锚点/);
});

test("Word 完整栏目按重点、策略、精读、词典、图解、例题、易错、练习和掌握顺序导出", async () => {
  const material = createMaterialTemplate({
    sources: [{
      name: "图谱资料.txt",
      kind: "txt",
      size: 1_024,
      text: "一次函数中，k 的正负决定图像的增减趋势。"
    }],
    options: { grade: "八年级", subject: "数学", depth: "detailed" }
  });
  material.learningGoals[0] = {
    ...material.learningGoals[0],
    id: "G1",
    text: "图谱目标完整哨兵内容"
  };
  material.knowledgeMap.nodes[0] = {
    ...material.knowledgeMap.nodes[0],
    id: "N1",
    label: "图谱知识节点完整哨兵"
  };
  material.keyPoints[0] = {
    ...material.keyPoints[0],
    id: "K1",
    title: "图谱重点精讲完整哨兵",
    explanation: "图谱短解释完整哨兵内容：学生必须先从资料证据推到判断，不能跳步。"
  };
  material.strategyCards[0] = {
    ...material.strategyCards[0],
    scenario: "图谱策略完整哨兵"
  };
  material.closeReading[0] = {
    ...material.closeReading[0],
    heading: "图谱精读完整哨兵"
  };
  material.concepts[0] = {
    ...material.concepts[0],
    term: "图谱词典完整哨兵"
  };
  material.visuals[0] = {
    ...material.visuals[0],
    title: "图谱图解完整哨兵"
  };
  material.mistakes[0] = {
    ...material.mistakes[0],
    wrong: "图谱易错完整哨兵"
  };
  material.workedExamples[0] = {
    ...material.workedExamples[0],
    id: "E1",
    title: "图谱示范完整哨兵",
    problem: "图谱示范正文只应完整出现一次：请根据斜率正负写出图像变化，并说明资料依据。"
  };
  material.practice[0] = {
    ...material.practice[0],
    id: "P1",
    type: "图谱练习完整哨兵"
  };
  material.masteryChecks[0] = {
    ...material.masteryChecks[0],
    id: "M1",
    task: "图谱掌握证明完整哨兵任务需要独立完成"
  };
  const buffer = await createReadyDocxReport(material);
  const extracted = await mammoth.extractRawText({ buffer });

  assertTextInOrder(extracted.value, [
    "图谱重点精讲完整哨兵",
    "图谱策略完整哨兵",
    "图谱精读完整哨兵",
    "图谱词典完整哨兵",
    "图谱图解完整哨兵",
    "图谱示范完整哨兵",
    "图谱易错完整哨兵",
    "图谱练习完整哨兵",
    "图谱掌握证明完整哨兵任务需要独立完成"
  ]);
  assert.match(extracted.value, /图谱目标完整哨兵内容/);
  assert.match(extracted.value, /图谱短解释完整哨兵内容/);
  assert.equal((extracted.value.match(/图谱示范正文只应完整出现一次/g) || []).length, 1);
});

test("Word 导出完整保留 16 种英语时态和 SVG 图解说明", async () => {
  const material = createMaterialTemplate({
    sources: [{
      name: "英语时态系统.txt",
      kind: "txt",
      size: 1_024,
      text: "英语时态由四种时间视角和四种动作状态交叉组成。"
    }],
    options: { grade: "初中", subject: "英语", depth: "detailed" }
  });
  const buffer = await createReadyDocxReport(material);
  const extracted = await mammoth.extractRawText({ buffer });

  assert.match(extracted.value, /图解知识点/u);
  assert.match(extracted.value, /16 种时态总矩阵/u);
  assert.match(extracted.value, /would have been doing/u);
  assert.match(extracted.value, /过去将来完成进行时/u);
  assert.match(extracted.value, /SVG辅助图/u);
  assert.doesNotMatch(extracted.value, /补充讲解/u);
});

test("Word 导出开放知识体系的覆盖范围与分类成员", async () => {
  const material = createMaterialTemplate({
    sources: [{
      name: "英语介词.txt",
      kind: "txt",
      size: 1_024,
      text: "英语介词可以按时间、地点、方向和方式等功能分类。"
    }],
    options: { grade: "初中", subject: "英语", depth: "detailed" }
  });
  material.knowledgeMap = {
    ...material.knowledgeMap,
    scopeType: "open",
    scope: "覆盖初中阶段常用英语介词的全部主流功能分类。",
    coverageSummary: "覆盖时间、地点、方向、方式等主流分类及常用成员。",
    coverageDimensions: ["完整分类", "常用成员", "核心规则", "易混与应用"],
    nodes: [{
      id: "N1",
      label: "时间介词",
      detail: "根据时间点、日期和时间段选择不同介词。",
      members: ["at", "on", "in", "since", "for", "during"],
      sourceRefs: material.sourceAtoms.slice(0, 1).map((item) => item.id)
    }]
  };
  const buffer = await createReadyDocxReport(material);
  const extracted = await mammoth.extractRawText({ buffer });

  assert.match(extracted.value, /本讲义覆盖范围/u);
  assert.match(extracted.value, /覆盖初中阶段常用英语介词/u);
  assert.match(extracted.value, /常见成员：at、on、in、since、for、during/u);
});

test("Word 把数学、物理、化学、生物和地理公式写成原生可编辑 OMML", async () => {
  const material = createMaterialTemplate({
    sources: [{
      name: "跨学科公式.txt",
      kind: "txt",
      size: 1_024,
      text: "数学、物理、化学、生物和地理公式规范。"
    }],
    options: { grade: "高中", subject: "数学", depth: "detailed" }
  });
  material.overview.coreQuestion = String.raw`怎样理解 $f(x)=ax^2+bx+c$？`;
  material.knowledgeMap.nodes[0].label = String.raw`数学判别式 $\Delta=b^2-4ac$`;
  material.knowledgeMap.nodes[0].detail = String.raw`当 $\Delta>0$ 时有两个不相等实数根。`;
  material.keyPoints[0].explanation = String.raw`物理关系写作 $\vec{F}=m\vec{a}$。`;
  material.workedExamples[0].problem = String.raw`计算 $$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$$。`;
  material.practice[0].question = String.raw`配平反应式 $$\ce{2H2 + O2 -> 2H2O}$$。`;
  material.masteryChecks[0].task = String.raw`说明 $Aa\times Aa$ 与 $30^\circ\mathrm{N}$ 的规范写法。`;

  const buffer = await createReadyDocxReport(material);
  const extracted = await mammoth.extractRawText({ buffer });
  const xml = await readDocxDocumentXml(buffer);
  const mathBlocks = xml.match(/<m:oMath(?:\s[^>]*)?>[\s\S]*?<\/m:oMath>/gu) || [];

  assert.doesNotMatch(extracted.value, /\$\$?|\\frac|\\vec|\\ce|\\times|\\circ/u);
  assert.ok(mathBlocks.length >= 6, "五类学科公式应分别写入原生公式节点");
  assert.match(xml, /<m:f>/u);
  assert.match(xml, /<m:rad>/u);
  assert.match(xml, /<m:sSub>/u);
  assert.match(xml, /<m:sSup>/u);
  assert.match(xml, /<m:acc>/u);
  assert.doesNotMatch(xml, /LaTeX:|行内公式|独立公式/u);
  assert.doesNotMatch(xml, /name="knowledge-map"/u);
  assert.ok(mathBlocks.every((block) => /<m:t(?:\s[^>]*)?>[^<]+<\/m:t>/u.test(block)));
  assert.ok(mathBlocks.every((block) => !/<w:drawing>/u.test(block)));
  assert.ok(buffer.length > 30_000);
});

test("Word 将教学 SVG 转为高清 PNG 并保留图题关系", async () => {
  const material = createMaterialTemplate({
    sources: [{
      name: "二次函数.txt",
      kind: "txt",
      size: 1_024,
      text: "二次函数图像的开口、对称轴、顶点和零点共同决定图像特征。"
    }],
    options: { grade: "九年级", subject: "数学", depth: "detailed" }
  });
  material.workedExamples[0].id = "E1";
  material.teachingFigures = [{
    id: "F1",
    subject: "数学",
    type: "function",
    title: "二次函数图像验收哨兵",
    purpose: "把函数关系转成可观察图形。",
    description: "绘制二次函数坐标系、抛物线、对称轴和关键点。",
    stem: "观察二次函数图像。",
    placement: { section: "workedExamples", refId: "E1" },
    caption: "图形验收哨兵说明",
    params: { expression: "y=x^2-4x+3" },
    constraints: ["坐标轴方向正确", "抛物线开口向上"],
    svg: buildFallbackSvg({
      subject: "数学",
      figureType: "function",
      description: "绘制二次函数坐标系、抛物线、对称轴和关键点。",
      stem: "观察二次函数图像。",
      params: { expression: "y=x^2-4x+3" },
      constraints: ["坐标轴方向正确", "抛物线开口向上"]
    })
  }];

  const buffer = await createReadyDocxReport(material, { includeFigures: true });
  const extracted = await mammoth.extractRawText({ buffer });
  const html = await mammoth.convertToHtml({ buffer });

  assert.match(extracted.value, /二次函数图像验收哨兵/u);
  assert.match(extracted.value, /图形验收哨兵说明/u);
  assert.match(html.value, /data:image\/png;base64,/iu);
  assert.doesNotMatch(html.value, /<svg\b/iu);
  assert.ok(buffer.length > 20_000);
});

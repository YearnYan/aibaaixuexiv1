import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDocxReport } from "../src/export/docx.js";
import { createPdfReport } from "../src/export/pdf.js";
import { createMaterialTemplate } from "../src/material.js";

const baseUrl = process.env.VERIFY_BASE_URL || "http://127.0.0.1:5174";
const material = createMaterialTemplate({
  sources: [{
    name: "惯性与质量.txt",
    kind: "text",
    size: 2_048,
    text: "惯性是物体保持原有运动状态的性质，质量是衡量物体惯性大小的唯一因素。研究惯性时必须区分惯性、惯性力、运动状态和受力变化。"
  }],
  options: { grade: "八年级", subject: "物理", goal: "understand", depth: "detailed" }
});
material.meta.title = "惯性、质量与运动状态的关系";
material.meta.summary = "从惯性的定义出发，理解质量为什么决定惯性大小，再通过生活情境、受力判断和完整练习掌握规范表达。";
material.keyPoints[2] = {
  ...material.keyPoints[2],
  id: "K3",
  title: "惯性是物体保持原有运动状态的性质，而不是向前作用的力",
  importance: "必会",
  explanation: "惯性是物体本身的一种性质，它让物体倾向于保持原来的静止状态或匀速直线运动状态。惯性没有方向，不能被施加，也不能说物体受到了惯性的作用。",
  principle: "描述惯性时，只能说物体具有惯性或由于惯性继续保持原有状态，不能把惯性写成一种力。",
  useWhen: "题目出现启动、刹车、转弯、突然停止或外力消失等情境时，先确定物体原来的运动状态，再判断它由于惯性会怎样运动。",
  boundary: "质量只决定惯性大小，速度、受力和运动方向都不改变物体是否具有惯性；一切有质量的物体在任何状态下都具有惯性。",
  memoryTip: "惯性只描述物体想保持原样，不负责把物体推向某个方向。",
  retrievalQuestion: "正在做匀速圆周运动的物体，如果外力全部消失，它会继续转圈还是沿切线飞出？为什么？",
  diagnostic: {
    prompt: "判断正误：百米赛跑运动员抵达终点后不能立刻停下来，是因为他受到向前的惯性力作用。",
    expected: "错误。运动员具有惯性，会保持原来的向前运动状态；惯性不是力。",
    trap: "把由于惯性继续运动误写成受到惯性力，混淆了物体属性与力的作用。",
    repair: "删除受到惯性力，把表述改为运动员由于惯性保持原来的运动状态。"
  }
};
material.practice[0] = {
  ...material.practice[0],
  id: "P1",
  type: "惯性概念辨析",
  question: "公交车突然刹车时，站立的乘客身体会向前倾。下列解释中，哪一项同时正确说明了乘客原来的状态和刹车后的运动趋势？",
  options: [
    "乘客受到向前的惯性力，所以身体向前运动",
    "乘客上半身由于惯性保持原来的向前运动状态",
    "车速越大，乘客才具有惯性；车速较小时没有惯性",
    "刹车后乘客的质量变大，因此惯性突然增大"
  ],
  answer: "B",
  explanation: "刹车前乘客与车一起向前运动；刹车时脚随车减速，上半身由于惯性仍保持向前运动趋势，因此身体向前倾。",
  scoringPoints: ["写清原来的运动状态", "使用由于惯性而不是受到惯性力", "说明上下部位运动状态变化"],
  commonLosses: ["把惯性写成力", "只写向前倾而不说明原因"],
  repairAction: "先写刹车前的状态，再写哪个部位先改变，最后用由于惯性连接结论。"
};

// 只提供一张确定性的成品图测试图题分页；生产 API 的真实图形质量门槛不参与夹具构造。
material.teachingFigures = [{
  id: "D1-layout-fixture",
  subject: "物理",
  type: "diagram",
  title: "惯性判断的状态变化图",
  purpose: "沿时间顺序观察受力变化前后的运动状态。",
  description: "物体原状态、外力变化、保持原运动状态、最终判断四步关系图。",
  params: {},
  constraints: ["惯性不是力", "先判断原运动状态"],
  placement: { section: "knowledgeDiagrams", refId: "D1" },
  caption: "先读原状态，再看外力如何变化，最后用惯性判断物体接下来的运动趋势。",
  renderStatus: "ready",
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="惯性判断的状态变化图"><rect width="400" height="300" fill="#fff"/><text x="200" y="34" text-anchor="middle" font-size="18" font-weight="700" fill="#16303c">惯性判断的状态变化图</text><g font-size="13" font-family="Microsoft YaHei" text-anchor="middle"><rect x="22" y="92" width="78" height="68" rx="8" fill="#edf4fa" stroke="#2f628e"/><text x="61" y="120" fill="#202d33">原运动状态</text><text x="61" y="143" fill="#69777e">先确定</text><rect x="116" y="92" width="78" height="68" rx="8" fill="#fff0eb" stroke="#c94f38"/><text x="155" y="120" fill="#202d33">外力变化</text><text x="155" y="143" fill="#69777e">再观察</text><rect x="210" y="92" width="78" height="68" rx="8" fill="#edf7f1" stroke="#2e6b57"/><text x="249" y="120" fill="#202d33">保持原状态</text><text x="249" y="143" fill="#69777e">由于惯性</text><rect x="304" y="92" width="74" height="68" rx="8" fill="#fff8de" stroke="#d7a72e"/><text x="341" y="120" fill="#202d33">规范判断</text><text x="341" y="143" fill="#69777e">不是受力</text></g><g fill="none" stroke="#3d4b53" stroke-width="2"><path d="M100 126h16"/><path d="M194 126h16"/><path d="M288 126h16"/></g><g fill="#3d4b53"><path d="M116 126l-7-5v10z"/><path d="M210 126l-7-5v10z"/><path d="M304 126l-7-5v10z"/></g><text x="200" y="214" text-anchor="middle" font-size="14" fill="#2e6b57">质量决定惯性大小，运动状态不决定有没有惯性</text><line x1="54" y1="236" x2="346" y2="236" stroke="#d7dee1"/><text x="200" y="263" text-anchor="middle" font-size="12" fill="#69777e">原状态 → 外力变化 → 由于惯性保持趋势 → 规范表述</text></svg>`
}];

async function build(format, outputPath, expectedMagic) {
  const buffer = format === "pdf"
    ? await createPdfReport({ material, baseUrl })
    : await createDocxReport({ material });
  if (!buffer.subarray(0, expectedMagic.length).equals(expectedMagic)) {
    throw new Error(`${format} 文件签名不正确`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  return buffer.length;
}

const pdfPath = path.resolve("output/pdf/导出排版压力验收.pdf");
const docxPath = path.resolve("output/docx/导出排版压力验收.docx");
const pdfSize = await build("pdf", pdfPath, Buffer.from("%PDF"));
const docxSize = await build("docx", docxPath, Buffer.from("PK"));

console.log(JSON.stringify({ pdfPath, pdfSize, docxPath, docxSize }, null, 2));

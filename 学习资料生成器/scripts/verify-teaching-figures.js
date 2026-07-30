import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  isRenderableSvg,
  normalizeTeachingFigures
} from "../src/figures.js";
import { createMaterialTemplate } from "../src/material.js";

const baseUrl = process.argv[2] || "http://127.0.0.1:5174";
const outputDirectory = new URL("../output/playwright/teaching-figures/", import.meta.url);
const pdfDirectory = new URL("../output/pdf/", import.meta.url);
const docxDirectory = new URL("../output/docx/", import.meta.url);
const screenshotDirectory = fileURLToPath(outputDirectory);

await Promise.all([
  mkdir(outputDirectory, { recursive: true }),
  mkdir(pdfDirectory, { recursive: true }),
  mkdir(docxDirectory, { recursive: true })
]);

const sourceText = "数学二次函数图像与性质：开口、对称轴、顶点、零点、增减性与最值。";
const material = createMaterialTemplate({
  sources: [{
    name: "二次函数图形验收",
    kind: "text",
    size: Buffer.byteLength(sourceText),
    text: sourceText,
    images: [],
    warnings: []
  }],
  options: { subject: "数学", grade: "初中", goal: "understand", depth: "detailed" }
});
material.meta.title = "二次函数图像与性质";
material.knowledgeMap.center = "二次函数图像与性质";
material.keyPoints[0].title = "二次函数图像判断";
material.keyPoints[0].explanation = "先看函数图像的开口、对称轴和顶点，再判断零点与增减性。";
material.practice[0].question = String.raw`如图 P1 所示，闭合开关 $S$ 后，观察 $s^2$ 与 $L_1$ 的位置关系。`;
material.practice[0].options = [String.raw`$L_1$ 与灯泡串联`, String.raw`$L_2$ 与灯泡并联`, String.raw`$s^2$ 表示面积`, "无法判断"];
material.closeReading[0].original = "如图所示，先观察坐标轴和曲线的相对位置。";

material.teachingFigures = normalizeTeachingFigures([
  {
    id: "F1",
    subject: "数学",
    type: "function",
    title: "二次函数图像的关键结构",
    purpose: "同时观察开口、对称轴、顶点和零点在坐标系中的位置关系。",
    description: "在 400×300 白底直角坐标系中绘制二次函数 $y=x^2-4x+3$ 的抛物线。横轴和纵轴垂直，刻度等距，标出原点与正方向；绘制开口向上的完整曲线；用虚线画对称轴 $x=2$；标出顶点 $(2,-1)$ 和零点 $(1,0)$、$(3,0)$，标签不能遮挡曲线。",
    params: { xRange: [-1, 5], yRange: [-2, 6], vertex: [2, -1], zeros: [[1, 0], [3, 0]] },
    constraints: ["坐标轴垂直且刻度等距", "抛物线关于 x=2 对称", "关键点必须落在曲线上"],
    placement: { section: "knowledgeDiagrams", refId: "D1" },
    caption: "先看开口和对称轴，再核对顶点与零点；最后沿横轴判断增减区间。"
  },
  {
    id: "F2",
    subject: "数学",
    type: "function",
    title: "例题中的函数图像",
    purpose: "把题干给出的函数关系转成可观察图形。",
    description: "在带等距刻度的直角坐标系中绘制 $y=x^2-4x+3$ 的抛物线，保留完整开口与坐标轴，标出原点和曲线，不写顶点、零点坐标，不标注增减区间、最值或答案结论。",
    params: { xRange: [-1, 5], yRange: [-2, 6] },
    constraints: ["曲线形状与函数一致", "不得标注答案线索", "主体占视口一半以上"],
    placement: { section: "workedExamples", refId: "E1" },
    caption: "先根据曲线位置作出判断，再回到代数式核对，不从图中抄答案。"
  },
  {
    id: "F3",
    subject: "数学",
    type: "coordinate",
    title: "练习用坐标系",
    purpose: "在规范坐标上独立完成描点和连线。",
    description: "绘制空白但可作答的直角坐标系：横轴范围从 -1 到 5，纵轴范围从 -2 到 6，刻度等距，标出原点、轴名称和正方向。不得预先绘制函数曲线、顶点、零点或答案提示。",
    params: { xRange: [-1, 5], yRange: [-2, 6] },
    constraints: ["坐标轴垂直", "刻度与范围准确", "不预填答案"],
    placement: { section: "practice", refId: "P1" },
    caption: "先列表取点，再把点落在坐标系中；连线后检查曲线是否平滑并关于对称轴对称。"
  }
], material);

const figureResponse = await fetch(`${baseUrl}/api/render/figures-batch`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    figures: material.teachingFigures.map((figure) => ({
      id: figure.id,
      subject: figure.subject,
      figureType: figure.type,
      stem: figure.stem,
      description: figure.description,
      params: figure.params,
      constraints: figure.constraints
    }))
  })
});
if (!figureResponse.ok) throw new Error(`批量图形接口失败：${figureResponse.status}`);
const figureResult = await figureResponse.json();
const resultMap = new Map(figureResult.results.map((item) => [item.id, item]));
material.teachingFigures.forEach((figure) => {
  const result = resultMap.get(figure.id);
  if (!result?.svg || !isRenderableSvg(result.svg)) throw new Error(`${figure.id} 未返回有效 SVG`);
  figure.svg = result.svg;
  figure.renderStatus = "ready";
});

await writeFile(new URL("material.json", outputDirectory), JSON.stringify(material, null, 2));

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto(`${baseUrl}/?export=pdf`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.renderStudyReportForExport === "function");
  const mathState = await page.evaluate((report) => window.renderStudyReportForExport(report), material);
  await page.waitForFunction(() => document.querySelector("#study-paper")?.dataset.mathRenderState === "ready");
  await page.evaluate(async () => document.fonts?.ready && document.fonts.ready);

  const desktopMetrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    knowledgeDiagrams: [...document.querySelectorAll(".knowledge-diagram-card .teaching-figure-canvas")].map((canvas) => {
      const svg = canvas.querySelector("svg");
      const rect = canvas.getBoundingClientRect();
      return {
        id: canvas.dataset.figureId,
        status: canvas.dataset.figureStatus,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        viewBox: svg?.getAttribute("viewBox"),
        visibleGeometry: svg?.querySelectorAll("path,line,polyline,polygon,circle,ellipse,rect").length || 0
      };
    }),
    figures: [...document.querySelectorAll(".teaching-figure")].map((figure) => {
      const svg = figure.querySelector("svg");
      const rect = figure.getBoundingClientRect();
      return {
        id: figure.dataset.figureId,
        status: figure.dataset.figureStatus,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        viewBox: svg?.getAttribute("viewBox"),
        visibleGeometry: svg?.querySelectorAll("path,line,polyline,polygon,circle,ellipse,rect").length || 0
      };
    }),
    keyPointFigures: [...document.querySelectorAll(".key-point .teaching-figure")].map((figure) => figure.dataset.figureId)
  }));
  if (mathState !== "ready") throw new Error(`公式状态异常：${mathState}`);
  if (desktopMetrics.scrollWidth > desktopMetrics.viewportWidth) throw new Error("桌面页面出现横向溢出");
  if (desktopMetrics.knowledgeDiagrams.length !== 2) throw new Error("网页未直接展示两张知识图解 SVG");
  if (desktopMetrics.knowledgeDiagrams.some((item) => item.viewBox !== "0 0 400 300" || item.visibleGeometry < 1)) {
    throw new Error("知识图解 SVG 视口或可见图元不符合要求");
  }
  if (await page.locator(".knowledge-ascii-diagram").count()) throw new Error("网页仍展示 ASCII 知识图解");
  if (await page.locator(".diagram-teaching-figures").count()) throw new Error("网页仍生成重复图形展示区");
  if (await page.locator(".teaching-figure-error").count()) throw new Error("网页仍存在图形渲染错误占位");
  if (desktopMetrics.figures.length < 3) throw new Error("网页未展示知识点、例题和练习三类图形");
  if (!desktopMetrics.keyPointFigures.length) throw new Error("重点精讲中的自然图形未挂载到重点内容");
  if (desktopMetrics.figures.some((item) => item.viewBox !== "0 0 400 300" || item.visibleGeometry < 1)) {
    throw new Error("网页图形视口或可见图元不符合要求");
  }
  const practiceLayout = await page.evaluate(() => {
    const item = document.querySelector(".practice-item");
    const figure = item?.querySelector(".practice-question > .is-practice");
    const options = item?.querySelector(".option-list");
    const figureBeforeOptions = Boolean(figure && options && (figure.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING));
    const optionRows = [...(item?.querySelectorAll(".option-list li") || [])].map((row) => ({
      width: Math.round(row.getBoundingClientRect().width),
      height: Math.round(row.getBoundingClientRect().height),
      text: row.textContent.trim()
    }));
    return { figureBeforeOptions, optionRows };
  });
  if (!practiceLayout.figureBeforeOptions) throw new Error("练习题图形未紧跟题干并排在选项之前");
  if (practiceLayout.optionRows.length !== 4 || practiceLayout.optionRows.some((row) => row.width < 120 || row.height < 20)) {
    throw new Error("练习选项出现挤压、塌陷或不可读布局");
  }
  const formulaLayout = await page.evaluate(() => [...document.querySelectorAll(".katex")].map((formula) => {
    const vlist = formula.querySelector(".vlist");
    const vlistTable = formula.querySelector(".vlist-t");
    const rect = formula.getBoundingClientRect();
    return {
      text: formula.textContent.trim(),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      vlistDisplay: vlist ? getComputedStyle(vlist).display : "none",
      vlistTableDisplay: vlistTable ? getComputedStyle(vlistTable).display : "none"
    };
  }));
  const invalidFormulaLayout = formulaLayout.some((item) => (
    item.width < 4
    || item.height < 8
    || (item.vlistDisplay !== "none" && item.vlistDisplay !== "table-cell")
    || (item.vlistTableDisplay !== "none" && !["inline-table", "table"].includes(item.vlistTableDisplay))
  ));
  if (!formulaLayout.length || invalidFormulaLayout) {
    throw new Error(`网页公式出现纵向拆分或 KaTeX 内部布局被覆盖：${JSON.stringify(formulaLayout.slice(0, 8))}`);
  }
  if (consoleErrors.length) throw new Error(`浏览器控制台错误：${consoleErrors.join("；")}`);

  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-full.png"), fullPage: true });
  const figureElements = page.locator(".teaching-figure");
  const screenshotCount = Math.min(3, await figureElements.count());
  for (let index = 0; index < screenshotCount; index += 1) {
    await figureElements.nth(index).screenshot({ path: path.join(screenshotDirectory, `figure-${index + 1}.png`) });
  }
  await page.locator(".practice-item").first().screenshot({ path: path.join(screenshotDirectory, "practice-with-figure-and-options.png") });
  await page.locator(".close-reading-item").first().screenshot({ path: path.join(screenshotDirectory, "close-reading-with-reference.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMetrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    knowledgeDiagrams: [...document.querySelectorAll(".knowledge-diagram-card .teaching-figure-canvas")].map((canvas) => Math.round(canvas.getBoundingClientRect().width)),
    figures: [...document.querySelectorAll(".teaching-figure")].map((figure) => Math.round(figure.getBoundingClientRect().width))
  }));
  if (mobileMetrics.scrollWidth > mobileMetrics.viewportWidth) throw new Error("手机页面出现横向溢出");
  if (mobileMetrics.knowledgeDiagrams.length !== 2 || mobileMetrics.knowledgeDiagrams.some((width) => width <= 0 || width > mobileMetrics.viewportWidth - 24)) {
    throw new Error("手机知识图解 SVG 排版异常");
  }
  await figureElements.first().screenshot({ path: path.join(screenshotDirectory, "mobile-figure.png") });

  await writeFile(new URL("metrics.json", outputDirectory), JSON.stringify({ desktopMetrics, mobileMetrics }, null, 2));
} finally {
  await browser.close();
}

async function downloadArtifact(format, target) {
  const response = await fetch(`${baseUrl}/api/export/${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ material })
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${format} 导出失败：${error}`);
  }
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

await downloadArtifact("pdf", new URL("二次函数图形验收-网页报告.pdf", pdfDirectory));
await downloadArtifact("docx", new URL("二次函数图形验收-Word报告.docx", docxDirectory));

console.log(JSON.stringify({
  figures: material.teachingFigures.length,
  figureIds: material.teachingFigures.map((item) => item.id),
  pdf: "output/pdf/二次函数图形验收-网页报告.pdf",
  docx: "output/docx/二次函数图形验收-Word报告.docx"
}, null, 2));

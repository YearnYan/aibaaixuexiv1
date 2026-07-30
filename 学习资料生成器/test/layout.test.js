import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("结果页不再跨栏目轮流复用知识图解", async () => {
  const app = await readFile(new URL("public/app.js", projectRoot), "utf8");
  assert.doesNotMatch(app, /appendReferencedFigures|referenceSource\s*=\s*["']inline-text/u);
  assert.match(app, /getTeachingFigures\(material, "strategyCards"/u);
  assert.match(app, /getTeachingFigures\(material, "closeReading"/u);
  assert.match(app, /getTeachingFigures\(material, "mistakes"/u);
  assert.match(app, /getTeachingFigures\(material, "masteryChecks"/u);
});

test("公式内部节点由 KaTeX 管理，语义标签样式只命中直接子元素", async () => {
  const [readerCss, legacyCss] = await Promise.all([
    readFile(new URL("public/reader.css", projectRoot), "utf8"),
    readFile(new URL("public/styles.css", projectRoot), "utf8")
  ]);
  assert.doesNotMatch(readerCss, /\.katex\s+\.(?:base|strut|vlist|vlist-t)\s*\{/u);
  assert.doesNotMatch(legacyCss, /\.map-node-members\s+span\s*\{/u);
  assert.doesNotMatch(legacyCss, /\.knowledge-coverage-dimensions\s+span\s*[,\{]/u);
  assert.match(legacyCss, /\.map-node-members\s*>\s*span/u);
  assert.match(legacyCss, /\.knowledge-coverage-dimensions\s*>\s*span/u);
});

test("PDF 使用最终打印层并在写出前拦截越界与重叠", async () => {
  const [index, printCss, pdf] = await Promise.all([
    readFile(new URL("public/index.html", projectRoot), "utf8"),
    readFile(new URL("public/export-print.css", projectRoot), "utf8"),
    readFile(new URL("src/export/pdf.js", projectRoot), "utf8")
  ]);
  assert.ok(index.indexOf("/export-print.css") > index.indexOf("/vendor/katex/katex.min.css"));
  assert.match(printCss, /body\.result-active\.export-render[\s\S]*?\.paper-section\s*\{[^}]*break-before:\s*auto\s*!important[^}]*page-break-before:\s*auto\s*!important/su);
  assert.match(printCss, /\.key-point,[\s\S]*?break-inside:\s*auto\s*!important/su);
  assert.match(printCss, /\.point-diagnostic-answer,[\s\S]*?display:\s*block\s*!important/su);
  assert.match(printCss, /\.key-point\s*\{[^}]*display:\s*block\s*!important/su);
  assert.match(printCss, /\.practice-item\s*\{[^}]*border:\s*0\s*!important[^}]*background:\s*transparent\s*!important/su);
  assert.match(printCss, /\.practice-plan\s*\{[^}]*break-after:\s*avoid-page\s*!important/su);
  assert.match(printCss, /\.review-item\s*\{[^}]*min-height:\s*0\s*!important[^}]*padding:\s*4mm\s+5mm\s*!important/su);
  assert.match(pdf, /layoutAudit\.overflow\.length\s*\|\|\s*layoutAudit\.overlaps\.length/u);
  assert.match(pdf, /导出排版预检未通过/u);
  assert.match(pdf, /function assertPdfHasNoBlankPages/u);
  assert.match(pdf, /PDF 排版复核未通过/u);
  assert.match(pdf, /tagged:\s*true[\s\S]*outline:\s*true/u);
});

test("Word 导出使用统一 A4 令牌、固定表格几何和真实列表", async () => {
  const docx = await readFile(new URL("src/export/docx.js", projectRoot), "utf8");
  assert.match(docx, /PAGE_MARGIN_HORIZONTAL\s*=\s*1_020/u);
  assert.match(docx, /layout:\s*TableLayoutType\.FIXED/u);
  assert.match(docx, /indent:\s*\{\s*size:\s*indent,\s*type:\s*WidthType\.DXA\s*\}/u);
  assert.match(docx, /function labelDetailTable/u);
  assert.match(docx, /reference:\s*"visual-bullets"[\s\S]*format:\s*LevelFormat\.BULLET/u);
  assert.match(docx, /reference:\s*`practice-options-\$\{index \+ 1\}`/u);
  assert.match(docx, /headingParagraph\(index \+ 1, title\)/u);
  assert.doesNotMatch(docx, /headingParagraph\(index \+ 1, title, index > 0\)/u);
  assert.doesNotMatch(docx, /bodyParagraph\(`· \$\{item\}`/u);
});

test("Word 公式使用原生 OMML，不再走公式图片缓存", async () => {
  const [docx, wordMath] = await Promise.all([
    readFile(new URL("src/export/docx.js", projectRoot), "utf8"),
    readFile(new URL("src/export/word-math.js", projectRoot), "utf8")
  ]);
  assert.match(docx, /createEditableWordMath/u);
  assert.match(docx, /validateEditableWordMathPackage/u);
  assert.doesNotMatch(docx, /createFormulaImageCache|formulaCacheStorage|LaTeX:/u);
  assert.match(wordMath, /new OfficeMath/u);
  assert.match(wordMath, /m:oMath/u);
  assert.match(wordMath, /m:nary/u);
  assert.match(wordMath, /m:m/u);
  assert.doesNotMatch(wordMath, /ImageRun|renderFormulaImage/u);
});

test("Word 知识地图使用可编辑表格，不把节点公式画进图片", async () => {
  const docx = await readFile(new URL("src/export/docx.js", projectRoot), "utf8");
  assert.match(docx, /function knowledgeMapVisualTable/u);
  assert.match(docx, /bodyParagraph\(node\.label/u);
  assert.doesNotMatch(docx, /createKnowledgeMapImage|name:\s*["']knowledge-map["']/u);
});

test("所有内嵌教学图跨越父网格完整正文列", async () => {
  const readerCss = await readFile(new URL("public/reader.css", projectRoot), "utf8");
  assert.match(readerCss, /\.is-inline-reference\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*width:\s*100%/su);
  assert.match(readerCss, /\.mastery-level\s*>\s*\.teaching-figure-group\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/su);
  assert.match(readerCss, /\.knowledge-diagram-card,[\s\S]*?\.visual-block\s*\{[^}]*display:\s*block[^}]*width:\s*100%/u);
});

test("未完成 SVG 只显示稳定尺寸的图形生成进度画布", async () => {
  const [app, readerCss] = await Promise.all([
    readFile(new URL("public/app.js", projectRoot), "utf8"),
    readFile(new URL("public/reader.css", projectRoot), "utf8")
  ]);
  assert.match(app, /图形正在生产中/u);
  assert.match(app, /renderStatus !== "ready"/u);
  assert.match(app, /figure-render-progress/u);
  assert.match(app, /if \(token !== state\.figureLoadToken\) return "stale"/u);
  assert.doesNotMatch(app, /保留规范示意图/u);
  assert.doesNotMatch(app, /正在进行专属 SVG 精绘与质量复核|等待调度|AI 精绘|质量复核|已自动恢复第/u);
  assert.doesNotMatch(app, /figure-render-copy|figure-render-phases|figure-render-attempt/u);
  assert.match(readerCss, /\.teaching-figure-canvas\.is-pending\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/su);
  assert.match(readerCss, /@media \(prefers-reduced-motion:\s*reduce\)/u);
});

test("结果页使用五路单图原子任务渐进发布，不再等待整批图形", async () => {
  const app = await readFile(new URL("public/app.js", projectRoot), "utf8");
  assert.match(app, /FIGURE_RENDER_CONCURRENCY\s*=\s*5/u);
  assert.match(app, /pollTeachingFigureOnce/u);
  assert.match(app, /renderTeachingFiguresProgressively/u);
  assert.match(app, /claimNextTask/u);
  assert.match(app, /task\.queueOrder\s*=\s*queueSequence/u);
  assert.match(app, /task\.nextAttemptAt\s*=\s*Date\.now\(\)\s*\+\s*result\.pollAfterMs/u);
  assert.match(app, /while \(token === state\.figureLoadToken && completedCount < tasks\.length\)/u);
  assert.doesNotMatch(app, /fatalError/u);
  assert.match(app, /rejectedRenderVersion/u);
  assert.match(app, /Promise\.all\(Array\.from\(\{ length: workerCount \}/u);
  assert.match(app, /"X-Render-Id": renderTaskId/u);
  assert.doesNotMatch(app, /\/api\/render\/figures-batch/u);
  assert.match(app, /图形正在生产中/u);
});

test("生产图形链路保持原模型质量参数并彻底移除本地兜底", async () => {
  const [ai, server, figures] = await Promise.all([
    readFile(new URL("src/ai.js", projectRoot), "utf8"),
    readFile(new URL("server.js", projectRoot), "utf8"),
    readFile(new URL("src/figures.js", projectRoot), "utf8")
  ]);
  assert.match(ai, /max_tokens:\s*5_000/u);
  assert.match(ai, /timeoutMs:\s*40_000/u);
  assert.match(ai, /signal\s*\}/u);
  assert.match(ai, /process\.env\.AI_MODEL/u);
  assert.doesNotMatch(ai, /buildFallbackSvg/u);
  assert.doesNotMatch(server, /buildFallbackSvg|source:\s*["']local["']/u);
  assert.match(server, /FIGURE_RENDER_ATTEMPT_TIMEOUT_MS\s*=\s*135_000/u);
  assert.match(server, /renderFigureJobQuantum/u);
  assert.match(server, /rejectedRenderVersion/u);
  assert.match(figures, /FIGURE_EXPORT_INVALID/u);
  assert.doesNotMatch(figures, /return svg && isSemanticallyRelevantSvg\(svg, figure\) \? svg : buildFallbackSvg/u);
});

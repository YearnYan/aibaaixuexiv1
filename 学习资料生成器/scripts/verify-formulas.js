import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { buildFallbackSvg } from "../src/figures.js";
import { createMaterialTemplate } from "../src/material.js";

const baseUrl = process.env.VERIFY_BASE_URL || "http://127.0.0.1:5174";
const outputDirectory = path.resolve("output/formula-qa");
const outputTag = String(process.env.VERIFY_OUTPUT_TAG || "")
  .trim()
  .replace(/[<>:"/\\|?*\x00-\x1f]/gu, "-");

function taggedFilename(filename) {
  if (!outputTag) return filename;
  const extension = path.extname(filename);
  return `${path.basename(filename, extension)}-${outputTag}${extension}`;
}

const material = createMaterialTemplate({
  sources: [{
    name: "全学科公式验收.txt",
    kind: "txt",
    size: 2_048,
    text: "用于检查数学、物理、化学、生物、地理公式在网页、PDF 和 Word 中的一致显示。"
  }],
  options: { grade: "初高中", subject: "综合", goal: "understand", depth: "detailed" }
});

material.meta.title = "全学科公式渲染验收";
material.meta.summary = String.raw`依次检查数学 $f(x)=ax^2+bx+c$、物理 $\vec{F}=m\vec{a}$、化学 $\ce{H2O}$、生物 $Aa\times Aa$ 和地理 $30^\circ\mathrm{N}$。`;
material.overview.coreQuestion = String.raw`网页与导出文件能否一致显示 $$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$$？`;
material.overview.readingTip = String.raw`先看行内公式 $v=\frac{\Delta x}{\Delta t}$，再看独立公式和化学反应式。`;
material.overview.outline = [
  String.raw`数学：$a^2+b^2=c^2$`,
  String.raw`物理：$9.8\,\mathrm{m\,s^{-2}}$`,
  String.raw`化学：$\ce{SO4^2-}$`,
  String.raw`生物与地理：$3:1$、$1:50\,000$`
];

material.knowledgeMap.nodes[0].label = String.raw`数学 $\Delta=b^2-4ac$`;
material.knowledgeMap.nodes[0].detail = String.raw`当 $\Delta>0$ 时有两个不相等的实数根。`;
material.knowledgeMap.nodes[1].label = String.raw`物理 $\vec{F}=m\vec{a}$`;
material.knowledgeMap.nodes[1].detail = String.raw`速度关系为 $v=\frac{\Delta x}{\Delta t}$。`;
material.knowledgeMap.nodes[2].label = String.raw`化学 $\ce{2H2 + O2 -> 2H2O}$`;
material.knowledgeMap.nodes[2].detail = String.raw`离子示例为 $\ce{SO4^2-}$。`;
material.knowledgeMap.nodes[3].label = String.raw`生物 $Aa\times Aa$`;
material.knowledgeMap.nodes[3].detail = String.raw`表现型比例可写为 $3:1$。`;
material.knowledgeMap.nodes[4].label = String.raw`地理 $30^\circ\mathrm{N}$`;
material.knowledgeMap.nodes[4].detail = String.raw`比例尺为 $1:50\,000$。`;

material.keyPoints[0].title = String.raw`数学：$\Delta$ 与根`;
material.keyPoints[0].explanation = String.raw`先计算 $\Delta=b^2-4ac$，再判断根的个数。求根时使用 $$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$$。`;
material.keyPoints[1].title = String.raw`物理：$\vec{F}$ 与 $\vec{a}$`;
material.keyPoints[1].explanation = String.raw`合力满足 $\vec{F}=m\vec{a}$。代入前先统一到 $\mathrm{N}$、$\mathrm{kg}$、$\mathrm{m\,s^{-2}}$。`;
material.keyPoints[2].title = String.raw`化学：$\ce{H2O}$ 的生成`;
material.keyPoints[2].explanation = String.raw`配平后的反应式为 $$\ce{2H2 + O2 -> 2H2O}$$，原子种类和数量守恒。`;

material.closeReading[0].original = String.raw`遗传组合 $Aa\times Aa$ 的基因型比例是 $1:2:1$。`;
material.closeReading[0].explanation = String.raw`先列配子 $A$ 与 $a$，再组合得到 $AA$、$Aa$、$aa$。`;
material.closeReading[1].original = String.raw`纬度 $30^\circ\mathrm{N}$ 表示北纬三十度。`;
material.closeReading[1].explanation = String.raw`比例尺 $1:50\,000$ 表示图上 $1\,\mathrm{cm}$ 对应实际 $500\,\mathrm{m}$。`;

material.workedExamples[0].problem = String.raw`已知 $a=1$、$b=-3$、$c=2$，求方程 $ax^2+bx+c=0$ 的根。`;
material.workedExamples[0].answer = String.raw`由 $$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$$ 得 $x_1=1$、$x_2=2$。`;
material.workedExamples[1].problem = String.raw`配平反应式 $\ce{H2 + O2 -> H2O}$。`;
material.workedExamples[1].answer = String.raw`正确结果是 $$\ce{2H2 + O2 -> 2H2O}$$。`;

material.practice[0].question = String.raw`计算 $\Delta=b^2-4ac$ 并判断根的个数。`;
material.practice[1].question = String.raw`用 $\vec{F}=m\vec{a}$ 求加速度并写出单位。`;
material.practice[2].question = String.raw`说明 $\ce{SO4^2-}$ 中的电荷含义。`;
material.practice[3].question = String.raw`比较 $Aa\times Aa$、$30^\circ\mathrm{N}$ 与 $1:50\,000$ 的读法。`;
material.masteryChecks[0].task = String.raw`脱稿写出 $a^2+b^2=c^2$ 与 $\vec{F}=m\vec{a}$。`;
material.masteryChecks[1].task = String.raw`正确写出 $\ce{2H2 + O2 -> 2H2O}$。`;
material.masteryChecks[2].task = String.raw`解释 $Aa\times Aa$、$3:1$、$30^\circ\mathrm{N}$ 和 $1:50\,000$。`;
const qaFigure = {
  id: "D1-formula-qa",
  subject: "综合",
  type: "diagram",
  title: "全学科公式结构验收图",
  purpose: "标记公式验收报告包含完整教学图形阶段。",
  description: "用关系结构图展示数学、物理、化学、生物和地理公式均进入统一规范表达流程。",
  stem: "全学科公式统一规范表达。",
  placement: { section: "knowledgeDiagrams", refId: "D1" },
  caption: "本图只用于验证完整报告导出契约，公式质量由原生 Office Math 结构独立验收。",
  params: { teachingRole: "knowledge-overview", placementRef: "knowledgeDiagrams:D1" },
  constraints: ["五类学科名称完整", "结构关系清晰", "不包含答案线索"]
};
material.teachingFigures = [{
  ...qaFigure,
  renderStatus: "ready",
  svg: buildFallbackSvg({ ...qaFigure, figureType: qaFigure.type })
}];

async function download(format, filename, expectedMagic) {
  const response = await fetch(`${baseUrl}/api/export/${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ material })
  });
  if (!response.ok) throw new Error(`${format} 导出失败（${response.status}）：${await response.text()}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.subarray(0, expectedMagic.length).equals(expectedMagic)) throw new Error(`${format} 文件签名不正确`);
  const outputPath = path.join(outputDirectory, filename);
  await writeFile(outputPath, buffer);
  if (format !== "docx") return { outputPath, bytes: buffer.length };
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("Word 文件缺少 document.xml");
  const formulaCount = (documentXml.match(/<m:oMath(?:\s[^>]*)?>/gu) || []).length;
  const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name].dir);
  if (!formulaCount) throw new Error("Word 文件未生成原生可编辑公式");
  if (/<wp:docPr\b[^>]*(?:name="LaTeX:|title="(?:行内公式|独立公式)")/u.test(documentXml)) {
    throw new Error("Word 文件仍包含公式图片标记");
  }
  return {
    outputPath,
    bytes: buffer.length,
    formulaCount,
    fractionCount: (documentXml.match(/<m:f>/gu) || []).length,
    radicalCount: (documentXml.match(/<m:rad>/gu) || []).length,
    subscriptCount: (documentXml.match(/<m:sSub>/gu) || []).length,
    superscriptCount: (documentXml.match(/<m:sSup>/gu) || []).length,
    accentCount: (documentXml.match(/<m:acc>/gu) || []).length,
    mediaFiles
  };
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "material.json"), JSON.stringify(material, null, 2), "utf8");
const pdf = await download("pdf", taggedFilename("全学科公式验收.pdf"), Buffer.from("%PDF"));
const docx = await download("docx", taggedFilename("全学科公式验收.docx"), Buffer.from("PK"));
console.log(JSON.stringify({ pdf, docx }, null, 2));

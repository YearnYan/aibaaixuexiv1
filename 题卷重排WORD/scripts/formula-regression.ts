import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  canRenderFormulaInKatex,
  normalizeEducationalUnicode,
  normalizePortableLatex,
  toReadableFormulaText,
} from "../shared/formulaText.js";
import { mathTextForMarkdown, normalizeRecognizedMathText } from "../shared/mathText.js";
import { exportQuestionsToDocx as exportClientDocx } from "../src/lib/wordExport.js";
import { exportQuestionsToDocx as exportServerDocx } from "../server/wordExport.js";

type FormulaCase = {
  subject: string;
  formula: string;
  expectedRenderable?: boolean;
  expectedNormalized?: RegExp;
};

const screenshotFormulaWithControlCharacter = `${String.raw`\begin{cases}
\frac{x-2}{2}-\frac{5-y}{3}=1, `}${String.fromCodePoint(0x85)}${String.raw`\\
\frac{x}{0.2}-\frac{y+1}{0.3}=5.
\end{cases}`}`;

const formulaCases: FormulaCase[] = [
  { subject: "数学-分式", formula: String.raw`\frac{x^2-1}{x-1}=x+1`, expectedRenderable: true },
  { subject: "数学-根式", formula: String.raw`\sqrt[3]{8}+\sqrt{a^2+b^2}`, expectedRenderable: true },
  { subject: "数学-方程组", formula: String.raw`\begin{cases}\frac{x-2}{2}-\frac{5-y}{3}=1,\\\frac{x}{0.2}-\frac{y+1}{0.3}=5.\end{cases}`, expectedRenderable: true },
  { subject: "数学-方程组含异常字符", formula: screenshotFormulaWithControlCharacter, expectedRenderable: true },
  { subject: "数学-矩阵", formula: String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`, expectedRenderable: true },
  { subject: "数学-集合", formula: String.raw`A\cup B,\quad A\cap B,\quad x\in\mathbb{R}`, expectedRenderable: true },
  { subject: "数学-极限", formula: String.raw`\lim_{x\to0}\frac{\sin x}{x}=1`, expectedRenderable: true },
  { subject: "数学-积分求和", formula: String.raw`\int_0^1x^2\,dx=\frac13,\quad\sum_{k=1}^{n}k=\frac{n(n+1)}2`, expectedRenderable: true },
  { subject: "数学-概率统计", formula: String.raw`P(A\cup B)=P(A)+P(B)-P(A\cap B),\quad \mathop{\mathrm{Var}}(X)=E(X^2)-[E(X)]^2`, expectedRenderable: true },
  { subject: "数学-复数与数列", formula: String.raw`z=a+bi,\quad a_n=a_1q^{n-1},\quad |z|=\sqrt{a^2+b^2}`, expectedRenderable: true },
  { subject: "数学-几何向量", formula: String.raw`\vec{AB}\perp\overrightarrow{CD},\quad\triangle ABC`, expectedRenderable: true },
  { subject: "数学-粗体向量", formula: String.raw`(\boldsymbol{a}\cdot\boldsymbol{b})\boldsymbol{c}=\boldsymbol{a}(\boldsymbol{b}\cdot\boldsymbol{c})`, expectedRenderable: true, expectedNormalized: /\\mathbf\{a\}/ },
  { subject: "物理-力学", formula: String.raw`F=ma,\quad E=mc^2,\quad \vec{v}=20\mathrm{m/s}`, expectedRenderable: true },
  { subject: "物理-电学", formula: String.raw`U=IR,\quad P=UI,\quad R=10\Omega`, expectedRenderable: true },
  { subject: "物理-波动", formula: String.raw`f=5.0\times10^3\mathrm{Hz},\quad \lambda=\frac{c}{f}`, expectedRenderable: true },
  { subject: "物理-单位", formula: String.raw`\Delta t=0.2\mathrm{s},\quad a=9.8\mathrm{m/s^2},\quad \rho=1.0\mathrm{kg/m^3}`, expectedRenderable: true },
  { subject: "物理-热学光学", formula: String.raw`\frac1f=\frac1u+\frac1v,\quad k=0.24\mathrm{W/(m\cdot K)},\quad \eta=85\%`, expectedRenderable: true },
  { subject: "物理-核反应", formula: String.raw`{}^{235}_{92}\mathrm{U}+{}^{1}_{0}\mathrm{n}\rightarrow{}^{141}_{56}\mathrm{Ba}+{}^{92}_{36}\mathrm{Kr}+3{}^{1}_{0}\mathrm{n}`, expectedRenderable: true },
  { subject: "化学-反应", formula: String.raw`\ce{2H2 + O2 -> 2H2O}`, expectedRenderable: true, expectedNormalized: /\\rightarrow/ },
  { subject: "化学-离子沉淀", formula: String.raw`\ce{Fe^{3+} + 3OH^- -> Fe(OH)3 v}`, expectedRenderable: true, expectedNormalized: /Fe\(OH\)_\{3\}/ },
  { subject: "化学-原生上下标", formula: "H₂O+Ca²⁺", expectedRenderable: true, expectedNormalized: /H_\{2\}O\+Ca\^\{2\+\}/ },
  { subject: "化学-同位素", formula: String.raw`{}^{14}_{6}\mathrm{C}`, expectedRenderable: true },
  { subject: "化学-平衡与浓度", formula: String.raw`N_2+3H_2\rightleftharpoons2NH_3,\quad c(H^+)=1.0\times10^{-3}\mathrm{mol/L},\quad \mathrm{pH}=3`, expectedRenderable: true },
  { subject: "生物-遗传信息", formula: String.raw`\mathrm{DNA}\xrightarrow{\text{转录}}\mathrm{RNA}\xrightarrow{\text{翻译}}\text{蛋白质}`, expectedRenderable: true },
  { subject: "生物-倍性与能量", formula: String.raw`2n=46,\quad \mathrm{ATP}\rightarrow\mathrm{ADP}+P_i`, expectedRenderable: true },
  { subject: "生物-遗传与链方向", formula: String.raw`Aa\times Aa,\quad 5^{\prime}\rightarrow3^{\prime},\quad \mathrm{C_6H_{12}O_6}+6O_2\rightarrow6CO_2+6H_2O`, expectedRenderable: true },
  { subject: "地理-经纬度", formula: String.raw`30^\circ15′20″\mathrm{N},\quad120^\circ08′\mathrm{E}`, expectedRenderable: true },
  { subject: "地理-气候与面积", formula: String.raw`T=25^\circ\mathrm{C},\quad p=1013\mathrm{hPa},\quad S=100\mathrm{km^2}`, expectedRenderable: true },
  { subject: "地理-体积密度", formula: String.raw`V=5\mathrm{m^3/s},\quad\rho=120\mathrm{人/km^2},\quad1:50000`, expectedRenderable: true },
  { subject: "地理-坡度盐度湿度", formula: String.raw`i=\frac{\Delta h}{L}\times100\%,\quad S=35\text{‰},\quad RH=80\%,\quad p=1013\mathrm{hPa}`, expectedRenderable: true },
  { subject: "损坏公式降级", formula: String.raw`\frac{1}{x`, expectedRenderable: false },
  { subject: "未知命令降级", formula: String.raw`\unsupportedcommand{A}{B}`, expectedRenderable: false },
];

for (const item of formulaCases) {
  const normalized = normalizePortableLatex(item.formula);
  const readable = toReadableFormulaText(item.formula);
  const renderable = canRenderFormulaInKatex(normalized, true);

  assert.equal(hasForbiddenFormulaCharacter(normalized), false, `${item.subject} 未清理不可移植字符`);
  assert.equal(/\\ce\b/.test(normalized), false, `${item.subject} 仍残留 mhchem 专用命令`);
  assert.equal(/\\[A-Za-z]+/.test(readable), false, `${item.subject} 可读降级仍泄露 LaTeX 命令：${readable}`);
  assert.equal(renderable, item.expectedRenderable ?? true, `${item.subject} KaTeX 预检结果异常：${normalized}`);
  if (item.expectedNormalized) {
    assert.match(normalized, item.expectedNormalized, `${item.subject} 未完成规范化`);
  }

  const markdown = mathTextForMarkdown(`题干公式：\\(${item.formula}\\)`);
  if (item.expectedRenderable === false) {
    assert.equal(/\\(?:frac|unsupportedcommand)\b/.test(markdown), false, `${item.subject} 网页降级仍暴露源码`);
  }
}

const structuralText = normalizeRecognizedMathText(String.raw`方程组：\begin{cases}x&=1\\y&=2\end{cases}`);
assert.match(structuralText, /\\\(\\begin\{cases\}[\s\S]*&[\s\S]*\\end\{cases\}\\\)/, "方程组被错误拆分");

const screenshotInlineText = normalizeRecognizedMathText(`题干：\\(${screenshotFormulaWithControlCharacter}\\)`);
assert.equal(hasForbiddenFormulaCharacter(screenshotInlineText), false, "截图同类 C1 控制符未在公式入口清洗");
assert.match(screenshotInlineText, /\\begin\{cases\}/, "截图同类方程组未保留结构");

const plainScienceText = normalizeRecognizedMathText("面积为100km²，流量为5m³/s，浓度为0.2mol·L⁻¹，压强p=1013hPa，离子为Ca²⁺。");
assert.match(plainScienceText, /km\^2/, "面积单位未转为可移植公式");
assert.match(plainScienceText, /m\^3\/s/, "体积流量单位未转为可移植公式");
assert.match(plainScienceText, /Ca\^\{2\+\}/, "原生离子电荷未转为可移植公式");
assert.ok(plainScienceText.includes("\\cdot L^-1"), "物质的量浓度单位未保留乘号与负指数");

const crossSubjectOcrText = `数学：ｘ＝１﹢２；物理：Ｆ＝ｍａ、5ｍ／ｓ²；化学：Ca²⁺；生物：5′→3′；地理：30°15′N。${String.fromCodePoint(0xE123)}${String.fromCodePoint(0x2400)}�`;
const normalizedCrossSubjectText = normalizeRecognizedMathText(crossSubjectOcrText);
assert.equal(hasForbiddenFormulaCharacter(normalizedCrossSubjectText), false, "跨学科正文仍包含私有区、控制图片或替换字符");
assert.doesNotMatch(normalizedCrossSubjectText, /[ａ-ｚＡ-Ｚ０-９＋／﹢�]/u, "全角或 OCR 等价字形未统一");
assert.match(normalizedCrossSubjectText, /x=1\+2/u, "全角数学表达未恢复为标准字符");
assert.match(normalizedCrossSubjectText, /m\/s\^2/u, "物理单位未进入标准公式管线");

const htmlEntityText = normalizeEducationalUnicode("a &le; b，T=25&#176;C，R=10&Omega;，方向&rarr;");
assert.equal(htmlEntityText, "a ≤ b，T=25°C，R=10Ω，方向→", "HTML/数字实体未恢复为标准教学符号");

const genericLatexCommand = mathTextForMarkdown(String.raw`统计量 \mathop{\mathrm{Var}}(X)=1`);
assert.match(genericLatexCommand, /\$[^$]*\\mathop/u, "未枚举但可渲染的 LaTeX 命令没有进入公式管线");
assert.equal(/\\mathop/.test(genericLatexCommand.replace(/\$[^$]*\$/g, "")), false, "通用 LaTeX 命令裸露在正文中");

const codecogsOption = String.raw`A. ![](https://latex.codecogs.com/gif.latex?%5Ctext%7BA%7D)`;
const normalizedCodecogsOption = normalizeRecognizedMathText(codecogsOption);
assert.doesNotMatch(normalizedCodecogsOption, /codecogs|!\[/, "在线公式图片未转换为可移植公式");
assert.match(normalizedCodecogsOption, /\\\(\\mathrm\{A\}\\\)/, "Codecogs 公式内容未正确解码");

const questions = formulaCases.map((item, index) => ({
  id: `formula-${index + 1}`,
  number: String(index + 1),
  pageIndex: 0,
  stemMarkdown: `【${item.subject}】\\[${item.formula}\\]`,
  options: [],
  figures: [],
}));
questions.push({
  id: "screenshot-regression",
  number: String(formulaCases.length + 1),
  pageIndex: 0,
  stemMarkdown: String.raw`设非零平面向量 \(\boldsymbol{a}\)、\(\boldsymbol{b}\)、\(\boldsymbol{c}\)，且满足 \((\boldsymbol{a}\cdot\boldsymbol{b})\boldsymbol{c}=\boldsymbol{a}(\boldsymbol{b}\cdot\boldsymbol{c})\)。
| 选手 | 甲 | 乙 | 丙 | 丁 |
| :--- | :--- | :--- | :--- | :--- |
| 方差 | 0.035 | 0.016 | 0.022 | 0.025 |`,
  options: [
    codecogsOption,
    String.raw`B. ![](https://latex.codecogs.com/gif.latex?%5Ctext%7BB%7D)`,
    String.raw`C. ![](https://latex.codecogs.com/gif.latex?%5Ctext%7BC%7D)`,
    String.raw`D. ![](https://latex.codecogs.com/gif.latex?%5Ctext%7BD%7D)`,
  ],
  figures: [],
});

const clientBlob = await exportClientDocx({ title: "跨学科公式回归", questions });
const clientBuffer = Buffer.from(await clientBlob.arrayBuffer());
await verifyDocx(clientBuffer, "客户端");

const serverBuffer = await exportServerDocx({ title: "跨学科公式回归", questions });
await verifyDocx(serverBuffer, "服务端");

// 对齐用户的大试卷场景：混合结构化公式、控制符清洗和降级公式，确保单题不会拖垮整份下载。
const largeQuestions = Array.from({ length: 810 }, (_, index) => {
  const item = formulaCases[index % formulaCases.length];
  return {
    id: `large-formula-${index + 1}`,
    number: String(index + 1),
    pageIndex: 0,
    stemMarkdown: `【${item.subject}】\\[${item.formula}\\]`,
    options: [],
    figures: [],
  };
});
const largeExportStartedAt = performance.now();
const largeBlob = await exportClientDocx({ title: "810 题跨学科公式回归", questions: largeQuestions });
const largeBuffer = Buffer.from(await largeBlob.arrayBuffer());
await verifyDocx(largeBuffer, "客户端 810 题");
const largeElapsedMs = performance.now() - largeExportStartedAt;
assert.ok(largeElapsedMs < 45_000, `客户端 810 题公式导出耗时过长：${Math.round(largeElapsedMs)}ms`);

const outputDirectory = path.resolve("tmp/docs", `formula-regression-${Date.now()}`);
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "formula-regression-client.docx"), clientBuffer);
await writeFile(path.join(outputDirectory, "formula-regression-server.docx"), serverBuffer);

console.log(`公式回归通过：${formulaCases.length} 条语料，客户端 ${clientBuffer.length} 字节，服务端 ${serverBuffer.length} 字节，810 题 ${Math.round(largeElapsedMs)}ms。回归文档：${outputDirectory}`);

function hasForbiddenFormulaCharacter(value: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\u2400-\u2426\uE000-\uF8FF\uFE00-\uFE0F\uFFF0-\uFFFF]/.test(value);
}

async function verifyDocx(buffer: Buffer, label: string) {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file("word/document.xml");
  assert.ok(documentFile, `${label} DOCX 缺少 document.xml`);
  const documentXml = await documentFile.async("string");

  assert.equal(/@@MATH_\d+@@/.test(documentXml), false, `${label} DOCX 遗留公式占位符`);
  assert.equal(/\\(?:begin|end|frac|ce|unsupportedcommand)\b/.test(documentXml), false, `${label} DOCX 暴露原始 LaTeX`);
  assert.equal(/codecogs|!\[|boldsymbol|\\bm\b|:---/.test(documentXml), false, `${label} DOCX 遗留 Markdown 或公式命令名`);
  assert.match(documentXml, /<m:oMath(?:\s|>)/, `${label} DOCX 未生成 OMML`);
  assert.match(documentXml, /<m:m(?:\s|>)/, `${label} DOCX 未保留方程组/矩阵结构`);
  assert.match(documentXml, /<m:f(?:\s|>)/, `${label} DOCX 未保留分式结构`);
  assert.match(documentXml, /<m:oMath[\s\S]*?<w:b\/>[\s\S]*?<\/m:oMath>/, `${label} DOCX 未保留粗体向量语义`);
}

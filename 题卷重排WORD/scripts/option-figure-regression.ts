import assert from "node:assert/strict";
import JSZip from "jszip";
import { normalizeRecognizedMathText } from "../shared/mathText.js";
import {
  filterVisualOptionPlaceholders,
  hasVisualOptionPlaceholderSet,
  isVisualOptionPlaceholder,
  normalizeOptionLabel,
  restoreVisualOptionLabels,
} from "../shared/optionText.js";
import { exportQuestionsToDocx as exportServerQuestionsToDocx } from "../server/wordExport.js";
import { exportQuestionsToDocx as exportClientQuestionsToDocx } from "../src/lib/wordExport.js";

const emptyCodecogsOption = "A. ![](https://latex.codecogs.com/gif.latex?)";
assert.equal(isVisualOptionPlaceholder(emptyCodecogsOption), true);
assert.equal(isVisualOptionPlaceholder("B. ![Blank Equation](https://latex.codecogs.com/gif.latex?)"), true);
assert.equal(isVisualOptionPlaceholder("C. Blank Equation"), true);
assert.equal(isVisualOptionPlaceholder("A. 图片内容未识别"), true);
assert.equal(isVisualOptionPlaceholder("B. 公式内容无法完整解析"), true);
assert.equal(isVisualOptionPlaceholder("D."), true);
assert.equal(isVisualOptionPlaceholder(String.raw`A. \(x\ge 5\)`), false, "真实公式选项被误判为视觉占位");
assert.equal(isVisualOptionPlaceholder("B. 正方形"), false, "真实文字选项被误判为视觉占位");

const visualOptions = ["A", "B", "C", "D"].map((label) => `${label}. ![](https://latex.codecogs.com/gif.latex?)`);
assert.equal(hasVisualOptionPlaceholderSet(visualOptions), true);
assert.deepEqual(filterVisualOptionPlaceholders(visualOptions), []);
assert.deepEqual(restoreVisualOptionLabels(visualOptions), ["A.", "B.", "C.", "D."]);
assert.equal(normalizeOptionLabel("A选项图"), "A");
assert.equal(normalizeOptionLabel("B 选项图片"), "B");
assert.deepEqual(
  filterVisualOptionPlaceholders([visualOptions[0], "B. 正方形", visualOptions[2], String.raw`D. \(x=1\)`]),
  ["B. 正方形", String.raw`D. \(x=1\)`],
  "混合选项中的有效文字或公式未被保留",
);

const readableFallback = normalizeRecognizedMathText(emptyCodecogsOption);
assert.doesNotMatch(readableFallback, /codecogs|!\[/i);
assert.match(readableFallback, /图片内容未识别/);

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";
const tinyPngBuffer = Buffer.from(tinyPng.slice(tinyPng.indexOf(",") + 1), "base64");
const optionImage = (label: string) => `data:image/png;base64,${Buffer.concat([
  tinyPngBuffer,
  Buffer.from(label, "utf8"),
]).toString("base64")}`;
const exportPayload = {
  title: "图形选项回归",
  questions: [{
    id: "visual-option-question",
    number: "1",
    pageIndex: 0,
    stemMarkdown: "下列图案是中心对称图形的是（ ）",
    options: visualOptions,
    figures: ["A", "B", "C", "D"].map((label) => ({
      id: `visual-option-${label.toLowerCase()}`,
      kind: "option" as const,
      optionLabel: label,
      dataUrl: optionImage(label),
      width: 220,
      height: 140,
      caption: `${label} 选项图`,
    })),
  }],
};

const clientDocx = await exportClientQuestionsToDocx(exportPayload);
const serverDocx = await exportServerQuestionsToDocx(exportPayload);
await assertVisualOptionDocx(await clientDocx.arrayBuffer(), "客户端");
await assertVisualOptionDocx(serverDocx, "服务端");

async function assertVisualOptionDocx(content: ArrayBuffer | Buffer, exporter: string) {
  const zip = await JSZip.loadAsync(content);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  assert.ok(documentXml, `${exporter}图形选项 DOCX 缺少 document.xml`);
  assert.doesNotMatch(documentXml, /Blank Equation|codecogs|!\[/i);
  for (const label of ["A", "B", "C", "D"]) {
    assert.match(documentXml, new RegExp(`<w:t[^>]*>${label}\\.<\\/w:t>`), `${exporter} Word 中缺少 ${label} 选项标签`);
  }
  assert.equal((documentXml.match(/<w:drawing>/g) || []).length, 4, `${exporter} Word 中应包含四个独立选项图片`);
  assert.equal(
    Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !name.endsWith("/")).length,
    4,
    `${exporter}四个视觉选项应分别写入 Word 图片资源`,
  );
}

console.log("图形选项回归通过：A/B/C/D 结构恢复、四图独立导出和失败占位清理均正常。");

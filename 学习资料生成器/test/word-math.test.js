import assert from "node:assert/strict";
import test from "node:test";
import { Document, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import {
  createEditableWordMath,
  validateEditableWordMathPackage
} from "../src/export/word-math.js";

const FORMULA_CORPUS = [
  [String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, true],
  [String.raw`\sqrt[3]{x+1}`, false],
  [String.raw`\sum_{i=1}^{n}i`, true],
  [String.raw`\int_0^1x^2\,dx`, true],
  [String.raw`\lim_{x\to0}\frac{\sin x}{x}=1`, true],
  [String.raw`\vec{F}=m\vec{a}`, false],
  [String.raw`\ce{2H2 + O2 -> 2H2O}`, true],
  [String.raw`\ce{SO4^2-}`, false],
  [String.raw`Aa\times Aa`, false],
  [String.raw`30^\circ\mathrm{N}`, false],
  [String.raw`1:50\,000`, false],
  [String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, true],
  [String.raw`f(x)=\begin{cases}x^2,&x\ge0\\-x,&x<0\end{cases}`, true]
];

async function buildFormulaDocument(corpus = FORMULA_CORPUS) {
  const formulas = corpus.map(([latex, display]) => createEditableWordMath(latex, display));
  const document = new Document({
    sections: [{
      children: formulas.map((formula) => new Paragraph({ children: [formula.math] }))
    }]
  });
  const buffer = Buffer.from(await Packer.toBuffer(document));
  const validation = await validateEditableWordMathPackage(
    buffer,
    formulas.map((formula) => formula.metadata)
  );
  return { buffer, formulas, validation };
}

test("跨学科和复杂结构全部生成原生可编辑 Office Math", async () => {
  const { buffer, validation } = await buildFormulaDocument();
  const xml = validation.documentXml;
  const expectedTags = ["m:oMath", "m:f", "m:rad", "m:sSub", "m:sSup", "m:nary", "m:limLow", "m:acc", "m:m", "m:d"];
  expectedTags.forEach((tag) => assert.match(xml, new RegExp(`<${tag}(?:>|\\s)`, "u"), `应包含 ${tag}`));
  assert.equal(validation.formulaCount, FORMULA_CORPUS.length);
  assert.doesNotMatch(xml, /\$\$?|\\(?:frac|sqrt|ce|vec|mathrm|begin)\b/u);
  assert.doesNotMatch(xml, /<w:drawing>[\s\S]*?<\/w:drawing>/u);

  const zip = await JSZip.loadAsync(buffer);
  const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name].dir);
  assert.deepEqual(mediaFiles, [], "纯公式文档不应生成任何媒体图片");
});

test("化学角标、电荷和反应式保留可编辑字符与上下标结构", async () => {
  const corpus = [
    [String.raw`\ce{2H2 + O2 -> 2H2O}`, true],
    [String.raw`\ce{SO4^2-}`, false],
    [String.raw`\ce{Fe^{3+} + 3OH^- -> Fe(OH)3}`, true]
  ];
  const { validation } = await buildFormulaDocument(corpus);
  const xml = validation.documentXml;
  ["H", "O", "S", "Fe", "3", "2"].forEach((token) => assert.match(xml, new RegExp(token, "u")));
  assert.match(xml, /<m:sSub>/u);
  assert.match(xml, /<m:sSup>/u);
  assert.doesNotMatch(xml, /LaTeX:|<w:drawing>/u);
});

test("不可解析公式直接阻止 Word 导出，不转成图片或普通文本", () => {
  assert.throws(
    () => createEditableWordMath(String.raw`\frac{a}{`, true),
    (error) => error.code === "WORD_MATH_CONVERSION_FAILED" && /Word 原生公式转换失败/u.test(error.message)
  );
});

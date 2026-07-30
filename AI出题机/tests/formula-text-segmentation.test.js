const test = require('node:test');
const assert = require('node:assert/strict');
const {
  splitTextOutsideLatexFormulas
} = require('../shared/formula-text-segmentation');
const { compileFormula, scanText } = require('../shared/subject-content-contract');

function legacySplit(value) {
  const lines = String(value || '').split(/\r?\n+/).map((part) => part.trim()).filter(Boolean);
  return lines.flatMap((line) => {
    const sentences = line.match(/[^。；！？]+[。；！？]?/g);
    return (sentences || [line]).map((part) => part.trim()).filter(Boolean);
  });
}

test('解析拆步不得把独立公式定界符拆成 Word 正文文本', () => {
  const explanation = String.raw`先根据题意建立分段关系。
\[
f(x)=\begin{cases}
x+1,&x\ge 0\\
-x,&x<0
\end{cases}
\]
最后代入边界值检验。`;

  const legacySteps = legacySplit(explanation);
  assert.ok(legacySteps.some((step) => step === String.raw`\[`), '旧切分会制造截图中的独立 \\[ 文本节点');

  const steps = splitTextOutsideLatexFormulas(explanation);
  assert.deepEqual(steps, [
    '先根据题意建立分段关系。',
    String.raw`\[
f(x)=\begin{cases}
x+1,&x\ge 0\\
-x,&x<0
\end{cases}
\]`,
    '最后代入边界值检验。'
  ]);
  steps.forEach((step, index) => {
    const scan = scanText(step, { subject: '数学', path: `steps[${index}]` });
    assert.deepEqual(scan.errors, []);
    scan.formulas.forEach((formula) => assert.equal(compileFormula(formula), null));
  });
});

test('公式内的中文教学标点和换行不得成为解析切分点', () => {
  const explanation = String.raw`条件记为 \(C=\text{若；则。}\)，所以先求合力；化学反应写为 \(\ce{2H2 + O2 -> 2H2O}\)。
再由 \(P=\frac{W}{t}\) 得到结论。`;
  assert.deepEqual(splitTextOutsideLatexFormulas(explanation), [
    String.raw`条件记为 \(C=\text{若；则。}\)，所以先求合力；`,
    String.raw`化学反应写为 \(\ce{2H2 + O2 -> 2H2O}\)。`,
    String.raw`再由 \(P=\frac{W}{t}\) 得到结论。`
  ]);
});

test('九学科文本拆步后均保持完整公式边界', () => {
  const samples = [
    String.raw`数学：先求 \(x=2\)；再验证。`,
    String.raw`物理：由 \(v=10\,\mathrm{m/s}\) 可知结果。`,
    String.raw`化学：反应为 \(\ce{2H2 + O2 -> 2H2O}\)；据此判断。`,
    String.raw`生物：概率为 \(P=\frac{1}{4}\)；完成推断。`,
    String.raw`地理：位置为 \(30^\circ\mathrm{N}\)；比较纬度。`,
    '历史：先提取材料信息；再比较史实。',
    '语文：先概括段意；再分析作用。',
    '英语：Read the passage; then choose the answer.',
    String.raw`政治：变化率为 \(r=\frac{\Delta P}{P_0}\times100\%\)；据此分析。`
  ];

  samples.flatMap(splitTextOutsideLatexFormulas).forEach((step) => {
    assert.equal(/^(?:\\\[|\\\])$/.test(step), false);
    assert.equal(/^(?:\\\(|\\\))$/.test(step), false);
  });
});

test('解析拆步拒绝不闭合、错序、嵌套和双重转义公式边界', () => {
  const invalidValues = [
    String.raw`开始 \[x+1`,
    String.raw`开始 \(x+1\]`,
    String.raw`开始 \(x+\[1\]\)`,
    String.raw`开始 \\(x+1\\)`
  ];
  invalidValues.forEach((value) => {
    assert.throws(() => splitTextOutsideLatexFormulas(value), /公式边界/);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import 'katex/contrib/mhchem';
import { normalizeLatexMath, splitScientificText } from '../src/scientificText.js';

test('修复未闭合公式、中文命令和蕴含符号', () => {
  const input = String.raw`\(h_2 > h_1 \implies p_2 > p_1 \implies F_{\向上} > F_{\向下}

F_{\text{浮}} = F_{\向上} - F_{\向下}`;
  const math = splitScientificText(input).filter((segment) => segment.type === 'math');

  assert.equal(math.length, 2);
  assert.equal(math[0].recovered, true);
  assert.match(math[0].value, /\\Rightarrow/);
  assert.match(math[0].value, /F_\{\\text\{向上\}\}/);
  assert.match(math[0].value, /F_\{\\text\{向下\}\}/);
  assert.doesNotThrow(() => katex.renderToString(math[0].value, { throwOnError: true }));
  assert.doesNotThrow(() => katex.renderToString(math[1].value, { throwOnError: true }));
});

test('识别普通中文中的裸公式但不吞入中文正文', () => {
  const segments = splitScientificText(String.raw`若物体底部贴合，F_{\向上} = 0 ⇒ 不受浮力。`);
  const formula = segments.find((segment) => segment.type === 'math');

  assert.equal(segments[0].value, '若物体底部贴合，');
  assert.equal(formula.value, String.raw`F_{\text{向上}} = 0 \Rightarrow`);
  assert.equal(segments.at(-1).value, ' 不受浮力。');
});

test('跨学科常见公式均可进入统一公式管线', () => {
  const cases = [
    String.raw`数学：\(P(A\mid B)=\frac{P(A\cap B)}{P(B)}\)`,
    String.raw`物理：\(E_k=\frac{1}{2}mv^2\)`,
    String.raw`化学：\(\ce{2H2 + O2 -> 2H2O}\)`,
    String.raw`生物：\(Aa \times Aa \Rightarrow 3:1\)`,
    String.raw`地理：\(120^\circ\mathrm{E},30^\circ\mathrm{N}\)`
  ];

  for (const value of cases) {
    const formula = splitScientificText(value).find((segment) => segment.type === 'math');
    assert.ok(formula, value);
    assert.doesNotThrow(() => katex.renderToString(formula.value, { throwOnError: true, strict: 'ignore' }), value);
  }
});

test('普通文本不会被误判为公式', () => {
  const segments = splitScientificText('DNA 是遗传信息的载体，第1课时重点观察实验现象。');
  assert.deepEqual(segments, [{ type: 'text', value: 'DNA 是遗传信息的载体，第1课时重点观察实验现象。' }]);
});

test('标准化会补足缺失花括号', () => {
  assert.equal(normalizeLatexMath(String.raw`F_{\向上`), String.raw`F_{\text{向上}}`);
});

test('未闭合公式同一行后的普通中文仍作为正文', () => {
  const segments = splitScientificText(String.raw`\(x=1，因此方程有唯一解。`);

  assert.equal(segments[0].type, 'math');
  assert.equal(segments[0].value, 'x=1');
  assert.equal(segments[1].value, '，因此方程有唯一解。');
});

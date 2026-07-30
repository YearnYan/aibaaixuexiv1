const test = require('node:test');
const assert = require('node:assert/strict');

const {
  auditAcademicText,
  normalizeLatex,
  sanitizeAcademicText,
  splitFormulaSegments,
  validateLatex,
} = require('../academic-content');

test('五个核心学科的标准 LaTeX 与 mhchem 均可通过审计', () => {
  const samples = [
    ['数学', '二次方程的根为 \\(x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}\\)。'],
    ['物理', '根据 \\(F=ma\\)，质量为 \\(2\\,\\mathrm{kg}\\) 的物体受力后加速度为 \\(3\\,\\mathrm{m/s^2}\\)。'],
    ['化学', '反应方程式为 \\(\\ce{2H2 + O2 -> 2H2O}\\)，并遵守质量守恒。'],
    ['生物', '杂合子自交可写为 \\(Aa\\times Aa\\)，理论分离比为 \\(3:1\\)。'],
    ['地理', '该图比例尺为 \\(1:50000\\)，位置是 \\(30^\\circ\\mathrm{N}\\)。'],
  ];
  for (const [subject, text] of samples) {
    const result = auditAcademicText(text, subject);
    assert.deepEqual(result.issues, [], `${subject}: ${result.issues.join('；')}`);
    assert.match(result.text, /\\\(|\\\[/u);
  }
});

test('美元定界符会被规范为标准行内或块级 LaTeX', () => {
  const normalized = sanitizeAcademicText('行内 $x^2+y^2=r^2$，独立 $$E=mc^2$$。');
  assert.equal(normalized, '行内 \\(x^2+y^2=r^2\\)，独立 \\[E=mc^2\\]。');
  assert.equal(splitFormulaSegments(normalized).filter((item) => item.type === 'formula').length, 2);
  assert.deepEqual(validateLatex('\\frac{1}{2}'), { valid: true, error: '' });
});

test('公式外伪符号、裸化学式和乱码会被拒绝', () => {
  const invalidSamples = [
    ['数学', '函数 y=x^2，且 sqrt(9)=3。'],
    ['物理', '物体质量为 5 kg，速度为 3 m/s。'],
    ['化学', '反应物是 H2O 和 CO2，离子为 Fe3+。'],
    ['生物', 'Aa × Aa 的遗传比例为 3:1。'],
    ['地理', '位置为 30°N，比例尺为 1:50000。'],
    ['数学', '结果包含 � 无法识别的符号。'],
    ['数学', '函数写成 f(x)，下标写成 a_1，命令裸露为 \\sqrt{x}。'],
  ];
  for (const [subject, text] of invalidSamples) {
    const result = auditAcademicText(text, subject);
    assert.ok(result.issues.length > 0, `${subject} 未拦截：${text}`);
  }
});

test('不支持的 LaTeX 公式不会静默降级为伪文本', () => {
  const result = auditAcademicText('表达式为 \\(\\frac{1}{\\badcommand{x}}\\)。', '数学');
  assert.ok(result.issues.some((issue) => issue.includes('LaTeX 无法解析')));
  assert.equal(normalizeLatex('α≤β'), '\\alpha \\le \\beta');
  assert.equal(normalizeLatex('a*b'), 'a\\times b');
  assert.equal(normalizeLatex('sqrt(x)>=2'), '\\sqrt{x}\\ge 2');
});

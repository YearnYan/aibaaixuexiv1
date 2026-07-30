const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const katex = require('katex');
require('katex/contrib/mhchem');
const {
  UNIFORM_FIGURE_WIDTH_PX,
  UNIFORM_FIGURE_HEIGHT_PX,
  assertWordDocxParts,
  assertWordFormulaOmmlSourceFree,
  assertWordVisibleTextSourceFree,
  normalizeWordFormulaOmml,
  normalizeWordFormulaOmmlText
} = require('../shared/word-export-quality');

function documentXml(content = '') {
  return `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${content}<w:sectPr/></w:body></w:document>`;
}

function nativeFormula(text) {
  return `<m:oMath><m:r><m:t xml:space="preserve">${text}</m:t></m:r></m:oMath>`;
}

test('Word 导出质量门接受九学科正常文字、等量原生公式与题图', () => {
  const subjectTexts = [
    '数学：函数与集合',
    '物理：力、速度与电场',
    '化学：水、离子与反应条件',
    '生物：DNA、ATP 与遗传信息',
    '地理：经纬度、气压与等高线',
    '历史：公元 1840 年与增长率',
    '语文：三角形可作为规范几何名称',
    '英语：The value is correct.',
    '政治：价格、价值量与变化率'
  ];
  const content = subjectTexts.map((text, index) => `<w:p><w:r><w:t>${text}</w:t></w:r>${nativeFormula(index + 1)}</w:p>`).join('')
    + '<w:p><w:r><w:drawing><a:blip r:embed="rIdFigure1"/></w:drawing></w:r></w:p>';
  assert.deepEqual(
    assertWordDocxParts(documentXml(content), ['word/media/figure-1.png'], {
      expectedFormulaCount: 9,
      expectedFigureCount: 1
    }),
    { formulaCount: 9, figureCount: 1 }
  );
});

test('Word 导出质量门全量拒绝 MathML、KaTeX、公式源码和裸上下标', () => {
  const adversarialResidues = [
    '<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>',
    '<annotation encoding="application/x-tex">\\sqrt{3}</annotation>',
    '<span class="katex"><span>公式</span></span>',
    '<svg viewBox="0 0 10 10"><path d="M0 0L1 1"/></svg>',
    '数学：\\frac{1}{2}',
    '物理：\\vec{F}',
    '化学：\\ce{H2O}',
    '生物：\\mathrm{DNA}',
    '地理：30^\\circ',
    '语文：\\triangle OAE',
    '英语：x_i',
    '政治：y=ax^2+bx+c',
    'LATEXSLASHsqrt{3}',
    '[[LATEX]]x[[/LATEX]]'
  ];

  for (const residue of adversarialResidues) {
    assert.throws(
      () => assertWordDocxParts(documentXml(`<w:p><w:r><w:t>${residue}</w:t></w:r></w:p>`), [], {
        expectedFormulaCount: 0,
        expectedFigureCount: 0
      }),
      /已停止导出/,
      residue
    );
  }
});

test('Word 质量门只审查可见文本，不把 OOXML 属性误判为用户可见公式源码', () => {
  const content = '<w:p data-internal-path="C:\\formula\\source"><w:r><w:t>正常教学文本</w:t></w:r></w:p>';
  assert.deepEqual(
    assertWordDocxParts(documentXml(content), [], {
      expectedFormulaCount: 0,
      expectedFigureCount: 0
    }),
    { formulaCount: 0, figureCount: 0 }
  );
});

test('Word 质量门仍拒绝正文和原生公式文本节点中的真实源码残留', () => {
  for (const content of [
    '<w:p><w:r><w:t>计算 \\frac{1}{2}</w:t></w:r></w:p>',
    nativeFormula('\\sqrt{x}')
  ]) {
    assert.throws(
      () => assertWordDocxParts(documentXml(content), [], {
        expectedFormulaCount: content.includes('<m:oMath') ? 1 : 0,
        expectedFigureCount: 0
      }),
      /仍含LaTeX 公式源码/
    );
  }
});

test('Word DOM 预检与最终 OOXML 质量门使用同一套可见文本规则', () => {
  assert.equal(assertWordVisibleTextSourceFree('数学：函数与集合', '第 1 题题干'), '数学：函数与集合');
  assert.throws(
    () => assertWordVisibleTextSourceFree(String.raw`\[`, '第 3 题答案解析第 2 步'),
    /第 3 题答案解析第 2 步仍含LaTeX 公式源码：\\\[/
  );
});

test('Word OMML 序列化转义不等号等 XML 保留字符且质量门拒绝未转义结果', () => {
  const invalid = '<m:oMath><m:r><m:t>−2<a<−1 & x</m:t></m:r></m:oMath>';
  assert.throws(() => assertWordFormulaOmmlSourceFree(invalid), /未转义的 XML 保留字符/);
  const normalized = normalizeWordFormulaOmmlText(invalid);
  assert.match(normalized, /−2&lt;a&lt;−1 &amp; x/);
  assert.doesNotThrow(() => assertWordFormulaOmmlSourceFree(normalized));
});

test('Word OMML 把分段公式普通花括号与矩阵规范化为可拉伸原生定界符', () => {
  const matrix = '<m:m><m:mr><m:e><m:r><m:t>x≥0</m:t></m:r></m:e></m:mr></m:m>';
  const invalid = `<m:oMath><m:r><m:t>{</m:t></m:r>${matrix}</m:oMath>`;
  assert.throws(() => assertWordFormulaOmmlSourceFree(invalid), /未规范化的分段公式括号/);
  const normalized = normalizeWordFormulaOmml(invalid);
  assert.match(normalized, /<m:d><m:dPr><m:begChr m:val="\{"\/><m:endChr m:val=""\/><m:grow m:val="1"\/><\/m:dPr>/);
  assert.match(normalized, new RegExp(`<m:e>${matrix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</m:e>`));
  assert.doesNotThrow(() => assertWordFormulaOmmlSourceFree(normalized));
});

test('Word 导出质量门拒绝原生公式、题图和媒体目录数量不一致', () => {
  assert.throws(
    () => assertWordDocxParts(documentXml(nativeFormula('x')), [], {
      expectedFormulaCount: 2,
      expectedFigureCount: 0
    }),
    /可编辑公式数量不一致/
  );
  assert.throws(
    () => assertWordDocxParts(documentXml('<a:blip r:embed="rIdFigure1"/>'), ['word/media/formula-1.png'], {
      expectedFormulaCount: 0,
      expectedFigureCount: 1
    }),
    /公式图片或未知媒体文件/
  );
});

test('九学科代表性 KaTeX MathML 均可转换为无源码的 OMML', async () => {
  const { mml2omml } = await import('mathml2omml');
  const formulas = [
    '\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}',
    '\\vec{F}=m\\vec{a}',
    '\\ce{2H2 + O2 -> 2H2O}',
    'P(A)=\\frac{m}{n}',
    '30^{\\circ}\\mathrm{N}',
    '\\frac{\\Delta P}{P_0}\\times 100\\%',
    '\\triangle ABC',
    'x_i=x_{i-1}+1',
    'Q_d=a-bP'
  ];

  for (const formula of formulas) {
    const rendered = katex.renderToString(formula, { throwOnError: true, output: 'mathml' });
    const mathml = rendered.match(/<math\b[\s\S]*<\/math>/)?.[0]
      .replace(/<annotation\b[\s\S]*?<\/annotation>/g, '');
    assert.ok(mathml, formula);
    const omml = mml2omml(mathml);
    assert.match(omml, /^<m:oMath\b[\s\S]*<\/m:oMath>$/);
    assert.doesNotMatch(omml, /<math\b|<annotation\b|application\/x-tex|\\[A-Za-z]+/i);
  }
});

test('Word 源码输出标准 docx、OMML 公式并只把题图转成 PNG', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const builder = fs.readFileSync(path.join(root, 'src/word-docx-export.js'), 'utf8');
  assert.equal(UNIFORM_FIGURE_WIDTH_PX, 280);
  assert.equal(UNIFORM_FIGURE_HEIGHT_PX, 210);
  assert.match(main, /buildEditableWordDocx/);
  assert.match(main, /assertWordDocxParts\(wordPackage\.documentXml/);
  assert.match(main, /link\.download = `\$\{safeFileName\}\.docx`/);
  assert.doesNotMatch(main, /application\/msword|renderWordFormulaPng|renderWordFormulaImages/);
  assert.match(builder, /mml2omml\(mathml\)/);
  assert.match(builder, /querySelector\('\.katex-mathml math'\)/);
  assert.match(builder, /assertWordFormulaOmmlSourceFree\(omml\)/);
  assert.match(main, /assertWordSemanticDomReady\(/);
  assert.match(builder, /assertWordVisibleTextSourceFree\(node\.nodeValue, label\)/);
  assert.match(builder, /normalizeWordFormulaOmml/);
  assert.match(builder, /Word 公式语义遍历不完整/);
  assert.match(builder, /optionElements\.forEach/);
  assert.doesNotMatch(builder, /<w:tab\/>|options\.tabs/);
  assert.match(main, /expectedFormulaCount: wordPackage\.formulaCount/);
  assert.match(builder, /word\/media\/\$\{fileName\}/);
  assert.doesNotMatch(builder, /formula-\$\{|data-word-formula/);
});

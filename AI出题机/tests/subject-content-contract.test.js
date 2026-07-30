const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ContentContractError,
  SUPPORTED_SUBJECTS,
  scanText,
  validateExamContent
} = require('../shared/subject-content-contract');

function makeExam(stem, answer, explanation) {
  return {
    title: '学科质量测试卷',
    questions: [{
      type: 'calculation',
      title: '一、解答题',
      items: [{ index: 1, stem, answer, explanation, figure: null }]
    }],
    answers: [`1. ${answer} 解析：${explanation}`]
  };
}

const validSubjectCases = {
  数学: makeExam(
    '已知函数 \\(f(x)=x^2-1\\)，求 \\(f(2)\\)。',
    '\\(3\\)',
    '代入可得 \\(f(2)=2^2-1=3\\)。'
  ),
  物理: makeExam(
    '物体以 \\(v=10\\,\\mathrm{m/s}\\) 匀速运动 \\(t=2\\,\\mathrm{s}\\)，求路程。',
    '\\(20\\,\\mathrm{m}\\)',
    '由 \\(s=vt\\)，得 \\(s=10\\times2=20\\,\\mathrm{m}\\)。'
  ),
  化学: makeExam(
    '写出氢气在氧气中燃烧的化学方程式。',
    '\\(\\ce{2H2 + O2 -> 2H2O}\\)',
    '原子守恒且方程式已配平：\\(\\ce{2H2 + O2 -> 2H2O}\\)。'
  ),
  生物: makeExam(
    '杂合子自交 \\(Aa\\times Aa\\)，求显性表型概率。',
    '\\(\\frac{3}{4}\\)',
    '子代基因型比例为 \\(1:2:1\\)，显性表型概率为 \\(\\frac{3}{4}\\)。'
  ),
  地理: makeExam(
    '某地经度为 \\(120^\\circ\\mathrm{E}\\)，求与本初子午线的经度差。',
    '\\(120^\\circ\\)',
    '本初子午线经度为 \\(0^\\circ\\)，故经度差为 \\(120^\\circ\\)。'
  ),
  历史: makeExam(
    '概括辛亥革命推动中国社会转型的主要表现。',
    '推翻君主专制制度，传播民主共和观念。',
    '答案应围绕政治制度变化与思想传播两个层面展开。'
  ),
  语文: makeExam(
    '解释“学而时习之，不亦说乎”中“说”的含义。',
    '同“悦”，愉快。',
    '结合语境，“说”为通假字，同“悦”。'
  ),
  英语: makeExam(
    'The two books cost $5 and $10. Read the word “teacher” /ˈtiːtʃə/.',
    'They cost fifteen dollars in total.',
    'Add the two prices and keep the IPA and currency signs as ordinary text.'
  ),
  政治: makeExam(
    '说明依法治国与人民当家作主之间的关系。',
    '二者统一于中国特色社会主义民主政治实践。',
    '法治保障人民权利，人民主体地位为法治建设提供根本立场。'
  )
};

test('九大学科合法教学内容全部通过同一质量门', () => {
  assert.deepEqual(Object.keys(validSubjectCases), SUPPORTED_SUBJECTS);
  for (const [subject, exam] of Object.entries(validSubjectCases)) {
    assert.equal(validateExamContent(exam, { subject, expectedQuestionCount: 1 }), exam);
  }
});

test('复杂数学与化学表达式通过 KaTeX/mhchem 实际编译', () => {
  const exam = makeExam(
    '设 \\(A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\\)，且 \\(f(x)=\\begin{cases}x^2,&x\\ge0\\\\-x,&x<0\\end{cases}\\)。',
    '\\(\\det A=-2\\)',
    '由 \\(\\det A=1\\times4-2\\times3=-2\\)，结论成立。'
  );
  validateExamContent(exam, { subject: '数学', expectedQuestionCount: 1 });
});

test('词法质量门拒绝缺失、错序、嵌套和双重转义定界符', () => {
  const cases = [
    ['缺少结束符', '已知 \\(x+1'],
    ['孤立结束符', '已知 x+1\\)'],
    ['类型错序', '已知 \\(x+1\\]'],
    ['嵌套定界符', '已知 \\(x+\\[1\\]\\)'],
    ['双重转义', String.raw`已知 \\(x+1\\)`]
  ];
  for (const [label, value] of cases) {
    assert.ok(scanText(value, { subject: '数学', path: label }).errors.length > 0, label);
  }
});

test('拒绝裸 LaTeX、美元公式、Unicode 伪公式和裸化学式', () => {
  assert.ok(scanText('计算 \\frac{1}{2}', { subject: '数学' }).errors.some((item) => item.code === 'BARE_LATEX_COMMAND'));
  assert.ok(scanText('计算 $x+1$', { subject: '数学' }).errors.some((item) => item.code === 'DOLLAR_DELIMITER'));
  assert.ok(scanText('计算 x²+√x', { subject: '数学' }).errors.some((item) => item.code === 'UNICODE_FORMULA'));
  assert.ok(scanText('反应生成 H2O', { subject: '化学' }).errors.some((item) => item.code === 'BARE_CHEMICAL_FORMULA'));
});

test('九大学科对抗式语料全部拒绝裸公式与伪公式', () => {
  const invalidCases = {
    数学: '函数表达式为 x²+√x。',
    物理: '物体速度满足 v=10m/s。',
    化学: '反应为 H2 + O2 → H2O。',
    生物: '杂合子自交写作 Aa×Aa。',
    地理: '该地经度记作 120°E。',
    历史: '材料中的增长率=5%。',
    语文: '设阅读材料中的字数 x=200。',
    英语: 'Solve the condition x > 2 before answering.',
    政治: '材料中的恩格尔系数=30%。'
  };
  assert.deepEqual(Object.keys(invalidCases), SUPPORTED_SUBJECTS);
  for (const [subject, value] of Object.entries(invalidCases)) {
    assert.ok(scanText(value, { subject }).errors.length > 0, `${subject}: ${value}`);
  }
});

test('科学学科中的裸化学式统一拒绝，普通学科文本不误判', () => {
  for (const subject of ['物理', '化学', '生物', '地理']) {
    assert.ok(
      scanText('材料中含有 CO2 和 H2O。', { subject }).errors.some((item) => item.code === 'BARE_CHEMICAL_FORMULA'),
      subject
    );
  }
  assert.deepEqual(scanText('He is reading a book.', { subject: '英语' }).errors, []);
});

test('内部传输标记无论位于普通文本还是公式内部都不能泄漏', () => {
  for (const value of [
    '结果是 LATEXSLASHfrac{1}{2}。',
    '结果是 @@BS@@frac{1}{2}。',
    '结果是 [[LATEX]]x^2[[/LATEX]]。',
    '\\(LATEXSLASHfrac{1}{2}\\)',
    '\\(@@BS@@frac{1}{2}\\)',
    '\\([[LATEX]]x^2[[/LATEX]]\\)'
  ]) {
    assert.ok(
      scanText(value, { subject: '数学' }).errors.some((item) => item.code === 'INTERNAL_TRANSPORT_MARKER'),
      value
    );
  }
});

test('英语货币、IPA、中文标点和历史年代不会被误判', () => {
  const cases = [
    ['英语', 'It costs $5 and $10; read /ˈmʌni/.'],
    ['语文', '阅读“温故而知新”，回答（1）至（3）题。'],
    ['历史', '从1919年到1949年，中国社会发生深刻变化。'],
    ['政治', '2026年，材料一与材料二共同强调依法履职。']
  ];
  for (const [subject, value] of cases) {
    assert.deepEqual(scanText(value, { subject }).errors, [], `${subject}: ${value}`);
  }
});

test('定界符完整但 KaTeX 无法编译时整卷拒绝', () => {
  const exam = makeExam('计算 \\(\\frac{1}{\\)', '\\(1\\)', '原式无法成立。');
  assert.throws(
    () => validateExamContent(exam, { subject: '数学', expectedQuestionCount: 1 }),
    (error) => error instanceof ContentContractError
      && error.errors.some((item) => item.code === 'KATEX_COMPILE_FAILED')
  );
});

test('KaTeX 可显示但无法无源码转换为 Word 原生公式时整卷拒绝', () => {
  for (const command of ['\\href{x}{y}', '\\url{x}', '\\includegraphics{x}']) {
    const exam = makeExam(`计算 \\(${command}\\)。`, '\\(1\\)', '依据题意计算。');
    assert.throws(
      () => validateExamContent(exam, { subject: '数学', expectedQuestionCount: 1 }),
      (error) => error instanceof ContentContractError
        && error.errors.some((item) => item.code === 'WORD_OMML_CONVERSION_FAILED'),
      command
    );
  }
});

test('题干引用图形但 figure 缺失时拒绝整卷', () => {
  const exam = makeExam('如图所示，回答问题。', '答案', '依据题图判断。');
  assert.throws(
    () => validateExamContent(exam, { subject: '历史', expectedQuestionCount: 1 }),
    (error) => error.errors.some((item) => item.code === 'MISSING_FIGURE')
  );
});

test('图形描述允许精确绘图关系，但拒绝 LaTeX 源码和传输标记', () => {
  const valid = makeExam('如图所示，回答问题。', '答案', '依据题图判断。');
  valid.questions[0].items[0].figure = {
    type: 'function',
    description: '绘制函数 y=x^2 的图像，顶点为 O(0,0)，标明坐标轴正方向。'
  };
  assert.equal(validateExamContent(valid, { subject: '数学', expectedQuestionCount: 1 }), valid);

  for (const description of [
    '绘制 LATEXSLASHfrac{1}{2} 对应图像并标明关键点。',
    '绘制 \\frac{1}{2} 对应图像并标明关键点。',
    '绘制 $y=x^2$ 对应图像并标明关键点。'
  ]) {
    const invalid = makeExam('如图所示，回答问题。', '答案', '依据题图判断。');
    invalid.questions[0].items[0].figure = { type: 'function', description };
    assert.throws(
      () => validateExamContent(invalid, { subject: '数学', expectedQuestionCount: 1 }),
      (error) => error.errors.some((item) => (
        item.code === 'INVALID_FIGURE_DESCRIPTION_MARKUP' || item.code === 'DOLLAR_DELIMITER'
      )),
      description
    );
  }
});

const assert = require('node:assert/strict');
const AcademicMath = require('../academic-math.js');

const cases = [
    {
        subject: '数学',
        input: 'sqrt(3)/2',
        includes: ['\\frac{\\sqrt{3}}{2}']
    },
    {
        subject: '数学',
        input: '(x-3)^2 + y^2 = 3，且 sin(theta) = 1/(2*sqrt(2))',
        includes: ['(x - 3)^{2}', 'y^{2}', '\\sin\\left(\\theta\\right)', '\\frac{1}{(2\\sqrt{2})}']
    },
    {
        subject: '物理',
        input: 'v^2 = v0^2 + 2*a*s，g = 9.8 m/s^2',
        includes: ['v^{2}', 'v_{0}^{2}', '2 \\cdot a \\cdot s', '\\frac{\\mathrm{m}}{\\mathrm{s^{2}}}']
    },
    {
        subject: '化学',
        input: 'H2SO4 + 2NaOH -> Na2SO4 + 2H2O',
        includes: ['\\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}']
    },
    {
        subject: '化学',
        input: 'Fe3+ + 3OH- -> Fe(OH)3',
        includes: ['\\ce{Fe3+ + 3OH- -> Fe(OH)3}']
    },
    {
        subject: '生物',
        input: 'p^2 + 2*p*q + q^2 = 1',
        includes: ['p^{2}', '2 \\cdot p \\cdot q', 'q^{2}']
    },
    {
        subject: '地理',
        input: '太阳高度 h = 90° - |phi - delta|，纬度为 30°N',
        includes: ['h = 90^{\\circ}', '\\varphi', '\\delta', '30^{\\circ}\\mathrm{N}']
    }
];

for (const sample of cases) {
    const normalized = AcademicMath.normalizeText(sample.input, sample.subject);
    for (const expected of sample.includes) {
        assert.ok(
            normalized.includes(expected),
            `${sample.subject} 规范化缺少 ${expected}：${normalized}`
        );
    }
    assert.deepEqual(
        AcademicMath.findUnresolvedLegacy(normalized),
        [],
        `${sample.subject} 仍存在程序表达式：${normalized}`
    );
}

const explicitLatex = '速度 \\(v_0=10\\,\\mathrm{m\\,s^{-1}}\\) 保持不变';
assert.equal(AcademicMath.normalizeText(explicitLatex, '物理'), explicitLatex);

const rendered = AcademicMath.render('<img src=x onerror=alert(1)>，sqrt(4)', '数学');
assert.ok(rendered.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!rendered.includes('<img'));
assert.ok(rendered.includes('academic-math-source'));
assert.ok(rendered.includes('√(4)'));

assert.equal(AcademicMath.latexToReadable('\\ce{2H2 + O2 -> 2H2O}'), '2H₂ + O₂ → 2H₂O');
assert.equal(AcademicMath.latexToReadable('x^{2}+y_{0}'), 'x²+y₀');

const siUnits = AcademicMath.normalizeText('F = 12 N，p = 101 kPa，E = 30 J，P = 5 W，f = 50 Hz，v = 72 km/h', '物理');
for (const unit of ['\\mathrm{N}', '\\mathrm{kPa}', '\\mathrm{J}', '\\mathrm{W}', '\\mathrm{Hz}', '\\frac{\\mathrm{km}}{\\mathrm{h}}']) {
    assert.ok(siUnits.includes(unit), `物理单位未正体化：${unit}，实际为 ${siUnits}`);
}

const tokens = AcademicMath.splitExplicitMath('A \\(x^2\\) B \\[y=1\\] C');
assert.equal(tokens.filter((token) => token.type === 'math').length, 2);
assert.equal(tokens.find((token) => token.display)?.latex, 'y=1');

for (const invalid of ['Math.sqrt(3)', 'pow(x,2)', 'x**2', '\\frac{1}{2}', 'H2 + O2 -> H2O']) {
    assert.ok(AcademicMath.findUnresolvedLegacy(invalid).length > 0, `质量闸门未识别：${invalid}`);
}
assert.deepEqual(AcademicMath.findUnresolvedLegacy('single sine signal'), []);

const structuralCases = [
    ['\\(\\frac\\)', 'MISSING_COMMAND_ARGUMENT'],
    ['\\(\\frac{1}\\)', 'MISSING_COMMAND_ARGUMENT'],
    ['\\(\\sqrt{}\\)', 'MISSING_COMMAND_ARGUMENT'],
    ['\\(sqrt(2)\\)', 'PROGRAMMATIC_EXPRESSION_IN_MATH'],
    ['\\(A -> B\\)', 'PROGRAMMATIC_EXPRESSION_IN_MATH'],
    ['\\(x+1', 'UNCLOSED_MATH_DELIMITER'],
    ['\\(x+1\\]', 'UNBALANCED_MATH_DELIMITER'],
    ['\\(\\left(x+1\\)', 'UNBALANCED_LEFT_RIGHT']
];
for (const [invalid, expectedCode] of structuralCases) {
    const issues = AcademicMath.findFormulaIssues(invalid);
    assert.ok(
        issues.some((issue) => issue.code === expectedCode),
        `公式结构诊断未识别 ${expectedCode}：${invalid}，实际为 ${JSON.stringify(issues)}`
    );
}

for (const valid of [
    '\\(\\frac{1}{2}\\)',
    '\\(\\sqrt[3]{8}\\)',
    '\\(\\ce{2H2 + O2 -> 2H2O}\\)',
    '\\(\\left(x+1\\right)\\)'
]) {
    assert.deepEqual(AcademicMath.findFormulaIssues(valid), [], `合法公式被误判：${valid}`);
}

assert.equal(AcademicMath.normalizeText('$\\frac{1}{2}$', '数学'), '\\(\\frac{1}{2}\\)');
assert.equal(AcademicMath.normalizeText('$$E=mc^2$$', '物理'), '\\[E=mc^2\\]');
assert.equal(AcademicMath.normalizeText('价格为 $100，不是公式。', '综合'), '价格为 $100，不是公式。');

console.log(`跨学科公式测试通过：${cases.length} 组学科样本，外加安全、结构诊断与分词断言。`);

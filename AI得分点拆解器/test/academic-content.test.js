const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeAcademicText,
  tokenizeAcademicText,
  truncateAcademicText,
  validateAcademicText,
} = require("../src/academic-content");

test("跨学科标准 LaTeX 与化学式可以统一校验", () => {
  const samples = [
    "数学：\\(x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}\\)，并验证 \\(\\Delta=b^2-4ac\\)。",
    "物理：\\(E_k=\\frac{1}{2}mv^2\\)，单位为 \\(\\mathrm{J}=\\mathrm{kg\\cdot m^2\\cdot s^{-2}}\\)。",
    "化学：\\(\\ce{2H2 + O2 -> 2H2O}\\)，离子为 \\(\\ce{Cu^{2+}}\\)。",
    "生物：杂交组合为 \\(Aa\\times Aa\\)，性状分离比为 \\(3:1\\)。",
    "地理：正午太阳高度 \\(h=90^\\circ-\\lvert\\varphi-\\delta\\rvert\\)。",
  ];

  samples.forEach((sample) => assert.equal(validateAcademicText(sample), sample));
});

test("常见美元定界符会归一为统一公式格式", () => {
  assert.equal(normalizeAcademicText("行内 $F=ma$，独立 $$x^2+y^2=1$$"), "行内 \\(F=ma\\)，独立 \\[x^2+y^2=1\\]");
});

test("学科文本解析会区分普通文本、行内公式和独立公式", () => {
  assert.deepEqual(tokenizeAcademicText("速度 \\(v=\\frac{s}{t}\\)\n\\[F=ma\\]"), [
    { type: "text", value: "速度 " },
    { type: "math", value: "v=\\frac{s}{t}", display: false },
    { type: "text", value: "\n" },
    { type: "math", value: "F=ma", display: true },
  ]);
});

test("损坏字符、裸露命令和无效公式会被拒绝", () => {
  assert.throws(() => validateAcademicText("电势为 �"), /损坏字符/);
  assert.throws(() => validateAcademicText("速度为 \\frac{s}{t}"), /定界符内/);
  assert.throws(() => validateAcademicText("速度为 \\(\\frac{s}{\\)"), /无法解析/);
});

test("字段截断不会切开完整公式", () => {
  const source = `题干${"条件".repeat(20)} \\(n=\\frac{V}{V_m}\\) 后续说明`;
  const result = truncateAcademicText(source, 50);

  assert.ok(result.length <= 50);
  assert.doesNotThrow(() => validateAcademicText(result));
  assert.equal(result.includes("\\("), false);
});

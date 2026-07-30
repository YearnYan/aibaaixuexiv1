import assert from "node:assert/strict";
import test from "node:test";
import {
  auditFormulaContent,
  auditFormulaContentDetailed,
  splitFormulaSegments,
  validateLatex
} from "../src/formula.js";

const VALID_SUBJECT_CONTENT = {
  数学: String.raw`二次方程的求根公式是 $$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$$，其中 $a\ne 0$。`,
  物理: String.raw`牛顿第二定律可写为 $\vec{F}=m\vec{a}$，重力加速度约为 $9.8\,\mathrm{m\,s^{-2}}$。`,
  化学: String.raw`氢气燃烧的反应式为 $$\ce{2H2 + O2 -> 2H2O}$$，硫酸根离子写作 $\ce{SO4^2-}$。`,
  生物: String.raw`杂合子组合写作 $Aa\times Aa$，光合作用可写为 $$\ce{6CO2 + 6H2O -> C6H12O6 + 6O2}$$。`,
  地理: String.raw`该点纬度是 $30^\circ\mathrm{N}$，比例尺为 $1:50\,000$。`
};

test("五类学科的规范 LaTeX 与 mhchem 均能通过统一校验", () => {
  Object.entries(VALID_SUBJECT_CONTENT).forEach(([subject, content]) => {
    const formulas = splitFormulaSegments(content).filter((segment) => segment.type === "formula");
    assert.ok(formulas.length >= 2, `${subject} 应识别出至少两个公式`);
    formulas.forEach((formula) => assert.equal(validateLatex(formula.value, formula.display).valid, true));
    assert.deepEqual(auditFormulaContent({ subject, content }), []);
  });
});

test("公式允许在 text 命令中使用中文学科量名", () => {
  const latex = String.raw`\text{实际距离}=\frac{\text{图上距离}}{\text{比例尺}}`;
  assert.equal(validateLatex(latex, true).valid, true);
});

test("公式审计提供可安全应用的字段路径", () => {
  const issues = auditFormulaContentDetailed({
    meta: { subject: "英语" },
    keyPoints: [{ diagnostic: { prompt: "判断 f(x)=x^2 的形式。" } }],
    concepts: [{ term: "函数 f(x)=x^2" }]
  });
  assert.deepEqual(issues.map((issue) => issue.path), [
    "keyPoints[0].diagnostic.prompt",
    "concepts[0].term"
  ]);
  assert.ok(issues.every((issue) => Array.isArray(issue.pathParts) && issue.message.includes("函数表达")));
});

test("英语 since 等普通单词不会被误判为三角函数", () => {
  const issues = auditFormulaContent({
    meta: { subject: "英语" },
    keyPoints: [{ diagnostic: { prompt: "看到 since 或 for 时，先判断动作持续多久。" } }],
    concepts: [{ term: "since 引导的时间起点" }]
  });
  assert.deepEqual(issues, []);
});

test("公式审计覆盖裸符号、普通文本化学式、经纬度和乱码", () => {
  const issues = auditFormulaContent({
    math: "当 x² + √x ≤ 3 时求解。",
    chemistry: "反应物 H2O 生成 CO2。",
    geography: "位置为 30°N。",
    corrupt: "公式显示为 ���。"
  });
  assert.ok(issues.some((issue) => issue.includes("Unicode 运算符或上下标")));
  assert.ok(issues.some((issue) => issue.includes("H2O") && issue.includes("\\ce")));
  assert.ok(issues.some((issue) => issue.includes("角度或经纬度")));
  assert.ok(issues.some((issue) => issue.includes("乱码")));
});

test("公式审计按学科补查物理量、单元素、遗传组合、比例尺和百分数", () => {
  assert.ok(auditFormulaContent({ meta: { subject: "物理" }, content: "其中 F 表示合力。" }).some((issue) => issue.includes("物理量")));
  assert.ok(auditFormulaContent({ meta: { subject: "化学" }, content: "Fe 与酸反应，pH 为 3。" }).some((issue) => issue.includes("Fe")));
  assert.ok(auditFormulaContent({ meta: { subject: "生物" }, content: "Aa x Aa 的比例为 3:1。" }).some((issue) => issue.includes("遗传")));
  assert.ok(auditFormulaContent({ meta: { subject: "地理" }, content: "比例尺为 1:50000，城市化率为 60%。" }).some((issue) => issue.includes("比例尺")));
});

test("化学选择题的单字母选项不被误判为化学式，但真实元素语境仍严格校验", () => {
  const options = auditFormulaContent({
    meta: { subject: "化学" },
    practice: [{ options: ["A", "B", "C", "D"], answer: "B" }]
  });
  assert.deepEqual(options, []);

  const element = auditFormulaContent({
    meta: { subject: "化学" },
    content: "元素 B 与酸反应。"
  });
  assert.ok(element.some((issue) => issue.includes("B") && issue.includes("\\ce")));
});

test("全部支持学科的选择题标签、答案字母和选项引用均不误报", () => {
  ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "道德与法治"].forEach((subject) => {
    const issues = auditFormulaContent({
      meta: { subject },
      practice: [{
        question: "请选择正确选项。",
        options: ["A", "B", "C", "D"],
        answer: "答案为 B。",
        explanation: "选择 B，因为 B 项符合题目条件。"
      }]
    });
    assert.deepEqual(issues, [], `${subject} 不应把选择题标签当成学科符号`);
  });
});

test("选择题字段中的真实未规范公式仍按学科严格拦截", () => {
  const cases = [
    ["数学", "x² + √x ≤ 3"],
    ["物理", "F = ma，速度为 10 m/s"],
    ["化学", "Na 与 H2O 反应"],
    ["生物", "Aa x Aa 的比例为 3:1"],
    ["地理", "30°N，比例尺为 1:50000"]
  ];
  cases.forEach(([subject, option]) => {
    const issues = auditFormulaContent({
      meta: { subject },
      practice: [{ options: ["条件正确", option], answer: "B" }]
    });
    assert.ok(issues.length > 0, `${subject} 的真实未规范表达必须被拦截`);
  });
});

test("审计跳过资料编号和 ASCII 图，但仍检查其他全部教学字段", () => {
  const material = {
    sourceAtoms: [{ text: "H2O 与 x² 是原始资料，不改写" }],
    learningRoute: [{ evidenceFocus: "用户原文 y=x^2，回到 S1-2 核对", action: "完成 E1 后做 P1，再回到 K1 和 F1 检查" }],
    knowledgeDiagrams: [{ ascii: "条件 ──→ 结论\n  └── x²" }],
    workedExamples: [{ id: "E1", answer: String.raw`答案为 $x=2$。`, sourceRefs: ["S1-2"] }]
  };
  assert.deepEqual(auditFormulaContent(material), []);
});

test("教学图位稳定编号不会被化学式审计误判", () => {
  const material = {
    meta: { subject: "化学" },
    teachingFigures: [{
      description: "D1 画全景，D2 画判断路径，V1 画对照，V2 画过程；S1、C1、X1、M1 使用专属图位。"
    }]
  };
  assert.deepEqual(auditFormulaContent(material), []);
});

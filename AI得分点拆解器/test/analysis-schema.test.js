const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAndNormalizeReport } = require("../src/analysis-schema");
const { makeRawReport } = require("./fixtures");

test("报告分值会归一到请求总分且保持得失分不变量", () => {
  const raw = makeRawReport();
  raw.scorePoints.forEach((point) => { point.score *= 2; });
  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: true });

  assert.equal(report.scorePoints.length, 6);
  assert.equal(report.scorePoints.reduce((sum, point) => sum + point.score, 0), 12);
  assert.equal(report.earnedScore + report.missingScore, 12);
  assert.deepEqual(report.scorePoints.map((point) => point.id), ["01", "02", "03", "04", "05", "06"]);
});

test("未检测到学生作答时生成六维解题指导，不产生误导性得分", () => {
  const raw = makeRawReport({ hasStudentAnswer: false });
  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: false });

  assert.equal(report.earnedScore, 0);
  assert.equal(report.missingScore, 12);
  assert.equal(report.hasStudentWork, false);
  assert.equal(report.resultState, "guidance");
  assert.equal(report.contentFormat, "latex-v1");
  assert.equal(report.studentWorkSource, "none");
  assert.ok(report.scorePoints.every((point) => point.status === "pending"));
  assert.ok(report.scorePoints.every((point) => point.requirement && point.analysis && point.suggestion));
  assert.ok(report.scorePoints.every((point) => (
    [point.requirement, point.analysis, point.suggestion]
      .every((content) => content.includes("通用方法：") && content.includes("本题应用："))
  )));
  assert.match(report.revisionAdvice, /关键依据/);
});

test("题目文件内检测到作答时即使没有独立答案文件也会逐项评分", () => {
  const raw = makeRawReport({ hasStudentAnswer: true });
  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: false });

  assert.equal(report.hasStudentWork, true);
  assert.equal(report.hasStudentAnswer, true);
  assert.equal(report.studentWorkSource, "question_file");
  assert.equal(report.earnedScore, 8);
  assert.equal(report.resultState, "needs_improvement");
  assert.ok(report.scorePoints.some((point) => point.status !== "pending"));
  assert.ok(report.scorePoints.every((point) => point.analysis.includes("学生实际表达")));
});

test("独立答案文件是强事实，模型漏判时仍进入作答诊断", () => {
  const raw = makeRawReport({ hasStudentAnswer: false });
  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: true });

  assert.equal(report.hasStudentWork, true);
  assert.equal(report.studentWorkSource, "answer_file");
  assert.ok(report.scorePoints.every((point) => point.status !== "pending"));
});

test("零分辅助维度仍保留模型诊断状态", () => {
  const raw = makeRawReport({ hasStudentAnswer: true });
  raw.scorePoints[4].score = 0;
  raw.scorePoints[4].earnedScore = 0;
  raw.scorePoints[4].status = "missing";
  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: false });

  assert.equal(report.scorePoints[4].score, 0);
  assert.equal(report.scorePoints[4].status, "missing");
});

test("缺少类别时会补齐固定六类得分点", () => {
  const raw = makeRawReport();
  raw.scorePoints = raw.scorePoints.slice(0, 3);
  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: true });

  assert.equal(report.scorePoints.length, 6);
  assert.deepEqual(report.scorePoints.map((point) => point.label), [
    "答题对象",
    "核心结论",
    "关键依据",
    "推理步骤",
    "关键词",
    "格式要求",
  ]);
});

test("兼容模型缺少冗余字段并返回中文状态时仍可生成报告", () => {
  const raw = {
    report: {
      question_preview: "分析图中物理过程并说明关键依据。",
      requires_teacher_review: "true",
      score_points: [
        { name: "答题对象", max_score: "1分", status: "已覆盖" },
        { name: "核心结论", max_score: "2分", status: "未覆盖" },
        { name: "关键依据", max_score: "3分", status: "部分覆盖", 建议: "补充图像中的关键条件" },
        { name: "推理步骤", max_score: "3分", status: "已覆盖" },
        { name: "关键词", max_score: "2分", status: "待补充" },
        { name: "格式要求", max_score: "1分", status: "已符合" },
      ],
      修改建议: "补充关键条件并说明推理关系",
    },
  };

  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: true });

  assert.equal(report.scorePoints.length, 6);
  assert.equal(report.scorePoints.reduce((sum, point) => sum + point.score, 0), 12);
  assert.equal(report.earnedScore, 7.5);
  assert.equal(report.missingScore, 4.5);
  assert.equal(report.requiresTeacherReview, true);
  assert.match(report.reviewNote, /教师/);
});

test("兼容模型只返回得分点数组时使用安全缺省值", () => {
  const raw = {
    data: [
      { 类别: "答题对象", 分值: "1" },
      { 类别: "核心结论", 分值: "2" },
      { 类别: "关键依据", 分值: "3" },
      { 类别: "推理步骤", 分值: "3" },
      { 类别: "关键词", 分值: "2" },
      { 类别: "格式要求", 分值: "1" },
    ],
  };

  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: false });

  assert.equal(report.earnedScore, 0);
  assert.ok(report.scorePoints.every((point) => point.status === "pending"));
  assert.ok(report.scorePoints.every((point) => point.requirement && point.analysis && point.suggestion));
  assert.match(report.questionPreview, /题目资料已读取/);
  assert.match(report.revisionAdvice, /答题对象/);
});

test("兼容未知深层键名并优先选择具备评分语义的数组", () => {
  const raw = {
    sources: Array.from({ length: 6 }, (_, index) => ({ title: `来源${index + 1}`, url: "https://example.com" })),
    data: {
      payload: {
        modelOutput: {
          gradingDimensions: [
            { criterion: "答题对象", max_score: "1分", status: "已覆盖" },
            { criterion: "核心结论", max_score: "2分", status: "已覆盖" },
            { criterion: "关键依据", max_score: "3分", status: "部分覆盖" },
            { criterion: "推理步骤", max_score: "3分", status: "未覆盖" },
            { criterion: "关键词", max_score: "2分", status: "待补充" },
            { criterion: "格式要求", max_score: "1分", status: "已符合" },
          ],
        },
      },
    },
  };

  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: true });

  assert.equal(report.scorePoints.length, 6);
  assert.equal(report.scorePoints.reduce((sum, point) => sum + point.score, 0), 12);
  assert.equal(report.scorePoints[2].status, "partial");
  assert.equal(report.scorePoints[3].status, "missing");
});

test("不会把无关对象数组误判成得分点", () => {
  const raw = {
    data: {
      sources: Array.from({ length: 6 }, (_, index) => ({
        title: `参考资料${index + 1}`,
        url: `https://example.com/${index + 1}`,
      })),
    },
  };

  assert.throws(
    () => parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: false }),
    (error) => error.code === "AI_RESPONSE_INVALID",
  );
});

test("满分报告使用正向文案且空作答依据不会改变得分事实", () => {
  const raw = makeRawReport({ hasStudentAnswer: true });
  raw.scorePoints.forEach((point) => {
    point.earnedScore = point.score;
    point.status = point.category === "format" ? "compliant" : "covered";
    point.evidence = "";
    point.analysis = "当前作答中未识别到有效表达，需要补充。";
    point.suggestion = "补充缺失内容并修改答案。";
  });
  raw.revisionAdvice = "补充遗漏的得分点并修改答案";
  raw.reviewNote = "尚未覆盖全部要求，需要完善";

  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: true });
  const fullScoreCopy = [
    report.revisionAdvice,
    report.reviewNote,
    ...report.scorePoints.flatMap((point) => [point.analysis, point.suggestion]),
  ].join(" ");

  assert.equal(report.resultState, "full_score");
  assert.equal(report.earnedScore, 12);
  assert.equal(report.missingScore, 0);
  assert.ok(report.scorePoints.every((point) => ["covered", "compliant"].includes(point.status)));
  assert.ok(report.scorePoints.every((point) => point.evidence === ""));
  assert.doesNotMatch(fullScoreCopy, /未识别|未覆盖|缺失|补充|尚未|遗漏|需要完善|修改/);
  assert.match(report.revisionAdvice, /均达到要求/);
});

test("长题干在公式中间截断时会回退到完整公式之前", () => {
  const raw = makeRawReport({ hasStudentAnswer: false });
  raw.questionPreview = `${"题干条件".repeat(21)} \\(n=\\frac{V}{V_m}\\) 计算电子转移量`;
  raw.scorePoints.forEach((point) => {
    point.requirement = "";
    point.analysis = "";
    point.suggestion = "";
  });

  const report = parseAndNormalizeReport(raw, { totalScore: 12, hasStudentAnswer: false });

  assert.equal(report.resultState, "guidance");
  assert.ok(report.scorePoints.every((point) => point.analysis.includes("本题应用：")));
  assert.doesNotThrow(() => report.scorePoints.forEach((point) => (
    assert.doesNotMatch(point.analysis, /\\\([^)]*…/)
  )));
});

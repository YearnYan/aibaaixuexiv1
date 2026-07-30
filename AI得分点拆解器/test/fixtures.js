function makeRawReport({ totalScore = 12, hasStudentAnswer = true } = {}) {
  const scores = [1, 2, 3, 3, 2, 1];
  const earned = hasStudentAnswer ? [1, 2, 0, 3, 1, 1] : [0, 0, 0, 0, 0, 0];
  const categories = [
    "answer_target",
    "core_conclusion",
    "key_evidence",
    "reasoning_steps",
    "keywords",
    "format",
  ];

  return {
    questionPreview: "阅读材料并结合内容分析人物产生感激之情的原因。",
    totalScore,
    earnedScore: earned.reduce((sum, value) => sum + value, 0),
    missingScore: totalScore - earned.reduce((sum, value) => sum + value, 0),
    hasStudentWork: hasStudentAnswer,
    hasStudentAnswer,
    requiresTeacherReview: true,
    scorePoints: categories.map((category, index) => ({
      id: String(index + 1),
      category,
      label: `得分点${index + 1}`,
      score: scores[index],
      status: hasStudentAnswer
        ? (earned[index] === scores[index] ? "covered" : earned[index] === 0 ? "missing" : "partial")
        : "pending",
      earnedScore: earned[index],
      evidence: hasStudentAnswer ? "学生答案中的对应表达" : "",
      requirement: "明确本维度在当前题目中的评分观察点",
      analysis: hasStudentAnswer
        ? "结合学生实际表达判断本维度的覆盖程度"
        : "结合当前题目说明本维度的解题思路",
      suggestion: "补充对应依据并说明推理关系",
    })),
    revisionAdvice: "补充关键依据，并写清推理过程",
    reviewNote: "开放性表达需教师确认合理同义答案",
  };
}

module.exports = { makeRawReport };

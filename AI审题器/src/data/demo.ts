import type { Analysis, AnalysisMeta } from "../types";

export const demoAnalysis: Analysis = {
  questionText:
    "某班共有学生 48 人，\n其中至少会打篮球的有 28 人，至少会打乒乓球的有 24 人，\n两项都会的有 12 人。问两项都不会的有多少人？",
  problemType: "集合问题",
  confidence: 0.97,
  potentialOmissions: ["“至少”表示数量下限"],
  taskWords: [{ label: "问", text: "两项都不会的有多少人？" }],
  restrictions: ["至少会打篮球的有 28 人", "至少会打乒乓球的有 24 人", "两项都会的有 12 人"],
  keyData: [
    { label: "总人数", value: "48 人" },
    { label: "篮球", value: "28 人" },
    { label: "乒乓球", value: "24 人" },
    { label: "两项都会", value: "12 人" },
  ],
  hiddenConditions: ["“至少”表示包含两项都会的人", "集合为同一总体（该班学生）", "数据为非负整数"],
  distractions: [],
  answerScope: "两项都不会的学生人数",
  paraphrase: "已知全班人数和会两项运动的人数关系，只需明确两项都不会的学生人数。",
  highlights: [
    { text: "共有", category: "hidden" },
    { text: "48 人", category: "data" },
    { text: "至少", category: "restriction" },
    { text: "打篮球", category: "task" },
    { text: "28 人", category: "data" },
    { text: "打乒乓球", category: "task" },
    { text: "24 人", category: "data" },
    { text: "两项都会", category: "scope" },
    { text: "12 人", category: "data" },
    { text: "两项都不会", category: "hidden" },
  ],
};

export const demoMeta: AnalysisMeta = {
  subject: "数学",
  grade: "初中二年级",
  source: "用户上传",
  recognizedAt: "2025-05-24 10:30:25",
  fileNames: ["示例题目"],
};

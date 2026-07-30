import { describe, expect, it } from "vitest";
import { parseModelResponse } from "../server/ai";

const validPayload = {
  questionText: "某班共有 48 人，问两项都不会的有多少人？",
  problemType: "集合问题",
  confidence: 0.97,
  potentialOmissions: ["不要漏看总体人数"],
  taskWords: [{ label: "问", text: "两项都不会的有多少人" }],
  restrictions: ["总体为该班学生"],
  keyData: [{ label: "总人数", value: "48 人" }],
  hiddenConditions: ["人数为非负整数"],
  distractions: [],
  answerScope: "两项都不会的学生人数",
  paraphrase: "根据全班人数与参与关系，明确题目要求的学生人数。",
  highlights: [{ text: "48 人", category: "data" }],
};

describe("模型审题结果解析", () => {
  it("可解析带 Markdown 代码围栏的 JSON", () => {
    const result = parseModelResponse(`\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\``);
    expect(result.problemType).toBe("集合问题");
    expect(result.highlights).toEqual([{ text: "48 人", category: "data" }]);
  });

  it("可把百分制置信度归一化为 0 至 1", () => {
    const result = parseModelResponse(JSON.stringify({ ...validPayload, confidence: 97 }));
    expect(result.confidence).toBe(0.97);
  });

  it("保守修复 JSON 字符串中的单反斜杠 LaTeX", () => {
    const raw = JSON.stringify({
      ...validPayload,
      questionText: "计算公式占位",
    }).replace("计算公式占位", String.raw`计算 \(x=\frac{1}{2}\)`);
    const result = parseModelResponse(raw);
    expect(result.questionText).toBe(String.raw`计算 \(x=\frac{1}{2}\)`);
  });

  it("拒绝缺少核心字段的半结构化结果", () => {
    expect(() => parseModelResponse('{"questionText":"只有题目"}')).toThrow(
      "AI 返回的审题结果结构不完整",
    );
  });

  it("拒绝完全没有 JSON 的返回内容", () => {
    expect(() => parseModelResponse("抱歉，我无法分析")).toThrow("AI 未返回可识别的 JSON 结果");
  });
});

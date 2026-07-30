import type { RecognitionResult } from "../types";

/**
 * 计算识别结果实际覆盖到的原始页面。
 * 题目可能跨页，必须同时检查起始页、来源页和图形页。
 */
export function collectCoveredRecognitionPageIndexes(result: Pick<RecognitionResult, "questions">) {
  const covered = new Set<number>();
  for (const question of result.questions) {
    covered.add(question.pageIndex);
    for (const pageIndex of question.sourcePageIndexes) covered.add(pageIndex);
    for (const figure of question.figures) covered.add(figure.pageIndex);
  }
  return covered;
}

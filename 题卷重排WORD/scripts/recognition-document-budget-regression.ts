import assert from "node:assert/strict";
import {
  normalizeRecognitionResultPayload,
} from "../src/lib/api";

const validPayload = {
  questions: [{
    id: "q-1",
    number: "1",
    pageIndex: 0,
    sourcePageIndexes: [0],
    stemMarkdown: "计算 \\(1+1\\)",
    options: [],
    figures: [],
  }],
  processedPageIndexes: [0],
  emptyPageIndexes: [],
  warnings: [],
};
assert.equal(normalizeRecognitionResultPayload(validPayload).questions.length, 1);

const generalContentPayload = {
  questions: [{
    ...validPayload.questions[0],
    id: "content-1",
    kind: "content",
    number: "",
    stemMarkdown: "普通资料正文",
  }],
  processedPageIndexes: [0],
  emptyPageIndexes: [],
  warnings: [],
};
assert.deepEqual(
  normalizeRecognitionResultPayload(generalContentPayload).questions[0],
  { ...generalContentPayload.questions[0], options: [], figures: [] },
  "普通资料内容必须允许空题号并完整保留类型",
);

for (const invalidPayload of [
  { questions: [{ ...validPayload.questions[0], stemMarkdown: "" }], warnings: [] },
  {
    questions: [{
      ...validPayload.questions[0],
      figures: [{
        pageIndex: 0,
        kind: "diagram",
        bbox: { x: 0.9, y: 0.1, width: 0.2, height: 0.2 },
      }],
    }],
    warnings: [],
  },
  {
    questions: [{
      ...validPayload.questions[0],
      figures: [{
        pageIndex: 1,
        kind: "diagram",
        bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      }],
    }],
    warnings: [],
  },
  { questions: [{ ...validPayload.questions[0], sourcePageIndexes: undefined }], warnings: [] },
  { questions: validPayload.questions },
]) {
  assert.throws(
    () => normalizeRecognitionResultPayload(invalidPayload),
    (error: unknown) => (
      error instanceof Error
      && (error as Error & { code?: string }).code === "invalid_ai_response"
    ),
    "客户端不得把残缺的 HTTP 200 识别载荷归一化为成功结果",
  );
}

const twoPageQuestion = {
  ...validPayload.questions[0],
  sourcePageIndexes: [0],
};
for (const invalidCoveragePayload of [
  {
    questions: [twoPageQuestion],
    processedPageIndexes: [0, 1],
    emptyPageIndexes: [],
    warnings: [],
  },
  {
    questions: [],
    processedPageIndexes: [0, 1],
    emptyPageIndexes: [],
    warnings: [],
  },
  {
    questions: [twoPageQuestion],
    processedPageIndexes: [0],
    emptyPageIndexes: [],
    warnings: [],
  },
  {
    questions: [twoPageQuestion],
    processedPageIndexes: [0, 0],
    emptyPageIndexes: [1],
    warnings: [],
  },
  {
    questions: [twoPageQuestion],
    processedPageIndexes: [0, 1],
    emptyPageIndexes: [1, 1],
    warnings: [],
  },
  {
    questions: [twoPageQuestion],
    processedPageIndexes: [0, 1],
    emptyPageIndexes: [2],
    warnings: [],
  },
]) {
  assert.throws(
    () => normalizeRecognitionResultPayload(invalidCoveragePayload, new Set([0, 1])),
    (error: unknown) => (
      error instanceof Error
      && (error as Error & { code?: string }).code === "invalid_ai_response"
    ),
    "客户端必须拒绝 HTTP 200 中缺页、空结果未声明空页、重复页或越界页",
  );
}

assert.deepEqual(
  normalizeRecognitionResultPayload({
    questions: [],
    processedPageIndexes: [0, 1],
    emptyPageIndexes: [0, 1],
    warnings: [],
  }, new Set([0, 1])).emptyPageIndexes,
  [0, 1],
  "只有全部上传页均被明确声明为空时，空题结果才允许通过",
);

assert.throws(
  () => normalizeRecognitionResultPayload({
    questions: [{ ...validPayload.questions[0], pageIndex: 9, sourcePageIndexes: [9] }],
    processedPageIndexes: [9],
    emptyPageIndexes: [],
    warnings: [],
  }, new Set([0])),
  (error: unknown) => (
    error instanceof Error
    && (error as Error & { code?: string }).code === "invalid_ai_response"
  ),
  "客户端不得接受引用本次上传集合之外页面的 HTTP 200 载荷",
);

const sixtyOneEmptyPages = Array.from({ length: 61 }, (_, pageIndex) => pageIndex);
assert.deepEqual(
  normalizeRecognitionResultPayload({
    questions: [],
    processedPageIndexes: sixtyOneEmptyPages,
    emptyPageIndexes: sixtyOneEmptyPages,
    warnings: [],
  }, new Set(sixtyOneEmptyPages)).processedPageIndexes,
  sixtyOneEmptyPages,
  "客户端必须接受超过旧 50 页上限且覆盖证据完整的结果",
);

console.log("大文件无固定页数上限与客户端严格载荷回归测试通过");

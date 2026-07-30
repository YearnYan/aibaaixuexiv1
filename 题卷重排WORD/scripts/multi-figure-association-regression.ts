import assert from "node:assert/strict";
import { normalizeRecognitionResultPayload } from "../src/lib/api";

const payload = {
  questions: [{
    id: "q-1",
    number: "1",
    pageIndex: 0,
    sourcePageIndexes: [0, 1],
    stemMarkdown: "如图1和图2，比较两个装置。",
    options: [],
    // 故意打乱模型返回顺序，客户端必须按页、纵坐标、横坐标稳定重排。
    figures: [
      { pageIndex: 1, kind: "diagram", bbox: { x: 0.7, y: 0.1, width: 0.2, height: 0.2 } },
      { pageIndex: 0, kind: "diagram", bbox: { x: 0.6, y: 0.4, width: 0.2, height: 0.2 } },
      { pageIndex: 0, kind: "diagram", bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 } },
    ],
  }],
  processedPageIndexes: [0, 1],
  emptyPageIndexes: [],
  warnings: [],
};

const result = normalizeRecognitionResultPayload(payload, new Set([0, 1]));
assert.equal(result.questions[0].figures.length, 3, "一题多图不得被合并或丢弃");
assert.deepEqual(
  result.questions[0].figures.map((figure) => [figure.pageIndex, figure.bbox.y, figure.bbox.x]),
  [[0, 0.2, 0.1], [0, 0.4, 0.6], [1, 0.1, 0.7]],
);
assert.deepEqual(result.questions[0].sourcePageIndexes, [0, 1], "跨页多图必须保留完整来源页集合");

console.log("WORD 一题多图、跨页图和稳定空间排序回归通过");

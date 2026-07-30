import assert from "node:assert/strict";
import { collectCoveredRecognitionPageIndexes } from "../src/lib/recognitionCoverage";
import type { RecognitionResult } from "../src/types";

const result: Pick<RecognitionResult, "questions"> = {
  questions: [{
    id: "q-1",
    kind: "question",
    number: "1",
    pageIndex: 0,
    sourcePageIndexes: [0, 1],
    stemMarkdown: "跨页题目",
    options: [],
    figures: [{
      pageIndex: 1,
      kind: "diagram",
      bbox: { x: 0, y: 0, width: 1, height: 1 },
    }],
  }],
};

assert.deepEqual([...collectCoveredRecognitionPageIndexes(result)].sort((a, b) => a - b), [0, 1]);

console.log("识别结果跨页覆盖回归测试通过");

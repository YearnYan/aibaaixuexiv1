import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  beginRecognitionResultDelivery,
  completeRecognitionResultDelivery,
  createRecognitionSession,
  recognitionSessionSnapshot,
  releaseRecognitionResultDelivery,
  startRecognitionSession,
  subscribeRecognitionSession,
  writeRecognitionPage,
} from "../server/recognitionSessions.js";
import type { RecognitionPage } from "../server/aiProxy.js";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";
const sessionId = `test-${randomUUID()}`;
const owner = `regression-${randomUUID()}`;
const pages: RecognitionPage[] = Array.from({ length: 3 }, (_, pageIndex) => ({
  pageIndex,
  width: 1,
  height: 1,
  imageDataUrl: pixel,
}));

const session = await createRecognitionSession(sessionId, pages.length, owner);
await writeRecognitionPage(session, 2, pages[2]);
await writeRecognitionPage(session, 0, pages[0]);
await writeRecognitionPage(session, 1, pages[1]);
// 同一页重传只覆盖页面文件，不增加页数，也不触发识别。
await writeRecognitionPage(session, 1, pages[1]);
assert.deepEqual(recognitionSessionSnapshot(session).uploadedPageIndexes, [0, 1, 2]);

const progress: number[] = [];
const result = await startRecognitionSession(session, async (storedPages, pageCount, onProgress) => {
  const received: number[] = [];
  for await (const page of storedPages) received.push(page.pageIndex);
  onProgress(2, pageCount);
  progress.push(2);
  onProgress(3, pageCount);
  progress.push(3);
  return {
    questions: received.map((pageIndex) => ({
      id: `q-${pageIndex}`,
      number: String(pageIndex + 1),
      pageIndex,
      sourcePageIndexes: [pageIndex],
      stemMarkdown: `第 ${pageIndex + 1} 页`,
      options: [],
      figures: [],
    })),
    processedPageIndexes: received,
    emptyPageIndexes: [],
    warnings: [],
  };
});

assert.deepEqual(result.processedPageIndexes, [0, 1, 2]);
assert.deepEqual(progress, [2, 3]);
assert.equal(recognitionSessionSnapshot(session).state, "completed");
assert.equal(recognitionSessionSnapshot(session, true).result, undefined, "计费响应送达前不得提前回读结果");
assert.equal(beginRecognitionResultDelivery(session), "acquired");
assert.equal(beginRecognitionResultDelivery(session), "delivering", "并发请求不得重复取得结果交付权");
releaseRecognitionResultDelivery(session);
assert.equal(beginRecognitionResultDelivery(session), "acquired", "连接中断后必须释放结果交付权");
completeRecognitionResultDelivery(session);
assert.deepEqual(recognitionSessionSnapshot(session, true).result?.processedPageIndexes, [0, 1, 2]);
assert.deepEqual(
  (await startRecognitionSession(session, async () => { throw new Error("不得重复识别"); })).processedPageIndexes,
  [0, 1, 2],
);

const resumeSession = await createRecognitionSession(`test-${randomUUID()}`, pages.length, owner);
for (const page of pages) await writeRecognitionPage(resumeSession, page.pageIndex, page);
const observedProgress: number[] = [];
const unsubscribe = subscribeRecognitionSession(resumeSession, (snapshot) => {
  if (snapshot.phase === "recognizing") observedProgress.push(snapshot.current);
});
await assert.rejects(
  () => startRecognitionSession(resumeSession, async (_storedPages, pageCount, onProgress, checkpoint) => {
    onProgress(2, pageCount);
    checkpoint.completedBatches.push({
      pageIndexes: [0, 1],
      result: {
        questions: [],
        processedPageIndexes: [0, 1],
        emptyPageIndexes: [0, 1],
        warnings: [],
      },
    });
    throw new Error("模拟大文件中途失败");
  }),
  /模拟大文件中途失败/,
);
assert.equal(recognitionSessionSnapshot(resumeSession).progress.current, 2);

const progressBeforeResume = observedProgress.length;
const resumedResult = await startRecognitionSession(
  resumeSession,
  async (storedPages, pageCount, onProgress, checkpoint) => {
    assert.equal(checkpoint.completedBatches.length, 1, "失败后必须保留成功批次断点");
    onProgress(1, pageCount);
    const received: number[] = [];
    for await (const page of storedPages) received.push(page.pageIndex);
    onProgress(pageCount, pageCount);
    return {
      questions: [],
      processedPageIndexes: received,
      emptyPageIndexes: received,
      warnings: [],
    };
  },
);
unsubscribe();
assert.deepEqual(resumedResult.processedPageIndexes, [0, 1, 2]);
assert.ok(
  observedProgress.slice(progressBeforeResume).every((current) => current >= 2),
  "重新接入失败会话时进度不得回退到第一页",
);

console.log("WORD 会话式逐页上传、断点恢复、进度单调和结果复用回归通过");

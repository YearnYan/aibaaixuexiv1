import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  recognizePageSequence,
  type RecognitionPage,
  type RecognitionSequenceCheckpoint,
} from "../server/aiProxy";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";
const batches: number[][] = [];
let failedBatchKey = "";
let remainingFailedResponses = 0;

const upstream = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const content = payload.messages?.[0]?.content || [];
  const pageIndexes = content
    .filter((part: { type?: string }) => part?.type === "text")
    .map((part: { text?: string }) => /原始 pageIndex=(\d+)/u.exec(String(part.text || ""))?.[1])
    .filter(Boolean)
    .map(Number);
  batches.push(pageIndexes);

  if (pageIndexes.join(",") === failedBatchKey && remainingFailedResponses > 0) {
    remainingFailedResponses -= 1;
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "temporary upstream failure" }));
    return;
  }

  const result = {
    questions: pageIndexes.map((pageIndex) => ({
      id: `batch-q-${pageIndex}`,
      number: String(pageIndex + 1),
      pageIndex,
      sourcePageIndexes: [pageIndex],
      stemMarkdown: `第 ${pageIndex + 1} 页的完整题干`,
      options: [],
      figures: [],
    })),
    processedPageIndexes: pageIndexes,
    emptyPageIndexes: [],
    warnings: [],
  };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    choices: [{
      finish_reason: "stop",
      message: { content: JSON.stringify(result) },
    }],
  }));
});

upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const address = upstream.address();
assert.ok(address && typeof address === "object");

try {
  const pages: RecognitionPage[] = Array.from({ length: 61 }, (_, pageIndex) => ({
    pageIndex,
    width: 1,
    height: 1,
    imageDataUrl: pixel,
  }));
  const result = await recognizePageSequence({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "test-key",
    model: "unchanged-test-model",
  }, pages, pages.length);

  assert.equal(result.questions.length, 61, "超过旧 50 页上限时仍必须返回全部题目");
  assert.deepEqual(result.processedPageIndexes, pages.map((page) => page.pageIndex));
  assert.deepEqual(result.emptyPageIndexes, []);
  assert.equal(batches.length, 9, "61 页应按 8 页批次和 1 页边界重叠完成");
  assert.ok(batches.every((batch) => batch.length <= 8));
  for (let index = 1; index < batches.length; index += 1) {
    assert.equal(batches[index - 1].at(-1), batches[index][0], "相邻识别批次必须共享一个边界页");
  }

  batches.length = 0;
  const resumablePages: RecognitionPage[] = Array.from({ length: 25 }, (_, pageIndex) => ({
    pageIndex,
    width: 1,
    height: 1,
    imageDataUrl: pixel,
  }));
  const checkpoint: RecognitionSequenceCheckpoint = {
    expectedPageCount: resumablePages.length,
    completedBatches: [],
  };
  failedBatchKey = "7,8,9,10,11,12,13,14";
  // 单次批次调用会做一次传输重试；连续两次 503 用来模拟该批次本轮仍失败。
  remainingFailedResponses = 2;
  await assert.rejects(() => recognizePageSequence(
    {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: "test-key",
      model: "unchanged-test-model",
    },
    resumablePages,
    resumablePages.length,
    { checkpoint },
  ));
  assert.equal(checkpoint.completedBatches.length, 1, "故障前已经成功的批次必须保留为断点");
  assert.equal(
    batches.filter((batch) => batch.join(",") === "0,1,2,3,4,5,6,7").length,
    1,
    "首次成功批次只允许调用 AI 一次",
  );

  const resumeProgress: number[] = [];
  const resumed = await recognizePageSequence(
    {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: "test-key",
      model: "unchanged-test-model",
    },
    resumablePages,
    resumablePages.length,
    {
      checkpoint,
      onProgress: ({ current }) => resumeProgress.push(current),
    },
  );
  assert.deepEqual(resumed.processedPageIndexes, resumablePages.map((page) => page.pageIndex));
  assert.equal(resumed.questions.length, resumablePages.length);
  assert.equal(
    batches.filter((batch) => batch.join(",") === "0,1,2,3,4,5,6,7").length,
    1,
    "恢复时不得再次调用已成功的第一页批次",
  );
  assert.ok(resumeProgress.length > 0 && resumeProgress[0] >= 8, "恢复进度不得回到第一页");
  assert.ok(
    resumeProgress.every((current, index) => index === 0 || current >= resumeProgress[index - 1]),
    "恢复过程的进度必须单调递增",
  );
} finally {
  upstream.close();
  await once(upstream, "close");
}

console.log("61 页大文件渐进批次识别及中途故障断点恢复回归测试通过");

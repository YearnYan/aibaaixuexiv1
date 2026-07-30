import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  recognizePageSequence,
  type RecognitionPage,
  type RecognitionSequenceCheckpoint,
} from "../server/aiProxy.js";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";
const settings = { baseUrl: "", apiKey: "test-only", model: "unchanged-vision-model" };
type Mode = "normal" | "bad-page" | "bad-recovery" | "multi-recovery" | "checkpoint" | "timeout";
let mode: Mode = "normal";
let calls: Array<{ pageIndexes: number[]; recovery: boolean }> = [];
let activeAbortController: AbortController | null = null;
let checkpointInterrupted = false;

const upstream = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    messages?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const content = body.messages?.[0]?.content ?? [];
  const texts = content.filter((part) => part.type === "text").map((part) => String(part.text || ""));
  const pageIndexes = texts
    .map((text) => /原始 pageIndex=(\d+)/u.exec(text)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  const prompt = texts.join("\n");
  const recovery = prompt.includes("这是表格纠错复检");
  calls.push({ pageIndexes, recovery });

  if (mode === "timeout" && !recovery) {
    response.writeHead(200, { "content-type": "application/json" });
    response.flushHeaders();
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    if (!response.writableEnded) response.end();
    return;
  }

  if (mode === "checkpoint" && recovery && !checkpointInterrupted) {
    checkpointInterrupted = true;
    activeAbortController?.abort(new Error("模拟复检阶段外部中断"));
    response.destroy();
    return;
  }

  if ((mode === "bad-page" && !recovery && pageIndexes.includes(24))
    || (mode === "bad-recovery" && recovery)) {
    sendCompletion(response, "{\"questions\":[");
    return;
  }

  if (recovery) {
    const targetId = /"targetId":"([^"]+)"/u.exec(prompt)?.[1];
    assert.ok(targetId, "单目标复检请求必须携带 targetId");
    const pageIndex = pageIndexes[0];
    sendCompletion(response, JSON.stringify({
      questions: [{
        id: targetId,
        kind: "question",
        number: "1",
        pageIndex,
        sourcePageIndexes: [pageIndex],
        stemMarkdown: "",
        options: [],
        figures: [{
          pageIndex,
          kind: "table",
          bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.5 },
        }],
      }],
      processedPageIndexes: [pageIndex],
      emptyPageIndexes: [],
      warnings: [],
    }));
    return;
  }

  const tableMode = mode === "bad-recovery" || mode === "multi-recovery" || mode === "checkpoint";
  sendCompletion(response, JSON.stringify({
    questions: pageIndexes.map((pageIndex) => ({
      id: `q-${pageIndex}`,
      kind: "question",
      number: String(pageIndex + 1),
      pageIndex,
      sourcePageIndexes: [pageIndex],
      stemMarkdown: tableMode
        ? "数据如下：\n\n| 项目 | 数值 |\n| --- | --- |\n| A | 1 |"
        : `第 ${pageIndex + 1} 页完整内容`,
      options: [],
      figures: [],
    })),
    processedPageIndexes: pageIndexes,
    emptyPageIndexes: [],
    warnings: [],
  }));
});

upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const address = upstream.address();
assert.ok(address && typeof address === "object");
settings.baseUrl = `http://127.0.0.1:${address.port}/v1`;

try {
  const largePages = buildPages(116);

  reset("normal");
  const normal = await recognizePageSequence(settings, largePages, largePages.length);
  assert.deepEqual(normal.processedPageIndexes, largePages.map((page) => page.pageIndex));
  assert.equal(normal.questions.length, 116);
  assert.equal(calls.length, 17, "正常 116 页仍应按 8 页批次和单页边界重叠完成，不增加调用");

  reset("bad-page");
  await assert.rejects(
    () => recognizePageSequence(settings, largePages, largePages.length),
    "单页连续返回坏结构时必须失败退款，不能伪装成原页保留的成功结果",
  );
  assert.equal(countPrimaryCalls("0,1,2,3,4,5,6,7"), 1, "坏页之前的成功批次不得重跑");
  assert.equal(countPrimaryCalls("28,29,30,31,32,33,34,35"), 0, "当前失败应立即返回，不能被伪装成功后继续结算");

  reset("bad-recovery");
  const recoveryFallback = await recognizePageSequence(settings, buildPages(1, 200), 1);
  assert.equal(calls.filter((call) => !call.recovery).length, 1, "复检坏结构不得重跑主识别");
  assert.equal(calls.filter((call) => call.recovery).length, 2, "单目标复检只进行有限结构重试");
  assert.ok(recoveryFallback.questions[0].figures.some((figure) => (
    figure.pageIndex === 200 && figure.bbox.width === 1 && figure.bbox.height === 1
  )), "复检耗尽后必须附加完整原页");

  reset("multi-recovery");
  const multiRecovery = await recognizePageSequence(settings, buildPages(2, 220), 2);
  const recoveryCalls = calls.filter((call) => call.recovery);
  assert.equal(calls.filter((call) => !call.recovery).length, 1);
  assert.equal(recoveryCalls.length, 2, "同批两个复检目标必须拆成两次独立请求");
  assert.equal(recoveryCalls.every((call) => call.pageIndexes.length === 1), true, "每个复检请求只发送目标关联页");
  assert.equal(multiRecovery.questions.every((question) => question.figures.some((figure) => figure.kind === "table")), true);

  reset("checkpoint");
  const checkpoint: RecognitionSequenceCheckpoint = {
    expectedPageCount: 1,
    completedBatches: [],
    partialBatches: [],
  };
  activeAbortController = new AbortController();
  await assert.rejects(() => recognizePageSequence(settings, buildPages(1, 300), 1, {
    checkpoint,
    signal: activeAbortController!.signal,
  }));
  assert.equal(checkpoint.partialBatches?.length, 1, "主识别成功后必须立即保存阶段断点");
  assert.equal(calls.filter((call) => !call.recovery).length, 1);

  activeAbortController = null;
  const resumed = await recognizePageSequence(settings, buildPages(1, 300), 1, { checkpoint });
  assert.equal(calls.filter((call) => !call.recovery).length, 1, "复检阶段恢复时不得再次执行主识别");
  assert.deepEqual(resumed.processedPageIndexes, [300]);
  assert.equal(resumed.questions[0].figures.some((figure) => figure.kind === "table"), true);
  reset("timeout");
  const previousUpstreamTimeout = process.env.UPSTREAM_TIMEOUT_MS;
  const previousOperationTimeout = process.env.RECOGNITION_OPERATION_TIMEOUT_MS;
  process.env.UPSTREAM_TIMEOUT_MS = "1000";
  process.env.RECOGNITION_OPERATION_TIMEOUT_MS = "30000";
  try {
    await assert.rejects(
      () => recognizePageSequence(settings, buildPages(3, 400), 3),
      "上游持续无响应时必须返回失败，不能输出原页占位内容",
    );
    assert.ok(calls.some((call) => call.pageIndexes.length < 3), "批次超时后必须自动拆分为更小批次");
    assert.equal(countPrimaryCalls("400,401,402"), 1, "超时大批次必须立即拆分，不能原样重放并耗尽预算");
  } finally {
    if (previousUpstreamTimeout === undefined) delete process.env.UPSTREAM_TIMEOUT_MS;
    else process.env.UPSTREAM_TIMEOUT_MS = previousUpstreamTimeout;
    if (previousOperationTimeout === undefined) delete process.env.RECOGNITION_OPERATION_TIMEOUT_MS;
    else process.env.RECOGNITION_OPERATION_TIMEOUT_MS = previousOperationTimeout;
  }
} finally {
  upstream.close();
  await once(upstream, "close");
}

console.log("116 页分批识别、失败退款、单目标复检和阶段断点回归通过");

function buildPages(count: number, offset = 0): RecognitionPage[] {
  return Array.from({ length: count }, (_, index) => ({
    pageIndex: offset + index,
    width: 1,
    height: 1,
    imageDataUrl: pixel,
  }));
}

function reset(nextMode: Mode) {
  mode = nextMode;
  calls = [];
  activeAbortController = null;
  checkpointInterrupted = false;
}

function countPrimaryCalls(key: string) {
  return calls.filter((call) => !call.recovery && call.pageIndexes.join(",") === key).length;
}

function sendCompletion(response: import("node:http").ServerResponse, content: string) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content } }],
  }));
}

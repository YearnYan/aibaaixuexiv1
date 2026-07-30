import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  recognizePageSequence,
  type RecognitionPage,
} from "../server/aiProxy.js";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";
const settings = { baseUrl: "", apiKey: "test-only", model: "unchanged-vision-model" };
let mode: "metadata" | "retry" | "split" | "single" = "metadata";
let requests: Array<{ pageIndexes: number[]; body: Record<string, unknown>; structureRecovery: boolean }> = [];
let modeAttempt = 0;

const upstream = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  const content = ((body.messages as Array<{ content?: Array<{ type?: string; text?: string }> }>)?.[0]?.content ?? []);
  const pageIndexes = content
    .filter((part) => part.type === "text")
    .map((part) => /原始 pageIndex=(\d+)/u.exec(String(part.text || ""))?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  const structureRecovery = content.some((part) => String(part.text || "").includes("上一次同批次输出"));
  requests.push({ pageIndexes, body, structureRecovery });
  modeAttempt += 1;

  const shouldReturnBrokenJson = (mode === "retry" && modeAttempt === 1)
    || (mode === "split" && pageIndexes.length > 3)
    || (mode === "single" && modeAttempt < 3);
  const result = shouldReturnBrokenJson
    ? "{\"questions\":["
    : JSON.stringify({
        questions: pageIndexes.map((pageIndex) => ({
          id: `q-${pageIndex}`,
          number: String(pageIndex + 1),
          pageIndex: String(pageIndex),
          stemMarkdown: `第 ${pageIndex + 1} 页：计算 \\mathop{\\mathrm{Var}}(X)+１×２`,
          options: [],
          figures: [],
        })),
        // 故意返回错误类型、重复页和缺省空页，成功元数据必须由服务端事实重建。
        processedPageIndexes: mode === "metadata" ? [...pageIndexes.map(String), String(pageIndexes[0])] : pageIndexes,
        ...(mode === "metadata" ? {} : { emptyPageIndexes: [] }),
        warnings: [],
      });

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: result } }],
  }));
});

upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const address = upstream.address();
assert.ok(address && typeof address === "object");
settings.baseUrl = `http://127.0.0.1:${address.port}/v1`;

try {
  const metadataPages = buildPages(2, 10);
  reset("metadata");
  const metadataResult = await recognizePageSequence(settings, metadataPages, metadataPages.length);
  assert.deepEqual(metadataResult.processedPageIndexes, [10, 11]);
  assert.deepEqual(metadataResult.emptyPageIndexes, []);
  assert.match(metadataResult.questions[0].stemMarkdown, /\\mathop/);
  assert.doesNotMatch(metadataResult.questions[0].stemMarkdown, /１/);
  assert.ok(metadataResult.warnings.some((warning) => warning.includes("服务端")));

  const retryPages = buildPages(3, 20);
  reset("retry");
  const retryProgress: number[] = [];
  const retryResult = await recognizePageSequence(settings, retryPages, retryPages.length, {
    onProgress: ({ current }) => retryProgress.push(current),
  });
  assert.deepEqual(retryResult.processedPageIndexes, [20, 21, 22]);
  assert.equal(requests.length, 2, "坏 JSON 必须只对当前批次执行一次结构纠错");
  assert.equal(requests[1].structureRecovery, true);
  assert.equal(requests.every((item) => item.body.model === settings.model), true, "结构纠错不得更换模型");
  assert.equal(retryProgress[0], 1, "任意页数都必须在模型调用前发布第 1/N 页状态");

  const splitPages = buildPages(6, 30);
  reset("split");
  const splitResult = await recognizePageSequence(settings, splitPages, splitPages.length);
  assert.deepEqual(splitResult.processedPageIndexes, [30, 31, 32, 33, 34, 35]);
  assert.deepEqual(splitResult.questions.map((question) => question.pageIndex), [30, 31, 32, 33, 34, 35]);
  assert.ok(requests.some((item) => item.pageIndexes.join(",") === "32,33,34,35"));
  assert.ok(requests.some((item) => item.pageIndexes.join(",") === "33,34,35"), "递归拆分必须保留边界页重叠");
  assert.equal(requests.every((item) => item.body.model === settings.model), true);

  const singlePage = buildPages(1, 40);
  reset("single");
  const singleResult = await recognizePageSequence(settings, singlePage, singlePage.length);
  assert.deepEqual(singleResult.processedPageIndexes, [40]);
  assert.equal(requests.length, 3, "单页结构损坏最多执行三次同模型高质量识别");
} finally {
  upstream.close();
  await once(upstream, "close");
}

console.log("WORD 非内容元数据修复、同模型结构重试、坏批次拆分和全任务进度回归通过");

function buildPages(count: number, offset: number): RecognitionPage[] {
  return Array.from({ length: count }, (_, index) => ({
    pageIndex: offset + index,
    width: 1,
    height: 1,
    imageDataUrl: pixel,
  }));
}

function reset(nextMode: typeof mode) {
  mode = nextMode;
  modeAttempt = 0;
  requests = [];
}

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { recognizePageSequence, type RecognitionPage } from "../server/aiProxy.js";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";
let requestCount = 0;
let recoveryRequestCount = 0;
const recoveryAttemptsByTarget = new Map<string, number>();

const upstream = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    messages?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const prompt = (payload.messages?.[0]?.content || [])
    .filter((part) => part.type === "text")
    .map((part) => String(part.text || ""))
    .join("\n");
  requestCount += 1;

  if (prompt.includes('"targetId"')) {
    recoveryRequestCount += 1;
    const targetId = prompt.match(/"targetId":"([^"]+)"/u)?.[1];
    assert.ok(targetId, "复检请求必须携带目标编号");
    recoveryAttemptsByTarget.set(targetId, (recoveryAttemptsByTarget.get(targetId) || 0) + 1);
    response.writeHead(200, { "content-type": "application/json" });
    response.flushHeaders();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    if (!response.writableEnded) response.end();
    return;
  }

  const questions = Array.from({ length: 10 }, (_, index) => ({
    id: `q-${index + 1}`,
    number: String(index + 1),
    pageIndex: 0,
    sourcePageIndexes: [0],
    stemMarkdown: `内容 ${index + 1}\n\n| 项目 | 数值 |\n| --- | --- |\n| A | 1 |`,
    options: [],
    figures: [],
  }));
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    choices: [{
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          questions,
          processedPageIndexes: [0],
          emptyPageIndexes: [],
          warnings: [],
        }),
      },
    }],
  }));
});

upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const address = upstream.address();
assert.ok(address && typeof address === "object");

const previousTimeout = process.env.RECOVERY_TARGET_TIMEOUT_MS;
process.env.RECOVERY_TARGET_TIMEOUT_MS = "1000";
try {
  const pages: RecognitionPage[] = [{ pageIndex: 0, width: 1, height: 1, imageDataUrl: pixel }];
  const startedAt = Date.now();
  const result = await recognizePageSequence({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "test-key",
    model: "budget-test-model",
  }, pages, pages.length);

  assert.equal(result.questions.length, 10, "复检超时不能丢失主识别结果");
  assert.equal(requestCount, recoveryRequestCount + 1, "除主识别外只能发起目标复检请求");
  assert.equal(recoveryAttemptsByTarget.size, 6, "每批必须只处理前 6 个复检目标");
  assert.ok(
    [...recoveryAttemptsByTarget.values()].every((attempts) => attempts >= 1 && attempts <= 2),
    "每个复检目标必须请求一次且最多重试一次",
  );
  assert.ok(Date.now() - startedAt < 15_000, "复检超时不能让单页任务长期卡住");
} finally {
  if (previousTimeout === undefined) delete process.env.RECOVERY_TARGET_TIMEOUT_MS;
  else process.env.RECOVERY_TARGET_TIMEOUT_MS = previousTimeout;
  upstream.close();
  await once(upstream, "close");
}

console.log("识别复检预算与主结果快速落盘回归测试通过");

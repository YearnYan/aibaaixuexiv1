import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { recognizePageSequence, type RecognitionPage } from "../server/aiProxy.js";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";
let recoveryRequests = 0;

const upstream = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    messages?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const prompt = (body.messages?.[0]?.content || [])
    .filter((part) => part.type === "text")
    .map((part) => String(part.text || ""))
    .join("\n");
  if (prompt.includes('"targetId"')) {
    recoveryRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    choices: [{
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          questions: [{
            id: "q-1",
            number: "1",
            pageIndex: 0,
            sourcePageIndexes: [0],
            stemMarkdown: "完整资料内容",
            options: [],
            figures: [{
              pageIndex: 0,
              kind: "table",
              bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 },
            }],
          }],
          processedPageIndexes: [0],
          emptyPageIndexes: [],
          warnings: [],
        }),
      },
    }],
  }));
});

await upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const address = upstream.address();
assert.ok(address && typeof address === "object");
const previousRecoveryMode = process.env.WORD_RECOGNITION_RECOVERY;
process.env.WORD_RECOGNITION_RECOVERY = "0";
try {
  const pages: RecognitionPage[] = [{ pageIndex: 0, width: 1, height: 1, imageDataUrl: pixel }];
  const startedAt = Date.now();
  const result = await recognizePageSequence({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "test-key",
    model: "production-fast-path-test",
  }, pages, pages.length);
  assert.equal(result.questions.length, 1);
  assert.equal(recoveryRequests, 0, "生产主识别完成后不应等待慢复检");
  assert.ok(Date.now() - startedAt < 2_000, "生产快路径不应被复检延迟");
} finally {
  if (previousRecoveryMode === undefined) delete process.env.WORD_RECOGNITION_RECOVERY;
  else process.env.WORD_RECOGNITION_RECOVERY = previousRecoveryMode;
  upstream.close();
  await once(upstream, "close");
}

console.log("生产识别快路径回归测试通过：主结果不等待慢复检");

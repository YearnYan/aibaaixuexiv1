import { createServer } from "node:http";

const port = Number(process.env.MOCK_AI_PORT ?? 8794);

const recognitionResult = {
  questions: [{
    id: "q-1",
    number: "1",
    pageIndex: 0,
    sourcePageIndexes: [0],
    stemMarkdown: "Mock question",
    options: ["A. Choice"],
    figures: [],
  }],
  warnings: [],
};

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }

  const body = await readJson(request);
  const isVerification = body && typeof body === "object" && "max_tokens" in body;
  const content = isVerification ? "OK" : JSON.stringify(recognitionResult);

  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content } }] }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`本地模拟识别服务已启动：http://127.0.0.1:${port}`);
});

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import JSZip from "jszip";
import { recognizePages, type RecognitionPage } from "../server/aiProxy";
import { exportQuestionsToDocx } from "../server/wordExport";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";
let recognitionInstruction = "";

const upstream = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  recognitionInstruction = String(payload.messages?.[0]?.content?.[0]?.text || "");
  const result = {
    questions: [
      contentItem("heading", "# 教师培训通知"),
      contentItem("paragraph", "培训时间：周五 14:00。"),
      {
        id: "question",
        kind: "question",
        number: "1",
        pageIndex: 0,
        sourcePageIndexes: [0],
        stemMarkdown: "请写出本次培训的主题。",
        options: [],
        figures: [],
      },
      contentItem("answer", "参考答案：人工智能教学应用。"),
    ],
    processedPageIndexes: [0],
    emptyPageIndexes: [],
    warnings: [],
  };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }],
  }));
});

upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const address = upstream.address();
assert.ok(address && typeof address === "object");

try {
  const page: RecognitionPage = { pageIndex: 0, width: 1, height: 1, imageDataUrl: pixel };
  const result = await recognizePages({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "test-key",
    model: "general-content-test-model",
  }, { pages: [page] });

  assert.deepEqual(result.questions.map((item) => item.kind), ["content", "content", "question", "content"]);
  assert.deepEqual(result.questions.map((item) => item.number), ["", "", "1", ""]);
  assert.deepEqual(result.questions.map((item) => item.stemMarkdown), [
    "# 教师培训通知",
    "培训时间：周五 14:00。",
    "请写出本次培训的主题。",
    "参考答案：人工智能教学应用。",
  ]);
  assert.deepEqual(result.emptyPageIndexes, []);
  assert.match(recognitionInstruction, /上传内容不限类型/u);
  assert.match(recognitionInstruction, /页眉页脚、目录、答案解析/u);
  assert.doesNotMatch(recognitionInstruction, /只提取题目本身/u);

  const buffer = await exportQuestionsToDocx({
    title: "资料完整输出验证",
    questions: result.questions.map((item) => ({ ...item, figures: [] })),
  });
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  assert.ok(documentXml);
  assert.match(documentXml, /教师培训通知/u);
  assert.match(documentXml, /培训时间：周五 14:00。/u);
  assert.match(documentXml, /1\. 请写出本次培训的主题。/u);
  assert.match(documentXml, /参考答案：人工智能教学应用。/u);
  assert.doesNotMatch(documentXml, /\d+\. # 教师培训通知/u);
  assert.doesNotMatch(documentXml, /\d+\. 参考答案：/u);
} finally {
  upstream.close();
  await once(upstream, "close");
}

console.log("任意资料完整识别与无伪题号 Word 输出回归测试通过");

function contentItem(id: string, stemMarkdown: string) {
  return {
    id,
    kind: "content",
    number: "",
    pageIndex: 0,
    sourcePageIndexes: [0],
    stemMarkdown,
    options: [],
    figures: [],
  };
}

import assert from "node:assert/strict";
import {
  recognizePages,
  repairLooseJsonEscapes,
  type RecognitionRequest,
} from "../server/aiProxy";

const tinyImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";
const pages = Array.from({ length: 5 }, (_, pageIndex) => ({
  pageIndex,
  width: 1,
  height: 1,
  imageDataUrl: tinyImage,
})) satisfies RecognitionRequest["pages"];

const looseLatex = String.raw`{"stemMarkdown":"计算 \frac{a}{b} 与 \sqrt{x}"}`;
const repairedLatex = repairLooseJsonEscapes(looseLatex);
assert.deepEqual(JSON.parse(repairedLatex), {
  stemMarkdown: String.raw`计算 \frac{a}{b} 与 \sqrt{x}`,
});

const jsonValidButCorruptedLatex = String.raw`{"stemMarkdown":"\frac{a}{b} \begin{array} \right) \text{单位} \neq"}`;
assert.deepEqual(JSON.parse(repairLooseJsonEscapes(jsonValidButCorruptedLatex)), {
  stemMarkdown: String.raw`\frac{a}{b} \begin{array} \right) \text{单位} \neq`,
}, "以 f、b、r、t、n 开头的裸 LaTeX 命令不得被 JSON 控制字符静默吞掉");

for (const command of [
  "boxed", "boldsymbol", "bmod", "flat", "mathop", "nexists", "not", "rm", "textbf", "tag", "top",
]) {
  const rawCommandJson = `{"stemMarkdown":"\\${command}{x}"}`;
  assert.deepEqual(JSON.parse(repairLooseJsonEscapes(rawCommandJson)), {
    stemMarkdown: `\\${command}{x}`,
  }, `裸 LaTeX 命令 \\${command} 不得被 JSON 控制字符静默吞掉`);
}

const validJson = JSON.stringify({
  stemMarkdown: String.raw`合法 \frac{a}{b}`,
  note: "引号\"、换行\n与中文",
});
assert.equal(repairLooseJsonEscapes(validJson), validJson, "合法 JSON 不得被二次转义破坏");

const rawControlCharacter = `{"text":"第一行\n第二行\t末尾"}`;
assert.deepEqual(JSON.parse(repairLooseJsonEscapes(rawControlCharacter)), {
  text: "第一行\n第二行\t末尾",
});

const originalFetch = globalThis.fetch;
let rejectedBodyWasCancelled = false;
try {
  let wholeDocumentRequests = 0;
  globalThis.fetch = async (_url, init) => {
    wholeDocumentRequests += 1;
    const body = JSON.parse(String(init?.body));
    const pageIndexes = [...new Set<number>(body.messages[0].content
      .filter((part: { type?: string; text?: string }) => part.type === "text")
      .flatMap((part: { text?: string }) => [...String(part.text || "").matchAll(/pageIndex=(\d+)/g)])
      .map((match: RegExpMatchArray) => Number(match[1])))];
    const content = JSON.stringify({
      questions: pageIndexes.map((pageIndex: number, index: number) => ({
        id: `q-${index + 1}`,
        number: String(index + 1),
        pageIndex,
        sourcePageIndexes: [pageIndex],
        stemMarkdown: `第 ${index + 1} 页完整题目`,
        options: [],
        figures: [],
      })),
      processedPageIndexes: pageIndexes,
      emptyPageIndexes: [],
      warnings: [],
    });
    return Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
  };
  const wholeDocument = await recognizePages(
    { baseUrl: "http://mock.invalid/v1", apiKey: "test-only", model: "unchanged-model" },
    { pages },
  );
  assert.equal(wholeDocumentRequests, 1, "整份试卷必须由同一个多模态上下文一次识别，不能再跨批截断题目");
  assert.deepEqual(wholeDocument.questions.map((question) => question.pageIndex), [0, 1, 2, 3, 4]);

  globalThis.fetch = async () => new Response(new ReadableStream({
    cancel() {
      rejectedBodyWasCancelled = true;
    },
  }), { status: 401 });
  await assert.rejects(
    recognizePages(
      { baseUrl: "http://mock.invalid/v1", apiKey: "test-only", model: "unchanged-model" },
      { pages: [pages[0]] },
    ),
  );
  assert.equal(rejectedBodyWasCancelled, true, "非成功上游响应体必须主动取消并释放连接");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("整卷单次识别与公式 JSON 修复回归测试通过");

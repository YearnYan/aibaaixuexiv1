import assert from "node:assert/strict";
import { recognizeWholeDocument } from "../src/lib/api";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";
const originalFetch = globalThis.fetch;
const originalImageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

class MockImage {
  naturalWidth = 1;
  naturalHeight = 1;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const canvas = {
  width: 0,
  height: 0,
  getContext: () => ({
    fillStyle: "",
    fillRect() {},
    drawImage() {},
  }),
  toDataURL: () => pixel,
};

Object.defineProperty(globalThis, "Image", {
  configurable: true,
  writable: true,
  value: MockImage,
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  writable: true,
  value: {
    createElement(tagName: string) {
      assert.equal(tagName, "canvas");
      return canvas;
    },
  },
});

const capturedRequests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
try {
  globalThis.fetch = async (input, init) => {
    capturedRequests.push({ input, init });
    const path = String(input);
    if (path.endsWith("/complete")) {
      return Response.json({
        questions: [{
          id: "q-1",
          number: "1",
          pageIndex: 0,
          sourcePageIndexes: [0],
          stemMarkdown: "HTTP/1.1 兼容识别题",
          options: [],
          figures: [],
        }],
        processedPageIndexes: [0],
        emptyPageIndexes: [],
        warnings: [],
      });
    }
    if (path.includes("/status")) return Response.json({ state: "recognizing", progress: { phase: "recognizing", current: 0, total: 1, message: "" } });
    if (path.includes("/pages/")) return Response.json({ uploadedPageIndexes: [0] });
    return Response.json({ sessionId: "word-test-session", pageCount: 1, uploadedPageIndexes: [] }, { status: 201 });
  };

  await recognizeWholeDocument([{
    pageIndex: 0,
    width: 1,
    height: 1,
    imageDataUrl: pixel,
  }]);

  assert.ok(capturedRequests.length >= 3, "一次单页识别应包含初始化、页上传和完成请求");
  assert.equal(capturedRequests.filter(({ input }) => String(input).endsWith("/complete")).length, 1);
  const completionRequest = capturedRequests.find(({ input }) => String(input).endsWith("/complete"));
  assert.deepEqual(JSON.parse(String(completionRequest?.init?.body)), {
    pageCount: 1,
    sourcePageCount: 1,
  });
  assert.match(
    new Headers(completionRequest?.init?.headers).get("X-Idempotency-Key") || "",
    /^recognition-word-[\w-]+$/u,
  );
  assert.ok(capturedRequests.some(({ input }) => String(input).includes("/status")), "完成前应查询真实进度");
  const pageRequest = capturedRequests.find(({ input }) => String(input).includes("/pages/"));
  assert.ok(pageRequest?.init, "识别必须发出逐页上传请求");
  assert.equal(typeof pageRequest.init.body, "string", "HTTP/1.1 页上传使用普通 JSON 请求体");
  assert.equal("duplex" in pageRequest.init, false, "浏览器请求不得携带流式上传 duplex 标记");
  const pagePayload = JSON.parse(String(pageRequest.init.body));
  assert.equal(pagePayload.pageIndex, 0);
  assert.equal(pagePayload.imageDataUrl, pixel);

  capturedRequests.length = 0;
  let completionCalls = 0;
  globalThis.fetch = async (input, init) => {
    capturedRequests.push({ input, init });
    const path = String(input);
    if (path.endsWith("/complete")) {
      completionCalls += 1;
      if (completionCalls === 1) {
        return Response.json({
          ok: false,
          error: "该生成请求正在处理中，请勿重复提交。",
          code: "USAGE_REQUEST_IN_PROGRESS",
        }, { status: 409 });
      }
      if (completionCalls === 2) {
        return Response.json({
          ok: false,
          error: "识别仍在后台进行，客户端将自动继续等待。",
          code: "session_processing",
        }, { status: 409 });
      }
      if (completionCalls === 3) {
        return Response.json({
          ok: false,
          error: "该生成请求已经处理过，请重新点击生成发起新任务。",
          code: "USAGE_REQUEST_ALREADY_SETTLED",
        }, { status: 409 });
      }
      return Response.json({
        questions: [{
          id: "content-1",
          kind: "content",
          number: "",
          pageIndex: 0,
          sourcePageIndexes: [0],
          stemMarkdown: "网络重放后仍成功返回完整资料",
          options: [],
          figures: [],
        }],
        processedPageIndexes: [0],
        emptyPageIndexes: [],
        warnings: [],
      });
    }
    if (path.includes("/status")) {
      return Response.json({
        state: "recognizing",
        progress: { phase: "recognizing", current: 1, total: 1, message: "正在等待同一识别会话" },
      });
    }
    if (path.includes("/pages/")) return Response.json({ uploadedPageIndexes: [0] });
    return Response.json({ sessionId: "word-replay-session", pageCount: 1, uploadedPageIndexes: [] }, { status: 201 });
  };

  const replayResult = await recognizeWholeDocument([{
    pageIndex: 0,
    width: 1,
    height: 1,
    imageDataUrl: pixel,
  }]);
  assert.equal(replayResult.questions[0]?.stemMarkdown, "网络重放后仍成功返回完整资料");
  const replayCompletionRequests = capturedRequests.filter(({ input }) => String(input).endsWith("/complete"));
  assert.equal(replayCompletionRequests.length, 4, "处理中或已结算的请求必须复用同一幂等键接回同一会话");
  const replayKeys = replayCompletionRequests.map(({ init }) => (
    new Headers(init?.headers).get("X-Idempotency-Key") || ""
  ));
  assert.equal(new Set(replayKeys).size, 1, "每次恢复连接必须复用同一个幂等键，避免重复预扣积分");
  replayKeys.forEach((key) => {
    assert.match(key, /^recognition-word-[\w-]+$/u);
  });

  capturedRequests.length = 0;
  globalThis.fetch = async (input, init) => {
    capturedRequests.push({ input, init });
    const path = String(input);
    if (path.endsWith("/complete")) throw new TypeError("连接在结果返回前中断");
    if (path.includes("/status")) {
      return Response.json({
        state: "completed",
        resultDeliveryState: "delivered",
        progress: { phase: "completed", current: 1, total: 1, message: "已完成 1/1 页识别" },
        result: {
          questions: [{
            id: "delivered-1",
            kind: "content",
            number: "",
            pageIndex: 0,
            sourcePageIndexes: [0],
            stemMarkdown: "断线后从已完成会话取回完整结果",
            options: [],
            figures: [],
          }],
          processedPageIndexes: [0],
          emptyPageIndexes: [],
          warnings: [],
        },
      });
    }
    if (path.includes("/pages/")) return Response.json({ uploadedPageIndexes: [0] });
    return Response.json({ sessionId: "word-disconnected-session", pageCount: 1, uploadedPageIndexes: [] }, { status: 201 });
  };

  const disconnectedResult = await recognizeWholeDocument([{
    pageIndex: 0,
    width: 1,
    height: 1,
    imageDataUrl: pixel,
  }]);
  assert.equal(disconnectedResult.questions[0]?.stemMarkdown, "断线后从已完成会话取回完整结果");
  assert.equal(
    capturedRequests.filter(({ input }) => String(input).endsWith("/complete")).length,
    1,
    "结果已成功交付并结算时，断线恢复不得再次提交计费请求",
  );
} finally {
  globalThis.fetch = originalFetch;
  restoreGlobal("Image", originalImageDescriptor);
  restoreGlobal("document", originalDocumentDescriptor);
}

console.log("浏览器 HTTP/1.1 会话式识别请求兼容性回归测试通过");

function restoreGlobal(name: "Image" | "document", descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, name);
}

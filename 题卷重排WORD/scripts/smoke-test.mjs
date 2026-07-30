import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const serverEntry = join(root, "server", "index.ts");
const testUsername = "smoke-admin";
const testPassword = "smoke-password-not-for-production";
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9HJM4AAAAASUVORK5CYII=";

let appProcess;
let mockServer;
let temporaryDirectory;
let appLogs = "";
const mockRequests = [];
let mockResponseMode = "standard";

try {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "question-word-smoke-"));
  mockServer = createMockAiServer();
  const mockPort = await listen(mockServer);
  const appPort = await getFreePort();
  const settingsFile = join(temporaryDirectory, "settings.json");

  appProcess = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(appPort),
      ADMIN_USERNAME: testUsername,
      ADMIN_PASSWORD: testPassword,
      AI_SETTINGS_FILE: settingsFile,
      UPSTREAM_TIMEOUT_MS: '1000',
      RECOGNITION_COMPLETION_WAIT_MS: '100',
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  appProcess.stdout.on("data", (chunk) => { appLogs += chunk; });
  appProcess.stderr.on("data", (chunk) => { appLogs += chunk; });

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForHealth(baseUrl, appProcess);

  const anonymous = await requestJson(baseUrl, "/api/admin/session");
  assert.equal(anonymous.response.status, 200);
  assert.deepEqual(anonymous.body, { authenticated: false });

  const login = await requestJson(baseUrl, "/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: testUsername, password: testPassword }),
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.authenticated, true);
  const cookie = login.response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, "管理员登录未返回会话 Cookie");

  const unconfigured = await requestJson(baseUrl, "/api/admin/ai-settings", { cookie });
  assert.equal(unconfigured.response.status, 200);
  assert.equal(unconfigured.body.configured, false);

  const saved = await requestJson(baseUrl, "/api/admin/ai-settings", {
    method: "PUT",
    cookie,
    body: JSON.stringify({
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: "test-key-for-smoke-only",
      model: "test-vision-model",
    }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.configured, true);
  assert.equal(saved.body.hasApiKey, true);

  const summary = await requestJson(baseUrl, "/api/admin/ai-settings", { cookie });
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.configured, true);
  assert.equal(JSON.stringify(summary.body).includes("test-key-for-smoke-only"), false);

  const verified = await requestJson(baseUrl, "/api/admin/ai-settings/verify", {
    method: "POST",
    cookie,
  });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.ok, true);
  assert.equal(hasVisionPayload(mockRequests.at(-1)), true, "连接验证未向上游发送测试图片");
  assert.deepEqual(mockRequests.at(-1).response_format, { type: "json_object" });
  assert.equal(mockRequests.at(-1).max_tokens, 8192);

  const verifiedSummary = await requestJson(baseUrl, "/api/admin/ai-settings", { cookie });
  assert.equal(typeof verifiedSummary.body.verifiedAt, "string");

  const recognized = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 2, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(recognized.response.status, 200);
  assert.equal(recognized.body.questions.length, 1);
  assert.equal(recognized.body.questions[0].kind, "question");
  assert.equal(recognized.body.questions[0].number, "1");
  assert.equal(recognized.body.questions[0].pageIndex, 2);
  assert.equal(recognized.body.questions[0].figures[0].kind, "diagram");
  assert.deepEqual(recognized.body.questions[0].figures[0].bbox, {
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
  });
  assert.equal(requestContainsText(mockRequests.at(-1), "所有具有行列、边框或单元格结构的内容"), true, "识别提示未要求表格作为图形返回");
  assert.equal(requestContainsText(mockRequests.at(-1), "上传内容不限类型"), true, "识别提示仍把上传资料限定为题目");

  // 会话式逐页上传：单页可以重传，完成请求只携带会话编号，服务端仍按原模型批次识别。
  const sessionId = `smoke-${randomUUID()}`;
  const initializedSession = await requestJson(baseUrl, "/api/recognition-sessions", {
    method: "POST",
    body: JSON.stringify({ sessionId, pageCount: 2 }),
  });
  assert.equal(initializedSession.response.status, 201);
  const pageZero = { pageIndex: 0, width: 1_000, height: 800, imageDataUrl: tinyPng };
  const pageOne = { pageIndex: 1, width: 1_000, height: 800, imageDataUrl: tinyPng };
  const uploadedZero = await requestJson(baseUrl, `/api/recognition-sessions/${sessionId}/pages/0`, {
    method: "PUT",
    body: JSON.stringify(pageZero),
  });
  assert.equal(uploadedZero.response.status, 200);
  await requestJson(baseUrl, `/api/recognition-sessions/${sessionId}/pages/0`, {
    method: "PUT",
    body: JSON.stringify(pageZero),
  });
  await requestJson(baseUrl, `/api/recognition-sessions/${sessionId}/pages/1`, {
    method: "PUT",
    body: JSON.stringify(pageOne),
  });
  const sessionStatus = await requestJson(baseUrl, `/api/recognition-sessions/${sessionId}/status`);
  assert.deepEqual(sessionStatus.body.uploadedPageIndexes, [0, 1]);
  const mismatchedPageCount = await requestJson(baseUrl, `/api/recognition-sessions/${sessionId}/complete`, {
    method: "POST",
    body: JSON.stringify({ pageCount: 1, sourcePageCount: 1 }),
  });
  assert.equal(mismatchedPageCount.response.status, 409);
  assert.equal(mismatchedPageCount.body.code, "session_page_count_mismatch");
  const completedSession = await requestJson(baseUrl, `/api/recognition-sessions/${sessionId}/complete`, {
    method: "POST",
    body: JSON.stringify({ pageCount: 2, sourcePageCount: 2 }),
  });
  assert.equal(completedSession.response.status, 200);
  assert.deepEqual(completedSession.body.processedPageIndexes, [0, 1]);

  // 大文件识别超过单次 HTTP 等待窗口时先返回可退款的处理中状态，后台任务继续且不会重跑。
  const delayedSessionId = `delayed-${randomUUID()}`;
  await requestJson(baseUrl, "/api/recognition-sessions", {
    method: "POST",
    body: JSON.stringify({ sessionId: delayedSessionId, pageCount: 1 }),
  });
  await requestJson(baseUrl, `/api/recognition-sessions/${delayedSessionId}/pages/0`, {
    method: "PUT",
    body: JSON.stringify(pageZero),
  });
  mockResponseMode = "delayed-session";
  const processingSession = await requestJson(
    baseUrl,
    `/api/recognition-sessions/${delayedSessionId}/complete`,
    { method: "POST", body: JSON.stringify({ pageCount: 1, sourcePageCount: 1 }) },
  );
  assert.equal(processingSession.response.status, 409);
  assert.equal(processingSession.body.code, "session_processing");
  const completedDelayedStatus = await waitForSessionState(
    baseUrl,
    delayedSessionId,
    "completed",
  );
  assert.equal(completedDelayedStatus.body.resultDeliveryState, "available");
  assert.equal("result" in completedDelayedStatus.body, false, "成功计费交付前不得从状态接口提前取走结果");
  const deliveredDelayedSession = await requestJson(
    baseUrl,
    `/api/recognition-sessions/${delayedSessionId}/complete`,
    { method: "POST", body: JSON.stringify({ pageCount: 1, sourcePageCount: 1 }) },
  );
  assert.equal(deliveredDelayedSession.response.status, 200);
  const deliveredDelayedStatus = await requestJson(
    baseUrl,
    `/api/recognition-sessions/${delayedSessionId}/status?includeResult=1`,
  );
  assert.equal(deliveredDelayedStatus.body.resultDeliveryState, "delivered");
  assert.ok(deliveredDelayedStatus.body.result, "完整结果送达后必须支持断线回读");

  // 浏览器一次提交整份五页试卷；服务端必须让全部页面共享同一个多模态上下文。
  const documentRecognitionStart = mockRequests.length;
  const recognizedDocument = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: Array.from({ length: 5 }, (_, index) => ({
        pageIndex: 20 + index,
        width: 1_000,
        height: 800,
        imageDataUrl: tinyPng,
      })),
    }),
  });
  assert.equal(recognizedDocument.response.status, 200);
  assert.deepEqual(
    recognizedDocument.body.questions.map((question) => question.pageIndex),
    [20, 21, 22, 23, 24],
  );
  const documentRequests = mockRequests.slice(documentRecognitionStart);
  assert.equal(documentRequests.length, 1, "五页整卷只能产生一次主识别请求，不能在跨批边界截断题目");
  assert.deepEqual(
    readRequestedPageIndexes(documentRequests[0]),
    [20, 21, 22, 23, 24],
  );
  assert.equal(documentRequests[0].max_tokens, 40_960, "整卷输出额度必须随页面数提高，不能降低识别质量");
  assert.deepEqual(recognizedDocument.body.processedPageIndexes, [20, 21, 22, 23, 24]);
  assert.deepEqual(recognizedDocument.body.emptyPageIndexes, []);

  // 双页批次只返回一页时必须重试，不能把被遗漏的页面包装成空页成功结果。
  mockResponseMode = "missing-page-coverage";
  const missingPageCoverage = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [30, 31].map((pageIndex) => ({ pageIndex, width: 1_000, height: 800, imageDataUrl: tinyPng })),
    }),
  });
  assert.equal(missingPageCoverage.response.status, 200);
  assert.deepEqual(missingPageCoverage.body.processedPageIndexes, [30, 31]);
  assert.deepEqual(missingPageCoverage.body.questions.map((question) => question.pageIndex), [30, 31]);
  assert.deepEqual(missingPageCoverage.body.emptyPageIndexes, []);

  // 模型显式声明空页也必须复看原图并返回内容项，不能让普通资料页静默缺失。
  mockResponseMode = "explicit-empty-page";
  const explicitEmptyPage = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [32, 33].map((pageIndex) => ({ pageIndex, width: 1_000, height: 800, imageDataUrl: tinyPng })),
    }),
  });
  assert.equal(explicitEmptyPage.response.status, 200);
  assert.deepEqual(explicitEmptyPage.body.questions.map((question) => question.pageIndex), [32, 33]);
  assert.deepEqual(explicitEmptyPage.body.processedPageIndexes, [32, 33]);
  assert.deepEqual(explicitEmptyPage.body.emptyPageIndexes, []);

  // 页面处理元数据缺失、重复或越界时必须重试；成功结果最终完整覆盖输入页。
  for (const responseMode of [
    "missing-processed-page",
    "duplicate-processed-page",
    "duplicate-empty-page",
    "out-of-range-empty-page",
    "empty-without-declaration",
  ]) {
    mockResponseMode = responseMode;
    const invalidCoverage = await requestJson(baseUrl, "/api/recognize-pages", {
      method: "POST",
      body: JSON.stringify({
        pages: [60, 61].map((pageIndex) => ({ pageIndex, width: 1_000, height: 800, imageDataUrl: tinyPng })),
      }),
    });
    assert.equal(invalidCoverage.response.status, 200, `${responseMode} 不应阻断可恢复内容`);
    assert.deepEqual(invalidCoverage.body.processedPageIndexes, [60, 61]);
    assert.deepEqual(invalidCoverage.body.questions.map((question) => question.pageIndex), [60, 61]);
    assert.deepEqual(invalidCoverage.body.emptyPageIndexes, []);
  }

  // 无图题跨越两页时，sourcePageIndexes 是续页归属的唯一证据，完整声明后必须成功。
  mockResponseMode = "cross-page-question";
  const crossPageQuestion = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [34, 35].map((pageIndex) => ({ pageIndex, width: 1_000, height: 800, imageDataUrl: tinyPng })),
    }),
  });
  assert.equal(crossPageQuestion.response.status, 200);
  assert.equal(crossPageQuestion.body.questions.length, 1);
  assert.equal(crossPageQuestion.body.questions[0].pageIndex, 34);
  assert.deepEqual(crossPageQuestion.body.questions[0].figures, []);

  // 续页即使另有独立题，题图所在页也会被服务端并入该题 sourcePageIndexes，避免图题
  // 关联因模型漏写非内容字段而丢失。
  mockResponseMode = "cross-page-question-missing-continuation";
  const missingCrossPageContinuation = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [36, 37].map((pageIndex) => ({ pageIndex, width: 1_000, height: 800, imageDataUrl: tinyPng })),
    }),
  });
  assert.equal(missingCrossPageContinuation.response.status, 200);
  assert.deepEqual(missingCrossPageContinuation.body.questions[0].sourcePageIndexes, [36, 37]);

  mockResponseMode = "loose-latex-json";
  const repairedLatexResponse = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 25, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(repairedLatexResponse.response.status, 200);
  assert.equal(repairedLatexResponse.body.questions[0].stemMarkdown, String.raw`计算 \(\frac{a}{b}\)`);

  mockResponseMode = "loose-latex-valid-escapes";
  const repairedControlEscapeLatex = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 25, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(repairedControlEscapeLatex.response.status, 200);
  assert.equal(
    repairedControlEscapeLatex.body.questions[0].stemMarkdown,
    String.raw`\(\frac{a}{b} \begin{array} \right) \text{单位} \neq\)`,
  );

  mockResponseMode = "unsafe-deep-json";
  const unsafeDeepResponse = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 26, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(unsafeDeepResponse.response.status, 200, "结构深度异常应先用同模型结构纠错恢复");
  assert.equal(unsafeDeepResponse.body.questions.length, 1);

  // 首次仍把表格转成 Markdown 时，应自动复检表格边界并只保留裁切图形。
  const tableRecoveryStart = mockRequests.length;
  mockResponseMode = "markdown-table-recovery";
  const tableRecovered = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 3, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(tableRecovered.response.status, 200);
  assert.equal(mockRequests.length - tableRecoveryStart, 2, "Markdown 表格应触发一次边界复检");
  assert.equal(requestContainsText(mockRequests.at(-1), "这是表格纠错复检"), true);
  assert.doesNotMatch(tableRecovered.body.questions[0].stemMarkdown, /:---|\|\s*参与情况/);
  assert.equal(tableRecovered.body.questions[0].figures.length, 1);
  assert.equal(tableRecovered.body.questions[0].figures[0].kind, "table");
  assert.equal(tableRecovered.body.questions[0].figures[0].caption, "2×2列联表");

  // 复检结果即使来自同一页，只要 targetId 不匹配就不得挂到原题；耗尽后保留完整原页。
  const wrongTableTargetStart = mockRequests.length;
  mockResponseMode = "markdown-table-wrong-target";
  const wrongTableTarget = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 3, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(wrongTableTarget.response.status, 200);
  assert.equal(mockRequests.length - wrongTableTargetStart, 3);
  assert.equal(wrongTableTarget.body.questions[0].figures.some((figure) => figure.kind === "table"), false);
  assert.equal(hasFullPageFigure(wrongTableTarget.body.questions[0]), true);

  // 兼容部分视觉模型把表格单独放在 tables 字段中。
  mockResponseMode = "tables-field";
  const tableAlias = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 4, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(tableAlias.response.status, 200);
  assert.equal(tableAlias.body.questions[0].figures.length, 2);
  assert.equal(tableAlias.body.questions[0].figures.every((figure) => figure.kind === "table"), true);
  assert.doesNotMatch(tableAlias.body.questions[0].stemMarkdown, /:---/);

  // 两次复检都没有有效边界时，必须保留原始整页，不能让整卷失败或丢失表格。
  const unresolvedTableStart = mockRequests.length;
  mockResponseMode = "markdown-table-recovery-missing";
  const unresolvedTable = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 5, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(unresolvedTable.response.status, 200);
  assert.equal(mockRequests.length - unresolvedTableStart, 3);
  assert.equal(hasFullPageFigure(unresolvedTable.body.questions[0]), true);

  // 旧模型虽未返回 kind，但“图形选项”说明应触发类型推断和一次独立选项复检。
  const inferredVisualOptionsStart = mockRequests.length;
  mockResponseMode = "visual-options-inferred";
  const inferredVisualOptions = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 6, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(inferredVisualOptions.response.status, 200);
  assert.equal(mockRequests.length - inferredVisualOptionsStart, 2, "合并选项图应继续复检独立 A/B/C/D 边界");
  assert.deepEqual(inferredVisualOptions.body.questions[0].options, ["A.", "B.", "C.", "D."]);
  assert.equal(inferredVisualOptions.body.questions[0].figures.length, 4);
  assert.equal(inferredVisualOptions.body.questions[0].figures.every((figure) => figure.kind === "option"), true);

  // 只有空图片选项、没有独立题图时，自动复检四个视觉选项的独立边界。
  const visualOptionRecoveryStart = mockRequests.length;
  mockResponseMode = "visual-options-recovery";
  const recoveredVisualOptions = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 7, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(recoveredVisualOptions.response.status, 200);
  assert.equal(mockRequests.length - visualOptionRecoveryStart, 2);
  assert.equal(requestContainsText(mockRequests.at(-1), "这是图形选项纠错复检"), true);
  assert.deepEqual(recoveredVisualOptions.body.questions[0].options, ["A.", "B.", "C.", "D."]);
  assert.equal(recoveredVisualOptions.body.questions[0].figures.length, 4);
  assert.equal(recoveredVisualOptions.body.questions[0].figures.every((figure) => figure.kind === "option"), true);
  assert.deepEqual(recoveredVisualOptions.body.questions[0].figures.map((figure) => figure.optionLabel), ["A", "B", "C", "D"]);

  // 复检只拿到部分独立选项时，不采用残缺选项，改为保留完整原页。
  const partialVisualOptionsStart = mockRequests.length;
  mockResponseMode = "visual-options-partial-recovery";
  const partialVisualOptions = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 7, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(partialVisualOptions.response.status, 200);
  assert.equal(mockRequests.length - partialVisualOptionsStart, 3);
  assert.equal(hasFullPageFigure(partialVisualOptions.body.questions[0]), true);

  // 复检仍无边界时同样必须保留完整原页。
  const unresolvedVisualOptionsStart = mockRequests.length;
  mockResponseMode = "visual-options-recovery-missing";
  const unresolvedVisualOptions = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 8, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(unresolvedVisualOptions.response.status, 200);
  assert.equal(mockRequests.length - unresolvedVisualOptionsStart, 3);
  assert.equal(hasFullPageFigure(unresolvedVisualOptions.body.questions[0]), true);

  // 兼容视觉模型常见的包装 JSON、字段别名、缺失页码和像素坐标题图。
  mockResponseMode = "wrapped-compatibility";
  const compatible = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 7, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(compatible.response.status, 200);
  assert.equal(compatible.body.questions.length, 1);
  assert.equal(compatible.body.questions[0].id, "q-1");
  assert.equal(compatible.body.questions[0].number, "1");
  assert.equal(compatible.body.questions[0].pageIndex, 7);
  assert.equal(compatible.body.questions[0].stemMarkdown, "兼容题干");
  assert.deepEqual(compatible.body.questions[0].options, ["A. 甲", "B. 乙"]);
  assert.equal(compatible.body.questions[0].figures.length, 1);
  assert.deepEqual(compatible.body.questions[0].figures[0].bbox, {
    x: 0.1,
    y: 0.25,
    width: 0.3,
    height: 0.375,
  });

  // 模型提供的任一题目或题图非法时必须整批重识别，不能过滤坏项后返回部分成功。
  for (const responseMode of ["invalid-question", "invalid-figure"]) {
    const invalidItemStart = mockRequests.length;
    mockResponseMode = responseMode;
    const invalidItem = await requestJson(baseUrl, "/api/recognize-pages", {
      method: "POST",
      body: JSON.stringify({
        pages: [{ pageIndex: 7, width: 1_000, height: 800, imageDataUrl: tinyPng }],
      }),
    });
    assert.equal(invalidItem.response.status, 200);
    assert.equal(mockRequests.length - invalidItemStart, 2);
    assert.equal(invalidItem.body.questions.length, 1);
  }

  // 截断输出必须只重试当前批次，重试成功后直接交付。
  mockResponseMode = "truncated-completion";
  const truncated = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 8, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(truncated.response.status, 200);

  // 内容过滤等非完整终态即使正文恰好能解析，也不得采用该正文，应重试当前批次。
  mockResponseMode = "content-filter";
  const contentFiltered = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 8, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(contentFiltered.response.status, 200);

  // Chat Completions 正文合法但没有明确结束原因时，仍属于不可证明完整的截断响应。
  mockResponseMode = "missing-finish-reason";
  const missingFinishReason = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 8, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });

  // Chat Completions 响应必须从 choices 读取；顶层伪造 questions/content 不得绕过协议校验。
  mockResponseMode = "chat-completion-missing-choices";
  const missingChoices = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 8, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.deepEqual(
    [
      {
        case: "跨页题漏报续页",
        status: missingCrossPageContinuation.response.status,
        code: missingCrossPageContinuation.body.code,
      },
      {
        case: "缺少结束原因",
        status: missingFinishReason.response.status,
        code: missingFinishReason.body.code,
      },
      {
        case: "Chat Completions 缺少 choices",
        status: missingChoices.response.status,
        code: missingChoices.body.code,
      },
    ],
    [
      { case: "跨页题漏报续页", status: 200, code: undefined },
      { case: "缺少结束原因", status: 200, code: undefined },
      { case: "Chat Completions 缺少 choices", status: 200, code: undefined },
    ],
    "严格协议坏响应不得被采用，但当前批次重试成功后应正常交付",
  );

  // 部分兼容接口不支持 JSON 控制字段时，仍要保留输出额度。
  const retryStart = mockRequests.length;
  mockResponseMode = "reject-optional-json-controls";
  const retried = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 9, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(retried.response.status, 200);
  const retryRequests = mockRequests.slice(retryStart);
  assert.equal(retryRequests.length, 2, "不兼容 JSON 控制字段时应仅重试一次");
  assert.deepEqual(retryRequests[0].response_format, { type: "json_object" });
  assert.equal(retryRequests[0].max_tokens, 8192);
  assert.equal("response_format" in retryRequests[1], false);
  assert.equal(retryRequests[1].max_tokens, 8192);

  // 只是不支持输出额度时，JSON 模式同样应保留。
  const maxTokensRetryStart = mockRequests.length;
  mockResponseMode = "reject-max-tokens";
  const retriedWithoutMaxTokens = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 10, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(retriedWithoutMaxTokens.response.status, 200);
  const maxTokensRetryRequests = mockRequests.slice(maxTokensRetryStart);
  assert.equal(maxTokensRetryRequests.length, 2, "不兼容输出额度时应仅重试一次");
  assert.deepEqual(maxTokensRetryRequests[1].response_format, { type: "json_object" });
  assert.equal("max_tokens" in maxTokensRetryRequests[1], false);

  // 模型明确给出自身输出硬上限时，仍使用同一模型和整卷上下文，并取该模型允许的最大额度。
  const hardLimitRetryStart = mockRequests.length;
  mockResponseMode = "max-tokens-hard-limit";
  const retriedAtModelHardLimit = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [40, 41, 42, 43, 44]
        .map((pageIndex) => ({ pageIndex, width: 1_000, height: 800, imageDataUrl: tinyPng })),
    }),
  });
  assert.equal(retriedAtModelHardLimit.response.status, 200);
  const hardLimitRetryRequests = mockRequests.slice(hardLimitRetryStart);
  assert.equal(hardLimitRetryRequests.length, 2);
  assert.equal(hardLimitRetryRequests[0].max_tokens, 40_960);
  assert.equal(hardLimitRetryRequests[1].max_tokens, 16_384);
  assert.deepEqual(readRequestedPageIndexes(hardLimitRetryRequests[1]), [40, 41, 42, 43, 44]);

  // 某些兼容接口会把 JSON 拆成大量 content part，不应只取前 100 段。
  mockResponseMode = "fragmented-content";
  const fragmented = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 11, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(fragmented.response.status, 200);
  assert.equal(fragmented.body.questions.length, 1);

  // 传输型故障只按原图、原提示和原模型内部重放一次，不让浏览器拆页或重复计费。
  const upstreamRetryStart = mockRequests.length;
  mockResponseMode = "upstream-failure";
  const upstreamRecovered = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 12, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(upstreamRecovered.response.status, 200);
  assert.equal(mockRequests.length - upstreamRetryStart, 2);

  const timeoutRetryStart = mockRequests.length;
  mockResponseMode = "timeout";
  const timeoutRecovered = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 13, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  assert.equal(timeoutRecovered.response.status, 200);
  assert.equal(mockRequests.length - timeoutRetryStart, 2);

  const authFailureStart = mockRequests.length;
  mockResponseMode = "non-retryable-auth-failure";
  const authFailed = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 14, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  mockResponseMode = "standard";
  assert.equal(authFailed.response.status, 502);
  assert.equal(mockRequests.length - authFailureStart, 1, "401 配置错误不得无意义重放相同请求");

  for (const responseMode of ["non-retryable-conflict", "non-retryable-too-early"]) {
    const nonRetryableStart = mockRequests.length;
    mockResponseMode = responseMode;
    const nonRetryable = await requestJson(baseUrl, "/api/recognize-pages", {
      method: "POST",
      body: JSON.stringify({
        pages: [{ pageIndex: 14, width: 1_000, height: 800, imageDataUrl: tinyPng }],
      }),
    });
    mockResponseMode = "standard";
    assert.equal(nonRetryable.response.status, 502);
    assert.equal(mockRequests.length - nonRetryableStart, 1, `${responseMode} 不得重放`);
  }

  const persistentFailureStart = mockRequests.length;
  mockResponseMode = "persistent-upstream-failure";
  const upstreamFailed = await requestJson(baseUrl, "/api/recognize-pages", {
    method: "POST",
    body: JSON.stringify({
      pages: [{ pageIndex: 14, width: 1_000, height: 800, imageDataUrl: tinyPng }],
    }),
  });
  mockResponseMode = "standard";
  assert.equal(upstreamFailed.response.status, 502);
  assert.equal(upstreamFailed.body.code, "ai_recognition_upstream_failed");
  assert.equal(mockRequests.length - persistentFailureStart, 2, "可重试传输故障最多只允许两次相同请求");

  const crossOriginWithoutKey = await requestJson(baseUrl, "/api/admin/ai-settings", {
    method: "PUT",
    cookie,
    body: JSON.stringify({
      baseUrl: "http://127.0.0.1:6553/v1",
      apiKey: "",
      model: "other-model",
    }),
  });
  assert.equal(crossOriginWithoutKey.response.status, 422);

  await writeFile(settingsFile, "{损坏的配置", "utf8");
  const corruptPartialUpdate = await requestJson(baseUrl, "/api/admin/ai-settings", {
    method: "PUT",
    cookie,
    body: JSON.stringify({ model: "partial-model", apiKey: "" }),
  });
  assert.equal(corruptPartialUpdate.response.status, 422);

  const recovered = await requestJson(baseUrl, "/api/admin/ai-settings", {
    method: "PUT",
    cookie,
    body: JSON.stringify({
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: "replacement-test-key",
      model: "recovered-vision-model",
    }),
  });
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.body.configured, true);

  console.log("后端冒烟测试通过：登录、加密配置、视觉验证、整卷识别与恢复路径均可用。");
} catch (error) {
  console.error("后端冒烟测试失败。");
  if (appLogs) console.error(appLogs.trim());
  throw error;
} finally {
  if (appProcess && appProcess.exitCode === null) {
    appProcess.kill();
    await once(appProcess, "exit").catch(() => undefined);
  }
  if (mockServer) {
    await new Promise((resolve) => mockServer.close(resolve));
  }
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function createMockAiServer() {
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }

    const body = await readRequestBody(request);
    mockRequests.push(body);

    if (mockResponseMode === "delayed-session") {
      mockResponseMode = "standard";
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (mockResponseMode === "upstream-failure" || mockResponseMode === "persistent-upstream-failure") {
      if (mockResponseMode === "upstream-failure") mockResponseMode = "standard";
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "temporary upstream failure" } }));
      return;
    }

    if (mockResponseMode === "non-retryable-auth-failure") {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "invalid api key" } }));
      return;
    }

    if (mockResponseMode === "non-retryable-conflict" || mockResponseMode === "non-retryable-too-early") {
      const status = mockResponseMode === "non-retryable-conflict" ? 409 : 425;
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "request must not be replayed" } }));
      return;
    }

    if (mockResponseMode === "timeout") {
      mockResponseMode = "standard";
      return;
    }

    if (mockResponseMode === "reject-optional-json-controls" && "response_format" in body) {
      mockResponseMode = "standard";
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: { message: "response_format is not supported by this endpoint" },
      }));
      return;
    }

    if (mockResponseMode === "reject-max-tokens" && "max_tokens" in body) {
      mockResponseMode = "standard";
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: { message: "max_tokens is not supported by this endpoint" },
      }));
      return;
    }

    if (mockResponseMode === "max-tokens-hard-limit" && body.max_tokens > 16_384) {
      mockResponseMode = "standard";
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: { message: "max_tokens must be less than or equal to 16384" },
      }));
      return;
    }

    if (mockResponseMode === "truncated-completion") {
      mockResponseMode = "standard";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{
          finish_reason: "length",
          message: { content: "{\"questions\":[{\"id\":\"q-1\"" },
        }],
      }));
      return;
    }

    const pageIndexes = readRequestedPageIndexes(body);
    const pageIndex = pageIndexes[0] ?? 0;
    const responseMode = mockResponseMode;
    const rawContent = createMockCompletionContent(pageIndex, body, pageIndexes);
    const content = [
      "loose-latex-json",
      "loose-latex-valid-escapes",
      "unsafe-deep-json",
      "missing-page-coverage",
      "explicit-empty-page",
      "missing-processed-page",
      "duplicate-processed-page",
      "duplicate-empty-page",
      "out-of-range-empty-page",
      "empty-without-declaration",
    ].includes(responseMode)
      ? rawContent
      : addMockPageCoverage(rawContent, pageIndexes);

    response.writeHead(200, { "Content-Type": "application/json" });
    if (mockResponseMode === "fragmented-content") {
      mockResponseMode = "standard";
      const parts = Array.from(content, (text) => ({ type: "text", text }));
      response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: parts } }] }));
      return;
    }
    if (responseMode === "missing-finish-reason") {
      mockResponseMode = "standard";
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      return;
    }
    if (responseMode === "chat-completion-missing-choices") {
      mockResponseMode = "standard";
      const recognition = JSON.parse(content);
      response.end(JSON.stringify({
        id: "chatcmpl-missing-choices",
        object: "chat.completion",
        created: 1_700_000_000,
        model: "test-vision-model",
        questions: recognition.questions,
        content,
        processedPageIndexes: recognition.processedPageIndexes,
        emptyPageIndexes: recognition.emptyPageIndexes,
      }));
      return;
    }
    if (responseMode === "content-filter") mockResponseMode = "standard";
    response.end(JSON.stringify({
      choices: [{
        finish_reason: responseMode === "content-filter" ? "content_filter" : "stop",
        message: { content },
      }],
    }));
  });
}

function createMockCompletionContent(pageIndex, body, pageIndexes = [pageIndex]) {
  if (mockResponseMode === "loose-latex-json") {
    mockResponseMode = "standard";
    return String.raw`{"questions":[{"id":"q-latex","number":"25","pageIndex":${pageIndex},"stemMarkdown":"计算 \(\frac{a}{b}\)","options":[],"figures":[]}],"processedPageIndexes":[${pageIndex}],"emptyPageIndexes":[],"warnings":[]}`;
  }

  if (mockResponseMode === "loose-latex-valid-escapes") {
    mockResponseMode = "standard";
    return String.raw`{"questions":[{"id":"q-latex-controls","number":"25","pageIndex":${pageIndex},"stemMarkdown":"\frac{a}{b} \begin{array} \right) \text{单位} \neq","options":[],"figures":[]}],"processedPageIndexes":[${pageIndex}],"emptyPageIndexes":[],"warnings":[]}`;
  }

  if (mockResponseMode === "missing-page-coverage") {
    mockResponseMode = "standard";
    return JSON.stringify({
      questions: [{ id: "q-only-first", number: "1", pageIndex: pageIndexes[0], sourcePageIndexes: [pageIndexes[0]], stemMarkdown: "只返回第一页", options: [], figures: [] }],
      processedPageIndexes: pageIndexes,
      emptyPageIndexes: [],
      warnings: [],
    });
  }

  if (mockResponseMode === "explicit-empty-page") {
    mockResponseMode = "standard";
    return JSON.stringify({
      questions: [{ id: "q-only-first", number: "1", pageIndex: pageIndexes[0], sourcePageIndexes: [pageIndexes[0]], stemMarkdown: "第一页题目", options: [], figures: [] }],
      processedPageIndexes: pageIndexes,
      emptyPageIndexes: [pageIndexes[1]],
      warnings: [],
    });
  }

  if ([
    "missing-processed-page",
    "duplicate-processed-page",
    "duplicate-empty-page",
    "out-of-range-empty-page",
    "empty-without-declaration",
  ].includes(mockResponseMode)) {
    const responseMode = mockResponseMode;
    mockResponseMode = "standard";
    const questions = responseMode === "empty-without-declaration"
      ? []
      : [{
          id: "q-page-proof",
          number: "1",
          pageIndex: pageIndexes[0],
          sourcePageIndexes: [pageIndexes[0]],
          stemMarkdown: "页面证据对抗测试",
          options: [],
          figures: [],
        }];
    const processedPageIndexes = responseMode === "missing-processed-page"
      ? [pageIndexes[0]]
      : responseMode === "duplicate-processed-page"
        ? [pageIndexes[0], pageIndexes[0]]
        : pageIndexes;
    const emptyPageIndexes = responseMode === "duplicate-empty-page"
      ? [pageIndexes[1], pageIndexes[1]]
      : responseMode === "out-of-range-empty-page"
        ? [pageIndexes[1], 9_999]
        : responseMode === "empty-without-declaration"
          ? []
          : [pageIndexes[1]];
    return JSON.stringify({ questions, processedPageIndexes, emptyPageIndexes, warnings: [] });
  }

  if (mockResponseMode === "cross-page-question") {
    mockResponseMode = "standard";
    return JSON.stringify({
      questions: [{
        id: "q-cross-page",
        number: "1",
        pageIndex: pageIndexes[0],
        sourcePageIndexes: pageIndexes,
        stemMarkdown: "一道题的题干从第一页延续到第二页。",
        options: [],
        figures: [],
      }],
      warnings: [],
    });
  }

  if (mockResponseMode === "cross-page-question-missing-continuation") {
    mockResponseMode = "standard";
    return JSON.stringify({
      questions: [
        {
          id: "q-cross-page-incomplete",
          number: "1",
          pageIndex: pageIndexes[0],
          sourcePageIndexes: [pageIndexes[0]],
          stemMarkdown: "跨页题漏报了包含题图的续页。",
          options: [],
          figures: [{
            pageIndex: pageIndexes[1],
            kind: "diagram",
            bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
          }],
        },
        {
          id: "q-independent-on-continuation",
          number: "2",
          pageIndex: pageIndexes[1],
          sourcePageIndexes: [pageIndexes[1]],
          stemMarkdown: "续页上的另一道独立题。",
          options: [],
          figures: [],
        },
      ],
      warnings: [],
    });
  }

  if (mockResponseMode === "unsafe-deep-json") {
    mockResponseMode = "standard";
    let nested = { questions: [], warnings: [] };
    for (let depth = 0; depth < 40; depth += 1) nested = { nested };
    return JSON.stringify(nested);
  }

  if (mockResponseMode === "visual-options-recovery-missing") {
    const targetId = readRecoveryTargetIds(body)[0];
    if (targetId) mockResponseMode = "standard";
    return JSON.stringify(createVisualOptionPayload(pageIndex, [], targetId));
  }

  if (mockResponseMode === "visual-options-recovery") {
    if (requestContainsText(body, "这是图形选项纠错复检")) {
      mockResponseMode = "standard";
      return JSON.stringify(createVisualOptionPayload(pageIndex, ["A", "B", "C", "D"].map((label, index) => ({
        pageIndex,
        kind: "option",
        optionLabel: label,
        bbox: { x: 0.31 + (index % 2) * 0.23, y: 0.24 + Math.floor(index / 2) * 0.12, width: 0.18, height: 0.09 },
        caption: `${label}选项图`,
        confidence: 0.94,
      })), readRecoveryTargetIds(body)[0]));
    }
    return JSON.stringify(createVisualOptionPayload(pageIndex, []));
  }

  if (mockResponseMode === "visual-options-partial-recovery") {
    if (requestContainsText(body, "这是图形选项纠错复检")) {
      mockResponseMode = "standard";
      return JSON.stringify(createVisualOptionPayload(pageIndex, ["A", "B"].map((label, index) => ({
        pageIndex,
        kind: "option",
        optionLabel: label,
        bbox: { x: 0.31 + index * 0.23, y: 0.24, width: 0.18, height: 0.09 },
        caption: `${label}选项图`,
        confidence: 0.91,
      })), readRecoveryTargetIds(body)[0]));
    }
    return JSON.stringify(createVisualOptionPayload(pageIndex, [{
      pageIndex,
      kind: "option-group",
      bbox: { x: 0.31, y: 0.24, width: 0.45, height: 0.14 },
      caption: "图形选项（A-D）",
      confidence: 0.9,
    }]));
  }

  if (mockResponseMode === "visual-options-inferred") {
    if (requestContainsText(body, "这是图形选项纠错复检")) {
      mockResponseMode = "standard";
      return JSON.stringify(createVisualOptionPayload(pageIndex, ["A", "B", "C", "D"].map((label, index) => ({
        pageIndex,
        kind: "option",
        optionLabel: label,
        bbox: { x: 0.31 + (index % 2) * 0.23, y: 0.24 + Math.floor(index / 2) * 0.12, width: 0.18, height: 0.09 },
        caption: `${label}选项图`,
        confidence: 0.94,
      })), readRecoveryTargetIds(body)[0]));
    }
    return JSON.stringify(createVisualOptionPayload(pageIndex, [{
      pageIndex,
      bbox: { x: 0.31, y: 0.24, width: 0.45, height: 0.14 },
      caption: "四个图案选项",
      confidence: 0.9,
    }]));
  }

  if (mockResponseMode === "invalid-figure") {
    mockResponseMode = "standard";
    return JSON.stringify({
      questions: [{
        id: "q-invalid-figure",
        number: "1",
        pageIndex,
        stemMarkdown: "题图边界无效",
        options: [],
        figures: [{ pageIndex, bbox: { x: 0.9, y: 0.1, width: 0.3, height: 0.2 } }],
      }],
      warnings: [],
    });
  }

  if (mockResponseMode === "invalid-question") {
    mockResponseMode = "standard";
    return JSON.stringify({
      questions: [
        { id: "q-valid", number: "1", pageIndex, stemMarkdown: "合法题目", options: [], figures: [] },
        null,
      ],
      warnings: [],
    });
  }

  if (mockResponseMode === "markdown-table-wrong-target") {
    const targetId = readRecoveryTargetIds(body)[0];
    if (targetId) {
      mockResponseMode = "standard";
      return JSON.stringify({
        questions: [{
          id: "wrong-recovery-target",
          number: "999",
          pageIndex,
          stemMarkdown: "同页另一道题",
          options: [],
          figures: [{
            pageIndex,
            kind: "table",
            bbox: { x: 0.2, y: 0.2, width: 0.4, height: 0.3 },
          }],
        }],
        warnings: [],
      });
    }
    return JSON.stringify({
      questions: [{
        id: "q-1",
        number: "1",
        pageIndex,
        stemMarkdown: "表格如下：\n|甲|乙|\n|---|---|\n|1|2|",
        options: [],
        figures: [],
      }],
      warnings: [],
    });
  }

  if (mockResponseMode === "markdown-table-recovery-missing") {
    const targetId = readRecoveryTargetIds(body)[0];
    if (targetId) mockResponseMode = "standard";
    return JSON.stringify({
      questions: [{
        id: targetId || "q-15",
        number: "15",
        pageIndex,
        stemMarkdown: "列联表如下：\n| 参与情况 | 达标 |\n| --- | --- |\n| 参与 | 90 |",
        options: [],
        figures: [],
      }],
      warnings: [],
    });
  }

  if (mockResponseMode === "markdown-table-recovery") {
    if (requestContainsText(body, "这是表格纠错复检")) {
      mockResponseMode = "standard";
      return JSON.stringify({
        questions: [{
          id: readRecoveryTargetIds(body)[0] || "missing-target",
          number: "15",
          pageIndex,
          stemMarkdown: "列联表如下。",
          options: [],
          figures: [{
            pageIndex,
            kind: "table",
            bbox: { x: 0.28, y: 0.25, width: 0.38, height: 0.31 },
            caption: "2×2列联表",
            confidence: 0.96,
          }],
        }],
        warnings: [],
      });
    }
    return JSON.stringify({
      questions: [{
        id: "q-15",
        number: "15",
        pageIndex,
        stemMarkdown: "列联表如下：\n| 参与情况 | 达标 | 不达标 | 合计 |\n| :---: | :---: | :---: | :---: |\n| 参与 | 90 | | 100 |\n| 未参与 | | 10 | |\n| 合计 | | | 140 |",
        options: [],
        figures: [],
      }],
      warnings: [],
    });
  }

  if (mockResponseMode === "tables-field") {
    mockResponseMode = "standard";
    return JSON.stringify({
      questions: [{
        id: "q-15",
        number: "15",
        pageIndex,
        stemMarkdown: "查表可得：\n| α | 0.1 | 0.05 |\n| --- | --- | --- |\n| χα | 2.706 | 3.841 |",
        options: [],
        tables: [
          { pageIndex, bbox: { x: 0.28, y: 0.25, width: 0.38, height: 0.31 }, description: "2×2列联表" },
          { pageIndex, bbox: { x: 0.21, y: 0.73, width: 0.55, height: 0.15 }, description: "卡方临界值表" },
        ],
      }],
      warnings: [],
    });
  }

  if (mockResponseMode === "wrapped-compatibility") {
    mockResponseMode = "standard";
    const payload = {
      data: JSON.stringify({
        questions: [{
          question: "兼容题干",
          choices: { A: "A. 甲", B: "B. 乙" },
          images: [
            {
              boundingBox: { left: 100, top: 200, right: 400, bottom: 500 },
              description: "有效像素题图",
              score: "0.88",
            },
          ],
        }],
        warnings: ["模型未返回页码，已按单页请求补齐"],
      }),
    };
    return `模型结果：\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  }

  return JSON.stringify({
    questions: pageIndexes.map((requestedPageIndex, index) => ({
      id: `q-${requestedPageIndex}`,
      number: String(index + 1),
      pageIndex: requestedPageIndex,
      sourcePageIndexes: [requestedPageIndex],
      stemMarkdown: "示例题干",
      options: ["A. 示例选项"],
      figures: [{
        pageIndex: requestedPageIndex,
        bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        confidence: 0.9,
      }],
    })),
    warnings: [],
  });
}

function createVisualOptionPayload(pageIndex, figures, id = "q-visual-options") {
  const emptyFormulaImage = (label) => `${label}. ![](https://latex.codecogs.com/gif.latex?)`;
  return {
    questions: [{
      id,
      number: "1",
      pageIndex,
      stemMarkdown: "下列图案是中心对称图形的是（ ）",
      options: ["A", "B", "C", "D"].map(emptyFormulaImage),
      figures,
    }],
    warnings: [],
  };
}

function addMockPageCoverage(content, pageIndexes) {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(content);
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1]);
      injectMockPageCoverage(parsed, pageIndexes);
      return content.replace(fenced[1], JSON.stringify(parsed));
    } catch {
      return content;
    }
  }

  try {
    const parsed = JSON.parse(content);
    injectMockPageCoverage(parsed, pageIndexes);
    return JSON.stringify(parsed);
  } catch {
    return content;
  }
}

function injectMockPageCoverage(value, pageIndexes) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) injectMockPageCoverage(item, pageIndexes);
    return;
  }

  if (Array.isArray(value.questions)) {
    const contentPageIndexes = new Set();
    for (const question of value.questions) {
      if (!question || typeof question !== "object") continue;
      const questionPageIndex = Number.isInteger(question.pageIndex)
        ? question.pageIndex
        : pageIndexes.length === 1
          ? pageIndexes[0]
          : null;
      if (questionPageIndex !== null) contentPageIndexes.add(questionPageIndex);
      if (!Array.isArray(question.sourcePageIndexes) && questionPageIndex !== null) {
        question.sourcePageIndexes = [questionPageIndex];
      }
      if (Array.isArray(question.sourcePageIndexes)) {
        for (const sourcePageIndex of question.sourcePageIndexes) {
          if (Number.isInteger(sourcePageIndex)) contentPageIndexes.add(sourcePageIndex);
        }
      }
      const figureCollections = [question.figures, question.images, question.tables, question.optionFigures];
      for (const figures of figureCollections) {
        if (!Array.isArray(figures)) continue;
        for (const figure of figures) {
          const figurePageIndex = Number.isInteger(figure?.pageIndex) ? figure.pageIndex : questionPageIndex;
          if (figurePageIndex !== null) contentPageIndexes.add(figurePageIndex);
        }
      }
    }
    value.processedPageIndexes = [...pageIndexes];
    value.emptyPageIndexes = pageIndexes.filter((pageIndex) => !contentPageIndexes.has(pageIndex));
    return;
  }

  if (typeof value.questions === "string") {
    try {
      const parsedQuestions = JSON.parse(value.questions);
      const envelope = { questions: parsedQuestions };
      injectMockPageCoverage(envelope, pageIndexes);
      value.questions = JSON.stringify(envelope.questions);
      value.processedPageIndexes = envelope.processedPageIndexes;
      value.emptyPageIndexes = envelope.emptyPageIndexes;
    } catch {
      // 非法 questions 字符串留给服务端严格拒绝。
    }
    return;
  }

  for (const key of ["data", "result", "output", "response"]) {
    if (!(key in value)) continue;
    if (typeof value[key] === "string") {
      try {
        const parsed = JSON.parse(value[key]);
        injectMockPageCoverage(parsed, pageIndexes);
        value[key] = JSON.stringify(parsed);
      } catch {
        // 非 JSON 包装文本由服务端处理。
      }
    } else {
      injectMockPageCoverage(value[key], pageIndexes);
    }
  }
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function hasVisionPayload(body) {
  const content = body?.messages?.[0]?.content;
  return Array.isArray(content) && content.some((part) => part?.type === "image_url");
}

function requestContainsText(body, expected) {
  const content = body?.messages?.[0]?.content;
  return Array.isArray(content) && content.some((part) => part?.type === "text" && String(part.text || "").includes(expected));
}

function hasFullPageFigure(question) {
  return Array.isArray(question?.figures) && question.figures.some((figure) => (
    figure?.bbox?.x === 0
    && figure?.bbox?.y === 0
    && figure?.bbox?.width === 1
    && figure?.bbox?.height === 1
  ));
}

function readRecoveryTargetIds(body) {
  const content = body?.messages?.[0]?.content;
  if (!Array.isArray(content)) return [];
  const targetIds = [];
  for (const part of content) {
    if (part?.type !== "text") continue;
    for (const match of String(part.text || "").matchAll(/"targetId":"([^"]+)"/g)) {
      targetIds.push(match[1]);
    }
  }
  return targetIds;
}

function readRequestedPageIndexes(body) {
  const content = body?.messages?.[0]?.content;
  if (!Array.isArray(content)) return [];

  return content
    .map((part) => (part?.type === "text" ? part.text : ""))
    .filter((text) => typeof text === "string" && text.includes("紧随其后的图片"))
    .map((text) => text.match(/pageIndex=(\d+)/))
    .filter(Boolean)
    .map((match) => Number(match[1]));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("无法获取测试服务端口"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function getFreePort() {
  const placeholder = createServer();
  const port = await listen(placeholder);
  await new Promise((resolve) => placeholder.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`后端服务提前退出，退出码：${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // 服务仍在启动，继续轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("等待后端服务启动超时");
}

async function waitForSessionState(baseUrl, sessionId, expectedState) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snapshot = await requestJson(
      baseUrl,
      `/api/recognition-sessions/${sessionId}/status?includeResult=1`,
    );
    if (snapshot.body.state === expectedState) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`识别会话未在时限内进入 ${expectedState} 状态`);
}

async function requestJson(baseUrl, path, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}) };
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });
  return { response, body: await response.json() };
}

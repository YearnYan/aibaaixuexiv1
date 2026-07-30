import "dotenv/config";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  AiSettingsInputSchema,
  AiSettingsPatchSchema,
  AiSettingsStore,
  AiSettingsStoreError,
  mergeAiSettings,
  requiresNewApiKeyForBaseUrlChange,
  type AiSettingsInput,
} from "./aiSettings.js";
import {
  AiProxyError,
  RecognitionInputError,
  RecognitionPageSchema,
  RecognitionRequestSchema,
  recognizePageSequence,
  type RecognitionPage,
  verifyAiSettings,
} from "./aiProxy.js";
import {
  beginRecognitionResultDelivery,
  completeRecognitionResultDelivery,
  createRecognitionSession,
  recognitionSessionSnapshot,
  releaseRecognitionResultDelivery,
  requireRecognitionSession,
  startRecognitionSession,
  type RecognitionSession,
  validateRecognitionSessionId,
  writeRecognitionPage,
} from "./recognitionSessions.js";
import {
  assertDocxImportSessionReady,
  completeDocxImportSession,
  createDocxImportSession,
  docxImportSessionSnapshot,
  requireDocxImportSession,
  validateDocxImportSessionId,
  writeDocxImportFile,
} from "./docxImportSessions.js";
import { createRateLimit } from "./rateLimit.js";
import { exportQuestionsToDocx } from "./wordExport.js";

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "1");
const port = getPort();
const administrator = getAdministratorCredentials();
const platformAiSettings = getPlatformAiSettings();
const aiSettingsStore = platformAiSettings
  ? {
      async read() { return platformAiSettings; },
      async getSummary() {
        return {
          configured: true,
          baseUrl: platformAiSettings.baseUrl,
          model: platformAiSettings.model,
          hasApiKey: true,
        };
      },
      async save() { return this.getSummary(); },
      async markVerifiedIfCurrent() { return this.getSummary(); },
    }
  : administrator ? new AiSettingsStore(administrator.password) : null;
const shouldServeStaticFiles = process.env.NODE_ENV === "production"
  || existsSync(resolve(process.cwd(), "dist", "index.html"));
const isProduction = process.env.NODE_ENV === "production";

const LoginSchema = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(4096),
}).strict();

const adminRateLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 60,
  message: "管理操作过于频繁，请稍后再试。",
});

const loginRateLimit = createRateLimit({
  windowMs: 15 * 60_000,
  maxRequests: 5,
  message: "登录尝试过于频繁，请稍后再试。",
});

const businessRateLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 20,
  message: "请求过于频繁，请稍后再试。",
});

// 一份试卷通常会拆为多页依次识别，独立提高该接口额度，避免 20 页后被本地限流中断。
const recognitionRateLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 120,
  message: "识别请求过于频繁，请稍后再试。",
});

// 单次计费 POST 必须在常见网关空闲超时前返回；后台识别继续由会话 Promise 承载。
// 浏览器收到 session_processing 后会复用同一幂等键重新接入，同一会话不会重复调用 AI。
const recognitionCompletionWaitMs = getRecognitionCompletionWaitMs();
// DOCX 只用于服务端核验页数，不能用 80MB 这种固定小上限阻断大资料上传。
const docxImportBodyLimit = getDocxImportBodyLimit();

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  if (request.path.startsWith("/api/")) {
    response.setHeader("Cache-Control", "no-store");
  }
  next();
});

// 生产识别使用渐进 NDJSON，不进入 JSON 缓冲；JSON 仅保留给旧客户端和本地测试。
app.use("/api/recognize-pages", express.json({ limit: Number.MAX_SAFE_INTEGER, type: "application/json" }));
// 会话页单独解析：每个请求只携带一页，避免整卷 JSON 在平台代理和 Express 中聚合。
app.use("/api/recognition-sessions", express.json({ limit: Number.MAX_SAFE_INTEGER }));
// 备用服务端 Word 导出也可能携带大量页面图片，不能沿用普通接口的 30MB 上限。
app.use("/api/export-docx", express.json({ limit: "512mb" }));
app.use(express.json({ limit: "30mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    aiMode: "independent",
  });
});

app.post("/api/admin/login", adminRateLimit, loginRateLimit, (request, response) => {
  const credentials = LoginSchema.safeParse(request.body);
  if (!credentials.success) {
    response.status(400).json({ message: "登录信息格式不正确。" });
    return;
  }
  if (!administrator) {
    response.status(503).json({ message: "管理员服务尚未完成环境配置。" });
    return;
  }

  const usernameMatches = securelyMatches(administrator.username, credentials.data.username);
  const passwordMatches = securelyMatches(administrator.password, credentials.data.password);
  if (!usernameMatches || !passwordMatches) {
    response.status(401).json({ message: "用户名或密码错误。" });
    return;
  }

  const session = sessions.create();
  response.cookie(SESSION_COOKIE_NAME, session.token, sessionCookieOptions());
  response.json({ authenticated: true });
});

app.get("/api/admin/session", adminRateLimit, (request, response) => {
  response.json({ authenticated: Boolean(getActiveSession(request)) });
});

app.post("/api/admin/logout", adminRateLimit, (request, response) => {
  const token = readCookie(request, SESSION_COOKIE_NAME);
  if (token) sessions.delete(token);
  response.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
  response.status(204).end();
});

app.get("/api/admin/ai-settings", adminRateLimit, requireAdministrator, async (_request, response) => {
  const store = getAiSettingsStore(response);
  if (!store) return;

  try {
    response.json(await store.getSummary());
  } catch {
    response.status(500).json({ message: "无法读取 AI 配置，请重新保存配置。" });
  }
});

app.put("/api/admin/ai-settings", adminRateLimit, requireAdministrator, async (request, response) => {
  const patch = parseAiSettingsPatch(request.body, response, true);
  if (!patch) return;

  const store = getAiSettingsStore(response);
  if (!store) return;

  const completeSettings = AiSettingsInputSchema.safeParse(patch);
  let settings: AiSettingsInput;

  if (completeSettings.success) {
    // 完整配置无需读取旧文件，管理员密码变更或旧文件损坏后仍可直接覆盖恢复。
    settings = completeSettings.data;
  } else {
    let saved: AiSettingsInput | null;

    try {
      saved = await store.read();
    } catch (error) {
      if (error instanceof AiSettingsStoreError) {
        response.status(422).json({
          message: "现有 AI 配置无法读取。请同时填写新的接口地址、模型和 API 密钥后重新保存，以覆盖恢复配置。",
        });
        return;
      }

      response.status(500).json({ message: "无法读取 AI 配置，请稍后重试。" });
      return;
    }

    if (requiresNewApiKeyForBaseUrlChange(saved, patch)) {
      response.status(422).json({ message: "接口主机已变更，请填写新的 API 密钥，不能复用旧密钥。" });
      return;
    }

    const mergedSettings = mergeAiSettings(saved, patch);
    if (!mergedSettings) {
      response.status(422).json({ message: "请完整填写 AI 接口地址、模型和密钥。" });
      return;
    }
    settings = mergedSettings;
  }

  try {
    response.json(await store.save(settings));
  } catch (error) {
    if (error instanceof AiSettingsStoreError) {
      response.status(500).json({ message: "无法保存 AI 配置，请检查本地配置文件权限。" });
      return;
    }
    response.status(500).json({ message: "无法保存 AI 配置，请稍后重试。" });
  }
});

app.post("/api/admin/ai-settings/verify", adminRateLimit, requireAdministrator, async (request, response) => {
  const patch = parseAiSettingsPatch(request.body, response, true);
  if (!patch) return;

  const store = getAiSettingsStore(response);
  if (!store) return;

  try {
    const saved = await store.read();
    if (requiresNewApiKeyForBaseUrlChange(saved, patch)) {
      response.status(422).json({ message: "接口主机已变更，请填写新的 API 密钥，不能复用旧密钥。" });
      return;
    }

    const settings = mergeAiSettings(saved, patch);
    if (!settings) {
      response.status(422).json({ message: "请完整填写 AI 接口地址、模型和密钥后再验证。" });
      return;
    }

    await verifyAiSettings(settings);
    const verifiedSettings = await store.markVerifiedIfCurrent(settings);
    response.json({
      ok: true,
      message: verifiedSettings
        ? "AI 接口验证成功。"
        : "AI 接口验证成功，但配置已在验证期间更新，未修改当前配置的验证状态。",
      ...(verifiedSettings ?? await store.getSummary()),
    });
  } catch (error) {
    if (error instanceof AiSettingsStoreError) {
      response.status(500).json({ message: "无法读取 AI 配置，请重新保存配置。" });
      return;
    }
    response.status(502).json({ message: "AI 接口连接验证失败，请检查配置后重试。" });
  }
});

type RecognitionInput = {
  expectedPageCount: number;
  pages: Iterable<RecognitionPage> | AsyncIterable<RecognitionPage>;
};

async function createRecognitionInput(request: Request): Promise<RecognitionInput> {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("application/x-ndjson")) {
    return createNdjsonRecognitionInput(request);
  }

  const input = RecognitionRequestSchema.safeParse(request.body);
  if (!input.success) {
    throw new RecognitionInputError("识别请求格式不正确或页面数据损坏。");
  }
  return {
    expectedPageCount: input.data.pages.length,
    pages: input.data.pages,
  };
}

async function createNdjsonRecognitionInput(request: Request): Promise<RecognitionInput> {
  const lines = readNdjsonLines(request)[Symbol.asyncIterator]();
  const first = await lines.next();
  const start = parseNdjsonEvent(first.value);
  if (first.done
    || !isRecord(start)
    || start.type !== "start"
    || !Number.isSafeInteger(start.pageCount)
    || Number(start.pageCount) < 1) {
    throw new RecognitionInputError("渐进识别请求缺少有效的 start 事件。");
  }
  const expectedPageCount = Number(start.pageCount);

  async function* pageStream(): AsyncGenerator<RecognitionPage> {
    let receivedPageCount = 0;
    let ended = false;
    while (true) {
      const next = await lines.next();
      if (next.done) break;
      const event = parseNdjsonEvent(next.value);
      if (!isRecord(event)) throw new RecognitionInputError("渐进识别事件格式不正确。");
      if (event.type === "end") {
        if (ended) throw new RecognitionInputError("渐进识别请求包含重复的 end 事件。");
        ended = true;
        continue;
      }
      if (ended || event.type !== "page") {
        throw new RecognitionInputError("渐进识别请求包含无效事件或 end 之后仍有页面。");
      }
      const parsedPage = RecognitionPageSchema.safeParse(event.page);
      if (!parsedPage.success) {
        throw new RecognitionInputError(`第 ${receivedPageCount + 1} 页图片格式不正确或已损坏。`);
      }
      receivedPageCount += 1;
      yield parsedPage.data;
    }
    if (!ended) throw new RecognitionInputError("渐进识别请求未正常结束。");
    if (receivedPageCount !== expectedPageCount) {
      throw new RecognitionInputError(`声明 ${expectedPageCount} 页，实际收到 ${receivedPageCount} 页。`);
    }
  }

  return { expectedPageCount, pages: pageStream() };
}

async function* readNdjsonLines(request: Request): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of request) {
    pending += decoder.decode(chunk as Uint8Array, { stream: true });
    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = pending.slice(0, newlineIndex).trim();
      pending = pending.slice(newlineIndex + 1);
      if (line) yield line;
      newlineIndex = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  if (pending.trim()) yield pending.trim();
}

function parseNdjsonEvent(line: string | undefined) {
  if (!line) return null;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new RecognitionInputError("渐进识别请求包含无效 JSON 行。");
  }
}

app.post("/api/recognize-pages", recognitionRateLimit, async (request, response) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const requestController = new AbortController();
  const abortRecognition = () => {
    if (!requestController.signal.aborted) {
      requestController.abort(new Error("识别请求的客户端连接已断开"));
    }
  };
  const handleResponseClose = () => {
    if (!response.writableEnded) abortRecognition();
  };
  request.once("aborted", abortRecognition);
  response.once("close", handleResponseClose);
  if (request.aborted) abortRecognition();

  try {
    const input = await createRecognitionInput(request);
    const store = aiSettingsStore;
    if (!store) {
      response.status(503).json({ message: "识别服务暂时不可用，请稍后重试。" });
      return;
    }
    const settings = await store.read();
    if (!settings) {
      response.status(503).json({ message: "识别服务暂时不可用，请稍后重试。" });
      return;
    }

    const result = await recognizePageSequence(
      settings,
      input.pages,
      input.expectedPageCount,
      { signal: requestController.signal },
    );
    console.info(JSON.stringify({
      event: "word_recognition_completed",
      requestId,
      pages: result.processedPageIndexes,
      questionCount: result.questions.length,
      elapsedMs: Date.now() - startedAt,
    }));
    response.json(result);
  } catch (error) {
    if (requestController.signal.aborted || response.destroyed || response.writableEnded) return;
    const failureKind = error instanceof AiProxyError ? error.kind : "unknown";
    console.warn(JSON.stringify({
      event: "word_recognition_failed",
      requestId,
      failureKind,
      elapsedMs: Date.now() - startedAt,
    }));
    if (error instanceof RecognitionInputError) {
      response.status(400).json({
        code: "invalid_recognition_input",
        message: error.message,
      });
      return;
    }
    if (error instanceof AiSettingsStoreError) {
      response.status(503).json({ message: "识别服务暂时不可用，请稍后重试。" });
      return;
    }
    if (error instanceof AiProxyError && error.kind === "invalid-response") {
      response.status(502).json({
        code: "invalid_ai_response",
        message: "AI 返回的识别结构无法解析，本次未采用任何残缺内容。",
      });
      return;
    }
    if (error instanceof AiProxyError && error.kind === "truncated-response") {
      response.status(502).json({
        code: "ai_output_truncated",
        message: "AI 识别输出被截断，本次未采用任何残缺内容。",
      });
      return;
    }
    if (error instanceof AiProxyError && error.kind === "timeout") {
      response.status(504).json({
        code: "ai_recognition_timeout",
        message: "整份试卷识别超时，请重新点击智能识别。",
      });
      return;
    }
    response.status(502).json({
      code: "ai_recognition_upstream_failed",
      message: "整份试卷识别请求未完成，请重新点击智能识别。",
    });
  } finally {
    request.off("aborted", abortRecognition);
    response.off("close", handleResponseClose);
  }
});

const RecognitionSessionInitSchema = z.object({
  sessionId: z.string().trim().min(16).max(128),
  pageCount: z.number().int().safe().min(1),
}).strict();

const RecognitionSessionCompleteSchema = z.object({
  pageCount: z.number().int().safe().min(1),
  sourcePageCount: z.number().int().safe().min(1),
  docxImportSessionId: z.string().trim().min(16).max(128).optional(),
}).strict();

const DocxImportSessionInitSchema = z.object({
  sessionId: z.string().trim().min(16).max(128),
  fileCount: z.number().int().safe().min(1).max(100),
}).strict();

const DocxImportSessionCompleteSchema = z.object({
  pageCount: z.number().int().safe().min(1),
}).strict();

app.post("/api/docx-import-sessions", businessRateLimit, (request, response) => {
  const parsed = DocxImportSessionInitSchema.safeParse(request.body);
  if (!parsed.success || !validateDocxImportSessionId(parsed.data?.sessionId)) {
    response.status(400).json({ code: "invalid_docx_session_input", message: "Word 导入会话参数不正确。" });
    return;
  }
  try {
    const session = createDocxImportSession(
      parsed.data.sessionId,
      parsed.data.fileCount,
      recognitionSessionOwner(request),
    );
    response.status(201).json(docxImportSessionSnapshot(session));
  } catch (error) {
    sendRecognitionSessionError(response, error);
  }
});

app.put(
  "/api/docx-import-sessions/:sessionId/files/:fileIndex",
  express.raw({ limit: docxImportBodyLimit, type: () => true }),
  async (request, response) => {
    const sessionId = String(request.params.sessionId || "");
    const fileIndex = Number(request.params.fileIndex);
    if (!validateDocxImportSessionId(sessionId) || !Number.isSafeInteger(fileIndex)) {
      response.status(400).json({ code: "invalid_docx_file_input", message: "Word 文件参数不正确。" });
      return;
    }
    try {
      const session = requireDocxImportSession(sessionId, recognitionSessionOwner(request));
      const content = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      await writeDocxImportFile(session, fileIndex, content);
      response.json(docxImportSessionSnapshot(session));
    } catch (error) {
      sendRecognitionSessionError(response, error);
    }
  },
);

app.get("/api/docx-import-sessions/:sessionId/status", (request, response) => {
  const sessionId = String(request.params.sessionId || "");
  if (!validateDocxImportSessionId(sessionId)) {
    response.status(400).json({ code: "invalid_docx_session_id", message: "Word 导入会话编号不正确。" });
    return;
  }
  try {
    const session = requireDocxImportSession(sessionId, recognitionSessionOwner(request));
    response.json(docxImportSessionSnapshot(session));
  } catch (error) {
    sendRecognitionSessionError(response, error);
  }
});

app.post("/api/docx-import-sessions/:sessionId/complete", businessRateLimit, (request, response) => {
  const sessionId = String(request.params.sessionId || "");
  const completion = DocxImportSessionCompleteSchema.safeParse(request.body);
  if (!validateDocxImportSessionId(sessionId) || !completion.success) {
    response.status(400).json({ code: "invalid_docx_completion", message: "Word 导入完成参数不正确。" });
    return;
  }
  try {
    const session = requireDocxImportSession(sessionId, recognitionSessionOwner(request));
    const consumerId = `docx:${sessionId}`;
    assertDocxImportSessionReady(session, completion.data.pageCount, consumerId);
    completeDocxImportSession(session, consumerId);
    response.json({ ok: true, ...docxImportSessionSnapshot(session) });
  } catch (error) {
    sendRecognitionSessionError(response, error);
  }
});

app.post("/api/recognition-sessions", businessRateLimit, async (request, response) => {
  const parsed = RecognitionSessionInitSchema.safeParse(request.body);
  if (!parsed.success || !validateRecognitionSessionId(parsed.data?.sessionId)) {
    response.status(400).json({ code: "invalid_session_input", message: "识别会话参数不正确。" });
    return;
  }
  try {
    const session = await createRecognitionSession(
      parsed.data.sessionId,
      parsed.data.pageCount,
      recognitionSessionOwner(request),
    );
    response.status(201).json(recognitionSessionSnapshot(session));
  } catch (error) {
    sendRecognitionSessionError(response, error);
  }
});

app.put("/api/recognition-sessions/:sessionId/pages/:pageIndex", async (request, response) => {
  const sessionId = String(request.params.sessionId || "");
  const pageIndex = Number(request.params.pageIndex);
  if (!validateRecognitionSessionId(sessionId) || !Number.isSafeInteger(pageIndex)) {
    response.status(400).json({ code: "invalid_page_input", message: "识别页面参数不正确。" });
    return;
  }
  const parsed = RecognitionPageSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ code: "invalid_page_input", message: `第 ${pageIndex + 1} 页图片格式不正确或已损坏。` });
    return;
  }
  try {
    const session = requireRecognitionSession(sessionId, recognitionSessionOwner(request));
    await writeRecognitionPage(session, pageIndex, parsed.data);
    response.json(recognitionSessionSnapshot(session));
  } catch (error) {
    sendRecognitionSessionError(response, error);
  }
});

app.get("/api/recognition-sessions/:sessionId/status", async (request, response) => {
  const sessionId = String(request.params.sessionId || "");
  if (!validateRecognitionSessionId(sessionId)) {
    response.status(400).json({ code: "invalid_session_id", message: "识别会话编号不正确。" });
    return;
  }
  try {
    const session = requireRecognitionSession(sessionId, recognitionSessionOwner(request));
    response.json(recognitionSessionSnapshot(session, request.query.includeResult === "1"));
  } catch (error) {
    sendRecognitionSessionError(response, error);
  }
});

app.post("/api/recognition-sessions/:sessionId/complete", recognitionRateLimit, async (request, response) => {
  const sessionId = String(request.params.sessionId || "");
  if (!validateRecognitionSessionId(sessionId)) {
    response.status(400).json({ code: "invalid_session_id", message: "识别会话编号不正确。" });
    return;
  }
  const completion = RecognitionSessionCompleteSchema.safeParse(request.body);
  if (!completion.success) {
    response.status(400).json({ code: "invalid_page_count", message: "本次上传资料页数不正确，请重新上传。" });
    return;
  }
  let session;
  let docxSession;
  try {
    session = requireRecognitionSession(sessionId, recognitionSessionOwner(request));
    if (completion.data.pageCount !== session.pageCount) {
      response.status(409).json({ code: "session_page_count_mismatch", message: "上传资料页数与识别会话不一致，请重新上传。" });
      return;
    }
    if (completion.data.sourcePageCount < session.pageCount) {
      response.status(409).json({ code: "source_page_count_mismatch", message: "全部上传资料页数与识别会话不一致，请重新上传。" });
      return;
    }
    const docxPageCount = completion.data.sourcePageCount - session.pageCount;
    if (docxPageCount > 0) {
      const docxSessionId = completion.data.docxImportSessionId;
      if (!docxSessionId || !validateDocxImportSessionId(docxSessionId)) {
        response.status(409).json({ code: "docx_session_required", message: "缺少 Word 导入会话，请重新上传全部资料。" });
        return;
      }
      docxSession = requireDocxImportSession(docxSessionId, recognitionSessionOwner(request));
      assertDocxImportSessionReady(docxSession, docxPageCount, `recognition:${sessionId}`);
    } else if (completion.data.docxImportSessionId) {
      response.status(409).json({ code: "unexpected_docx_session", message: "上传资料页数与 Word 导入会话不一致，请重新上传。" });
      return;
    }
    if (session.result) {
      sendRecognitionSessionResult(response, session, session.result);
      return;
    }
    const store = aiSettingsStore;
    if (!store) {
      response.status(503).json({ code: "recognition_unavailable", message: "识别服务暂时不可用，请稍后重试。" });
      return;
    }
    const settings = await store.read();
    if (!settings) {
      response.status(503).json({ code: "recognition_unavailable", message: "识别服务暂时不可用，请稍后重试。" });
      return;
    }
    const processing = startRecognitionSession(session, (pages, pageCount, onProgress, checkpoint) => (
      recognizePageSequence(settings, pages, pageCount, {
        onProgress: (progress) => onProgress(progress.current, progress.total),
        checkpoint,
      })
    ));
    const outcome = await waitForRecognitionCompletion(processing, recognitionCompletionWaitMs);
    if (outcome.state === "processing") {
      response.setHeader("X-Platform-Usage-Pending", "1");
      response.status(409).json({
        code: "session_processing",
        message: "识别仍在后台进行，客户端将自动继续等待。",
        progress: recognitionSessionSnapshot(session).progress,
      });
      return;
    }
    if (outcome.state === "failed") throw outcome.error;
    const result = outcome.result;
    if (docxSession) completeDocxImportSession(docxSession, `recognition:${sessionId}`);
    sendRecognitionSessionResult(response, session, result);
  } catch (error) {
    if (session?.result && !response.headersSent && !response.writableEnded) {
      sendRecognitionSessionResult(response, session, session.result);
      return;
    }
    if (response.headersSent || response.writableEnded) return;
    sendRecognitionError(response, error);
  }
});

app.post("/api/export-docx", businessRateLimit, async (request, response) => {
  try {
    const buffer = await exportQuestionsToDocx(request.body);
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    response.setHeader("Content-Disposition", encodeRFC5987("attachment; filename*=UTF-8''", "资料重排.docx"));
    response.send(buffer);
  } catch {
    response.status(422).json({ message: "Word 导出失败，请检查资料内容后重试。" });
  }
});

mountProductionStaticFiles(app);

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (response.headersSent) return;
  const status = getRequestErrorStatus(error);
  response.status(status).json({
    message: status === 413 ? "请求数据超过允许范围。" : "请求数据格式不正确。",
  });
});

const bindHost = process.env.BIND_HOST || process.env.HOST || "127.0.0.1";

const httpServer = app.listen(port, bindHost, () => {
  console.log(`题目重排本地服务已启动：http://127.0.0.1:${port}`);
});
// 会话完成请求只传会话 ID，长时间识别不应被 Node 默认请求时限截断。
httpServer.requestTimeout = 0;
httpServer.headersTimeout = 24 * 60 * 60 * 1_000;

const SESSION_COOKIE_NAME = "question_word_admin_session";
const SESSION_TTL_MS = 8 * 60 * 60_000;

type AdministratorCredentials = {
  username: string;
  password: string;
};

type AdminSession = {
  token: string;
  expiresAt: number;
};

class SessionStore {
  private readonly sessions = new Map<string, AdminSession>();

  create() {
    this.removeExpired();
    const token = randomBytes(32).toString("base64url");
    const session = { token, expiresAt: Date.now() + SESSION_TTL_MS };
    this.sessions.set(token, session);
    return session;
  }

  get(token: string) {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  delete(token: string) {
    this.sessions.delete(token);
  }

  private removeExpired() {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }
  }
}

const sessions = new SessionStore();

function getAdministratorCredentials(): AdministratorCredentials | null {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return null;
  return { username, password };
}

function getPlatformAiSettings(): AiSettingsInput | null {
  if (process.env.PLATFORM_AI_PROXY !== "1") return null;
  const baseUrl = process.env.PLATFORM_AI_BASE_URL?.trim();
  const apiKey = process.env.PLATFORM_AI_API_KEY?.trim();
  const model = process.env.PLATFORM_AI_MODEL?.trim() || "platform-managed";
  if (!baseUrl || !apiKey) return null;
  const parsed = AiSettingsInputSchema.safeParse({ baseUrl, apiKey, model });
  return parsed.success ? parsed.data : null;
}

function getAiSettingsStore(response: Response) {
  if (aiSettingsStore) return aiSettingsStore;
  response.status(503).json({ message: "管理员服务尚未完成环境配置。" });
  return null;
}

function parseAiSettingsPatch(body: unknown, response: Response, preserveBlankApiKey: boolean) {
  const normalizedBody = normalizeAiSettingsPatchBody(body, preserveBlankApiKey);
  const parsed = AiSettingsPatchSchema.safeParse(normalizedBody);
  if (!parsed.success) {
    response.status(400).json({ message: "AI 配置格式不正确。" });
    return null;
  }
  return parsed.data;
}

function normalizeAiSettingsPatchBody(body: unknown, preserveBlankApiKey: boolean) {
  if (body === undefined || body === null) return {};
  if (!isRecord(body)) return body;
  if (!preserveBlankApiKey || body.apiKey !== "") return body;

  const { apiKey: _apiKey, ...patch } = body;
  return patch;
}

function requireAdministrator(request: Request, response: Response, next: NextFunction) {
  if (!getActiveSession(request)) {
    response.status(401).json({ message: "请先登录管理员账号。" });
    return;
  }
  next();
}

function getActiveSession(request: Request) {
  const token = readCookie(request, SESSION_COOKIE_NAME);
  return token ? sessions.get(token) : null;
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: isProduction,
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function securelyMatches(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function mountProductionStaticFiles(server: express.Express) {
  if (!shouldServeStaticFiles) return;

  const distDirectory = resolve(process.cwd(), "dist");
  const indexFile = join(distDirectory, "index.html");
  const adminFile = join(distDirectory, "admin.html");
  if (!existsSync(indexFile)) return;

  server.use(express.static(distDirectory, { index: false }));
  server.get("/admin/ai-settings", (_request, response) => {
    response.sendFile(existsSync(adminFile) ? adminFile : indexFile);
  });
  server.get("*", (request, response, next) => {
    if (request.path.startsWith("/api/") || extname(request.path) || !request.accepts("html")) {
      next();
      return;
    }
    response.sendFile(indexFile);
  });
}

function getPort() {
  const value = Number(process.env.PORT ?? 8791);
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : 8791;
}

function getRecognitionCompletionWaitMs() {
  const configured = Number(process.env.RECOGNITION_COMPLETION_WAIT_MS);
  const minimum = process.env.NODE_ENV === "test" ? 10 : 5_000;
  return Number.isFinite(configured) && configured >= minimum && configured <= 240_000
    ? Math.floor(configured)
    : 170_000;
}

function getDocxImportBodyLimit() {
  const configured = Number(process.env.DOCX_IMPORT_MAX_BYTES);
  if (Number.isSafeInteger(configured) && configured >= 10 * 1024 * 1024) {
    return configured;
  }
  return 512 * 1024 * 1024;
}

async function waitForRecognitionCompletion<T>(processing: Promise<T>, waitMs: number): Promise<
  | { state: "completed"; result: T }
  | { state: "failed"; error: unknown }
  | { state: "processing" }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ state: "processing" }>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout({ state: "processing" }), waitMs);
  });
  const settled = processing.then(
    (result) => ({ state: "completed" as const, result }),
    (error) => ({ state: "failed" as const, error }),
  );
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sendRecognitionSessionResult(
  response: Response,
  session: RecognitionSession,
  result: unknown,
) {
  if (response.headersSent || response.writableEnded) return;
  const delivery = beginRecognitionResultDelivery(session);
  if (delivery === "delivered") {
    response.setHeader("X-Platform-Usage-Final", "1");
    response.status(409).json({
      code: "session_completed",
      message: "识别结果已经成功送达，请读取已有结果。",
    });
    return;
  }
  if (delivery === "delivering") {
    response.setHeader("X-Platform-Usage-Pending", "1");
    response.status(409).json({
      code: "session_result_delivering",
      message: "识别结果正在返回，客户端将自动继续等待。",
    });
    return;
  }
  if (delivery !== "acquired") {
    response.setHeader("X-Platform-Usage-Pending", "1");
    response.status(409).json({ code: "session_result_unavailable", message: "识别结果尚未准备完成。" });
    return;
  }

  let finished = false;
  const handleFinish = () => {
    finished = true;
    response.off("close", handleClose);
    completeRecognitionResultDelivery(session);
  };
  const handleClose = () => {
    if (!finished) releaseRecognitionResultDelivery(session);
  };
  response.once("finish", handleFinish);
  response.once("close", handleClose);
  response.json(result);
}

function getRequestErrorStatus(error: unknown) {
  if (!isRecord(error) || typeof error.status !== "number") return 400;
  return error.status === 413 || error.type === "entity.too.large" ? 413 : 400;
}

function recognitionSessionOwner(request: Request) {
  const platformUserId = request.headers["x-platform-user-id"];
  if (typeof platformUserId === "string" && platformUserId.trim()) return `user:${platformUserId.trim()}`;
  return `direct:${request.ip || request.socket.remoteAddress || "local"}`;
}

function sendRecognitionSessionError(response: Response, error: unknown) {
  const status = isRecord(error) && typeof error.status === "number" ? error.status : 400;
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "recognition_session_error";
  const message = error instanceof Error ? error.message : "识别会话请求失败，请重试。";
  response.status(status).json({ code, message });
}

function sendRecognitionError(response: Response, error: unknown) {
  if (error instanceof RecognitionInputError) {
    response.status(400).json({ code: "invalid_recognition_input", message: error.message });
    return;
  }
  if (error instanceof AiSettingsStoreError) {
    response.status(503).json({ code: "recognition_unavailable", message: "识别服务暂时不可用，请稍后重试。" });
    return;
  }
  if (error instanceof AiProxyError && error.kind === "invalid-response") {
    response.status(502).json({ code: "invalid_ai_response", message: "AI 返回的识别结构无法解析，本次未采用任何残缺内容。" });
    return;
  }
  if (error instanceof AiProxyError && error.kind === "truncated-response") {
    response.status(502).json({ code: "ai_output_truncated", message: "AI 识别输出被截断，本次未采用任何残缺内容。" });
    return;
  }
  if (error instanceof AiProxyError && error.kind === "timeout") {
    response.status(504).json({ code: "ai_recognition_timeout", message: "整份试卷识别超时，请重新接入识别会话。" });
    return;
  }
  response.status(502).json({ code: "ai_recognition_upstream_failed", message: "整份试卷识别请求未完成，请重新接入识别会话。" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function encodeRFC5987(prefix: string, fileName: string) {
  return prefix + encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, "%2A");
}

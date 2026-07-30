import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import {
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB
} from "./src/constants.js";
import {
  generateTeachingFigureSvg,
  generateWithAI
} from "./src/ai.js";
import {
  MAX_TEACHING_FIGURES,
  createFigureVisualSignature,
  finalizeSvg,
  isSemanticallyRelevantSvg,
  normalizeFigurePayload
} from "./src/figures.js";
import { buildAttachmentHeader } from "./src/export/common.js";
import { createDocxReport } from "./src/export/docx.js";
import { createPdfReport } from "./src/export/pdf.js";
import { extractFile } from "./src/files.js";
import { createMaterialTemplate } from "./src/material.js";
import { cleanText, isAllowedFile, normalizeUploadFilename, validateOptions } from "./src/utils.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const GENERATION_JOB_TTL_MS = 10 * 60 * 1_000;
const FIGURE_RENDER_SESSION_TTL_MS = 30 * 60 * 1_000;
const FIGURE_BATCH_CONCURRENCY = 5;
const FIGURE_RENDER_CONCURRENCY = 5;
const FIGURE_DIFFERENTIATION_ATTEMPTS = 3;
const FIGURE_RENDER_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000];
const FIGURE_RENDER_POLL_MS = 1_200;
const FIGURE_RENDER_ATTEMPT_TIMEOUT_MS = 135_000;

function createFigureServiceError(message, code = "FIGURE_RENDER_FAILED", status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function createRenderVersion(svg) {
  return createHash("sha256").update(String(svg || "")).digest("hex").slice(0, 24);
}

function finalizeRenderedFigure(svg, figure) {
  const finalized = finalizeSvg(svg, { validateDocument: true });
  if (finalized && isSemanticallyRelevantSvg(finalized, figure)) {
    return { svg: finalized, source: "ai" };
  }
  throw createFigureServiceError(
    "图形未通过安全、学科语义或视觉质量校验",
    "FIGURE_QUALITY_REVIEW_FAILED"
  );
}

function assertTeachingFiguresReadyForExport(material) {
  const figures = Array.isArray(material?.teachingFigures) ? material.teachingFigures : [];
  const allReady = figures.length > 0 && figures.every((figure) => (
    figure?.renderStatus === "ready"
    && Boolean(figure?.svg)
    && isSemanticallyRelevantSvg(figure.svg, figure)
  ));
  if (allReady) return;
  const error = new Error("教学图形尚未全部完成，请等待页面中的图形完成后再下载完整报告");
  error.code = "EXPORT_INVALID_MATERIAL";
  throw error;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function generateMaterialWithRecovery(createMaterial, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await createMaterial();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await wait(700 * (attempt + 1));
    }
  }
  throw lastError || new Error("AI 生成任务未完成");
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function normalizeTaskId(value, prefix) {
  const candidate = String(value || "").trim();
  return /^[a-z0-9][a-z0-9._:-]{7,159}$/iu.test(candidate)
    ? candidate
    : `${prefix}-${randomUUID()}`;
}
const envPath = path.join(currentDirectory, ".env");
if (process.env.NODE_ENV !== "test" && existsSync(envPath) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envPath);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_FILES,
    fileSize: MAX_FILE_SIZE
  },
  fileFilter(request, file, callback) {
    file.originalname = normalizeUploadFilename(file.originalname);
    if (isAllowedFile(file)) {
      callback(null, true);
      return;
    }
    const error = new Error(`不支持文件“${file.originalname}”，请上传图片、PDF 或 Word。`);
    error.code = "UNSUPPORTED_FILE";
    callback(error);
  }
});

export function createApp({
  aiGenerator = generateWithAI,
  aiConfigured = () => Boolean(process.env.AI_API_KEY?.trim()),
  figureRenderer = generateTeachingFigureSvg,
  figureRenderConcurrency = FIGURE_RENDER_CONCURRENCY,
  figureRenderRetryDelays = FIGURE_RENDER_RETRY_DELAYS_MS,
  figureRenderAttemptTimeoutMs = FIGURE_RENDER_ATTEMPT_TIMEOUT_MS,
  pdfExporter = createPdfReport,
  docxExporter = createDocxReport
} = {}) {
  const app = express();
  const generationJobs = new Map();
  const teachingFigureCache = new Map();
  const teachingFigureInFlight = new Map();
  const renderSessions = new Map();
  const renderConcurrency = Math.max(1, Math.min(
    FIGURE_RENDER_CONCURRENCY,
    Number.parseInt(figureRenderConcurrency, 10) || FIGURE_RENDER_CONCURRENCY
  ));
  const renderRetryDelays = Array.isArray(figureRenderRetryDelays) && figureRenderRetryDelays.length
    ? figureRenderRetryDelays.map((delay) => Math.max(0, Number(delay) || 0))
    : FIGURE_RENDER_RETRY_DELAYS_MS;
  const renderAttemptTimeoutMs = Math.max(
    25,
    Number(figureRenderAttemptTimeoutMs) || FIGURE_RENDER_ATTEMPT_TIMEOUT_MS
  );

  function getOrCreateGenerationJob(id, createMaterial) {
    const current = generationJobs.get(id);
    if (current) return current;
    const promise = generateMaterialWithRecovery(createMaterial);
    const job = { promise, createdAt: Date.now() };
    generationJobs.set(id, job);
    promise.then(() => {
      const timer = setTimeout(() => {
        if (generationJobs.get(id) === job) generationJobs.delete(id);
      }, GENERATION_JOB_TTL_MS);
      timer.unref?.();
    }, () => {
      if (generationJobs.get(id) === job) generationJobs.delete(id);
    });
    return job;
  }

  function scheduleRenderSessionCleanup(id, session) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = setTimeout(() => {
      const current = renderSessions.get(id);
      if (current !== session) return;
      const unfinished = current.activeJobCount > 0 || [...current.jobs.values()].some((job) => (
        !["ready", "error"].includes(job.status)
      ));
      if (unfinished && Date.now() - current.clientSeenAt < FIGURE_RENDER_SESSION_TTL_MS) {
        scheduleRenderSessionCleanup(id, current);
        return;
      }
      current.closed = true;
      clearTimeout(current.schedulerTimer);
      current.jobs.forEach((job) => job.abortController?.abort());
      renderSessions.delete(id);
    }, FIGURE_RENDER_SESSION_TTL_MS);
    session.cleanupTimer.unref?.();
  }

  function touchRenderSession(id, session) {
    session.clientSeenAt = Date.now();
    scheduleRenderSessionCleanup(id, session);
  }

  function getRenderSession(rawId) {
    const id = normalizeTaskId(rawId, "figures");
    let session = renderSessions.get(id);
    if (!session) {
      session = {
        completed: new Map(),
        inFlight: new Map(),
        signatures: new Map(),
        variationAttempts: new Map(),
        jobs: new Map(),
        activeJobCount: 0,
        queueSequence: 0,
        schedulerTimer: null,
        cleanupTimer: null,
        closed: false,
        lock: Promise.resolve(),
        clientSeenAt: Date.now()
      };
      renderSessions.set(id, session);
    }
    touchRenderSession(id, session);
    return { id, session };
  }

  async function withRenderSessionLock(session, operation) {
    const previous = session.lock;
    let release;
    session.lock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return operation();
    } finally {
      release();
    }
  }

  function normalizeFigureRequestItem(item = {}) {
    const description = cleanText(item?.description || [
      item?.title,
      item?.purpose,
      item?.stem,
      item?.caption,
      ...(Array.isArray(item?.constraints) ? item.constraints : [])
    ].filter(Boolean).join("；"), 2_000);
    return { ...item, description };
  }

  async function renderValidatedFigure(figure, { bypassCache = false, signal } = {}) {
    if (!bypassCache && teachingFigureCache.has(figure.cacheKey)) {
      return { svg: teachingFigureCache.get(figure.cacheKey), source: "cache" };
    }

    const render = async () => finalizeRenderedFigure(
      await figureRenderer(figure, { signal }),
      figure
    );

    if (bypassCache) return render();

    let inFlight = teachingFigureInFlight.get(figure.cacheKey);
    if (!inFlight) {
      inFlight = render();
      teachingFigureInFlight.set(figure.cacheKey, inFlight);
    }

    try {
      return await inFlight;
    } finally {
      if (teachingFigureInFlight.get(figure.cacheKey) === inFlight) {
        teachingFigureInFlight.delete(figure.cacheKey);
      }
    }
  }

  function buildDifferentiatedFigure(item, conflictingId, variationAttempt) {
    return normalizeFigurePayload({
      ...item,
      description: `${item?.description || ""} 当前图属于 ${item?.params?.placementRef || item?.id || "独立栏目"}，不得复用 ${conflictingId} 的主体构图。第 ${variationAttempt} 次差异化精绘必须重新选择信息分组、阅读方向、核心对象位置和图元关系。`,
      params: {
        ...(item?.params || {}),
        distinctFrom: conflictingId,
        variationAttempt
      },
      constraints: [
        ...(Array.isArray(item?.constraints) ? item.constraints : []),
        `主体构图不得与 ${conflictingId} 相同，不能只改标题、文字、颜色或局部装饰`,
        `第 ${variationAttempt} 次重绘必须改变节点数量、空间分组或阅读方向中的至少两项`
      ]
    });
  }

  async function renderFigureAtomically(item = {}, session) {
    item = normalizeFigureRequestItem(item);
    const figure = normalizeFigurePayload(item);
    if (!figure.description) {
      throw createFigureServiceError("缺少图形描述", "FIGURE_DESCRIPTION_REQUIRED", 400);
    }

    const figureId = String(item?.id || figure.cacheKey);
    const taskKey = `${figureId}:${figure.cacheKey}`;
    const completed = session.completed.get(taskKey);
    if (completed) return { ...completed, cached: true, source: "cache" };

    const activeTask = session.inFlight.get(taskKey);
    if (activeTask) return activeTask;

    const task = (async () => {
      let candidate = await renderValidatedFigure(figure);
      let conflictingId = "";

      for (let conflictAttempt = 0; conflictAttempt <= FIGURE_DIFFERENTIATION_ATTEMPTS; conflictAttempt += 1) {
        const claim = await withRenderSessionLock(session, () => {
          const existing = session.completed.get(taskKey);
          if (existing) return { result: { ...existing, cached: true, source: "cache" } };
          const signature = createFigureVisualSignature(candidate.svg);
          const conflict = session.signatures.get(signature);
          if (conflict && conflict !== figureId) return { conflict, signature };

          const result = {
            id: item?.id,
            svg: candidate.svg,
            renderVersion: createRenderVersion(candidate.svg),
            visualSignature: signature,
            cached: candidate.source === "cache",
            renderStatus: "ready",
            source: candidate.source,
            redrawnForDifference: conflictAttempt > 0
          };
          session.signatures.set(signature, figureId);
          session.completed.set(taskKey, result);
          teachingFigureCache.set(figure.cacheKey, candidate.svg);
          return { result };
        });

        if (claim.result) return claim.result;
        conflictingId = claim.conflict;
        if (conflictAttempt === FIGURE_DIFFERENTIATION_ATTEMPTS) break;

        const previousAttempt = session.variationAttempts.get(taskKey) || 0;
        const variationAttempt = previousAttempt + 1;
        session.variationAttempts.set(taskKey, variationAttempt);
        const differentiatedFigure = buildDifferentiatedFigure(item, conflictingId, variationAttempt);
        candidate = await renderValidatedFigure(differentiatedFigure, { bypassCache: true });
      }

      throw createFigureServiceError(
        `图形主体与 ${conflictingId || "同一资料中的其他图形"} 重复，需要继续差异化精绘`,
        "FIGURE_DUPLICATE_RETRY_REQUIRED"
      );
    })();

    session.inFlight.set(taskKey, task);
    try {
      return await task;
    } finally {
      if (session.inFlight.get(taskKey) === task) session.inFlight.delete(taskKey);
    }
  }

  function assertCurrentFigureExecution(job, executionId, signal) {
    if (signal?.aborted || job.executionId !== executionId) {
      throw createFigureServiceError(
        "图形执行结果已过期",
        "FIGURE_RENDER_ATTEMPT_STALE"
      );
    }
  }

  async function renderFigureJobQuantum(job, session, { signal, executionId }) {
    const item = job.item;
    const figure = normalizeFigurePayload(item);
    const completed = session.completed.get(job.taskKey);
    if (completed && !job.forceFresh) return { ...completed, cached: true, source: "cache" };

    let candidateFigure = figure;
    let bypassCache = job.forceFresh;
    let redrawnForDifference = false;
    if (job.conflictingId) {
      const previousAttempt = session.variationAttempts.get(job.taskKey) || 0;
      const variationAttempt = previousAttempt + 1;
      session.variationAttempts.set(job.taskKey, variationAttempt);
      candidateFigure = buildDifferentiatedFigure(item, job.conflictingId, variationAttempt);
      bypassCache = true;
      redrawnForDifference = true;
    }

    const candidate = await renderValidatedFigure(candidateFigure, { bypassCache, signal });
    assertCurrentFigureExecution(job, executionId, signal);

    const claim = await withRenderSessionLock(session, () => {
      assertCurrentFigureExecution(job, executionId, signal);
      const existing = session.completed.get(job.taskKey);
      if (existing && !job.forceFresh) {
        return { result: { ...existing, cached: true, source: "cache" } };
      }
      const visualSignature = createFigureVisualSignature(candidate.svg);
      const conflict = session.signatures.get(visualSignature);
      if (conflict && conflict !== job.figureId) return { conflict, visualSignature };

      const result = {
        id: job.id,
        svg: candidate.svg,
        renderVersion: createRenderVersion(candidate.svg),
        visualSignature,
        cached: candidate.source === "cache",
        renderStatus: "ready",
        source: candidate.source,
        redrawnForDifference
      };
      session.signatures.set(visualSignature, job.figureId);
      session.completed.set(job.taskKey, result);
      teachingFigureCache.set(figure.cacheKey, candidate.svg);
      return { result };
    });

    if (claim.result) {
      job.conflictingId = "";
      job.forceFresh = false;
      return claim.result;
    }

    job.conflictingId = claim.conflict;
    throw createFigureServiceError(
      `图形主体与 ${claim.conflict} 重复，需要继续差异化精绘`,
      "FIGURE_DUPLICATE_RETRY_REQUIRED"
    );
  }

  function runFigureJobAttempt(job, session) {
    const executionId = job.executionId + 1;
    job.executionId = executionId;
    const controller = new AbortController();
    job.abortController = controller;
    let timeout;
    const watchdog = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        const error = createFigureServiceError(
          "单次图形候选执行超过看门狗时限",
          "FIGURE_RENDER_ATTEMPT_TIMEOUT"
        );
        controller.abort(error);
        reject(error);
      }, renderAttemptTimeoutMs);
    });
    timeout.unref?.();
    const operation = renderFigureJobQuantum(job, session, {
      signal: controller.signal,
      executionId
    });
    return Promise.race([operation, watchdog]).finally(() => {
      clearTimeout(timeout);
      if (job.abortController === controller) job.abortController = null;
    });
  }

  function getFigureTaskIdentity(item = {}) {
    const normalizedItem = normalizeFigureRequestItem(item);
    const figure = normalizeFigurePayload(normalizedItem);
    if (!figure.description) {
      throw createFigureServiceError("缺少图形描述", "FIGURE_DESCRIPTION_REQUIRED", 400);
    }
    const figureId = String(item?.id || figure.cacheKey);
    return {
      figure,
      figureId,
      taskKey: `${figureId}:${figure.cacheKey}`
    };
  }

  function createRenderJob(item, session) {
    item = normalizeFigureRequestItem(item);
    const identity = getFigureTaskIdentity(item);
    let job = session.jobs.get(identity.taskKey);
    if (job) {
      const rejectedVersion = String(item?.rejectedRenderVersion || "").trim();
      if (
        rejectedVersion
        && job.status === "ready"
        && job.result?.renderVersion === rejectedVersion
      ) {
        const visualSignature = job.result.visualSignature;
        if (visualSignature && session.signatures.get(visualSignature) === job.figureId) {
          session.signatures.delete(visualSignature);
        }
        session.completed.delete(job.taskKey);
        job.result = null;
        job.status = "queued";
        job.code = "FIGURE_CLIENT_REJECTED_RETRY";
        job.retryable = true;
        job.forceFresh = true;
        job.conflictingId = "";
        job.clientRejectionCount += 1;
        job.nextAttemptAt = Date.now();
        job.queueOrder = session.queueSequence;
        session.queueSequence += 1;
      }
      if (job.status === "error") {
        job.status = "queued";
        job.code = "FIGURE_RENDER_RETRY_REQUIRED";
        job.retryable = true;
        job.forceFresh = true;
        job.nextAttemptAt = Date.now();
        job.queueOrder = session.queueSequence;
        session.queueSequence += 1;
      }
      return job;
    }
    job = {
      taskKey: identity.taskKey,
      item,
      id: item?.id,
      figureId: identity.figureId,
      status: "queued",
      attempt: 0,
      nextAttemptAt: Date.now(),
      queueOrder: session.queueSequence,
      retryable: true,
      code: "FIGURE_RENDER_QUEUED",
      result: null,
      runPromise: null,
      abortController: null,
      executionId: 0,
      forceFresh: false,
      conflictingId: "",
      clientRejectionCount: 0
    };
    session.queueSequence += 1;
    session.jobs.set(identity.taskKey, job);
    return job;
  }

  function getRenderJobPollAfter(job) {
    if (job.status === "ready" || job.status === "error") return 0;
    if (job.status === "retrying") {
      return Math.max(300, Math.min(10_000, job.nextAttemptAt - Date.now()));
    }
    return FIGURE_RENDER_POLL_MS;
  }

  function serializeRenderJob(job) {
    if (job.status === "ready") {
      return {
        ...job.result,
        attempt: job.attempt,
        pollAfterMs: 0,
        retryable: false
      };
    }
    return {
      id: job.id,
      renderStatus: job.status,
      attempt: job.attempt,
      pollAfterMs: getRenderJobPollAfter(job),
      retryable: job.retryable,
      code: job.code,
      source: "ai"
    };
  }

  function scheduleRenderSession(session) {
    if (session.closed) return;
    clearTimeout(session.schedulerTimer);
    session.schedulerTimer = null;
    const now = Date.now();
    const dueJobs = [...session.jobs.values()]
      .filter((job) => (
        !job.runPromise
        && ["queued", "retrying"].includes(job.status)
        && job.nextAttemptAt <= now
      ))
      .sort((left, right) => left.queueOrder - right.queueOrder);

    while (session.activeJobCount < renderConcurrency && dueJobs.length) {
      const job = dueJobs.shift();
      job.status = "running";
      job.attempt += 1;
      job.code = "FIGURE_RENDER_RUNNING";
      session.activeJobCount += 1;

      job.runPromise = Promise.resolve()
        .then(() => runFigureJobAttempt(job, session))
        .then((result) => {
          job.result = result;
          job.status = "ready";
          job.code = "FIGURE_RENDER_READY";
          job.retryable = false;
        })
        .catch((error) => {
          if (error?.code === "FIGURE_RENDER_ATTEMPT_TIMEOUT") {
            job.forceFresh = true;
          }
          if (Number(error?.status) === 400) {
            job.status = "error";
            job.code = error?.code || "FIGURE_RENDER_INVALID";
            job.retryable = false;
            return;
          }
          const retryDelay = renderRetryDelays[Math.min(job.attempt - 1, renderRetryDelays.length - 1)];
          job.status = "retrying";
          job.code = error?.code || "FIGURE_RENDER_RETRY_REQUIRED";
          job.retryable = true;
          job.nextAttemptAt = Date.now() + retryDelay;
          job.queueOrder = session.queueSequence;
          session.queueSequence += 1;
        })
        .finally(() => {
          job.runPromise = null;
          session.activeJobCount -= 1;
          if (!session.closed) scheduleRenderSession(session);
        });
    }

    if (session.activeJobCount >= renderConcurrency) return;
    const nextJob = [...session.jobs.values()]
      .filter((job) => !job.runPromise && ["queued", "retrying"].includes(job.status))
      .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt || left.queueOrder - right.queueOrder)[0];
    if (!nextJob) return;
    const delay = Math.max(0, nextJob.nextAttemptAt - Date.now());
    session.schedulerTimer = setTimeout(() => scheduleRenderSession(session), delay);
    session.schedulerTimer.unref?.();
  }

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use("/vendor/katex", express.static(path.join(currentDirectory, "node_modules", "katex", "dist"), {
    fallthrough: false,
    immutable: true,
    maxAge: "1y"
  }));

  app.get("/api/health", (request, response) => {
    response.json({
      ok: true,
      aiConfigured: aiConfigured(),
      maxFileSizeMb: MAX_FILE_SIZE_MB,
      maxFiles: MAX_FILES
    });
  });

  app.post(
    "/api/generate",
    (request, response, next) => {
      if (!aiConfigured()) {
        response.status(503).json({
          error: "AI 服务尚未配置，请联系管理员完成配置。",
          code: "AI_NOT_CONFIGURED"
        });
        return;
      }
      next();
    },
    upload.array("files", MAX_FILES),
    async (request, response) => {
      const manualText = cleanText(request.body.manualText, 12_000);
      const uploadedFiles = request.files || [];
      if (!uploadedFiles.length && manualText.length < 2) {
        response.status(400).json({
          error: "请上传教材文件，或至少输入 2 个字的知识点。",
          code: "INPUT_REQUIRED"
        });
        return;
      }

      const options = validateOptions(request.body);
      const sources = [];
      const warnings = [];

      if (manualText.length >= 2) {
        sources.push({
          name: "手动输入的知识点",
          kind: "text",
          size: Buffer.byteLength(manualText, "utf8"),
          text: manualText,
          images: [],
          warnings: []
        });
      } else {
        for (const file of uploadedFiles) {
          try {
            const source = await extractFile(file);
            sources.push(source);
            warnings.push(...source.warnings.map((warning) => `${source.name}：${warning}`));
          } catch (error) {
            warnings.push(`${file.originalname}：解析失败，${error.message}`);
          }
        }
      }

      if (!sources.length) {
        response.status(422).json({
          error: "上传文件均未能解析，请检查文件是否损坏或加密。",
          code: "EXTRACTION_FAILED"
        });
        return;
      }

      const defaults = createMaterialTemplate({ sources, options });
      const generationId = normalizeTaskId(request.get("X-Generation-Id"), "material");
      try {
        const job = getOrCreateGenerationJob(
          generationId,
          () => aiGenerator({ sources, options, defaults })
        );
        const material = await job.promise;
        response.set("X-Generation-Id", generationId);
        response.json({ warnings, material, generationId });
      } catch (error) {
        console.error(`[generation:${generationId}]`, error);
        response.status(502).json({
          error: "生成服务刚刚出现波动，系统已自动恢复但仍未完成。请保持输入不变后再次生成。",
          code: "AI_GENERATION_FAILED",
          generationId
        });
      }
    }
  );

  app.post("/api/render/figure", (request, response) => {
    const renderSession = getRenderSession(request.get("X-Render-Id"));
    response.set("X-Render-Id", renderSession.id);
    try {
      const job = createRenderJob(request.body || {}, renderSession.session);
      scheduleRenderSession(renderSession.session);
      const status = job.status === "ready" ? 200 : job.status === "error" ? 400 : 202;
      response.status(status).json(serializeRenderJob(job));
    } catch (error) {
      const invalidRequest = Number(error?.status) === 400;
      response.status(invalidRequest ? 400 : 500).json({
        error: invalidRequest ? error.message : `图形任务创建失败：${error.message}`,
        code: error?.code || "FIGURE_RENDER_RETRY_REQUIRED",
        renderStatus: "error",
        retryable: !invalidRequest
      });
    }
  });

  app.post("/api/render/figures-batch", async (request, response) => {
    const renderSession = getRenderSession(request.get("X-Render-Id"));
    response.set("X-Render-Id", renderSession.id);
    try {
      const figures = Array.isArray(request.body?.figures)
        ? request.body.figures.slice(0, MAX_TEACHING_FIGURES)
        : [];
      if (!figures.length) {
        response.status(400).json({ error: "figures 必须是非空数组", code: "FIGURES_REQUIRED" });
        return;
      }
      const results = await mapWithConcurrency(
        figures,
        FIGURE_BATCH_CONCURRENCY,
        async (item) => {
          try {
            return await renderFigureAtomically(item || {}, renderSession.session);
          } catch (error) {
            return {
              id: item?.id,
              svg: null,
              cached: false,
              renderStatus: "retrying",
              source: "ai",
              code: error?.code || "FIGURE_RENDER_RETRY_REQUIRED"
            };
          }
        }
      );
      response.json({ results });
    } catch (error) {
      response.status(500).json({ error: `批量图形渲染失败：${error.message}`, code: "FIGURE_BATCH_RENDER_FAILED" });
    }
  });

  app.post("/api/export/pdf", async (request, response) => {
    try {
      assertTeachingFiguresReadyForExport(request.body?.material);
      const baseUrl = `http://127.0.0.1:${request.socket.localPort}`;
      const pdf = await pdfExporter({ material: request.body?.material, baseUrl });
      response.set({
        "Cache-Control": "no-store",
        "Content-Disposition": buildAttachmentHeader(request.body.material.meta.title, "pdf"),
        "Content-Length": pdf.length,
        "Content-Type": "application/pdf"
      });
      response.send(pdf);
    } catch (error) {
      const invalidMaterial = error.code === "EXPORT_INVALID_MATERIAL";
      response.status(invalidMaterial ? 400 : 500).json({
        error: invalidMaterial ? error.message : `PDF 生成失败：${error.message}`,
        code: invalidMaterial ? "EXPORT_INVALID_MATERIAL" : "EXPORT_FAILED"
      });
    }
  });

  app.post("/api/export/docx", async (request, response) => {
    try {
      assertTeachingFiguresReadyForExport(request.body?.material);
      const document = await docxExporter({ material: request.body?.material });
      response.set({
        "Cache-Control": "no-store",
        "Content-Disposition": buildAttachmentHeader(request.body.material.meta.title, "docx"),
        "Content-Length": document.length,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      });
      response.send(document);
    } catch (error) {
      const invalidMaterial = error.code === "EXPORT_INVALID_MATERIAL";
      response.status(invalidMaterial ? 400 : 500).json({
        error: invalidMaterial ? error.message : `Word 生成失败：${error.message}`,
        code: invalidMaterial ? "EXPORT_INVALID_MATERIAL" : "EXPORT_FAILED"
      });
    }
  });

  app.use(express.static(path.join(currentDirectory, "public"), {
    extensions: ["html"]
  }));

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: `单个文件不能超过 ${MAX_FILE_SIZE_MB} MB。`,
        LIMIT_FILE_COUNT: `一次最多上传 ${MAX_FILES} 个文件。`,
        LIMIT_UNEXPECTED_FILE: "上传的文件字段不正确。"
      };
      response.status(400).json({
        error: messages[error.code] || "文件上传失败，请检查文件后重试。",
        code: error.code || "UPLOAD_ERROR"
      });
      return;
    }

    response.status(400).json({
      error: error.message || "请求处理失败，请稍后重试。",
      code: error.code || "REQUEST_ERROR"
    });
  });

  return app;
}

const app = createApp();

export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 5174;
  app.listen(port, "127.0.0.1", () => {
    console.log(`学习资料生成器已启动：http://127.0.0.1:${port}`);
  });
}

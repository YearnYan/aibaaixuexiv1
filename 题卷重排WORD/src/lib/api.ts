import type { BBox, QuestionItem, RecognitionResult, UploadedPage } from "../types";
import {
  extractOptionLabel,
  normalizeOptionLabel,
  restoreVisualOptionLabels,
} from "../../shared/optionText";
import { stripMarkdownTableBlocks } from "../../shared/tableText";

export type RecognitionProgress = {
  phase: "preparing" | "recognizing";
  current: number;
  total: number;
  message: string;
};

type RecognitionOptions = {
  onProgress?: (progress: RecognitionProgress) => void;
  sourcePageCount?: number;
  docxImportSessionId?: string;
};

export type DocxImportProgress = {
  current: number;
  total: number;
  message: string;
};

const recognitionImageAttempts = [
  { maxEdge: 2400, quality: 0.9 },
  { maxEdge: 2200, quality: 0.86 },
  { maxEdge: 2000, quality: 0.82 },
  { maxEdge: 1800, quality: 0.78 },
] as const;
const preferredRecognitionPageChars = 3_600_000;
const maximumRecognitionAttempts = 4;
const recognitionSessionMaxWaitMs = 2 * 60 * 60 * 1_000;
export async function recognizeWholeDocument(
  pages: UploadedPage[],
  options: RecognitionOptions = {},
): Promise<RecognitionResult> {
  if (!pages.length) throw new Error("没有可识别的页面。");
  const sessionId = `word-${globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  await requestSessionJson("/api/recognition-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, pageCount: pages.length }),
  });

  for (const [index, page] of pages.entries()) {
    options.onProgress?.({
      phase: "preparing",
      current: index + 1,
      total: pages.length,
      message: `正在识别第 ${index + 1}/${pages.length} 页`,
    });
    const optimizedPage = await optimizePageForRecognition(page);
    options.onProgress?.({
      phase: "recognizing",
      current: index + 1,
      total: pages.length,
      message: `正在识别第 ${index + 1}/${pages.length} 页`,
    });
    await uploadRecognitionPageWithRetry(sessionId, optimizedPage, pages.length, options.onProgress);
  }

  return completeRecognitionSession(sessionId, pages, {
    onProgress: options.onProgress,
    sourcePageCount: options.sourcePageCount ?? pages.length,
    docxImportSessionId: options.docxImportSessionId,
  });
}

export async function registerDocxImportSession(
  files: File[],
  onProgress?: (progress: DocxImportProgress) => void,
) {
  if (!files.length) return null;
  const sessionId = `docx-${globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  await requestSessionJson("/api/docx-import-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, fileCount: files.length }),
  });

  let snapshot: unknown = null;
  for (const [fileIndex, file] of files.entries()) {
    onProgress?.({
      current: fileIndex + 1,
      total: files.length,
      message: `正在核验第 ${fileIndex + 1}/${files.length} 个 Word 文件页数`,
    });
    snapshot = await requestSessionJson(
      `/api/docx-import-sessions/${encodeURIComponent(sessionId)}/files/${fileIndex}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        body: file,
      },
    );
  }

  const pageCount = isRecord(snapshot) ? Number(snapshot.pageCount) : Number.NaN;
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new Error("Word 文件页数核验失败，请重新上传。");
  }
  return { sessionId, pageCount };
}

export async function completeDocxImportSession(sessionId: string, pageCount: number) {
  return requestSessionJson(`/api/docx-import-sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Key": `docx-import-${sessionId}`,
    },
    body: JSON.stringify({ pageCount }),
  });
}

async function uploadRecognitionPageWithRetry(
  sessionId: string,
  page: UploadedPage,
  total: number,
  onProgress?: (progress: RecognitionProgress) => void,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const payload = await requestSessionJson(
        `/api/recognition-sessions/${encodeURIComponent(sessionId)}/pages/${page.pageIndex}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(page),
        },
      );
      const uploaded = isRecord(payload) && Array.isArray(payload.uploadedPageIndexes)
        ? payload.uploadedPageIndexes.length
        : page.pageIndex + 1;
      onProgress?.({
        phase: "recognizing",
        current: uploaded,
        total,
        message: uploaded < total
          ? `正在识别第 ${Math.min(total, uploaded + 1)}/${total} 页`
          : `正在识别第 1/${total} 页`,
      });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableSessionError(error) || attempt === 4) throw error;
      await delay(350 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("页面上传失败，请重试。");
}

async function completeRecognitionSession(
  sessionId: string,
  pages: UploadedPage[],
  options: {
    onProgress?: (progress: RecognitionProgress) => void;
    sourcePageCount: number;
    docxImportSessionId?: string;
  },
) {
  const deadlineAt = Date.now() + recognitionSessionMaxWaitMs;
  let recognitionFailures = 0;
  let reconnectionAttempts = 0;
  let completionRetry = 0;
  let lastError: unknown;
  while (Date.now() < deadlineAt) {
    const outcome = await requestRecognitionCompletion(
      sessionId,
      pages,
      options,
      recognitionCompletionIdempotencyKey(sessionId, completionRetry),
    );
    if (outcome.ok) return outcome.result;

    lastError = outcome.error;
    const snapshot = await readRecognitionSessionStatus(sessionId, true).catch(() => null);
    if (snapshot) {
      const progress = readSessionProgress(snapshot, pages.length);
      if (progress) options.onProgress?.(progress);
      const deliveredResult = readDeliveredRecognitionResult(snapshot, pages);
      if (deliveredResult) return deliveredResult;
    }

    if (isRecord(snapshot) && snapshot.state === "failed") {
      recognitionFailures += 1;
      if (!isRetryableSessionError(lastError) || recognitionFailures >= maximumRecognitionAttempts) {
        throw lastError instanceof Error ? lastError : new Error("识别请求未完成，请重试。");
      }
      completionRetry += 1;
      await delay(700 * 2 ** (recognitionFailures - 1));
    } else {
      if (!isReconnectableCompletionError(lastError)) {
        throw lastError instanceof Error ? lastError : new Error("识别请求未完成，请重试。");
      }
      await delay(Math.min(1_500, 350 + reconnectionAttempts * 50));
      reconnectionAttempts += 1;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("大文件识别会话等待超时，请重新上传后再试。");
}

async function requestRecognitionCompletion(
  sessionId: string,
  pages: UploadedPage[],
  options: {
    onProgress?: (progress: RecognitionProgress) => void;
    sourcePageCount: number;
    docxImportSessionId?: string;
  },
  idempotencyKey: string,
): Promise<{ ok: true; result: RecognitionResult } | { ok: false; error: unknown }> {
  const completionPromise = requestSessionJson(
    `/api/recognition-sessions/${encodeURIComponent(sessionId)}/complete`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        pageCount: pages.length,
        sourcePageCount: options.sourcePageCount,
        ...(options.docxImportSessionId ? { docxImportSessionId: options.docxImportSessionId } : {}),
      }),
    },
  );
  let settled = false;
  const completionOutcome = completionPromise.then(
    (payload) => { settled = true; return { ok: true as const, payload }; },
    (error) => { settled = true; return { ok: false as const, error }; },
  );

  while (!settled) {
    const snapshot = await readRecognitionSessionStatus(sessionId, true).catch(() => null);
    if (snapshot) {
      const progress = readSessionProgress(snapshot, pages.length);
      if (progress) options.onProgress?.(progress);
      const deliveredResult = readDeliveredRecognitionResult(snapshot, pages);
      if (deliveredResult) {
        // 服务端已落盘完整结果，即使完成请求的响应链路刚好断开，也无需再次调用 AI。
        void completionOutcome.then(() => undefined);
        return { ok: true, result: deliveredResult };
      }
    }
    if (!settled) await delay(700);
  }

  const outcome = await completionOutcome;
  if (!outcome.ok) {
    const snapshot = await readRecognitionSessionStatus(sessionId, true).catch(() => null);
    if (snapshot) {
      const progress = readSessionProgress(snapshot, pages.length);
      if (progress) options.onProgress?.(progress);
      const deliveredResult = readDeliveredRecognitionResult(snapshot, pages);
      if (deliveredResult) return { ok: true, result: deliveredResult };
    }
    return outcome;
  }
  return {
    ok: true,
    result: normalizeRecognitionResultPayload(
      outcome.payload,
      new Set(pages.map((page) => page.pageIndex)),
    ),
  };
}

function recognitionCompletionIdempotencyKey(sessionId: string, retry: number) {
  // 处理中重连复用原键；只有后台任务已失败并准备重试时才换键，允许重新预扣积分。
  return retry > 0 ? `recognition-${sessionId}-retry-${retry}` : `recognition-${sessionId}`;
}

function readDeliveredRecognitionResult(snapshot: unknown, pages: UploadedPage[]) {
  if (!isRecord(snapshot) || snapshot.state !== "completed" || !isRecord(snapshot.result)) return null;
  return normalizeRecognitionResultPayload(
    snapshot.result,
    new Set(pages.map((page) => page.pageIndex)),
  );
}

async function readRecognitionSessionStatus(sessionId: string, includeResult = false) {
  const suffix = includeResult ? "?includeResult=1" : "";
  return requestSessionJson(`/api/recognition-sessions/${encodeURIComponent(sessionId)}/status${suffix}`, {
    method: "GET",
  });
}

async function requestSessionJson(path: string, init: RequestInit) {
  const response = await fetch(path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "资料处理请求失败，请重试。";
    const error = Object.assign(new Error(message), {
      code: isRecord(payload) && typeof payload.code === "string" ? payload.code : undefined,
      status: response.status,
    });
    throw error;
  }
  return payload;
}

function readSessionProgress(snapshot: unknown, total: number): RecognitionProgress | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.progress)) return null;
  const progress = snapshot.progress;
  const phase = progress.phase === "uploading"
    ? "preparing"
    : progress.phase === "recognizing"
      ? progress.phase
    : progress.phase === "merging" ? "recognizing" : "recognizing";
  const current = Number(progress.current);
  const snapshotTotal = Number(progress.total);
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(snapshotTotal) || snapshotTotal !== total) return null;
  return {
    phase,
    current: Math.max(0, Math.min(total, current)),
    total,
      message: normalizeRecognitionProgressMessage(progress.message, current, total),
  };
}

function normalizeRecognitionProgressMessage(message: unknown, current: number, total: number) {
  const displayCurrent = Math.max(1, Math.min(total, current));
  if (typeof message !== "string" || !message.trim()) return `正在识别第 ${displayCurrent}/${total} 页`;
  if (/上传|准备图片|准备材料|图片已上传/u.test(message)) return `正在识别第 ${displayCurrent}/${total} 页`;
  if (/合并|整理/u.test(message)) return `正在整理已识别内容（${displayCurrent}/${total} 页）`;
  return message;
}

function isRetryableSessionError(error: unknown) {
  if (error instanceof TypeError) return true;
  if (!isRecord(error)) return false;
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(error.status))
    || isReconnectableCompletionError(error);
}

function isReconnectableCompletionError(error: unknown) {
  if (error instanceof TypeError) return true;
  if (!isRecord(error)) return false;
  if ([408, 425, 429, 500, 502, 503, 504].includes(Number(error.status))) return true;
  return Number(error.status) === 409 && [
    "session_processing",
    "session_result_delivering",
    "session_result_unavailable",
    "session_completed",
    "USAGE_REQUEST_IN_PROGRESS",
    "USAGE_REQUEST_ALREADY_SETTLED",
  ].includes(String(error.code || ""));
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function recognizePages(
  pages: UploadedPage[],
  idempotencyKey: string,
  onProgress?: (progress: RecognitionProgress) => void,
) {
  const body = await createRecognitionRequestBody(pages, onProgress);
  onProgress?.({
    phase: "recognizing",
    current: pages.length,
    total: pages.length,
    message: `正在识别 ${pages.length} 页资料`,
  });
  const response = await fetch("/api/recognize-pages", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-ndjson",
      "X-Idempotency-Key": idempotencyKey,
    },
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : "智能识别失败";
    const code = isRecord(payload) && typeof payload.code === "string" ? payload.code : undefined;
    throw Object.assign(new Error(message), { code });
  }
  return normalizeRecognitionResultPayload(payload, new Set(pages.map((page) => page.pageIndex)));
}

async function createRecognitionRequestBody(
  pages: UploadedPage[],
  onProgress?: (progress: RecognitionProgress) => void,
) {
  const bodyParts: BlobPart[] = [
    `${JSON.stringify({ type: "start", pageCount: pages.length })}\n`,
  ];

  for (const [pageIndex, page] of pages.entries()) {
    onProgress?.({
      phase: "preparing",
      current: pageIndex + 1,
      total: pages.length,
      message: `正在识别第 ${pageIndex + 1}/${pages.length} 页`,
    });
    const optimizedPage = await optimizePageForRecognition(page);
    bodyParts.push(`${JSON.stringify({ type: "page", page: optimizedPage })}\n`);
  }

  bodyParts.push(`${JSON.stringify({ type: "end" })}\n`);
  // 浏览器的 ReadableStream 请求体在 HTTP/1.1 下会直接抛出 Failed to fetch。
  // Blob 仍由浏览器按网络节奏发送，同时兼容本地、Nginx 和普通 HTTP/1.1 链路。
  return new Blob(bodyParts, { type: "application/x-ndjson" });
}

async function optimizePageForRecognition(page: UploadedPage): Promise<UploadedPage> {
  const image = await loadImage(page.imageDataUrl);
  let bestPage: UploadedPage | null = null;

  for (const attempt of recognitionImageAttempts) {
    const rendered = renderImageAsJpeg(image, page.pageIndex, attempt.maxEdge, attempt.quality);
    if (!bestPage || rendered.imageDataUrl.length < bestPage.imageDataUrl.length) {
      bestPage = rendered;
    }
    if (rendered.imageDataUrl.length <= preferredRecognitionPageChars) {
      return rendered;
    }
  }

  return bestPage || page;
}

function renderImageAsJpeg(
  image: HTMLImageElement,
  pageIndex: number,
  maxEdge: number,
  quality: number,
): UploadedPage {
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, maxEdge / Math.max(1, longestEdge));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("浏览器无法创建图片压缩画布");
  }

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return {
    pageIndex,
    width,
    height,
    imageDataUrl: canvas.toDataURL("image/jpeg", quality),
  };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片压缩前加载失败"));
    image.src = src;
  });
}

export function normalizeRecognitionResultPayload(
  payload: unknown,
  allowedPageIndexes?: ReadonlySet<number>,
): RecognitionResult {
  if (!isRecord(payload)
    || !Array.isArray(payload.questions)
    || !Array.isArray(payload.processedPageIndexes)
    || !Array.isArray(payload.emptyPageIndexes)
    || !Array.isArray(payload.warnings)) {
    throw invalidRecognitionPayload();
  }
  const processedPageIndexes = parseStrictPageIndexList(payload.processedPageIndexes);
  const processedPageIndexSet = new Set(processedPageIndexes);
  const expectedPageIndexSet = allowedPageIndexes
    ? parseExpectedPageIndexSet(allowedPageIndexes)
    : processedPageIndexSet;
  if (processedPageIndexSet.size !== expectedPageIndexSet.size
    || [...expectedPageIndexSet].some((pageIndex) => !processedPageIndexSet.has(pageIndex))) {
    throw invalidRecognitionPayload();
  }
  const emptyPageIndexes = parseStrictPageIndexList(payload.emptyPageIndexes, processedPageIndexSet, true);
  const emptyPageIndexSet = new Set(emptyPageIndexes);
  const questions = payload.questions.map((question, index) => (
    normalizeRecognizedQuestion(question, index, processedPageIndexSet)
  ));
  const warnings = payload.warnings;
  if (warnings.some((warning) => typeof warning !== "string")) throw invalidRecognitionPayload();
  assertExactRecognitionPageCoverage(questions, expectedPageIndexSet, emptyPageIndexSet);

  return {
    questions,
    processedPageIndexes,
    emptyPageIndexes,
    warnings: warnings.map((warning) => warning.trim()).filter(Boolean),
  };
}

function parseExpectedPageIndexSet(pageIndexes: ReadonlySet<number>) {
  const result = new Set<number>();
  for (const pageIndex of pageIndexes) {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || result.has(pageIndex)) {
      throw invalidRecognitionPayload();
    }
    result.add(pageIndex);
  }
  if (!result.size) throw invalidRecognitionPayload();
  return result;
}

function parseStrictPageIndexList(
  value: unknown[],
  allowedPageIndexes?: ReadonlySet<number>,
  allowEmpty = false,
) {
  if (!allowEmpty && !value.length) throw invalidRecognitionPayload();
  const result: number[] = [];
  const seen = new Set<number>();
  for (const pageIndex of value) {
    if (!Number.isSafeInteger(pageIndex)
      || Number(pageIndex) < 0
      || seen.has(Number(pageIndex))
      || (allowedPageIndexes && !allowedPageIndexes.has(Number(pageIndex)))) {
      throw invalidRecognitionPayload();
    }
    seen.add(Number(pageIndex));
    result.push(Number(pageIndex));
  }
  return result;
}

function assertExactRecognitionPageCoverage(
  questions: RecognitionResult["questions"],
  expectedPageIndexes: ReadonlySet<number>,
  emptyPageIndexes: ReadonlySet<number>,
) {
  const contentPageIndexes = new Set<number>();
  for (const question of questions) {
    contentPageIndexes.add(question.pageIndex);
    for (const pageIndex of question.sourcePageIndexes) contentPageIndexes.add(pageIndex);
    for (const figure of question.figures) contentPageIndexes.add(figure.pageIndex);
  }

  for (const pageIndex of expectedPageIndexes) {
    // 每一页必须且只能由“有题目内容”或“明确空页”其中一种证据覆盖。
    if (emptyPageIndexes.has(pageIndex) === contentPageIndexes.has(pageIndex)) {
      throw invalidRecognitionPayload();
    }
  }
}

function normalizeRecognizedQuestion(
  question: unknown,
  index: number,
  allowedPageIndexes?: ReadonlySet<number>,
): RecognitionResult["questions"][number] {
  if (!isRecord(question)
    || typeof question.id !== "string"
    || !question.id.trim()
    || (question.kind !== undefined && question.kind !== "question" && question.kind !== "content")
    || typeof question.number !== "string"
    || !Number.isInteger(question.pageIndex)
    || Number(question.pageIndex) < 0
    || !Array.isArray(question.sourcePageIndexes)
    || typeof question.stemMarkdown !== "string"
    || !Array.isArray(question.options)
    || !Array.isArray(question.figures)) {
    throw invalidRecognitionPayload();
  }
  const source = question as Record<string, unknown> & {
    id: string;
    kind?: "question" | "content";
    number: string;
    pageIndex: number;
    sourcePageIndexes: unknown[];
    stemMarkdown: string;
    options: unknown[];
    figures: unknown[];
  };
  const kind = source.kind === "content" ? "content" : "question";
  if (kind === "question" && !source.number.trim()) throw invalidRecognitionPayload();
  const sourcePageIndexes = source.sourcePageIndexes;
  if (!sourcePageIndexes.length
    || sourcePageIndexes.some((pageIndex) => !Number.isInteger(pageIndex) || Number(pageIndex) < 0)
    || new Set(sourcePageIndexes.map(Number)).size !== sourcePageIndexes.length
    || !sourcePageIndexes.map(Number).includes(source.pageIndex)) {
    throw invalidRecognitionPayload();
  }
  const normalizedSourcePageIndexes = sourcePageIndexes.map(Number);
  if (allowedPageIndexes
    && (!allowedPageIndexes.has(source.pageIndex)
      || normalizedSourcePageIndexes.some((pageIndex) => !allowedPageIndexes.has(pageIndex)))) {
    throw invalidRecognitionPayload();
  }
  const options = source.options;
  if (options.some((option) => typeof option !== "string" || !option.trim())) {
    throw invalidRecognitionPayload();
  }
  const stringOptions = options as string[];
  const normalizedFigures = source.figures.map((figure: unknown) => {
    const normalized = normalizeRecognizedFigure(figure);
    if (!normalized) throw invalidRecognitionPayload();
    return normalized;
  });
  if (normalizedFigures.some((figure) => !normalizedSourcePageIndexes.includes(figure.pageIndex))) {
    throw invalidRecognitionPayload();
  }
  const optionLabels = normalizedFigures
    .filter((figure) => figure.kind === "option")
    .map((figure) => normalizeOptionLabel(figure.optionLabel))
    .filter(Boolean);
  const hasTableFigure = normalizedFigures.some((figure) => figure.kind === "table");
  const hasOptionGroup = normalizedFigures.some((figure) => figure.kind === "option-group");
  const hasVisualOptions = optionLabels.length > 0 || hasOptionGroup;
  const stemMarkdown = source.stemMarkdown.trim();
  const normalizedOptions = stringOptions
    .map((option) => option.trim())
    .map((option) => (hasTableFigure ? stripMarkdownTableBlocks(option) : option))
    .filter(Boolean);
  const sourceOptionLabels = normalizedOptions.map(extractOptionLabel).filter(Boolean);
  const requiredOptionLabels = sourceOptionLabels.length
    ? [...new Set(sourceOptionLabels)]
    : hasOptionGroup
      ? ["A", "B", "C", "D"]
      : [...new Set(optionLabels)];
  const recognizedOptionLabels = new Set(optionLabels);
  const hasCompleteIndependentOptions = requiredOptionLabels.length > 0
    && requiredOptionLabels.every((label) => recognizedOptionLabels.has(label));
  if (!stemMarkdown && !normalizedOptions.length && !normalizedFigures.length) {
    throw invalidRecognitionPayload();
  }

  return {
    id: source.id.trim() || `q-${index + 1}`,
    kind,
    number: kind === "question" ? source.number.trim() || String(index + 1) : "",
    pageIndex: Number(source.pageIndex),
    sourcePageIndexes: normalizedSourcePageIndexes,
    stemMarkdown: hasTableFigure ? stripMarkdownTableBlocks(stemMarkdown) : stemMarkdown,
    options: hasVisualOptions
      ? restoreVisualOptionLabels(normalizedOptions, requiredOptionLabels)
      : normalizedOptions,
    figures: sortClientFigures(hasCompleteIndependentOptions
      ? normalizedFigures.filter((figure) => figure.kind !== "option-group")
      : normalizedFigures),
  };
}

function normalizeRecognizedFigure(figure: unknown): RecognitionResult["questions"][number]["figures"][number] | null {
  if (!isRecord(figure) || !Number.isInteger(figure.pageIndex) || Number(figure.pageIndex) < 0) return null;
  const source = figure;
  const bbox = normalizeRecognitionBbox(source.bbox);
  if (!bbox) return null;
  const kind = normalizeFigureKind(source.kind, safeString(source.caption));
  if (!kind) return null;
  const confidence = source.confidence === undefined
    ? 0.8
    : typeof source.confidence === "number"
      && Number.isFinite(source.confidence)
      && source.confidence >= 0
      && source.confidence <= 1
      ? source.confidence
      : null;
  if (confidence === null) return null;

  return {
    pageIndex: Number(source.pageIndex),
    bbox,
    kind,
    optionLabel: normalizeOptionLabel(source.optionLabel) || normalizeOptionLabel(safeString(source.caption)),
    caption: safeString(source.caption),
    confidence,
  };
}

function sortClientFigures<T extends { pageIndex: number; bbox: BBox; kind?: string; optionLabel?: string }>(figures: T[]) {
  return [...figures].sort((left, right) => (
    left.pageIndex - right.pageIndex
    || left.bbox.y - right.bbox.y
    || left.bbox.x - right.bbox.x
    || String(left.kind || "").localeCompare(String(right.kind || ""))
    || String(left.optionLabel || "").localeCompare(String(right.optionLabel || ""))
  ));
}

function normalizeFigureKind(value: unknown, caption: string): "diagram" | "table" | "option-group" | "option" | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["option", "visual-option", "image-option"].includes(normalized)
    || /(?:A|B|C|D)选项图/.test(caption)) {
    return "option";
  }
  if (["option-group", "option_group", "visual-options", "image-options"].includes(normalized)
    || /(?:图形选项|图片选项|图案选项|四个图案选项|选项图|选项图片)/.test(caption)) {
    return "option-group";
  }
  if (normalized === "table") return "table";
  if (["diagram", "figure", "image", "graphic", "chart"].includes(normalized)) return "diagram";
  return null;
}

function normalizeRecognitionBbox(value: unknown) {
  if (!isRecord(value)) return null;

  const x = normalizeFiniteNumber(value.x, Number.NaN);
  const y = normalizeFiniteNumber(value.y, Number.NaN);
  const width = normalizeFiniteNumber(value.width, Number.NaN);
  const height = normalizeFiniteNumber(value.height, Number.NaN);

  if (![x, y, width, height].every(Number.isFinite)
    || x < 0
    || y < 0
    || width <= 0
    || height <= 0
    || x + width > 1
    || y + height > 1) return null;
  return { x, y, width, height };
}

function normalizeFiniteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeString(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function invalidRecognitionPayload() {
  return Object.assign(new Error("识别结果不完整，本次未采用任何残缺内容。"), {
    code: "invalid_ai_response",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

export async function exportDocx(title: string, questions: QuestionItem[]) {
  const { exportQuestionsToDocx } = await import("./wordExport");
  const blob = await exportQuestionsToDocx({ title, questions });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "资料重排.docx";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

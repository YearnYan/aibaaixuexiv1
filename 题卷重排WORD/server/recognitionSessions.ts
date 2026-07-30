import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type {
  RecognitionPage,
  RecognitionResult,
  RecognitionSequenceCheckpoint,
} from "./aiProxy.js";

export type RecognitionSessionState = "uploading" | "recognizing" | "completed" | "failed";
export type RecognitionResultDeliveryState = "available" | "delivering" | "delivered";
export type RecognitionSessionProgress = {
  phase: "uploading" | "recognizing" | "merging" | "completed" | "failed";
  current: number;
  total: number;
  message: string;
};

export type RecognitionSession = {
  id: string;
  ownerKey: string;
  pageCount: number;
  directory: string;
  uploadedPageIndexes: Set<number>;
  state: RecognitionSessionState;
  progress: RecognitionSessionProgress;
  result?: RecognitionResult;
  resultDeliveryState?: RecognitionResultDeliveryState;
  failure?: { code: string; message: string };
  processing?: Promise<RecognitionResult>;
  checkpoint?: RecognitionSequenceCheckpoint;
  updatedAt: number;
  listeners: Set<(progress: RecognitionSessionProgress) => void>;
};

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const SESSION_TTL_MS = 2 * 60 * 60 * 1_000;
const SESSION_ROOT = resolve(join(tmpdir(), "teacher-ai-word-recognition"));
const sessions = new Map<string, RecognitionSession>();
let cleanupStarted = false;

export function validateRecognitionSessionId(value: unknown) {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export async function createRecognitionSession(
  sessionId: string,
  pageCount: number,
  ownerKey: string,
) {
  if (!validateRecognitionSessionId(sessionId)) throw sessionError(400, "invalid_session_id", "识别会话编号不正确。");
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw sessionError(400, "invalid_page_count", "识别页数不正确。");
  }
  const existing = sessions.get(sessionKey(ownerKey, sessionId));
  if (existing) {
    if (existing.pageCount !== pageCount) {
      throw sessionError(409, "session_conflict", "识别会话页数与本次上传不一致。");
    }
    existing.updatedAt = Date.now();
    return existing;
  }

  await ensureSessionRoot();
  const directory = join(SESSION_ROOT, sessionId);
  await fs.mkdir(directory, { recursive: true });
  const session: RecognitionSession = {
    id: sessionId,
    ownerKey,
    pageCount,
    directory,
    uploadedPageIndexes: new Set(),
    state: "uploading",
    progress: {
      phase: "uploading",
      current: 0,
      total: pageCount,
      message: `等待上传第 1/${pageCount} 页`,
    },
    updatedAt: Date.now(),
    listeners: new Set(),
  };
  sessions.set(sessionKey(ownerKey, sessionId), session);
  startCleanup();
  return session;
}

export function requireRecognitionSession(sessionId: string, ownerKey: string) {
  const session = sessions.get(sessionKey(ownerKey, sessionId));
  if (!session) throw sessionError(404, "session_not_found", "识别会话不存在或已过期，请重新上传。");
  session.updatedAt = Date.now();
  return session;
}

export async function writeRecognitionPage(
  session: RecognitionSession,
  pageIndex: number,
  page: RecognitionPage,
) {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= session.pageCount) {
    throw sessionError(400, "invalid_page_index", "上传页码超出本次识别会话范围。");
  }
  if (page.pageIndex !== pageIndex) {
    throw sessionError(400, "page_index_mismatch", "上传页面编号与请求路径不一致。");
  }
  if (session.state === "completed") {
    throw sessionError(409, "session_completed", "识别会话已经完成，不能再上传页面。");
  }
  if (session.state === "recognizing") {
    throw sessionError(409, "session_processing", "识别已经开始，不能再上传页面。");
  }
  await ensureSessionRoot();
  const target = pageFile(session, pageIndex);
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, JSON.stringify(page), "utf8");
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  if (session.state === "failed") {
    // 用户主动替换页面后，既有识别结果可能已经过期，必须从新资料重新建立断点。
    session.state = "uploading";
    session.failure = undefined;
    session.checkpoint = undefined;
  }
  session.uploadedPageIndexes.add(pageIndex);
  session.updatedAt = Date.now();
  publishProgress(session, {
    phase: "uploading",
    current: session.uploadedPageIndexes.size,
    total: session.pageCount,
    message: `已上传第 ${session.uploadedPageIndexes.size}/${session.pageCount} 页`,
  });
  return session;
}

export function subscribeRecognitionSession(
  session: RecognitionSession,
  listener: (progress: RecognitionSessionProgress) => void,
) {
  session.listeners.add(listener);
  listener(session.progress);
  return () => session.listeners.delete(listener);
}

export function recognitionSessionSnapshot(session: RecognitionSession, includeResult = false) {
  return {
    sessionId: session.id,
    state: session.state,
    progress: session.progress,
    uploadedPageIndexes: [...session.uploadedPageIndexes].sort((left, right) => left - right),
    pageCount: session.pageCount,
    failure: session.failure,
    resultDeliveryState: session.resultDeliveryState,
    // 只有结果已经完整送达过计费请求后才允许状态接口回读结果，避免成功生成却未扣积分。
    ...(includeResult && session.result && session.resultDeliveryState === "delivered"
      ? { result: session.result }
      : {}),
  };
}

export function beginRecognitionResultDelivery(session: RecognitionSession) {
  if (!session.result) return "unavailable" as const;
  const state = session.resultDeliveryState ?? "available";
  if (state !== "available") return state;
  session.resultDeliveryState = "delivering";
  session.updatedAt = Date.now();
  return "acquired" as const;
}

export function completeRecognitionResultDelivery(session: RecognitionSession) {
  if (session.resultDeliveryState !== "delivering") return;
  session.resultDeliveryState = "delivered";
  session.updatedAt = Date.now();
}

export function releaseRecognitionResultDelivery(session: RecognitionSession) {
  if (session.resultDeliveryState !== "delivering") return;
  session.resultDeliveryState = "available";
  session.updatedAt = Date.now();
}

export async function startRecognitionSession<T extends RecognitionResult>(
  session: RecognitionSession,
  recognize: (
    pages: AsyncIterable<RecognitionPage>,
    pageCount: number,
    onProgress: (current: number, total: number) => void,
    checkpoint: RecognitionSequenceCheckpoint,
  ) => Promise<T>,
) {
  if (session.result) return session.result as T;
  if (session.processing) return session.processing as Promise<T>;
  if (session.uploadedPageIndexes.size !== session.pageCount) {
    throw sessionError(400, "session_pages_incomplete", `仍有 ${session.pageCount - session.uploadedPageIndexes.size} 页未上传。`);
  }

  const resumeCurrent = session.state === "failed"
    ? Math.min(session.pageCount, Math.max(1, session.progress.current))
    : 1;
  session.checkpoint ??= {
    expectedPageCount: session.pageCount,
    completedBatches: [],
    partialBatches: [],
  };
  session.state = "recognizing";
  session.failure = undefined;
  publishProgress(session, {
    phase: "recognizing",
    current: resumeCurrent,
    total: session.pageCount,
    message: `正在识别第 ${resumeCurrent}/${session.pageCount} 页`,
  });

  const processing = (async () => {
    try {
      const result = await recognize(readRecognitionPages(session), session.pageCount, (current, total) => {
        const monotonicCurrent = session.progress.phase === "recognizing"
          ? Math.max(session.progress.current, current)
          : current;
        publishProgress(session, {
          phase: "recognizing",
          current: Math.min(total, Math.max(0, monotonicCurrent)),
          total,
          message: `正在识别第 ${Math.min(total, Math.max(0, monotonicCurrent))}/${total} 页`,
        });
      }, session.checkpoint!);
      publishProgress(session, {
        phase: "merging",
        current: session.pageCount,
        total: session.pageCount,
        message: "识别完成，正在合并题目和图形结果",
      });
      session.result = result;
      session.resultDeliveryState = "available";
      session.checkpoint = undefined;
      session.state = "completed";
      session.failure = undefined;
      console.info(JSON.stringify({
        event: "word_recognition_session_completed",
        sessionId: session.id,
        pageCount: session.pageCount,
        questionCount: result.questions.length,
      }));
      publishProgress(session, {
        phase: "completed",
        current: session.pageCount,
        total: session.pageCount,
        message: `已完成 ${session.pageCount}/${session.pageCount} 页识别`,
      });
      await removePageFiles(session);
      return result;
    } catch (error) {
      session.state = "failed";
      session.failure = {
        code: typeof (error as { code?: unknown })?.code === "string"
          ? String((error as { code: string }).code)
          : "recognition_failed",
        message: error instanceof Error ? error.message : "整卷识别失败，请重试。",
      };
      publishProgress(session, {
        phase: "failed",
        current: session.progress.current,
        total: session.pageCount,
        message: session.failure.message,
      });
      console.error(JSON.stringify({
        event: "word_recognition_session_failed",
        sessionId: session.id,
        current: session.progress.current,
        total: session.pageCount,
        failureKind: typeof (error as { kind?: unknown })?.kind === "string"
          ? String((error as { kind: string }).kind)
          : session.failure.code,
        completedBatchCount: session.checkpoint?.completedBatches.length ?? 0,
        partialBatchStages: (session.checkpoint?.partialBatches ?? []).map((batch) => ({
          pageIndexes: batch.pageIndexes,
          completedRecoveryKinds: batch.completedRecoveryKinds,
        })),
      }));
      throw error;
    }
  })();
  session.processing = processing;
  void processing.finally(() => {
    if (session.processing === processing) session.processing = undefined;
  }).catch(() => undefined);
  return processing as Promise<T>;
}

async function* readRecognitionPages(session: RecognitionSession): AsyncGenerator<RecognitionPage> {
  for (let pageIndex = 0; pageIndex < session.pageCount; pageIndex += 1) {
    const content = await fs.readFile(pageFile(session, pageIndex), "utf8");
    yield JSON.parse(content) as RecognitionPage;
  }
}

function publishProgress(session: RecognitionSession, progress: RecognitionSessionProgress) {
  session.progress = progress;
  session.updatedAt = Date.now();
  for (const listener of session.listeners) {
    try {
      listener(progress);
    } catch {
      // 状态订阅者断开不应影响识别任务。
    }
  }
}

async function removePageFiles(session: RecognitionSession) {
  await fs.rm(session.directory, { recursive: true, force: true });
  await fs.mkdir(session.directory, { recursive: true });
}

async function ensureSessionRoot() {
  await fs.mkdir(SESSION_ROOT, { recursive: true });
}

function pageFile(session: RecognitionSession, pageIndex: number) {
  return join(session.directory, `page-${pageIndex}.json`);
}

function sessionKey(ownerKey: string, sessionId: string) {
  return `${ownerKey}\u0000${sessionId}`;
}

function startCleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  const timer = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [key, session] of sessions) {
      if (session.processing || session.updatedAt > cutoff) continue;
      sessions.delete(key);
      void fs.rm(session.directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 10 * 60 * 1_000);
  timer.unref?.();
}

function sessionError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

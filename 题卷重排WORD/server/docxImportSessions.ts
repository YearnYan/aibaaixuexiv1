import { resolveDocxPageCount } from "../shared/docxPageCount.js";

type DocxImportSession = {
  id: string;
  ownerKey: string;
  fileCount: number;
  uploadedPageCounts: Map<number, number>;
  completedBy?: string;
  updatedAt: number;
};

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const SESSION_TTL_MS = 2 * 60 * 60 * 1_000;
const sessions = new Map<string, DocxImportSession>();
let cleanupStarted = false;

export function validateDocxImportSessionId(value: unknown) {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export function createDocxImportSession(sessionId: string, fileCount: number, ownerKey: string) {
  if (!validateDocxImportSessionId(sessionId)) {
    throw sessionError(400, "invalid_docx_session_id", "Word 导入会话编号不正确。");
  }
  if (!Number.isSafeInteger(fileCount) || fileCount < 1 || fileCount > 100) {
    throw sessionError(400, "invalid_docx_file_count", "Word 文件数量不正确。");
  }

  const key = sessionKey(ownerKey, sessionId);
  const existing = sessions.get(key);
  if (existing) {
    if (existing.fileCount !== fileCount) {
      throw sessionError(409, "docx_session_conflict", "Word 导入会话的文件数量不一致。");
    }
    existing.updatedAt = Date.now();
    return existing;
  }

  const session: DocxImportSession = {
    id: sessionId,
    ownerKey,
    fileCount,
    uploadedPageCounts: new Map(),
    updatedAt: Date.now(),
  };
  sessions.set(key, session);
  startCleanup();
  return session;
}

export function requireDocxImportSession(sessionId: string, ownerKey: string) {
  const session = sessions.get(sessionKey(ownerKey, sessionId));
  if (!session) {
    throw sessionError(404, "docx_session_not_found", "Word 导入会话不存在或已过期，请重新上传。");
  }
  session.updatedAt = Date.now();
  return session;
}

export async function writeDocxImportFile(
  session: DocxImportSession,
  fileIndex: number,
  content: Uint8Array,
) {
  if (!Number.isSafeInteger(fileIndex) || fileIndex < 0 || fileIndex >= session.fileCount) {
    throw sessionError(400, "invalid_docx_file_index", "Word 文件编号超出本次导入范围。");
  }
  if (session.completedBy) {
    throw sessionError(409, "docx_session_completed", "Word 导入会话已经完成，不能继续上传文件。");
  }
  if (!content.byteLength) {
    throw sessionError(400, "empty_docx_file", "Word 文件内容为空。");
  }

  let pageCount: number;
  try {
    pageCount = await resolveDocxPageCount(content);
  } catch {
    throw sessionError(422, "invalid_docx_file", "Word 文件格式不正确或已损坏。");
  }
  session.uploadedPageCounts.set(fileIndex, pageCount);
  session.updatedAt = Date.now();
  return session;
}

export function assertDocxImportSessionReady(
  session: DocxImportSession,
  expectedPageCount: number,
  consumerId: string,
) {
  if (session.uploadedPageCounts.size !== session.fileCount) {
    throw sessionError(
      400,
      "docx_files_incomplete",
      `仍有 ${session.fileCount - session.uploadedPageCounts.size} 个 Word 文件未上传。`,
    );
  }
  const pageCount = docxImportPageCount(session);
  if (!Number.isSafeInteger(expectedPageCount) || expectedPageCount < 1 || expectedPageCount !== pageCount) {
    throw sessionError(409, "docx_page_count_mismatch", "Word 文件页数与导入会话不一致，请重新上传。");
  }
  if (session.completedBy && session.completedBy !== consumerId) {
    throw sessionError(409, "docx_session_already_used", "这批 Word 文件已经生成过，请重新上传后再试。");
  }
  return pageCount;
}

export function completeDocxImportSession(session: DocxImportSession, consumerId: string) {
  if (session.completedBy && session.completedBy !== consumerId) {
    throw sessionError(409, "docx_session_already_used", "这批 Word 文件已经生成过，请重新上传后再试。");
  }
  session.completedBy = consumerId;
  session.updatedAt = Date.now();
  return session;
}

export function docxImportSessionSnapshot(session: DocxImportSession) {
  return {
    sessionId: session.id,
    fileCount: session.fileCount,
    uploadedFileIndexes: [...session.uploadedPageCounts.keys()].sort((left, right) => left - right),
    pageCount: docxImportPageCount(session),
    state: session.completedBy
      ? "completed"
      : session.uploadedPageCounts.size === session.fileCount ? "ready" : "uploading",
  };
}

function docxImportPageCount(session: DocxImportSession) {
  return [...session.uploadedPageCounts.values()].reduce((total, pageCount) => total + pageCount, 0);
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
      if (session.updatedAt <= cutoff) sessions.delete(key);
    }
  }, 10 * 60 * 1_000);
  timer.unref?.();
}

function sessionError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import {
  assertDocxImportSessionReady,
  completeDocxImportSession,
  createDocxImportSession,
  docxImportSessionSnapshot,
  writeDocxImportFile,
} from "../server/docxImportSessions.js";
import { resolveDocxPageCount } from "../shared/docxPageCount.js";

const owner = `docx-test-${randomUUID()}`;
const sessionId = `docx-${randomUUID()}`;
const session = createDocxImportSession(sessionId, 2, owner);
const twoPageDocx = await createDocx(2, "第一页和第二页");
const fourPageDocx = await createDocx(4, "四页资料正文");

await writeDocxImportFile(session, 1, fourPageDocx);
await writeDocxImportFile(session, 0, twoPageDocx);
assert.deepEqual(docxImportSessionSnapshot(session), {
  sessionId,
  fileCount: 2,
  uploadedFileIndexes: [0, 1],
  pageCount: 6,
  state: "ready",
});
assert.equal(assertDocxImportSessionReady(session, 6, "recognition:test"), 6);
assert.throws(
  () => assertDocxImportSessionReady(session, 5, "recognition:test"),
  (error: unknown) => (error as { code?: string }).code === "docx_page_count_mismatch",
);
completeDocxImportSession(session, "recognition:test");
assert.equal(docxImportSessionSnapshot(session).state, "completed");
assert.doesNotThrow(() => assertDocxImportSessionReady(session, 6, "recognition:test"));
assert.throws(
  () => assertDocxImportSessionReady(session, 6, "recognition:other"),
  (error: unknown) => (error as { code?: string }).code === "docx_session_already_used",
);

const estimatedDocx = await createDocx(null, "资料".repeat(1_600));
assert.equal(await resolveDocxPageCount(estimatedDocx), 3, "缺少页数元数据时应按正文长度稳定估算");

const invalidSession = createDocxImportSession(`docx-${randomUUID()}`, 1, owner);
await assert.rejects(
  () => writeDocxImportFile(invalidSession, 0, new Uint8Array([1, 2, 3])),
  (error: unknown) => (error as { code?: string }).code === "invalid_docx_file",
);

console.log("WORD 文件页数核验、批量汇总和会话防复用回归通过");

async function createDocx(pageCount: number | null, text: string) {
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  if (pageCount !== null) {
    zip.file("docProps/app.xml", `<?xml version="1.0"?><Properties><Pages>${pageCount}</Pages></Properties>`);
  }
  return zip.generateAsync({ type: "uint8array" });
}

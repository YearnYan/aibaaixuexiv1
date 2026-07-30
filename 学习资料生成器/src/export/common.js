import { createMaterialTemplate, normalizeMaterial } from "../material.js";

export class ExportValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExportValidationError";
    this.code = "EXPORT_INVALID_MATERIAL";
  }
}

export function prepareExportMaterial(material) {
  if (!material || typeof material !== "object" || !material.meta?.title) {
    throw new ExportValidationError("缺少可导出的完整学习讲义。");
  }

  const defaults = createMaterialTemplate({
    sources: Array.isArray(material.sourceFiles) ? material.sourceFiles : [],
    options: {
      grade: material.meta.grade,
      subject: material.meta.subject,
      depth: "detailed"
    }
  });
  return normalizeMaterial(material, defaults);
}

export function sanitizeFilename(title, extension) {
  const safeTitle = String(title || "学习资料报告")
    .replace(/[<>:"/\\|?*：？＊\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64) || "学习资料报告";
  return `${safeTitle}-完整学习报告.${extension}`;
}

export function buildAttachmentHeader(title, extension) {
  const filename = sanitizeFilename(title, extension);
  const encodedFilename = encodeURIComponent(filename)
    .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="study-report.${extension}"; filename*=UTF-8''${encodedFilename}`;
}

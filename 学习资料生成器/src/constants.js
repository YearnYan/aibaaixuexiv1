export const MAX_FILES = 8;
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_FILE_SIZE_MB = 20;
export const MAX_SOURCE_TEXT = 60_000;
export const MAX_VISION_IMAGES = 8;
export const MAX_SCANNED_PDF_PAGES = 6;

export const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".pdf",
  ".doc",
  ".docx"
]);

export const ALLOWED_MIME_TYPES = new Set([
  "",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/x-pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream"
]);

export const VALID_GOALS = new Set(["understand", "exam", "deep"]);
export const VALID_DEPTHS = new Set(["standard", "detailed"]);

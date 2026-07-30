import path from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

export interface ImagePart {
  mimeType: "image/png" | "image/jpeg";
  data: string;
}

export interface ParsedFiles {
  text: string;
  images: ImagePart[];
  fileNames: string[];
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md"]);

function readableFileName(originalName: string) {
  if (!/[\u0080-\uffff]/.test(originalName)) {
    const decoded = Buffer.from(originalName, "latin1").toString("utf8");
    if (!decoded.includes("�")) {
      return decoded;
    }
  }
  return originalName;
}

async function parseFile(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase();
  const fileName = readableFileName(file.originalname);

  if (IMAGE_TYPES.has(file.mimetype) || [".png", ".jpg", ".jpeg"].includes(extension)) {
    const mimeType = extension === ".png" || file.mimetype === "image/png" ? "image/png" : "image/jpeg";
    return {
      fileName,
      text: "",
      image: { mimeType, data: file.buffer.toString("base64") } satisfies ImagePart,
    };
  }

  if (file.mimetype === "application/pdf" || extension === ".pdf") {
    const result = await pdfParse(file.buffer);
    const text = result.text.trim();
    if (!text) {
      throw new Error(`“${fileName}”没有可提取文字，请将扫描页导出为 PNG 或 JPG 后上传`);
    }
    return { fileName, text: `【${fileName}】\n${text}`, image: null };
  }

  if (
    file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    const text = result.value.trim();
    if (!text) {
      throw new Error(`“${fileName}”没有可提取文字`);
    }
    return { fileName, text: `【${fileName}】\n${text}`, image: null };
  }

  if (extension === ".doc") {
    throw new Error(`“${fileName}”是旧版 Word 格式，请另存为 DOCX 后上传`);
  }

  if (TEXT_EXTENSIONS.has(extension) || file.mimetype.startsWith("text/")) {
    const text = file.buffer.toString("utf8").trim();
    if (!text) {
      throw new Error(`“${fileName}”内容为空`);
    }
    return { fileName, text: `【${fileName}】\n${text}`, image: null };
  }

  throw new Error(`暂不支持“${fileName}”的文件格式`);
}

export async function parseUploadedFiles(files: Express.Multer.File[]): Promise<ParsedFiles> {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 30 * 1024 * 1024) {
    throw new Error("上传文件总大小不能超过 30 MB");
  }

  const parsed = await Promise.all(files.map(parseFile));
  const text = parsed
    .map((item) => item.text)
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (text.length > 50_000) {
    throw new Error("资料文字超过 50,000 字，请只保留需要审题的题目内容");
  }

  return {
    text,
    images: parsed.flatMap((item) => (item.image ? [item.image] : [])),
    fileNames: parsed.map((item) => item.fileName),
  };
}

import { createRequire } from "node:module";
import { DOMMatrix, ImageData, Path2D, createCanvas, loadImage } from "@napi-rs/canvas";
import mammoth from "mammoth";
import {
  MAX_SCANNED_PDF_PAGES,
  MAX_SOURCE_TEXT
} from "./constants.js";
import {
  cleanText,
  detectFileKind,
  truncateSourceText
} from "./utils.js";

const require = createRequire(import.meta.url);
const WordExtractor = require("word-extractor");

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D;

function toDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function optimizeImage(buffer) {
  const image = await loadImage(buffer);
  const maxSide = 1_800;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return toDataUrl(canvas.toBuffer("image/jpeg", 82), "image/jpeg");
}

async function extractPdf(buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false
  });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str).join(" "));
    page.cleanup();
  }

  const joinedText = cleanText(pageTexts.join("\n\n"), Number.MAX_SAFE_INTEGER);
  const averageCharacters = joinedText.length / Math.max(pageCount, 1);
  const images = [];
  const warnings = [];

  if (averageCharacters < 80) {
    const renderCount = Math.min(pageCount, MAX_SCANNED_PDF_PAGES);
    for (let pageNumber = 1; pageNumber <= renderCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.45 });
      const canvas = createCanvas(
        Math.max(1, Math.floor(viewport.width)),
        Math.max(1, Math.floor(viewport.height))
      );
      const canvasContext = canvas.getContext("2d");
      await page.render({ canvasContext, viewport }).promise;
      images.push(toDataUrl(canvas.toBuffer("image/jpeg", 82), "image/jpeg"));
      page.cleanup();
    }

    if (pageCount > renderCount) {
      warnings.push(`扫描型 PDF 仅识别前 ${renderCount} 页，共 ${pageCount} 页。`);
    }
  }

  await document.destroy();
  const truncated = truncateSourceText(joinedText, MAX_SOURCE_TEXT);
  if (truncated.truncated) warnings.push("PDF 正文较长，已截取主要内容进行分析。");

  return {
    text: truncated.text,
    images,
    pageCount,
    warnings
  };
}

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  const truncated = truncateSourceText(result.value, MAX_SOURCE_TEXT);
  return {
    text: truncated.text,
    images: [],
    warnings: truncated.truncated ? ["Word 正文较长，已截取主要内容进行分析。"] : []
  };
}

async function extractLegacyDoc(buffer) {
  const extractor = new WordExtractor();
  const document = await extractor.extract(buffer);
  const truncated = truncateSourceText(document.getBody(), MAX_SOURCE_TEXT);
  return {
    text: truncated.text,
    images: [],
    warnings: truncated.truncated ? ["Word 正文较长，已截取主要内容进行分析。"] : []
  };
}

export async function extractFile(file) {
  const kind = detectFileKind(file);
  const base = {
    name: cleanText(file.originalname, 180),
    kind,
    size: file.size,
    text: "",
    images: [],
    warnings: []
  };

  if (kind === "image") {
    return {
      ...base,
      images: [await optimizeImage(file.buffer)]
    };
  }

  if (kind === "pdf") {
    return { ...base, ...(await extractPdf(file.buffer)) };
  }

  if (kind === "docx") {
    return { ...base, ...(await extractDocx(file.buffer)) };
  }

  if (kind === "doc") {
    return { ...base, ...(await extractLegacyDoc(file.buffer)) };
  }

  throw new Error("不支持的文件格式");
}

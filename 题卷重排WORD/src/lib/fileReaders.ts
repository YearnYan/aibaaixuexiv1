import * as mammoth from "mammoth";
import { normalizeQuestionMathFields, normalizeRecognizedMathText } from "../../shared/mathText";
import { resolveDocxPageCount } from "../../shared/docxPageCount";
import { installPdfRuntimeCompat, PDF_RUNTIME_COMPAT_VERSION } from "./browserCompat";
import type { QuestionItem, UploadedPage } from "../types";

type PdfJsLib = typeof import("pdfjs-dist");

let pdfJsLibPromise: Promise<PdfJsLib> | null = null;

export type ParsedUpload =
  | { kind: "pages"; pages: UploadedPage[]; fileName: string; sourcePageCount: number }
  | { kind: "questions"; questions: QuestionItem[]; fileName: string; sourcePageCount: number };

export function isDocxFile(file: File) {
  return file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || file.name.toLowerCase().endsWith(".docx");
}

export async function parseUpload(file: File): Promise<ParsedUpload> {
  const lowerName = file.name.toLowerCase();
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/.test(lowerName)) {
    const page = await imageFileToPage(file, 0);
    return {
      kind: "pages",
      fileName: file.name,
      pages: [page],
      sourcePageCount: 1,
    };
  }

  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    const pages = await pdfToPages(file);
    return {
      kind: "pages",
      fileName: file.name,
      pages,
      sourcePageCount: pages.length,
    };
  }

  if (isDocxFile(file)) {
    const parsed = await docxToContentItems(file);
    return {
      kind: "questions",
      fileName: file.name,
      questions: parsed.items,
      sourcePageCount: parsed.pageCount,
    };
  }

  if (lowerName.endsWith(".doc")) {
    throw new Error("当前网页端支持可编辑 Word 的 .docx 文件；旧版 .doc 请先用 Word 另存为 .docx。");
  }

  throw new Error("文件格式不支持，请上传 PDF、DOCX 或浏览器可读取的图片文件。");
}

export async function parseUploads(files: FileList | File[]): Promise<{
  fileName: string;
  pages: UploadedPage[];
  questions: QuestionItem[];
  sourcePageCount: number;
}> {
  const list = Array.from(files);
  if (!list.length) {
    throw new Error("请选择至少一个文件。");
  }

  const pages: UploadedPage[] = [];
  const questions: QuestionItem[] = [];
  const fileNames: string[] = [];
  let sourcePageCount = 0;

  for (const file of list) {
    const parsed = await parseUpload(file);
    fileNames.push(parsed.fileName);
    sourcePageCount += parsed.sourcePageCount;

    if (parsed.kind === "pages") {
      const pageOffset = pages.length;
      pages.push(...parsed.pages.map((page) => ({
        ...page,
        pageIndex: pageOffset + page.pageIndex,
      })));
      continue;
    }

    const questionOffset = questions.length;
    questions.push(...parsed.questions.map((question, index) => normalizeQuestionMathFields({
      ...question,
      id: `docx-${questionOffset + index + 1}`,
      number: question.kind === "content" ? "" : question.number || String(questionOffset + index + 1),
      pageIndex: 0,
      figures: question.figures.map((figure, figureIndex) => ({
        ...figure,
        id: `docx-${questionOffset + index + 1}-figure-${figureIndex + 1}`,
      })),
    })));
  }

  return {
    fileName: summarizeFileNames(fileNames),
    pages,
    questions,
    sourcePageCount,
  };
}

async function imageFileToPage(file: File, pageIndex: number): Promise<UploadedPage> {
  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);
  return renderLoadedImageAsJpeg(image, pageIndex, 3200, 0.92);
}

async function pdfToPages(file: File): Promise<UploadedPage[]> {
  const pdfjsLib = await loadPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: UploadedPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("浏览器无法创建 PDF 渲染画布");
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    pages.push({
      pageIndex: pageNumber - 1,
      width: canvas.width,
      height: canvas.height,
      imageDataUrl: canvas.toDataURL("image/jpeg", 0.9),
    });
  }

  return pages;
}

function renderLoadedImageAsJpeg(
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
  if (!context) throw new Error("浏览器无法创建图片处理画布");
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

async function docxToContentItems(file: File): Promise<{ items: QuestionItem[]; pageCount: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const [result, pageCount] = await Promise.all([
    mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read("base64");
        return {
          src: `data:${image.contentType};base64,${base64}`,
        };
      }),
    },
    ),
    resolveDocxPageCount(arrayBuffer),
  ]);

  const parser = new DOMParser();
  const doc = parser.parseFromString(result.value, "text/html");
  const items: QuestionItem[] = [];
  let currentQuestion: QuestionItem | null = null;

  Array.from(doc.body.children).forEach((node) => {
    const text = blockText(node as HTMLElement);
    const images = blockImages(node as HTMLElement);
    if (!text && !images.length) return;

    const match = text.match(/^(\d{1,3}|[一二三四五六七八九十]{1,3})[\.、．]\s*(.+)$/);
    if (match) {
      currentQuestion = {
        id: `item-${items.length + 1}`,
        kind: "question",
        number: match[1],
        pageIndex: 0,
        stemMarkdown: normalizeRecognizedMathText(match[2]),
        options: [],
        figures: createDocxFigures(images, `item-${items.length + 1}`),
      };
      items.push(currentQuestion);
      return;
    }

    if (text && /^[A-H][\.、．]\s*/.test(text) && currentQuestion && !images.length) {
      currentQuestion.options.push(normalizeRecognizedMathText(text));
      return;
    }

    const id = `item-${items.length + 1}`;
    items.push({
      id,
      kind: "content",
      number: "",
      pageIndex: 0,
      stemMarkdown: normalizeRecognizedMathText(text),
      options: [],
      figures: createDocxFigures(images, id),
    });
    currentQuestion = null;
  });

  if (!items.length) {
    throw new Error("没有在 Word 文档中读取到可输出内容");
  }

  return {
    items: items.map((item) => normalizeQuestionMathFields(item)),
    pageCount,
  };
}

function blockText(node: HTMLElement) {
  const tagName = node.tagName.toLowerCase();
  if (tagName === "table") {
    return Array.from(node.querySelectorAll("tr"))
      .map((row) => Array.from(row.querySelectorAll("th,td"))
        .map((cell) => normalizeText(cell.textContent || ""))
        .filter(Boolean)
        .join(" | "))
      .filter(Boolean)
      .join("\n");
  }
  if (tagName === "ul" || tagName === "ol") {
    return Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child, index) => `${tagName === "ol" ? `${index + 1}.` : "-"} ${normalizeText(child.textContent || "")}`)
      .join("\n");
  }
  const text = normalizeText(node.textContent || "");
  if (!text) return "";
  const headingLevel = /^h([1-6])$/u.exec(tagName)?.[1];
  return headingLevel ? `${"#".repeat(Number(headingLevel))} ${text}` : text;
}

function blockImages(node: HTMLElement) {
  const images = node.tagName.toLowerCase() === "img"
    ? [node as HTMLImageElement]
    : Array.from(node.querySelectorAll("img"));
  return images.filter((image) => image.src);
}

function createDocxFigures(images: HTMLImageElement[], itemId: string) {
  return images.map((image, index) => ({
    id: `${itemId}-figure-${index + 1}`,
    kind: "diagram" as const,
    dataUrl: image.src,
    width: Number(image.getAttribute("width")) || 520,
    height: Number(image.getAttribute("height")) || 260,
    caption: image.alt || "Word 原文图片",
    confidence: 1,
  }));
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeFileNames(fileNames: string[]) {
  if (fileNames.length === 1) return fileNames[0];
  return `${fileNames[0]} 等 ${fileNames.length} 个文件`;
}

async function loadPdfJs() {
  installPdfRuntimeCompat();
  pdfJsLibPromise ??= import("pdfjs-dist").then((pdfjsLib) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdf.worker.js?v=${PDF_RUNTIME_COMPAT_VERSION}`;
    return pdfjsLib;
  });
  return pdfJsLibPromise;
}

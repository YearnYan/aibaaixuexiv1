const path = require('path');
const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');
const { PDFParse } = require('pdf-parse');

const MAX_FILES = 60;
const MAX_FILE_BYTES = 18 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;
const MAX_TEXT_LENGTH = 120000;
const MAX_PDF_PAGE_IMAGES = 12;

const ACCEPTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.pdf',
  '.doc',
  '.docx'
]);

const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

function normalizeFileName(name) {
  const baseName = path.basename(String(name || '').trim());
  return baseName || '未命名文件';
}

function normalizeMimeType(mimeType) {
  return String(mimeType || '').trim().toLowerCase();
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function clampText(text) {
  const normalized = normalizeText(text);
  if (normalized.length <= MAX_TEXT_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TEXT_LENGTH)}\n\n[文本过长，后续内容已截断]`;
}

function parseDataUrl(dataUrl) {
  const value = String(dataUrl || '');
  const matched = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!matched) {
    throw new Error('文件内容格式无效，请重新选择文件');
  }

  const mimeType = normalizeMimeType(matched[1] || 'application/octet-stream');
  const isBase64 = Boolean(matched[2]);
  const rawPayload = matched[3] || '';
  const buffer = isBase64
    ? Buffer.from(rawPayload, 'base64')
    : Buffer.from(decodeURIComponent(rawPayload), 'utf8');

  return { mimeType, buffer };
}

function isImageFile(extension, mimeType) {
  return extension === '.jpg'
    || extension === '.jpeg'
    || extension === '.png'
    || mimeType === 'image/jpeg'
    || mimeType === 'image/png';
}

function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('请至少上传一个试卷文件');
  }
  if (files.length > MAX_FILES) {
    throw new Error(`单次最多上传 ${MAX_FILES} 个文件`);
  }
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    let pageImages = [];

    try {
      const screenshotResult = await parser.getScreenshot({
        first: MAX_PDF_PAGE_IMAGES,
        desiredWidth: 1440,
        imageDataUrl: true,
        imageBuffer: false
      });
      pageImages = (screenshotResult.pages || [])
        .map((page) => page.dataUrl)
        .filter(Boolean);
    } catch (error) {
      console.warn('[上传试卷] PDF 页面渲染失败，将继续使用文本解析:', error.message);
    }

    return {
      text: clampText(textResult.text),
      pageImages
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return clampText(result.value);
}

async function extractDoc(buffer) {
  const extractor = new WordExtractor();
  const document = await extractor.extract(buffer);
  return clampText(document.getBody());
}

async function extractUploadedExamFiles(files) {
  validateFiles(files);

  const sources = [];
  const imageUrls = [];
  let totalBytes = 0;

  for (const rawFile of files) {
    const name = normalizeFileName(rawFile?.name);
    const extension = path.extname(name).toLowerCase();
    const declaredMimeType = normalizeMimeType(rawFile?.type);

    if (!ACCEPTED_EXTENSIONS.has(extension) && !ACCEPTED_MIME_TYPES.has(declaredMimeType)) {
      throw new Error(`不支持文件“${name}”，仅支持 JPG、PNG、PDF、DOC、DOCX`);
    }

    const { mimeType, buffer } = parseDataUrl(rawFile?.dataUrl);
    totalBytes += buffer.length;

    if (buffer.length === 0) {
      throw new Error(`文件“${name}”为空`);
    }
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error(`文件“${name}”超过 18MB，请压缩后重试`);
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('本次上传文件总大小超过 48MB，请压缩后重试');
    }

    if (isImageFile(extension, mimeType || declaredMimeType)) {
      imageUrls.push(rawFile.dataUrl);
      sources.push({ name, kind: 'image', text: '', imageCount: 1 });
      continue;
    }

    if (extension === '.pdf' || mimeType === 'application/pdf') {
      const extracted = await extractPdf(buffer);
      imageUrls.push(...extracted.pageImages);
      sources.push({
        name,
        kind: 'pdf',
        text: extracted.text,
        imageCount: extracted.pageImages.length
      });
      continue;
    }

    if (
      extension === '.docx'
      || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      sources.push({ name, kind: 'docx', text: await extractDocx(buffer), imageCount: 0 });
      continue;
    }

    sources.push({ name, kind: 'doc', text: await extractDoc(buffer), imageCount: 0 });
  }

  if (!sources.some((source) => source.text) && imageUrls.length === 0) {
    throw new Error('没有读取到可解析的试卷内容，请检查文件后重试');
  }

  return { sources, imageUrls };
}

module.exports = {
  ACCEPTED_EXTENSIONS,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  extractUploadedExamFiles
};

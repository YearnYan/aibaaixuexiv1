const path = require('node:path');
const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const MAX_TEXT_LENGTH = 60000;
const MAX_PDF_TEXT_PAGES = 20;
const MAX_PDF_IMAGE_PAGES = 4;

class FileParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileParseError';
    this.status = 422;
    this.code = 'FILE_PARSE_ERROR';
  }
}

function limitText(text) {
  const normalized = text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (normalized.length <= MAX_TEXT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TEXT_LENGTH)}\n\n[材料过长，后续内容已截断]`;
}

async function normalizeImage(buffer) {
  try {
    const image = await loadImage(buffer);
    const maxSide = 2200;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    const output = await canvas.encode('jpeg', 88);
    return `data:image/jpeg;base64,${output.toString('base64')}`;
  } catch {
    throw new FileParseError('图片无法读取，请重新导出为清晰的 PNG 或 JPG 后再试');
  }
}

async function parsePdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
  } catch {
    throw new FileParseError('PDF 无法读取，文件可能已损坏或设置了密码');
  }

  const totalPages = document.numPages;
  const textParts = [];
  const images = [];
  const pageCount = Math.min(totalPages, MAX_PDF_TEXT_PAGES);

  for (let index = 1; index <= pageCount; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(' ').trim();
    if (text) textParts.push(`[第 ${index} 页]\n${text}`);

    if (index <= MAX_PDF_IMAGE_PAGES) {
      try {
        const initialViewport = page.getViewport({ scale: 1 });
        const renderScale = Math.min(2, 1800 / Math.max(initialViewport.width, initialViewport.height));
        const viewport = page.getViewport({ scale: Math.max(1.3, renderScale) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const imageBuffer = await canvas.encode('jpeg', 84);
        images.push({
          label: `PDF 第 ${index} 页`,
          dataUrl: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
        });
      } catch {
        // 文本仍可用于诊断时，单页渲染失败不应阻断整个请求。
      }
    }
  }

  await document.destroy();
  const text = limitText(textParts.join('\n\n'));
  if (!text && images.length === 0) {
    throw new FileParseError('PDF 中没有可识别的文字或页面，请改为上传清晰截图');
  }

  const warnings = [];
  if (totalPages > MAX_PDF_TEXT_PAGES) {
    warnings.push(`PDF 共 ${totalPages} 页，仅分析前 ${MAX_PDF_TEXT_PAGES} 页文字`);
  }
  if (totalPages > MAX_PDF_IMAGE_PAGES) {
    warnings.push(`模型视觉核对前 ${MAX_PDF_IMAGE_PAGES} 页，其余页面使用提取文字`);
  }

  return { text, images, warnings };
}

async function parseDocx(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = limitText(result.value);
    if (!text) throw new Error('empty');
    return {
      text,
      images: [],
      warnings: result.messages.length ? ['Word 中的复杂公式或嵌入对象可能无法完整提取'] : [],
    };
  } catch {
    throw new FileParseError('Word 文档无法读取，请确认文件未损坏并优先使用 DOCX 格式');
  }
}

async function parseLegacyDoc(buffer) {
  try {
    const extractor = new WordExtractor();
    const document = await extractor.extract(buffer);
    const text = limitText(document.getBody());
    if (!text) throw new Error('empty');
    return {
      text,
      images: [],
      warnings: ['旧版 DOC 的公式、图片和复杂排版可能无法完整提取，建议转换为 PDF 或 DOCX'],
    };
  } catch {
    throw new FileParseError('旧版 DOC 无法读取，请转换为 PDF 或 DOCX 后重试');
  }
}

async function parseQuestionFile(file) {
  if (!file) throw new FileParseError('请上传题目文件');
  const extension = path.extname(file.originalname).toLowerCase();

  if (['.png', '.jpg', '.jpeg'].includes(extension)) {
    return {
      text: '',
      images: [{ label: '题目图片', dataUrl: await normalizeImage(file.buffer) }],
      warnings: [],
    };
  }
  if (extension === '.pdf') return parsePdf(file.buffer);
  if (extension === '.docx') return parseDocx(file.buffer);
  if (extension === '.doc') return parseLegacyDoc(file.buffer);
  throw new FileParseError('仅支持 PDF、DOC、DOCX、PNG、JPG 或 JPEG 文件');
}

module.exports = {
  FileParseError,
  parseQuestionFile,
};

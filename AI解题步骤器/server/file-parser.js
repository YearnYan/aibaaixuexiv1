import path from 'node:path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { AppError, assertOrThrow } from './errors.js';

const MAX_TEXT_LENGTH = 30000;
const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function hasSignature(buffer, extension) {
  if (extension === '.pdf') return buffer.subarray(0, 4).toString() === '%PDF';
  if (extension === '.png') return buffer.subarray(1, 4).toString() === 'PNG';
  if (extension === '.jpg' || extension === '.jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === '.webp') {
    return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  }
  if (extension === '.docx') return buffer[0] === 0x50 && buffer[1] === 0x4b;
  return true;
}

function cleanText(text) {
  return text.split(String.fromCharCode(0)).join('').replace(/[ \t]+\n/g, '\n').trim().slice(0, MAX_TEXT_LENGTH);
}

export async function parseUploadedFile(file) {
  assertOrThrow(file?.buffer?.length, 400, 'FILE_REQUIRED', '请选择需要分析的题目文件。');
  const extension = path.extname(file.originalname).toLowerCase();
  const supported = ['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.md'];
  assertOrThrow(
    supported.includes(extension),
    400,
    'UNSUPPORTED_FILE_TYPE',
    '仅支持 PDF、DOCX、PNG、JPG、WEBP、TXT 或 MD 文件。',
  );
  assertOrThrow(
    hasSignature(file.buffer, extension),
    400,
    'FILE_SIGNATURE_MISMATCH',
    '文件内容与扩展名不一致，请检查后重新上传。',
  );

  if (IMAGE_TYPES.has(extension)) {
    const mimeType = IMAGE_TYPES.get(extension);
    return {
      kind: 'image',
      fileName: path.basename(file.originalname),
      mimeType,
      dataUrl: `data:${mimeType};base64,${file.buffer.toString('base64')}`,
    };
  }

  let text = '';
  try {
    if (extension === '.pdf') {
      const result = await pdfParse(file.buffer);
      text = result.text;
    } else if (extension === '.docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    } else {
      text = file.buffer.toString('utf8');
    }
  } catch (error) {
    throw new AppError(400, 'FILE_PARSE_FAILED', '无法读取该文件，请确认文件未损坏。', error);
  }

  text = cleanText(text);
  assertOrThrow(
    text.length >= 5,
    400,
    'FILE_TEXT_EMPTY',
    extension === '.pdf'
      ? '未从 PDF 中提取到题目文字；扫描版 PDF 请转为图片后上传。'
      : '文件中没有可分析的题目文字。',
  );
  return {
    kind: 'text',
    fileName: path.basename(file.originalname),
    text,
    truncated: text.length === MAX_TEXT_LENGTH,
  };
}

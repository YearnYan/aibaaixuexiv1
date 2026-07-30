const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');
const { PDFParse } = require('pdf-parse');
const { extractUploadedExamFiles } = require('../server/services/uploaded-exam-files');

function createUpload(name, type, content) {
  const buffer = Buffer.from(content);
  return {
    name,
    type,
    size: buffer.length,
    dataUrl: `data:${type};base64,${buffer.toString('base64')}`
  };
}

function createMinimalPdf(text) {
  const escapedText = String(text).replace(/([\\()])/g, '\\$1');
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escapedText}) Tj\nET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(document, 'latin1'));
    document += object;
  }
  const xrefOffset = Buffer.byteLength(document, 'latin1');
  document += `xref\n0 ${objects.length + 1}\n`;
  document += '0000000000 65535 f \n';
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'latin1');
}

test('前端上传链路保留 PDF、DOC、DOCX 原始文件，不再生成后端拒绝的 TXT', () => {
  const source = readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const start = source.indexOf('async function prepareUploadAssets()');
  const end = source.indexOf('function updateFigureProgressBanner', start);
  const uploadFlow = source.slice(start, end);

  assert.ok(start >= 0 && end > start, '必须存在文件上传准备函数');
  assert.match(source, /const MAX_UPLOAD_FILE_COUNT = 60;/u);
  assert.match(uploadFlow, /name: file\.name/u);
  assert.match(uploadFlow, /dataUrl/u);
  assert.doesNotMatch(uploadFlow, /\.txt|text\/plain|暂不支持旧版/u);
});

test('PDF 原文件由后端提取文本和页面图像', async (t) => {
  const originalGetText = PDFParse.prototype.getText;
  const originalGetScreenshot = PDFParse.prototype.getScreenshot;
  const originalDestroy = PDFParse.prototype.destroy;
  t.after(() => {
    PDFParse.prototype.getText = originalGetText;
    PDFParse.prototype.getScreenshot = originalGetScreenshot;
    PDFParse.prototype.destroy = originalDestroy;
  });

  PDFParse.prototype.getText = async () => ({ text: '一、选择题\n1. 测试题目' });
  PDFParse.prototype.getScreenshot = async (options) => {
    assert.equal(options.first, 12);
    return { pages: [{ dataUrl: 'data:image/png;base64,cGFnZQ==' }] };
  };
  PDFParse.prototype.destroy = async () => {};

  const result = await extractUploadedExamFiles([
    createUpload('集训教学冲刺卷07.pdf', 'application/pdf', 'mock-pdf-binary')
  ]);

  assert.deepEqual(result.sources, [{
    name: '集训教学冲刺卷07.pdf',
    kind: 'pdf',
    text: '一、选择题\n1. 测试题目',
    imageCount: 1
  }]);
  assert.deepEqual(result.imageUrls, ['data:image/png;base64,cGFnZQ==']);
});

test('真实 PDF 解析库可以读取原始 PDF 二进制', async () => {
  const result = await extractUploadedExamFiles([
    createUpload('真实样卷.pdf', 'application/pdf', createMinimalPdf('Exam question 1'))
  ]);

  assert.equal(result.sources[0].name, '真实样卷.pdf');
  assert.equal(result.sources[0].kind, 'pdf');
  assert.match(result.sources[0].text, /Exam question 1/u);
});

test('DOCX 原文件由后端提取正文', async (t) => {
  const originalExtractRawText = mammoth.extractRawText;
  t.after(() => {
    mammoth.extractRawText = originalExtractRawText;
  });

  mammoth.extractRawText = async ({ buffer }) => {
    assert.equal(buffer.toString(), 'mock-docx-binary');
    return { value: '二、填空题\r\n2. Word 测试题目' };
  };

  const result = await extractUploadedExamFiles([
    createUpload(
      '期末试卷.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'mock-docx-binary'
    )
  ]);

  assert.deepEqual(result.sources, [{
    name: '期末试卷.docx',
    kind: 'docx',
    text: '二、填空题\n2. Word 测试题目',
    imageCount: 0
  }]);
  assert.deepEqual(result.imageUrls, []);
});

test('旧版 DOC 原文件由后端提取正文', async (t) => {
  const originalExtract = WordExtractor.prototype.extract;
  t.after(() => {
    WordExtractor.prototype.extract = originalExtract;
  });

  WordExtractor.prototype.extract = async (buffer) => {
    assert.equal(buffer.toString(), 'mock-doc-binary');
    return { getBody: () => '三、解答题\n3. DOC 测试题目' };
  };

  const result = await extractUploadedExamFiles([
    createUpload('月考试卷.doc', 'application/msword', 'mock-doc-binary')
  ]);

  assert.deepEqual(result.sources, [{
    name: '月考试卷.doc',
    kind: 'doc',
    text: '三、解答题\n3. DOC 测试题目',
    imageCount: 0
  }]);
  assert.deepEqual(result.imageUrls, []);
});

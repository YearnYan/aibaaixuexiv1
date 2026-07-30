const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require('docx');
const {
  escapeHtml,
  normalizeMathText,
  normalizeReportMath,
  renderRichTextToHtml,
  splitMathSegments,
  validateReportMath,
} = require('./math-content');
const { WordFormulaRegistry } = require('./word-math');

const COLORS = Object.freeze({
  ink: '171B22',
  muted: '687384',
  line: 'CCD4DE',
  teal: '0B8983',
  tealSoft: 'E2F2F1',
  red: 'E5252B',
  redSoft: 'FAE6E7',
  blue: '147AC1',
  blueSoft: 'E8F1F9',
  amber: 'D89200',
  amberSoft: 'FFF5DC',
});
const A4_CONTENT_WIDTH = 10206;
let katexCssPromise;

class ExportError extends Error {
  constructor(message, status = 422, code = 'EXPORT_ERROR', details = '') {
    super(message);
    this.name = 'ExportError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function preparePayload(payload) {
  const normalized = {
    ...payload,
    report: normalizeReportMath(payload.report),
  };
  const mathErrors = validateReportMath(normalized.report);
  if (mathErrors.length) {
    throw new ExportError(
      '报告中存在无法渲染的学科公式，请重新生成报告后再下载',
      422,
      'EXPORT_INVALID_MATH',
      mathErrors.map((item) => `${item.path}: ${item.formula}`).join('; '),
    );
  }
  return normalized;
}

function formatDateTime(isoDate) {
  const date = new Date(isoDate);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function safeFilenamePart(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function buildDownloadFilename(payload, extension) {
  const date = new Date(payload.report.generatedAt);
  const stamp = Number.isNaN(date.getTime())
    ? '报告'
    : `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `AI错因诊断报告-${safeFilenamePart(payload.subject) || '学科'}-${stamp}.${extension}`;
}

async function getInlineKatexCss() {
  if (katexCssPromise) return katexCssPromise;
  katexCssPromise = (async () => {
    const cssPath = require.resolve('katex/dist/katex.min.css');
    const distDirectory = path.dirname(cssPath);
    let css = await fsPromises.readFile(cssPath, 'utf8');
    const files = [...css.matchAll(/url\(fonts\/([^\)]+)\)/g)].map((match) => match[1].replace(/["']/g, ''));
    for (const filename of [...new Set(files)]) {
      const fontPath = path.join(distDirectory, 'fonts', filename);
      const data = await fsPromises.readFile(fontPath);
      const extension = path.extname(filename).toLowerCase();
      const mime = extension === '.woff2' ? 'font/woff2' : extension === '.woff' ? 'font/woff' : 'font/ttf';
      css = css.replaceAll(`url(fonts/${filename})`, `url(data:${mime};base64,${data.toString('base64')})`);
    }
    return css;
  })();
  return katexCssPromise;
}

function moduleHtml(number, title, colorClass, body) {
  return `<section class="module ${colorClass}">
    <div class="module-title"><span>${number}</span><h2>${escapeHtml(title)}</h2></div>
    <div class="module-body">${body}</div>
  </section>`;
}

function buildTimelineHtml(report) {
  return report.timeline.map((item) => {
    const statusClass = item.status === '正确'
      ? 'correct'
      : item.status === '首次出错'
        ? 'error'
        : item.status === '未判断'
          ? 'unknown'
          : 'affected';
    return `<div class="timeline-item ${statusClass}">
      <span class="timeline-number">${item.stepNumber}</span>
      <strong>${escapeHtml(item.stepName)}</strong>
      <em>${escapeHtml(item.status)}</em>
      <p>${renderRichTextToHtml(item.detail)}</p>
    </div>`;
  }).join('');
}

function buildModulesHtml(report) {
  const affected = report.timeline.filter((item) => item.stepNumber > report.firstError.stepNumber);
  const chainItems = (affected.length ? affected : report.timeline.filter((item) => item.status === '未判断')).map((item) => (
    `<li><strong>第${item.stepNumber}步 ${escapeHtml(item.stepName)}：${escapeHtml(item.status)}</strong><p>${renderRichTextToHtml(item.detail)}</p></li>`
  )).join('');
  const checklist = report.correction.checklist.map((item) => `<li>${renderRichTextToHtml(item)}</li>`).join('');

  return [
    moduleHtml(1, '首个错误位置', 'theme-red', `
      <h3>${report.firstError.stepNumber === 0 ? '信息不足：无法确定' : `第${report.firstError.stepNumber}步：${escapeHtml(report.firstError.stepName)}`}</h3>
      <p>${renderRichTextToHtml(report.firstError.description)}</p>
      <p class="muted">影响：${renderRichTextToHtml(report.firstError.impact)}</p>`),
    moduleHtml(2, '错误证据', 'theme-red', `<blockquote>${renderRichTextToHtml(report.evidence)}</blockquote>`),
    moduleHtml(3, '错因类型', 'theme-red', `
      <div class="error-badge">${escapeHtml(report.errorType)}</div>
      <p>${renderRichTextToHtml(report.errorTypeReason)}</p>`),
    moduleHtml(4, '后续错误链', 'theme-blue', `<ol class="chain-list">${chainItems}</ol>`),
    moduleHtml(5, '学生自判与AI判断', 'theme-blue', `
      <div class="comparison-row"><strong>学生自判</strong><span class="student">${renderRichTextToHtml(report.comparison.studentJudgment)}</span></div>
      <div class="comparison-row"><strong>AI判断</strong><span class="ai">${renderRichTextToHtml(report.comparison.aiJudgment)}</span></div>
      <p class="comparison-result">结论：${renderRichTextToHtml(report.comparison.conclusion)}</p>`),
    moduleHtml(6, '下一步纠正动作', 'theme-teal', `
      <div class="action-box">${renderRichTextToHtml(report.correction.action)}</div>
      <ol class="checklist">${checklist}</ol>
      <p class="muted">${renderRichTextToHtml(report.correction.rationale)}</p>`),
  ].join('');
}

async function buildReportHtml(input) {
  const payload = preparePayload(input);
  const { report } = payload;
  const katexCss = await getInlineKatexCss();
  const firstError = report.firstError.stepNumber === 0 ? '无法确定' : `第${report.firstError.stepNumber}步`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>AI错因诊断报告</title>
  <style>${katexCss}</style>
  <style>
    @page { size: A4 portrait; margin: 14mm 13mm 16mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #171b22; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif; font-size: 10.5pt; line-height: 1.7; }
    body { background: #fff; }
    .report-header { display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 8mm; border-bottom: 1px solid #d4dae3; break-inside: avoid-page; }
    .report-header h1 { margin: 0; font-size: 24pt; line-height: 1.15; }
    .report-header p { margin: 2mm 0 0; color: #687384; }
    .meta { text-align: right; color: #687384; font-size: 9pt; }
    .summary { display: grid; grid-template-columns: 1fr 1fr; margin: 7mm 0 6mm; border: 1px solid #c5ceda; border-radius: 3mm; break-inside: avoid-page; }
    .summary div { padding: 5mm; color: #d91f25; font-size: 15pt; font-weight: 800; text-align: center; }
    .summary div + div { border-left: 1px solid #c5ceda; }
    .timeline { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-bottom: 6mm; break-inside: avoid-page; }
    .timeline-item { padding: 3mm; border-top: 3px solid #e5252b; text-align: center; }
    .timeline-item.correct { border-color: #0b8983; }
    .timeline-number { display: grid; width: 8mm; height: 8mm; place-items: center; margin: -7mm auto 2mm; border-radius: 50%; color: #fff; background: #e5252b; font-weight: 800; }
    .timeline-item.correct .timeline-number { background: #0b8983; }
    .timeline-item.unknown .timeline-number { background: #8490a0; }
    .timeline-item strong { display: block; }
    .timeline-item em { display: inline-block; margin-top: 1.5mm; padding: 0.5mm 2.5mm; border-radius: 2mm; color: #d91f25; background: #fae6e7; font-style: normal; font-weight: 700; }
    .timeline-item.correct em { color: #08746f; background: #e2f2f1; }
    .timeline-item p { margin: 2mm 0 0; color: #687384; font-size: 8.5pt; }
    .module { margin: 0 0 5mm; overflow: hidden; border: 1px solid #cfd7e1; border-radius: 3mm; break-inside: avoid-page; page-break-inside: avoid; box-decoration-break: clone; }
    .module:last-child { margin-bottom: 0; }
    .module-title { display: flex; align-items: center; gap: 3mm; min-height: 12mm; padding: 2.5mm 4mm; border-bottom: 1px solid #d8dde5; background: #f7f8f9; }
    .module-title span { display: grid; width: 7mm; height: 7mm; place-items: center; border-radius: 2mm; color: #fff; background: #e5252b; font-weight: 800; }
    .module-title h2 { margin: 0; font-size: 13pt; }
    .module-body { padding: 4mm 5mm; }
    .module-body h3 { margin: 0 0 2mm; color: #e5252b; font-size: 12pt; }
    .module-body p { margin: 2mm 0; orphans: 3; widows: 3; }
    .module.theme-red { border-color: #efb9bb; }
    .module.theme-blue .module-title span { background: #147ac1; }
    .module.theme-teal { border-color: #b7dcdc; }
    .module.theme-teal .module-title { background: #f0f8f8; }
    .module.theme-teal .module-title span { background: #0b8983; }
    blockquote { margin: 0; padding: 4mm 6mm; border-radius: 2mm; background: #f9e3e4; font-size: 11.5pt; text-align: center; }
    .error-badge { display: table; margin: 0 auto 3mm; padding: 2mm 6mm; border-radius: 2mm; color: #fff; background: #e5252b; font-weight: 800; }
    .chain-list, .checklist { margin: 0; padding-left: 7mm; }
    .chain-list li, .checklist li { margin: 2mm 0; break-inside: avoid; }
    .chain-list p { margin: 0.5mm 0 0; color: #687384; }
    .comparison-row { display: grid; grid-template-columns: 35mm 1fr; align-items: center; gap: 3mm; padding: 2mm 0; border-bottom: 1px solid #d9dee5; }
    .comparison-row span { padding: 1.5mm 3mm; border-radius: 2mm; text-align: center; }
    .comparison-row .student { color: #a96e00; background: #fff5dc; }
    .comparison-row .ai { color: #08746f; background: #e2f2f1; }
    .comparison-result { text-align: center; }
    .action-box { padding: 3mm 4mm; border: 1px solid #8fcaca; border-radius: 2mm; color: #08746f; font-weight: 800; }
    .muted { color: #687384; }
    .formula-inline { display: inline-block; max-width: 100%; vertical-align: middle; }
    .formula-display { margin: 2mm 0; overflow: visible; text-align: center; }
    .katex-display { margin: 0.4em 0; overflow: visible; }
    .katex { font-size: 1.04em; }
  </style>
</head>
<body>
  <header class="report-header">
    <div><h1>AI 错因诊断报告</h1><p>${escapeHtml(payload.subject)} · 找到第一次真正出错的位置</p></div>
    <div class="meta">${payload.sourceFilename ? `题目：${escapeHtml(payload.sourceFilename)}<br>` : ''}生成时间：${escapeHtml(formatDateTime(report.generatedAt))}</div>
  </header>
  <section class="summary"><div>首个错误：${escapeHtml(firstError)}</div><div>错因类型：${escapeHtml(report.errorType)}</div></section>
  <section class="timeline">${buildTimelineHtml(report)}</section>
  <main>${buildModulesHtml(report)}</main>
</body>
</html>`;
}

function findChromeExecutable() {
  const candidates = [
    process.env.PDF_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

async function generatePdf(input) {
  const payload = preparePayload(input);
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    throw new ExportError('服务器未找到可用的 Chrome/Chromium，无法生成 PDF', 500, 'PDF_ENGINE_UNAVAILABLE');
  }

  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--font-render-hinting=none'],
    });
    const page = await browser.newPage();
    await page.setContent(await buildReportHtml(payload), { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts.ready);
    const reviewText = payload.report.needsTeacherReview ? '需要教师复核' : 'AI诊断完成';
    const footerTemplate = `<div style="box-sizing:border-box;display:flex;width:100%;align-items:center;justify-content:space-between;margin:0 13mm;padding:2mm 4mm;border-radius:2mm;color:#586474;background:#edf0f4;font-family:'Microsoft YaHei','PingFang SC',Arial,sans-serif;font-size:9px;line-height:1.2;">
      <strong style="color:#3f4956;">${escapeHtml(reviewText)}</strong>
      <span>第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</span>
      <span>置信度：${Math.round(payload.report.confidence * 100)}%</span>
    </div>`;
    const data = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate,
      tagged: true,
      outline: true,
    });
    return { buffer: Buffer.from(data), filename: buildDownloadFilename(payload, 'pdf') };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('PDF 生成失败，请稍后重试', 500, 'PDF_EXPORT_FAILED', error.message);
  } finally {
    if (browser) await browser.close();
  }
}

function docxTextRun(text, options = {}) {
  return new TextRun({
    text,
    font: 'Microsoft YaHei',
    size: options.size || 22,
    bold: Boolean(options.bold),
    color: options.color || COLORS.ink,
  });
}

async function richTextParagraphs(input, options = {}, formulaRegistry) {
  const segments = splitMathSegments(normalizeMathText(input));
  const paragraphs = [];
  let runs = [];

  const flush = () => {
    if (!runs.length) return;
    paragraphs.push(new Paragraph({
      children: runs,
      alignment: options.alignment || AlignmentType.LEFT,
      keepLines: true,
      widowControl: true,
      spacing: { after: options.after ?? 100, line: 340 },
      ...(options.keepNext ? { keepNext: true } : {}),
      ...(options.shading ? { shading: options.shading } : {}),
    }));
    runs = [];
  };

  for (const segment of segments) {
    if (segment.type === 'text') {
      const lines = segment.value.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line) runs.push(docxTextRun(line, options));
        if (index < lines.length - 1) flush();
      });
      continue;
    }

    if (!formulaRegistry) throw new Error('Word 公式注册器未初始化');
    const placeholder = docxTextRun(formulaRegistry.register(segment.value, segment.display), options);
    if (segment.display) {
      flush();
      paragraphs.push(new Paragraph({
        children: [placeholder],
        alignment: AlignmentType.CENTER,
        keepLines: true,
        spacing: { before: 80, after: 120 },
      }));
    } else {
      runs.push(placeholder);
    }
  }
  flush();
  if (!paragraphs.length) paragraphs.push(new Paragraph({ children: [docxTextRun('')] }));
  return paragraphs;
}

function tableBorders(color, size = 6) {
  const border = { style: BorderStyle.SINGLE, size, color };
  return { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
}

function spacer(height = 100) {
  return new Paragraph({ spacing: { after: height }, children: [] });
}

function moduleCard(number, title, color, paragraphs) {
  const titleParagraph = new Paragraph({
    keepNext: true,
    shading: { fill: color === COLORS.teal ? COLORS.tealSoft : color === COLORS.blue ? COLORS.blueSoft : COLORS.redSoft, type: ShadingType.CLEAR },
    spacing: { before: 40, after: 120 },
    children: [
      new TextRun({ text: ` ${number} `, bold: true, color: 'FFFFFF', shading: { fill: color, type: ShadingType.CLEAR }, font: 'Microsoft YaHei', size: 22 }),
      docxTextRun(`  ${title}`, { bold: true, size: 26 }),
    ],
  });
  return new Table({
    width: { size: A4_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [A4_CONTENT_WIDTH],
    rows: [new TableRow({
      cantSplit: true,
      children: [new TableCell({
        width: { size: A4_CONTENT_WIDTH, type: WidthType.DXA },
        borders: tableBorders(color, 7),
        margins: { top: 120, bottom: 140, left: 180, right: 180 },
        children: [titleParagraph, ...paragraphs],
      })],
    })],
  });
}

async function buildDocxDocument(input) {
  const payload = preparePayload(input);
  const { report } = payload;
  const children = [];
  const formulaRegistry = new WordFormulaRegistry();

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [docxTextRun('AI 错因诊断报告', { bold: true, size: 40 })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 260 },
    children: [docxTextRun(`${payload.subject} · 找到第一次真正出错的位置`, { color: COLORS.muted, size: 20 })],
  }));

  const firstError = report.firstError.stepNumber === 0 ? '无法确定' : `第${report.firstError.stepNumber}步`;
  children.push(new Table({
    width: { size: A4_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [5103, 5103],
    rows: [new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: 5103, type: WidthType.DXA }, borders: tableBorders(COLORS.line), shading: { fill: 'FAFBFC', type: ShadingType.CLEAR }, margins: { top: 160, bottom: 160, left: 120, right: 120 }, verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [docxTextRun(`首个错误：${firstError}`, { bold: true, color: COLORS.red, size: 27 })] })],
        }),
        new TableCell({
          width: { size: 5103, type: WidthType.DXA }, borders: tableBorders(COLORS.line), shading: { fill: 'FAFBFC', type: ShadingType.CLEAR }, margins: { top: 160, bottom: 160, left: 120, right: 120 }, verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [docxTextRun(`错因类型：${report.errorType}`, { bold: true, color: COLORS.red, size: 27 })] })],
        }),
      ],
    })],
  }));
  children.push(spacer(220));

  const timelineCellWidth = Math.floor(A4_CONTENT_WIDTH / 4);
  const timelineWidths = [timelineCellWidth, timelineCellWidth, timelineCellWidth, A4_CONTENT_WIDTH - timelineCellWidth * 3];
  const timelineCells = [];
  for (let index = 0; index < report.timeline.length; index += 1) {
    const item = report.timeline[index];
    timelineCells.push(new TableCell({
      width: { size: timelineWidths[index], type: WidthType.DXA },
      borders: tableBorders(item.status === '正确' ? COLORS.teal : COLORS.red),
      margins: { top: 120, bottom: 120, left: 80, right: 80 },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [docxTextRun(`${item.stepNumber}  ${item.stepName}`, { bold: true, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [docxTextRun(item.status, { bold: true, color: item.status === '正确' ? COLORS.teal : COLORS.red, size: 19 })] }),
        ...await richTextParagraphs(item.detail, { alignment: AlignmentType.CENTER, color: COLORS.muted, size: 17, after: 40 }, formulaRegistry),
      ],
    }));
  }
  children.push(new Table({
    width: { size: A4_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: timelineWidths,
    rows: [new TableRow({
      cantSplit: true,
      children: timelineCells,
    })],
  }));
  children.push(spacer(240));

  const firstLocationParagraphs = [
    new Paragraph({ keepNext: true, children: [docxTextRun(report.firstError.stepNumber === 0 ? '信息不足：无法确定' : `第${report.firstError.stepNumber}步：${report.firstError.stepName}`, { bold: true, color: COLORS.red, size: 24 })], spacing: { after: 80 } }),
    ...await richTextParagraphs(report.firstError.description, {}, formulaRegistry),
    ...await richTextParagraphs(`影响：${report.firstError.impact}`, { color: COLORS.muted }, formulaRegistry),
  ];
  children.push(moduleCard(1, '首个错误位置', COLORS.red, firstLocationParagraphs), spacer());
  children.push(moduleCard(2, '错误证据', COLORS.red, await richTextParagraphs(report.evidence, { alignment: AlignmentType.CENTER, size: 23 }, formulaRegistry)), spacer());
  children.push(moduleCard(3, '错因类型', COLORS.red, [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { after: 100 }, children: [new TextRun({ text: `  ${report.errorType}  `, bold: true, color: 'FFFFFF', shading: { fill: COLORS.red, type: ShadingType.CLEAR }, font: 'Microsoft YaHei', size: 23 })] }),
    ...await richTextParagraphs(report.errorTypeReason, { alignment: AlignmentType.CENTER }, formulaRegistry),
  ]), spacer());

  const chainParagraphs = [];
  const affected = report.timeline.filter((item) => item.stepNumber > report.firstError.stepNumber);
  for (const item of (affected.length ? affected : report.timeline.filter((entry) => entry.status === '未判断'))) {
    chainParagraphs.push(new Paragraph({ keepNext: true, children: [docxTextRun(`第${item.stepNumber}步 ${item.stepName}：${item.status}`, { bold: true, color: COLORS.red })], spacing: { before: 60, after: 40 } }));
    chainParagraphs.push(...await richTextParagraphs(item.detail, { color: COLORS.muted }, formulaRegistry));
  }
  children.push(moduleCard(4, '后续错误链', COLORS.blue, chainParagraphs), spacer());

  children.push(moduleCard(5, '学生自判与AI判断', COLORS.blue, [
    ...await richTextParagraphs(`学生自判：${report.comparison.studentJudgment}`, { bold: true, color: COLORS.amber, keepNext: true, shading: { fill: COLORS.amberSoft, type: ShadingType.CLEAR }, after: 80 }, formulaRegistry),
    ...await richTextParagraphs(`AI判断：${report.comparison.aiJudgment}`, { bold: true, color: COLORS.teal, keepNext: true, shading: { fill: COLORS.tealSoft, type: ShadingType.CLEAR }, after: 80 }, formulaRegistry),
    ...await richTextParagraphs(`结论：${report.comparison.conclusion}`, { alignment: AlignmentType.CENTER }, formulaRegistry),
  ]), spacer());

  const correctionParagraphs = [
    ...await richTextParagraphs(report.correction.action, { bold: true, color: COLORS.teal, alignment: AlignmentType.CENTER, size: 24 }, formulaRegistry),
  ];
  for (let index = 0; index < report.correction.checklist.length; index += 1) {
    correctionParagraphs.push(...await richTextParagraphs(`${index + 1}. ${report.correction.checklist[index]}`, {}, formulaRegistry));
  }
  correctionParagraphs.push(...await richTextParagraphs(report.correction.rationale, { color: COLORS.muted, alignment: AlignmentType.CENTER }, formulaRegistry));
  children.push(moduleCard(6, '下一步纠正动作', COLORS.teal, correctionParagraphs), spacer(180));

  children.push(new Table({
    width: { size: A4_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [5103, 5103],
    rows: [new TableRow({
      cantSplit: true,
      children: [
        new TableCell({ width: { size: 5103, type: WidthType.DXA }, borders: tableBorders('E4E8ED'), shading: { fill: 'EDF0F4', type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [docxTextRun(report.needsTeacherReview ? '需要教师复核' : 'AI诊断完成', { bold: true, color: COLORS.muted })] })] }),
        new TableCell({ width: { size: 5103, type: WidthType.DXA }, borders: tableBorders('E4E8ED'), shading: { fill: 'EDF0F4', type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [docxTextRun(`生成时间：${formatDateTime(report.generatedAt)}`, { color: COLORS.muted, size: 18 })] })] }),
      ],
    })],
  }));

  const document = new Document({
    styles: {
      default: { document: { run: { font: 'Microsoft YaHei', size: 22, color: COLORS.ink }, paragraph: { spacing: { line: 340 } } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 850, right: 850, bottom: 900, left: 850, header: 360, footer: 360 },
        },
      },
      headers: {
        default: new Header({ children: [new Paragraph({ children: [docxTextRun(`AI 错因诊断 · ${payload.subject}`, { color: COLORS.muted, size: 17 })] })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [docxTextRun('第 ', { color: COLORS.muted, size: 17 }), new TextRun({ children: [PageNumber.CURRENT], color: COLORS.muted, size: 17 }), docxTextRun(' 页', { color: COLORS.muted, size: 17 })] })] }),
      },
      children,
    }],
  });
  const packedBuffer = await Packer.toBuffer(document);
  const buffer = await formulaRegistry.inject(packedBuffer);
  return { buffer, filename: buildDownloadFilename(payload, 'docx') };
}

async function buildDocx(input) {
  try {
    return await buildDocxDocument(input);
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('Word 生成失败，请稍后重试', 500, 'DOCX_EXPORT_FAILED', error.message);
  }
}

module.exports = {
  ExportError,
  buildDocx,
  buildDownloadFilename,
  buildReportHtml,
  generatePdf,
};

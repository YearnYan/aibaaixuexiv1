const CAPTURE_SCALE = 2;
const PAGE_RATIO = 1.475;
const BLOCK_GAP = 18;

function createPage(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  return { canvas, context, usedHeight: 0 };
}

function appendBlockToPages(pages, blockCanvas, pageWidth, pageHeight, gap) {
  let page = pages.at(-1);
  let blockGap = page.usedHeight > 0 ? gap : 0;

  if (page.usedHeight > 0 && page.usedHeight + blockGap + blockCanvas.height > pageHeight) {
    page = createPage(pageWidth, pageHeight);
    pages.push(page);
    blockGap = 0;
  }

  // 极端超高块整体缩放到单页，仍不允许在像素层切开内容。
  const scale = blockCanvas.height > pageHeight ? pageHeight / blockCanvas.height : 1;
  const targetWidth = Math.round(pageWidth * scale);
  const targetHeight = Math.round(blockCanvas.height * scale);
  const targetX = Math.round((pageWidth - targetWidth) / 2);
  const targetY = page.usedHeight + blockGap;
  page.context.drawImage(blockCanvas, targetX, targetY, targetWidth, targetHeight);
  page.usedHeight = targetY + targetHeight;
}

async function captureReportPages(reportElement) {
  if (!reportElement) throw new Error('报告尚未准备完成。');
  await document.fonts?.ready;

  const [{ default: html2canvas }] = await Promise.all([import('html2canvas')]);
  const blocks = [...reportElement.querySelectorAll('[data-export-block]')];
  if (!blocks.length) throw new Error('报告内容为空。');

  const firstWidth = Math.max(1, Math.round(blocks[0].getBoundingClientRect().width * CAPTURE_SCALE));
  const pageHeight = Math.round(firstWidth * PAGE_RATIO);
  const gap = Math.round(BLOCK_GAP * CAPTURE_SCALE);
  const pages = [createPage(firstWidth, pageHeight)];

  for (const block of blocks) {
    const blockCanvas = await html2canvas(block, {
      scale: CAPTURE_SCALE,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      imageTimeout: 15000,
      onclone: (clonedDocument) => {
        const report = clonedDocument.querySelector('[data-export-report]');
        if (report) {
          report.style.position = 'absolute';
          report.style.left = '0';
          report.style.top = '0';
        }
      },
    });
    appendBlockToPages(pages, blockCanvas, firstWidth, pageHeight, gap);
    blockCanvas.width = 1;
    blockCanvas.height = 1;
  }

  return pages.map(({ canvas }) => canvas);
}

function formatFileDate(value) {
  const date = new Date(value || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, '0');
  const day = String(safeDate.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function releasePages(pages) {
  pages.forEach((page) => {
    page.width = 1;
    page.height = 1;
  });
}

export async function exportReportToPdf(reportElement, session) {
  const pages = await captureReportPages(reportElement);
  try {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const imageWidth = 174;
    const imageHeight = imageWidth * PAGE_RATIO;

    pages.forEach((page, index) => {
      if (index > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(page.toDataURL('image/png'), 'PNG', 18, 15, imageWidth, imageHeight, undefined, 'FAST');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(95, 95, 95);
      pdf.text(`${index + 1} / ${pages.length}`, 105, 287, { align: 'center' });
    });

    pdf.save(`AI解题步骤报告-${formatFileDate(session.generatedAt)}.pdf`);
  } finally {
    releasePages(pages);
  }
}

export async function exportReportToWord(session) {
  const blob = await buildEditableWordBlob(session);
  downloadBlob(blob, `AI解题步骤报告-${formatFileDate(session.generatedAt)}.docx`);
}
import { buildEditableWordBlob } from './editable-word.js';

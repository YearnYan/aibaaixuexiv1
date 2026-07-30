function safeFilename(value) {
  return String(value || '备课教案').replace(/[\\/:*?"<>|]/g, '-');
}

const HTML2CANVAS_COLOR_PROPERTIES = [
  'color', 'background-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color',
  'column-rule-color', 'box-shadow', 'text-shadow', 'fill', 'stroke', 'flood-color',
  'stop-color', '-webkit-text-fill-color', '-webkit-text-stroke-color'
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function colorChannel(value) {
  const source = String(value || '').trim();
  const number = Number.parseFloat(source);
  const normalized = source.endsWith('%') ? number / 100 : number;
  return Math.round(clamp(Number.isFinite(normalized) ? normalized : 0, 0, 1) * 255);
}

function colorAlpha(value) {
  if (value == null || value === '') return 1;
  const source = String(value).trim();
  const number = Number.parseFloat(source);
  const normalized = source.endsWith('%') ? number / 100 : number;
  return Number(clamp(Number.isFinite(normalized) ? normalized : 1, 0, 1).toFixed(4));
}

export function normalizeCanvasColorValue(value) {
  return String(value || '').replace(
    /color\(\s*srgb\s+(-?(?:\d+(?:\.\d*)?|\.\d+)%?)\s+(-?(?:\d+(?:\.\d*)?|\.\d+)%?)\s+(-?(?:\d+(?:\.\d*)?|\.\d+)%?)(?:\s*\/\s*(-?(?:\d+(?:\.\d*)?|\.\d+)%?))?\s*\)/gi,
    (_, red, green, blue, alpha) => `rgba(${colorChannel(red)}, ${colorChannel(green)}, ${colorChannel(blue)}, ${colorAlpha(alpha)})`
  );
}

export function stabilizeCloneColors(root) {
  if (!root || typeof getComputedStyle !== 'function') return;
  for (const element of [root, ...root.querySelectorAll('*')]) {
    const computed = getComputedStyle(element);
    for (const property of HTML2CANVAS_COLOR_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      const normalized = normalizeCanvasColorValue(value);
      if (normalized !== value) element.style.setProperty(property, normalized, 'important');
    }
  }
}

export function getCanvasScale(canvas, elementRect) {
  return canvas.width / elementRect.width;
}

export function getCanvasVerticalOffset(canvas, elementRect) {
  const scale = getCanvasScale(canvas, elementRect);
  return Math.max(0, elementRect.height - canvas.height / scale);
}

function collectBreakpoints(documentElement, canvas, elementRect, selector, leadingSpace = 0) {
  // html2canvas 可能因内容裁切让画布高度与 DOM 高度略有偏差；
  // 宽度始终按 scale 精确缩放，用横向比例可避免分页点随页面向下逐渐漂移。
  const ratio = getCanvasScale(canvas, elementRect);
  const verticalOffset = getCanvasVerticalOffset(canvas, elementRect);
  return [...documentElement.querySelectorAll(selector)]
    .map((item) => Math.round((item.getBoundingClientRect().top - elementRect.top - verticalOffset - leadingSpace) * ratio))
    .filter((value) => value > 0 && value < canvas.height)
    .sort((a, b) => a - b);
}

export function paginate(canvasHeight, maxSliceHeight, breakpoints, sectionBreakpoints = []) {
  const cuts = [];
  let start = 0;
  while (start < canvasHeight) {
    const target = Math.min(canvasHeight, start + maxSliceHeight);
    if (target === canvasHeight) {
      cuts.push([start, canvasHeight]);
      break;
    }
    // 页尾保留缓冲区，避免下一模块只露出标题或卡片抬头。
    const safeTarget = target - Math.min(220, maxSliceHeight * 0.09);
    const minimumUsefulPage = start + maxSliceHeight * 0.48;
    const sectionCuts = sectionBreakpoints.filter((point) => point >= minimumUsefulPage && point <= safeTarget);
    const trailingSectionCuts = sectionBreakpoints.filter((point) => point > safeTarget && point <= target);
    const preferredCuts = breakpoints.filter((point) => point > start + 40 && point <= safeTarget);
    const fallbackCuts = breakpoints.filter((point) => point > start + 40 && point <= target);
    let end = sectionCuts.length
      ? sectionCuts[sectionCuts.length - 1]
      : trailingSectionCuts.length
      ? trailingSectionCuts[trailingSectionCuts.length - 1]
      : preferredCuts.length
      ? preferredCuts[preferredCuts.length - 1]
      : fallbackCuts.length
        ? fallbackCuts[fallbackCuts.length - 1]
        : target;
    if (end <= start + 40) end = target;
    cuts.push([start, end]);
    start = end;
  }
  return cuts;
}

export async function exportLessonPdf(sourceElement, form) {
  if (!sourceElement) throw new Error('没有找到可导出的教案内容');
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const host = document.createElement('div');
  host.className = 'pdf-export-host';
  const clone = sourceElement.cloneNode(true);
  clone.classList.add('pdf-export-document');
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    // html2canvas 1.x 不识别 Chromium 为 CSS Color 4 生成的 color(srgb ...) 计算值。
    stabilizeCloneColors(clone);
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const elementRect = clone.getBoundingClientRect();
    const canvas = await html2canvas(clone, {
      backgroundColor: '#fbfaf5',
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: 1200,
      scrollX: 0,
      scrollY: 0
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const margin = 10;
    const footerHeight = 7;
    const contentWidth = 210 - margin * 2;
    const contentHeight = 297 - margin * 2 - footerHeight;
    const maxSliceHeight = Math.floor(canvas.width * contentHeight / contentWidth);
    const sectionBreakpoints = collectBreakpoints(clone, canvas, elementRect, '.document-section, .document-footer');
    const itemBreakpoints = collectBreakpoints(clone, canvas, elementRect, [
      '.goal-evidence-list > section:not(:first-child)',
      '.document-flow-step:not(:first-child)',
      '.question-chain-list > section:not(:first-child)'
    ].join(','), 10);
    const cuts = paginate(canvas.height, maxSliceHeight, itemBreakpoints, sectionBreakpoints);
    const pageCanvas = document.createElement('canvas');
    const context = pageCanvas.getContext('2d', { alpha: false });

    cuts.forEach(([start, end], pageIndex) => {
      const sliceHeight = end - start;
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      context.fillStyle = '#fbfaf5';
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(canvas, 0, start, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      if (pageIndex > 0) pdf.addPage();
      const renderedHeight = contentWidth * sliceHeight / canvas.width;
      pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.94), 'JPEG', margin, margin, contentWidth, renderedHeight, undefined, 'FAST');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(120, 130, 124);
      pdf.text(`${pageIndex + 1} / ${cuts.length}`, 105, 291, { align: 'center' });
    });

    pdf.setProperties({
      title: `${form.lesson || '备课教案'} ${form.period || ''}`,
      subject: '教师备课教案',
      creator: '教师备课器'
    });
    pdf.save(`${safeFilename(form.lesson)}-${safeFilename(form.period)}.pdf`);
  } finally {
    host.remove();
  }
}

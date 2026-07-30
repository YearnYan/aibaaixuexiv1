import { sanitizeBlackboard } from './lessonText.js';
import { splitRichContent, svgToAccessibleText } from './scientificText.js';
import { createEditableWordMath } from './wordMath.js';
import { normalizeEducationalSvgMarkup } from './educationalSvg.js';

const DOC_GREEN = '1F6B55';
const DOC_GREEN_DARK = '173F34';
const DOC_GOLD = 'B28B2D';
const DOC_TEXT = '293A34';
const DOC_MUTED = '68756F';
const DOC_LINE = 'CDDAD4';
const DOC_FILL = 'EAF2EE';

function base64Bytes(value) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function loadImage(source) {
  const dataMatch = String(source || '').match(/^data:image\/(png|jpe?g|gif);base64,(.+)$/i);
  if (dataMatch) return { type: dataMatch[1].toLowerCase().replace('jpeg', 'jpg'), data: base64Bytes(dataMatch[2]) };
  if (!/^https:\/\//i.test(source)) return null;
  const response = await fetch(source);
  if (!response.ok) return null;
  const mime = response.headers.get('content-type') || '';
  const typeMatch = mime.match(/^image\/(png|jpe?g|gif)/i);
  if (!typeMatch) return null;
  return { type: typeMatch[1].toLowerCase().replace('jpeg', 'jpg'), data: new Uint8Array(await response.arrayBuffer()) };
}

function sectionLabel(index, title) {
  return `${index + 1}、${title}`;
}

function svgDisplaySize(svgElement, maxWidth, maxHeight) {
  const viewBox = String(svgElement.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const viewBoxWidth = viewBox.length === 4 && viewBox[2] > 0 ? viewBox[2] : 0;
  const viewBoxHeight = viewBox.length === 4 && viewBox[3] > 0 ? viewBox[3] : 0;
  const length = (name) => {
    const value = String(svgElement.getAttribute(name) || '').trim();
    if (!value || value.endsWith('%')) return 0;
    const number = Number.parseFloat(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };
  const naturalWidth = length('width') || viewBoxWidth || 16;
  const naturalHeight = length('height') || viewBoxHeight || 9;
  const ratio = naturalWidth / naturalHeight;
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

export async function rasterizeSvgToPng(svgMarkup, { maxWidth = 520, maxHeight = 340, scale = 2 } = {}) {
  const safeSvg = normalizeEducationalSvgMarkup(svgMarkup);
  if (!safeSvg) throw new Error('SVG 内容无法安全转换');
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined' || typeof Image === 'undefined') {
    throw new Error('当前环境不支持 SVG 图片转换');
  }

  const parsed = new DOMParser().parseFromString(safeSvg, 'image/svg+xml');
  const svgElement = parsed.documentElement;
  if (svgElement.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('SVG 内容格式无效');
  const { width, height } = svgDisplaySize(svgElement, maxWidth, maxHeight);
  const objectUrl = URL.createObjectURL(new Blob([safeSvg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('SVG 图形加载失败'));
      image.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建 SVG 转换画布');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('SVG 图形编码失败')),
      'image/png'
    ));
    return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function collectSvgMarkup(value, found = new Set()) {
  if (typeof value === 'string') {
    if (/svg|ｓｖｇ/i.test(value)) {
      splitRichContent(value).forEach((segment) => {
        if (segment.type === 'svg') found.add(segment.value);
      });
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSvgMarkup(item, found));
    return found;
  }
  if (value && typeof value === 'object') Object.values(value).forEach((item) => collectSvgMarkup(item, found));
  return found;
}

function svgAssetKey(svgMarkup) {
  return normalizeEducationalSvgMarkup(svgMarkup).replace(/>\s+</g, '><').trim();
}

function addWordBlackboardBackground(svgMarkup) {
  const normalized = normalizeEducationalSvgMarkup(svgMarkup, { blackboard: true });
  if (!normalized) return '';
  return normalized.replace(
    /^<svg\b[^>]*>/i,
    `$&<rect x="0" y="0" width="100%" height="100%" fill="#${DOC_GREEN_DARK}" />`
  );
}

function normalizeWordBlackboardContent(value) {
  return splitRichContent(sanitizeBlackboard(value)).map((segment) => {
    if (segment.type === 'svg') return addWordBlackboardBackground(segment.value);
    if (segment.type === 'math') {
      return `${segment.display ? '\\[' : '\\('}${segment.value}${segment.display ? '\\]' : '\\)'}`;
    }
    return segment.value;
  }).join('');
}

function normalizeLessonSvgContent(plan) {
  return {
    ...plan,
    sections: (plan.sections || []).map((section) => {
      const blackboard = section.layout === 'blackboard';
      return {
        ...section,
        blocks: (section.blocks || []).map((block) => {
          if (block.type === 'paragraph') {
            return { ...block, text: blackboard ? normalizeWordBlackboardContent(block.text) : block.text };
          }
          if (block.type === 'svg') {
            return {
              ...block,
              content: blackboard
                ? addWordBlackboardBackground(block.content)
                : normalizeEducationalSvgMarkup(block.content)
            };
          }
          return block;
        })
      };
    })
  };
}

async function createSvgAssetMap(plan, rasterizeSvg) {
  const assets = new Map();
  await Promise.all([...collectSvgMarkup(plan)].map(async (svgMarkup) => {
    const key = svgAssetKey(svgMarkup);
    if (!key) return;
    try {
      const asset = await rasterizeSvg(key);
      if (asset?.data) assets.set(key, asset);
    } catch {
      assets.set(key, null);
    }
  }));
  return assets;
}

export async function createDynamicLessonDocxBlob(plan, form, options = {}) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    Header,
    HeadingLevel,
    ImageRun,
    Math: WordMath,
    MathFraction,
    MathRadical,
    MathRoundBrackets,
    MathRun,
    MathSquareBrackets,
    MathSubScript,
    MathSubSuperScript,
    MathSuperScript,
    Packer,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType
  } = await import('docx');

  plan = normalizeLessonSvgContent(plan);
  const svgAssets = await createSvgAssetMap(plan, options.rasterizeSvg || rasterizeSvgToPng);
  const border = { style: BorderStyle.SINGLE, size: 4, color: DOC_LINE };
  const normalText = (text, options = {}) => new TextRun({ text: String(text || ''), color: DOC_TEXT, size: 22, ...options });
  const svgImageRun = (markup, description) => {
    const key = svgAssetKey(markup);
    const asset = key ? svgAssets.get(key) : null;
    if (!asset?.data) return null;
    return new ImageRun({
      data: asset.data,
      type: 'png',
      transformation: { width: asset.width || 520, height: asset.height || 340 },
      altText: { title: description, description, name: description }
    });
  };
  const richRuns = (text, options = {}) => splitRichContent(text).flatMap((segment) => {
    if (segment.type === 'text') return segment.value ? [normalText(segment.value, options)] : [];
    if (segment.type === 'svg') {
      const description = svgToAccessibleText(segment.value);
      return [svgImageRun(segment.value, description) || normalText(description, { ...options, italic: true, color: DOC_MUTED })];
    }
    return [createEditableWordMath(segment.value, {
      Math: WordMath,
      MathFraction,
      MathRadical,
      MathRoundBrackets,
      MathRun,
      MathSquareBrackets,
      MathSubScript,
      MathSubSuperScript,
      MathSuperScript
    })];
  });
  const bodyParagraph = (text, options = {}) => new Paragraph({ spacing: { after: 110, line: 300 }, children: richRuns(text), ...options });
  const labeledParagraph = (label, value) => new Paragraph({
    spacing: { after: 90, line: 300 },
    children: [...richRuns(label ? `${label}：` : '', { bold: true, color: DOC_GREEN_DARK }), ...richRuns(value)]
  });
  const heading = (text, level = HeadingLevel.HEADING_1) => new Paragraph({
    heading: level,
    keepNext: true,
    children: richRuns(text, { bold: true })
  });
  const itemHeading = (text, meta = '') => new Paragraph({
    heading: HeadingLevel.HEADING_3,
    keepNext: true,
    spacing: { before: 140, after: 80 },
    children: [
      ...richRuns(text, { bold: true, color: DOC_GREEN_DARK }),
      ...(meta ? [new TextRun({ text: `    ${meta}`, bold: true, color: DOC_GOLD, size: 20 })] : [])
    ]
  });
  const tableCell = (text, { header = false, width = 2340 } = {}) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    shading: header ? { fill: DOC_FILL, type: ShadingType.CLEAR } : undefined,
    borders: { top: border, bottom: border, left: border, right: border },
    children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: richRuns(text, { bold: header, color: header ? DOC_GREEN_DARK : DOC_TEXT, size: 20 }) })]
  });

  const blockChildren = async (block, section) => {
    if (block.type === 'paragraph') {
      const text = block.text;
      const alignment = block.align === 'center' ? AlignmentType.CENTER
        : block.align === 'right' ? AlignmentType.RIGHT
          : block.align === 'justify' ? AlignmentType.JUSTIFIED
            : AlignmentType.LEFT;
      return [bodyParagraph(text, { alignment })];
    }
    if (block.type === 'list') {
      return block.items.map((item, index) => bodyParagraph(`${block.style === 'ordered' ? `${index + 1}.` : block.style === 'check' ? '□' : '•'} ${item}`));
    }
    if (block.type === 'keyValue') return block.items.map((item) => labeledParagraph(item.label, item.value));
    if (block.type === 'cards' || block.type === 'timeline') {
      return block.items.flatMap((item, index) => [
        itemHeading(`${block.type === 'timeline' ? `${String(index + 1).padStart(2, '0')}  ` : ''}${item.title || `内容 ${index + 1}`}`, item.meta),
        ...(item.subtitle ? [bodyParagraph(item.subtitle, { children: richRuns(item.subtitle, { italic: true, color: DOC_MUTED }) })] : []),
        ...(item.body ? [bodyParagraph(item.body)] : []),
        ...item.fields.map((field) => labeledParagraph(field.label, field.value))
      ]);
    }
    if (block.type === 'table') {
      const columnCount = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
      const width = Math.floor(9360 / columnCount);
      const rows = [];
      if (block.headers.length) rows.push(new TableRow({ children: Array.from({ length: columnCount }, (_, index) => tableCell(block.headers[index] || '', { header: true, width })) }));
      block.rows.forEach((row) => rows.push(new TableRow({ children: Array.from({ length: columnCount }, (_, index) => tableCell(row[index] || '', { width })) })));
      return rows.length ? [new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: Array(columnCount).fill(width), rows })] : [];
    }
    if (block.type === 'image') {
      try {
        const image = await loadImage(block.src);
        if (image) {
          return [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 80, after: 80 },
              children: [new ImageRun({
                data: image.data,
                type: image.type,
                transformation: { width: 520, height: 320 },
                altText: { title: block.alt || '教学图片', description: block.caption || block.alt || '教学图片', name: block.alt || '教学图片' }
              })]
            }),
            ...(block.caption ? [bodyParagraph(block.caption, { alignment: AlignmentType.CENTER, children: richRuns(block.caption, { color: DOC_MUTED, size: 19 }) })] : [])
          ];
        }
      } catch {
        // 远程图片无法读取时保留可编辑的图片说明，避免导出失败。
      }
      return [bodyParagraph(`【图片：${block.alt || block.caption || '图片暂无法嵌入'}】`, { alignment: AlignmentType.CENTER })];
    }
    if (block.type === 'svg') {
      const description = svgToAccessibleText(block.content);
      const image = svgImageRun(block.content, block.caption || description);
      if (!image) return [bodyParagraph(`${description}${block.caption ? ` ${block.caption}` : ''}`, { alignment: AlignmentType.CENTER })];
      return [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 80 }, children: [image] }),
        ...(block.caption ? [bodyParagraph(block.caption, {
          alignment: AlignmentType.CENTER,
          children: richRuns(block.caption, { color: DOC_MUTED, size: 19 })
        })] : [])
      ];
    }
    if (block.type === 'divider') return [bodyParagraph('────────────────────────', { alignment: AlignmentType.CENTER })];
    return [];
  };

  const cover = plan.cover || {};
  const title = cover.title || plan.title || `《${form.lesson || '本课'}》备课方案`;
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 140, after: 100 }, children: richRuns(cover.kicker || '教 师 备 课 教 案', { bold: true, color: DOC_GOLD, size: 20 }) }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: richRuns(title, { bold: true, color: DOC_GREEN_DARK, size: 38 }) }),
    ...(cover.subtitle ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 260 }, children: richRuns(cover.subtitle, { color: DOC_MUTED, size: 20 }) })] : [])
  ];

  if (Array.isArray(cover.meta) && cover.meta.length) {
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2200, 7160],
      rows: cover.meta.map((item) => new TableRow({ children: [tableCell(item.label || '', { header: true, width: 2200 }), tableCell(item.value || '', { width: 7160 })] }))
    }), bodyParagraph('', { spacing: { after: 80 } }));
  }

  for (let sectionIndex = 0; sectionIndex < plan.sections.length; sectionIndex += 1) {
    const section = plan.sections[sectionIndex];
    children.push(heading(sectionLabel(sectionIndex, section.title)));
    for (const block of section.blocks) children.push(...await blockChildren(block, section));
  }
  if (plan.footer?.note) children.push(bodyParagraph(plan.footer.note, { spacing: { before: 220, after: 0 }, children: richRuns(plan.footer.note, { color: DOC_MUTED, size: 19 }) }));

  const doc = new Document({
    creator: '教师备课器',
    title,
    description: 'AI 对话全局优化后的可编辑动态教案',
    styles: {
      default: {
        document: { run: { font: 'Microsoft YaHei', size: 22, color: DOC_TEXT }, paragraph: { spacing: { after: 120, line: 300 } } },
        heading1: { run: { font: 'Microsoft YaHei', size: 32, bold: true, color: DOC_GREEN }, paragraph: { spacing: { before: 360, after: 200 }, keepNext: true } },
        heading2: { run: { font: 'Microsoft YaHei', size: 26, bold: true, color: DOC_GREEN_DARK }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true } },
        heading3: { run: { font: 'Microsoft YaHei', size: 24, bold: true, color: DOC_GOLD }, paragraph: { spacing: { before: 180, after: 100 }, keepNext: true } }
      }
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 900, right: 900, bottom: 900, left: 900, header: 420, footer: 420 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: richRuns([form.grade, form.subject, form.lesson].filter(Boolean).join(' · '), { color: DOC_MUTED, size: 17 }) })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['教师备课教案  ·  第 ', PageNumber.CURRENT, ' 页'], color: DOC_MUTED, size: 17 })] })] }) },
      children
    }]
  });

  return Packer.toBlob(doc);
}

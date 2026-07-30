const JSZipModule = require('jszip');
const { mml2omml } = require('mathml2omml');
const {
  assertWordFormulaOmmlSourceFree,
  assertWordVisibleTextSourceFree,
  normalizeWordFormulaOmml
} = require('../shared/word-export-quality');

const JSZip = JSZipModule.default || JSZipModule;
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const FIGURE_WIDTH_EMU = 2667000;
const FIGURE_HEIGHT_EMU = 2000250;

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeText(value) {
  return String(value ?? '').replace(/[\t\f\v ]+/g, ' ');
}

function createRun(text, options = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return '';
  const properties = [
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>',
    options.bold ? '<w:b/><w:bCs/>' : '',
    `<w:sz w:val="${options.size || 24}"/><w:szCs w:val="${options.size || 24}"/>`
  ].join('');
  return `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${escapeXml(normalized)}</w:t></w:r>`;
}

function getElementChildren(element) {
  return Array.from(element?.children || []);
}

function cloneUnwrappedArgument(element) {
  let current = element;
  while (
    current
    && ['mpadded', 'mrow'].includes(current.localName)
    && getElementChildren(current).length === 1
  ) {
    current = getElementChildren(current)[0];
  }
  return current?.cloneNode(true) || null;
}

function isZeroWidthPhantom(element) {
  if (element?.localName !== 'mpadded') return false;
  const width = String(element.getAttribute('width') || '').trim().toLowerCase();
  return /^(?:0|0px|0em|0ex)$/.test(width) && Boolean(element.querySelector('mphantom'));
}

function normalizeMathmlForOmml(math) {
  const clone = math.cloneNode(true);
  clone.querySelectorAll('annotation').forEach((node) => node.remove());

  // mhchem 用零宽幻影 X 把上下标贴到前一个元素；Word 需要真实的脚本基元素。
  clone.querySelectorAll('msub, msup, msubsup').forEach((script) => {
    const children = getElementChildren(script);
    const previous = script.previousElementSibling;
    if (!previous || !isZeroWidthPhantom(children[0])) return;

    const replacement = script.cloneNode(false);
    replacement.appendChild(previous.cloneNode(true));
    for (const argument of children.slice(1)) {
      const normalizedArgument = cloneUnwrappedArgument(argument);
      if (normalizedArgument) replacement.appendChild(normalizedArgument);
    }
    previous.remove();
    script.replaceWith(replacement);
  });

  clone.querySelectorAll('mover, munder').forEach((limit) => {
    const children = getElementChildren(limit);
    if (children.length === 2 && !String(children[1].textContent || '').trim()) {
      limit.replaceWith(children[0]);
    }
  });
  clone.querySelectorAll('munderover').forEach((limit) => {
    const children = getElementChildren(limit);
    const underEmpty = children[1] && !String(children[1].textContent || '').trim();
    const overEmpty = children[2] && !String(children[2].textContent || '').trim();
    if (underEmpty && overEmpty) limit.replaceWith(children[0]);
  });

  clone.querySelectorAll('mphantom').forEach((node) => node.remove());
  clone.querySelectorAll('mpadded').forEach((node) => node.replaceWith(...Array.from(node.childNodes)));
  clone.querySelectorAll('mrow').forEach((node) => {
    if (node.childNodes.length === 0 && !String(node.textContent || '').trim()) node.remove();
  });
  return clone;
}

function mathElementToOmml(formulaElement) {
  const math = formulaElement.querySelector('.katex-mathml math') || formulaElement.querySelector('math');
  if (!math) throw new Error('公式缺少可转换的 MathML 结构');

  const clone = normalizeMathmlForOmml(math);
  const mathml = new XMLSerializer().serializeToString(clone);
  const omml = normalizeWordFormulaOmml(
    mml2omml(mathml).replace(/<m:sty m:val="undefined"\s*\/>/g, '')
  );
  if (/m:val="undefined"/i.test(omml)) throw new Error('Word 原生公式中仍含非法样式');
  return assertWordFormulaOmmlSourceFree(omml);
}

function createInlineSerializer(context) {
  function serialize(node, inherited = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      return createRun(node.nodeValue, inherited);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const element = node;
    if (element.classList.contains('katex')) {
      context.formulaCount += 1;
      return mathElementToOmml(element);
    }
    if (element.classList.contains('q-figure')) return '';
    if (element.tagName === 'BR') return '<w:r><w:br/></w:r>';

    const options = {
      ...inherited,
      bold: inherited.bold || ['B', 'STRONG'].includes(element.tagName)
    };
    return Array.from(element.childNodes).map((child) => serialize(child, options)).join('');
  }
  return serialize;
}

function createParagraph(content, options = {}) {
  const paragraphProperties = [
    options.keepNext ? '<w:keepNext/>' : '',
    '<w:keepLines/>',
    options.center ? '<w:jc w:val="center"/>' : '',
    options.leftIndent ? `<w:ind w:left="${options.leftIndent}"/>` : '',
    `<w:spacing w:before="${options.before || 0}" w:after="${options.after ?? 120}" w:line="${options.line || 360}" w:lineRule="auto"/>`
  ].join('');
  return `<w:p><w:pPr>${paragraphProperties}</w:pPr>${content || createRun(' ')}</w:p>`;
}

function createImageParagraph(relationshipId, imageId) {
  return `<w:p><w:pPr><w:keepLines/><w:jc w:val="center"/><w:spacing w:before="120" w:after="180"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${FIGURE_WIDTH_EMU}" cy="${FIGURE_HEIGHT_EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${imageId}" name="题图 ${imageId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${imageId}" name="figure-${imageId}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${FIGURE_WIDTH_EMU}" cy="${FIGURE_HEIGHT_EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function getDirectChildren(element, className) {
  return Array.from(element?.children || []).filter((child) => child.classList.contains(className));
}

function countFormulaElements(elements) {
  return Array.from(elements || []).reduce((total, element) => (
    total + Number(element.classList?.contains('katex')) + element.querySelectorAll('.katex').length
  ), 0);
}

function dataUrlToBase64(record) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/i.exec(record?.dataUrl || '');
  if (!match) throw new Error('题图不是有效的内嵌 PNG');
  return match[1];
}

function assertSemanticRootSourceFree(root, label) {
  function visit(node) {
    if (node.nodeType === 3) {
      assertWordVisibleTextSourceFree(node.nodeValue, label);
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.classList.contains('katex') || node.classList.contains('q-figure')) return;
    Array.from(node.childNodes || []).forEach(visit);
  }
  visit(root);
}

function assertWordSemanticDomReady({ title, examContent, answerContent, showAnswer }) {
  assertWordVisibleTextSourceFree(title, '试卷标题');
  let groupIndex = 0;
  let questionIndex = 0;

  for (const group of getDirectChildren(examContent, 'question-group')) {
    groupIndex += 1;
    const groupTitle = getDirectChildren(group, 'group-title')[0];
    if (groupTitle) assertSemanticRootSourceFree(groupTitle, `第 ${groupIndex} 个题组标题`);

    for (const question of getDirectChildren(group, 'question-item')) {
      questionIndex += 1;
      const stem = getDirectChildren(question, 'q-stem')[0];
      if (stem) assertSemanticRootSourceFree(stem, `第 ${questionIndex} 题题干`);
      const options = getDirectChildren(question, 'q-options')[0];
      getDirectChildren(options, 'q-option').forEach((option, optionIndex) => {
        assertSemanticRootSourceFree(option, `第 ${questionIndex} 题第 ${optionIndex + 1} 个选项`);
      });
    }
  }

  if (showAnswer) {
    const answerItems = getDirectChildren(answerContent, 'answer-item');
    answerItems.forEach((answerItem, answerIndex) => {
      getDirectChildren(answerItem, 'answer-step').forEach((step, stepIndex) => {
        assertSemanticRootSourceFree(step, `第 ${answerIndex + 1} 题答案解析第 ${stepIndex + 1} 步`);
      });
    });
  }
  return true;
}

function buildDocumentBody({ title, examContent, answerContent, showAnswer, figureImages }) {
  const context = {
    formulaCount: 0,
    figureCount: 0,
    media: [],
    relationships: []
  };
  const inline = createInlineSerializer(context);
  const plannedFormulaRoots = [];
  const paragraphs = [
    createParagraph(createRun('绝密 ★ 启用前', { bold: true, size: 18 }), { after: 120 }),
    createParagraph(createRun(title, { bold: true, size: 36 }), { center: true, after: 240, line: 420 }),
    createParagraph(createRun('姓名：____________    班级：____________    考号：____________', { size: 24 }), { center: true, after: 320 })
  ];

  for (const group of getDirectChildren(examContent, 'question-group')) {
    const groupTitle = getDirectChildren(group, 'group-title')[0];
    if (groupTitle) {
      plannedFormulaRoots.push(groupTitle);
      paragraphs.push(createParagraph(inline(groupTitle, { bold: true, size: 28 }), {
        keepNext: true,
        after: 140,
        line: 400
      }));
    }

    for (const question of getDirectChildren(group, 'question-item')) {
      const stem = getDirectChildren(question, 'q-stem')[0];
      const options = getDirectChildren(question, 'q-options')[0];
      const figure = getDirectChildren(question, 'q-figure')[0];
      if (stem) {
        plannedFormulaRoots.push(stem);
        paragraphs.push(createParagraph(inline(stem, { size: 24 }), {
          keepNext: Boolean(options || figure),
          after: options || figure ? 60 : 180
        }));
      }
      if (options) {
        plannedFormulaRoots.push(options);
        const optionElements = getDirectChildren(options, 'q-option');
        optionElements.forEach((option, index) => {
          const isLastOption = index === optionElements.length - 1;
          paragraphs.push(createParagraph(inline(option, { size: 24 }), {
            keepNext: !isLastOption || Boolean(figure),
            leftIndent: 360,
            after: isLastOption ? (figure ? 60 : 180) : 40
          }));
        });
      }
      if (figure) {
        const record = figureImages.get(figure);
        if (!record) throw new Error('题图缺少已完成的高清图片');
        context.figureCount += 1;
        const relationshipId = `rIdFigure${context.figureCount}`;
        const fileName = `figure-${context.figureCount}.png`;
        context.media.push({ path: `word/media/${fileName}`, base64: dataUrlToBase64(record) });
        context.relationships.push({ id: relationshipId, target: `media/${fileName}` });
        paragraphs.push(createImageParagraph(relationshipId, context.figureCount));
      }
    }
  }

  if (showAnswer) {
    paragraphs.push(createParagraph(createRun('参考答案与解析', { bold: true, size: 28 }), {
      keepNext: true,
      before: 360,
      after: 160,
      line: 400
    }));
    const answerItems = getDirectChildren(answerContent, 'answer-item');
    for (const answerItem of answerItems) {
      const steps = getDirectChildren(answerItem, 'answer-step');
      steps.forEach((step, index) => {
        plannedFormulaRoots.push(step);
        paragraphs.push(createParagraph(inline(step, { size: 24 }), {
          keepNext: index < steps.length - 1,
          after: index < steps.length - 1 ? 40 : 180
        }));
      });
    }
  }

  const plannedFormulaCount = countFormulaElements(plannedFormulaRoots);
  if (context.formulaCount !== plannedFormulaCount) {
    throw new Error(`Word 公式语义遍历不完整：应转换 ${plannedFormulaCount} 个，实际转换 ${context.formulaCount} 个`);
  }

  return {
    body: paragraphs.join(''),
    ...context
  };
}

function createDocumentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}" xmlns:m="${MATH_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1701" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="425"/><w:docGrid w:linePitch="312"/></w:sectPr></w:body></w:document>`;
}

function createRelationshipsXml(figureRelationships) {
  const figures = figureRelationships.map(({ id, target }) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${figures}</Relationships>`;
}

function createStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="正文"/><w:qFormat/></w:style></w:styles>`;
}

function createContentTypesXml(hasFigures) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasFigures ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

async function buildEditableWordDocx(options) {
  const title = String(options.title || '试卷').trim() || '试卷';
  const result = buildDocumentBody({ ...options, title });
  const documentXml = createDocumentXml(result.body);
  const now = new Date().toISOString();
  const zip = new JSZip();

  zip.file('[Content_Types].xml', createContentTypesXml(result.media.length > 0));
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>AI出题机</dc:creator><cp:lastModifiedBy>AI出题机</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>AI出题机</Application><AppVersion>1.0</AppVersion></Properties>');
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', createStylesXml());
  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${WORD_NS}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="420"/><w:compat/></w:settings>`);
  zip.file('word/_rels/document.xml.rels', createRelationshipsXml(result.relationships));
  result.media.forEach((media) => zip.file(media.path, media.base64, { base64: true }));

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  return {
    blob,
    documentXml,
    mediaPaths: result.media.map((media) => media.path),
    formulaCount: result.formulaCount,
    figureCount: result.figureCount
  };
}

module.exports = {
  buildEditableWordDocx,
  assertWordSemanticDomReady,
  mathElementToOmml,
  _internals: {
    escapeXml,
    normalizeMathmlForOmml,
    createDocumentXml,
    createRelationshipsXml,
    countFormulaElements
  }
};

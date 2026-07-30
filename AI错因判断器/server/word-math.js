const crypto = require('node:crypto');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const JSZip = require('jszip');
const { renderLatexToMathMl } = require('./math-content');

const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
const FORMULA_CACHE_LIMIT = 256;
const SUPPORTED_MATHML_ELEMENTS = new Set([
  'math',
  'menclose',
  'mfrac',
  'mglyph',
  'mi',
  'mmultiscripts',
  'mn',
  'mo',
  'mover',
  'mprescripts',
  'mroot',
  'mrow',
  'ms',
  'mspace',
  'msqrt',
  'mstyle',
  'msub',
  'msubsup',
  'msup',
  'mtable',
  'mtd',
  'mtext',
  'mtr',
  'munder',
  'munderover',
  'none',
  'semantics',
]);

const ommlCache = new Map();
let mathMlConverterPromise;

function elementName(node) {
  return String(node.localName || node.nodeName || '').replace(/^.*:/, '');
}

function allElements(document) {
  return Array.from(document.getElementsByTagName('*'));
}

function parseXml(xml, label) {
  const errors = [];
  const parser = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: (message) => errors.push(message),
      fatalError: (message) => errors.push(message),
    },
  });
  const document = parser.parseFromString(xml, 'application/xml');
  if (errors.length || !document.documentElement) {
    throw new Error(`${label} XML 无法解析：${errors.join('; ') || '缺少根节点'}`);
  }
  return document;
}

function unwrapElement(node) {
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
}

function previousMeaningfulElement(node) {
  let current = node.previousSibling;
  while (current) {
    if (current.nodeType === 1 && current.textContent.trim()) return current;
    current = current.previousSibling;
  }
  return null;
}

function removeMathJaxLayoutArtifacts(document, latex) {
  const artifacts = allElements(document).filter((node) => ['mphantom', 'mpadded'].includes(elementName(node)));
  if (artifacts.length && !latex.includes('\\ce{')) {
    throw new Error('Word 原生公式不支持非化学公式中的 phantom/padded 排版命令');
  }

  for (const node of artifacts.filter((item) => elementName(item) === 'mphantom')) {
    node.parentNode?.removeChild(node);
  }
  for (const node of artifacts.filter((item) => elementName(item) === 'mpadded')) {
    if (node.parentNode) unwrapElement(node);
  }
}

function normalizeChemicalScripts(document) {
  const scripts = allElements(document).filter((node) => ['msub', 'msup', 'msubsup'].includes(elementName(node)));
  for (const script of scripts) {
    const base = Array.from(script.childNodes).find((child) => child.nodeType === 1);
    if (!base || base.textContent.trim()) continue;
    const previous = previousMeaningfulElement(script);
    if (!previous) continue;
    while (base.firstChild) base.removeChild(base.firstChild);
    base.appendChild(previous);
  }
}

function normalizeReactionArrows(document) {
  const arrows = allElements(document).filter((node) => ['mover', 'munderover'].includes(elementName(node)));
  for (const arrow of arrows) {
    const compact = arrow.textContent.replace(/[\s\u2212]/g, '');
    if (!compact.includes('\u21BD') || !compact.includes('\u21C0')) continue;
    if (compact.replace(/[\u21BD\u21C0]/g, '')) continue;
    const replacement = document.createElementNS(MATHML_NAMESPACE, 'mo');
    replacement.setAttribute('stretchy', 'false');
    replacement.appendChild(document.createTextNode('\u21CC'));
    arrow.parentNode?.replaceChild(replacement, arrow);
  }
}

function removeMathJaxAttributes(document) {
  for (const node of allElements(document)) {
    for (let index = node.attributes.length - 1; index >= 0; index -= 1) {
      const attribute = node.attributes.item(index);
      if (attribute?.name.startsWith('data-mjx-')) node.removeAttribute(attribute.name);
    }
  }
}

function assertSupportedMathMl(document) {
  const unsupported = [...new Set(
    allElements(document)
      .map(elementName)
      .filter((name) => name && !SUPPORTED_MATHML_ELEMENTS.has(name)),
  )];
  if (unsupported.length) {
    throw new Error(`Word 原生公式暂不支持 MathML 节点：${unsupported.join(', ')}`);
  }
}

function normalizeMathMlForOmml(mathMl, latex) {
  const document = parseXml(mathMl, 'MathML');

  // mhchem 用透明占位节点定位上下标；OMML 需要把脚本重新绑定到真实化学符号。
  removeMathJaxLayoutArtifacts(document, latex);
  normalizeReactionArrows(document);
  normalizeChemicalScripts(document);
  removeMathJaxAttributes(document);
  assertSupportedMathMl(document);

  return new XMLSerializer().serializeToString(document);
}

async function getMathMlConverter() {
  if (!mathMlConverterPromise) {
    mathMlConverterPromise = import('mathml2omml').then((module) => {
      if (typeof module.mml2omml !== 'function') throw new Error('mathml2omml 未导出转换函数');
      return module.mml2omml;
    });
  }
  return mathMlConverterPromise;
}

function validateOmml(omml) {
  if (omml.includes('m:val="undefined"')) throw new Error('OMML 中存在未定义的公式样式');
  if (/<w:drawing\b|<a:blip\b|r:embed=/i.test(omml)) throw new Error('OMML 中不得包含图片对象');
  const document = parseXml(omml, 'OMML');
  if (elementName(document.documentElement) !== 'oMath') throw new Error('OMML 根节点必须为 m:oMath');
  if (!Array.from(document.getElementsByTagName('m:t')).some((node) => node.textContent.trim())) {
    throw new Error('OMML 没有可编辑公式内容');
  }
}

async function latexToOmml(latex, displayMode = false) {
  const cacheKey = `${displayMode ? 'display' : 'inline'}:${latex}`;
  if (ommlCache.has(cacheKey)) return ommlCache.get(cacheKey);

  const pending = (async () => {
    const mathMl = renderLatexToMathMl(latex, displayMode);
    const normalizedMathMl = normalizeMathMlForOmml(mathMl, latex);
    const convert = await getMathMlConverter();
    const omml = convert(normalizedMathMl).replace(/<m:sty m:val="undefined"\/>/g, '');
    validateOmml(omml);
    return omml;
  })();

  if (ommlCache.size >= FORMULA_CACHE_LIMIT) ommlCache.delete(ommlCache.keys().next().value);
  ommlCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    ommlCache.delete(cacheKey);
    throw error;
  }
}

function closestElement(node, name) {
  let current = node;
  while (current) {
    if (current.nodeType === 1 && elementName(current) === name) return current;
    current = current.parentNode;
  }
  return null;
}

function replacePlaceholderRun(document, placeholder, omml) {
  const textNodes = allElements(document).filter(
    (node) => elementName(node) === 't' && node.textContent === placeholder,
  );
  if (textNodes.length !== 1) throw new Error(`Word 公式占位符数量异常：${placeholder}`);

  const run = closestElement(textNodes[0], 'r');
  if (!run?.parentNode) throw new Error(`Word 公式占位符不在文本运行中：${placeholder}`);
  const runTextNodes = allElements(run).filter((node) => elementName(node) === 't');
  if (runTextNodes.length !== 1 || runTextNodes[0].textContent !== placeholder) {
    throw new Error(`Word 公式占位符必须独占一个文本运行：${placeholder}`);
  }

  const ommlDocument = parseXml(omml, 'OMML');
  const importedOmml = document.importNode(ommlDocument.documentElement, true);
  run.parentNode.replaceChild(importedOmml, run);
}

class WordFormulaRegistry {
  constructor() {
    this.entries = [];
    this.token = crypto.randomBytes(10).toString('hex').toUpperCase();
  }

  register(latex, displayMode = false) {
    const placeholder = `AIOMML${this.token}${String(this.entries.length).padStart(4, '0')}`;
    this.entries.push({ placeholder, latex, displayMode });
    return placeholder;
  }

  async inject(docxBuffer) {
    if (!this.entries.length) return Buffer.from(docxBuffer);
    const zip = await JSZip.loadAsync(docxBuffer);
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) throw new Error('Word 文档缺少 word/document.xml');
    const document = parseXml(await documentFile.async('string'), 'Word document');
    const originalFormulaCount = allElements(document).filter((node) => elementName(node) === 'oMath').length;

    for (const entry of this.entries) {
      const omml = await latexToOmml(entry.latex, entry.displayMode);
      replacePlaceholderRun(document, entry.placeholder, omml);
    }

    const documentXml = new XMLSerializer().serializeToString(document);
    if (documentXml.includes(`AIOMML${this.token}`)) throw new Error('Word 文档仍包含未替换的公式占位符');
    const formulaCount = allElements(document).filter((node) => elementName(node) === 'oMath').length;
    if (formulaCount !== originalFormulaCount + this.entries.length) {
      throw new Error('Word 原生公式数量与报告公式数量不一致');
    }

    zip.file('word/document.xml', documentXml);
    return zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }
}

module.exports = {
  WordFormulaRegistry,
  latexToOmml,
  normalizeMathMlForOmml,
};

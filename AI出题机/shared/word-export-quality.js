const WORD_FIGURE_RENDER_SCALE = 2;
const UNIFORM_FIGURE_WIDTH_PX = 280;
const UNIFORM_FIGURE_HEIGHT_PX = 210;

const FORBIDDEN_WORD_XML_STRUCTURE_PATTERNS = [
  { label: 'MathML 标签', pattern: /<(?:math|semantics|annotation|mrow|mi|mo|mn|mfrac|msqrt|mroot|msup|msub|msubsup|munder|mover|munderover|mtable|mtr|mtd)\b/i },
  { label: 'KaTeX DOM', pattern: /\bclass\s*=\s*["'][^"']*\bkatex(?:-|\s|["'])/i },
  { label: 'MathML 语义源码', pattern: /application\/x-tex|www\.w3\.org\/1998\/Math\/MathML/i },
  { label: '未转换 SVG', pattern: /<svg\b/i },
  { label: '非法公式样式', pattern: /m:val="undefined"/i },
  { label: '未规范化的分段公式括号', pattern: /<m:r><m:t\b[^>]*>\{<\/m:t><\/m:r><m:m\b/i }
];

const FORBIDDEN_WORD_VISIBLE_TEXT_PATTERNS = [
  { label: '私有公式传输标记', pattern: /LATEXSLASH|@@BS@@|\[\[\/?LATEX\]\]/i },
  { label: 'LaTeX 公式源码', pattern: /\\[A-Za-z]+|\\[([]/i },
  { label: '裸上下标表达式', pattern: /[A-Za-z0-9)\]}]\s*[\^_]\s*(?:\{[^}]+\}|[A-Za-z0-9+\-]+)/ }
];

const FORBIDDEN_WORD_FORMULA_SOURCE_PATTERNS = [
  { label: 'MathML 标签', pattern: /<(?:math|semantics|annotation|mrow|mi|mo|mn|mfrac|msqrt|mroot|msup|msub|msubsup|munder|mover|munderover|mtable|mtr|mtd)\b/i },
  { label: 'MathML 语义源码', pattern: /application\/x-tex|www\.w3\.org\/1998\/Math\/MathML/i },
  { label: '私有公式传输标记', pattern: /LATEXSLASH|@@BS@@|\[\[\/?LATEX\]\]/i },
  { label: 'LaTeX 公式源码', pattern: /\\[A-Za-z]+|\\[([]/i },
  { label: '裸上下标表达式', pattern: /[A-Za-z0-9)\]}]\s*[\^_]\s*(?:\{[^}]+\}|[A-Za-z0-9+\-]+)/ },
  { label: '未规范化的分段公式括号', pattern: /<m:r><m:t\b[^>]*>\{<\/m:t><\/m:r><m:m\b/i }
];

function countMatches(value, pattern) {
  return (String(value || '').match(pattern) || []).length;
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXmlTextContent(value) {
  return String(value || '')
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeWordFormulaOmmlText(omml) {
  return String(omml || '').replace(/(<m:t\b[^>]*>)([\s\S]*?)(<\/m:t>)/gi, (
    _match,
    openingTag,
    text,
    closingTag
  ) => `${openingTag}${escapeXmlTextContent(text)}${closingTag}`);
}

function normalizeWordFormulaOmmlStructures(omml) {
  return String(omml || '').replace(
    /<m:r><m:t\b[^>]*>\{<\/m:t><\/m:r>(<m:m\b[\s\S]*?<\/m:m>)/gi,
    (_match, matrix) => `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/><m:grow m:val="1"/></m:dPr><m:e>${matrix}</m:e></m:d>`
  );
}

function normalizeWordFormulaOmml(omml) {
  return normalizeWordFormulaOmmlStructures(normalizeWordFormulaOmmlText(omml));
}

function assertWordXmlTextNodesEscaped(documentXml) {
  const source = String(documentXml || '');
  const pattern = /<(w|m):t\b[^>]*>([\s\S]*?)<\/\1:t>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    if (/[<>]/.test(match[2]) || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+);)/.test(match[2])) {
      const kind = match[1].toLowerCase() === 'm' ? '原生公式文本' : '正文文本';
      throw new Error(`Word ${kind}含未转义的 XML 保留字符，已停止导出`);
    }
  }
}

function extractWordTextNodes(documentXml) {
  const source = String(documentXml || '');
  const nodes = [];
  const pattern = /<(w|m):t\b[^>]*>([\s\S]*?)<\/\1:t>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    nodes.push({
      kind: match[1].toLowerCase() === 'm' ? '原生公式文本' : '正文文本',
      value: decodeXmlText(match[2]),
      index: match.index
    });
  }
  return nodes;
}

function formatTextNodeSnippet(value) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
}

function assertWordVisibleTextSourceFree(value, context = '正文文本') {
  const source = String(value || '');
  for (const rule of FORBIDDEN_WORD_VISIBLE_TEXT_PATTERNS) {
    if (rule.pattern.test(source)) {
      const snippet = formatTextNodeSnippet(source);
      throw new Error(`Word ${context}仍含${rule.label}：${snippet || '空文本节点'}，已停止导出`);
    }
  }
  return source;
}

function assertWordFormulaOmmlSourceFree(omml) {
  const source = String(omml || '');
  if (!/^<m:oMath\b[\s\S]*<\/m:oMath>$/.test(source)) {
    throw new Error('公式未转换为完整的 Word 原生公式');
  }
  assertWordXmlTextNodesEscaped(source);
  for (const rule of FORBIDDEN_WORD_FORMULA_SOURCE_PATTERNS) {
    if (rule.pattern.test(source)) {
      throw new Error(`Word 原生公式仍含${rule.label}`);
    }
  }
  return source;
}

function assertWordDocxParts(documentXml, mediaPaths = [], expectations = {}) {
  const source = String(documentXml || '');
  if (!source.trim()) throw new Error('Word 主文档内容为空');
  if (!/<w:document\b[\s\S]*<w:body\b[\s\S]*<w:sectPr\b[\s\S]*<\/w:document>/.test(source)) {
    throw new Error('Word 主文档不是完整的 OOXML 文档');
  }
  assertWordXmlTextNodesEscaped(source);

  for (const rule of FORBIDDEN_WORD_XML_STRUCTURE_PATTERNS) {
    if (rule.pattern.test(source)) {
      throw new Error(`Word 内容仍含${rule.label}，已停止导出`);
    }
  }

  for (const node of extractWordTextNodes(source)) {
    assertWordVisibleTextSourceFree(node.value, node.kind);
  }

  const expectedFormulaCount = Number(expectations.expectedFormulaCount) || 0;
  const expectedFigureCount = Number(expectations.expectedFigureCount) || 0;
  const formulaCount = countMatches(source, /<m:oMath\b/g);
  const figureCount = countMatches(source, /<a:blip\b[^>]*\br:embed="rIdFigure\d+"/g);
  if (formulaCount !== expectedFormulaCount) {
    throw new Error(`可编辑公式数量不一致：应为 ${expectedFormulaCount}，实际为 ${formulaCount}`);
  }
  if (figureCount !== expectedFigureCount) {
    throw new Error(`题图数量不一致：应为 ${expectedFigureCount}，实际为 ${figureCount}`);
  }

  const normalizedMediaPaths = Array.from(mediaPaths || []).map((path) => String(path).replace(/\\/g, '/'));
  if (normalizedMediaPaths.some((path) => /formula/i.test(path) || !/^word\/media\/figure-\d+\.png$/.test(path))) {
    throw new Error('Word 媒体目录含公式图片或未知媒体文件');
  }
  if (expectedFigureCount === 0 && normalizedMediaPaths.length !== 0) {
    throw new Error('无题图文档不应包含媒体文件');
  }
  if (expectedFigureCount > 0 && normalizedMediaPaths.length !== expectedFigureCount) {
    throw new Error(`题图媒体数量不一致：应为 ${expectedFigureCount}，实际为 ${normalizedMediaPaths.length}`);
  }

  return { formulaCount, figureCount };
}

module.exports = {
  WORD_FIGURE_RENDER_SCALE,
  UNIFORM_FIGURE_WIDTH_PX,
  UNIFORM_FIGURE_HEIGHT_PX,
  assertWordFormulaOmmlSourceFree,
  assertWordVisibleTextSourceFree,
  normalizeWordFormulaOmml,
  normalizeWordFormulaOmmlText,
  assertWordDocxParts,
  _internals: {
    FORBIDDEN_WORD_FORMULA_SOURCE_PATTERNS,
    FORBIDDEN_WORD_VISIBLE_TEXT_PATTERNS,
    FORBIDDEN_WORD_XML_STRUCTURE_PATTERNS,
    countMatches,
    decodeXmlText,
    escapeXmlTextContent,
    assertWordXmlTextNodesEscaped,
    extractWordTextNodes,
    normalizeWordFormulaOmmlStructures
  }
};

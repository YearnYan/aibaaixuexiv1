'use strict';

const JSZip = require('jszip');
const katex = require('katex');
require('katex/contrib/mhchem');
const { mml2omml } = require('mathml2omml');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const LATEX_SEGMENT_PATTERN = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g;
const LATEX_START_PATTERN = /\\[A-Za-z]+|[A-Za-z][A-Za-z0-9]*_\{[^{}]*\\[A-Za-z]+[^{}]*\}/g;
const SCRIPTABLE_CHAR_PATTERN = /[A-Za-z0-9\\{}()[\]^_+\-*/=<>≤≥≠,.;:|·°′″\s]/u;
const ELEMENT_SYMBOLS = new Set([
    'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S',
    'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga',
    'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd',
    'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm',
    'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os',
    'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa',
    'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg',
    'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og'
]);
const PLAIN_SYMBOL_TOKENS = [
    ['Delta', 'Δ'], ['Omega', 'Ω'], ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'],
    ['delta', 'δ'], ['theta', 'θ'], ['lambda', 'λ'], ['mu', 'μ'], ['pi', 'π'], ['omega', 'ω']
];
const UNICODE_SUBSCRIPTS = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6',
    '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')'
};
const UNICODE_SUPERSCRIPTS = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6',
    '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n'
};

function escapeXml(value) {
    return String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '')
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&apos;');
}

function normalizeLatexSource(value) {
    return String(value ?? '')
        .replace(/\u00A0/gu, ' ')
        .replace(/&lt;/gu, '<')
        .replace(/&gt;/gu, '>')
        .replace(/&amp;/gu, '&')
        .replace(/\\dfrac/gu, '\\frac')
        .replace(/\\tfrac/gu, '\\frac')
        .trim();
}

function localName(node) {
    return String(node?.localName || node?.nodeName || '').replace(/^.*:/u, '').toLowerCase();
}

function elementChildren(node) {
    return Array.from(node?.childNodes || []).filter((child) => child.nodeType === 1);
}

function previousElementSibling(node) {
    let current = node?.previousSibling || null;
    while (current && current.nodeType !== 1) current = current.previousSibling;
    return current;
}

function nodeHasDescendant(node, name) {
    if (!node) return false;
    if (localName(node) === name) return true;
    return elementChildren(node).some((child) => nodeHasDescendant(child, name));
}

function nodeHasVisibleContent(node) {
    if (!node) return false;
    if (String(node.textContent || '').replace(/[\s\u00A0\u2009]/gu, '')) return true;
    return elementChildren(node).some((child) => nodeHasVisibleContent(child));
}

function unwrapElement(node) {
    const parent = node?.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
}

function removeNodesByLocalName(documentNode, name) {
    const nodes = Array.from(documentNode.getElementsByTagName('*'))
        .filter((node) => localName(node) === name);
    nodes.forEach((node) => node.parentNode?.removeChild(node));
}

/**
 * mhchem 为精确浏览器排版生成零宽 mphantom 基底。Word 不需要该占位，且通用
 * MathML→OMML 转换器会把其中的 X 当成正文，所以必须把上下标挂回真实元素。
 */
function attachMhchemScripts(documentNode) {
    const scripts = Array.from(documentNode.getElementsByTagName('*'))
        .filter((node) => ['msub', 'msup', 'msubsup'].includes(localName(node)));

    scripts.forEach((script) => {
        const children = elementChildren(script);
        const base = children[0];
        if (!base || !nodeHasDescendant(base, 'mphantom')) return;

        let previous = previousElementSibling(script);
        while (previous && !nodeHasVisibleContent(previous)) {
            const empty = previous;
            previous = previousElementSibling(previous);
            empty.parentNode?.removeChild(empty);
        }

        if (!previous) {
            throw new Error('化学公式上下标缺少可编辑的真实基底');
        }
        script.replaceChild(previous, base);
    });
}

function simplifyMathmlTree(documentNode) {
    const paddedNodes = Array.from(documentNode.getElementsByTagName('*'))
        .filter((node) => localName(node) === 'mpadded');
    paddedNodes.forEach(unwrapElement);

    const emptyRows = Array.from(documentNode.getElementsByTagName('*'))
        .filter((node) => localName(node) === 'mrow' && !nodeHasVisibleContent(node));
    emptyRows.forEach((node) => node.parentNode?.removeChild(node));

    const limits = Array.from(documentNode.getElementsByTagName('*'))
        .filter((node) => ['mover', 'munder', 'munderover'].includes(localName(node)));
    limits.forEach((node) => {
        const children = elementChildren(node);
        if (children.length === 1 && node.parentNode) {
            node.parentNode.replaceChild(children[0], node);
        }
    });

    const semanticsNodes = Array.from(documentNode.getElementsByTagName('*'))
        .filter((node) => localName(node) === 'semantics');
    semanticsNodes.forEach((node) => {
        const primary = elementChildren(node)[0];
        if (primary && node.parentNode) node.parentNode.replaceChild(primary, node);
    });
}

function parseMathml(mathml) {
    const parseErrors = [];
    const parser = new DOMParser({
        errorHandler: {
            warning: () => {},
            error: (message) => parseErrors.push(message),
            fatalError: (message) => parseErrors.push(message)
        }
    });
    const documentNode = parser.parseFromString(String(mathml || ''), 'application/xml');
    const root = documentNode?.documentElement;
    if (!root || localName(root) !== 'math' || parseErrors.length > 0) {
        throw new Error(`MathML 解析失败${parseErrors[0] ? `：${parseErrors[0]}` : ''}`);
    }
    return documentNode;
}

function prepareMathmlForOmml(mathml) {
    const documentNode = parseMathml(mathml);
    removeNodesByLocalName(documentNode, 'annotation');
    attachMhchemScripts(documentNode);
    simplifyMathmlTree(documentNode);
    return new XMLSerializer().serializeToString(documentNode.documentElement);
}

function extractMathml(katexMarkup) {
    const match = String(katexMarkup || '').match(/<math\b[\s\S]*<\/math>/iu);
    if (!match) throw new Error('KaTeX 未生成 MathML');
    return match[0];
}

function sanitizeOmml(omml) {
    return String(omml || '')
        .replace(/<m:sty\s+m:val="undefined"\s*\/>/gu, '')
        .replace(/<m:sty\s+m:val="undefined"\s*>\s*<\/m:sty>/gu, '')
        .replace(/(<m:t\b[^>]*>)([\s\S]*?)(<\/m:t>)/gu, (_, opening, text, closing) => {
            const escapedText = text
                .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/gu, '&amp;')
                .replace(/</gu, '&lt;')
                .replace(/>/gu, '&gt;');
            return `${opening}${escapedText}${closing}`;
        })
        .trim();
}

function createMathElement(documentNode, name, attributes = {}) {
    const element = documentNode.createElementNS(MATH_NS, `m:${name}`);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(`m:${key}`, value));
    return element;
}

function directRunText(node) {
    if (localName(node) !== 'r') return '';
    return String(node.textContent || '').trim();
}

function wrapOmmlNodesWithDelimiter(documentNode, parent, nodes, opening, closing) {
    if (!nodes.length) return null;
    const delimiter = createMathElement(documentNode, 'd');
    const properties = createMathElement(documentNode, 'dPr');
    properties.appendChild(createMathElement(documentNode, 'begChr', { val: opening }));
    properties.appendChild(createMathElement(documentNode, 'endChr', { val: closing }));
    properties.appendChild(createMathElement(documentNode, 'grow'));
    delimiter.appendChild(properties);
    const expression = createMathElement(documentNode, 'e');
    delimiter.appendChild(expression);
    parent.insertBefore(delimiter, nodes[0]);
    nodes.forEach((node) => expression.appendChild(node));
    return delimiter;
}

function applyEnvironmentDelimiters(documentNode, source) {
    const environmentPattern = /\\begin\{(cases|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix)\}/gu;
    const environments = Array.from(String(source || '').matchAll(environmentPattern), (match) => match[1]);
    if (environments.length === 0) return;
    const matrices = Array.from(documentNode.getElementsByTagName('*'))
        .filter((node) => localName(node) === 'm');
    const delimiters = {
        cases: ['{', ''],
        pmatrix: ['(', ')'],
        bmatrix: ['[', ']'],
        Bmatrix: ['{', '}'],
        vmatrix: ['|', '|'],
        Vmatrix: ['‖', '‖']
    };

    environments.forEach((environment, index) => {
        const matrix = matrices[index];
        const parent = matrix?.parentNode;
        if (!matrix || !parent || localName(parent) === 'e' && localName(parent.parentNode) === 'd') return;
        const [opening, closing] = delimiters[environment];
        const previous = previousElementSibling(matrix);
        let next = matrix.nextSibling;
        while (next && next.nodeType !== 1) next = next.nextSibling;
        if (previous && directRunText(previous) === opening) parent.removeChild(previous);
        if (closing && next && directRunText(next) === closing) parent.removeChild(next);
        wrapOmmlNodesWithDelimiter(documentNode, parent, [matrix], opening, closing);
    });
}

function applyPairedOmmlDelimiters(documentNode) {
    const delimiterPairs = new Map([
        ['(', ')'], ['[', ']'], ['{', '}'], ['|', '|'], ['‖', '‖'], ['⌊', '⌋'], ['⌈', '⌉'], ['⟨', '⟩']
    ]);

    const visit = (parent) => {
        elementChildren(parent).forEach(visit);
        if (localName(parent) === 'd' || localName(parent) === 'dPr') return;
        let children = elementChildren(parent);
        for (let start = 0; start < children.length; start += 1) {
            const opening = directRunText(children[start]);
            const expectedClosing = delimiterPairs.get(opening);
            if (!expectedClosing) continue;
            let end = start + 2;
            while (end < children.length && directRunText(children[end]) !== expectedClosing) end += 1;
            if (end >= children.length) continue;
            const middle = children.slice(start + 1, end);
            const hasStructuredFormula = middle.some((node) => !['r', 'argPr'].includes(localName(node)));
            if (!hasStructuredFormula) continue;
            const openingRun = children[start];
            const closingRun = children[end];
            wrapOmmlNodesWithDelimiter(documentNode, parent, middle, opening, expectedClosing);
            parent.removeChild(openingRun);
            parent.removeChild(closingRun);
            children = elementChildren(parent);
            start = -1;
        }
    };
    visit(documentNode.documentElement);
}

function promoteNativeOmmlDelimiters(omml, source) {
    const parseErrors = [];
    const parser = new DOMParser({
        errorHandler: {
            warning: () => {},
            error: (message) => parseErrors.push(message),
            fatalError: (message) => parseErrors.push(message)
        }
    });
    const documentNode = parser.parseFromString(omml, 'application/xml');
    if (!documentNode?.documentElement || parseErrors.length > 0) {
        throw new Error(`OMML 解析失败${parseErrors[0] ? `：${parseErrors[0]}` : ''}`);
    }
    applyEnvironmentDelimiters(documentNode, source);
    applyPairedOmmlDelimiters(documentNode);
    return new XMLSerializer().serializeToString(documentNode.documentElement);
}

function latexToOmml(value) {
    const source = normalizeLatexSource(value);
    if (!source) throw new Error('公式内容为空');

    let mathml;
    try {
        const markup = katex.renderToString(source, {
            displayMode: false,
            throwOnError: true,
            strict: 'ignore',
            trust: false,
            output: 'mathml'
        });
        mathml = prepareMathmlForOmml(extractMathml(markup));
    } catch (error) {
        throw new Error(`LaTeX/mhchem 无法转换为规范公式“${source}”：${error.message}`);
    }

    let omml;
    try {
        omml = promoteNativeOmmlDelimiters(sanitizeOmml(mml2omml(mathml)), source);
    } catch (error) {
        throw new Error(`MathML 无法转换为 Word 原生公式“${source}”：${error.message}`);
    }

    if (!/^<m:oMath\b/u.test(omml) || omml.includes('m:val="undefined"')) {
        throw new Error(`Word 原生公式结构无效“${source}”`);
    }
    return omml;
}

function isLatexExpressionChar(char) {
    return SCRIPTABLE_CHAR_PATTERN.test(char);
}

function expandLatexExpression(text, commandIndex) {
    let start = commandIndex;
    let end = commandIndex;
    while (start > 0 && isLatexExpressionChar(text[start - 1])) start -= 1;
    while (end < text.length && isLatexExpressionChar(text[end])) end += 1;

    const left = text.slice(start, commandIndex);
    const compactLeft = left.replace(/\s+/gu, '');
    if (!/[\\{}_^=+\-*/<>≤≥≠]/u.test(left) && /[A-Za-z]{2,}/u.test(compactLeft)) {
        start = commandIndex;
    }

    const optionPrefix = text.slice(start).match(/^\s*[A-D]\.(?=[A-Za-z\\])/u);
    if (optionPrefix) start += optionPrefix[0].length;
    const optionMatches = Array.from(left.matchAll(/(?:^|\s)[A-D]\.(?=[A-Za-z\\])/gu));
    if (optionMatches.length > 0) {
        const last = optionMatches[optionMatches.length - 1];
        start += last.index + last[0].length;
    }

    while (start < end && /\s/u.test(text[start])) start += 1;
    while (end > start && /\s/u.test(text[end - 1])) end -= 1;
    return { start, end };
}

function findNextLatexExpression(text, fromIndex) {
    const pattern = new RegExp(LATEX_START_PATTERN.source, LATEX_START_PATTERN.flags);
    pattern.lastIndex = fromIndex;
    const match = pattern.exec(text);
    return match ? expandLatexExpression(text, match.index) : null;
}

function tokenizePlainWithImplicitLatex(value) {
    const text = String(value || '');
    const tokens = [];
    let lastIndex = 0;
    let expression = findNextLatexExpression(text, 0);
    while (expression) {
        if (expression.start < lastIndex) {
            expression = findNextLatexExpression(text, lastIndex);
            continue;
        }
        if (expression.start > lastIndex) {
            tokens.push({ type: 'text', value: text.slice(lastIndex, expression.start) });
        }
        tokens.push({
            type: 'math',
            value: text.slice(expression.start, expression.end),
            display: false
        });
        lastIndex = expression.end;
        expression = findNextLatexExpression(text, lastIndex);
    }
    if (lastIndex < text.length) tokens.push({ type: 'text', value: text.slice(lastIndex) });
    return tokens;
}

function delimitedMathToken(segment) {
    if (segment.startsWith('$$') && segment.endsWith('$$')) {
        return { type: 'math', value: segment.slice(2, -2), display: true };
    }
    if (segment.startsWith('$') && segment.endsWith('$')) {
        return { type: 'math', value: segment.slice(1, -1), display: false };
    }
    if (segment.startsWith('\\[') && segment.endsWith('\\]')) {
        return { type: 'math', value: segment.slice(2, -2), display: true };
    }
    if (segment.startsWith('\\(') && segment.endsWith('\\)')) {
        return { type: 'math', value: segment.slice(2, -2), display: false };
    }
    return { type: 'text', value: segment };
}

function mergeAdjacentTextTokens(tokens) {
    const merged = [];
    tokens.forEach((token) => {
        const previous = merged[merged.length - 1];
        if (token.type === 'text' && previous?.type === 'text') {
            previous.value += token.value;
        } else if (token.type !== 'text' || token.value) {
            merged.push({ ...token });
        }
    });
    return merged;
}

function tokenizeAcademicText(value) {
    const text = String(value ?? '');
    const pattern = new RegExp(LATEX_SEGMENT_PATTERN.source, LATEX_SEGMENT_PATTERN.flags);
    const tokens = [];
    let lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
        tokens.push(...tokenizePlainWithImplicitLatex(text.slice(lastIndex, match.index)));
        tokens.push(delimitedMathToken(match[0]));
        lastIndex = match.index + match[0].length;
        match = pattern.exec(text);
    }
    tokens.push(...tokenizePlainWithImplicitLatex(text.slice(lastIndex)));
    return mergeAdjacentTextTokens(tokens);
}

function normalizePlainWordText(value) {
    let text = String(value ?? '')
        .replace(/\u00A0/gu, ' ')
        .replace(/<=/gu, '≤')
        .replace(/>=/gu, '≥')
        .replace(/!=/gu, '≠')
        .replace(/~=/gu, '≈');
    PLAIN_SYMBOL_TOKENS.forEach(([token, symbol]) => {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        text = text.replace(new RegExp(`(^|[^A-Za-z])${escaped}(?=[^A-Za-z]|$)`, 'gu'), (_, prefix) => `${prefix}${symbol}`);
    });
    return text;
}

function appendTextSegment(segments, value, verticalAlign = '') {
    if (!value) return;
    const previous = segments[segments.length - 1];
    if (previous && previous.verticalAlign === verticalAlign) {
        previous.value += value;
    } else {
        segments.push({ value, verticalAlign });
    }
}

function parseScriptMarkers(value) {
    const text = normalizePlainWordText(value);
    const segments = [];
    let buffer = '';
    let index = 0;

    const flush = () => {
        appendTextSegment(segments, buffer);
        buffer = '';
    };

    while (index < text.length) {
        const marker = text[index];
        const unicodeSubscript = UNICODE_SUBSCRIPTS[marker];
        const unicodeSuperscript = UNICODE_SUPERSCRIPTS[marker];
        if (unicodeSubscript || unicodeSuperscript) {
            flush();
            const verticalAlign = unicodeSubscript ? 'subscript' : 'superscript';
            let body = unicodeSubscript || unicodeSuperscript;
            index += 1;
            while (index < text.length) {
                const next = verticalAlign === 'subscript'
                    ? UNICODE_SUBSCRIPTS[text[index]]
                    : UNICODE_SUPERSCRIPTS[text[index]];
                if (!next) break;
                body += next;
                index += 1;
            }
            appendTextSegment(segments, body, verticalAlign);
            continue;
        }
        if ((marker === '^' || marker === '_') && index + 1 < text.length) {
            let body = '';
            let next = index + 1;
            if (text[next] === '{') {
                const close = text.indexOf('}', next + 1);
                if (close > next + 1) {
                    body = text.slice(next + 1, close);
                    next = close + 1;
                }
            } else {
                const match = text.slice(next).match(/^(?:\([+\-]?\d+\)|[+\-]?\d+|[A-Za-z])/u);
                if (match) {
                    body = match[0];
                    next += body.length;
                }
            }

            if (body) {
                flush();
                appendTextSegment(segments, body, marker === '^' ? 'superscript' : 'subscript');
                index = next;
                continue;
            }
        }
        buffer += marker;
        index += 1;
    }
    flush();
    return segments;
}

function isChemicalCandidate(candidate) {
    if (!/\d/u.test(candidate)) return false;
    const symbols = candidate.match(/[A-Z][a-z]?/gu) || [];
    return symbols.length > 0 && symbols.every((symbol) => ELEMENT_SYMBOLS.has(symbol));
}

function splitChemicalSubscripts(value) {
    const text = String(value || '');
    const result = [];
    const candidatePattern = /(?:[A-Z][a-z]?\d*|[()[\]]\d*|·\d*)+/gu;
    let lastIndex = 0;
    let match = candidatePattern.exec(text);
    while (match) {
        if (match.index > lastIndex) appendTextSegment(result, text.slice(lastIndex, match.index));
        const candidate = match[0];
        if (!isChemicalCandidate(candidate)) {
            appendTextSegment(result, candidate);
        } else {
            let cursor = 0;
            while (cursor < candidate.length) {
                const digitMatch = candidate.slice(cursor).match(/^\d+/u);
                if (digitMatch) {
                    const previous = candidate[cursor - 1] || '';
                    const subscript = /[A-Za-z)\]]/u.test(previous) || result[result.length - 1]?.verticalAlign === 'subscript';
                    appendTextSegment(result, digitMatch[0], subscript ? 'subscript' : '');
                    cursor += digitMatch[0].length;
                    continue;
                }
                appendTextSegment(result, candidate[cursor]);
                cursor += 1;
            }
        }
        lastIndex = match.index + candidate.length;
        match = candidatePattern.exec(text);
    }
    if (lastIndex < text.length) appendTextSegment(result, text.slice(lastIndex));
    return result;
}

function plainTextSegments(value) {
    const result = [];
    parseScriptMarkers(value).forEach((segment) => {
        if (segment.verticalAlign) {
            appendTextSegment(result, segment.value, segment.verticalAlign);
            return;
        }
        splitChemicalSubscripts(segment.value).forEach((chemicalSegment) => {
            appendTextSegment(result, chemicalSegment.value, chemicalSegment.verticalAlign);
        });
    });
    return result;
}

function wordRun(value, options = {}) {
    const text = String(value ?? '');
    if (!text) return '';
    const properties = [];
    if (options.bold) properties.push('<w:b/>');
    if (options.verticalAlign) properties.push(`<w:vertAlign w:val="${options.verticalAlign}"/>`);
    properties.push('<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="宋体" w:cs="Cambria Math"/>');
    const runProperties = `<w:rPr>${properties.join('')}</w:rPr>`;
    const parts = text.split(/(\r?\n)/u).filter(Boolean);
    return parts.map((part) => {
        if (/^\r?\n$/u.test(part)) return `<w:r>${runProperties}<w:br/></w:r>`;
        return `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`;
    }).join('');
}

function plainTextToWordRuns(value, options = {}) {
    return plainTextSegments(value)
        .map((segment) => wordRun(segment.value, { ...options, verticalAlign: segment.verticalAlign }))
        .join('');
}

function wordParagraph(content, styleId, options = {}) {
    const properties = [`<w:pStyle w:val="${escapeXml(styleId)}"/>`];
    if (options.center) properties.push('<w:jc w:val="center"/>');
    if (options.keepNext) properties.push('<w:keepNext/>');
    return `<w:p><w:pPr>${properties.join('')}</w:pPr>${content}</w:p>`;
}

function displayMathParagraph(omml, styleId = 'Normal') {
    const mathParagraph = `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${omml}</m:oMathPara>`;
    // OMML 独立公式必须位于 Word 段落中；直接写入文档主体会被 WPS 忽略。
    return wordParagraph(mathParagraph, styleId);
}

function academicTextToWordBlocks(value, options = {}) {
    const tokens = tokenizeAcademicText(value);
    const blocks = [];
    let inline = options.prefix ? plainTextToWordRuns(options.prefix, { bold: options.prefixBold }) : '';
    let formulaCount = 0;

    const flushInline = () => {
        if (!inline) return;
        blocks.push(wordParagraph(inline, options.styleId || 'Normal', {
            center: options.center,
            keepNext: options.keepNext
        }));
        inline = '';
    };

    tokens.forEach((token) => {
        if (token.type === 'text') {
            inline += plainTextToWordRuns(token.value, { bold: options.bold });
            return;
        }
        const omml = latexToOmml(token.value);
        formulaCount += 1;
        if (token.display) {
            flushInline();
            blocks.push(displayMathParagraph(omml, options.styleId || 'Normal'));
        } else {
            inline += omml;
        }
    });
    flushInline();

    if (blocks.length === 0) {
        blocks.push(wordParagraph('', options.styleId || 'Normal', {
            center: options.center,
            keepNext: options.keepNext
        }));
    }
    return { blocks, formulaCount };
}

function dataUrlToBytes(dataUrl) {
    const match = String(dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u);
    if (!match) throw new Error('Word 题图不是有效的 PNG 数据');
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(match[1], 'base64'));
    const binary = atob(match[1]);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function readPngSize(bytes) {
    if (bytes.length < 24 || String.fromCharCode(...bytes.slice(1, 4)) !== 'PNG') {
        throw new Error('Word 题图 PNG 头无效');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
}

function imageParagraph(relationshipId, imageId, name, width, height) {
    const maxWidthPx = 520;
    const scale = Math.min(1, maxWidthPx / Math.max(1, width));
    const cx = Math.round(width * scale * 9525);
    const cy = Math.round(height * scale * 9525);
    return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageId}" name="${escapeXml(name)}"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic><pic:nvPicPr><pic:cNvPr id="${imageId}" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic>
</wp:inline></w:drawing></w:r></w:p>`;
}

function contentTypesXml(hasImages) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${hasImages ? '<Default Extension="png" ContentType="image/png"/>' : ''}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelationshipsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function documentRelationshipsXml(imageRelationships) {
    const images = imageRelationships.map((image) => (
        `<Relationship Id="${image.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${escapeXml(image.fileName)}"/>`
    )).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
${images}
</Relationships>`;
}

function stylesXml() {
    const style = (id, name, size, options = {}) => `<w:style w:type="paragraph" w:styleId="${id}">
<w:name w:val="${name}"/>${options.basedOn ? `<w:basedOn w:val="${options.basedOn}"/>` : ''}
<w:pPr>${options.center ? '<w:jc w:val="center"/>' : ''}<w:spacing w:after="${options.after ?? 120}" w:line="${options.line ?? 360}" w:lineRule="auto"/>${options.keepNext ? '<w:keepNext/>' : ''}</w:pPr>
<w:rPr>${options.bold ? '<w:b/>' : ''}<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="宋体" w:cs="Cambria Math"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>
</w:style>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="宋体" w:cs="Cambria Math"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
${style('Normal', '正文', 24, { after: 120, line: 360 })}
${style('SecretMark', '密级', 18, { after: 100, line: 280, bold: true })}
${style('ExamTitle', '试卷标题', 36, { after: 180, line: 420, bold: true, center: true, keepNext: true })}
${style('ExamInfo', '考生信息', 24, { after: 240, line: 360, center: true })}
${style('GroupTitle', '大题标题', 28, { after: 120, line: 360, bold: true, keepNext: true })}
${style('Question', '题干', 24, { after: 100, line: 360 })}
${style('Option', '选项', 24, { after: 60, line: 340 })}
${style('AnswerHeading', '答案标题', 28, { after: 140, line: 360, bold: true, keepNext: true })}
${style('Answer', '答案', 24, { after: 100, line: 360 })}
</w:styles>`;
}

function settingsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${WORD_NS}" xmlns:m="${MATH_NS}">
<w:zoom w:percent="100"/><w:defaultTabStop w:val="420"/>
<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>
<m:mathPr><m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/><m:defJc m:val="left"/><m:dispDef/></m:mathPr>
</w:settings>`;
}

function corePropertiesXml(title, timestamp) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(title)}</dc:title><dc:creator>试卷变式机</dc:creator><cp:lastModifiedBy>试卷变式机</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`;
}

function appPropertiesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>试卷变式机</Application><AppVersion>2.0</AppVersion>
</Properties>`;
}

function documentXml(body) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}" xmlns:m="${MATH_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1701" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

function sanitizeFileName(value) {
    const cleaned = String(value || '试卷')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_')
        .replace(/[.\s]+$/gu, '')
        .trim();
    return cleaned || '试卷';
}

async function createEditableWordDocument(options = {}) {
    const title = String(options.title || '试卷').trim() || '试卷';
    const groups = options.groups;
    if (!groups || typeof groups !== 'object') throw new Error('缺少组卷内容');
    const answers = Array.isArray(options.answers) ? options.answers : [];
    const figureImages = options.figureImages instanceof Map ? options.figureImages : new Map();
    const body = [];
    let formulaCount = 0;
    const imageRelationships = [];
    const imageFiles = [];

    body.push(wordParagraph(plainTextToWordRuns('绝密 ★ 启用前', { bold: true }), 'SecretMark'));
    const titleBlocks = academicTextToWordBlocks(title, { styleId: 'ExamTitle', center: true, bold: true });
    body.push(...titleBlocks.blocks);
    formulaCount += titleBlocks.formulaCount;
    body.push(wordParagraph(plainTextToWordRuns('姓名：____________  班级：____________  考号：____________'), 'ExamInfo', { center: true }));

    for (const group of Object.values(groups)) {
        if (!group || !Array.isArray(group.items) || group.items.length === 0) continue;
        const groupBlocks = academicTextToWordBlocks(group.title || '', {
            styleId: 'GroupTitle',
            bold: true,
            keepNext: true
        });
        body.push(...groupBlocks.blocks);
        formulaCount += groupBlocks.formulaCount;

        for (const item of group.items) {
            const stemBlocks = academicTextToWordBlocks(item?.stem || '', {
                styleId: 'Question',
                prefix: `${item?.index ?? ''}. `
            });
            body.push(...stemBlocks.blocks);
            formulaCount += stemBlocks.formulaCount;

            for (const option of Array.isArray(item?.options) ? item.options.filter(Boolean) : []) {
                const optionBlocks = academicTextToWordBlocks(option, { styleId: 'Option' });
                body.push(...optionBlocks.blocks);
                formulaCount += optionBlocks.formulaCount;
            }

            const dataUrl = figureImages.get(item?.originalIdx);
            if (dataUrl) {
                const bytes = dataUrlToBytes(dataUrl);
                const { width, height } = readPngSize(bytes);
                const number = imageFiles.length + 1;
                const relationshipId = `rIdImage${number}`;
                const fileName = `figure-${number}.png`;
                imageFiles.push({ fileName, bytes });
                imageRelationships.push({ id: relationshipId, fileName });
                body.push(imageParagraph(relationshipId, number, `题图 ${number}`, width, height));
            }
        }
    }

    if (options.showAnswer && answers.length > 0) {
        body.push(wordParagraph(plainTextToWordRuns('参考答案与解析', { bold: true }), 'AnswerHeading'));
        for (const answer of answers) {
            const answerBlocks = academicTextToWordBlocks(answer, { styleId: 'Answer' });
            body.push(...answerBlocks.blocks);
            formulaCount += answerBlocks.formulaCount;
        }
    }

    const mainDocumentXml = documentXml(body.join(''));
    const ommlCount = (mainDocumentXml.match(/<m:oMath\b/gu) || []).length;
    if (ommlCount !== formulaCount) {
        throw new Error(`Word 公式完整性校验失败：识别 ${formulaCount} 个，写入 ${ommlCount} 个`);
    }

    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypesXml(imageFiles.length > 0));
    zip.folder('_rels').file('.rels', rootRelationshipsXml());
    zip.folder('docProps').file('core.xml', corePropertiesXml(title, new Date().toISOString()));
    zip.folder('docProps').file('app.xml', appPropertiesXml());
    zip.folder('word').file('document.xml', mainDocumentXml);
    zip.folder('word').file('styles.xml', stylesXml());
    zip.folder('word').file('settings.xml', settingsXml());
    zip.folder('word').folder('_rels').file('document.xml.rels', documentRelationshipsXml(imageRelationships));
    imageFiles.forEach((image) => zip.folder('word').folder('media').file(image.fileName, image.bytes));

    const bytes = await zip.generateAsync({
        type: 'uint8array',
        mimeType: DOCX_MIME,
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });
    return {
        bytes,
        formulaCount,
        figureCount: imageFiles.length,
        fileName: `${sanitizeFileName(title)}.docx`,
        mimeType: DOCX_MIME
    };
}

module.exports = {
    DOCX_MIME,
    academicTextToWordBlocks,
    createEditableWordDocument,
    latexToOmml,
    plainTextSegments,
    prepareMathmlForOmml,
    sanitizeFileName,
    tokenizeAcademicText
};

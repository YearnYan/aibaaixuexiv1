import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';
import editableWordExport from '../shared/editable-word-export.js';

const { createEditableWordDocument } = editableWordExport;

// 试卷变式机 - 前端应用
const API_BASE = '/api/site/exam-variant';
const DEFAULT_VARIANT_DIFFICULTY = 8;
const DEFAULT_VARIATION_COEFFICIENT = 1;
const SETTINGS_KEY = 'exam_settings_v4';
const LEGACY_SETTINGS_KEY = 'exam_settings_v3';
const MAX_UPLOAD_IMAGE_SIDE = 1600;
const MAX_UPLOAD_FILE_COUNT = 60;
const FIGURE_BATCH_SIZE = 1;
const FIGURE_STRICT_MAX_ROUNDS = 10;
const SUBJECT_SYMBOL_TOKENS = [
    ['Delta', 'Δ'],
    ['Omega', 'Ω'],
    ['alpha', 'α'],
    ['beta', 'β'],
    ['gamma', 'γ'],
    ['delta', 'δ'],
    ['theta', 'θ'],
    ['lambda', 'λ'],
    ['mu', 'μ'],
    ['pi', 'π'],
    ['omega', 'ω']
];

const scriptPromiseCache = new Map();

function apiFetch(url, options = {}) {
    const request = typeof window.apiFetch === 'function' ? window.apiFetch : window.fetch.bind(window);
    return request(url, {
        ...options,
        credentials: options.credentials || 'same-origin'
    });
}

const state = {
    generatedQuestions: [],
    selectedQuestions: new Set(),
    uploadedFiles: [],
    currentExamData: null,
    currentPreviewGroups: null,
    mode: 'select',
    figureCache: new Map(), // 缓存已生成的SVG图形
    topicsData: [],
    difficultyNames: {},
    antiInspect: {
        disableContextMenu: false,
        disableDevtoolsShortcuts: false
    },
    activeGenerateToken: 0,
    activeFigureLoadToken: 0,
    figureLoading: false,
    figureFailedCount: 0,
    questionCardClickBound: false
};

function clampLevel(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(10, parsed));
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadUiConfig();
    loadSettings();
    renderUploadFileList();

    // 标题编辑提示：点击标题后隐藏提示
    const paperTitle = document.getElementById('paperTitle');
    const titleHint = document.getElementById('titleEditHint');
    if (paperTitle && titleHint) {
        paperTitle.addEventListener('focus', () => { titleHint.style.opacity = '0'; });
        paperTitle.addEventListener('blur', () => { titleHint.style.display = 'none'; });
    }

});

async function loadUiConfig() {
    try {
        const resp = await apiFetch(`${API_BASE}/public/config`);
        if (!resp.ok) {
            return;
        }

        const data = await resp.json();
        state.difficultyNames = data?.difficultyNames || {};
    } catch (e) {
        console.warn('加载前端配置失败，将使用默认行为:', e.message);
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function transformTextOutsideTags(html, transform) {
    return String(html || '')
        .split(/(<[^>]+>)/g)
        .map((part) => part.startsWith('<') ? part : transform(part))
        .join('');
}

function replaceStandaloneToken(text, token, symbol) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reg = new RegExp(`(^|[^A-Za-z])${escaped}(?=[^A-Za-z]|$)`, 'g');
    return String(text || '').replace(reg, (_, prefix) => `${prefix}${symbol}`);
}

function normalizeSubjectSymbols(value) {
    let text = String(value || '');
    text = text
        .replace(/\u00A0/g, ' ')
        .replace(/\\left/g, '')
        .replace(/\\right/g, '')
        .replace(/\\,/g, ' ')
        .replace(/\\;/g, ' ')
        .replace(/\\:/g, ' ')
        .replace(/\\!/g, '')
        .replace(/\\quad/g, ' ')
        .replace(/\\qquad/g, ' ')
        .replace(/\\(?:mathrm|text|operatorname)\{([^{}]+)\}/g, '$1')
        .replace(/\\times/g, '×')
        .replace(/\\cdot/g, '·')
        .replace(/\\div/g, '÷')
        .replace(/\\pm/g, '±')
        .replace(/\\mp/g, '∓')
        .replace(/\\leq/g, '≤')
        .replace(/\\geq/g, '≥')
        .replace(/\\neq/g, '≠')
        .replace(/\\approx/g, '≈')
        .replace(/\\equiv/g, '≡')
        .replace(/\\parallel/g, '∥')
        .replace(/\\perp/g, '⟂')
        .replace(/\\angle/g, '∠')
        .replace(/\\triangle/g, '△')
        .replace(/\\circ\b/g, '°')
        .replace(/\\degree\b/g, '°')
        .replace(/<=/g, '≤')
        .replace(/>=/g, '≥')
        .replace(/!=/g, '≠')
        .replace(/~=|≃/g, '≈')
        .replace(/\bsqrt\s*[（(]\s*([^()（）]{1,100})\s*[)）]/gi, '√$1')
        .replace(/√\s*[（(]\s*([^()（）]{1,100})\s*[)）]/g, '√$1');

    SUBJECT_SYMBOL_TOKENS.forEach(([token, symbol]) => {
        text = replaceStandaloneToken(text, token, symbol);
    });

    return text.replace(/\s{2,}/g, ' ').trim();
}

function formatSupSub(text) {
    return String(text || '')
        .replace(/([A-Za-z0-9α-ωΑ-ΩπΠθΘφΦμµΩωΔδ\)])\^(\(?[+\-]?\d+\)?|[A-Za-z])/g, '$1<sup>$2</sup>')
        .replace(/([A-Za-z0-9α-ωΑ-ΩπΠθΘφΦμµΩωΔδ\)])_(\(?[+\-]?\d+\)?|[A-Za-z0-9]+)/g, '$1<sub>$2</sub>');
}

function formatChemistrySubscripts(text) {
    const element = '(?:H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Fe|Cu|Zn|Ag|Au|Pb|Mn|Ba|I|Br|Co|Ni|Cr|Hg)';
    const formulaPattern = new RegExp(`(?:\\b(?:${element}|\\(|\\)|\\[|\\]|·)\\w*[A-Za-z0-9()\\[\\]·]*)`, 'g');
    return String(text || '').replace(formulaPattern, (formula) => {
        if (!/[A-Z]/.test(formula) || !/\d/.test(formula)) return formula;
        return formula.replace(/(?<=[A-Za-z)\]])(\d+)/g, '<sub>$1</sub>');
    });
}

function formatPlainMath(text) {
    return formatSupSub(formatChemistrySubscripts(text));
}

function renderRoot(radicand) {
    const body = formatPlainMath(String(radicand || '').trim());
    if (!body) return '√';
    return `<span class="math-root"><span class="math-root-symbol">√</span><span class="math-root-body">${body}</span></span>`;
}

function renderMathAtom(atom) {
    const clean = String(atom || '').trim();
    if (/^√/.test(clean)) {
        return renderRoot(clean.replace(/^√\s*/, ''));
    }
    return formatPlainMath(clean);
}

function renderFraction(numerator, denominator) {
    return `<span class="math-frac"><span class="math-num">${renderMathAtom(numerator)}</span><span class="math-den">${renderMathAtom(denominator)}</span></span>`;
}

function shouldFormatFraction(match, numerator, denominator, offset, fullText) {
    const before = fullText[offset - 1] || '';
    const after = fullText[offset + match.length] || '';
    if (before === '/' || after === '/') return false;

    const joined = `${numerator}${denominator}`;
    const hasMathMarker = /[\d√α-ωΑ-ΩπΠθΘφΦμµΩωΔδ]/.test(joined)
        || /\b(?:sin|cos|tan|cot|log|ln|mol|kg|km|cm|mm|m|s|h|L|N|J|Pa|Hz|V|A|Ω)\b/i.test(joined);
    if (!hasMathMarker) return false;

    // 避免把日期、编号路径等连续斜杠内容排成分式。
    if (/^\d{3,4}$/.test(numerator) && /^\d{1,2}$/.test(denominator)) return false;
    return true;
}

function formatPlainRichText(value) {
    let html = escapeHtml(normalizeSubjectSymbols(value))
        .replace(/\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, numerator, denominator) => renderFraction(numerator, denominator))
        .replace(/\\(?:d|t)?sqrt\{([^{}]+)\}/g, '√$1');

    html = html.replace(/sqrt\s*[（(]\s*([^()<>]{1,100})\s*[)）]/gi, (_, radicand) => renderRoot(radicand));

    html = html.replace(/\(([^()<>]{1,100})\)\s*\/\s*\(([^()<>]{1,100})\)/g, (_, numerator, denominator) => {
        return renderFraction(numerator, denominator);
    });

    html = html.replace(/((?:√\s*)?[A-Za-z0-9α-ωΑ-ΩπΠθΘφΦμµΩωΔδ]+)\s*\/\s*((?:√\s*)?[A-Za-z0-9α-ωΑ-ΩπΠθΘφΦμµΩωΔδ]+)/g,
        (match, numerator, denominator, offset, fullText) => {
            if (!shouldFormatFraction(match, numerator, denominator, offset, fullText)) return match;
            return renderFraction(numerator, denominator);
        });

    html = transformTextOutsideTags(html, (text) => {
        const withRoots = text.replace(/√\s*([A-Za-z0-9α-ωΑ-ΩπΠθΘφΦμµΩωΔδ]+(?:[+\-][A-Za-z0-9α-ωΑ-ΩπΠθΘφΦμµΩωΔδ]+)?)/g, (_, radicand) => renderRoot(radicand));
        return formatPlainMath(withRoots);
    });

    return html;
}

const LATEX_SEGMENT_PATTERN = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g;
const LATEX_START_PATTERN = /\\[A-Za-z]+|[A-Za-z][A-Za-z0-9]*_\{[^{}]*\\[A-Za-z]+[^{}]*\}/g;
const LATEX_COMMAND_SYMBOLS = [
    ['\\ne', '≠'],
    ['\\neq', '≠'],
    ['\\leq', '≤'],
    ['\\le', '≤'],
    ['\\geq', '≥'],
    ['\\ge', '≥'],
    ['\\lt', '<'],
    ['\\gt', '>'],
    ['\\angle', '∠'],
    ['\\triangle', '△'],
    ['\\parallel', '∥'],
    ['\\perp', '⊥'],
    ['\\circ', '°'],
    ['\\degree', '°'],
    ['\\times', '×'],
    ['\\div', '÷'],
    ['\\pm', '±'],
    ['\\mp', '∓'],
    ['\\cdot', '·'],
    ['\\approx', '≈'],
    ['\\equiv', '≡'],
    ['\\infty', '∞'],
    ['\\therefore', '∴'],
    ['\\because', '∵'],
    ['\\in', '∈'],
    ['\\notin', '∉'],
    ['\\subset', '⊂'],
    ['\\subseteq', '⊆'],
    ['\\supset', '⊃'],
    ['\\supseteq', '⊇'],
    ['\\cup', '∪'],
    ['\\cap', '∩'],
    ['\\emptyset', '∅'],
    ['\\varnothing', '∅'],
    ['\\nabla', '∇'],
    ['\\partial', '∂'],
    ['\\sum', '∑'],
    ['\\prod', '∏'],
    ['\\int', '∫'],
    ['\\lim', 'lim'],
    ['\\sin', 'sin'],
    ['\\cos', 'cos'],
    ['\\tan', 'tan'],
    ['\\cot', 'cot'],
    ['\\log', 'log'],
    ['\\ln', 'ln'],
    ['\\Delta', 'Δ'],
    ['\\Omega', 'Ω'],
    ['\\alpha', 'α'],
    ['\\beta', 'β'],
    ['\\gamma', 'γ'],
    ['\\delta', 'δ'],
    ['\\theta', 'θ'],
    ['\\lambda', 'λ'],
    ['\\mu', 'μ'],
    ['\\pi', 'π'],
    ['\\sigma', 'σ'],
    ['\\phi', 'φ'],
    ['\\omega', 'ω']
];

function normalizeLatexSource(latex) {
    return String(latex || '')
        .replace(/\\ne\b/g, '\\neq')
        .replace(/\\le\b/g, '\\leq')
        .replace(/\\ge\b/g, '\\geq')
        .replace(/\\degree\b/g, '^{\\circ}')
        .replace(/\\mathrm\{℃\}/g, '{}^\\circ\\mathrm{C}')
        .trim();
}

function normalizeChemistryEquation(value) {
    return String(value || '')
        .replace(/<=>|\\rightleftharpoons/g, '⇌')
        .replace(/->|=>|\\to/g, '→')
        .replace(/<-|<=/g, '←')
        .replace(/\\uparrow/g, '↑')
        .replace(/\\downarrow/g, '↓');
}

function formatChemistryLatexBody(body) {
    let html = escapeHtml(normalizeChemistryEquation(body))
        .replace(/([A-Za-z)\]])(\d+)/g, '$1<sub>$2</sub>')
        .replace(/\^(\d+[+-]?|[+-]\d*|[+-])/g, '<sup>$1</sup>')
        .replace(/([A-Za-z)\]])([+-])(?=\s|$)/g, '$1<sup>$2</sup>');
    html = html.replace(/\s{2,}/g, ' ').trim();
    return html;
}

function renderReadableFraction(numerator, denominator) {
    return `<span class="math-frac"><span class="math-num">${latexToReadableHtml(numerator)}</span><span class="math-den">${latexToReadableHtml(denominator)}</span></span>`;
}

function renderReadableRoot(radicand, degree = '') {
    const degreeHtml = degree ? `<sup>${latexToReadableHtml(degree)}</sup>` : '';
    return `<span class="math-root">${degreeHtml}<span class="math-root-symbol">√</span><span class="math-root-body">${latexToReadableHtml(radicand)}</span></span>`;
}

function splitLatexRows(body) {
    return String(body || '')
        .split(/\\\\(?:\[[^\]]+\])?/g)
        .map((row) => row.replace(/&/g, '').trim())
        .filter(Boolean);
}

function renderReadableLatexRows(body, className = 'math-lines') {
    const rows = splitLatexRows(body);
    if (!rows.length) return '';
    return `<span class="${className}">${rows.map((row) => `<span class="math-row">${latexToReadableHtml(row)}</span>`).join('')}</span>`;
}

function renderReadableCases(body) {
    const rows = renderReadableLatexRows(body, 'math-cases-body');
    if (!rows) return '';
    return `<span class="math-cases"><span class="math-cases-brace">{</span>${rows}</span>`;
}

function renderReadableDecorated(command, body) {
    const inner = latexToReadableHtml(body);
    if (command === 'vec' || command === 'overrightarrow') {
        return `<span class="math-vector">→${inner}</span>`;
    }
    if (command === 'overline') {
        return `<span class="math-overline">${inner}</span>`;
    }
    if (command === 'hat') {
        return `<span class="math-hat">${inner}̂</span>`;
    }
    return inner;
}

function restoreHtmlPlaceholders(text, placeholders) {
    let html = escapeHtml(text);
    placeholders.forEach((value, index) => {
        html = html.replaceAll(`@@HTMLTOKEN${index}@@`, value);
    });
    return html;
}

function latexToReadableHtml(latex) {
    const placeholders = [];
    const hold = (html) => {
        const key = `@@HTMLTOKEN${placeholders.length}@@`;
        placeholders.push(html);
        return key;
    };

    let text = normalizeLatexSource(latex)
        .replace(/\\(?:left|right)/g, '')
        .replace(/\\[,;:!]/g, ' ')
        .replace(/\\q?quad/g, ' ')
        .replace(/\\(?:mathrm|text|operatorname)\{([^{}]+)\}/g, '$1');

    text = text.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body) => {
        return hold(renderReadableCases(body));
    });
    text = text.replace(/\\begin\{(aligned|matrix|pmatrix|bmatrix)\}([\s\S]*?)\\end\{\1\}/g, (_, env, body) => {
        return hold(renderReadableLatexRows(body, `math-${env}`));
    });
    text = text.replace(/\\begin\{array\}(?:\{[^{}]*\})?([\s\S]*?)\\end\{array\}/g, (_, body) => {
        return hold(renderReadableLatexRows(body, 'math-array'));
    });
    text = text.replace(/\\(vec|overrightarrow|overline|hat)\{([^{}]+)\}/g, (_, command, body) => {
        return hold(renderReadableDecorated(command, body));
    });
    text = text.replace(/\\(?:dfrac|tfrac|frac)\{([^{}]+)\}\{(\\sqrt(?:\[[^\]]+\])?\{[^{}]+\})\}/g, (_, numerator, denominator) => hold(renderReadableFraction(numerator, denominator)));
    text = text.replace(/\\(?:dfrac|tfrac|frac)\{(\\sqrt(?:\[[^\]]+\])?\{[^{}]+\})\}\{([^{}]+)\}/g, (_, numerator, denominator) => hold(renderReadableFraction(numerator, denominator)));
    text = text.replace(/\\(?:dfrac|tfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/g, (_, numerator, denominator) => hold(renderReadableFraction(numerator, denominator)));
    text = text.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, (_, degree, radicand) => {
        return hold(renderReadableRoot(radicand, degree));
    });
    text = text.replace(/\\sqrt\{([^{}]+)\}/g, (_, radicand) => {
        return hold(renderReadableRoot(radicand));
    });
    text = text.replace(/\\(?:ce|pu)\{([^{}]+)\}/g, (_, body) => {
        return hold(formatChemistryLatexBody(body));
    });

    LATEX_COMMAND_SYMBOLS.forEach(([command, symbol]) => {
        const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(`${escaped}\\b`, 'g'), symbol);
    });

    text = text
        .replace(/_\{([^{}]+)\}/g, (_, body) => hold(`<sub>${latexToReadableHtml(body).replace(/\s+/g, '')}</sub>`))
        .replace(/\^\{([^{}]+)\}/g, (_, body) => hold(`<sup>${latexToReadableHtml(body).replace(/\s+/g, '')}</sup>`))
        .replace(/_([A-Za-z0-9+\-°]+)/g, (_, body) => hold(`<sub>${escapeHtml(body)}</sub>`))
        .replace(/\^([A-Za-z0-9+\-°]+)/g, (_, body) => hold(`<sup>${escapeHtml(body)}</sup>`))
        .replace(/\\begin\{[^{}]+\}|\\end\{[^{}]+\}/g, '')
        .replace(/\\\\/g, '；')
        .replace(/&/g, '')
        .replace(/\\[A-Za-z]+\*?(?:\{([^{}]*)\})?/g, (_, body) => (body ? latexToReadableHtml(body) : ''))
        .replace(/\s{2,}/g, ' ')
        .trim();

    return restoreHtmlPlaceholders(text, placeholders);
}

function renderPlainLatexExpression(latex, displayMode = false) {
    const source = normalizeLatexSource(latex);
    if (!source) return '';
    const fallbackClass = displayMode ? 'math-display-fallback' : 'math-inline-fallback';
    return `<span class="${fallbackClass}">${latexToReadableHtml(source)}</span>`;
}

function renderLatexExpression(latex, displayMode = false) {
    const source = normalizeLatexSource(latex);
    if (!source) return '';
    try {
        return katex.renderToString(source, {
            displayMode,
            throwOnError: true,
            strict: 'ignore',
            trust: false,
            output: 'htmlAndMathml'
        });
    } catch (error) {
        console.warn('公式规范渲染失败，已启用可读降级:', source, error.message);
        return renderPlainLatexExpression(source, displayMode);
    }
}

function renderDelimitedLatex(segment) {
    if (segment.startsWith('$$') && segment.endsWith('$$')) {
        return renderLatexExpression(segment.slice(2, -2), true);
    }
    if (segment.startsWith('$') && segment.endsWith('$')) {
        return renderLatexExpression(segment.slice(1, -1), false);
    }
    if (segment.startsWith('\\[') && segment.endsWith('\\]')) {
        return renderLatexExpression(segment.slice(2, -2), true);
    }
    if (segment.startsWith('\\(') && segment.endsWith('\\)')) {
        return renderLatexExpression(segment.slice(2, -2), false);
    }
    return formatPlainRichText(segment);
}

function isLatexExpressionChar(char) {
    return /[A-Za-z0-9\\{}()[\]^_+\-*/=<>≤≥≠,.;:|·°′″\s]/.test(char);
}

function expandLatexExpression(text, commandIndex) {
    let start = commandIndex;
    let end = commandIndex;

    while (start > 0 && isLatexExpressionChar(text[start - 1])) {
        start -= 1;
    }
    while (end < text.length && isLatexExpressionChar(text[end])) {
        end += 1;
    }

    const left = text.slice(start, commandIndex);
    const compactLeft = left.replace(/\s+/g, '');
    if (!/[\\{}_^=+\-*/<>≤≥≠]/.test(left) && /[A-Za-z]{2,}/.test(compactLeft)) {
        start = commandIndex;
    }

    const optionPrefix = text.slice(start).match(/^\s*[A-D]\.(?=[A-Za-z\\])/);
    if (optionPrefix) {
        start += optionPrefix[0].length;
    }

    const optionMatches = [...left.matchAll(/(?:^|\s)[A-D]\.(?=[A-Za-z\\])/g)];
    if (optionMatches.length > 0) {
        const last = optionMatches[optionMatches.length - 1];
        start += last.index + last[0].length;
    }

    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    return { start, end };
}

function findNextLatexExpression(text, fromIndex) {
    LATEX_START_PATTERN.lastIndex = fromIndex;
    const match = LATEX_START_PATTERN.exec(text);
    if (!match) return null;
    return expandLatexExpression(text, match.index);
}

function formatPlainTextWithLatex(value, latexRenderer) {
    const text = String(value || '');
    let html = '';
    let lastIndex = 0;

    let expression = findNextLatexExpression(text, 0);
    while (expression) {
        if (expression.start < lastIndex) {
            expression = findNextLatexExpression(text, lastIndex);
            continue;
        }
        html += formatPlainRichText(text.slice(lastIndex, expression.start));
        html += latexRenderer(text.slice(expression.start, expression.end), false);
        lastIndex = expression.end;
        expression = findNextLatexExpression(text, lastIndex);
    }
    html += formatPlainRichText(text.slice(lastIndex));
    return html;
}

function formatRichTextWithLatexRenderer(value, latexRenderer) {
    const text = String(value ?? '');
    let html = '';
    let lastIndex = 0;
    LATEX_SEGMENT_PATTERN.lastIndex = 0;
    let match = LATEX_SEGMENT_PATTERN.exec(text);
    while (match) {
        html += formatPlainTextWithLatex(text.slice(lastIndex, match.index), latexRenderer);
        html += renderDelimitedLatexWithRenderer(match[0], latexRenderer);
        lastIndex = match.index + match[0].length;
        match = LATEX_SEGMENT_PATTERN.exec(text);
    }
    html += formatPlainTextWithLatex(text.slice(lastIndex), latexRenderer);
    return html;
}

function renderDelimitedLatexWithRenderer(segment, latexRenderer) {
    if (segment.startsWith('$$') && segment.endsWith('$$')) {
        return latexRenderer(segment.slice(2, -2), true);
    }
    if (segment.startsWith('$') && segment.endsWith('$')) {
        return latexRenderer(segment.slice(1, -1), false);
    }
    if (segment.startsWith('\\[') && segment.endsWith('\\]')) {
        return latexRenderer(segment.slice(2, -2), true);
    }
    if (segment.startsWith('\\(') && segment.endsWith('\\)')) {
        return latexRenderer(segment.slice(2, -2), false);
    }
    return formatPlainRichText(segment);
}

function formatRichText(value) {
    return formatRichTextWithLatexRenderer(value, renderLatexExpression);
}

async function onConfigChange() {
    if (!document.getElementById('grade') || !document.getElementById('subject')) return;
    const grade = document.getElementById('grade').value;
    const subject = document.getElementById('subject').value;

    try {
        // 并行加载知识点和题型
        const [topicsResp, typesResp] = await Promise.all([
            apiFetch(`${API_BASE}/knowledge/topics?grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}`),
            apiFetch(`${API_BASE}/knowledge/question-types?grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}`)
        ]);

        const topicsData = await topicsResp.json();
        const typesData = await typesResp.json();

        state.topicsData = topicsData.topics || [];
        populateTopics(state.topicsData);
        populateExamPoints([]);

        // 加载题型多选
        populateQuestionTypes(typesData.questionTypes || []);
    } catch (e) {
        console.error('加载配置失败:', e);
        state.topicsData = [];
        populateTopics([]);
        populateExamPoints([]);
        populateQuestionTypes(['选择题', '填空题', '解答题']);
    }
    saveSettings();
}

function populateTopics(topics) {
    const sel = document.getElementById('topicSelect');
    hideManualInput('topic');
    sel.innerHTML = '<option value="">-- 请选择知识点 --</option>';
    if (!topics || topics.length === 0) {
        sel.innerHTML = '<option value="">-- 暂无预设知识点，请自定义输入 --</option>';
    } else {
        topics.forEach(t => {
            const opt = document.createElement('option');
            const name = typeof t === 'string' ? t : t.name;
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
    }
    // 添加"手动输入知识点"选项
    const manualOpt = document.createElement('option');
    manualOpt.value = '__manual__';
    manualOpt.textContent = '✎ 手动输入知识点（没找到时点这里）';
    sel.appendChild(manualOpt);
}

async function onTopicChange() {
    const sel = document.getElementById('topicSelect');
    const topicName = sel.value;

    // 隐藏手动输入框（如果之前显示了）
    hideManualInput('topic');

    if (topicName === '__manual__') {
        showManualInput('topic');
        populateExamPoints([]);
        saveSettings();
        return;
    }

    if (!topicName) {
        populateExamPoints([]);
        saveSettings();
        return;
    }

    try {
        const grade = document.getElementById('grade').value;
        const subject = document.getElementById('subject').value;
        const resp = await apiFetch(
            `${API_BASE}/knowledge/exam-points?grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}&topic=${encodeURIComponent(topicName)}`
        );
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }
        const payload = await resp.json();
        populateExamPoints(Array.isArray(payload.examPoints) ? payload.examPoints : []);
    } catch (e) {
        console.error('加载考点失败:', e);
        populateExamPoints([]);
    }
    saveSettings();
}

function populateExamPoints(points) {
    const sel = document.getElementById('examPointSelect');
    // 隐藏手动输入框
    hideManualInput('examPoint');

    if (!points || points.length === 0) {
        sel.innerHTML = '<option value="">-- 请先选择知识点 --</option>';
    } else {
        sel.innerHTML = '<option value="">-- 请选择考点 --</option>';
        points.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p; opt.textContent = p;
            sel.appendChild(opt);
        });
    }
    // 添加"手动输入考点"选项
    const manualOpt = document.createElement('option');
    manualOpt.value = '__manual__';
    manualOpt.textContent = '✎ 手动输入考点（没找到时点这里）';
    sel.appendChild(manualOpt);
}

function onExamPointChange() {
    const sel = document.getElementById('examPointSelect');
    const value = sel.value;

    hideManualInput('examPoint');

    if (value === '__manual__') {
        showManualInput('examPoint');
    }
}

function bindManualEntryButtons() {
    const topicBtn = document.getElementById('manualTopicBtn');
    const examPointBtn = document.getElementById('manualExamPointBtn');

    if (topicBtn) {
        topicBtn.addEventListener('click', () => openManualEntry('topic'));
    }
    if (examPointBtn) {
        examPointBtn.addEventListener('click', () => openManualEntry('examPoint'));
    }
}

function openManualEntry(type) {
    const selectId = type === 'topic' ? 'topicSelect' : 'examPointSelect';
    const sel = document.getElementById(selectId);
    if (!sel) return;

    sel.value = '__manual__';
    if (type === 'topic') {
        populateExamPoints([]);
    }
    showManualInput(type);
}

function showManualInput(type) {
    const selectId = type === 'topic' ? 'topicSelect' : 'examPointSelect';
    const sel = document.getElementById(selectId);
    const parent = sel.parentElement;

    // 检查是否已存在输入框
    let inputDiv = parent.querySelector('.manual-input-wrapper');
    if (inputDiv) return;

    inputDiv = document.createElement('div');
    inputDiv.className = 'manual-input-wrapper';

    const prompt = document.createElement('div');
    prompt.className = 'manual-input-prompt';
    prompt.textContent = type === 'topic'
        ? '没有匹配的知识点？直接填写任意出题范围，系统会按你的输入生成题目'
        : '没有匹配的考点？直接填写本次重点考查方向，越具体越好';

    const inputRow = document.createElement('div');
    inputRow.className = 'manual-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = type === 'topic' ? 'manualTopicInput' : 'manualExamPointInput';
    input.placeholder = type === 'topic' ? '例如：一次函数图像与性质' : '例如：利用勾股定理求最短路径';
    input.className = 'manual-input-control';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '确定使用';
    confirmBtn.className = 'manual-input-confirm';
    confirmBtn.onclick = () => confirmManualInput(type);

    inputRow.appendChild(input);
    inputRow.appendChild(confirmBtn);
    inputDiv.appendChild(prompt);
    inputDiv.appendChild(inputRow);
    parent.appendChild(inputDiv);

    input.focus();

    // 回车键确认
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') confirmManualInput(type);
    });
}

function hideManualInput(type) {
    const selectId = type === 'topic' ? 'topicSelect' : 'examPointSelect';
    const sel = document.getElementById(selectId);
    const parent = sel.parentElement;
    const inputDiv = parent.querySelector('.manual-input-wrapper');
    if (inputDiv) inputDiv.remove();
}

function confirmManualInput(type) {
    const inputId = type === 'topic' ? 'manualTopicInput' : 'manualExamPointInput';
    const selectId = type === 'topic' ? 'topicSelect' : 'examPointSelect';
    const input = document.getElementById(inputId);
    const sel = document.getElementById(selectId);

    const value = input.value.trim();
    if (!value) {
        alert('请输入内容');
        return;
    }

    // 移除"手动输入"选项
    const manualOpt = sel.querySelector('option[value="__manual__"]');
    if (manualOpt) manualOpt.remove();

    // 添加用户输入的选项并选中
    const newOpt = document.createElement('option');
    newOpt.value = value;
    newOpt.textContent = '已自定义：' + value;
    newOpt.selected = true;
    sel.appendChild(newOpt);

    // 重新添加"手动输入"选项到最后
    const manualOptNew = document.createElement('option');
    manualOptNew.value = '__manual__';
    manualOptNew.textContent = type === 'topic' ? '✎ 手动输入知识点（没找到时点这里）' : '✎ 手动输入考点（没找到时点这里）';
    sel.appendChild(manualOptNew);

    // 隐藏输入框
    hideManualInput(type);

    // 如果是知识点，清空考点选择
    if (type === 'topic') {
        populateExamPoints([]);
    }
}

// 题型多选
function populateQuestionTypes(types) {
    const container = document.getElementById('questionTypeContainer');
    if (!types || types.length === 0) {
        container.innerHTML = '<span style="color:#8892b0;font-size:12px">暂无可用题型</span>';
        return;
    }
    container.innerHTML = '';
    types.forEach(type => {
        const tag = document.createElement('span');
        tag.className = 'qtype-tag active'; // 默认全选
        tag.textContent = type;
        tag.dataset.type = type;
        tag.onclick = () => {
            tag.classList.toggle('active');
            saveSettings();
        };
        container.appendChild(tag);
    });
}

function getSelectedQuestionTypes() {
    const tags = document.querySelectorAll('#questionTypeContainer .qtype-tag.active');
    return Array.from(tags).map(t => t.dataset.type);
}

// 题目数量
function updateQuestionCount() {
    const val = document.getElementById('questionCount').value;
    document.getElementById('questionCountInput').value = val;
    saveSettings();
}

function syncQuestionCount(input) {
    let val = parseInt(input.value) || 15;
    val = Math.max(1, Math.min(30, val));
    input.value = val;
    document.getElementById('questionCount').value = val;
    saveSettings();
}

function initDifficultyBar() {
    const bar = document.getElementById('difficultyBar');
    bar.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
        const seg = document.createElement('div');
        seg.className = 'seg';
        seg.dataset.level = i;
        bar.appendChild(seg);
    }
}

function updateDifficultyDisplay() {
    const val = parseInt(document.getElementById('difficulty').value);
    document.getElementById('difficultyValue').textContent = val;
    document.getElementById('difficultyLabel').textContent = state.difficultyNames[val] || `等级${val}`;

    const segs = document.querySelectorAll('.difficulty-bar .seg');
    segs.forEach(seg => {
        const level = parseInt(seg.dataset.level);
        seg.className = 'seg';
        if (level <= val) {
            seg.classList.add('on');
            if (level >= 8) seg.classList.add('danger');
            else if (level >= 6) seg.classList.add('warn');
        }
    });
    saveSettings();
}

function getSelectedTopic() {
    const value = document.getElementById('topicSelect').value || '';
    return value === '__manual__' ? '' : value;
}

function getSelectedExamPoint() {
    const value = document.getElementById('examPointSelect').value || '';
    return value === '__manual__' ? '' : value;
}

function setGenerateButtonLoading(isLoading, text = '') {
    const btn = document.getElementById('generateBtn');
    if (!btn) return;
    const label = btn.querySelector('span') || btn;
    btn.disabled = !!isLoading || state.uploadedFiles.length === 0;
    btn.classList.toggle('is-loading', !!isLoading);
    label.textContent = text || (isLoading ? '正在生成变式试卷...' : '生成变式试卷');
}

function getVariantSettings() {
    const difficultyEl = document.getElementById('variantDifficulty');
    const coefficientEl = document.getElementById('variationCoefficient');
    return {
        variantDifficulty: clampLevel(difficultyEl?.value, DEFAULT_VARIANT_DIFFICULTY),
        variationCoefficient: clampLevel(coefficientEl?.value, DEFAULT_VARIATION_COEFFICIENT)
    };
}

function updateVariantSettingsDisplay() {
    const difficultyEl = document.getElementById('variantDifficulty');
    const difficultyValueEl = document.getElementById('variantDifficultyValue');
    const coefficientEl = document.getElementById('variationCoefficient');
    const coefficientValueEl = document.getElementById('variationCoefficientValue');

    if (difficultyEl) {
        difficultyEl.value = clampLevel(difficultyEl.value, DEFAULT_VARIANT_DIFFICULTY);
        if (difficultyValueEl) difficultyValueEl.textContent = difficultyEl.value;
    }
    if (coefficientEl) {
        coefficientEl.value = clampLevel(coefficientEl.value, DEFAULT_VARIATION_COEFFICIENT);
        if (coefficientValueEl) coefficientValueEl.textContent = coefficientEl.value;
    }

    saveSettings();
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getFileExtension(fileName) {
    const matched = String(fileName || '').toLowerCase().match(/\.[^.]+$/);
    return matched ? matched[0] : '';
}

function isAcceptedUploadFile(file) {
    const allowedTypes = new Set([
        'image/jpeg',
        'image/png',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]);
    const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx']);
    return allowedTypes.has(String(file.type || '').toLowerCase()) || allowedExtensions.has(getFileExtension(file.name));
}

function renderUploadFileList() {
    const listEl = document.getElementById('uploadFileList');
    const btn = document.getElementById('generateBtn');
    if (!listEl) return;

    if (!state.uploadedFiles.length) {
        listEl.innerHTML = '<div class="upload-empty">尚未选择文件</div>';
    } else {
        listEl.innerHTML = state.uploadedFiles.map((file, index) => `
            <div class="upload-file-item">
                <div class="upload-file-main">
                    <span class="upload-file-name">${file.name}</span>
                    <span class="upload-file-meta">${formatFileSize(file.size)}</span>
                </div>
                <button class="upload-file-remove" type="button" data-index="${index}" aria-label="移除文件">×</button>
            </div>
        `).join('');
        listEl.querySelectorAll('.upload-file-remove').forEach((button) => {
            button.addEventListener('click', () => {
                const index = Number.parseInt(button.dataset.index, 10);
                if (!Number.isNaN(index)) {
                    state.uploadedFiles.splice(index, 1);
                    renderUploadFileList();
                }
            });
        });
    }

    if (btn) {
        btn.disabled = state.uploadedFiles.length === 0;
    }
}

function handleUploadFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    if (incoming.length > MAX_UPLOAD_FILE_COUNT) {
        alert(`一次最多上传 ${MAX_UPLOAD_FILE_COUNT} 个文件，请分批生成。`);
        return;
    }

    const invalidFiles = incoming.filter((file) => !isAcceptedUploadFile(file));
    if (invalidFiles.length > 0) {
        alert(`以下文件格式暂不支持：${invalidFiles.map((file) => file.name).join('、')}`);
        return;
    }

    state.uploadedFiles = incoming;
    renderUploadFileList();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
        reader.readAsDataURL(file);
    });
}

function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片解析失败'));
        img.src = dataUrl;
    });
}

async function compressImageDataUrl(dataUrl) {
    const img = await loadImage(dataUrl);
    const sourceMax = Math.max(img.width, img.height);
    const shouldResize = sourceMax > MAX_UPLOAD_IMAGE_SIDE;
    const shouldCompress = dataUrl.length > 1800000;

    if (!shouldResize && !shouldCompress) return dataUrl;

    const ratio = shouldResize ? (MAX_UPLOAD_IMAGE_SIDE / sourceMax) : 1;
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.88);
}

async function prepareUploadAssets() {
    return Promise.all(state.uploadedFiles.map(async (file) => {
        const dataUrl = await readFileAsDataUrl(file);
        if ((file.type || '').startsWith('image/')) {
            const compressedDataUrl = await compressImageDataUrl(dataUrl);
            const wasCompressed = compressedDataUrl !== dataUrl;
            return {
                name: file.name,
                type: wasCompressed ? 'image/jpeg' : (file.type || ''),
                size: wasCompressed ? Math.round((compressedDataUrl.length * 3) / 4) : file.size,
                dataUrl: compressedDataUrl
            };
        }

        // PDF 与 Word 必须保留原始扩展名和二进制内容，由 Node 后端统一解析。
        return {
            name: file.name,
            type: file.type || '',
            size: file.size,
            dataUrl
        };
    }));
}

function updateFigureProgressBanner(done, total, failed = 0, active = true) {
    const composeBtn = document.getElementById('composeBtn');
    const composeTip = document.querySelector('.compose-tip');
    state.figureLoading = active;
    state.figureFailedCount = active ? 0 : failed;

    if (composeTip && total > 0) {
        if (active) {
            composeTip.textContent = failed > 0
                ? `正在严格生成图形 ${done}/${total}，剩余 ${failed} 个继续重试，质量优先`
                : `正在严格生成图形 ${done}/${total}，质量优先，请耐心等待`;
        } else if (failed > 0) {
            composeTip.textContent = `有 ${failed} 个图形未通过严格校验，已阻止缺图组卷`;
        } else {
            composeTip.textContent = '图形已全部生成，可组卷';
        }
    }

    if (composeBtn) {
        composeBtn.disabled = state.selectedQuestions.size === 0 || active || failed > 0;
    }

    const banner = document.getElementById('figureProgressBanner');
    if (banner) banner.remove();
}

async function consumeUnifiedCredit() {
    if (window.HZQ && typeof window.HZQ.checkCredit === 'function') {
        return window.HZQ.checkCredit();
    }
    return true;
}

async function readJsonResponse(response, fallbackError = '请求失败') {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 180);
        return {
            error: /^<!doctype|^<html/i.test(snippet)
                ? `服务端返回网页错误页（HTTP ${response.status}），请稍后重试。`
                : (snippet || fallbackError)
        };
    }
}

function withUsageHeaders(headers = {}) {
    const nextHeaders = { ...headers };
    if (
        window.HZQ
        && typeof window.HZQ.getUsageToken === 'function'
        && !nextHeaders['X-HZQ-Usage-Token']
    ) {
        const token = window.HZQ.getUsageToken();
        if (token) {
            nextHeaders['X-HZQ-Usage-Token'] = token;
        }
    }
    return nextHeaders;
}

async function generateExam() {
    if (state.uploadedFiles.length === 0) {
        alert('请先上传一份完整试卷');
        return;
    }

    const hasCredit = await consumeUnifiedCredit();
    if (!hasCredit) return;
    state.activeGenerateToken = Date.now();
    const requestToken = state.activeGenerateToken;

    const loadingEl = document.getElementById('loading');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingSubtitle = document.getElementById('loadingSubtitle');
    const fakeProgressBar = document.getElementById('fakeProgressBar');
    const fakeProgressText = document.getElementById('fakeProgressText');

    const loadingMessages = [
        { title: '正在解析原卷...', subtitle: '正在读取上传文件与页面内容' },
        { title: '正在解析原卷...', subtitle: '正在整理原卷内容' },
        { title: '正在生成变式卷...', subtitle: '正在逐题生成对应变体题' },
        { title: '正在生成变式卷...', subtitle: '正在核对答案与解析' },
        { title: '正在整理试卷...', subtitle: '正在生成完整 A4 试卷预览' }
    ];

    let messageIndex = 0;
    let fakeProgress = 0;

    loadingEl.style.display = 'flex';
    setGenerateButtonLoading(true, '正在生成试卷...');
    if (loadingTitle) loadingTitle.textContent = loadingMessages[0].title;
    if (loadingSubtitle) loadingSubtitle.textContent = loadingMessages[0].subtitle;
    if (fakeProgressBar) fakeProgressBar.style.width = '0%';
    if (fakeProgressText) fakeProgressText.textContent = '0%';

    const messageInterval = setInterval(() => {
        messageIndex = (messageIndex + 1) % loadingMessages.length;
        if (loadingTitle) loadingTitle.textContent = loadingMessages[messageIndex].title;
        if (loadingSubtitle) loadingSubtitle.textContent = loadingMessages[messageIndex].subtitle;
    }, 1800);

    const fakeProgressInterval = setInterval(() => {
        if (fakeProgress >= 96) return;
        fakeProgress += 1;
        const progressText = fakeProgress + '%';
        if (fakeProgressBar) fakeProgressBar.style.width = progressText;
        if (fakeProgressText) fakeProgressText.textContent = progressText;
    }, 1000);

    switchToSelectMode();
    updateFigureProgressBanner(0, 0, 0, false);

    try {
        const variantSettings = getVariantSettings();
        const files = await prepareUploadAssets();

        const resp = await apiFetch(`${API_BASE}/exam/generate-from-upload`, {
            method: 'POST',
            headers: withUsageHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ files, ...variantSettings })
        });

        if (!resp.ok) {
            const errData = await readJsonResponse(resp, '生成失败');
            if (errData?.code === 'TRIAL_CREDITS_EXHAUSTED') {
                if (window.HZQ && typeof window.HZQ._showRedeemModal === 'function') {
                    window.HZQ._showRedeemModal();
                } else {
                    alert('积分不足，请登录后兑换或充值积分。');
                }
                return;
            }
            alert('生成失败：' + (errData.error || '请稍后重试'));
            return;
        }

        const data = await readJsonResponse(resp, '生成失败');
        if (requestToken !== state.activeGenerateToken) return;

        if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
            state.currentExamData = data;
            renderQuestionCards(data, requestToken, { autoCompose: true });
        } else if (data.error) {
            alert('生成失败：' + data.error);
        } else {
            alert('生成失败：没有返回有效题目，请重试。');
        }
    } catch (e) {
        console.error('生成试卷失败:', e);
        alert('生成试卷失败：' + e.message);
    } finally {
        clearInterval(messageInterval);
        clearInterval(fakeProgressInterval);
        if (requestToken === state.activeGenerateToken) {
            loadingEl.style.display = 'none';
            setGenerateButtonLoading(false);
        }
    }
}

function renderQuestionCards(data, figureLoadToken = Date.now(), options = {}) {
    const container = document.getElementById('selectMode');
    const composeBar = document.getElementById('composeBar');
    let html = '';
    let globalIndex = 0;

    state.generatedQuestions = [];
    state.selectedQuestions.clear();
    state.figureCache.clear();
    state.activeFigureLoadToken = figureLoadToken;
    state.pendingFigures = [];

    if (data.questions && Array.isArray(data.questions)) {
        for (const group of data.questions) {
            if (!group || !group.items) continue;
            html += `<div class="group-header">${formatRichText(group.title || '')}</div>`;
            for (const item of group.items) {
                if (!item) continue;
                const idx = globalIndex++;
                state.generatedQuestions.push({ ...item, groupType: group.type, groupTitle: group.title });

                html += `<div class="question-card" data-idx="${idx}">
                    <div class="select-check">&#10003;</div>
                    <div class="q-stem">${item.index || ''}. ${formatRichText(item.stem || '')}</div>`;

                if (item.options) {
                    html += `<div class="q-options">${item.options.filter(o => o).map(o => `<div class="q-option">${formatRichText(o)}</div>`).join('')}</div>`;
                }

                if (item.figure) {
                    const figId = `fig_${idx}_${Date.now()}`;
                    html += `<div class="q-figure q-figure-loading" id="${figId}" style="min-height:60px;border:1px dashed #ddd;padding:10px;text-align:center;border-radius:4px;background:#fafafa">
                        <span style="color:#999;font-size:12px">图形排队中...</span>
                    </div>`;
                    state.pendingFigures.push({
                        id: figId,
                        qIdx: idx,
                        figure: item.figure,
                        figureType: typeof item.figure === 'object' ? (item.figure.type || '') : '',
                        stem: item.stem || '',
                        subject: data.analysisSummary?.subject || data.metadata?.subject || ''
                    });
                }
                html += `</div>`;
            }
        }
    }

    container.innerHTML = html;
    bindQuestionCardClicks();
    if (options.autoCompose) {
        state.generatedQuestions.forEach((_, idx) => state.selectedQuestions.add(idx));
        container.querySelectorAll('.question-card').forEach((card) => card.classList.add('selected'));
        composeBar.style.display = 'none';
    } else {
        composeBar.style.display = 'flex';
    }
    updateSelectedCount();
    const figurePromise = loadFiguresAsync(figureLoadToken);
    if (options.autoCompose) {
        figurePromise.then((result) => {
            if (figureLoadToken !== state.activeFigureLoadToken) return;
            if (result?.ok && !state.figureLoading && state.figureFailedCount === 0) {
                composeExam();
            } else if (result && !result.ok) {
                alert('图形严格生成未完成，系统已阻止缺图组卷。请重新生成本次试卷。');
            }
        });
    }
}

function bindQuestionCardClicks() {
    const container = document.getElementById('selectMode');
    if (!container || state.questionCardClickBound) return;

    // 题目区容器不会重建，只绑定一次，避免重复生成后点击被来回切换
    container.addEventListener('click', (event) => {
        const card = event.target.closest('.question-card');
        if (!card || !container.contains(card)) return;

        const idx = parseInt(card.dataset.idx, 10);
        if (!isNaN(idx)) {
            toggleQuestion(idx);
        }
    });

    state.questionCardClickBound = true;
}

async function loadSingleFigure(fig, figureLoadToken, retryCount = 0) {
    if (figureLoadToken !== state.activeFigureLoadToken) return false;

    const desc = typeof fig.figure === 'string'
        ? fig.figure
        : (fig.figure.description || fig.figure.code || '');
    const el = document.getElementById(fig.id);
    if (!el) return false;

    if (!desc) {
        el.style.display = 'none';
        return false;
    }

    try {
        el.innerHTML = `<span style="color:#999;font-size:12px">${retryCount > 0 ? '图形重试中...' : '图形生成中...'}</span>`;

        const resp = await apiFetch(`${API_BASE}/render/figure`, {
            method: 'POST',
            headers: withUsageHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                description: desc,
                figureType: fig.figureType || (typeof fig.figure === 'object' ? (fig.figure.type || '') : ''),
                stem: fig.stem || '',
                subject: fig.subject
            })
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (figureLoadToken !== state.activeFigureLoadToken) return false;

        if (data.svg) {
            el.innerHTML = data.svg;
            el.style.border = 'none';
            el.style.background = 'transparent';
            el.classList.remove('q-figure-loading');
            if (fig.qIdx !== undefined) {
                state.figureCache.set(fig.qIdx, data.svg);
            }
            return true;
        }
        if (data.error) throw new Error(data.error);
    } catch (e) {
        if (retryCount < 2) {
            await new Promise(resolve => setTimeout(resolve, 600 * (retryCount + 1)));
            return loadSingleFigure(fig, figureLoadToken, retryCount + 1);
        }
    }

    if (figureLoadToken !== state.activeFigureLoadToken) return false;
    const lastEl = document.getElementById(fig.id);
    if (lastEl) {
        lastEl.innerHTML = '<span style="color:#999;font-size:12px">图形严格生成未完成，已阻止缺图组卷</span>';
        lastEl.style.display = '';
        lastEl.style.border = '1px dashed #ddd';
        lastEl.style.background = '#fafafa';
    }
    return false;
}

function buildFigureRequestPayload(figures) {
    return figures.map((fig) => {
        const figure = fig.figure || {};
        const description = typeof figure === 'string'
            ? figure
            : (figure.description || figure.code || '');
        return {
            id: fig.id,
            description,
            figureType: fig.figureType || (typeof figure === 'object' ? (figure.type || '') : ''),
            stem: fig.stem || '',
            subject: fig.subject || ''
        };
    }).filter((item) => item.description);
}

function applyFigureResult(fig, result) {
    const el = document.getElementById(fig.id);
    if (!el || !result?.svg) return false;

    el.innerHTML = result.svg;
    el.style.border = 'none';
    el.style.background = 'transparent';
    el.classList.remove('q-figure-loading');
    if (fig.qIdx !== undefined) {
        state.figureCache.set(fig.qIdx, result.svg);
    }
    return true;
}

async function loadFigureBatch(figures, figureLoadToken, round = 0) {
    if (figureLoadToken !== state.activeFigureLoadToken) return { done: 0, failed: 0 };

    const payloadFigures = buildFigureRequestPayload(figures);
    const payloadIds = new Set(payloadFigures.map((item) => item.id));
    const missingDescriptionFigures = figures.filter((fig) => !payloadIds.has(fig.id));
    if (payloadFigures.length === 0) {
        return { done: 0, failed: figures.length, failedFigures: figures };
    }

    for (const fig of figures) {
        const el = document.getElementById(fig.id);
        if (el) {
            el.innerHTML = `<span style="color:#999;font-size:12px">${round > 0 ? `图形严格重试中（第 ${round + 1} 轮）...` : '图形严格生成中...'}</span>`;
        }
    }

    try {
        const resp = await apiFetch(`${API_BASE}/render/figures-batch`, {
            method: 'POST',
            headers: withUsageHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ figures: payloadFigures })
        });

        const data = await readJsonResponse(resp, '图形批量生成失败');
        if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
        if (figureLoadToken !== state.activeFigureLoadToken) return { done: 0, failed: 0 };

        const results = Array.isArray(data.results) ? data.results : [];
        const resultMap = new Map(results.map((item) => [item.id, item]));
        let done = 0;
        const failedFigures = [...missingDescriptionFigures];

        for (const fig of figures) {
            if (!payloadIds.has(fig.id)) continue;
            const result = resultMap.get(fig.id);
            if (applyFigureResult(fig, result)) {
                done += 1;
            } else {
                failedFigures.push(fig);
            }
        }

        return { done, failed: failedFigures.length, failedFigures };
    } catch (e) {
        console.warn('[图形] 批量生成本轮失败，将继续排队重试:', e.message);
        return { done: 0, failed: figures.length, failedFigures: figures };
    }
}

async function loadFiguresAsync(figureLoadToken) {
    if (!state.pendingFigures || state.pendingFigures.length === 0) {
        updateFigureProgressBanner(0, 0, 0, false);
        return { ok: true, done: 0, failed: 0 };
    }
    if (figureLoadToken !== state.activeFigureLoadToken) {
        return { ok: false, done: 0, failed: 0, cancelled: true };
    }

    const figures = state.pendingFigures;
    state.pendingFigures = [];

    const total = figures.length;
    let done = 0;
    let remaining = figures;

    updateFigureProgressBanner(done, total, remaining.length, true);

    for (let round = 0; round < FIGURE_STRICT_MAX_ROUNDS && remaining.length > 0; round += 1) {
        const currentRoundFigures = remaining;
        const nextRemaining = [];

        for (let index = 0; index < currentRoundFigures.length; index += FIGURE_BATCH_SIZE) {
            if (figureLoadToken !== state.activeFigureLoadToken) {
                return { ok: false, done, failed: nextRemaining.length, cancelled: true };
            }

            const batch = currentRoundFigures.slice(index, index + FIGURE_BATCH_SIZE);
            const result = await loadFigureBatch(batch, figureLoadToken, round);
            done += result.done || 0;
            nextRemaining.push(...(Array.isArray(result.failedFigures) ? result.failedFigures : batch));

            if (figureLoadToken === state.activeFigureLoadToken) {
                const unprocessedCount = Math.max(0, currentRoundFigures.length - index - batch.length);
                updateFigureProgressBanner(done, total, nextRemaining.length + unprocessedCount, true);
            }
        }

        remaining = nextRemaining;
        if (remaining.length > 0 && round < FIGURE_STRICT_MAX_ROUNDS - 1) {
            await new Promise(resolve => setTimeout(resolve, Math.min(8000, 1200 * (round + 1))));
        }
    }

    if (figureLoadToken === state.activeFigureLoadToken) {
        if (remaining.length > 0) {
            state.pendingFigures = remaining;
            for (const fig of remaining) {
                const el = document.getElementById(fig.id);
                if (el) {
                    el.innerHTML = '<span style="color:#999;font-size:12px">图形严格生成未完成，已阻止缺图组卷</span>';
                    el.style.display = '';
                    el.style.border = '1px dashed #ddd';
                    el.style.background = '#fafafa';
                }
            }
            updateFigureProgressBanner(done, total, remaining.length, false);
            return { ok: false, done, failed: remaining.length };
        }

        updateFigureProgressBanner(total, total, 0, false);
    }

    return { ok: true, done: total, failed: 0 };
}

function toggleQuestion(idx) {
    if (state.selectedQuestions.has(idx)) state.selectedQuestions.delete(idx);
    else state.selectedQuestions.add(idx);

    const card = document.querySelector(`.question-card[data-idx="${idx}"]`);
    if (card) card.classList.toggle('selected');
    updateSelectedCount();
}

function updateSelectedCount() {
    const count = state.selectedQuestions.size;
    const selectedCount = document.getElementById('selectedCount');
    const composeBtn = document.getElementById('composeBtn');
    if (selectedCount) selectedCount.textContent = count;
    if (composeBtn) composeBtn.disabled = count === 0 || state.figureLoading || state.figureFailedCount > 0;
}

function composeExam() {
    if (state.selectedQuestions.size === 0) { alert('请至少选择一道题目'); return; }
    if (state.figureLoading) {
        alert('图形仍在生成中。为保证准确性，请等待所有图形生成完成后再组卷。');
        return;
    }
    if (state.figureFailedCount > 0) {
        alert('图形严格生成未完成，系统已阻止缺图组卷。请重新生成本次试卷。');
        return;
    }

    const missingFigureItems = Array.from(state.selectedQuestions)
        .map(idx => ({ idx, item: state.generatedQuestions[idx] }))
        .filter(({ idx, item }) => item?.figure && !state.figureCache.has(idx));
    if (missingFigureItems.length > 0) {
        alert('所选题目中仍有图形未完成严格生成，请等待系统完成后再组卷。');
        return;
    }

    console.log('[组卷] 开始组卷，已选题目数:', state.selectedQuestions.size);

    // 按原始索引排序，保持选题时的顺序
    const selectedIndices = Array.from(state.selectedQuestions).sort((a, b) => a - b);

    const groups = {};
    selectedIndices.forEach(idx => {
        const q = state.generatedQuestions[idx];
        if (!q) return;
        const type = q.groupType || 'other';
        if (!groups[type]) groups[type] = { title: q.groupTitle, items: [], order: getTypeOrder(type) };
        groups[type].items.push({ ...q, originalIdx: idx });
    });

    console.log('[组卷] 分组结果:', groups);

    // 按题型顺序排序（选择题、填空题、解答题）
    const sortedGroups = Object.entries(groups).sort((a, b) => a[1].order - b[1].order);

    // 重新编号
    let num = 1;
    sortedGroups.forEach(([type, group]) => {
        group.items.forEach(item => { item.index = num++; });
    });

    const groupsObj = Object.fromEntries(sortedGroups);
    console.log('[组卷] 最终数据:', groupsObj);

    renderExamPreview(state.currentExamData?.title || '试卷', groupsObj);
    switchToPreviewMode();
}

function getTypeOrder(type) {
    const order = { 'choice': 1, 'fill': 2, 'blank': 2, 'calculation': 3, 'qa': 3 };
    return order[type] || 99;
}

function renderExamPreview(title, groups) {
    console.log('[预览] 开始渲染试卷预览');
    state.currentPreviewGroups = groups;

    // 重新显示标题编辑提示
    const titleHint = document.getElementById('titleEditHint');
    if (titleHint) { titleHint.style.display = ''; titleHint.style.opacity = '1'; }

    document.getElementById('paperTitle').textContent = title;
    let html = '';

    for (const [type, group] of Object.entries(groups)) {
        if (!group || !group.items || group.items.length === 0) {
            console.warn('[预览] 跳过空分组:', type);
            continue;
        }

        console.log(`[预览] 渲染分组 ${type}:`, group.title, '题目数:', group.items.length);
        html += `<div class="question-group"><div class="group-title">${formatRichText(group.title || '')}</div>`;

        for (const item of group.items) {
            if (!item) {
                console.warn('[预览] 跳过空题目');
                continue;
            }

            html += `<div class="question-item"><div class="q-stem">${item.index}. ${formatRichText(item.stem || '')}</div>`;

            if (item.options) {
                html += `<div class="q-options">${item.options.filter(o => o).map(o => `<div class="q-option">${formatRichText(o)}</div>`).join('')}</div>`;
            }

            if (item.figure) {
                const cachedSvg = state.figureCache.get(item.originalIdx);
                if (cachedSvg) {
                    html += `<div class="q-figure" style="text-align:center">${cachedSvg}</div>`;
                } else {
                    console.warn(`[预览] 题${item.index}的图形未找到缓存，originalIdx:`, item.originalIdx);
                    alert('检测到试卷仍有图形未完成严格生成，已取消本次预览，避免生成缺图试卷。');
                    return;
                }
            }

            html += `</div>`;
        }
        html += `</div>`;
    }

    console.log('[预览] 生成的HTML长度:', html.length);

    const examContent = document.getElementById('examContent');
    if (!examContent) {
        console.error('[预览] 找不到examContent元素！');
        return;
    }

    examContent.innerHTML = html;
    console.log('[预览] HTML已插入到examContent');

    // 渲染答案
    if (state.currentExamData?.answers) {
        const indices = [...state.selectedQuestions].sort((a, b) => a - b);
        const answers = indices.map((idx, i) => {
            const orig = state.currentExamData.answers[idx];
            return orig ? `${i + 1}. ${orig.replace(/^\d+\.\s*/, '')}` : '';
        }).filter(a => a);
        document.getElementById('answerContent').innerHTML = answers.map(a => `<div>${formatRichText(a)}</div>`).join('<br>');
        console.log('[预览] 答案已渲染，数量:', answers.length);
    }

    // 控制答案区域显示
    const showAnswerCheckbox = document.getElementById('showAnswer');
    const answerArea = document.getElementById('answerArea');
    if (showAnswerCheckbox && answerArea) {
        answerArea.style.display = showAnswerCheckbox.checked ? 'block' : 'none';
    }

    console.log('[预览] 试卷预览渲染完成');
}

function switchToSelectMode() {
    state.mode = 'select';
    document.getElementById('selectMode').style.display = 'block';
    document.getElementById('paper').classList.remove('show');
    document.getElementById('downloadBar').classList.remove('show');
}

function switchToPreviewMode() {
    state.mode = 'preview';
    document.getElementById('selectMode').style.display = 'none';
    document.getElementById('composeBar').style.display = 'none';
    const paper = document.getElementById('paper');
    paper.classList.add('show');
    document.getElementById('downloadBar').classList.add('show');
    console.log('[模式] 切换到预览模式, paper.display:', getComputedStyle(paper).display, 'paper.classList:', paper.classList.toString());
}

function backToSelect() {
    switchToSelectMode();
    const composeBar = document.getElementById('composeBar');
    if (composeBar) composeBar.style.display = 'none';
}

async function exportToPdf() {
    const paper = document.getElementById('paper');
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';
    let exportHost = null;
    document.body.classList.add('pdf-export-mode');

    try {
        if (!window.html2pdf) {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');
        }

        const titleText = document.getElementById('paperTitle').textContent;
        const exportPaper = paper.cloneNode(true);
        exportPaper.id = 'paper-export';
        exportPaper.classList.add('pdf-export-paper');
        exportPaper.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'));

        // 隐藏密封线和标题提示
        exportPaper.querySelectorAll('.seal-line, .seal-text').forEach((node) => node.remove());
        const hint = exportPaper.querySelector('.title-edit-hint');
        if (hint) hint.remove();

        exportHost = document.createElement('div');
        exportHost.className = 'pdf-export-host';
        exportHost.style.cssText = [
            'position:absolute',
            'left:0',
            `top:${(window.scrollY || 0) + (window.innerHeight || 900) + 80}px`,
            'width:210mm',
            'max-width:none',
            'background:#ffffff',
            'overflow:visible',
            'pointer-events:none',
            'z-index:0'
        ].join(';');
        const exportStyle = document.createElement('style');
        exportStyle.textContent = `
            body.pdf-export-mode .hzq-nav,
            body.pdf-export-mode .hzq-site-cost-tip,
            body.pdf-export-mode #cyberGlobalContactBtn,
            body.pdf-export-mode .preview-bottom-bar,
            body.pdf-export-mode .loading-overlay,
            body.pdf-export-mode .seal-line,
            body.pdf-export-mode .seal-text {
                display: none !important;
                opacity: 0 !important;
                border: 0 !important;
                width: 0 !important;
            }
            .pdf-export-host,
            .pdf-export-host * {
                box-shadow: none !important;
                text-shadow: none !important;
                filter: none !important;
            }
            .pdf-export-host .pdf-export-paper {
                display: block !important;
                width: 210mm !important;
                max-width: 210mm !important;
                min-height: 297mm !important;
                margin: 0 !important;
                padding: 20mm 18mm 24mm 18mm !important;
                box-sizing: border-box !important;
                background: #ffffff !important;
                color: #000000 !important;
                overflow: visible !important;
            }
            .pdf-export-host .loading-overlay,
            .pdf-export-host .preview-bottom-bar,
            .pdf-export-host .title-edit-hint,
            .pdf-export-host .seal-line {
                display: none !important;
            }
            .pdf-export-host pre,
            .pdf-export-host code {
                background: #ffffff !important;
                color: #000000 !important;
            }
        `;
        exportHost.appendChild(exportStyle);
        exportHost.appendChild(exportPaper);
        document.body.appendChild(exportHost);

        // SVG转canvas（html2canvas对SVG支持差）
        const svgBackups = [];
        for (const svg of exportPaper.querySelectorAll('svg')) {
            try {
                const vb = svg.getAttribute('viewBox');
                let w = 400, h = 300;
                if (vb) { const p = vb.split(/[\s,]+/); w = parseFloat(p[2]) || 400; h = parseFloat(p[3]) || 300; }
                const svgClone = svg.cloneNode(true);
                if (!svgClone.getAttribute('xmlns')) svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                svgClone.setAttribute('width', w); svgClone.setAttribute('height', h);
                const svgStr = new XMLSerializer().serializeToString(svgClone);
                const svgB64 = btoa(unescape(encodeURIComponent(svgStr)));
                const cvs = document.createElement('canvas');
                cvs.width = w * 2; cvs.height = h * 2;
                const ctx = cvs.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cvs.width, cvs.height); ctx.scale(2, 2);
                const img = new Image();
                await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = 'data:image/svg+xml;base64,' + svgB64; });
                ctx.drawImage(img, 0, 0, w, h);
                if (isLikelyExportBlackBar(cvs)) {
                    const figure = svg.closest('.q-figure');
                    if (figure) {
                        figure.remove();
                    } else {
                        svg.remove();
                    }
                    continue;
                }
                cvs.style.cssText = 'max-width:250px;height:auto;display:block;margin:8px auto';
                svgBackups.push({ svg, parent: svg.parentNode });
                svg.parentNode.replaceChild(cvs, svg);
            } catch (e) {}
        }

        await html2pdf().set({
            margin: [0, 0, 0, 0],
            filename: `${titleText}.pdf`,
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                backgroundColor: '#fff',
                x: 0,
                y: 0,
                scrollX: 0,
                scrollY: 0,
                windowWidth: exportPaper.scrollWidth || exportHost.scrollWidth || 794,
                windowHeight: Math.ceil(exportPaper.scrollHeight || exportHost.scrollHeight || 1123)
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'], avoid: '.question-item' }
        }).from(exportPaper).save();

    } catch (e) {
        console.error('PDF导出失败:', e);
        alert('PDF导出失败，请尝试Ctrl+P打印');
    } finally {
        if (exportHost) exportHost.remove();
        document.body.classList.remove('pdf-export-mode');
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

function isLikelyExportBlackBar(canvas) {
    const width = canvas?.width || 0;
    const height = canvas?.height || 0;
    if (width < 20 || height < 80) return false;

    let imageData;
    try {
        imageData = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    } catch {
        return false;
    }

    const step = Math.max(1, Math.floor(Math.max(width, height) / 900));
    let darkCount = 0;
    let sampleCount = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            const index = (y * width + x) * 4;
            const r = imageData[index];
            const g = imageData[index + 1];
            const b = imageData[index + 2];
            const a = imageData[index + 3];
            sampleCount += 1;
            if (a > 32 && r < 45 && g < 45 && b < 45) {
                darkCount += 1;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }
    }

    if (!darkCount || sampleCount === 0) return false;
    const darkRatio = darkCount / sampleCount;
    const darkWidth = Math.max(1, maxX - minX + 1);
    const darkHeight = Math.max(1, maxY - minY + 1);
    const isNarrow = darkWidth <= width * 0.22;
    const isTall = darkHeight >= height * 0.55 && darkHeight / darkWidth >= 4.5;
    return isNarrow && isTall && darkRatio >= 0.012;
}

async function svgMarkupToPngDataUrl(svgMarkup) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = svgMarkup || '';
    const svg = wrapper.querySelector('svg');
    if (!svg) return '';

    const vb = svg.getAttribute('viewBox');
    let w = 400;
    let h = 300;
    if (vb) {
        const parts = vb.split(/[\s,]+/);
        w = parseFloat(parts[2]) || w;
        h = parseFloat(parts[3]) || h;
    }

    const svgClone = svg.cloneNode(true);
    if (!svgClone.getAttribute('xmlns')) svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgClone.setAttribute('width', w);
    svgClone.setAttribute('height', h);

    const svgStr = new XMLSerializer().serializeToString(svgClone);
    const svgB64 = btoa(unescape(encodeURIComponent(svgStr)));
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);

    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = 'data:image/svg+xml;base64,' + svgB64;
    });
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png');
}

async function buildWordFigureImageMap(groups) {
    const figureImgMap = new Map();
    for (const group of Object.values(groups || {})) {
        for (const item of group?.items || []) {
            if (!item?.figure || typeof item.originalIdx === 'undefined') continue;
            if (!state.figureCache.has(item.originalIdx) || figureImgMap.has(item.originalIdx)) continue;
            try {
                const dataUrl = await svgMarkupToPngDataUrl(state.figureCache.get(item.originalIdx));
                if (dataUrl) figureImgMap.set(item.originalIdx, dataUrl);
            } catch (error) {
                console.warn('Word图形转换失败:', error);
            }
        }
    }
    return figureImgMap;
}

function buildWordAnswers() {
    if (!state.currentExamData?.answers) return [];
    const indices = [...state.selectedQuestions].sort((a, b) => a - b);
    return indices.map((idx, i) => {
        const original = state.currentExamData.answers[idx];
        return original ? `${i + 1}. ${original.replace(/^\d+\.\s*/, '')}` : '';
    }).filter(Boolean);
}

async function exportToWord() {
    const titleText = document.getElementById('paperTitle').textContent;
    const showAnswer = document.getElementById('showAnswer').checked;
    const loadingEl = document.getElementById('loading');
    loadingEl.style.display = 'flex';

    try {
        const groups = state.currentPreviewGroups;
        if (!groups) throw new Error('请先完成组卷预览后再导出 Word');
        const figureImgMap = await buildWordFigureImageMap(groups);
        const wordDocument = await createEditableWordDocument({
            title: titleText,
            groups,
            answers: showAnswer ? buildWordAnswers() : [],
            showAnswer,
            figureImages: figureImgMap
        });
        const blob = new Blob([wordDocument.bytes], { type: wordDocument.mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = wordDocument.fileName;
        document.body.appendChild(link); link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
        console.error('Word导出失败:', e);
        alert('Word导出失败: ' + e.message);
    } finally {
        loadingEl.style.display = 'none';
    }
}

function loadScript(src) {
    if (scriptPromiseCache.has(src)) {
        return scriptPromiseCache.get(src);
    }

    const promise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
    scriptPromiseCache.set(src, promise);
    return promise;
}

function showContactModal() {
    const globalBtn = document.getElementById('cyberGlobalContactBtn');
    if (globalBtn) { globalBtn.click(); return; }
    document.getElementById('contactModal').classList.add('show');
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function saveSettings() {
    const showAnswer = document.getElementById('showAnswer');
    const variantSettings = getVariantSettings();
    const s = {
        showAnswer: Boolean(showAnswer?.checked),
        variantDifficulty: variantSettings.variantDifficulty,
        variationCoefficient: variantSettings.variationCoefficient
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function loadSettings() {
    const currentSaved = localStorage.getItem(SETTINGS_KEY);
    const legacySaved = currentSaved ? null : localStorage.getItem(LEGACY_SETTINGS_KEY);
    const saved = currentSaved || legacySaved;
    if (!saved) return;
    try {
        const s = JSON.parse(saved);
        const isLegacySettings = !currentSaved && Boolean(legacySaved);
        const showAnswer = document.getElementById('showAnswer');
        const difficultyEl = document.getElementById('variantDifficulty');
        const coefficientEl = document.getElementById('variationCoefficient');
        if (showAnswer && s.showAnswer !== undefined) showAnswer.checked = s.showAnswer;
        if (difficultyEl) difficultyEl.value = clampLevel(s.variantDifficulty, DEFAULT_VARIANT_DIFFICULTY);
        if (coefficientEl) {
            coefficientEl.value = isLegacySettings
                ? DEFAULT_VARIATION_COEFFICIENT
                : clampLevel(s.variationCoefficient, DEFAULT_VARIATION_COEFFICIENT);
        }
        updateVariantSettingsDisplay();
        localStorage.removeItem(LEGACY_SETTINGS_KEY);
    } catch (e) { console.error('加载设置失败', e); }
}

const showAnswerControl = document.getElementById('showAnswer');
if (showAnswerControl) {
    showAnswerControl.addEventListener('change', (e) => {
        document.getElementById('answerArea').style.display = e.target.checked ? 'block' : 'none';
        saveSettings();
    });
}

['examType'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveSettings);
});

['variantDifficulty', 'variationCoefficient'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateVariantSettingsDisplay);
});


Object.assign(window, {
    onConfigChange,
    onTopicChange,
    onExamPointChange,
    updateQuestionCount,
    syncQuestionCount,
    updateDifficultyDisplay,
    generateExam,
    composeExam,
    toggleQuestion,
    backToSelect,
    exportToPdf,
    exportToWord,
    closeModal,
    saveSettings,
    handleUploadFiles,
    updateVariantSettingsDisplay,
    __formatRichText: formatRichText
});

// 赛博出卷机 - 前端应用
const {
    areAllQuestionsSelected,
    setAllQuestionsSelected
} = require('../shared/question-selection');
const {
    WORD_FIGURE_RENDER_SCALE,
    UNIFORM_FIGURE_WIDTH_PX,
    UNIFORM_FIGURE_HEIGHT_PX,
    assertWordDocxParts
} = require('../shared/word-export-quality');
const { analyzeFigureSvg } = require('../shared/figure-svg-quality');
const { computeAtomicPageSlices } = require('../shared/pdf-pagination');
const { buildLosslessPdfImageRecord } = require('../shared/pdf-lossless-image');
const { mapWithConcurrency, renderItemsByKey } = require('../shared/export-rendering');
const { buildContinuationAppendPlan } = require('../shared/exam-continuation');
const { splitTextOutsideLatexFormulas } = require('../shared/formula-text-segmentation');
const { buildEditableWordDocx, assertWordSemanticDomReady } = require('./word-docx-export');

const API_BASE = '/api';
const CONTINUE_QUESTION_COUNT = 3;
const WORD_RENDER_CONCURRENCY = 3;
const wordFigureImageCache = new Map();
const pdfImageRegistry = new Map();
const PDF_IMAGE_SENTINEL = new Uint8Array([0x43, 0x59, 0x42, 0x45, 0x52, 0x45, 0x58, 0x41, 0x4d]);
let pdfImageSequence = 0;

const state = {
    generatedQuestions: [],
    selectedQuestions: new Set(),
    currentExamData: null,
    mode: 'select',
    figureCache: new Map(), // 缓存已生成的SVG图形
    topicsData: [],
    difficultyNames: {},
    antiInspect: {
        disableContextMenu: false,
        disableDevtoolsShortcuts: false
    },
    trialCreditsRemaining: null,
    activeGenerateToken: 0,
    activeFigureLoadToken: 0,
    figureLoading: false,
    figureFailedCount: 0,
    questionCardClickBound: false,
    formulaFailed: false,
    activeTopic: '',
    serviceStatus: 'checking',
    resultGroups: new Map(),
    continuingGroupIds: new Set(),
    continuationSequence: 0,
    continuationToken: ''
};

document.addEventListener('DOMContentLoaded', async () => {
    await loadUiConfig();
    applyAntiInspectGuards();
    refreshTrialCreditsHint();
    loadSettings();
    onConfigChange();
    initTopicManager();
    checkApiHealth({ quiet: true });
    if (typeof ensureRequestToken === 'function') {
        ensureRequestToken().then(() => {
            if (typeof window.__trialCreditsRemaining !== 'undefined' && window.__trialCreditsRemaining !== null) {
                state.trialCreditsRemaining = window.__trialCreditsRemaining;
                refreshTrialCreditsHint();
            }
        }).catch(() => {});
    }

    // 标题编辑提示：点击标题后隐藏提示
    const paperTitle = document.getElementById('paperTitle');
    const titleHint = document.getElementById('titleEditHint');
    if (paperTitle && titleHint) {
        paperTitle.addEventListener('focus', () => { titleHint.style.opacity = '0'; });
        paperTitle.addEventListener('blur', () => { titleHint.style.display = 'none'; });
    }
});

function refreshTrialCreditsHint() {
    const hintEl = document.getElementById('trialCreditsHint');
    if (!hintEl) return;

    if (state.trialCreditsRemaining === null || state.trialCreditsRemaining === undefined) {
        hintEl.textContent = '正在读取剩余体验次数…';
        return;
    }

    const safeValue = Math.max(0, Number.parseInt(state.trialCreditsRemaining, 10) || 0);
    hintEl.textContent = `剩余体验次数：${safeValue}`;
}

async function loadUiConfig() {
    try {
        const resp = await apiFetch(`${API_BASE}/public/config`);
        if (!resp.ok) {
            return;
        }

        const data = await resp.json();
        state.difficultyNames = data?.difficultyNames || {};
        state.antiInspect = {
            disableContextMenu: Boolean(data?.antiInspect?.disableContextMenu),
            disableDevtoolsShortcuts: Boolean(data?.antiInspect?.disableDevtoolsShortcuts)
        };
    } catch (e) {
        console.warn('加载前端配置失败，将使用默认行为:', e.message);
    }
}

function applyAntiInspectGuards() {
    if (state.antiInspect.disableContextMenu) {
        document.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
    }

    if (state.antiInspect.disableDevtoolsShortcuts) {
        document.addEventListener('keydown', (event) => {
            const key = String(event.key || '').toLowerCase();
            const ctrlOrMeta = event.ctrlKey || event.metaKey;
            const shouldBlock = key === 'f12'
                || (ctrlOrMeta && event.shiftKey && ['i', 'j', 'c'].includes(key))
                || (ctrlOrMeta && key === 'u');
            if (!shouldBlock) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
        }, true);
    }
}

function setGenerateButtonLoading(isLoading, text = '') {
    const btn = document.getElementById('generateBtn');
    if (!btn) return;
    const label = btn.querySelector('span') || btn;
    btn.disabled = !!isLoading;
    btn.classList.toggle('is-loading', !!isLoading);
    label.textContent = text || (isLoading ? '正在生成试卷...' : '生成试卷');
}

function updateFigureProgressBanner(done, total, failed = 0, active = true) {
    const composeBtn = document.getElementById('composeBtn');
    const composeTip = document.querySelector('.compose-tip');
    state.figureLoading = active;
    state.figureFailedCount = failed;

    if (composeTip) {
        if (total === 0 && !active) {
            composeTip.textContent = '题目已生成，可选择题目组卷';
        } else if (active) {
            composeTip.textContent = `正在生成图形 ${done}/${total}，质量优先，请耐心等待`;
        } else if (failed > 0) {
            composeTip.textContent = `有 ${failed} 个图形尚未成功生成，请重新生成题目或稍后重试`;
        } else {
            composeTip.textContent = '图形已全部生成，可组卷';
        }
    }

    if (composeBtn) {
        composeBtn.disabled = state.selectedQuestions.size === 0;
    }
    updateExportAvailability();
    updateContinuationButtons();

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

function renderQuestionCards(data, figureLoadToken = Date.now()) {
    const container = document.getElementById('selectMode');
    const composeBar = document.getElementById('composeBar');
    const configWorkspace = document.getElementById('configWorkspace');
    let html = '';
    let globalIndex = 0;

    state.generatedQuestions = [];
    state.selectedQuestions.clear();
    state.figureCache.clear();
    state.activeFigureLoadToken = figureLoadToken;
    state.pendingFigures = [];
    state.formulaFailed = false;
    state.resultGroups = new Map();
    state.continuingGroupIds.clear();

    if (data.questions && Array.isArray(data.questions)) {
        data.questions.forEach((group, groupIndex) => {
            if (!group || !group.items) return;
            const groupId = `result_group_${groupIndex}`;
            const source = group.source || group.items.find(Boolean)?.source || {};
            state.resultGroups.set(groupId, { group, source, type: group.type, title: group.title || '' });
            html += `<section class="result-group" data-group-id="${groupId}">
                <div class="group-header">
                    <div class="group-header-title">${formatPaperText(group.title || '')}</div>
                    <button class="continue-generate-btn" type="button" data-group-id="${groupId}" aria-label="为当前知识点、考点和题型继续生成3题">
                        <span aria-hidden="true">＋</span><span class="continue-button-label">继续生成3题</span>
                    </button>
                </div>
                <div class="group-continue-status" role="status" aria-live="polite"></div>
                <div class="result-group-items">`;
            for (const item of group.items) {
                if (!item) continue;
                const idx = globalIndex++;
                const record = createQuestionCardRecord(item, group, idx, figureLoadToken, groupId);
                state.generatedQuestions.push(record.question);
                if (record.pendingFigure) state.pendingFigures.push(record.pendingFigure);
                html += record.html;
            }
            html += '</div></section>';
        });
    }

    container.innerHTML = html;
    container.hidden = false;
    container.style.display = 'block';
    if (configWorkspace) configWorkspace.hidden = true;
    updateExportAvailability();
    bindQuestionCardClicks();
    composeBar.style.display = 'flex';
    updateSelectedCount();
    loadFiguresAsync(figureLoadToken);
}

function createQuestionCardRecord(item, group, idx, figureLoadToken, groupId, options = {}) {
    const formatText = options.strictFormula ? formatPaperTextStrict : formatPaperText;
    const question = {
        ...item,
        groupType: group.type,
        groupTitle: group.title,
        resultGroupId: groupId
    };
    let html = `<div class="question-card" data-idx="${idx}">
        <div class="select-check">&#10003;</div>
        <div class="q-stem"><span class="q-number">${escapeHtml(item.index || '')}.</span> ${formatText(item.stem || '')}</div>`;

    if (group.type === 'choice' && Array.isArray(item.options)) {
        html += `<div class="q-options">${item.options.filter(Boolean).map((option) => `<div class="q-option">${formatText(option)}</div>`).join('')}</div>`;
    }

    let pendingFigure = null;
    if (item.figure) {
        const figId = `fig_${idx}_${figureLoadToken}`;
        html += `<div class="q-figure q-figure-loading" id="${figId}">
            <span>图形排队中...</span>
        </div>`;
        pendingFigure = {
            id: figId,
            qIdx: idx,
            figure: item.figure,
            figureType: typeof item.figure === 'object' ? (item.figure.type || '') : '',
            stem: item.stem || '',
            subject: document.getElementById('subject').value
        };
    }
    html += '</div>';
    return { question, html, pendingFigure };
}

function bindQuestionCardClicks() {
    const container = document.getElementById('selectMode');
    if (!container || state.questionCardClickBound) return;

    // 题目区容器不会重建，只绑定一次，避免重复生成后点击被来回切换
    container.addEventListener('click', (event) => {
        const continueButton = event.target.closest('.continue-generate-btn');
        if (continueButton && container.contains(continueButton)) {
            event.preventDefault();
            event.stopPropagation();
            continueGenerateForGroup(continueButton.dataset.groupId);
            return;
        }
        const card = event.target.closest('.question-card');
        if (!card || !container.contains(card)) return;

        const idx = parseInt(card.dataset.idx, 10);
        if (!isNaN(idx) && idx >= 0 && idx < state.generatedQuestions.length) {
            toggleQuestion(idx);
        }
    });

    state.questionCardClickBound = true;
}

function updateContinuationButtons() {
    document.querySelectorAll('.continue-generate-btn').forEach((button) => {
        button.disabled = state.continuingGroupIds.has(button.dataset.groupId);
    });
}

function setContinuationStatus(groupId, message = '', tone = '') {
    const groupElement = document.querySelector(`.result-group[data-group-id="${groupId}"]`);
    const status = groupElement?.querySelector('.group-continue-status');
    if (!status) return;
    status.textContent = message;
    status.className = `group-continue-status${tone ? ` is-${tone}` : ''}`;
}

function setContinuationLoading(groupId, isLoading) {
    if (isLoading) state.continuingGroupIds.add(groupId);
    else state.continuingGroupIds.delete(groupId);
    const button = document.querySelector(`.continue-generate-btn[data-group-id="${groupId}"]`);
    const label = button?.querySelector('.continue-button-label');
    if (label) label.textContent = isLoading ? '正在生成3题…' : '继续生成3题';
    button?.classList.toggle('is-loading', isLoading);
    const hasActiveContinuations = state.continuingGroupIds.size > 0;
    ['generateBtn', 'subject', 'grade', 'examType'].forEach((id) => {
        const control = document.getElementById(id);
        if (control) control.disabled = hasActiveContinuations;
    });
    updateContinuationButtons();
    updateSelectedCount();
    updateExportAvailability();
}

async function appendContinuationResult(groupId, data) {
    const groupState = state.resultGroups.get(groupId);
    const groupElement = document.querySelector(`.result-group[data-group-id="${groupId}"]`);
    const itemContainer = groupElement?.querySelector('.result-group-items');
    if (!groupState || !itemContainer) throw new Error('当前题组已失效，请重新生成试卷');

    const examDataAtStart = state.currentExamData;
    const validationPlan = buildContinuationAppendPlan(data, groupState.source, 0);
    const operationId = `continuation_${++state.continuationSequence}_${Date.now()}`;
    validationPlan.items.forEach((item, offset) => {
        createQuestionCardRecord(item, groupState.group, offset, operationId, groupId, { strictFormula: true });
    });
    const figureJobs = validationPlan.items.flatMap((item, offset) => {
        if (!item.figure) return [];
        return [{
            id: `${operationId}_${offset}`,
            itemOffset: offset,
            figure: item.figure,
            figureType: typeof item.figure === 'object' ? (item.figure.type || '') : '',
            stem: item.stem || '',
            subject: document.getElementById('subject').value
        }];
    });
    const figureSvgs = await renderContinuationFigures(figureJobs);
    if (
        state.currentExamData !== examDataAtStart
        || state.resultGroups.get(groupId) !== groupState
    ) {
        throw new Error('当前试卷已变化，本次追加结果已丢弃');
    }

    // 题图全部通过后才读取最新题数；多个题组并发完成时不会争用题号。
    const firstIndex = state.generatedQuestions.length;
    const plan = buildContinuationAppendPlan(data, groupState.source, firstIndex);
    const records = plan.items.map((item, offset) => (
        createQuestionCardRecord(item, groupState.group, firstIndex + offset, operationId, groupId, { strictFormula: true })
    ));
    const normalizedItems = records.map((record) => ({
        ...record.question,
        index: Number(record.question.index),
        source: { ...groupState.source }
    }));
    const staging = document.createElement('div');
    staging.innerHTML = records.map((record) => record.html).join('');
    records.forEach((record, offset) => {
        if (!record.pendingFigure) return;
        const svg = figureSvgs.get(offset);
        if (!svg) throw new Error(`第 ${offset + 1} 道新题缺少已通过质量检查的题图`);
        const target = staging.querySelector(`#${record.pendingFigure.id}`);
        if (!target) throw new Error(`第 ${offset + 1} 道新题缺少题图容器`);
        target.innerHTML = svg;
        target.style.border = 'none';
        target.style.background = 'transparent';
        target.classList.remove('q-figure-loading');
    });
    const fragment = document.createDocumentFragment();
    while (staging.firstChild) fragment.appendChild(staging.firstChild);
    itemContainer.appendChild(fragment);
    state.generatedQuestions.push(...normalizedItems);
    state.currentExamData.answers.push(...plan.answers);
    groupState.group.items.push(...normalizedItems.map((item) => ({ ...item })));
    records.forEach((record, offset) => {
        if (record.pendingFigure) state.figureCache.set(firstIndex + offset, figureSvgs.get(offset));
    });
    if (state.currentExamData?.metadata) {
        state.currentExamData.metadata.totalQuestions = state.generatedQuestions.length;
    }
    renumberResultQuestionDisplays();
    updateSelectedCount();
}

function renumberResultQuestionDisplays() {
    let displayIndex = 1;
    document.querySelectorAll('#selectMode .question-card[data-idx]').forEach((card) => {
        const internalIndex = Number.parseInt(card.dataset.idx, 10);
        const question = state.generatedQuestions[internalIndex];
        if (!question) return;
        question.index = displayIndex;
        const number = card.querySelector('.q-number');
        if (number) number.textContent = `${displayIndex}.`;
        if (Array.isArray(state.currentExamData?.answers) && state.currentExamData.answers[internalIndex]) {
            const content = String(state.currentExamData.answers[internalIndex]).replace(/^\d+\.\s*/, '');
            state.currentExamData.answers[internalIndex] = `${displayIndex}. ${content}`;
        }
        displayIndex += 1;
    });
}

async function continueGenerateForGroup(groupId) {
    const groupState = state.resultGroups.get(groupId);
    const examDataAtRequest = state.currentExamData;
    if (
        !groupState
        || state.continuingGroupIds.has(groupId)
    ) return;
    const source = groupState.source || {};
    if (!source.topic || !source.examPoint || !source.questionType || !Number.isInteger(Number(source.difficulty))) {
        setContinuationStatus(groupId, '当前题组缺少来源参数，请重新生成整卷。', 'error');
        return;
    }

    setContinuationLoading(groupId, true);
    try {
        if (!state.continuationToken) {
            throw new Error('当前组卷会话已过期，请重新生成整卷后再追加题目。');
        }
        setContinuationStatus(groupId, '正在按当前知识点、考点和题型严格命题并审核…', 'working');
        const response = await apiFetch(`${API_BASE}/exam/continue`, {
            method: 'POST',
            headers: withUsageHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                grade: document.getElementById('grade').value,
                subject: document.getElementById('subject').value,
                examType: document.getElementById('examType').value,
                topic: source.topic,
                examPoint: source.examPoint,
                questionType: source.questionType,
                difficulty: Number(source.difficulty),
                count: CONTINUE_QUESTION_COUNT,
                continuationToken: state.continuationToken
            })
        });
        const data = await readJsonResponse(response, '继续生成失败');
        if (!response.ok) {
            if (data?.code === 'CONTINUATION_GRANT_INVALID') {
                state.continuationToken = '';
            }
            throw new Error(data.error || '继续生成失败，请稍后重试');
        }
        if (typeof data?.trialCreditsRemaining !== 'undefined') {
            state.trialCreditsRemaining = data.trialCreditsRemaining;
            refreshTrialCreditsHint();
        }
        if (state.currentExamData !== examDataAtRequest || state.resultGroups.get(groupId) !== groupState) {
            throw new Error('当前试卷已变化，本次追加结果已丢弃');
        }
        if (typeof data.continuationToken !== 'string' || data.continuationToken.length < 32) {
            throw new Error('服务端未返回有效的续题凭证，本次追加已停止');
        }
        state.continuationToken = data.continuationToken;
        setContinuationStatus(groupId, '3 道新题已通过审核，正在完成题图校验。', 'working');
        await appendContinuationResult(groupId, data);
        setContinuationStatus(groupId, '已在本题组下方追加 3 道题。', 'success');
    } catch (error) {
        console.error('[继续生成3题] 失败:', error);
        setContinuationStatus(groupId, `追加失败：${error.message} 原有题目未改变。`, 'error');
    } finally {
        setContinuationLoading(groupId, false);
    }
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
            subject: fig.subject || '',
            forceRegenerate: fig.forceRegenerate === true
        };
    }).filter((item) => item.description);
}

function applyFigureResult(fig, result) {
    const el = document.getElementById(fig.id);
    if (!el) return { ok: false, code: 'MISSING_FIGURE_TARGET', retryable: false };
    if (!result?.svg) {
        return {
            ok: false,
            code: result?.code || 'MISSING_SVG_RESULT',
            retryable: result?.retryable !== false,
            forceRegenerate: false
        };
    }

    const validation = validateFigureSvg(result.svg);
    if (!validation.ok) {
        return {
            ok: false,
            code: validation.code,
            retryable: true,
            forceRegenerate: true
        };
    }
    el.innerHTML = validation.svg;
    el.style.border = 'none';
    el.style.background = 'transparent';
    el.classList.remove('q-figure-loading');
    if (fig.qIdx !== undefined) {
        state.figureCache.set(fig.qIdx, validation.svg);
    }
    return { ok: true, code: 'OK', retryable: false, forceRegenerate: false };
}

function validateFigureSvg(svg) {
    const source = String(svg || '').trim();
    const quality = analyzeFigureSvg(source);
    if (!quality.ok) return { ok: false, svg: '', code: quality.code };
    const documentNode = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (documentNode.querySelector('parsererror')) {
        return { ok: false, svg: '', code: 'BROWSER_XML_MALFORMED' };
    }
    const root = documentNode.documentElement;
    if (!root || root.localName.toLowerCase() !== 'svg') {
        return { ok: false, svg: '', code: 'BROWSER_INVALID_ROOT' };
    }
    if (!root.querySelector('path,line,polyline,polygon,circle,ellipse,rect')) {
        return { ok: false, svg: '', code: 'NO_GEOMETRY' };
    }
    for (const path of root.querySelectorAll('path')) {
        const data = path.getAttribute('d') || '';
        if (!data.trim() || /[<>]/.test(data)) {
            return { ok: false, svg: '', code: 'INVALID_PATH_DATA' };
        }
    }
    return { ok: true, svg: new XMLSerializer().serializeToString(root), code: 'OK' };
}

async function renderContinuationFigures(figures, retryCount = 0, completed = new Map()) {
    if (!figures.length) return completed;
    const payloadFigures = buildFigureRequestPayload(figures);
    if (payloadFigures.length !== figures.length) {
        throw new Error('新题题图缺少完整绘图描述，已拒绝追加');
    }

    let data;
    try {
        const response = await apiFetch(`${API_BASE}/render/figures-batch`, {
            method: 'POST',
            headers: withUsageHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ figures: payloadFigures })
        });
        data = await readJsonResponse(response, '新题题图生成失败');
        if (!response.ok) throw new Error(data.error || `题图服务返回 HTTP ${response.status}`);
    } catch (error) {
        if (retryCount < 2) {
            await new Promise((resolve) => setTimeout(resolve, 900 * (retryCount + 1)));
            return renderContinuationFigures(figures, retryCount + 1, completed);
        }
        throw new Error(`新题题图连续生成失败：${error.message}`);
    }

    const resultMap = new Map((Array.isArray(data.results) ? data.results : []).map((item) => [item.id, item]));
    const retryable = [];
    const terminal = [];
    for (const figure of figures) {
        const result = resultMap.get(figure.id);
        const validation = result?.svg ? validateFigureSvg(result.svg) : null;
        if (validation?.ok) {
            completed.set(figure.itemOffset, validation.svg);
            continue;
        }
        const failure = {
            ...figure,
            forceRegenerate: figure.forceRegenerate === true || Boolean(result?.svg),
            failureCode: validation?.code || result?.code || 'MISSING_SVG_RESULT'
        };
        if (result?.retryable === false && !result?.svg) terminal.push(failure);
        else retryable.push(failure);
    }

    if (terminal.length) {
        throw new Error(`新题题图未通过质量检查（${terminal.map((item) => item.failureCode).join('、')}）`);
    }
    if (retryable.length) {
        if (retryCount < 2) {
            await new Promise((resolve) => setTimeout(resolve, 900 * (retryCount + 1)));
            return renderContinuationFigures(retryable, retryCount + 1, completed);
        }
        throw new Error(`新题题图连续未通过质量检查（${retryable.map((item) => item.failureCode).join('、')}）`);
    }
    return completed;
}

function renderFigureFailures(figures) {
    for (const fig of figures) {
        const el = document.getElementById(fig.id);
        if (el) {
            el.innerHTML = '<span style="color:#b45309;font-size:12px">图形未通过完整性与质量检查，请重新生成本题。</span>';
            el.style.display = '';
            el.style.border = '1px dashed #f59e0b';
            el.style.background = '#fffbeb';
        }
    }
}

async function loadFigureBatch(figures, figureLoadToken, retryCount = 0) {
    if (figureLoadToken !== state.activeFigureLoadToken) return { done: 0, failed: 0 };

    const payloadFigures = buildFigureRequestPayload(figures);
    const skipped = figures.length - payloadFigures.length;
    if (payloadFigures.length === 0) return { done: figures.length, failed: skipped };

    for (const fig of figures) {
        const el = document.getElementById(fig.id);
        if (el) {
            el.innerHTML = `<span style="color:#999;font-size:12px">${retryCount > 0 ? '图形批量重试中...' : '图形批量生成中...'}</span>`;
        }
    }

    try {
        const resp = await apiFetch(`${API_BASE}/render/figures-batch`, {
            method: 'POST',
            headers: withUsageHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ figures: payloadFigures })
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (figureLoadToken !== state.activeFigureLoadToken) return { done: 0, failed: 0 };

        const results = Array.isArray(data.results) ? data.results : [];
        const resultMap = new Map(results.map((item) => [item.id, item]));
        const requestedIds = new Set(payloadFigures.map((item) => item.id));
        let done = 0;
        const retryableFigures = [];
        const terminalFailures = [];

        for (const fig of figures) {
            const result = requestedIds.has(fig.id)
                ? resultMap.get(fig.id)
                : {
                    code: 'INVALID_FIGURE_DESCRIPTION',
                    error: '缺少图形描述',
                    retryable: false
                };
            const application = applyFigureResult(fig, result);
            if (application.ok) {
                done += 1;
            } else {
                const failedFigure = {
                    ...fig,
                    forceRegenerate: fig.forceRegenerate === true || application.forceRegenerate === true,
                    failureCode: application.code
                };
                console.warn('[图形渲染] 单题未通过，按失败类型处理', {
                    id: fig.id,
                    code: application.code,
                    retryable: application.retryable,
                    forceRegenerate: failedFigure.forceRegenerate,
                    serverAttempts: result?.attempts || 0,
                    cached: result?.cached === true
                });
                if (application.retryable) retryableFigures.push(failedFigure);
                else terminalFailures.push(failedFigure);
            }
        }

        if (retryableFigures.length > 0 && retryCount < 2) {
            await new Promise(resolve => setTimeout(resolve, 900 * (retryCount + 1)));
            const retryResult = await loadFigureBatch(retryableFigures, figureLoadToken, retryCount + 1);
            renderFigureFailures(terminalFailures);
            return {
                done: done + terminalFailures.length + retryResult.done,
                failed: terminalFailures.length + retryResult.failed
            };
        }

        const failedFigures = terminalFailures.concat(retryableFigures);
        renderFigureFailures(failedFigures);

        return { done: done + failedFigures.length, failed: failedFigures.length };
    } catch (e) {
        if (retryCount < 2) {
            await new Promise(resolve => setTimeout(resolve, 900 * (retryCount + 1)));
            return loadFigureBatch(figures, figureLoadToken, retryCount + 1);
        }

        console.error('[图形渲染] 批量请求连续失败', e);
        renderFigureFailures(figures);
        return { done: figures.length, failed: figures.length };
    }
}

async function loadFiguresAsync(figureLoadToken) {
    if (!state.pendingFigures || state.pendingFigures.length === 0) {
        updateFigureProgressBanner(0, 0, 0, false);
        return { done: 0, failed: 0 };
    }
    if (figureLoadToken !== state.activeFigureLoadToken) return { done: 0, failed: 0, cancelled: true };

    const figures = state.pendingFigures;
    state.pendingFigures = [];

    const total = figures.length;
    let done = 0;
    let failed = 0;
    const batchSize = 3;

    updateFigureProgressBanner(done, total, failed, true);

    for (let index = 0; index < figures.length; index += batchSize) {
        if (figureLoadToken !== state.activeFigureLoadToken) return { done, failed, cancelled: true };
        const batch = figures.slice(index, index + batchSize);
        const result = await loadFigureBatch(batch, figureLoadToken);
        done += result.done;
        failed += result.failed;
        if (figureLoadToken === state.activeFigureLoadToken) {
            updateFigureProgressBanner(done, total, failed, done < total);
        }
    }

    if (figureLoadToken === state.activeFigureLoadToken) {
        updateFigureProgressBanner(done, total, failed, false);
    }
    return { done, failed, cancelled: figureLoadToken !== state.activeFigureLoadToken };
}

function toggleQuestion(idx) {
    if (state.selectedQuestions.has(idx)) state.selectedQuestions.delete(idx);
    else state.selectedQuestions.add(idx);

    const card = document.querySelector(`.question-card[data-idx="${idx}"]`);
    if (card) card.classList.toggle('selected');
    updateSelectedCount();
}

function toggleSelectAllQuestions() {
    const total = state.generatedQuestions.length;
    const shouldSelect = !areAllQuestionsSelected(state.selectedQuestions, total);
    setAllQuestionsSelected(state.selectedQuestions, total, shouldSelect);
    document.querySelectorAll('#selectMode .question-card[data-idx]').forEach((card) => {
        const index = Number.parseInt(card.dataset.idx, 10);
        card.classList.toggle('selected', shouldSelect && Number.isInteger(index) && index < total);
    });
    updateSelectedCount();
}

function updateSelectAllButton() {
    const button = document.getElementById('selectAllBtn');
    if (!button) return;
    const total = state.generatedQuestions.length;
    const allSelected = areAllQuestionsSelected(state.selectedQuestions, total);
    button.disabled = total === 0;
    button.textContent = allSelected ? '取消全选' : '全选';
    button.setAttribute('aria-pressed', allSelected ? 'true' : 'false');
    button.setAttribute('aria-label', allSelected ? `取消选择全部 ${total} 道题` : `选择全部 ${total} 道题`);
}

function updateSelectedCount() {
    const count = state.selectedQuestions.size;
    document.getElementById('selectedCount').textContent = count;
    document.getElementById('composeBtn').disabled = count === 0;
    updateSelectAllButton();
}

function composeExam() {
    if (state.selectedQuestions.size === 0) { alert('请至少选择一道题目'); return; }

    const missingFigureItems = Array.from(state.selectedQuestions)
        .map(idx => ({ idx, item: state.generatedQuestions[idx] }))
        .filter(({ idx, item }) => item?.figure && !state.figureCache.has(idx));
    if (missingFigureItems.length > 0) {
        alert('所选题目中仍有图形未生成完成，请等待后再组卷。');
        return;
    }

    console.log('[组卷] 开始组卷，已选题目数:', state.selectedQuestions.size);

    // 按原始索引排序，保持选题时的顺序
    const selectedIndices = Array.from(state.selectedQuestions).sort((a, b) => {
        const leftOrder = Number(state.generatedQuestions[a]?.index) || Number.MAX_SAFE_INTEGER;
        const rightOrder = Number(state.generatedQuestions[b]?.index) || Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || a - b;
    });

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

function splitExplanationSteps(value) {
    return splitTextOutsideLatexFormulas(value);
}

function buildAnswerPreviewSteps(item) {
    const index = Number(item?.index) || '';
    const answer = String(item?.answer || '').trim();
    const explanationSteps = splitExplanationSteps(item?.explanation);
    if (!answer || explanationSteps.length === 0) {
        throw new Error(`第 ${index || '?'} 题缺少结构化答案或解析，无法生成高质量预览`);
    }
    return [
        `${index}. 答案：${answer}`,
        ...explanationSteps.map((step, stepIndex) => `${stepIndex === 0 ? '解析：' : ''}${step}`)
    ];
}

function renderExamPreview(title, groups) {
    console.log('[预览] 开始渲染试卷预览');

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
        html += `<div class="question-group"><div class="group-title">${formatPaperText(group.title || '')}</div>`;

        for (const item of group.items) {
            if (!item) {
                console.warn('[预览] 跳过空题目');
                continue;
            }

            html += `<div class="question-item"><div class="q-stem">${escapeHtml(item.index || '')}. ${formatPaperText(item.stem || '')}</div>`;

            if (type === 'choice' && item.options) {
                html += `<div class="q-options">${item.options.filter(o => o).map(o => `<div class="q-option">${formatPaperText(o)}</div>`).join('')}</div>`;
            }

            if (item.figure) {
                const cachedSvg = state.figureCache.get(item.originalIdx);
                if (cachedSvg) {
                    html += `<div class="q-figure" style="text-align:center">${cachedSvg}</div>`;
                } else {
                    console.warn(`[预览] 题${item.index}的图形未找到缓存，originalIdx:`, item.originalIdx);
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
    updateExportAvailability();
    console.log('[预览] HTML已插入到examContent');

    // 使用逐题结构化答案与解析生成语义步骤，避免整条长解析成为单个不可分页块。
    const answerItems = Object.values(groups).flatMap((group) => group.items || []);
    document.getElementById('answerContent').innerHTML = answerItems.map((item) => {
        const steps = buildAnswerPreviewSteps(item);
        return `<div class="answer-item">${steps.map((step) => `<div class="answer-step">${formatPaperText(step)}</div>`).join('')}</div>`;
    }).join('');
    console.log('[预览] 答案已渲染，数量:', answerItems.length);

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
    const selectMode = document.getElementById('selectMode');
    selectMode.hidden = false;
    selectMode.style.display = 'block';
    document.getElementById('paper').classList.remove('show');
    document.getElementById('downloadBar').classList.remove('show');
}

function switchToPreviewMode() {
    state.mode = 'preview';
    const selectMode = document.getElementById('selectMode');
    selectMode.hidden = true;
    selectMode.style.display = 'none';
    document.getElementById('composeBar').style.display = 'none';
    const paper = document.getElementById('paper');
    paper.classList.add('show');
    document.getElementById('downloadBar').classList.add('show');
    console.log('[模式] 切换到预览模式, paper.display:', getComputedStyle(paper).display, 'paper.classList:', paper.classList.toString());
}

function backToSelect() {
    switchToSelectMode();
    document.getElementById('composeBar').style.display = 'flex';
}

async function exportToPdf() {
    if (state.formulaFailed) {
        alert('存在无法渲染的公式，已停止导出。请重新生成题目后再试。');
        return;
    }
    const paper = document.getElementById('paper');
    const loadingEl = document.getElementById('loading');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingSubtitle = document.getElementById('loadingSubtitle');
    const progressWrap = document.getElementById('fakeProgressWrap');
    const originalLoadingTitle = loadingTitle?.textContent || '';
    const originalLoadingSubtitle = loadingSubtitle?.textContent || '';
    const originalProgressDisplay = progressWrap?.style.display || '';
    loadingEl.style.display = 'flex';
    if (loadingTitle) loadingTitle.textContent = '正在导出 PDF';
    if (loadingSubtitle) loadingSubtitle.textContent = '正在完成分页、公式与题图质量校验，请勿关闭页面';
    if (progressWrap) progressWrap.style.display = 'none';
    const origStyle = paper.style.cssText;
    const sealLine = paper.querySelector('.seal-line');
    const hint = paper.querySelector('.title-edit-hint');
    const svgBackups = [];
    const mathmlBackups = [];

    try {
        if (typeof window.html2canvas !== 'function' || !window.jspdf?.jsPDF) {
            throw new Error('本地 PDF 生成组件未正确加载');
        }

        const titleText = document.getElementById('paperTitle').textContent;

        // 保存原始样式，只覆盖必要属性
        paper.style.boxSizing = 'border-box';
        paper.style.width = '210mm';
        paper.style.minHeight = '297mm';
        paper.style.maxWidth = '210mm';
        paper.style.padding = '10mm 16mm';
        paper.style.margin = '0 auto';
        paper.style.boxShadow = 'none';
        paper.style.display = 'block';

        // 隐藏密封线和标题提示
        if (sealLine) sealLine.style.display = 'none';
        if (hint) hint.style.display = 'none';

        // 只转换真实题图。题图彼此独立，并行解码可避免多图试卷串行等待。
        const figureSvgs = Array.from(paper.querySelectorAll('.q-figure svg'));
        const convertedFigures = await Promise.all(figureSvgs.map(async (svg) => {
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
                cvs.style.cssText = 'width:280px;height:210px;max-width:100%;object-fit:contain;display:block;margin:8px auto';
                return { svg, canvas: cvs, parent: svg.parentNode };
            } catch (e) {
                throw new Error(`题图或公式图形转换失败，已停止 PDF 导出：${e.message}`);
            }
        }));
        convertedFigures.forEach((backup) => {
            svgBackups.push(backup);
            backup.parent.replaceChild(backup.canvas, backup.svg);
        });

        // KaTeX 的 MathML 树只供无障碍读取，视觉上完全隐藏；截图时临时摘除以减少克隆和布局成本。
        paper.querySelectorAll('.katex-mathml').forEach((node) => {
            mathmlBackups.push({ node, parent: node.parentNode, nextSibling: node.nextSibling });
            node.remove();
        });

        if (document.fonts?.ready) await document.fonts.ready;
        const renderedCanvas = await window.html2canvas(paper, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#fff',
            logging: false,
            windowWidth: Math.ceil(paper.scrollWidth),
            windowHeight: Math.ceil(paper.scrollHeight)
        });
        assertCanvasHasContent(renderedCanvas);
        await saveCanvasAsPaginatedPdf(renderedCanvas, paper, `${titleText}.pdf`);

    } catch (e) {
        console.error('PDF导出失败:', e);
        alert(`PDF导出失败：${e.message}`);
    } finally {
        svgBackups.forEach(({ svg, canvas, parent }) => {
            if (canvas.parentNode === parent) parent.replaceChild(svg, canvas);
        });
        mathmlBackups.forEach(({ node, parent, nextSibling }) => {
            if (!node.parentNode && parent) parent.insertBefore(node, nextSibling);
        });
        if (sealLine) sealLine.style.display = '';
        if (hint) hint.style.display = '';
        paper.style.cssText = origStyle;
        loadingEl.style.display = 'none';
        if (loadingTitle) loadingTitle.textContent = originalLoadingTitle;
        if (loadingSubtitle) loadingSubtitle.textContent = originalLoadingSubtitle;
        if (progressWrap) progressWrap.style.display = originalProgressDisplay;
    }
}

function assertCanvasHasContent(canvas) {
    if (!canvas || canvas.width < 10 || canvas.height < 10) {
        throw new Error('PDF 画布尺寸无效');
    }
    assertCanvasRegionHasContent(canvas, 0, canvas.height, 'PDF 画布为空白，已拒绝下载');
}

function assertCanvasRegionHasContent(canvas, start, end, errorMessage = 'PDF 页面为空白，已拒绝下载') {
    const regionStart = Math.max(0, Math.floor(Number(start) || 0));
    const regionEnd = Math.min(canvas.height, Math.ceil(Number(end) || canvas.height));
    const regionHeight = regionEnd - regionStart;
    if (regionHeight < 1) throw new Error('PDF 页面切片尺寸无效');

    // 先用缩略图快速检查；稀疏公式或短答案不足阈值时，再读取原始像素复核。
    const sampleWidth = Math.min(256, canvas.width);
    const sampleHeight = Math.min(256, Math.max(1, Math.round(regionHeight * sampleWidth / canvas.width)));
    const sample = document.createElement('canvas');
    sample.width = sampleWidth;
    sample.height = sampleHeight;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, sampleWidth, sampleHeight);
    context.drawImage(canvas, 0, regionStart, canvas.width, regionHeight, 0, 0, sampleWidth, sampleHeight);
    const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const minimumNonWhitePixels = 20;
    let nonWhitePixels = countNonWhitePixels(pixels, minimumNonWhitePixels);
    if (nonWhitePixels >= minimumNonWhitePixels) return;

    const sourceContext = canvas.getContext('2d');
    if (!sourceContext) throw new Error('PDF 画布像素无法读取');
    const stripeHeight = 64;
    for (let stripeStart = regionStart; stripeStart < regionEnd; stripeStart += stripeHeight) {
        const height = Math.min(stripeHeight, regionEnd - stripeStart);
        const stripePixels = sourceContext.getImageData(0, stripeStart, canvas.width, height).data;
        nonWhitePixels += countNonWhitePixels(stripePixels, minimumNonWhitePixels - nonWhitePixels);
        if (nonWhitePixels >= minimumNonWhitePixels) return;
    }

    const error = new Error(errorMessage);
    error.code = 'PDF_BLANK_PAGE';
    error.regionStart = regionStart;
    error.regionEnd = regionEnd;
    throw error;
}

function countNonWhitePixels(pixels, stopAt) {
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) {
            count += 1;
            if (count >= stopAt) return count;
        }
    }
    return count;
}

function registerLosslessPdfImageProcessor(jsPDF) {
    if (typeof jsPDF?.API?.processCYBEREXAMRGB === 'function') return;
    jsPDF.API.processCYBEREXAMRGB = function (_imageData, index, alias) {
        const record = pdfImageRegistry.get(alias);
        if (!record) throw new Error('无损 PDF 图像数据已失效');
        return {
            alias,
            data: record.binaryData,
            index,
            filter: this.decode.FLATE_DECODE,
            decodeParameters: `/Predictor 11 /Colors 3 /BitsPerComponent 8 /Columns ${record.width}`,
            predictor: 11,
            width: record.width,
            height: record.height,
            bitsPerComponent: 8,
            colorSpace: this.color_spaces.DEVICE_RGB
        };
    };
}

async function saveCanvasAsPaginatedPdf(canvas, paper, filename) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) throw new Error('PDF 生成组件未加载');

    registerLosslessPdfImageProcessor(jsPDF);

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const pageVerticalMargin = 10;
    const printablePageHeight = pageHeight - pageVerticalMargin * 2;
    const pagePixelHeight = canvas.width * printablePageHeight / pageWidth;
    const { slices, contentPixelHeight } = computePdfPageSlices(paper, canvas, pagePixelHeight);

    slices.forEach(([start, end], pageIndex) => {
        try {
            assertCanvasRegionHasContent(canvas, start, end);
        } catch (error) {
            if (error?.code === 'PDF_BLANK_PAGE') {
                error.pageNumber = pageIndex + 1;
                error.contentPixelHeight = contentPixelHeight;
                console.error('[PDF 分页质量门] 检测到空白页', {
                    pageNumber: error.pageNumber,
                    start,
                    end,
                    contentPixelHeight
                });
            }
            throw error;
        }
    });

    // 使用浏览器原生 Deflate 生成无损 RGB 流，绕开 jsPDF 的逐像素 PNG 重压缩热点。
    const losslessImage = await buildLosslessPdfImageRecord(canvas);
    const fullImageHeight = canvas.height * pageWidth / canvas.width;
    const imageAlias = `exam-paper-${Date.now()}-${pdfImageSequence += 1}`;
    pdfImageRegistry.set(imageAlias, losslessImage);
    try {
        slices.forEach(([start, end], pageIndex) => {
            const sliceHeight = Math.max(1, end - start);
            if (pageIndex > 0) pdf.addPage();
            const renderedHeight = sliceHeight * pageWidth / canvas.width;
            pdf.saveGraphicsState();
            // style 必须显式为 null；默认描边会先消费路径，导致后续裁剪命令失效。
            pdf.rect(0, pageVerticalMargin, pageWidth, renderedHeight, null).clip().discardPath();
            pdf.addImage(
                PDF_IMAGE_SENTINEL,
                'CYBEREXAMRGB',
                0,
                pageVerticalMargin - start * pageWidth / canvas.width,
                pageWidth,
                fullImageHeight,
                imageAlias
            );
            pdf.restoreGraphicsState();
        });
        pdf.save(filename);
    } finally {
        pdfImageRegistry.delete(imageAlias);
    }
}

function computePdfPageSlices(paper, canvas, pagePixelHeight) {
    const paperRect = paper.getBoundingClientRect();
    const scale = canvas.width / Math.max(1, paperRect.width);
    const safetyGap = Math.max(2, Math.round(scale * 1.5));
    const atomicEntries = [];
    const addEntry = (node, label, bottomNode = node) => {
        if (node) atomicEntries.push({ node, bottomNode, label });
    };

    addEntry(paper.querySelector('.exam-header'), '试卷标题区');
    paper.querySelectorAll('.question-group > .group-title').forEach((title) => {
        const firstBlock = title.parentElement?.querySelector('.question-item > *');
        addEntry(title, '题组标题与首个内容块', firstBlock || title);
    });
    paper.querySelectorAll('.question-item').forEach((question) => {
        const rect = question.getBoundingClientRect();
        if (rect.height * scale + safetyGap * 2 <= pagePixelHeight + 1) {
            addEntry(question, '完整题目');
            return;
        }
        const blocks = Array.from(question.children);
        if (blocks.length === 0) addEntry(question, '题目内容块');
        else blocks.forEach((block) => addEntry(block, '题目内容块'));
    });
    paper.querySelectorAll('.answer-key > .group-title').forEach((title) => {
        const firstStep = title.parentElement?.querySelector('.answer-item > *');
        addEntry(title, '答案标题与首个解析步骤', firstStep || title);
    });
    paper.querySelectorAll('.answer-item').forEach((answer) => {
        const rect = answer.getBoundingClientRect();
        if (rect.height * scale + safetyGap * 2 <= pagePixelHeight + 1) {
            addEntry(answer, '完整答案解析');
            return;
        }
        const steps = Array.from(answer.children);
        if (steps.length === 0) addEntry(answer, '答案解析步骤');
        else steps.forEach((step) => addEntry(step, '答案解析步骤'));
    });

    const measuredEntries = atomicEntries.map(({ node, bottomNode, label }) => {
        const visibleRects = Array.from(new Set([node, bottomNode])).map((candidate) => {
            if (!candidate || candidate.getClientRects().length === 0) return null;
            const rect = candidate.getBoundingClientRect();
            if (rect.width <= 0 && rect.height <= 0) return null;
            return rect;
        }).filter(Boolean);
        if (visibleRects.length === 0) return null;
        const top = Math.min(...visibleRects.map((rect) => rect.top));
        const bottom = Math.max(...visibleRects.map((rect) => rect.bottom));
        return {
            top: Math.max(0, Math.round((top - paperRect.top) * scale) - safetyGap),
            bottom: Math.min(canvas.height, Math.round((bottom - paperRect.top) * scale) + safetyGap),
            contentBottom: Math.min(canvas.height, Math.ceil((bottom - paperRect.top) * scale)),
            label
        };
    }).filter(Boolean);
    if (measuredEntries.length === 0) throw new Error('PDF 未找到可见的试卷内容');

    const contentPixelHeight = Math.max(...measuredEntries.map((entry) => entry.contentBottom));
    const ranges = measuredEntries.map(({ top, bottom, label }) => ({
        top: Math.min(top, contentPixelHeight),
        bottom: Math.min(bottom, contentPixelHeight),
        label
    }));
    const slices = computeAtomicPageSlices({
        canvasHeight: canvas.height,
        contentHeight: contentPixelHeight,
        pagePixelHeight,
        atomicRanges: ranges
    });
    return { slices, contentPixelHeight };
}

function normalizeWordFigureSvg(container) {
    const svgs = container.querySelectorAll('svg');
    if (svgs.length !== 1) throw new Error('每道题图必须且只能包含一个有效 SVG');
    const svgClone = svgs[0].cloneNode(true);
    if (!svgClone.getAttribute('xmlns')) svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgClone.setAttribute('width', '400');
    svgClone.setAttribute('height', '300');
    svgClone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    return new XMLSerializer().serializeToString(svgClone);
}

async function renderWordFigurePng(container) {
    const svgString = normalizeWordFigureSvg(container);
    const svgBase64 = btoa(unescape(encodeURIComponent(svgString)));
    const sourceImage = new Image();
    await new Promise((resolve, reject) => {
        sourceImage.onload = resolve;
        sourceImage.onerror = () => reject(new Error('浏览器无法读取题图 SVG'));
        sourceImage.src = `data:image/svg+xml;base64,${svgBase64}`;
    });

    const canvas = document.createElement('canvas');
    canvas.width = UNIFORM_FIGURE_WIDTH_PX * WORD_FIGURE_RENDER_SCALE;
    canvas.height = UNIFORM_FIGURE_HEIGHT_PX * WORD_FIGURE_RENDER_SCALE;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(WORD_FIGURE_RENDER_SCALE, WORD_FIGURE_RENDER_SCALE);
    context.drawImage(sourceImage, 0, 0, UNIFORM_FIGURE_WIDTH_PX, UNIFORM_FIGURE_HEIGHT_PX);
    assertCanvasHasContent(canvas);
    return {
        dataUrl: canvas.toDataURL('image/png'),
        widthPx: UNIFORM_FIGURE_WIDTH_PX,
        heightPx: UNIFORM_FIGURE_HEIGHT_PX
    };
}

async function renderWordFigureImages(figureContainers) {
    return renderItemsByKey(figureContainers, {
        keyOf: (container) => `${WORD_FIGURE_RENDER_SCALE}\u0000${normalizeWordFigureSvg(container)}`,
        render: renderWordFigurePng,
        cache: wordFigureImageCache,
        concurrency: WORD_RENDER_CONCURRENCY,
        maxCacheEntries: 64
    });
}

async function exportToWord() {
    if (state.formulaFailed) {
        alert('存在无法渲染的公式，已停止导出。请重新生成题目后再试。');
        return;
    }
    const titleText = document.getElementById('paperTitle').textContent;
    const showAnswer = document.getElementById('showAnswer').checked;
    const loadingEl = document.getElementById('loading');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingSubtitle = document.getElementById('loadingSubtitle');
    const originalLoadingTitle = loadingTitle?.textContent || '';
    const originalLoadingSubtitle = loadingSubtitle?.textContent || '';
    loadingEl.style.display = 'flex';
    if (loadingTitle) loadingTitle.textContent = '正在生成 Word';
    if (loadingSubtitle) loadingSubtitle.textContent = '正在生成可编辑公式并嵌入高清题图，请勿关闭页面';

    try {
        const examContent = document.getElementById('examContent');
        const answerContent = document.getElementById('answerContent');
        const figureContainers = Array.from(examContent.querySelectorAll('.q-figure'));
        assertWordSemanticDomReady({
            title: titleText,
            examContent,
            answerContent,
            showAnswer
        });
        if (document.fonts?.ready) await document.fonts.ready;

        const figureImages = await renderWordFigureImages(figureContainers);
        if (figureImages.size !== figureContainers.length) throw new Error('题图图片数量不完整，已停止 Word 导出');
        const wordPackage = await buildEditableWordDocx({
            title: titleText,
            examContent,
            answerContent,
            showAnswer,
            figureImages
        });
        assertWordDocxParts(wordPackage.documentXml, wordPackage.mediaPaths, {
            expectedFormulaCount: wordPackage.formulaCount,
            expectedFigureCount: figureContainers.length
        });

        const url = URL.createObjectURL(wordPackage.blob);
        const link = document.createElement('a');
        link.href = url;
        const safeFileName = titleText.replace(/[\\/:*?"<>|]/g, '_').trim() || '试卷';
        link.download = `${safeFileName}.docx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        console.error('Word导出失败:', error);
        alert('Word导出失败: ' + error.message);
    } finally {
        loadingEl.style.display = 'none';
        if (loadingTitle) loadingTitle.textContent = originalLoadingTitle;
        if (loadingSubtitle) loadingSubtitle.textContent = originalLoadingSubtitle;
    }
}

function showContactModal() {
    const globalBtn = document.getElementById('cyberGlobalContactBtn');
    if (globalBtn) { globalBtn.click(); return; }
    document.getElementById('contactModal').classList.add('show');
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const SETTINGS_KEY = 'exam_settings_v3';

document.getElementById('showAnswer').addEventListener('change', (e) => {
    document.getElementById('answerArea').style.display = e.target.checked ? 'block' : 'none';
    saveSettings();
});

['examType'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveSettings);
});

/* ==================== 多知识点组卷配置 ==================== */

function initTopicManager() {
    if (state.topicManagerBound) return;
    state.topicManagerBound = true;

    const addButton = document.getElementById('addTopicBtn');
    const manualButton = document.getElementById('manualTopicBtn');
    const picker = document.getElementById('topicSelect');
    const cards = document.getElementById('topicCards');
    const outline = document.getElementById('topicOutline');
    const retryButton = document.getElementById('retryConnectionBtn');
    if (addButton) addButton.addEventListener('click', () => addTopicFromPicker());
    if (manualButton) manualButton.addEventListener('click', () => showManualTopicInput());
    if (picker) picker.addEventListener('dblclick', () => addTopicFromPicker());
    if (cards) {
        cards.addEventListener('click', handleTopicCardsClick);
        cards.addEventListener('input', handleTopicCardsInput);
        cards.addEventListener('change', handleTopicCardsInput);
    }
    if (outline) outline.addEventListener('click', handleTopicOutlineClick);
    if (retryButton) retryButton.addEventListener('click', () => checkApiHealth());
}

async function onConfigChange() {
    const grade = document.getElementById('grade')?.value || '';
    const subject = document.getElementById('subject')?.value || '';
    const picker = document.getElementById('topicSelect');
    const cards = document.getElementById('topicCards');
    if (!picker || !cards) return;

    picker.disabled = true;
    state.activeTopic = '';
    clearGenerationError();
    setServiceStatus('checking', '正在连接出题服务');
    showConfigurationWorkspace();
    renderWorkspaceState('loading', '正在读取教材知识点');
    renderTopicOutline();
    try {
        const resp = await apiFetch(`${API_BASE}/knowledge/topics?grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}`);
        if (!resp.ok) throw new Error(`知识点加载失败（HTTP ${resp.status}）`);
        const payload = await resp.json();
        state.topicsData = Array.isArray(payload.topics) ? payload.topics : [];
        populateTopics(state.topicsData);
        setServiceStatus('connected', '出题服务已连接');
        renderWorkspaceState('empty', '先建立组卷范围', '从左侧添加知识点，这里将显示对应考点。');

        const pending = state.pendingTopicConfigs;
        state.pendingTopicConfigs = null;
        if (pending && state.pendingSubject === subject && state.pendingGrade === grade) {
            for (const config of pending) await addTopicByName(config.topic, config);
        }
        updateScopeSummary();
    } catch (error) {
        console.error('加载知识点失败:', error);
        state.topicsData = [];
        populateTopics([]);
        setServiceStatus('unavailable', '出题服务未连接');
        renderWorkspaceState('error', '知识点暂时无法读取', '仍可手动添加知识点，连接恢复后再生成试卷。');
        const failure = describeGenerationFailure(error);
        showGenerationError(failure.title, failure.message, true);
        updateScopeSummary();
    } finally {
        picker.disabled = false;
        saveSettings();
    }
}

function populateTopics(topics) {
    const picker = document.getElementById('topicSelect');
    if (!picker) return;
    picker.innerHTML = '<option value="">-- 请选择要添加的知识点 --</option>';
    for (const entry of topics || []) {
        const name = typeof entry === 'string' ? entry : entry?.name;
        if (!name) continue;
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        picker.appendChild(option);
    }
    const manualOption = document.createElement('option');
    manualOption.value = '__manual__';
    manualOption.textContent = '✎ 手动输入知识点';
    picker.appendChild(manualOption);
}

function addTopicFromPicker() {
    const picker = document.getElementById('topicSelect');
    const value = picker?.value || '';
    if (value === '__manual__') {
        showManualTopicInput();
        return;
    }
    if (value) addTopicByName(value);
    if (picker) picker.value = '';
}

async function addTopicByName(topicName, savedConfig = null) {
    const topic = String(topicName || '').trim();
    if (!topic) return null;
    const cards = document.getElementById('topicCards');
    if (!cards) return null;
    const duplicate = Array.from(cards.querySelectorAll('.topic-card')).find((card) => card.dataset.topic === topic);
    if (duplicate) {
        setActiveTopic(topic);
        duplicate.classList.add('topic-card-highlight');
        setTimeout(() => duplicate.classList.remove('topic-card-highlight'), 800);
        return duplicate;
    }

    const empty = cards.querySelector('.workspace-empty');
    if (empty) empty.remove();
    const card = document.createElement('section');
    card.className = 'topic-card';
    card.dataset.topic = topic;
    card.innerHTML = `
        <div class="topic-card-head">
            <div>
                <span class="topic-card-index">知识点 ${cards.querySelectorAll('.topic-card').length + 1}</span>
                <h3>${escapeHtml(topic)}</h3>
            </div>
            <button class="topic-remove-button" type="button" data-action="remove-topic">移除知识点</button>
        </div>
        <div class="point-editor-toolbar">
            <div>
                <strong>考点范围</strong>
                <span data-role="topic-metrics">0 个考点 · 0 题</span>
            </div>
            <div class="point-bulk-actions">
                <button type="button" data-action="select-all-points">全选</button>
                <button type="button" data-action="clear-all-points">清空</button>
            </div>
        </div>
        <div class="point-table">
            <div class="point-table-head" aria-hidden="true">
                <span>考点</span><span>题量</span><span>难度</span><span>选择</span><span>填空</span><span>解答</span><span>操作</span>
            </div>
            <div class="point-list" data-role="point-list">
                <div class="point-loading">正在加载该知识点下的考点…</div>
            </div>
        </div>
        <div class="manual-point-row">
            <button class="manual-point-button" type="button" data-action="show-manual-point">手动添加考点</button>
        </div>`;
    cards.appendChild(card);
    setActiveTopic(topic);

    const grade = document.getElementById('grade')?.value || '';
    const subject = document.getElementById('subject')?.value || '';
    try {
        const resp = await apiFetch(`${API_BASE}/knowledge/exam-points?grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}&topic=${encodeURIComponent(topic)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const payload = await resp.json();
        const points = Array.isArray(payload.examPoints) ? payload.examPoints : [];
        renderPointRows(card, points, savedConfig?.examPoints || []);
    } catch (error) {
        console.error('加载考点失败:', error);
        renderPointRows(card, [], savedConfig?.examPoints || []);
        if (error?.code === 'API_NETWORK_UNAVAILABLE' || error?.code === 'API_TIMEOUT') {
            setServiceStatus('unavailable', '出题服务未连接');
        }
    }
    updateScopeSummary();
    saveSettings();
    return card;
}

function renderPointRows(card, points, savedPoints = []) {
    const list = card.querySelector('[data-role="point-list"]');
    if (!list) return;
    const names = Array.from(new Set([
        ...(points || []).map((point) => typeof point === 'string' ? point : point?.name).filter(Boolean),
        ...(savedPoints || []).map((point) => typeof point === 'string' ? point : point?.name).filter(Boolean)
    ]));
    if (!names.length) {
        list.innerHTML = '<div class="point-empty">暂无预设考点，请手动添加。</div>';
        return;
    }
    list.innerHTML = names.map((name) => {
        const saved = savedPoints.find((point) => (typeof point === 'string' ? point : point?.name) === name);
        return createPointRowHtml(name, saved || {}, Boolean(saved));
    }).join('');
    card.querySelectorAll('.point-row').forEach(syncPointRowEnabled);
}

function createPointRowHtml(name, saved = {}, enabled = false) {
    const config = typeof saved === 'object' && saved ? saved : {};
    const counts = config.questionTypeCounts || { choice: 1, fill: 0, calculation: 0 };
    const typeTotal = Object.values(counts).reduce((sum, item) => sum + (Number(item) || 0), 0);
    const count = Number(config.questionCount) || Math.max(1, typeTotal || 1);
    const difficulty = Math.max(1, Math.min(10, Number(config.difficulty) || 5));
    const disabled = enabled ? '' : ' disabled';
    return `<div class="point-row${enabled ? '' : ' is-disabled'}" data-point="${escapeHtml(name)}">
        <label class="point-check">
            <input type="checkbox" class="point-enabled"${enabled ? ' checked' : ''}>
            <span class="point-name-stack"><strong>${escapeHtml(name)}</strong><small class="point-count-summary">${enabled ? `共 ${count} 题` : '未选择'}</small></span>
        </label>
        <label class="point-control point-count-cell"><span>题量</span><input class="point-count" aria-label="${escapeHtml(name)}题量" type="number" min="1" max="30" value="${count}"${disabled}></label>
        <label class="point-control point-difficulty-control"><span>难度 <output class="point-difficulty-value">${difficulty}</output></span><input class="point-difficulty" aria-label="${escapeHtml(name)}难度" type="range" min="1" max="10" value="${difficulty}"${disabled}></label>
        <label class="point-control point-type-control"><span>选择</span><input class="point-type-count" aria-label="${escapeHtml(name)}选择题数量" data-type="choice" type="number" min="0" max="30" value="${Number(counts.choice) || 0}"${disabled}></label>
        <label class="point-control point-type-control"><span>填空</span><input class="point-type-count" aria-label="${escapeHtml(name)}填空题数量" data-type="fill" type="number" min="0" max="30" value="${Number(counts.fill) || 0}"${disabled}></label>
        <label class="point-control point-type-control"><span>解答</span><input class="point-type-count" aria-label="${escapeHtml(name)}解答题数量" data-type="calculation" type="number" min="0" max="30" value="${Number(counts.calculation) || 0}"${disabled}></label>
        <button class="point-delete-button" type="button" data-action="remove-point" aria-label="移除考点" title="移除考点">×</button>
    </div>`;
}

function handleTopicCardsClick(event) {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const card = event.target.closest('.topic-card');
    if (action === 'remove-topic' && card) {
        const nextCard = card.nextElementSibling?.classList.contains('topic-card')
            ? card.nextElementSibling
            : card.previousElementSibling?.classList.contains('topic-card') ? card.previousElementSibling : null;
        card.remove();
        state.activeTopic = nextCard?.dataset.topic || '';
        renumberTopicCards();
        updateScopeSummary();
        saveSettings();
    }
    if (action === 'remove-point' && card) {
        event.target.closest('.point-row')?.remove();
        updateScopeSummary();
        saveSettings();
    }
    if (action === 'show-manual-point' && card) showManualPointInput(card);
    if (action === 'confirm-manual-point' && card) confirmManualPoint(card);
    if (action === 'select-all-points' && card) setAllPointRowsEnabled(card, true);
    if (action === 'clear-all-points' && card) setAllPointRowsEnabled(card, false);
}

function handleTopicCardsInput(event) {
    const target = event.target;
    const pointRow = target.closest('.point-row');
    if (!pointRow) return;
    if (target.classList.contains('point-enabled')) {
        syncPointRowEnabled(pointRow);
    }
    if (target.classList.contains('point-difficulty')) {
        const output = pointRow.querySelector('.point-difficulty-value');
        if (output) output.textContent = target.value;
    }
    if (target.classList.contains('point-count')) {
        rebalancePointTypeCounts(pointRow, Math.max(1, Math.min(30, Number(target.value) || 1)));
    }
    if (target.classList.contains('point-type-count')) {
        const sum = getPointTypeCounts(pointRow).total;
        const count = pointRow.querySelector('.point-count');
        if (count) count.value = Math.max(1, Math.min(30, sum || 1));
    }
    updatePointCountSummary(pointRow);
    updateScopeSummary();
    saveSettings();
}

function rebalancePointTypeCounts(row, desiredTotal) {
    const inputs = Array.from(row.querySelectorAll('.point-type-count'));
    if (!inputs.length) return;
    let remaining = desiredTotal;
    for (let index = inputs.length - 1; index >= 1; index -= 1) {
        const value = Math.max(0, Number(inputs[index].value) || 0);
        const accepted = Math.min(value, remaining);
        inputs[index].value = accepted;
        remaining -= accepted;
    }
    inputs[0].value = remaining;
}

function getPointTypeCounts(row) {
    const counts = {};
    for (const input of row.querySelectorAll('.point-type-count')) counts[input.dataset.type] = Math.max(0, Number(input.value) || 0);
    return { counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
}

function updatePointCountSummary(row) {
    const summary = row.querySelector('.point-count-summary');
    if (!summary) return;
    const result = getPointTypeCounts(row);
    const count = Number(row.querySelector('.point-count')?.value) || 0;
    const enabled = Boolean(row.querySelector('.point-enabled')?.checked);
    summary.textContent = !enabled ? '未选择' : result.total === count ? `共 ${count} 题` : `题型 ${result.total} / 题量 ${count}`;
    summary.dataset.state = !enabled ? 'empty' : result.total === count ? 'ok' : 'error';
}

function syncPointRowEnabled(row) {
    const enabled = Boolean(row.querySelector('.point-enabled')?.checked);
    row.classList.toggle('is-disabled', !enabled);
    row.querySelectorAll('input:not(.point-enabled)').forEach((input) => { input.disabled = !enabled; });
    if (enabled && getPointTypeCounts(row).total === 0) {
        const choice = row.querySelector('.point-type-count[data-type="choice"]');
        if (choice) choice.value = 1;
        const count = row.querySelector('.point-count');
        if (count) count.value = 1;
    }
    updatePointCountSummary(row);
}

function setAllPointRowsEnabled(card, enabled) {
    card.querySelectorAll('.point-row').forEach((row) => {
        const checkbox = row.querySelector('.point-enabled');
        if (checkbox) checkbox.checked = enabled;
        syncPointRowEnabled(row);
    });
    updateScopeSummary();
    saveSettings();
}

function showManualTopicInput() {
    if (document.getElementById('manualTopicInput')) return document.getElementById('manualTopicInput').focus();
    const anchor = document.querySelector('.compact-manual-entry');
    if (!anchor) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'inline-manual-wrapper';
    wrapper.innerHTML = `<input id="manualTopicInput" class="manual-input-control" placeholder="例如：二次函数图像与性质"><button class="manual-input-confirm" type="button">添加知识点</button>`;
    anchor.appendChild(wrapper);
    wrapper.querySelector('button').addEventListener('click', () => {
        const value = wrapper.querySelector('input').value.trim();
        if (!value) return;
        addTopicByName(value);
        wrapper.remove();
    });
    wrapper.querySelector('input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') wrapper.querySelector('button').click();
    });
    wrapper.querySelector('input').focus();
}

function showManualPointInput(card) {
    if (card.querySelector('.manual-point-input')) return card.querySelector('.manual-point-input').focus();
    const anchor = card.querySelector('.manual-point-row');
    const wrapper = document.createElement('div');
    wrapper.className = 'inline-manual-wrapper manual-point-input-wrap';
    wrapper.innerHTML = `<input class="manual-point-input manual-input-control" placeholder="例如：二次函数与面积最值"><button class="manual-input-confirm" type="button" data-action="confirm-manual-point">添加</button>`;
    anchor.appendChild(wrapper);
    wrapper.querySelector('input').focus();
}

function confirmManualPoint(card) {
    const input = card.querySelector('.manual-point-input');
    const name = input?.value.trim();
    if (!name) return;
    const list = card.querySelector('[data-role="point-list"]');
    const empty = list.querySelector('.point-empty');
    if (empty) empty.remove();
    const existing = Array.from(list.querySelectorAll('.point-row')).find((row) => row.dataset.point === name);
    if (existing) {
        const checkbox = existing.querySelector('.point-enabled');
        if (checkbox) checkbox.checked = true;
        syncPointRowEnabled(existing);
        input.closest('.inline-manual-wrapper')?.remove();
        updateScopeSummary();
        saveSettings();
        return;
    }
    list.insertAdjacentHTML('beforeend', createPointRowHtml(name, {}, true));
    input.closest('.inline-manual-wrapper')?.remove();
    updateScopeSummary();
    saveSettings();
}

function renumberTopicCards() {
    document.querySelectorAll('#topicCards .topic-card').forEach((card, index) => {
        const label = card.querySelector('.topic-card-index');
        if (label) label.textContent = `知识点 ${index + 1}`;
    });
    if (!document.querySelector('#topicCards .topic-card')) {
        renderWorkspaceState('empty', '先建立组卷范围', '从左侧添加知识点，这里将显示对应考点。');
    } else if (state.activeTopic) {
        setActiveTopic(state.activeTopic, { showWorkspace: false });
    }
}

function getTopicConfigs() {
    const configs = [];
    document.querySelectorAll('#topicCards .topic-card').forEach((card) => {
        const examPoints = [];
        card.querySelectorAll('.point-row').forEach((row) => {
            if (!row.querySelector('.point-enabled')?.checked) return;
            const count = Math.max(1, Math.min(30, Number(row.querySelector('.point-count')?.value) || 1));
            const typeResult = getPointTypeCounts(row);
            examPoints.push({
                name: row.dataset.point,
                questionCount: count,
                difficulty: Math.max(1, Math.min(10, Number(row.querySelector('.point-difficulty')?.value) || 5)),
                questionTypeCounts: typeResult.counts
            });
        });
        configs.push({ topic: card.dataset.topic, examPoints });
    });
    return configs;
}

function updateScopeSummary() {
    const summary = document.getElementById('scopeSummary');
    if (!summary) return;
    const configs = getTopicConfigs();
    const pointCount = configs.reduce((sum, item) => sum + item.examPoints.length, 0);
    const total = configs.reduce((sum, item) => sum + item.examPoints.reduce((pointSum, point) => pointSum + point.questionCount, 0), 0);
    const mismatch = Array.from(document.querySelectorAll('#topicCards .point-row')).some((row) => {
        if (!row.querySelector('.point-enabled')?.checked) return false;
        return getPointTypeCounts(row).total !== Number(row.querySelector('.point-count')?.value || 0);
    });
    const topicCount = document.getElementById('summaryTopicCount');
    const examPointCount = document.getElementById('summaryPointCount');
    const questionCount = document.getElementById('summaryQuestionCount');
    const message = document.getElementById('scopeSummaryMessage');
    if (topicCount) topicCount.textContent = configs.length;
    if (examPointCount) examPointCount.textContent = pointCount;
    if (questionCount) questionCount.textContent = total;

    const hasEmptyTopic = configs.some((config) => config.examPoints.length === 0);
    if (message) {
        if (mismatch) message.textContent = '有考点的题型合计与题量不一致';
        else if (total > 30) message.textContent = '整张试卷最多 30 题';
        else if (hasEmptyTopic) message.textContent = '还有知识点未选择考点';
        else if (total > 0) message.textContent = '组卷参数已就绪';
        else message.textContent = '添加知识点后开始配置';
    }
    summary.dataset.state = mismatch || total > 30 ? 'error' : total > 0 && !hasEmptyTopic ? 'ok' : 'empty';
    renderTopicOutline();
    updateActiveTopicHeading();
}

function validateTopicConfigs(configs) {
    if (!configs.length) return '请至少添加一个知识点';
    const total = configs.reduce((sum, topic) => sum + topic.examPoints.reduce((pointSum, point) => pointSum + point.questionCount, 0), 0);
    if (total < 1 || total > 30) return '整张试卷题量需在 1-30 题之间';
    for (const topic of configs) {
        if (!topic.examPoints.length) return `知识点“${topic.topic}”没有选中的考点`;
        for (const point of topic.examPoints) {
            const sum = Object.values(point.questionTypeCounts).reduce((acc, item) => acc + item, 0);
            if (sum !== point.questionCount) return `考点“${point.name}”的题型数量之和必须等于题量`;
        }
    }
    return '';
}

function saveSettings() {
    const configs = (() => { try { return getTopicConfigs(); } catch { return []; } })();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        subject: document.getElementById('subject')?.value || '',
        grade: document.getElementById('grade')?.value || '',
        examType: document.getElementById('examType')?.value || 'final',
        showAnswer: Boolean(document.getElementById('showAnswer')?.checked),
        topicConfigs: configs
    }));
}

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return;
    try {
        const data = JSON.parse(saved);
        if (data.subject) document.getElementById('subject').value = data.subject;
        if (data.grade) document.getElementById('grade').value = data.grade;
        if (data.examType) document.getElementById('examType').value = data.examType;
        if (data.showAnswer !== undefined) document.getElementById('showAnswer').checked = Boolean(data.showAnswer);
        if (Array.isArray(data.topicConfigs)) {
            state.pendingTopicConfigs = data.topicConfigs;
            state.pendingSubject = data.subject;
            state.pendingGrade = data.grade;
        }
    } catch (error) { console.error('加载设置失败', error); }
}

async function generateExam() {
    if (state.continuingGroupIds.size > 0) return;
    const topicConfigs = getTopicConfigs();
    const validationError = validateTopicConfigs(topicConfigs);
    if (validationError) {
        showConfigurationWorkspace();
        showGenerationError('还有配置未完成', validationError, false);
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
    let fakeProgress = 0;
    clearGenerationError();
    showConfigurationWorkspace();
    setServiceStatus('working', '正在生成试卷');
    loadingEl.style.display = 'flex';
    setGenerateButtonLoading(true, '正在生成多知识点试卷…');
    if (loadingTitle) loadingTitle.textContent = '正在生成试卷';
    if (loadingSubtitle) loadingSubtitle.textContent = '正在按知识点与考点分别命题';
    if (fakeProgressBar) fakeProgressBar.style.width = '0%';
    if (fakeProgressText) fakeProgressText.textContent = '0%';
    const timer = setInterval(() => {
        fakeProgress = Math.min(96, fakeProgress + 1);
        if (fakeProgressBar) fakeProgressBar.style.width = `${fakeProgress}%`;
        if (fakeProgressText) fakeProgressText.textContent = `${fakeProgress}%`;
        if (loadingSubtitle) loadingSubtitle.textContent = '正在按考点与题型分别命题，质量校验中';
    }, 900);
    try {
        const resp = await apiFetch(`${API_BASE}/exam/generate`, {
            method: 'POST',
            headers: withUsageHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                grade: document.getElementById('grade').value,
                subject: document.getElementById('subject').value,
                examType: document.getElementById('examType').value,
                topicConfigs
            })
        });
        const data = await readJsonResponse(resp, '生成失败');
        if (!resp.ok) {
            if (data?.code === 'TRIAL_CREDITS_EXHAUSTED') {
                state.trialCreditsRemaining = 0;
                refreshTrialCreditsHint();
                if (window.HZQ && typeof window.HZQ._showRedeemModal === 'function') window.HZQ._showRedeemModal();
                else showGenerationError('体验次数已用完', '请登录后兑换或充值积分。', false);
                return;
            }
            throw new Error(data.error || '请稍后重试');
        }
        if (requestToken !== state.activeGenerateToken) return;
        if (!Array.isArray(data.questions) || !data.questions.length) throw new Error('没有返回有效题目');
        if (typeof data.continuationToken !== 'string' || data.continuationToken.length < 32) {
            throw new Error('服务端未返回有效的组卷会话凭证');
        }
        if (typeof data?.trialCreditsRemaining !== 'undefined') {
            state.trialCreditsRemaining = data.trialCreditsRemaining;
            refreshTrialCreditsHint();
        }
        state.currentExamData = data;
        state.continuationToken = data.continuationToken;
        setServiceStatus('connected', '出题服务已连接');
        renderQuestionCards(data, requestToken);
    } catch (error) {
        console.error('生成试卷失败:', error);
        const failure = describeGenerationFailure(error);
        const isConnectionFailure = error?.code === 'API_NETWORK_UNAVAILABLE' || error?.code === 'API_TIMEOUT';
        setServiceStatus(isConnectionFailure ? 'unavailable' : 'error', failure.statusText);
        showConfigurationWorkspace();
        showGenerationError(failure.title, failure.message, failure.retryable);
    } finally {
        clearInterval(timer);
        if (requestToken === state.activeGenerateToken) {
            loadingEl.style.display = 'none';
            setGenerateButtonLoading(false);
        }
    }
}

function handleTopicOutlineClick(event) {
    const button = event.target.closest('[data-topic]');
    if (!button) return;
    setActiveTopic(button.dataset.topic);
}

function setActiveTopic(topic, options = {}) {
    const cards = Array.from(document.querySelectorAll('#topicCards .topic-card'));
    const activeCard = cards.find((card) => card.dataset.topic === topic) || cards[0] || null;
    state.activeTopic = activeCard?.dataset.topic || '';
    cards.forEach((card) => card.classList.toggle('is-active', card === activeCard));
    renderTopicOutline();
    updateActiveTopicHeading();
    if (options.showWorkspace !== false) showConfigurationWorkspace();
}

function getTopicMetrics(card) {
    if (!card) return { pointCount: 0, questionCount: 0 };
    const enabledRows = Array.from(card.querySelectorAll('.point-row'))
        .filter((row) => row.querySelector('.point-enabled')?.checked);
    return {
        pointCount: enabledRows.length,
        questionCount: enabledRows.reduce(
            (sum, row) => sum + Math.max(0, Number(row.querySelector('.point-count')?.value) || 0),
            0
        )
    };
}

function renderTopicOutline() {
    const outline = document.getElementById('topicOutline');
    if (!outline) return;
    const cards = Array.from(document.querySelectorAll('#topicCards .topic-card'));
    if (!cards.length) {
        outline.innerHTML = '<div class="outline-empty">还没有添加知识点</div>';
        return;
    }
    outline.innerHTML = cards.map((card, index) => {
        const metrics = getTopicMetrics(card);
        const active = card.dataset.topic === state.activeTopic;
        return `<button class="topic-outline-item${active ? ' is-active' : ''}" type="button" data-topic="${escapeHtml(card.dataset.topic)}">
            <span class="outline-index">${String(index + 1).padStart(2, '0')}</span>
            <span class="outline-copy"><strong>${escapeHtml(card.dataset.topic)}</strong><small>${metrics.pointCount} 个考点 · ${metrics.questionCount} 题</small></span>
            <span class="outline-arrow" aria-hidden="true">›</span>
        </button>`;
    }).join('');
}

function updateActiveTopicHeading() {
    const title = document.getElementById('activeTopicTitle');
    const meta = document.getElementById('activeTopicMeta');
    const card = Array.from(document.querySelectorAll('#topicCards .topic-card'))
        .find((item) => item.dataset.topic === state.activeTopic);
    if (!title || !meta) return;
    if (!card) {
        title.textContent = '选择一个知识点开始配置';
        meta.textContent = '添加知识点后，可在这里设置考点、题量、难度与题型。';
        return;
    }
    const metrics = getTopicMetrics(card);
    title.textContent = card.dataset.topic;
    meta.textContent = metrics.pointCount
        ? `已选择 ${metrics.pointCount} 个考点，共 ${metrics.questionCount} 题`
        : '请选择本次试卷要考查的考点';
    const topicMetrics = card.querySelector('[data-role="topic-metrics"]');
    if (topicMetrics) topicMetrics.textContent = `${metrics.pointCount} 个考点 · ${metrics.questionCount} 题`;
}

function renderWorkspaceState(tone, title, detail = '') {
    const cards = document.getElementById('topicCards');
    if (!cards) return;
    const mark = tone === 'loading' ? '···' : tone === 'error' ? '!' : '01';
    cards.innerHTML = `<div class="workspace-empty is-${tone}">
        <span class="workspace-empty-mark">${mark}</span>
        <strong>${escapeHtml(title)}</strong>
        ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
    </div>`;
    updateActiveTopicHeading();
}

function showConfigurationWorkspace() {
    const workspace = document.getElementById('configWorkspace');
    const selectMode = document.getElementById('selectMode');
    if (workspace) workspace.hidden = false;
    if (selectMode) {
        selectMode.hidden = true;
        selectMode.style.display = 'none';
    }
    const composeBar = document.getElementById('composeBar');
    if (composeBar) composeBar.style.display = 'none';
    document.getElementById('paper')?.classList.remove('show');
    document.getElementById('downloadBar')?.classList.remove('show');
}

function setServiceStatus(status, text) {
    state.serviceStatus = status;
    const statusElement = document.getElementById('serviceStatus');
    const statusText = document.getElementById('serviceStatusText');
    if (statusElement) statusElement.dataset.state = status;
    if (statusText) statusText.textContent = text;
}

function showGenerationError(title, message, retryable = false) {
    const panel = document.getElementById('generationError');
    const titleElement = document.getElementById('generationErrorTitle');
    const messageElement = document.getElementById('generationErrorMessage');
    const retryButton = document.getElementById('retryConnectionBtn');
    if (!panel) return;
    panel.hidden = false;
    if (titleElement) titleElement.textContent = title;
    if (messageElement) messageElement.textContent = message;
    if (retryButton) retryButton.hidden = !retryable;
}

function clearGenerationError() {
    const panel = document.getElementById('generationError');
    if (panel) panel.hidden = true;
}

function describeGenerationFailure(error) {
    const apiBase = window.__EXAM_API_BASE__ || '/api';
    if (error?.code === 'API_NETWORK_UNAVAILABLE') {
        return {
            title: '无法连接出题服务',
            message: `请确认本地服务已启动，然后重试连接。当前 API：${apiBase}`,
            statusText: '出题服务未连接',
            retryable: true
        };
    }
    if (error?.code === 'API_TIMEOUT') {
        return {
            title: '连接出题服务超时',
            message: '本地服务暂时没有响应，请检查服务终端后重试连接。',
            statusText: '连接超时',
            retryable: true
        };
    }
    return {
        title: '题目生成未完成',
        message: error?.message || '服务没有返回有效题目，请检查 AI 配置后重新生成。',
        statusText: '生成未完成',
        retryable: false
    };
}

async function checkApiHealth(options = {}) {
    const retryButton = document.getElementById('retryConnectionBtn');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    if (retryButton) retryButton.disabled = true;
    setServiceStatus('checking', '正在检查服务连接');
    try {
        const response = await apiFetch(`${API_BASE}/health`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`健康检查失败（HTTP ${response.status}）`);
        clearGenerationError();
        setServiceStatus('connected', '出题服务已连接');
        return true;
    } catch (error) {
        const failure = describeGenerationFailure(error);
        setServiceStatus('unavailable', failure.statusText);
        if (!options.quiet) showGenerationError(failure.title, failure.message, true);
        return false;
    } finally {
        clearTimeout(timeout);
        if (retryButton) retryButton.disabled = false;
    }
}

function renderPaperText(value, options = {}) {
    const source = String(value ?? '');
    const formulaPattern = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g;
    const formatPlainText = (text) => escapeHtml(text).replace(/\r?\n/g, '<br>');
    let html = '';
    let cursor = 0;
    let match;
    while ((match = formulaPattern.exec(source))) {
        html += formatPlainText(source.slice(cursor, match.index));
        const token = match[0];
        const displayMode = token.startsWith('\\[');
        const body = token.slice(2, -2);
        try {
            if (!window.katex) throw new Error('KaTeX 尚未加载');
            html += window.katex.renderToString(body.trim(), {
                displayMode,
                throwOnError: true,
                strict: 'error',
                trust: false,
                output: 'htmlAndMathml'
            });
        } catch (error) {
            if (options.throwOnFormulaError) {
                throw new Error(`公式无法按规范渲染：${error.message}`);
            }
            state.formulaFailed = true;
            html += `<span class="formula-error" title="${escapeHtml(error.message)}">公式渲染失败</span>`;
        }
        cursor = formulaPattern.lastIndex;
    }
    html += formatPlainText(source.slice(cursor));
    return html;
}

function formatPaperText(value) {
    return renderPaperText(value);
}

function formatPaperTextStrict(value) {
    return renderPaperText(value, { throwOnFormulaError: true });
}

function updateExportAvailability() {
    const exportButtons = document.querySelectorAll('.preview-bottom-bar .bar-btn.primary');
    exportButtons.forEach((button) => {
        button.disabled = state.formulaFailed
            || state.figureLoading
            || state.figureFailedCount > 0
            || state.continuingGroupIds.size > 0;
        button.title = state.formulaFailed ? '存在无法渲染的公式，修复后才能导出' : '';
    });
}


Object.assign(window, {
    onConfigChange,
    generateExam,
    composeExam,
    toggleQuestion,
    toggleSelectAllQuestions,
    backToSelect,
    exportToPdf,
    exportToWord,
    formatPaperText,
    closeModal,
    saveSettings
});

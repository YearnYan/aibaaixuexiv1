// 错题专练机 - 前端应用
const API_BASE = '/api';
const SETTINGS_KEY = 'exam_settings_v5';
const RUNTIME_CONFIG_URL = `${API_BASE}/exam/runtime-config`;
const FALLBACK_MAX_UPLOAD_SIZE_BYTES = 8 * 1024 * 1024;
const FALLBACK_COUNT_LIMITS = { min: 1, max: 3 };

const state = {
    generatedQuestions: [],
    selectedQuestions: new Set(),
    currentExamData: null,
    mode: 'select',
    figureCache: new Map(),
    pendingFigures: [],
    activeGenerateToken: 0,
    activeFigureLoadToken: 0,
    figureLoading: false,
    figureFailedCount: 0,
    wrongQuestion: null,
    analysis: null,
    runtimeConfig: null,
    savedQuestionTypes: [],
    savedQuestionTypeCounts: {},
    lastPreviewTitle: '',
    lastPreviewGroups: null
};

const scriptPromiseCache = new Map();
let pdfJsReadyPromise = null;

const PDF_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
const PDF_JS_WORKER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

document.addEventListener('DOMContentLoaded', () => {
    const paperTitle = document.getElementById('paperTitle');
    const titleHint = document.getElementById('titleEditHint');
    if (paperTitle && titleHint) {
        paperTitle.addEventListener('focus', () => { titleHint.style.opacity = '0'; });
        paperTitle.addEventListener('blur', () => { titleHint.style.display = 'none'; });
    }

    bootstrapApp().catch((error) => {
        console.error('初始化失败:', error);
    });
});

async function bootstrapApp() {
    await loadRuntimeConfig();
    loadSettings();
    renderQuestionTypes();
    applyQuestionTypeCountsToInputs();
    applyAnswerVisibility();
    updateLiveOriginalPanel();

    if (typeof ensureRequestToken === 'function') {
        ensureRequestToken().catch(() => {});
    }
}

function buildFallbackRuntimeConfig() {
    const questionTypes = [];
    const defaultTypeCounts = {};
    const countValues = [];
    const typeOrders = { other: 99 };

    const rows = document.querySelectorAll('.type-count-row');
    rows.forEach((row) => {
        const label = row.querySelector('.type-count-label')?.textContent?.trim();
        const select = row.querySelector('select[id^="count_"]');
        if (!label || !select) return;

        const code = String(select.id || '').replace(/^count_/, '').trim();
        if (!code) return;

        const selectedValue = parseInt(select.value, 10);
        defaultTypeCounts[code] = Number.isFinite(selectedValue) ? selectedValue : 1;

        for (const option of Array.from(select.options)) {
            const value = parseInt(option.value, 10);
            if (Number.isFinite(value)) {
                countValues.push(value);
            }
        }

        questionTypes.push({ label, code });
        typeOrders[String(code).toLowerCase()] = questionTypes.length;
    });

    const minCount = countValues.length > 0 ? Math.min(...countValues) : FALLBACK_COUNT_LIMITS.min;
    const maxCount = countValues.length > 0 ? Math.max(...countValues) : FALLBACK_COUNT_LIMITS.max;
    const fileInput = document.getElementById('wrongQuestionFile');
    const accept = String(fileInput?.getAttribute('accept') || '');
    const allowedMimeTypes = accept
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .map((token) => {
            if (token === '.jpg') return 'image/jpeg';
            if (token === '.jpeg') return 'image/jpeg';
            if (token === '.png') return 'image/png';
            if (token === '.pdf') return 'application/pdf';
            return '';
        })
        .filter(Boolean);
    const uniqueAllowedMimeTypes = Array.from(new Set(allowedMimeTypes));

    return {
        upload: {
            maxUploadSizeBytes: FALLBACK_MAX_UPLOAD_SIZE_BYTES,
            allowedMimeTypes: uniqueAllowedMimeTypes
        },
        practice: {
            questionTypes,
            defaultTypeCounts,
            typeOrders,
            countLimits: { min: minCount, max: maxCount }
        }
    };
}

function normalizeRuntimeConfig(rawConfig) {
    const fallback = buildFallbackRuntimeConfig();
    if (!rawConfig || typeof rawConfig !== 'object') return fallback;

    const uploadConfig = rawConfig.upload && typeof rawConfig.upload === 'object'
        ? rawConfig.upload
        : {};
    const practiceConfig = rawConfig.practice && typeof rawConfig.practice === 'object'
        ? rawConfig.practice
        : {};

    const questionTypes = Array.isArray(practiceConfig.questionTypes)
        ? practiceConfig.questionTypes
            .map((item) => ({
                label: String(item?.label || '').trim(),
                code: String(item?.code || '').trim()
            }))
            .filter((item) => item.label && item.code)
        : [];

    const normalizedQuestionTypes = questionTypes.length > 0
        ? questionTypes
        : fallback.practice.questionTypes;

    const countLimitsRaw = practiceConfig.countLimits && typeof practiceConfig.countLimits === 'object'
        ? practiceConfig.countLimits
        : {};
    const minCount = Number.isFinite(parseInt(countLimitsRaw.min, 10))
        ? parseInt(countLimitsRaw.min, 10)
        : fallback.practice.countLimits.min;
    const maxCount = Number.isFinite(parseInt(countLimitsRaw.max, 10))
        ? parseInt(countLimitsRaw.max, 10)
        : fallback.practice.countLimits.max;
    const normalizedMinCount = Math.min(minCount, maxCount);
    const normalizedMaxCount = Math.max(minCount, maxCount);

    const defaultTypeCounts = {};
    const rawDefaultTypeCounts = practiceConfig.defaultTypeCounts && typeof practiceConfig.defaultTypeCounts === 'object'
        ? practiceConfig.defaultTypeCounts
        : {};

    for (const item of normalizedQuestionTypes) {
        const parsed = parseInt(rawDefaultTypeCounts[item.code], 10);
        const fallbackValue = fallback.practice.defaultTypeCounts[item.code] ?? normalizedMinCount;
        const rawValue = Number.isFinite(parsed) ? parsed : fallbackValue;
        defaultTypeCounts[item.code] = Math.min(normalizedMaxCount, Math.max(normalizedMinCount, rawValue));
    }

    const allowedMimeTypes = Array.isArray(uploadConfig.allowedMimeTypes)
        ? uploadConfig.allowedMimeTypes
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        : [];

    const maxUploadSizeBytesParsed = parseInt(uploadConfig.maxUploadSizeBytes, 10);
    const maxUploadSizeBytes = Number.isFinite(maxUploadSizeBytesParsed) && maxUploadSizeBytesParsed > 0
        ? maxUploadSizeBytesParsed
        : fallback.upload.maxUploadSizeBytes;

    const typeOrders = {};
    const typeOrdersRaw = practiceConfig.typeOrders && typeof practiceConfig.typeOrders === 'object'
        ? practiceConfig.typeOrders
        : fallback.practice.typeOrders;
    for (const [key, value] of Object.entries(typeOrdersRaw || {})) {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) continue;
        typeOrders[String(key).trim().toLowerCase()] = parsed;
    }

    return {
        upload: {
            maxUploadSizeBytes,
            allowedMimeTypes: allowedMimeTypes.length > 0
                ? allowedMimeTypes
                : fallback.upload.allowedMimeTypes
        },
        practice: {
            questionTypes: normalizedQuestionTypes,
            defaultTypeCounts,
            typeOrders,
            countLimits: {
                min: normalizedMinCount,
                max: normalizedMaxCount
            }
        }
    };
}

async function loadRuntimeConfig() {
    try {
        const resp = await fetch(RUNTIME_CONFIG_URL, {
            method: 'GET',
            cache: 'no-store',
            credentials: 'same-origin'
        });

        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();
        state.runtimeConfig = normalizeRuntimeConfig(data);
    } catch (error) {
        console.warn('获取运行配置失败，已回退到本地配置:', error.message);
        state.runtimeConfig = buildFallbackRuntimeConfig();
    }
}

function getPracticeQuestionTypes() {
    return Array.isArray(state.runtimeConfig?.practice?.questionTypes)
        ? state.runtimeConfig.practice.questionTypes
        : [];
}

function getPracticeCountLimits() {
    const limits = state.runtimeConfig?.practice?.countLimits;
    const min = Number.isFinite(parseInt(limits?.min, 10))
        ? parseInt(limits.min, 10)
        : FALLBACK_COUNT_LIMITS.min;
    const max = Number.isFinite(parseInt(limits?.max, 10))
        ? parseInt(limits.max, 10)
        : FALLBACK_COUNT_LIMITS.max;
    return {
        min: Math.min(min, max),
        max: Math.max(min, max)
    };
}

function getDefaultTypeCounts() {
    const defaults = state.runtimeConfig?.practice?.defaultTypeCounts;
    return defaults && typeof defaults === 'object' ? defaults : {};
}

function getAllowedUploadMimeTypes() {
    const uploadConfig = state.runtimeConfig?.upload;
    if (Array.isArray(uploadConfig?.allowedMimeTypes) && uploadConfig.allowedMimeTypes.length > 0) {
        return uploadConfig.allowedMimeTypes;
    }
    const fallback = buildFallbackRuntimeConfig();
    return Array.isArray(fallback.upload?.allowedMimeTypes) ? fallback.upload.allowedMimeTypes : [];
}

function getMaxUploadSizeBytes() {
    const uploadConfig = state.runtimeConfig?.upload;
    const parsed = parseInt(uploadConfig?.maxUploadSizeBytes, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return FALLBACK_MAX_UPLOAD_SIZE_BYTES;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function renderQuestionTypes() {
    const container = document.getElementById('questionTypeContainer');
    if (!container) return;

    const practiceTypes = getPracticeQuestionTypes();
    if (practiceTypes.length === 0) {
        container.innerHTML = '<span style="color:#8892b0;font-size:12px">题型加载失败，请刷新重试</span>';
        return;
    }

    const selected = new Set(
        state.savedQuestionTypes || practiceTypes.map((item) => item.label)
    );

    container.innerHTML = '';
    practiceTypes.forEach((item) => {
        const tag = document.createElement('span');
        tag.className = 'qtype-tag';
        if (selected.has(item.label)) {
            tag.classList.add('active');
        }
        tag.textContent = item.label;
        tag.dataset.type = item.label;
        tag.onclick = () => {
            tag.classList.toggle('active');
            saveSettings();
        };
        container.appendChild(tag);
    });
}

function getSelectedQuestionTypes() {
    const tags = document.querySelectorAll('#questionTypeContainer .qtype-tag.active');
    return Array.from(tags).map((tag) => tag.dataset.type).filter(Boolean);
}

function clampTypeCount(value) {
    const limits = getPracticeCountLimits();
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        const defaults = getDefaultTypeCounts();
        const firstDefault = parseInt(Object.values(defaults)[0], 10);
        if (Number.isFinite(firstDefault)) {
            return Math.min(limits.max, Math.max(limits.min, firstDefault));
        }
        return Math.min(limits.max, Math.max(limits.min, 1));
    }
    return Math.min(limits.max, Math.max(limits.min, parsed));
}

function normalizeQuestionTypeCounts(raw) {
    const practiceTypes = getPracticeQuestionTypes();
    const defaultTypeCounts = getDefaultTypeCounts();
    const counts = {};
    for (const item of practiceTypes) {
        counts[item.code] = clampTypeCount(defaultTypeCounts[item.code]);
    }

    if (!raw || typeof raw !== 'object') return counts;

    for (const item of practiceTypes) {
        counts[item.code] = clampTypeCount(raw[item.code]);
    }
    return counts;
}

function applyQuestionTypeCountsToInputs() {
    const counts = normalizeQuestionTypeCounts(state.savedQuestionTypeCounts);
    state.savedQuestionTypeCounts = counts;
    const limits = getPracticeCountLimits();

    for (const item of getPracticeQuestionTypes()) {
        const el = document.getElementById(`count_${item.code}`);
        if (!el) continue;
        el.min = String(limits.min);
        el.max = String(limits.max);
        el.value = String(counts[item.code]);
    }
}

function getQuestionTypeCounts() {
    const counts = {};
    const defaultTypeCounts = getDefaultTypeCounts();
    for (const item of getPracticeQuestionTypes()) {
        const el = document.getElementById(`count_${item.code}`);
        counts[item.code] = clampTypeCount(el?.value ?? defaultTypeCounts[item.code]);
    }
    return counts;
}

function buildSelectedTypeCounts(selectedTypes) {
    const allCounts = getQuestionTypeCounts();
    const selected = {};
    const defaultTypeCounts = getDefaultTypeCounts();
    const practiceTypes = getPracticeQuestionTypes();

    selectedTypes.forEach((label) => {
        const type = practiceTypes.find((item) => item.label === label);
        if (!type) return;
        selected[type.code] = allCounts[type.code] || clampTypeCount(defaultTypeCounts[type.code]);
    });

    return selected;
}

function setUploadStatus(text, status = '') {
    const el = document.getElementById('uploadStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('ok', 'error');
    if (status === 'ok') el.classList.add('ok');
    if (status === 'error') el.classList.add('error');
}

function renderWrongQuestionPreview(url) {
    const container = document.getElementById('wrongQuestionPreview');
    if (!container) return;

    if (!url) {
        container.classList.remove('show');
        container.innerHTML = '';
        return;
    }

    container.classList.add('show');
    container.innerHTML = `<img src="${url}" alt="上传错题预览">`;
}

function renderAnalysisResult() {
    const panel = document.getElementById('analysisResult');
    if (!panel) return;

    if (!state.analysis) {
        panel.style.display = 'none';
        return;
    }

    const toListText = (list) => {
        if (!Array.isArray(list) || list.length === 0) return '未识别到';
        return list.map((item) => `• ${escapeHtml(item)}`).join('<br>');
    };

    const knowledgeEl = document.getElementById('analysisKnowledgePoints');
    const examEl = document.getElementById('analysisExamPoints');
    const answerEl = document.getElementById('analysisAnswer');

    if (knowledgeEl) knowledgeEl.innerHTML = toListText(state.analysis.knowledgePoints);
    if (examEl) examEl.innerHTML = toListText(state.analysis.examPoints);
    if (answerEl) answerEl.textContent = state.analysis.answerAnalysis || '未识别到';
    if (window.HZQ && typeof window.HZQ.normalizeRenderedResults === 'function') {
        window.HZQ.normalizeRenderedResults(panel);
    }

    panel.style.display = 'block';
}

async function consumeUnifiedCredit() {
    if (window.HZQ && typeof window.HZQ.checkCredit === 'function') {
        return window.HZQ.checkCredit();
    }
    return true;
}

async function handleWrongQuestionUpload(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return;

    if (inputEl.files.length > 1) {
        alert('只可以上传1道错题，定制化专练。');
        inputEl.value = '';
        return;
    }

    const allowedMimeTypes = getAllowedUploadMimeTypes();
    if (!allowedMimeTypes.length) {
        alert('上传配置加载失败，请刷新后重试');
        inputEl.value = '';
        return;
    }
    const isAllowedType = allowedMimeTypes.includes(file.type);
    if (!isAllowedType) {
        alert(`仅支持 ${allowedMimeTypes.map((type) => type.replace('image/', '').replace('application/', '').toUpperCase()).join('/')} 格式`);
        inputEl.value = '';
        return;
    }

    const maxUploadSizeBytes = getMaxUploadSizeBytes();
    if (file.size > maxUploadSizeBytes) {
        alert(`上传文件过大，请控制在 ${formatBytes(maxUploadSizeBytes)} 以内`);
        inputEl.value = '';
        return;
    }

    setUploadStatus('正在解析错题，请稍候...');
    setGenerateButtonLoading(true, '正在解析错题...');

    try {
        const prepared = await prepareWrongQuestionAsset(file);
        if (!prepared.previewImageUrl) {
            throw new Error('未能提取可识别的题目图片');
        }

        if (!(await consumeUnifiedCredit())) {
            inputEl.value = '';
            setUploadStatus('已取消解析。');
            return;
        }

        const resp = await apiFetch(`${API_BASE}/exam/analyze-wrong-question`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileName: file.name,
                mimeType: file.type,
                previewImageUrl: prepared.previewImageUrl,
                extractedText: prepared.extractedText || ''
            })
        });

        const data = await readJsonResponse(resp, '解析失败');
        if (!resp.ok) {
            throw new Error(data.error || '解析失败');
        }
        state.wrongQuestion = {
            fileName: file.name,
            mimeType: file.type,
            previewImageUrl: prepared.previewImageUrl
        };
        state.analysis = normalizeAnalysisResult(data);

        renderWrongQuestionPreview(state.wrongQuestion.previewImageUrl);
        renderAnalysisResult();
        updateLiveOriginalPanel();
        setUploadStatus('错题解析完成，可直接生成题目', 'ok');
    } catch (error) {
        console.error('错题解析失败:', error);
        state.wrongQuestion = null;
        state.analysis = null;
        renderWrongQuestionPreview('');
        renderAnalysisResult();
        updateLiveOriginalPanel();
        setUploadStatus(`解析失败：${error.message}`, 'error');
    } finally {
        setGenerateButtonLoading(false);
    }
}

function normalizeAnalysisResult(data) {
    const normalizeList = (list) => {
        if (!Array.isArray(list)) return [];
        return list
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 8);
    };

    return {
        knowledgePoints: normalizeList(data.knowledgePoints),
        examPoints: normalizeList(data.examPoints),
        answerAnalysis: String(data.answerAnalysis || '').trim(),
        hasFigure: Boolean(data.hasFigure),
        subject: String(data.subject || '').trim(),
        grade: String(data.grade || '').trim(),
        originalQuestionText: String(data.originalQuestionText || '').trim()
    };
}

async function prepareWrongQuestionAsset(file) {
    if (file.type === 'application/pdf') {
        return readPdfFirstPage(file);
    }

    const rawDataUrl = await readFileAsDataUrl(file);
    const compressedDataUrl = await compressImageDataUrl(rawDataUrl);
    return {
        previewImageUrl: compressedDataUrl,
        extractedText: ''
    };
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取文件失败'));
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
    const maxSide = 1600;
    const sourceMax = Math.max(img.width, img.height);
    const shouldResize = sourceMax > maxSide;
    const shouldCompress = dataUrl.length > 1_800_000;

    if (!shouldResize && !shouldCompress) return dataUrl;

    const ratio = shouldResize ? (maxSide / sourceMax) : 1;
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', 0.9);
}

async function ensurePdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;

    if (!pdfJsReadyPromise) {
        pdfJsReadyPromise = loadScript(PDF_JS_CDN).then(() => {
            if (!window.pdfjsLib) throw new Error('PDF解析库加载失败');
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_JS_WORKER_CDN;
            return window.pdfjsLib;
        });
    }

    return pdfJsReadyPromise;
}

async function readPdfFirstPage(file) {
    const pdfjsLib = await ensurePdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.7 });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    let extractedText = '';
    try {
        const textContent = await page.getTextContent();
        extractedText = textContent.items
            .map((item) => String(item.str || '').trim())
            .filter(Boolean)
            .join(' ')
            .slice(0, 4000);
    } catch (e) {
        extractedText = '';
    }

    try {
        pdf.cleanup();
        await pdf.destroy();
    } catch (e) {
        // 忽略销毁异常
    }

    return {
        previewImageUrl: canvas.toDataURL('image/png'),
        extractedText
    };
}

function setGenerateButtonLoading(isLoading, text = '') {
    const btn = document.getElementById('generateBtn');
    if (!btn) return;
    const label = btn.querySelector('span') || btn;
    btn.disabled = !!isLoading;
    btn.classList.toggle('is-loading', !!isLoading);
    label.textContent = text || (isLoading ? '正在生成试卷...' : '⚡ 生成题目');
}

function updateFigureProgressBanner(done, total, failed = 0, active = true) {
    const composeBtn = document.getElementById('composeBtn');
    const composeBar = document.getElementById('composeBar');
    let composeTip = document.getElementById('figureStatusTip');
    if (!composeTip && composeBar) {
        composeTip = document.createElement('span');
        composeTip.id = 'figureStatusTip';
        composeTip.className = 'compose-tip';
        const btn = document.getElementById('composeBtn');
        composeBar.insertBefore(composeTip, btn || null);
    }

    state.figureLoading = active;
    state.figureFailedCount = failed;

    if (composeTip && total > 0) {
        if (active) {
            composeTip.textContent = `正在生成图形 ${done}/${total}，质量优先，请耐心等待`;
        } else if (failed > 0) {
            composeTip.textContent = `有 ${failed} 个图形尚未成功生成，请重新生成题目或稍后重试`;
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

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGenerateStatus(status) {
    return [408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 523, 524].includes(Number(status));
}

function isRetryableGenerateError(message) {
    const text = String(message || '').toLowerCase();
    if (!text) return false;
    return [
        'timeout',
        'timed out',
        'network',
        'bad gateway',
        'gateway timeout',
        'service unavailable',
        'unexpected token',
        'failed to fetch'
    ].some((keyword) => text.includes(keyword));
}

function pickGenerateErrorMessage(parsedBody, rawText, fallback = '生成失败') {
    const candidates = [
        parsedBody?.error,
        parsedBody?.message,
        parsedBody?.detail
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            const value = candidate.trim();
            if (/<!doctype html/i.test(value) || /<html[\s>]/i.test(value)) {
                return '生成服务暂时繁忙，请稍后重试（系统已自动降级请求）';
            }
            return value;
        }
    }
    const text = String(rawText || '').replace(/\s+/g, ' ').trim();
    if (text) {
        if (/<!doctype html/i.test(text) || /<html[\s>]/i.test(text)) {
            return '生成服务暂时繁忙，请稍后重试（系统已自动降级请求）';
        }
        return text.slice(0, 140);
    }
    return fallback;
}

function normalizeSourceQuestionImageForGenerate(dataUrl) {
    const text = String(dataUrl || '').trim();
    if (!text) return '';
    // 生成阶段固定走文本模式，避免边缘层/WAF 拦截 dataURL 导致整单失败。
    return '';
}

async function readGenerateResponse(resp) {
    const rawText = await resp.text();
    if (!rawText) return { parsedBody: null, rawText: '' };
    try {
        return { parsedBody: JSON.parse(rawText), rawText };
    } catch {
        return { parsedBody: null, rawText };
    }
}

async function readJsonResponse(resp, fallback = '请求失败') {
    const rawText = await resp.text();
    if (!rawText) return {};
    try {
        return JSON.parse(rawText);
    } catch {
        const text = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 180);
        return {
            error: /<!doctype html/i.test(text) || /<html[\s>]/i.test(text)
                ? `服务端返回网页错误页（HTTP ${resp.status}），请稍后重试。`
                : (text || fallback)
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

async function requestGenerateExam(payload, maxAttempts = 3) {
    let lastError = '生成失败';

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const isLastAttempt = attempt >= maxAttempts - 1;
        try {
            const resp = await apiFetch(`${API_BASE}/exam/generate`, {
                method: 'POST',
                headers: withUsageHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(payload)
            });

            const { parsedBody, rawText } = await readGenerateResponse(resp);
            if (!resp.ok) {
                lastError = pickGenerateErrorMessage(parsedBody, rawText, '生成失败');
                if (!isLastAttempt && isRetryableGenerateStatus(resp.status)) {
                    await delay(900 * (attempt + 1));
                    continue;
                }
                throw new Error(lastError);
            }

            if (!parsedBody || typeof parsedBody !== 'object') {
                lastError = pickGenerateErrorMessage(parsedBody, rawText, '生成接口返回格式异常');
                if (!isLastAttempt) {
                    await delay(700 * (attempt + 1));
                    continue;
                }
                throw new Error(lastError);
            }

            return parsedBody;
        } catch (error) {
            lastError = String(error?.message || '生成失败');
            if (!isLastAttempt && isRetryableGenerateError(lastError)) {
                await delay(900 * (attempt + 1));
                continue;
            }
            throw new Error(lastError);
        }
    }

    throw new Error(lastError);
}

async function generateExam() {
    if (!state.analysis || !state.wrongQuestion) {
        alert('请先上传并解析1道错题');
        return;
    }

    const selectedQuestionTypes = getSelectedQuestionTypes();
    if (selectedQuestionTypes.length === 0) {
        alert('请至少选择一种题型');
        return;
    }

    const questionTypeCounts = buildSelectedTypeCounts(selectedQuestionTypes);
    const totalQuestionCount = Object.values(questionTypeCounts).reduce((sum, current) => sum + current, 0);
    if (totalQuestionCount <= 0) {
        alert('请设置题目数量');
        return;
    }

    if (!(await consumeUnifiedCredit())) return;

    state.activeGenerateToken = Date.now();
    const requestToken = state.activeGenerateToken;

    const loadingEl = document.getElementById('loading');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingSubtitle = document.getElementById('loadingSubtitle');
    const fakeProgressBar = document.getElementById('fakeProgressBar');
    const fakeProgressText = document.getElementById('fakeProgressText');

    const loadingMessages = [
        { title: '正在生成题目...', subtitle: '正在读取错题解析结果' },
        { title: '正在生成题目...', subtitle: '正在按题型构造相似题与变式题' },
        { title: '正在生成题目...', subtitle: '正在补全答案与解析' },
        { title: '正在生成题目...', subtitle: '正在整理试卷结构' }
    ];

    let messageIndex = 0;
    let fakeProgress = 0;

    loadingEl.style.display = 'flex';
    setGenerateButtonLoading(true, '正在生成题目...');
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
        const progressText = `${fakeProgress}%`;
        if (fakeProgressBar) fakeProgressBar.style.width = progressText;
        if (fakeProgressText) fakeProgressText.textContent = progressText;
    }, 1000);

    switchToSelectMode();
    updateFigureProgressBanner(0, 0, 0, false);

    try {
        const data = await requestGenerateExam({
            subject: state.analysis.subject,
            grade: state.analysis.grade,
            knowledgePoints: state.analysis.knowledgePoints,
            examPoints: state.analysis.examPoints,
            answerAnalysis: state.analysis.answerAnalysis,
            sourceQuestionText: state.analysis.originalQuestionText,
            sourceQuestionImage: normalizeSourceQuestionImageForGenerate(state.wrongQuestion.previewImageUrl),
            hasFigure: state.analysis.hasFigure,
            questionTypes: selectedQuestionTypes,
            questionTypeCounts,
            questionCount: totalQuestionCount
        });
        if (requestToken !== state.activeGenerateToken) return;

        if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
            state.currentExamData = data;
            renderQuestionCards(data, requestToken);
        } else if (data.error) {
            alert('生成失败：' + data.error);
        } else {
            alert('生成结果格式异常，请重试');
        }
    } catch (e) {
        console.error('生成题目异常:', e);
        alert('生成失败：' + e.message);
    } finally {
        clearInterval(messageInterval);
        clearInterval(fakeProgressInterval);
        if (requestToken === state.activeGenerateToken) {
            loadingEl.style.display = 'none';
            setGenerateButtonLoading(false);
        }
    }
}

function renderQuestionCards(data, figureLoadToken = Date.now()) {
    const container = document.getElementById('selectMode');
    const composeBar = document.getElementById('composeBar');
    let html = '';
    let globalIndex = 0;

    state.generatedQuestions = [];
    state.selectedQuestions.clear();
    state.figureCache.clear();
    state.activeFigureLoadToken = figureLoadToken;
    state.pendingFigures = [];

    const figureSubject = state.analysis?.subject || data?.metadata?.subject || '数学';

    if (data.questions && Array.isArray(data.questions)) {
        for (const group of data.questions) {
            if (!group || !Array.isArray(group.items)) continue;
            html += `<div class="group-header">${escapeHtml(group.title || '')}</div>`;
            for (const item of group.items) {
                if (!item) continue;
                const idx = globalIndex++;
                state.generatedQuestions.push({ ...item, groupType: group.type, groupTitle: group.title });

                html += `<div class="question-card" data-idx="${idx}" onclick="toggleQuestion(${idx})">`;
                html += '<div class="select-check"></div>';
                html += `<div class="q-stem">${item.index || ''}. ${escapeHtml(item.stem || '')}</div>`;

                if (Array.isArray(item.options) && item.options.length > 0) {
                    html += `<div class="q-options">${item.options.filter(Boolean).map((opt) => `<div class="q-option">${escapeHtml(opt)}</div>`).join('')}</div>`;
                }

                if (item.figure) {
                    const figId = `fig_${idx}_${Date.now()}`;
                    html += `<div class="q-figure q-figure-loading" id="${figId}" style="min-height:60px;border:1px dashed #ddd;padding:10px;text-align:center;border-radius:4px;background:#fafafa">`;
                    html += '<span style="color:#999;font-size:12px">图形排队中...</span>';
                    html += '</div>';
                    state.pendingFigures.push({
                        id: figId,
                        qIdx: idx,
                        figure: item.figure,
                        stem: item.stem || '',
                        subject: figureSubject
                    });
                }

                html += '</div>';
            }
        }
    }

    container.innerHTML = html;
    if (window.HZQ && typeof window.HZQ.normalizeRenderedResults === 'function') {
        window.HZQ.normalizeRenderedResults(container);
    }
    composeBar.style.display = 'flex';
    updateSelectedCount();
    loadFiguresAsync(figureLoadToken);
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
            await new Promise((resolve) => setTimeout(resolve, 600 * (retryCount + 1)));
            return loadSingleFigure(fig, figureLoadToken, retryCount + 1);
        }
    }

    if (figureLoadToken !== state.activeFigureLoadToken) return false;
    const lastEl = document.getElementById(fig.id);
    if (lastEl) {
        lastEl.innerHTML = '<span style="color:#b45309;font-size:12px">图形暂未生成成功，请重新生成本题或稍后重试。</span>';
        lastEl.style.display = '';
        lastEl.style.border = '1px dashed #f59e0b';
        lastEl.style.background = '#fffbeb';
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
            figureType: typeof figure === 'object' ? (figure.type || '') : '',
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
        const resp = await apiFetch(`${API_BASE}/render/figure`, {
            method: 'POST',
            headers: withUsageHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ figures: payloadFigures })
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (figureLoadToken !== state.activeFigureLoadToken) return { done: 0, failed: 0 };

        const results = Array.isArray(data.results) ? data.results : [];
        const resultMap = new Map(results.map((item) => [item.id, item]));
        let done = 0;
        const failedFigures = [];

        for (const fig of figures) {
            const result = resultMap.get(fig.id);
            if (applyFigureResult(fig, result)) {
                done += 1;
            } else {
                failedFigures.push(fig);
            }
        }

        if (failedFigures.length > 0 && retryCount < 2) {
            await new Promise((resolve) => setTimeout(resolve, 900 * (retryCount + 1)));
            const retryResult = await loadFigureBatch(failedFigures, figureLoadToken, retryCount + 1);
            return {
                done: done + retryResult.done,
                failed: retryResult.failed
            };
        }

        for (const fig of failedFigures) {
            const el = document.getElementById(fig.id);
            if (el) {
                el.innerHTML = '<span style="color:#b45309;font-size:12px">图形暂未生成成功，请重新生成本题或稍后重试。</span>';
                el.style.display = '';
                el.style.border = '1px dashed #f59e0b';
                el.style.background = '#fffbeb';
            }
        }

        return { done: done + failedFigures.length, failed: failedFigures.length };
    } catch (e) {
        if (retryCount < 2) {
            await new Promise((resolve) => setTimeout(resolve, 900 * (retryCount + 1)));
            return loadFigureBatch(figures, figureLoadToken, retryCount + 1);
        }

        for (const fig of figures) {
            const el = document.getElementById(fig.id);
            if (el) {
                el.innerHTML = '<span style="color:#b45309;font-size:12px">图形暂未生成成功，请重新生成本题或稍后重试。</span>';
                el.style.display = '';
                el.style.border = '1px dashed #f59e0b';
                el.style.background = '#fffbeb';
            }
        }
        return { done: figures.length, failed: figures.length };
    }
}

async function loadFiguresAsync(figureLoadToken) {
    if (!state.pendingFigures || state.pendingFigures.length === 0) {
        updateFigureProgressBanner(0, 0, 0, false);
        return;
    }
    if (figureLoadToken !== state.activeFigureLoadToken) return;

    const figures = state.pendingFigures;
    state.pendingFigures = [];

    const total = figures.length;
    let done = 0;
    let failed = 0;
    const batchSize = 3;

    updateFigureProgressBanner(done, total, failed, true);

    for (let index = 0; index < figures.length; index += batchSize) {
        if (figureLoadToken !== state.activeFigureLoadToken) return;
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
}

function toggleQuestion(idx) {
    if (state.selectedQuestions.has(idx)) state.selectedQuestions.delete(idx);
    else state.selectedQuestions.add(idx);

    const card = document.querySelector(`.question-card[data-idx="${idx}"]`);
    if (card) card.classList.toggle('selected');
    updateSelectedCount();
}

function selectAllQuestions() {
    if (!Array.isArray(state.generatedQuestions) || state.generatedQuestions.length === 0) return;

    const selectableIndices = state.generatedQuestions
        .map((question, idx) => (question ? idx : null))
        .filter(idx => idx !== null);
    const shouldClear = selectableIndices.length > 0
        && selectableIndices.every(idx => state.selectedQuestions.has(idx));

    if (shouldClear) {
        state.selectedQuestions.clear();
    } else {
        selectableIndices.forEach(idx => state.selectedQuestions.add(idx));
    }

    document.querySelectorAll('.question-card[data-idx]').forEach((card) => {
        const idx = Number(card.getAttribute('data-idx'));
        card.classList.toggle('selected', !shouldClear && state.selectedQuestions.has(idx));
    });
    updateSelectedCount();
}

function updateSelectedCount() {
    const count = state.selectedQuestions.size;
    document.getElementById('selectedCount').textContent = count;
    document.getElementById('composeBtn').disabled = count === 0 || state.figureLoading || state.figureFailedCount > 0;
}

function composeExam() {
    if (state.selectedQuestions.size === 0) {
        alert('请至少选择一道题目');
        return;
    }
    if (state.figureLoading) {
        alert('图形仍在生成中。为保证准确性，请等待所有图形生成完成后再组卷。');
        return;
    }
    if (state.figureFailedCount > 0) {
        alert('仍有图形未成功生成。为保证试卷质量，请重新生成题目或稍后重试。');
        return;
    }

    const missingFigureItems = Array.from(state.selectedQuestions)
        .map((idx) => ({ idx, item: state.generatedQuestions[idx] }))
        .filter(({ idx, item }) => item?.figure && !state.figureCache.has(idx));
    if (missingFigureItems.length > 0) {
        alert('所选题目中仍有图形未生成完成，请等待后再组卷。');
        return;
    }

    const selectedIndices = Array.from(state.selectedQuestions).sort((a, b) => a - b);

    const groups = {};
    selectedIndices.forEach((idx) => {
        const q = state.generatedQuestions[idx];
        if (!q) return;

        const type = q.groupType || 'other';
        if (!groups[type]) {
            groups[type] = {
                title: q.groupTitle,
                items: [],
                order: getTypeOrder(type)
            };
        }
        groups[type].items.push({ ...q, originalIdx: idx });
    });

    const sortedGroups = Object.entries(groups).sort((a, b) => a[1].order - b[1].order);

    let num = 1;
    sortedGroups.forEach(([, group]) => {
        group.items.forEach((item) => { item.index = num++; });
    });

    const groupsObj = Object.fromEntries(sortedGroups);
    const previewTitle = state.currentExamData?.title || '错题专练试卷';
    state.lastPreviewTitle = previewTitle;
    state.lastPreviewGroups = groupsObj;

    renderExamPreview(previewTitle, groupsObj);
    switchToPreviewMode();
}

function normalizeQuestionType(type) {
    const text = String(type || '').toLowerCase();
    if (text.includes('相似') || text.includes('similar')) return 'similar';
    if (text.includes('变式') || text.includes('variant')) return 'variant';
    if (text.includes('综合应用') || text.includes('application')) return 'application';
    if (text.includes('choice') || text.includes('选择')) return 'choice';
    if (text.includes('fill') || text.includes('blank') || text.includes('填空')) return 'blank';
    if (text.includes('calculation') || text.includes('qa') || text.includes('解答') || text.includes('计算')) return 'qa';
    return 'other';
}

function getTypeOrder(type) {
    const normalized = normalizeQuestionType(type);
    const typeOrders = state.runtimeConfig?.practice?.typeOrders;
    if (typeOrders && typeof typeOrders === 'object') {
        const explicit = parseInt(typeOrders[normalized], 10);
        if (Number.isFinite(explicit)) return explicit;
        const original = parseInt(typeOrders[String(type || '').trim().toLowerCase()], 10);
        if (Number.isFinite(original)) return original;
        const fallback = parseInt(typeOrders.other, 10);
        if (Number.isFinite(fallback)) return fallback;
    }
    return 999;
}

function buildOriginalQuestionHtml() {
    if (!state.wrongQuestion?.previewImageUrl) return '';
    const showOriginal = document.getElementById('showOriginal')?.checked;
    if (!showOriginal) return '';

    return `
        <div class="original-question-block">
            <div class="group-title">原题展示</div>
            <div class="original-question-image">
                <img src="${state.wrongQuestion.previewImageUrl}" alt="原题图片">
            </div>
        </div>
    `;
}

function renderExamPreview(title, groups) {
    const titleHint = document.getElementById('titleEditHint');
    if (titleHint) {
        titleHint.style.display = '';
        titleHint.style.opacity = '1';
    }

    document.getElementById('paperTitle').textContent = title;
    let html = buildOriginalQuestionHtml();

    for (const [, group] of Object.entries(groups)) {
        if (!group || !group.items || group.items.length === 0) continue;

        html += `<div class="question-group"><div class="group-title">${escapeHtml(group.title || '')}</div>`;

        for (const item of group.items) {
            if (!item) continue;

            html += `<div class="question-item"><div class="q-stem">${item.index}. ${escapeHtml(item.stem || '')}</div>`;

            if (Array.isArray(item.options) && item.options.length > 0) {
                html += `<div class="q-options">${item.options.filter(Boolean).map((opt) => `<div class="q-option">${escapeHtml(opt)}</div>`).join('')}</div>`;
            }

            if (item.figure) {
                const cachedSvg = state.figureCache.get(item.originalIdx);
                if (cachedSvg) {
                    html += `<div class="q-figure" style="text-align:center">${cachedSvg}</div>`;
                }
            }

            html += '</div>';
        }
        html += '</div>';
    }

    const examContent = document.getElementById('examContent');
    if (!examContent) return;

    examContent.innerHTML = html;
    if (window.HZQ && typeof window.HZQ.normalizeRenderedResults === 'function') {
        window.HZQ.normalizeRenderedResults(examContent);
    }

    if (state.currentExamData?.answers) {
        const indices = [...state.selectedQuestions].sort((a, b) => a - b);
        const answers = indices.map((idx, i) => {
            const orig = state.currentExamData.answers[idx];
            return orig ? `${i + 1}. ${String(orig).replace(/^\d+\.\s*/, '')}` : '';
        }).filter(Boolean);

        document.getElementById('answerContent').innerHTML = answers.map((a) => `<div>${escapeHtml(a)}</div>`).join('<br>');
        if (window.HZQ && typeof window.HZQ.normalizeRenderedResults === 'function') {
            window.HZQ.normalizeRenderedResults(document.getElementById('answerContent'));
        }
    }

    applyAnswerVisibility();
}

function updateLiveOriginalPanel() {
    const panel = document.getElementById('liveOriginalPanel');
    const img = document.getElementById('liveOriginalImage');
    if (!panel || !img) return;

    const showOriginal = document.getElementById('showOriginal')?.checked ?? true;
    const imageUrl = state.wrongQuestion?.previewImageUrl || '';
    const shouldShow = state.mode !== 'preview' && showOriginal && !!imageUrl;

    if (!shouldShow) {
        panel.classList.remove('show');
        img.removeAttribute('src');
        return;
    }

    img.src = imageUrl;
    panel.classList.add('show');
}

function handleShowOriginalChange() {
    saveSettings();
    updateLiveOriginalPanel();

    if (state.mode === 'preview' && state.lastPreviewGroups) {
        renderExamPreview(state.lastPreviewTitle || '错题专练试卷', state.lastPreviewGroups);
    }
}

function applyAnswerVisibility() {
    const showAnswerCheckbox = document.getElementById('showAnswer');
    const answerArea = document.getElementById('answerArea');
    if (!showAnswerCheckbox || !answerArea) return;
    answerArea.style.display = showAnswerCheckbox.checked ? 'block' : 'none';
}

function switchToSelectMode() {
    state.mode = 'select';
    document.getElementById('selectMode').style.display = 'block';
    document.getElementById('paper').classList.remove('show');
    document.getElementById('downloadBar').classList.remove('show');
    updateLiveOriginalPanel();
}

function switchToPreviewMode() {
    state.mode = 'preview';
    document.getElementById('selectMode').style.display = 'none';
    document.getElementById('composeBar').style.display = 'none';
    const paper = document.getElementById('paper');
    paper.classList.add('show');
    document.getElementById('downloadBar').classList.add('show');
    updateLiveOriginalPanel();
}

function backToSelect() {
    switchToSelectMode();
    if (state.generatedQuestions.length > 0) {
        document.getElementById('composeBar').style.display = 'flex';
    }
}

function createPdfExportPage() {
    const page = document.createElement('section');
    page.className = 'pdf-export-page';
    return page;
}

function appendNodeToPdfPage(root, currentPage, node, pageHeight) {
    currentPage.appendChild(node);

    if (currentPage.scrollHeight <= pageHeight + 2 || currentPage.children.length <= 1) {
        if (currentPage.scrollHeight > pageHeight + 2) {
            const expandedHeight = `${Math.ceil(currentPage.scrollHeight)}px`;
            currentPage.style.height = expandedHeight;
            currentPage.style.minHeight = expandedHeight;
        }
        return currentPage;
    }

    node.remove();
    const nextPage = createPdfExportPage();
    root.appendChild(nextPage);
    nextPage.appendChild(node);
    if (nextPage.scrollHeight > pageHeight + 2) {
        const expandedHeight = `${Math.ceil(nextPage.scrollHeight)}px`;
        nextPage.style.height = expandedHeight;
        nextPage.style.minHeight = expandedHeight;
    }
    return nextPage;
}

function appendGroupToPdfPages(root, currentPage, group, pageHeight) {
    const children = Array.from(group.children);
    const groupTitle = children.find((child) => child.classList.contains('group-title'));
    const questionItems = children.filter((child) => child.classList.contains('question-item'));
    const otherChildren = children.filter((child) => child !== groupTitle && !child.classList.contains('question-item'));

    if (groupTitle && questionItems.length > 0) {
        const titleClone = groupTitle.cloneNode(true);
        const firstQuestionClone = questionItems[0].cloneNode(true);
        currentPage.appendChild(titleClone);
        currentPage.appendChild(firstQuestionClone);

        if (currentPage.scrollHeight > pageHeight + 2 && currentPage.children.length > 2) {
            titleClone.remove();
            firstQuestionClone.remove();
            currentPage = createPdfExportPage();
            root.appendChild(currentPage);
            currentPage.appendChild(titleClone);
            currentPage.appendChild(firstQuestionClone);
        }

        if (currentPage.scrollHeight > pageHeight + 2) {
            const expandedHeight = `${Math.ceil(currentPage.scrollHeight)}px`;
            currentPage.style.height = expandedHeight;
            currentPage.style.minHeight = expandedHeight;
        }

        for (const item of questionItems.slice(1)) {
            currentPage = appendNodeToPdfPage(root, currentPage, item.cloneNode(true), pageHeight);
        }
    } else {
        for (const child of children) {
            currentPage = appendNodeToPdfPage(root, currentPage, child.cloneNode(true), pageHeight);
        }
    }

    for (const child of otherChildren) {
        currentPage = appendNodeToPdfPage(root, currentPage, child.cloneNode(true), pageHeight);
    }

    return currentPage;
}

function appendAnswerToPdfPages(root, currentPage, answerArea, pageHeight) {
    if (!answerArea || getComputedStyle(answerArea).display === 'none') return currentPage;

    const heading = document.createElement('div');
    heading.className = 'answer-key pdf-answer-heading';
    const answerTitle = answerArea.querySelector('.group-title');
    heading.appendChild(answerTitle ? answerTitle.cloneNode(true) : document.createTextNode('参考答案与解析'));
    currentPage = appendNodeToPdfPage(root, currentPage, heading, pageHeight);

    const answerContent = answerArea.querySelector('#answerContent');
    if (answerContent) {
        const answerItems = Array.from(answerContent.children);
        if (answerItems.length > 0) {
            for (const item of answerItems) {
                currentPage = appendNodeToPdfPage(root, currentPage, item.cloneNode(true), pageHeight);
            }
        } else if (answerContent.textContent.trim()) {
            const fallback = document.createElement('div');
            fallback.innerHTML = answerContent.innerHTML;
            currentPage = appendNodeToPdfPage(root, currentPage, fallback, pageHeight);
        }
    }

    return currentPage;
}

function buildPdfExportRoot(paper) {
    const root = document.createElement('div');
    root.className = 'pdf-export-root';

    const style = document.createElement('style');
    style.textContent = `
.pdf-export-root { width: 210mm; background: #fff; color: #000; font-family: "SimSun","Songti SC",serif; }
.pdf-export-page { width: 210mm; height: 296mm; min-height: 296mm; box-sizing: border-box; padding: 18mm 18mm 20mm 18mm; background: #fff; color: #000; overflow: hidden; }
.pdf-export-page * { box-sizing: border-box; color: #000 !important; background: transparent !important; }
.pdf-export-page .exam-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 18px; }
.pdf-export-page .secret-mark { text-align: left; font-size: 12px; font-weight: bold; margin-bottom: 10px; }
.pdf-export-page .exam-title { font-size: 24px; font-weight: 900; margin-bottom: 15px; }
.pdf-export-page .title-edit-hint, .pdf-export-page .seal-line { display: none !important; }
.pdf-export-page .exam-info { display: flex; justify-content: center; gap: 30px; font-size: 14px; margin-bottom: 5px; white-space: nowrap; }
.pdf-export-page .group-title { font-weight: 700; font-size: 16px; margin: 0 0 10px; }
.pdf-export-page .question-item { margin: 0 0 11px; font-size: 14px; line-height: 1.5; page-break-inside: auto; break-inside: auto; }
.pdf-export-page .q-stem { font-weight: 500; margin-bottom: 4px; }
.pdf-export-page .q-options { display: flex; flex-wrap: wrap; column-gap: 18px; row-gap: 4px; margin: 2px 0 6px 20px; line-height: 1.35; }
.pdf-export-page .q-option { min-width: 20%; flex: 0 0 auto; line-height: 1.35; }
.pdf-export-page .q-figure { width: 100%; padding: 8px 0; text-align: center; overflow: visible; page-break-inside: avoid; break-inside: avoid; }
.pdf-export-page .q-figure svg, .pdf-export-page .q-figure canvas, .pdf-export-page .q-figure img { max-width: 250px; height: auto; display: block; margin: 0 auto; }
.pdf-export-page .original-question-block { border: 1px solid #ddd; border-radius: 4px; padding: 10px; margin: 0 0 12px; page-break-inside: avoid; break-inside: avoid; }
.pdf-export-page .original-question-text { margin-bottom: 8px; line-height: 1.5; }
.pdf-export-page .original-question-image { text-align: center; }
.pdf-export-page .original-question-image img { max-width: 250px; height: auto; }
.pdf-export-page .answer-key.pdf-answer-heading { display: block !important; margin: 18px 0 10px; border-top: 1px dashed #999; padding-top: 12px; }
`;
    root.appendChild(style);

    let currentPage = createPdfExportPage();
    root.appendChild(currentPage);

    const header = paper.querySelector('.exam-header');
    if (header) currentPage.appendChild(header.cloneNode(true));

    document.body.appendChild(root);
    const pageHeight = currentPage.getBoundingClientRect().height;
    const examContent = paper.querySelector('#examContent');
    if (examContent) {
        for (const child of Array.from(examContent.children)) {
            if (child.classList.contains('question-group')) {
                currentPage = appendGroupToPdfPages(root, currentPage, child, pageHeight);
            } else {
                currentPage = appendNodeToPdfPage(root, currentPage, child.cloneNode(true), pageHeight);
            }
        }
    }

    appendAnswerToPdfPages(root, currentPage, paper.querySelector('#answerArea'), pageHeight);
    return root;
}

async function exportToPdf() {
    const paper = document.getElementById('paper');
    const loadingEl = document.getElementById('loading');
    loadingEl.style.display = 'flex';
    let exportRoot = null;

    try {
        if (!window.html2pdf) {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');
        }

        const titleText = document.getElementById('paperTitle').textContent;

        const origStyle = paper.style.cssText;
        paper.style.width = '210mm';
        paper.style.minHeight = '297mm';
        paper.style.maxWidth = '210mm';
        paper.style.padding = '20mm 26mm 25mm 4mm';
        paper.style.margin = '0 auto';
        paper.style.boxShadow = 'none';
        paper.style.display = 'block';

        const sealLine = paper.querySelector('.seal-line');
        if (sealLine) sealLine.style.display = 'none';
        const hint = paper.querySelector('.title-edit-hint');
        if (hint) hint.style.display = 'none';

        const svgBackups = [];
        for (const svg of paper.querySelectorAll('svg')) {
            try {
                const vb = svg.getAttribute('viewBox');
                let w = 400;
                let h = 300;
                if (vb) {
                    const p = vb.split(/[\s,]+/);
                    w = parseFloat(p[2]) || 400;
                    h = parseFloat(p[3]) || 300;
                }
                const svgClone = svg.cloneNode(true);
                if (!svgClone.getAttribute('xmlns')) {
                    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                }
                svgClone.setAttribute('width', w);
                svgClone.setAttribute('height', h);
                const svgStr = new XMLSerializer().serializeToString(svgClone);
                const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const cvs = document.createElement('canvas');
                cvs.width = w * 2;
                cvs.height = h * 2;
                const ctx = cvs.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, cvs.width, cvs.height);
                ctx.scale(2, 2);
                const img = new Image();
                await new Promise((ok, fail) => {
                    img.onload = ok;
                    img.onerror = fail;
                    img.src = url;
                });
                ctx.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(url);
                const imgEl = document.createElement('img');
                imgEl.src = cvs.toDataURL('image/png');
                imgEl.alt = svg.getAttribute('aria-label') || '题目图形';
                imgEl.style.cssText = 'max-width:250px;height:auto;display:block;margin:8px auto';
                svgBackups.push({ svg, replacement: imgEl });
                svg.parentNode.replaceChild(imgEl, svg);
            } catch (e) {
                // 忽略单个SVG转码失败
            }
        }

        exportRoot = buildPdfExportRoot(paper);
        await new Promise((resolve) => requestAnimationFrame(resolve));

        await html2pdf().set({
            margin: [0, 0, 0, 0],
            filename: `${titleText}.pdf`,
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#fff', scrollY: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['legacy'] }
        }).from(exportRoot).save();

        svgBackups.forEach(({ svg, replacement }) => {
            try {
                if (replacement.parentNode) replacement.parentNode.replaceChild(svg, replacement);
            } catch (e) {
                // 忽略恢复失败
            }
        });
        if (sealLine) sealLine.style.display = '';
        if (hint) hint.style.display = '';
        paper.style.cssText = origStyle;
        if (exportRoot) {
            exportRoot.remove();
            exportRoot = null;
        }
    } catch (e) {
        if (exportRoot) exportRoot.remove();
        console.error('PDF导出失败:', e);
        alert('PDF导出失败，请尝试Ctrl+P打印');
    }
    loadingEl.style.display = 'none';
}

async function exportToWord() {
    const titleText = document.getElementById('paperTitle').textContent;
    const showAnswer = document.getElementById('showAnswer').checked;
    const loadingEl = document.getElementById('loading');
    loadingEl.style.display = 'flex';

    try {
        const svgImgMap = new Map();
        const svgs = document.querySelectorAll('#examContent svg, #answerContent svg');
        for (const svg of svgs) {
            try {
                const vb = svg.getAttribute('viewBox');
                let w = 400;
                let h = 300;
                if (vb) {
                    const p = vb.split(/[\s,]+/);
                    w = parseFloat(p[2]) || 400;
                    h = parseFloat(p[3]) || 300;
                }

                const svgClone = svg.cloneNode(true);
                if (!svgClone.getAttribute('xmlns')) {
                    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                }
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
                    img.src = `data:image/svg+xml;base64,${svgB64}`;
                });
                ctx.drawImage(img, 0, 0, w, h);

                const figDiv = svg.closest('.q-figure');
                if (figDiv) {
                    svgImgMap.set(figDiv, canvas.toDataURL('image/png'));
                }
            } catch (e) {
                console.warn('SVG转换失败:', e);
            }
        }

        let questionsHtml = '';
        const examContent = document.getElementById('examContent');
        for (const child of examContent.children) {
            let childHtml = child.outerHTML;
            const figDivs = child.querySelectorAll('.q-figure');
            for (const figDiv of figDivs) {
                const base64 = svgImgMap.get(figDiv);
                if (base64) {
                    const imgTag = `<p style="text-align:center;margin:10px 0"><img src="${base64}" width="200" height="auto" style="max-width:200px"></p>`;
                    childHtml = childHtml.replace(figDiv.outerHTML, imgTag);
                } else {
                    childHtml = childHtml.replace(figDiv.outerHTML, '');
                }
            }
            questionsHtml += childHtml;
        }

        let answerHtml = '';
        if (showAnswer) {
            answerHtml = document.getElementById('answerContent').innerHTML;
        }

        const wordHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${titleText}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page { size: A4; margin: 2.5cm 2cm 3cm 2cm; }
body { font-family: '宋体', SimSun, serif; font-size: 12pt; line-height: 1.8; color: #000; }
.exam-header { text-align: center; border-bottom: 2pt solid #000; padding-bottom: 8pt; margin-bottom: 16pt; }
.exam-title { font-size: 18pt; font-weight: bold; margin-bottom: 12pt; }
.secret-mark { text-align: left; font-size: 9pt; font-weight: bold; margin-bottom: 8pt; }
.exam-info { text-align: center; font-size: 12pt; margin-top: 12pt; }
.question-group { margin-bottom: 16pt; }
.group-title { font-weight: bold; font-size: 14pt; margin-bottom: 8pt; }
.question-item { margin-bottom: 12pt; font-size: 12pt; line-height: 1.8; }
.q-stem { font-weight: normal; margin-bottom: 4pt; }
.q-options { margin-left: 2em; line-height: 1.15; margin-top: 0; margin-bottom: 2pt; }
.q-option { display: inline-block; min-width: 22%; margin-right: 0.25em; line-height: 1.15; margin-bottom: 0; }
.answer-key { margin-top: 30pt; border-top: 1pt dashed #999; padding-top: 16pt; }
.answer-key .group-title { font-weight: bold; font-size: 14pt; margin-bottom: 8pt; }
</style></head>
<body>
<div class="exam-header">
<div class="secret-mark">绝密 ★ 启用前</div>
<div class="exam-title">${titleText}</div>
<div class="exam-info">姓名：____________ 班级：____________ 考号：____________</div>
</div>
${questionsHtml}
${showAnswer ? `<div class="answer-key"><div class="group-title">参考答案与解析</div>${answerHtml}</div>` : ''}
</body></html>`;

        const blob = new Blob(['\ufeff' + wordHtml], { type: 'application/msword;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${titleText}.doc`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('Word导出失败:', e);
        alert('Word导出失败: ' + e.message);
    }
    loadingEl.style.display = 'none';
}

function loadScript(src) {
    if (scriptPromiseCache.has(src)) {
        return scriptPromiseCache.get(src);
    }

    const promise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });

    scriptPromiseCache.set(src, promise);
    return promise;
}

function showContactModal() {
    const globalBtn = document.getElementById('cyberGlobalContactBtn');
    if (globalBtn) {
        globalBtn.click();
        return;
    }
    document.getElementById('contactModal').classList.add('show');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('show');
}

function saveSettings() {
    const showAnswer = document.getElementById('showAnswer')?.checked ?? true;
    const showOriginal = document.getElementById('showOriginal')?.checked ?? true;
    const questionTypes = getSelectedQuestionTypes();
    const questionTypeCounts = getQuestionTypeCounts();

    const settings = {
        showAnswer,
        showOriginal,
        questionTypes,
        questionTypeCounts
    };

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
    const defaultTypes = getPracticeQuestionTypes().map((item) => item.label);
    const defaultCounts = normalizeQuestionTypeCounts({});

    const showAnswerEl = document.getElementById('showAnswer');
    if (showAnswerEl) showAnswerEl.checked = true;

    const showOriginalEl = document.getElementById('showOriginal');
    if (showOriginalEl) showOriginalEl.checked = true;

    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) {
        state.savedQuestionTypes = defaultTypes;
        state.savedQuestionTypeCounts = defaultCounts;
        return;
    }

    try {
        const parsed = JSON.parse(saved);
        if (showAnswerEl && parsed.showAnswer !== undefined) {
            showAnswerEl.checked = !!parsed.showAnswer;
        }
        if (showOriginalEl && parsed.showOriginal !== undefined) {
            showOriginalEl.checked = !!parsed.showOriginal;
        }

        if (Array.isArray(parsed.questionTypes) && parsed.questionTypes.length > 0) {
            const allowedSet = new Set(defaultTypes);
            const filtered = parsed.questionTypes
                .map((item) => String(item || '').trim())
                .filter((item) => allowedSet.has(item));
            state.savedQuestionTypes = filtered.length > 0 ? filtered : defaultTypes;
        } else {
            state.savedQuestionTypes = defaultTypes;
        }

        state.savedQuestionTypeCounts = normalizeQuestionTypeCounts(parsed.questionTypeCounts);
    } catch (e) {
        console.error('加载设置失败', e);
        state.savedQuestionTypes = defaultTypes;
        state.savedQuestionTypeCounts = defaultCounts;
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

Object.assign(window, {
    handleWrongQuestionUpload,
    generateExam,
    composeExam,
    toggleQuestion,
    selectAllQuestions,
    backToSelect,
    exportToPdf,
    exportToWord,
    closeModal,
    saveSettings,
    handleShowOriginalChange
});

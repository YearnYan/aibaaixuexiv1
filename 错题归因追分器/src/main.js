// 错题专练机 - 前端应用
const API_BASE = '/api';
const SETTINGS_KEY = 'exam_settings_v6';
const RUNTIME_CONFIG_URL = `${API_BASE}/exam/runtime-config`;
const FALLBACK_MAX_UPLOAD_SIZE_BYTES = 8 * 1024 * 1024;
const FALLBACK_COUNT_LIMITS = { min: 1, max: 3 };
const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

const TRAINING_TYPE_META = {
    similar: {
        order: 1,
        number: 1,
        title: '基础巩固',
        groupLabel: '相似题',
        paperTitle: '基础巩固题训练卷',
        tag: '同考点巩固'
    },
    variant: {
        order: 2,
        number: 2,
        title: '能力提升',
        groupLabel: '变式题',
        paperTitle: '变式题训练卷',
        tag: '变式迁移'
    },
    application: {
        order: 3,
        number: 3,
        title: '拓展挑战',
        groupLabel: '综合应用题',
        paperTitle: '综合应用题训练卷',
        tag: '综合应用'
    }
};

const DEMO_TRAINING_CARDS = [
    {
        type: 'similar',
        stem: '如图，已知 ∠1 = 48°，直线 a ∥ b，求∠2 的度数。',
        answer: '48°',
        tag: '内错角相等',
        figure: 'parallel-basic'
    },
    {
        type: 'variant',
        stem: '如图，已知 ∠1 = 110°，直线 a ∥ b，求∠2 的度数。',
        answer: '110°',
        tag: '同位角相等',
        figure: 'parallel-variant'
    },
    {
        type: 'application',
        stem: '如图，已知直线 a ∥ b，∠1 = 70°，∠2 =？若∠3 = 40°，求∠2 的度数。',
        answer: '70°',
        tag: '综合应用',
        figure: 'parallel-application'
    }
];

const state = {
    generatedQuestions: [],
    selectedQuestions: new Set(),
    currentExamData: null,
    mode: 'select',
    figureCache: new Map(),
    pendingFigures: [],
    activeGenerateToken: 0,
    activeFigureLoadToken: 0,
    wrongQuestion: null,
    analysis: null,
    isAnalyzingWrongQuestion: false,
    autoGenerateAfterUpload: false,
    pendingGenerateAfterAnalyze: false,
    runtimeConfig: null,
    savedQuestionTypes: [],
    savedQuestionTypeCounts: {},
    lastPreviewTitle: '',
    lastPreviewGroups: null,
    lastPreviewType: ''
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
    renderResultPlaceholder();
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
            if (token === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            if (token === '.doc') return 'application/msword';
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

function getFileExtension(fileName) {
    const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
}

function isAllowedUploadFile(file, allowedMimeTypes) {
    if (!file) return false;
    if (file.type && allowedMimeTypes.includes(file.type)) return true;

    const extension = getFileExtension(file.name);
    const extensionMimeMap = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        pdf: 'application/pdf',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc: 'application/msword'
    };
    const inferredMimeType = extensionMimeMap[extension];
    return !!inferredMimeType && allowedMimeTypes.includes(inferredMimeType);
}

function resolveUploadMimeType(file) {
    if (file?.type) return file.type;
    const extension = getFileExtension(file?.name);
    const extensionMimeMap = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        pdf: 'application/pdf',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc: 'application/msword'
    };
    return extensionMimeMap[extension] || '';
}

function getDisplayUploadTypes(allowedMimeTypes) {
    const labels = [];
    if (allowedMimeTypes.includes('application/pdf')) labels.push('PDF');
    if (
        allowedMimeTypes.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
        allowedMimeTypes.includes('application/msword')
    ) labels.push('Word');
    if (allowedMimeTypes.includes('image/png')) labels.push('PNG');
    if (allowedMimeTypes.includes('image/jpeg')) labels.push('JPG');
    return labels.length ? labels.join('/') : 'PNG/JPG/PDF';
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

function renderWrongQuestionPreview(url, extractedText = '') {
    const container = document.getElementById('wrongQuestionPreview');
    if (!container) return;

    container.classList.remove('show');
    container.innerHTML = '';
}

function syncDetectedInfoToInputs() {
    if (!state.analysis) return;
    const subjectEl = document.getElementById('subjectSelect');
    const gradeEl = document.getElementById('gradeSelect');

    const selectMatchingOption = (el, value) => {
        if (!el || !value || el.value) return;
        const normalized = String(value).trim();
        const option = Array.from(el.options).find((item) => item.value === normalized);
        if (option) el.value = option.value;
    };

    selectMatchingOption(subjectEl, state.analysis.subject);
    selectMatchingOption(gradeEl, state.analysis.grade);
    saveSettings();
}

function renderAnalysisResult() {
    const panel = document.getElementById('analysisResult');
    if (!panel) return;
    panel.style.display = 'none';
    panel.innerHTML = '';
}

async function consumeUnifiedCredit() {
    if (window.HZQ && typeof window.HZQ.checkCredit === 'function') {
        return window.HZQ.checkCredit();
    }
    return true;
}

async function handleWrongQuestionUpload(inputEl, options = {}) {
    const file = inputEl?.files?.[0];
    if (!file) return;
    const shouldAutoGenerateOnSuccess = options.autoGenerate !== false;
    if (state.isAnalyzingWrongQuestion) {
        if (shouldAutoGenerateOnSuccess || state.autoGenerateAfterUpload) {
            state.pendingGenerateAfterAnalyze = true;
            setUploadStatus('正在解析错题，解析完成后会自动生成归因追分结果...');
        }
        return;
    }

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
    const resolvedMimeType = resolveUploadMimeType(file);
    const isAllowedType = isAllowedUploadFile(file, allowedMimeTypes);
    if (!isAllowedType) {
        alert(`仅支持 ${getDisplayUploadTypes(allowedMimeTypes)} 格式`);
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
    state.isAnalyzingWrongQuestion = true;
    let shouldAutoGenerate = Boolean(shouldAutoGenerateOnSuccess || state.autoGenerateAfterUpload);
    state.autoGenerateAfterUpload = false;

    try {
        const prepared = await prepareWrongQuestionAsset(file);
        if (!prepared.previewImageUrl && !prepared.extractedText) {
            throw new Error('未能提取可识别的题目内容');
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
                mimeType: resolvedMimeType,
                previewImageUrl: prepared.aiImageUrl || prepared.previewImageUrl,
                extractedText: prepared.extractedText || '',
                gradeHint: document.getElementById('gradeSelect')?.value || '',
                subjectHint: document.getElementById('subjectSelect')?.value || ''
            })
        });

        const data = await readJsonResponse(resp, '解析失败');
        if (!resp.ok) {
            throw new Error(data.error || '解析失败');
        }
        state.wrongQuestion = {
            fileName: file.name,
            mimeType: resolvedMimeType,
            previewImageUrl: prepared.previewImageUrl,
            extractedText: prepared.extractedText || ''
        };
        state.analysis = normalizeAnalysisResult(data);

        syncDetectedInfoToInputs();
        renderWrongQuestionPreview(state.wrongQuestion.previewImageUrl, state.wrongQuestion.extractedText);
        renderAnalysisResult();
        renderResultPlaceholder();
        updateLiveOriginalPanel();
        shouldAutoGenerate = shouldAutoGenerate || state.pendingGenerateAfterAnalyze;
        setUploadStatus(
            shouldAutoGenerate
                ? '错题解析完成，正在生成归因追分结果...'
                : '错题解析完成',
            'ok'
        );
    } catch (error) {
        console.error('错题解析失败:', error);
        state.wrongQuestion = null;
        state.analysis = null;
        state.pendingGenerateAfterAnalyze = false;
        shouldAutoGenerate = false;
        renderWrongQuestionPreview('');
        renderAnalysisResult();
        renderResultPlaceholder();
        updateLiveOriginalPanel();
        setUploadStatus(`解析失败：${error.message}`, 'error');
    } finally {
        state.isAnalyzingWrongQuestion = false;
        state.pendingGenerateAfterAnalyze = false;
        setGenerateButtonLoading(false);
        if (shouldAutoGenerate && state.analysis && state.wrongQuestion) {
            setGenerateButtonLoading(true, '正在生成题目...');
            setTimeout(() => generateExam(), 0);
        }
    }
}

function normalizeAnalysisResult(data) {
    const normalizeList = (list) => {
        if (!Array.isArray(list)) return [];
        return list
            .map((item) => normalizeEducationalSymbols(item).trim())
            .filter(Boolean)
            .slice(0, 8);
    };

    return {
        knowledgePoints: normalizeList(data.knowledgePoints),
        examPoints: normalizeList(data.examPoints),
        answerAnalysis: normalizeEducationalSymbols(data.answerAnalysis).trim(),
        hasFigure: Boolean(data.hasFigure),
        subject: normalizeEducationalSymbols(data.subject).trim(),
        grade: normalizeEducationalSymbols(data.grade).trim(),
        originalQuestionText: normalizeEducationalSymbols(data.originalQuestionText).trim()
    };
}

function normalizeEducationalSymbols(value) {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (!text) return '';

    const superMap = {
        '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹',
        '+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾',
        'a':'ᵃ','b':'ᵇ','c':'ᶜ','d':'ᵈ','e':'ᵉ','f':'ᶠ','g':'ᵍ','h':'ʰ','i':'ⁱ','j':'ʲ',
        'k':'ᵏ','l':'ˡ','m':'ᵐ','n':'ⁿ','o':'ᵒ','p':'ᵖ','r':'ʳ','s':'ˢ','t':'ᵗ','u':'ᵘ',
        'v':'ᵛ','w':'ʷ','x':'ˣ','y':'ʸ','z':'ᶻ',
        'A':'ᴬ','B':'ᴮ','D':'ᴰ','E':'ᴱ','G':'ᴳ','H':'ᴴ','I':'ᴵ','J':'ᴶ','K':'ᴷ','L':'ᴸ',
        'M':'ᴹ','N':'ᴺ','O':'ᴼ','P':'ᴾ','R':'ᴿ','T':'ᵀ','U':'ᵁ','V':'ⱽ','W':'ᵂ'
    };
    const subMap = {
        '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉',
        '+':'₊','-':'₋','=':'₌','(':'₍',')':'₎',
        'a':'ₐ','e':'ₑ','h':'ₕ','i':'ᵢ','j':'ⱼ','k':'ₖ','l':'ₗ','m':'ₘ','n':'ₙ','o':'ₒ',
        'p':'ₚ','r':'ᵣ','s':'ₛ','t':'ₜ','u':'ᵤ','v':'ᵥ','x':'ₓ'
    };
    const toSuperscript = (raw) => String(raw || '').split('').map((c) => superMap[c] || c).join('');
    const toSubscript = (raw) => String(raw || '').split('').map((c) => subMap[c.toLowerCase()] || c).join('');

    text = text
        .replace(/\uFEFF/g, '')
        .replace(/[\u200B-\u200D\u2060]/g, '')
        .replace(/\\\(/g, '')
        .replace(/\\\)/g, '')
        .replace(/\\\[/g, '')
        .replace(/\\\]/g, '')
        .replace(/\$\$(.*?)\$\$/gs, '$1')
        .replace(/\$(.*?)\$/gs, '$1');

    const mojibakeMap = {
        'Â°': '°', 'Ã—': '×', 'Ã·': '÷', 'Â±': '±',
        'â‰¤': '≤', 'â‰¥': '≥', 'â‰ ': '≠', 'â‰ˆ': '≈',
        'âˆš': '√', 'âˆž': '∞', 'Î±': 'α', 'Î²': 'β',
        'Î³': 'γ', 'Î¸': 'θ', 'Ï€': 'π', 'Î”': 'Δ', 'Î©': 'Ω'
    };
    Object.entries(mojibakeMap).forEach(([bad, good]) => {
        text = text.split(bad).join(good);
    });

    text = text
        .replace(/\\(?:ce|pu)\{([^}]*)\}/g, (_, content) => normalizeEducationalSymbols(content))
        .replace(/\\(?:dfrac|tfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
        .replace(/\\sqrt\[(\d+)\]\{([^{}]+)\}/g, '$1√($2)')
        .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
        .replace(/\\(?:mathrm|mathbf|mathit|mathbb|text|overline|underline)\{([^{}]*)\}/g, '$1')
        .replace(/\\(?:overrightarrow|vec)\{([^{}]+)\}/g, '→$1')
        .replace(/\\lim_\{([^{}]+)\}/g, 'lim($1)')
        .replace(/\\sum_\{([^{}]+)\}\^\{([^{}]+)\}/g, 'Σ($1到$2)')
        .replace(/\\int_\{([^{}]+)\}\^\{([^{}]+)\}/g, '∫($1到$2)')
        .replace(/\\log_\{([^{}]+)\}/g, 'log$1')
        .replace(/\^\{?\\circ\}?/g, '°')
        .replace(/\\degree/g, '°')
        .replace(/<=>|<->|\\rightleftharpoons/g, '⇌')
        .replace(/-->|->|=>|\\to|\\rightarrow/g, '→')
        .replace(/\\leftarrow/g, '←')
        .replace(/\\Rightarrow/g, '⇒')
        .replace(/\\Leftrightarrow/g, '⇔');

    const symbolMap = {
        '\\angle': '∠', '\\triangle': '△', '\\parallel': '∥', '\\perp': '⊥', '\\cong': '≅',
        '\\sim': '∽', '\\square': '□', '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ',
        '\\delta': 'δ', '\\epsilon': 'ε', '\\theta': 'θ', '\\lambda': 'λ', '\\mu': 'μ',
        '\\pi': 'π', '\\sigma': 'σ', '\\phi': 'φ', '\\omega': 'ω', '\\rho': 'ρ',
        '\\eta': 'η', '\\zeta': 'ζ', '\\xi': 'ξ', '\\tau': 'τ', '\\Delta': 'Δ',
        '\\Omega': 'Ω', '\\Sigma': 'Σ', '\\times': '×', '\\div': '÷', '\\pm': '±',
        '\\mp': '∓', '\\cdot': '·', '\\neq': '≠', '\\leq': '≤', '\\geq': '≥',
        '\\le': '≤', '\\ge': '≥', '\\approx': '≈', '\\equiv': '≡', '\\propto': '∝',
        '\\in': '∈', '\\notin': '∉', '\\subseteq': '⊆', '\\supseteq': '⊇',
        '\\subset': '⊂', '\\supset': '⊃', '\\cup': '∪', '\\cap': '∩',
        '\\emptyset': '∅', '\\varnothing': '∅', '\\forall': '∀', '\\exists': '∃',
        '\\neg': '¬', '\\land': '∧', '\\lor': '∨', '\\infty': '∞', '\\partial': '∂',
        '\\nabla': '∇', '\\therefore': '∴', '\\because': '∵', '\\sin': 'sin',
        '\\cos': 'cos', '\\tan': 'tan', '\\cot': 'cot', '\\sec': 'sec', '\\csc': 'csc',
        '\\log': 'log', '\\ln': 'ln', '\\lg': 'lg', '\\lim': 'lim', '\\max': 'max',
        '\\min': 'min', '\\ohm': 'Ω', '\\celsius': '℃', '\\circ': '°',
        '\\quad': ' ', '\\qquad': '  ', '\\,': ' ', '\\;': ' ', '\\!': '',
        '\\left': '', '\\right': '', '\\big': '', '\\Big': '', '\\{': '{', '\\}': '}'
    };
    Object.entries(symbolMap).forEach(([latex, replacement]) => {
        const escaped = latex.replace(/\\/g, '\\\\');
        text = text.replace(new RegExp(escaped, 'g'), replacement);
    });

    text = text
        .replace(/\^\{([^{}]+)\}/g, (_, part) => toSuperscript(part))
        .replace(/_\{([^{}]+)\}/g, (_, part) => toSubscript(part))
        .replace(/\^([0-9A-Za-z+\-=()])/g, (_, part) => toSuperscript(part))
        .replace(/_([0-9A-Za-z])/g, (_, part) => toSubscript(part))
        .replace(/([A-Z][a-z]?|\))(\d+)/g, (_, prefix, digits) => `${prefix}${toSubscript(digits)}`)
        .replace(/([A-Za-z\)])\^([+-])/g, (_, prefix, charge) => `${prefix}${toSuperscript(charge)}`)
        .replace(/\\[a-zA-Z]+/g, '')
        .replace(/\s*([=<>≤≥≈≠＋+×÷])\s*/g, ' $1 ')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([，。；、：,.!?])/g, '$1')
        .trim();

    return text;
}

async function prepareWrongQuestionAsset(file) {
    const mimeType = resolveUploadMimeType(file);
    if (mimeType === 'application/pdf') {
        return readPdfFirstPage(file);
    }

    if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/msword'
    ) {
        return readWordDocument(file, mimeType);
    }

    const rawDataUrl = await readFileAsDataUrl(file);
    const compressedDataUrl = await compressImageDataUrl(rawDataUrl, {
        maxSide: 1200,
        quality: 0.84,
        force: true
    });
    const aiImageUrl = await compressImageDataUrl(rawDataUrl, {
        maxSide: 640,
        quality: 0.62,
        force: true
    });
    const extractedText = await tryExtractImageText(compressedDataUrl);
    return {
        previewImageUrl: compressedDataUrl,
        aiImageUrl,
        extractedText
    };
}

async function readWordDocument(file, mimeType) {
    if (mimeType === 'application/msword') {
        throw new Error('暂不支持旧版 .doc，请另存为 .docx、PDF 或图片后上传');
    }

    if (!window.JSZip) {
        await loadScript(JSZIP_CDN);
    }
    if (!window.JSZip) {
        throw new Error('Word解析库加载失败，请改用PDF或图片上传');
    }

    const arrayBuffer = await file.arrayBuffer();
    const zip = await window.JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
        throw new Error('未读取到Word正文，请改用PDF或图片上传');
    }

    const xml = await docXmlFile.async('string');
    const text = decodeDocxXmlText(xml);
    if (!text) {
        throw new Error('Word正文为空，请检查文件内容');
    }

    return {
        previewImageUrl: '',
        extractedText: text.slice(0, 8000)
    };
}

function decodeDocxXmlText(xml) {
    return String(xml || '')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<\/w:tr>/g, '\n')
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
        .trim();
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

async function compressImageDataUrl(dataUrl, options = {}) {
    const img = await loadImage(dataUrl);
    const maxSide = options.maxSide || 1600;
    const quality = options.quality ?? 0.9;
    const force = Boolean(options.force);
    const sourceMax = Math.max(img.width, img.height);
    const shouldResize = sourceMax > maxSide;
    const shouldCompress = dataUrl.length > 1_800_000;

    if (!force && !shouldResize && !shouldCompress) return dataUrl;

    const ratio = shouldResize ? (maxSide / sourceMax) : 1;
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', quality);
}

async function tryExtractImageText(dataUrl) {
    try {
        if (!window.Tesseract) {
            setUploadStatus('正在识别图片文字，请稍候...');
            await loadScript(TESSERACT_CDN);
        }
        if (!window.Tesseract || typeof window.Tesseract.recognize !== 'function') {
            return '';
        }

        const result = await window.Tesseract.recognize(dataUrl, 'chi_sim+eng');
        return String(result?.data?.text || '')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .slice(0, 4000);
    } catch (error) {
        console.warn('图片文字识别失败，继续走图片解析:', error.message);
        return '';
    }
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
        aiImageUrl: await compressImageDataUrl(canvas.toDataURL('image/png'), {
            maxSide: 640,
            quality: 0.62,
            force: true
        }),
        extractedText: extractedText || await tryExtractImageText(canvas.toDataURL('image/png'))
    };
}

function setGenerateButtonLoading(isLoading, text = '') {
    const btn = document.getElementById('generateBtn');
    if (!btn) return;
    const label = btn.querySelector('span') || btn;
    btn.disabled = !!isLoading;
    btn.classList.toggle('is-loading', !!isLoading);
    label.textContent = text || (isLoading ? '正在生成归因追分结果...' : '生成归因追分结果');
}

function updateFigureProgressBanner(done, total, failed = 0, active = true) {
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

async function requestGenerateExam(payload, maxAttempts = 3) {
    let lastError = '生成失败';

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const isLastAttempt = attempt >= maxAttempts - 1;
        try {
            const resp = await apiFetch(`${API_BASE}/exam/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

function getPracticeTypeByLabel(label) {
    const normalized = normalizeQuestionType(label);
    const found = getPracticeQuestionTypes().find((item) => (
        item.label === label ||
        item.code === label ||
        item.code === normalized ||
        normalizeQuestionType(item.label) === normalized
    ));
    if (found) return found;

    const meta = getTrainingTypeMeta(normalized);
    return {
        label: String(label || meta.groupLabel),
        code: normalized,
        order: meta.order
    };
}

function createProgressiveExamData(payload) {
    return {
        title: '错题专练机-定制练习',
        questions: [],
        answers: [],
        metadata: {
            subject: payload.subject,
            grade: payload.grade,
            knowledgePoints: payload.knowledgePoints,
            examPoints: payload.examPoints
        }
    };
}

function normalizeGeneratedGroupForType(data, typeSpec, targetCount) {
    const meta = getTrainingTypeMeta(typeSpec.code);
    const rawGroups = Array.isArray(data?.questions)
        ? data.questions.filter((group) => Array.isArray(group?.items) && group.items.length > 0)
        : [];
    const matchedItems = [];

    rawGroups.forEach((group) => {
        const groupCode = normalizeQuestionType(group.type || group.title);
        if (groupCode === typeSpec.code || rawGroups.length === 1) {
            matchedItems.push(...group.items.filter(Boolean));
        }
    });

    if (matchedItems.length === 0) {
        rawGroups.forEach((group) => matchedItems.push(...group.items.filter(Boolean)));
    }

    return {
        type: typeSpec.code,
        title: meta.groupLabel,
        items: matchedItems.slice(0, Math.max(1, targetCount || matchedItems.length))
    };
}

function rebuildProgressiveExamIndexes(examData) {
    if (!examData || !Array.isArray(examData.questions)) return;

    examData.questions.sort((a, b) => getTypeOrder(a.type || a.title) - getTypeOrder(b.type || b.title));

    const answers = [];
    let index = 1;
    examData.questions.forEach((group) => {
        if (!Array.isArray(group.items)) return;
        group.items.forEach((item) => {
            item.index = index;
            const answer = String(item.answer || '').trim();
            const explanation = String(item.explanation || '').trim();
            answers.push(`${index}. 答案：${answer || '略'}${explanation ? ` 解析：${explanation}` : ''}`);
            index += 1;
        });
    });
    examData.answers = answers;
}

function upsertProgressiveGroup(examData, group) {
    if (!examData || !group || !Array.isArray(group.items) || group.items.length === 0) return;

    const groupCode = normalizeQuestionType(group.type || group.title);
    examData.questions = (examData.questions || []).filter((item) => (
        normalizeQuestionType(item.type || item.title) !== groupCode
    ));
    examData.questions.push(group);
    rebuildProgressiveExamIndexes(examData);
}

function isStrictPracticeRetryableError(message) {
    const text = String(message || '');
    return (
        /数量不足|未生成有效题目|格式不正确|暂无有效题目|图文一致性校验未通过/.test(text) ||
        isRetryableGenerateError(text)
    );
}

async function requestPracticeTypeStrictly(basePayload, typeSpec, targetCount, maxAttempts = 8) {
    let lastError = null;
    const payload = {
        ...basePayload,
        questionTypes: [typeSpec.label],
        questionTypeCounts: { [typeSpec.code]: targetCount },
        questionCount: targetCount
    };

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const data = await requestGenerateExam(payload, 1);
            const group = normalizeGeneratedGroupForType(data, typeSpec, targetCount);
            if (!group.items.length) {
                throw new Error(`${getTrainingTypeMeta(typeSpec.code).title}暂无有效题目`);
            }
            if (group.items.length < targetCount) {
                throw new Error(`${getTrainingTypeMeta(typeSpec.code).title}数量不足，请重试`);
            }
            return group;
        } catch (error) {
            lastError = error;
            const isLastAttempt = attempt >= maxAttempts - 1;
            if (isLastAttempt || !isStrictPracticeRetryableError(error?.message)) {
                throw error;
            }
            await delay(700 * Math.min(attempt + 1, 4));
        }
    }

    throw lastError || new Error(`${getTrainingTypeMeta(typeSpec.code).title}生成失败`);
}

async function generateExam() {
    if (!state.analysis || !state.wrongQuestion) {
        const fileInput = document.getElementById('wrongQuestionFile');
        if (state.isAnalyzingWrongQuestion) {
            state.pendingGenerateAfterAnalyze = true;
            setUploadStatus('正在解析错题，解析完成后会自动生成归因追分结果...');
            return;
        }
        if (fileInput?.files?.[0]) {
            await handleWrongQuestionUpload(fileInput, { autoGenerate: true });
            return;
        }
        if (fileInput) {
            state.autoGenerateAfterUpload = true;
            setUploadStatus('请选择错题文件，上传后将自动生成归因追分结果。');
            fileInput.click();
            return;
        }
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
    if (loadingEl) loadingEl.style.display = 'none';
    setGenerateButtonLoading(true, '正在生成题目...');

    switchToSelectMode();
    updateFigureProgressBanner(0, 0, 0, false);

    const subjectInput = document.getElementById('subjectSelect')?.value || '';
    const gradeInput = document.getElementById('gradeSelect')?.value || '';
    const basePayload = {
        subject: subjectInput || state.analysis.subject,
        grade: gradeInput || state.analysis.grade,
        knowledgePoints: state.analysis.knowledgePoints,
        examPoints: state.analysis.examPoints,
        answerAnalysis: state.analysis.answerAnalysis,
        sourceQuestionText: state.analysis.originalQuestionText,
        sourceQuestionImage: normalizeSourceQuestionImageForGenerate(state.wrongQuestion.previewImageUrl),
        hasFigure: state.analysis.hasFigure
    };

    const selectedTypeSpecs = selectedQuestionTypes.map(getPracticeTypeByLabel);
    const pendingCodes = new Set(selectedTypeSpecs.map((item) => item.code));
    const failedMessages = {};
    const progressiveData = createProgressiveExamData(basePayload);
    state.currentExamData = progressiveData;

    const renderProgress = () => {
        renderQuestionCards(progressiveData, requestToken, {
            expectedTypes: selectedTypeSpecs,
            pendingCodes: Array.from(pendingCodes),
            failedMessages,
            questionTypeCounts
        });
    };

    renderProgress();

    try {
        const tasks = selectedTypeSpecs.map(async (typeSpec) => {
            const targetCount = questionTypeCounts[typeSpec.code] || 1;
            try {
                const group = await requestPracticeTypeStrictly(basePayload, typeSpec, targetCount);
                if (requestToken !== state.activeGenerateToken) return;

                upsertProgressiveGroup(progressiveData, group);
                pendingCodes.delete(typeSpec.code);
                renderProgress();
            } catch (error) {
                if (requestToken !== state.activeGenerateToken) return;
                console.error(`${typeSpec.label}生成失败:`, error);
                pendingCodes.delete(typeSpec.code);
                failedMessages[typeSpec.code] = String(error?.message || '生成失败');
                renderProgress();
            }
        });

        await Promise.allSettled(tasks);
        if (requestToken !== state.activeGenerateToken) return;

        if (!progressiveData.questions.length) {
            alert('生成失败：所有题型都未生成成功，请稍后重试');
        }
    } catch (e) {
        console.error('生成题目异常:', e);
        alert('生成失败：' + e.message);
    } finally {
        if (requestToken === state.activeGenerateToken) {
            if (loadingEl) loadingEl.style.display = 'none';
            setGenerateButtonLoading(false);
        }
    }
}

function renderQuestionCards(data, figureLoadToken = Date.now(), options = {}) {
    const container = document.getElementById('selectMode');
    const composeBar = document.getElementById('composeBar');
    if (!container) return;

    state.generatedQuestions = [];
    state.selectedQuestions.clear();
    state.activeFigureLoadToken = figureLoadToken;
    state.pendingFigures = [];
    state.lastPreviewType = '';

    const figureSubject = state.analysis?.subject || data?.metadata?.subject || '数学';
    const hiddenFigureSlots = [];
    const groupCardsByType = new Map();
    let globalIndex = 0;

    if (data.questions && Array.isArray(data.questions)) {
        for (const group of data.questions) {
            if (!group || !Array.isArray(group.items) || group.items.length === 0) continue;
            const groupType = normalizeQuestionType(group.type || group.title);
            const meta = getTrainingTypeMeta(groupType);
            const groupIndices = [];

            group.items.forEach((item, itemIndex) => {
                if (!item) return;
                const idx = globalIndex++;
                groupIndices.push(idx);
                state.generatedQuestions.push({
                    ...item,
                    groupType,
                    groupTitle: group.title || meta.groupLabel
                });

                if (item.figure) {
                    const figId = `fig_${idx}_${figureLoadToken}`;
                    const visible = itemIndex === 0;
                    const figureHtml = `<div class="q-figure q-figure-loading" id="${figId}"><span>图形生成中...</span></div>`;
                    if (visible) {
                        item.__matrixFigureHtml = figureHtml;
                    } else {
                        hiddenFigureSlots.push(`<div class="figure-cache-slot" id="${figId}" aria-hidden="true"></div>`);
                    }
                    state.pendingFigures.push({
                        id: figId,
                        qIdx: idx,
                        figure: item.figure,
                        stem: item.stem || '',
                        subject: figureSubject
                    });
                }
            });

            groupCardsByType.set(groupType, buildTrainingCardHtml(group, groupType, groupIndices));
        }
    }

    const expectedTypes = Array.isArray(options.expectedTypes) ? options.expectedTypes : [];
    const pendingCodes = new Set(options.pendingCodes || []);
    const failedMessages = options.failedMessages || {};
    const questionTypeCounts = options.questionTypeCounts || {};
    const orderedCards = [];
    const renderedTypes = new Set();

    expectedTypes.forEach((item) => {
        const typeSpec = typeof item === 'string' ? getPracticeTypeByLabel(item) : item;
        const typeCode = typeSpec.code || normalizeQuestionType(typeSpec.label);
        renderedTypes.add(typeCode);

        if (groupCardsByType.has(typeCode)) {
            orderedCards.push(groupCardsByType.get(typeCode));
            return;
        }

        if (pendingCodes.has(typeCode)) {
            orderedCards.push(buildTrainingStatusCardHtml(typeCode, questionTypeCounts[typeCode], 'pending'));
            return;
        }

        if (failedMessages[typeCode]) {
            orderedCards.push(buildTrainingStatusCardHtml(typeCode, questionTypeCounts[typeCode], 'failed', failedMessages[typeCode]));
        }
    });

    groupCardsByType.forEach((html, typeCode) => {
        if (!renderedTypes.has(typeCode)) orderedCards.push(html);
    });

    container.innerHTML = buildInsightsHtml(orderedCards.join(''), hiddenFigureSlots.join(''));
    if (composeBar) composeBar.style.display = 'none';
    updateSelectedCount();
    loadFiguresAsync(figureLoadToken);
}

function renderResultPlaceholder() {
    const container = document.getElementById('selectMode');
    if (!container) return;

    const title = state.analysis ? '解析完成，正在生成归因追分结果' : '先上传 1 道错题';
    const message = state.analysis
        ? 'AI 已完成错题拆解，马上会在这里生成归因追分结果。'
        : 'AI 会自动拆解考点、判断错因，并生成三类训练矩阵。';

    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-mark">✓</div>
            <strong>${title}</strong>
            <span>${message}</span>
        </div>
    `;
}

function buildInsightsHtml(matrixHtml, hiddenFigureSlots = '', overrideModel = null) {
    const model = overrideModel || buildInsightModelFromState();

    return `
        <div class="result-stack">
            <section class="insight-panel answer">
                <div class="insight-head">
                    <div class="insight-title"><span class="insight-icon">解</span>答案解析</div>
                </div>
                <p>${escapeHtml(model.answerAnalysis)}</p>
            </section>

            <section class="insight-panel green">
                <div class="insight-head">
                    <div class="insight-title"><span class="insight-icon">考</span>考点分析</div>
                </div>
                <p>${escapeHtml(model.examAnalysis)}</p>
                <p>本题考查：${escapeHtml(model.primaryExamPoint)}。</p>
            </section>

            <section class="insight-panel red">
                <div class="insight-head">
                    <div class="insight-title"><span class="insight-icon">错</span>错因判断</div>
                </div>
                <p>${escapeHtml(model.mistakeAnalysis)}</p>
                <div class="mistake-badge">错因类型：${escapeHtml(model.mistakeType)}</div>
            </section>

            <section class="insight-panel amber">
                <div class="insight-head">
                    <div class="insight-title"><span class="insight-icon">法</span>同类题识别方法</div>
                </div>
                <ol>
                    ${model.methodSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
                </ol>
                <div class="keyword-box">
                    <strong>识别关键词：</strong>
                    <div class="keyword-list">${model.keywords.slice(0, 4).map((item) => `<span>· ${escapeHtml(item)}</span>`).join('')}</div>
                </div>
            </section>

            <section class="insight-panel">
                <div class="insight-head">
                    <div class="insight-title"><span class="insight-icon">练</span>变式训练题</div>
                </div>
                <div class="training-grid">${matrixHtml}</div>
                ${hiddenFigureSlots}
            </section>

        </div>
    `;
}

function buildTrainingCardHtml(group, groupType, groupIndices) {
    const meta = getTrainingTypeMeta(groupType);
    const items = Array.isArray(group.items) ? group.items.filter(Boolean) : [];
    const firstItem = items[0] || {};
    const previewStem = String(firstItem.stem || '生成后显示完整题目').trim();
    const firstOriginalIdx = groupIndices[0];
    const figureHtml = firstItem.__matrixFigureHtml || '';

    return `
        <button class="training-card ${escapeHtml(groupType)}" type="button" onclick="openTrainingPaper('${escapeHtml(groupType)}')">
            <div class="training-card-head">
                <div class="training-card-title">
                    <span class="training-number">${meta.number}</span>
                    <h3>${escapeHtml(meta.title)}</h3>
                </div>
                <span class="training-count">${items.length || 0} 道</span>
            </div>
            <div class="training-preview">
                ${firstOriginalIdx !== undefined ? `${firstOriginalIdx + 1}. ` : ''}${escapeHtml(previewStem)}
                ${figureHtml}
            </div>
            <div class="training-answer">
                <span>答案：${escapeHtml(String(firstItem.answer || '生成中').slice(0, 24))}</span>
                <span class="training-tag">${escapeHtml(meta.tag)}</span>
            </div>
        </button>
    `;
}

function buildTrainingStatusCardHtml(groupType, targetCount = 0, status = 'pending', message = '') {
    const meta = getTrainingTypeMeta(groupType);
    const countText = targetCount ? `${targetCount} 道` : '生成中';
    const isFailed = status === 'failed';
    const preview = isFailed
        ? `该类题生成失败：${message || '请重新生成归因追分结果'}`
        : 'AI 正在生成这一类题目，完成后会自动出现在这里。';
    const answerText = isFailed ? '未生成' : '生成中...';
    const tagText = isFailed ? '可重试' : '实时生成';

    return `
        <button class="training-card ${escapeHtml(groupType)} ${escapeHtml(status)}" type="button" disabled>
            <div class="training-card-head">
                <div class="training-card-title">
                    <span class="training-number">${meta.number}</span>
                    <h3>${escapeHtml(meta.title)}</h3>
                </div>
                <span class="training-count">${escapeHtml(countText)}</span>
            </div>
            <div class="training-preview">${escapeHtml(preview)}</div>
            <div class="training-answer">
                <span>${escapeHtml(answerText)}</span>
                <span class="training-tag">${escapeHtml(tagText)}</span>
            </div>
        </button>
    `;
}

function buildDemoTrainingCardsHtml() {
    return DEMO_TRAINING_CARDS.map((item, index) => {
        const meta = getTrainingTypeMeta(item.type);
        return `
            <button class="training-card ${escapeHtml(item.type)} is-demo" type="button" onclick="openTrainingPaper('${escapeHtml(item.type)}')">
                <div class="training-card-head">
                    <div class="training-card-title">
                        <span class="training-number">${index + 1}</span>
                        <h3>${escapeHtml(meta.title)}</h3>
                    </div>
                </div>
                <div class="training-preview">
                    ${escapeHtml(item.stem)}
                    <div class="q-figure demo-figure">${buildDemoFigureSvg(item.figure)}</div>
                </div>
                <div class="training-answer">
                    <span>答案： ${escapeHtml(item.answer)}</span>
                    <span class="training-tag">${escapeHtml(item.tag)}</span>
                </div>
            </button>
        `;
    }).join('');
}

function buildDemoFigureSvg(type) {
    const extra = type === 'parallel-application'
        ? `
            <line x1="70" y1="112" x2="188" y2="112" stroke="#1f2937" stroke-width="1.3"/>
            <text x="58" y="116" font-size="12" fill="#1f2937">3</text>
            <text x="83" y="134" font-size="12" fill="#1f2937">3</text>
            <text x="102" y="74" font-size="12" fill="#1f2937">2</text>
        `
        : `
            <text x="62" y="105" font-size="12" fill="#1f2937">${type === 'parallel-variant' ? '10' : '2'}</text>
        `;

    return `
        <svg viewBox="0 0 220 150" role="img" aria-label="平行线角度示意图">
            <line x1="46" y1="54" x2="188" y2="54" stroke="#1f2937" stroke-width="1.4"/>
            <line x1="46" y1="108" x2="188" y2="108" stroke="#1f2937" stroke-width="1.4"/>
            <line x1="106" y1="128" x2="130" y2="28" stroke="#1f2937" stroke-width="1.4"/>
            <text x="194" y="59" font-size="14" fill="#1f2937" font-style="italic">a</text>
            <text x="194" y="113" font-size="14" fill="#1f2937" font-style="italic">b</text>
            <text x="128" y="49" font-size="12" fill="#1f2937">1</text>
            ${extra}
        </svg>
    `;
}

function getTrainingTypeMeta(type) {
    const normalized = normalizeQuestionType(type);
    return TRAINING_TYPE_META[normalized] || {
        order: 99,
        number: 0,
        title: '专项训练',
        groupLabel: '训练题',
        paperTitle: '专项训练卷',
        tag: '专项巩固'
    };
}

function getDemoInsightModel() {
    return {
        answerAnalysis: '利用平行线性质先判断角的位置关系：∠1 与 ∠2 位于两条平行线之间，且分居截线两侧，属于内错角，所以两角相等，答案为 35°。',
        examAnalysis: '平行线的性质：两直线平行，同位角相等，内错角相等，同旁内角互补。',
        primaryExamPoint: '内错角相等的应用。',
        mistakeType: '概念混淆',
        mistakeAnalysis: '学生将内错角关系误判为同旁内角关系，认为∠1与∠2互补，计算为 180° - 35° = 145°。',
        keywords: ['平行线 + 截线', '内错角 / 同旁内角', '位置关系判断'],
        methodSteps: [
            '看到“两直线平行 + 截线”结构，优先判断角的两边位置关系。',
            '找到∠1和∠2分别在两条平行线之间且在截线两侧 → 属于内错角。',
            '内错角相等；同旁内角在同侧才互补。'
        ]
    };
}

function buildInsightModelFromState() {
    const analysis = state.analysis || {};
    const examPoints = normalizeDisplayList(analysis.examPoints);
    const knowledgePoints = normalizeDisplayList(analysis.knowledgePoints);
    const demo = getDemoInsightModel();
    const primaryExamPoint = examPoints[0] || knowledgePoints[0] || demo.primaryExamPoint;
    const mistakeType = inferMistakeType(analysis.answerAnalysis, examPoints, knowledgePoints);
    const methodSteps = state.analysis
        ? buildMethodSteps(primaryExamPoint, knowledgePoints)
        : demo.methodSteps;
    const answerAnalysis = state.analysis
        ? (analysis.answerAnalysis || 'AI 未识别到完整答案解析，请结合考点分析和生成题目进行人工校对。')
        : demo.answerAnalysis;

    return {
        answerAnalysis,
        examAnalysis: state.analysis
            ? formatInsightSentence(examPoints, knowledgePoints)
            : demo.examAnalysis,
        primaryExamPoint,
        mistakeType: state.analysis ? mistakeType : demo.mistakeType,
        mistakeAnalysis: state.analysis
            ? buildMistakeAnalysis(mistakeType, primaryExamPoint)
            : demo.mistakeAnalysis,
        keywords: (knowledgePoints.length ? knowledgePoints : demo.keywords),
        methodSteps
    };
}

function normalizeDisplayList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function formatInsightSentence(examPoints, knowledgePoints) {
    if (examPoints.length > 0) {
        return `围绕 ${examPoints.slice(0, 3).join('、')} 展开训练。`;
    }
    if (knowledgePoints.length > 0) {
        return `围绕 ${knowledgePoints.slice(0, 3).join('、')} 展开训练。`;
    }
    return '上传错题后，AI 会自动识别本题考点并生成训练建议。';
}

function inferMistakeType(answerAnalysis, examPoints, knowledgePoints) {
    const text = `${answerAnalysis || ''} ${examPoints.join(' ')} ${knowledgePoints.join(' ')}`;
    if (/计算|运算|代入|符号|单位|数值/.test(text)) return '计算过程失误';
    if (/概念|性质|定义|定理|规律|原理/.test(text)) return '概念混淆';
    if (/审题|条件|题意|关键词|已知/.test(text)) return '审题遗漏';
    if (/图|几何|角|线|电路|函数图像/.test(text)) return '图文关系误判';
    return '方法迁移不足';
}

function buildMistakeAnalysis(mistakeType, primaryExamPoint) {
    const point = primaryExamPoint || '核心考点';
    const templates = {
        '计算过程失误': `本题容易错在计算链条中漏写单位、符号或中间量。训练包会围绕“${point}”安排分步计算与结果校验。`,
        '概念混淆': `本题容易错在把相近概念或适用条件混在一起。训练包会围绕“${point}”强化条件辨析和反例判断。`,
        '审题遗漏': `本题容易错在漏读题干限定条件，只按熟悉题型套方法。训练包会围绕“${point}”加入条件提取与设问改写。`,
        '图文关系误判': `本题容易错在只看图形表面特征，没有把图表信息与“${point}”逐项对应。训练包会强化读图、转译和迁移判断。`,
        '方法迁移不足': `本题容易错在会做原题，但遇到换情境、换条件就无法迁移。训练包会围绕“${point}”做同考点多题型转换。`
    };
    return templates[mistakeType] || templates['方法迁移不足'];
}

function buildMethodSteps(primaryExamPoint, knowledgePoints) {
    const point = primaryExamPoint || knowledgePoints[0] || '核心考点';
    return [
        `先锁定题干是否围绕“${point}”设置条件。`,
        '再找已知量、设问目标与隐含关系，避免只凭题型外观判断。',
        '最后用同一考点换情境、换条件、换问法进行迁移练习。'
    ];
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
            headers: { 'Content-Type': 'application/json' },
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
    } catch (e) {
        if (retryCount < 1) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return loadSingleFigure(fig, figureLoadToken, retryCount + 1);
        }
    }

    if (figureLoadToken !== state.activeFigureLoadToken) return false;
    const lastEl = document.getElementById(fig.id);
    if (lastEl) lastEl.style.display = 'none';
    return false;
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
    let cursor = 0;

    updateFigureProgressBanner(done, total, failed, true);

    const workerCount = 1;
    const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < total) {
            if (figureLoadToken !== state.activeFigureLoadToken) return;
            const current = cursor++;
            const fig = figures[current];
            const ok = await loadSingleFigure(fig, figureLoadToken);
            done += 1;
            if (!ok) failed += 1;
            if (figureLoadToken === state.activeFigureLoadToken) {
                updateFigureProgressBanner(done, total, failed, done < total);
            }
        }
    });

    await Promise.all(workers);
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
    document.getElementById('composeBtn').disabled = count === 0;
}

function composeExam() {
    if (state.selectedQuestions.size === 0) {
        alert('请至少选择一道题目');
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

function openTrainingPaper(groupType) {
    if (!Array.isArray(state.generatedQuestions) || state.generatedQuestions.length === 0) {
        alert('请先生成归因追分结果');
        return;
    }

    const normalizedType = normalizeQuestionType(groupType);
    const meta = getTrainingTypeMeta(normalizedType);
    const selectedItems = [];

    state.selectedQuestions.clear();
    state.generatedQuestions.forEach((question, idx) => {
        if (!question) return;
        if (normalizeQuestionType(question.groupType || question.groupTitle) !== normalizedType) return;
        state.selectedQuestions.add(idx);
        selectedItems.push({ ...question, originalIdx: idx });
    });

    if (selectedItems.length === 0) {
        alert('该类题目暂未生成，请重新生成归因追分结果');
        return;
    }

    selectedItems.forEach((item, index) => {
        item.index = index + 1;
    });

    const title = `${meta.paperTitle}（${selectedItems.length}题）`;
    const groupsObj = {
        [normalizedType]: {
            title: meta.groupLabel,
            items: selectedItems,
            order: meta.order
        }
    };

    state.lastPreviewTitle = title;
    state.lastPreviewGroups = groupsObj;
    state.lastPreviewType = normalizedType;

    renderExamPreview(title, groupsObj);
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
    const showOriginal = document.getElementById('showOriginal')?.checked;
    if (!showOriginal) return '';
    const imageUrl = state.wrongQuestion?.previewImageUrl || '';
    const text = state.analysis?.originalQuestionText || state.wrongQuestion?.extractedText || '';
    if (!imageUrl && !text) return '';

    return `
        <div class="original-question-block">
            <div class="group-title">原题展示</div>
            ${text ? `<div class="original-question-text">${escapeHtml(text)}</div>` : ''}
            ${imageUrl ? `
            <div class="original-question-image">
                <img src="${imageUrl}" alt="原题图片">
            </div>` : ''}
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
                } else {
                    html += '<div class="q-figure q-figure-loading">图形生成中...</div>';
                }
            }

            html += '</div>';
        }
        html += '</div>';
    }

    const examContent = document.getElementById('examContent');
    if (!examContent) return;

    examContent.innerHTML = html;

    if (state.currentExamData?.answers) {
        const indices = [...state.selectedQuestions].sort((a, b) => a - b);
        const answers = indices.map((idx, i) => {
            const orig = state.currentExamData.answers[idx];
            return orig ? `${i + 1}. ${String(orig).replace(/^\d+\.\s*/, '')}` : '';
        }).filter(Boolean);

        document.getElementById('answerContent').innerHTML = answers.map((a) => `<div>${escapeHtml(a)}</div>`).join('<br>');
    }

    applyAnswerVisibility();
}

function updateLiveOriginalPanel() {
    const panel = document.getElementById('liveOriginalPanel');
    if (!panel) return;
    panel.classList.remove('show');
    panel.style.display = 'none';
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
    const composeBar = document.getElementById('composeBar');
    if (composeBar) composeBar.style.display = 'none';
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
    const grade = document.getElementById('gradeSelect')?.value || '';
    const subject = document.getElementById('subjectSelect')?.value || '';
    const questionTypes = getSelectedQuestionTypes();
    const questionTypeCounts = getQuestionTypeCounts();

    const settings = {
        showAnswer,
        showOriginal,
        grade,
        subject,
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
    const gradeEl = document.getElementById('gradeSelect');
    const subjectEl = document.getElementById('subjectSelect');

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
        if (gradeEl && typeof parsed.grade === 'string') {
            gradeEl.value = parsed.grade;
        }
        if (subjectEl && typeof parsed.subject === 'string') {
            subjectEl.value = parsed.subject;
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
    return normalizeEducationalSymbols(value)
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
    openTrainingPaper,
    backToSelect,
    exportToPdf,
    exportToWord,
    closeModal,
    saveSettings,
    handleShowOriginalChange
});

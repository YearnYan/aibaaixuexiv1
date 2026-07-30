// 试卷变课件 - 试卷PPT生成器
// 核心功能：多文件上传 -> AI识别题目 -> 图形匹配 -> 预览与下载

let currentSlideIndex = 0;
let generatedSlides = [];
let sourcePages = [];
let lastUploadFiles = [];

const MAX_UPLOAD_FILES = 20;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_PDF_PAGES_PER_FILE = 10;
const MAX_PAGE_IMAGE_LONG_EDGE = 1600;
const MIN_PAGE_IMAGE_LONG_EDGE = 1100;
const TARGET_PAGE_IMAGE_BYTES = 900 * 1024;
const PAGE_IMAGE_JPEG_QUALITY = 0.82;
const MIN_PAGE_IMAGE_JPEG_QUALITY = 0.58;
const TRANSPORT_PAGE_IMAGE_BUDGET_BYTES = 42 * 1024 * 1024;
const LARGE_UPLOAD_PAGE_THRESHOLD = 24;
const MIN_TRANSPORT_PAGE_IMAGE_BYTES = 140 * 1024;
const LARGE_UPLOAD_PAGE_IMAGE_BYTES = 320 * 1024;
const TRANSPORT_MAX_LONG_EDGE = 1280;
const TRANSPORT_MIN_LONG_EDGE = 720;
const TRANSPORT_MIN_JPEG_QUALITY = 0.42;
const MAX_TEXT_CHUNK_LENGTH = 1200;
const MAX_WORD_TEXT_CHUNK_LENGTH = 6000;
const MAX_TEXT_SUMMARY_PER_BATCH_LENGTH = 6000;
const DEFAULT_AI_BATCH_PAGES = 1;
const DEFAULT_AI_BATCH_PAYLOAD_BYTES = Math.floor(1.4 * 1024 * 1024);
const MIN_AI_BATCH_PAYLOAD_BYTES = Math.floor(1.2 * 1024 * 1024);
const MAX_AI_REQUEST_BODY_BYTES = Math.floor(3.8 * 1024 * 1024);
const MAX_AI_BATCH_SPLIT_DEPTH = 5;
const MAX_AI_TEXT_SPLIT_DEPTH = 4;
const MAX_SINGLE_PAGE_DEGRADE_LEVEL = 3;
const MAX_ACADEMIC_REPAIR_ATTEMPTS = 4;
const SEGMENT_TEXT_SUMMARY_LENGTH = 1200;
const PREVIEW_EXPORT_WIDTH = 1600;
const PREVIEW_EXPORT_HEIGHT = 900;
const SLIDE_LOGICAL_WIDTH = 1040;
const SLIDE_LOGICAL_HEIGHT = 585;
const DENSITY_CLASSES = ['density-compact', 'density-tight'];

const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'pdf', 'doc', 'docx'];
const SUPPORTED_MIME = [
    'image/png',
    'image/jpeg',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const AI_CONFIG = {
    apiUrl: '/api/site/exam-ppt',
    timeoutMs: 260000,
    retryCount: 2,
    retryDelayMs: 1200,
    localRuntime: false,
    platformRuntime: false,
    localRuntimeChecked: false
};

let localAIProbePromise = null;

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const fileSelectBtn = document.getElementById('fileSelectBtn');
const processingStatus = document.getElementById('processingStatus');
const processingTitle = processingStatus.querySelector('.processing-title');
const processingText = processingStatus.querySelector('.processing-text');
const processingRetryBtn = document.getElementById('processingRetryBtn');
const previewSection = document.getElementById('previewSection');
const slideNavList = document.getElementById('slideNavList');
const slidePreview = document.getElementById('slidePreview');
const downloadBtn = document.getElementById('downloadBtn');
const reuploadBtn = document.getElementById('reuploadBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const slideCount = document.getElementById('slideCount');
const answerVisibilityToggle = document.getElementById('answerVisibilityToggle');
const explanationPathToggle = document.getElementById('explanationPathToggle');

let isExportingPPT = false;
let slideRenderRevision = 0;
let academicTypesetQueue = Promise.resolve(false);
let activeAcademicTypesetPromise = Promise.resolve(false);
let processingRetryAction = null;

document.addEventListener('DOMContentLoaded', () => {
    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    refreshIcons();
    detectLocalAIRuntime();
    if (window.HZQ && typeof window.HZQ.init === 'function') {
        window.HZQ.init('试卷讲评PPT');
    }
    initUploadArea();
    initButtons();
    window.addEventListener('resize', syncSlideCanvasScale);
    document.addEventListener('fullscreenchange', syncSlideCanvasScale);
});

function detectLocalAIRuntime() {
    if (localAIProbePromise) {
        return localAIProbePromise;
    }

    localAIProbePromise = fetch('/api/config', {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
    })
        .then(async (response) => {
            const contentType = response.headers.get('content-type') || '';
            if (!response.ok || !/application\/json/i.test(contentType)) {
                return false;
            }

            const config = await response.json();
            if (config?.scope !== 'memory' || config?.localOnly !== true) {
                return false;
            }

            AI_CONFIG.apiUrl = '/api/chat';
            AI_CONFIG.localRuntime = true;
            AI_CONFIG.platformRuntime =
                response.headers.get('x-teacher-ai-site') === 'exam-ppt';
            return true;
        })
        .catch(() => false)
        .finally(() => {
            AI_CONFIG.localRuntimeChecked = true;
        });

    return localAIProbePromise;
}

function refreshIcons() {
    if (!window.lucide || typeof window.lucide.createIcons !== 'function') {
        return;
    }
    window.lucide.createIcons();
}

function syncSlideCanvasScale() {
    const canvas = slidePreview?.querySelector('.slide-canvas');
    if (!canvas || !slidePreview.clientWidth || !slidePreview.clientHeight) {
        return;
    }

    const isFullscreen = document.fullscreenElement === slidePreview;
    const widthScale = slidePreview.clientWidth / SLIDE_LOGICAL_WIDTH;
    const heightScale = slidePreview.clientHeight / SLIDE_LOGICAL_HEIGHT;
    const scale = isFullscreen ? Math.min(widthScale, heightScale) : widthScale;
    slidePreview.style.setProperty('--slide-canvas-scale', String(Math.max(0.01, scale)));
}

function initUploadArea() {
    uploadArea.addEventListener('click', (e) => {
        if (e.target.closest('.upload-btn') || e.target.closest('.generation-options')) {
            return;
        }
        fileInput.click();
    });

    fileInput.addEventListener('change', handleFileSelect);
    fileSelectBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        fileInput.click();
    });

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
        uploadArea.setAttribute('aria-label', '松开即可上传试卷');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
        uploadArea.removeAttribute('aria-label');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        uploadArea.removeAttribute('aria-label');
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length > 0) {
            processFiles(files);
        }
    });

    document.getElementById('cameraBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        const cameraInput = document.createElement('input');
        cameraInput.type = 'file';
        cameraInput.accept = 'image/*';
        cameraInput.capture = 'environment';
        cameraInput.onchange = (event) => {
            const files = Array.from(event.target.files || []);
            if (files.length > 0) {
                processFiles(files);
            }
        };
        cameraInput.click();
    });
}

function initButtons() {
    downloadBtn.addEventListener('click', downloadPPT);
    if (answerVisibilityToggle) {
        answerVisibilityToggle.addEventListener('change', () => {
            if (generatedSlides.length > 0) {
                renderSlide(currentSlideIndex);
            }
        });
    }
    if (explanationPathToggle) {
        explanationPathToggle.addEventListener('change', () => {
            if (generatedSlides.length > 0) {
                renderSlide(currentSlideIndex);
            }
        });
    }
    if (reuploadBtn) {
        reuploadBtn.addEventListener('click', () => {
            fileInput.click();
        });
    }
    fullscreenBtn.addEventListener('click', toggleFullscreen);
    if (processingRetryBtn) {
        processingRetryBtn.addEventListener('click', () => {
            const retryAction = processingRetryAction;
            if (typeof retryAction !== 'function') return;
            processingRetryAction = null;
            showProcessing('正在继续校验并生成课件...', '正在继续生成');
            Promise.resolve(retryAction()).catch((error) => {
                console.error('继续生成失败:', error);
                showProcessingFailure(error, retryAction);
            });
        });
    }
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
        processFiles(files);
    }
}

function createUsageOperationKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `exam-ppt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function processFiles(files, options = {}) {
    if (files.length > MAX_UPLOAD_FILES) {
        alert(`最多可上传 ${MAX_UPLOAD_FILES} 个文件，请减少后重试。`);
        return;
    }

    const normalizedFiles = files.slice(0, MAX_UPLOAD_FILES);
    const usageOperationKey = String(
        options.usageOperationKey || createUsageOperationKey()
    );
    const validationError = validateFiles(normalizedFiles);

    if (validationError) {
        alert(validationError);
        return;
    }

    // 重新上传时先隐藏旧结果，立即回到上传画面
    previewSection.style.display = 'none';

    showProcessing(`正在读取文件（0/${normalizedFiles.length}）...`);
    generatedSlides = [];
    sourcePages = [];
    lastUploadFiles = normalizedFiles.map((file) => file.name);

    try {
        const parsedResult = await parseUploadedFiles(normalizedFiles);
        sourcePages = parsedResult.pages;
        showProcessing('正在优化上传内容体积，保障大批量稳定处理...');
        parsedResult.pages = await optimizePagesForTransport(parsedResult.pages);

        if (sourcePages.length === 0 && parsedResult.textChunks.length === 0) {
            throw new Error('未提取到有效内容，请检查文件是否清晰或可读取。');
        }

        showProcessing('正在确认体验次数或积分权限...');
        const usageToken = await ensureUsageTokenForAI({
            force: true,
            suppressCreditReject: true
        });
        if (!usageToken) {
            hideProcessing();
            uploadArea.style.display = 'flex';
            return;
        }

        showProcessing('AI正在识别题目与图形位置...');
        const slides = await identifyQuestionsWithAI(
            parsedResult,
            lastUploadFiles,
            usageOperationKey
        );
        if (slides.length === 0) {
            throw new Error('未识别到题目，请尝试上传更清晰的试卷文件。');
        }

        showProcessing('正在匹配题目图形并优化版面...');
        generatedSlides = await enrichSlidesWithFigureImages(slides, sourcePages);
        await completeUsageOperation(usageOperationKey);

        hideProcessing();
        showPreview();
    } catch (error) {
        console.error('处理失败:', error);
        const retryFiles = normalizedFiles.slice();
        showProcessingFailure(error, () => processFiles(retryFiles, { usageOperationKey }));
    } finally {
        fileInput.value = '';
    }
}

function validateFiles(files) {
    if (files.length === 0) {
        return '请至少上传一个文件。';
    }

    for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
            return `文件 "${file.name}" 超过50MB，请拆分或压缩后重试。`;
        }

        if (!isSupportedFile(file)) {
            return `文件 "${file.name}" 格式不支持，仅支持 PNG/JPG/PDF/WORD（DOC/DOCX）。`;
        }
    }

    return '';
}

function isSupportedFile(file) {
    const ext = getFileExtension(file.name);
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
        return true;
    }
    return SUPPORTED_MIME.includes(file.type);
}

function getFileExtension(fileName = '') {
    const parts = fileName.toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
}

function createTextChunk({ fileName, pageNumber = null, text = '', label = '' }) {
    const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalizedText) {
        return null;
    }

    const normalizedPageNumber =
        pageNumber === null || pageNumber === undefined || pageNumber === ''
            ? null
            : Number(pageNumber);

    return {
        fileName,
        pageNumber: Number.isFinite(normalizedPageNumber) ? normalizedPageNumber : null,
        label: label || `[${fileName}]`,
        text: normalizedText
    };
}

function createPageLabel(page) {
    return `${page.fileName}${page.pageNumber ? ` 第${page.pageNumber}页` : ''}`;
}

function estimateStringBytes(value) {
    const text = String(value || '');
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(text).length;
    }
    return text.length * 2;
}

function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getTotalPagesPayloadBytes(pages) {
    return (Array.isArray(pages) ? pages : []).reduce(
        (sum, page) => sum + estimatePagePayloadBytes(page),
        0
    );
}

function getTargetPageImageBytesByVolume(pageCount) {
    const count = Math.max(1, Number(pageCount) || 1);
    if (count >= 100) {
        return MIN_TRANSPORT_PAGE_IMAGE_BYTES;
    }
    if (count >= 60) {
        return Math.max(MIN_TRANSPORT_PAGE_IMAGE_BYTES, 190 * 1024);
    }
    if (count >= LARGE_UPLOAD_PAGE_THRESHOLD) {
        return LARGE_UPLOAD_PAGE_IMAGE_BYTES;
    }
    if (count >= 12) {
        return Math.min(TARGET_PAGE_IMAGE_BYTES, 520 * 1024);
    }
    return TARGET_PAGE_IMAGE_BYTES;
}

function getAdaptiveBatchLimits(pages) {
    const safePages = Array.isArray(pages) ? pages : [];
    const pageCount = safePages.length;
    const totalBytes = getTotalPagesPayloadBytes(safePages);
    const avgBytes = pageCount > 0 ? totalBytes / pageCount : 0;

    let maxPages = DEFAULT_AI_BATCH_PAGES;
    let maxPayloadBytes = DEFAULT_AI_BATCH_PAYLOAD_BYTES;

    if (pageCount >= 80 || avgBytes >= 480 * 1024) {
        maxPages = 2;
        maxPayloadBytes = Math.floor(1.8 * 1024 * 1024);
    } else if (pageCount >= 30 || avgBytes >= 360 * 1024) {
        maxPages = 2;
        maxPayloadBytes = Math.floor(2.1 * 1024 * 1024);
    } else if (pageCount <= 10 && avgBytes <= 220 * 1024) {
        maxPages = 1;
        maxPayloadBytes = Math.floor(1.6 * 1024 * 1024);
    }

    maxPayloadBytes = Math.max(MIN_AI_BATCH_PAYLOAD_BYTES, maxPayloadBytes);

    return {
        maxPages,
        maxPayloadBytes
    };
}

function getScaledDimensions(width, height, maxLongEdge) {
    const safeWidth = Math.max(1, Math.round(Number(width) || 1));
    const safeHeight = Math.max(1, Math.round(Number(height) || 1));
    const longEdge = Math.max(safeWidth, safeHeight);
    if (!maxLongEdge || longEdge <= maxLongEdge) {
        return { width: safeWidth, height: safeHeight };
    }

    const scale = maxLongEdge / longEdge;
    return {
        width: Math.max(1, Math.round(safeWidth * scale)),
        height: Math.max(1, Math.round(safeHeight * scale))
    };
}

function encodeVisualSource(source, sourceWidth, sourceHeight, options = {}) {
    const targetBytes = options.targetBytes || TARGET_PAGE_IMAGE_BYTES;
    let maxLongEdge = options.maxLongEdge || MAX_PAGE_IMAGE_LONG_EDGE;
    let quality =
        typeof options.initialQuality === 'number'
            ? options.initialQuality
            : PAGE_IMAGE_JPEG_QUALITY;
    const minLongEdge = options.minLongEdge || MIN_PAGE_IMAGE_LONG_EDGE;
    const minQuality =
        typeof options.minQuality === 'number'
            ? options.minQuality
            : MIN_PAGE_IMAGE_JPEG_QUALITY;

    const renderFrame = () => {
        const dims = getScaledDimensions(sourceWidth, sourceHeight, maxLongEdge);
        const canvas = document.createElement('canvas');
        canvas.width = dims.width;
        canvas.height = dims.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('无法创建图像处理画布。');
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

        return {
            dataUrl: canvas.toDataURL('image/jpeg', quality),
            width: canvas.width,
            height: canvas.height
        };
    };

    let result = renderFrame();
    while (
        estimateStringBytes(result.dataUrl) > targetBytes &&
        (quality > minQuality || maxLongEdge > minLongEdge)
    ) {
        if (quality > minQuality + 0.01) {
            quality = Math.max(minQuality, Number((quality - 0.08).toFixed(2)));
        } else {
            maxLongEdge = Math.max(minLongEdge, Math.floor(maxLongEdge * 0.85));
        }
        result = renderFrame();
    }

    return result;
}

function createOptimizedPage({
    source,
    sourceWidth,
    sourceHeight,
    id,
    fileName,
    pageNumber,
    sourceType,
    text = '',
    encodeOptions = {}
}) {
    const optimized = encodeVisualSource(source, sourceWidth, sourceHeight, encodeOptions);
    return {
        id,
        fileName,
        pageNumber,
        sourceType,
        dataUrl: optimized.dataUrl,
        width: optimized.width,
        height: optimized.height,
        text
    };
}

async function recompressPageForTransport(page, encodeOptions = {}) {
    if (!page?.dataUrl) {
        return page;
    }

    const image = await loadImageElement(page.dataUrl);
    if (!image) {
        return page;
    }

    const sourceWidth = image.naturalWidth || image.width || page.width || 1;
    const sourceHeight = image.naturalHeight || image.height || page.height || 1;
    const optimized = encodeVisualSource(image, sourceWidth, sourceHeight, encodeOptions);

    return {
        ...page,
        dataUrl: optimized.dataUrl,
        width: optimized.width,
        height: optimized.height
    };
}

async function optimizePagesForTransport(pages) {
    const safePages = Array.isArray(pages) ? pages.filter((page) => page?.dataUrl) : [];
    if (safePages.length === 0) {
        return [];
    }

    const pageCount = safePages.length;
    const dynamicTarget = getTargetPageImageBytesByVolume(pageCount);
    const expectedTotalBudget = Math.min(
        TRANSPORT_PAGE_IMAGE_BUDGET_BYTES,
        dynamicTarget * pageCount
    );
    const currentTotalBytes = getTotalPagesPayloadBytes(safePages);

    if (currentTotalBytes <= expectedTotalBudget) {
        return safePages.map((page) => ({ ...page }));
    }

    const optimizedPages = [];
    for (let i = 0; i < safePages.length; i += 1) {
        const page = safePages[i];
        const currentPageBytes = estimatePagePayloadBytes(page);
        if (currentPageBytes <= dynamicTarget) {
            optimizedPages.push({ ...page });
            continue;
        }

        const optimizedPage = await recompressPageForTransport(page, {
            targetBytes: dynamicTarget,
            maxLongEdge:
                pageCount >= LARGE_UPLOAD_PAGE_THRESHOLD
                    ? TRANSPORT_MAX_LONG_EDGE
                    : MAX_PAGE_IMAGE_LONG_EDGE,
            minLongEdge:
                pageCount >= LARGE_UPLOAD_PAGE_THRESHOLD
                    ? TRANSPORT_MIN_LONG_EDGE
                    : MIN_PAGE_IMAGE_LONG_EDGE,
            minQuality:
                pageCount >= LARGE_UPLOAD_PAGE_THRESHOLD
                    ? TRANSPORT_MIN_JPEG_QUALITY
                    : MIN_PAGE_IMAGE_JPEG_QUALITY
        });

        optimizedPages.push(optimizedPage);
    }

    let optimizedTotalBytes = getTotalPagesPayloadBytes(optimizedPages);
    if (optimizedTotalBytes <= expectedTotalBudget) {
        return optimizedPages;
    }

    // 大批量场景下再做一轮“仅针对超大页”的压缩，避免请求在网关层失败。
    const secondPassTarget = Math.max(
        MIN_TRANSPORT_PAGE_IMAGE_BYTES,
        Math.floor(dynamicTarget * 0.78)
    );
    for (let i = 0; i < optimizedPages.length; i += 1) {
        if (optimizedTotalBytes <= expectedTotalBudget) {
            break;
        }

        const page = optimizedPages[i];
        const pageBytes = estimatePagePayloadBytes(page);
        if (pageBytes <= secondPassTarget) {
            continue;
        }

        optimizedPages[i] = await recompressPageForTransport(page, {
            targetBytes: secondPassTarget,
            maxLongEdge: TRANSPORT_MAX_LONG_EDGE,
            minLongEdge: Math.max(560, Math.floor(TRANSPORT_MIN_LONG_EDGE * 0.82)),
            initialQuality: 0.68,
            minQuality: Math.max(0.34, TRANSPORT_MIN_JPEG_QUALITY - 0.06)
        });
        optimizedTotalBytes = getTotalPagesPayloadBytes(optimizedPages);
    }

    console.info(
        '[上传优化] 页面数=%d，图片总载荷 %s -> %s',
        pageCount,
        formatBytes(currentTotalBytes),
        formatBytes(optimizedTotalBytes)
    );

    return optimizedPages;
}

async function parseUploadedFiles(files) {
    const pages = [];
    const textChunks = [];
    let pageCounter = 1;

    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        showProcessing(`正在读取文件（${i + 1}/${files.length}）：${file.name}`);
        const ext = getFileExtension(file.name);

        if (['png', 'jpg', 'jpeg'].includes(ext) || file.type.startsWith('image/')) {
            const imagePage = await parseImageFile(file, pageCounter);
            pages.push(imagePage);
            pageCounter += 1;
            continue;
        }

        if (ext === 'pdf' || file.type === 'application/pdf') {
            const pdfResult = await parsePdfFile(file, pageCounter);
            pages.push(...pdfResult.pages);
            textChunks.push(...pdfResult.textChunks);
            pageCounter += pdfResult.pages.length;
            continue;
        }

        if (ext === 'doc' || ext === 'docx' || SUPPORTED_MIME.includes(file.type)) {
            const wordResult = await parseWordFile(file, pageCounter);
            pages.push(...wordResult.pages);
            textChunks.push(...wordResult.textChunks);
            pageCounter += wordResult.pages.length;
            continue;
        }
    }

    return {
        pages,
        textChunks: textChunks.filter(Boolean)
    };
}

async function parseImageFile(file, pageCounter) {
    const objectUrl = URL.createObjectURL(file);

    try {
        const image = await loadImageElement(objectUrl);
        if (!image) {
            throw new Error(`图片 "${file.name}" 读取失败。`);
        }

        return createOptimizedPage({
            source: image,
            sourceWidth: image.naturalWidth || image.width || 0,
            sourceHeight: image.naturalHeight || image.height || 0,
            id: `P${pageCounter}`,
            fileName: file.name,
            pageNumber: 1,
            sourceType: 'image',
            text: ''
        });
    } finally {
        URL.revokeObjectURL(objectUrl);
    };
}

async function parsePdfFile(file, pageCounterStart) {
    if (!window.pdfjsLib) {
        throw new Error('PDF解析组件未加载，请刷新页面后重试。');
    }

    const arrayBuffer = await readFileAsArrayBuffer(file);
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const totalPages = Math.min(pdf.numPages, MAX_PDF_PAGES_PER_FILE);

    const pages = [];
    const textChunks = [];

    for (let i = 1; i <= totalPages; i += 1) {
        showProcessing(`正在解析PDF：${file.name}（第 ${i}/${totalPages} 页）`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        const renderScale = Math.max(
            1,
            Math.min(2.4, MAX_PAGE_IMAGE_LONG_EDGE / Math.max(viewport.width, viewport.height))
        );
        const renderViewport = page.getViewport({ scale: renderScale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);

        await page.render({ canvasContext: context, viewport: renderViewport }).promise;

        const textContent = await page.getTextContent();
        const pageText = textContent.items
            .map((item) => item.str)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        pages.push(
            createOptimizedPage({
                source: canvas,
                sourceWidth: canvas.width,
                sourceHeight: canvas.height,
                id: `P${pageCounterStart + i - 1}`,
                fileName: file.name,
                pageNumber: i,
                sourceType: 'pdf',
                text: ''
            })
        );

        if (pageText) {
            textChunks.push(
                createTextChunk({
                    fileName: file.name,
                    pageNumber: i,
                    label: `[${file.name} 第${i}页]`,
                    text: pageText.slice(0, MAX_TEXT_CHUNK_LENGTH)
                })
            );
        }

        if (typeof page.cleanup === 'function') {
            page.cleanup();
        }
        canvas.width = 0;
        canvas.height = 0;
    }

    if (pdf.numPages > totalPages) {
        textChunks.push(
            createTextChunk({
                fileName: file.name,
                label: `[${file.name}]`,
                text: `仅解析前 ${totalPages} 页用于图形识别，其余页请拆分后再次上传以保证精度。`
            })
        );
    }

    if (typeof pdf.destroy === 'function') {
        await pdf.destroy().catch(() => {});
    }

    return { pages, textChunks };
}

async function parseWordFile(file, pageCounterStart) {
    const ext = getFileExtension(file.name);
    const pages = [];
    const textChunks = [];

    if (!window.mammoth) {
        throw new Error('Word解析组件未加载，请刷新页面后重试。');
    }

    try {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const extractedImages = [];

        const result = await window.mammoth.convertToHtml(
            { arrayBuffer },
            {
                convertImage: window.mammoth.images.inline(async (element) => {
                    const base64 = await element.read('base64');
                    const mimeType = element.contentType || 'image/png';
                    const src = `data:${mimeType};base64,${base64}`;
                    extractedImages.push(src);
                    return { src };
                })
            }
        );

        const plainText = extractTextFromHtml(result.value).trim();
        if (plainText) {
            textChunks.push(
                createTextChunk({
                    fileName: file.name,
                    label: `[${file.name} 文本摘录]`,
                    text: plainText.slice(0, MAX_WORD_TEXT_CHUNK_LENGTH)
                })
            );
        }

        for (let i = 0; i < extractedImages.length; i += 1) {
            const image = await loadImageElement(extractedImages[i]);
            if (!image) {
                continue;
            }

            pages.push(
                createOptimizedPage({
                    source: image,
                    sourceWidth: image.naturalWidth || image.width || 0,
                    sourceHeight: image.naturalHeight || image.height || 0,
                    id: `P${pageCounterStart + i}`,
                    fileName: file.name,
                    pageNumber: i + 1,
                    sourceType: 'word-image',
                    text: ''
                })
            );
        }

        if (!plainText && extractedImages.length === 0) {
            throw new Error('Word文件中未提取到可用内容。');
        }
    } catch (error) {
        if (ext === 'doc') {
            const fallbackText = await tryReadDocText(file);
            if (fallbackText) {
                textChunks.push(
                    createTextChunk({
                        fileName: file.name,
                        label: `[${file.name} 文本摘录]`,
                        text: fallbackText.slice(0, MAX_WORD_TEXT_CHUNK_LENGTH)
                    })
                );
            } else {
                throw new Error(
                    `文件 "${file.name}" 暂不支持直接解析，请将 .doc 另存为 .docx 后重试。`
                );
            }
        } else {
            throw new Error(`文件 "${file.name}" 解析失败：${error.message}`);
        }
    }

    return { pages, textChunks };
}
async function tryReadDocText(file) {
    const encodings = ['utf-8', 'gbk', 'utf-16le'];
    for (const encoding of encodings) {
        try {
            const text = await readFileAsText(file, encoding);
            const normalized = text.replace(/\0/g, '').trim();
            if (normalized.length > 80) {
                return normalized;
            }
        } catch (error) {
            // 忽略并尝试下一种编码
        }
    }
    return '';
}

function extractTextFromHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
}

function estimatePagePayloadBytes(page) {
    return estimateStringBytes(page?.dataUrl || '') + estimateStringBytes(page?.text || '') + 2048;
}

function formatTextChunk(chunk) {
    const label = String(chunk?.label || '').trim();
    const text = String(chunk?.text || '').trim();
    if (!text) {
        return '';
    }
    return `${label}\n${text}`.trim();
}

function buildBatchTextSummary(batchPages, textChunks, usedChunkKeys) {
    const relatedFiles = new Set(batchPages.map((page) => page.fileName));
    const relatedPageKeys = new Set(
        batchPages.map((page) => `${page.fileName}::${Number(page.pageNumber) || 0}`)
    );
    const selectedBlocks = [];
    let usedLength = 0;

    for (let i = 0; i < textChunks.length; i += 1) {
        const chunk = textChunks[i];
        const chunkKey = `${chunk.fileName}::${Number(chunk.pageNumber) || 0}::${chunk.label}`;
        const isPageMatch =
            chunk.pageNumber !== null &&
            relatedPageKeys.has(`${chunk.fileName}::${Number(chunk.pageNumber) || 0}`);
        const isFileSupplement =
            chunk.pageNumber === null &&
            relatedFiles.has(chunk.fileName) &&
            !usedChunkKeys.has(chunkKey);

        if (!isPageMatch && !isFileSupplement) {
            continue;
        }

        const block = formatTextChunk(chunk);
        if (!block) {
            continue;
        }

        const remaining = MAX_TEXT_SUMMARY_PER_BATCH_LENGTH - usedLength;
        if (remaining <= 0) {
            break;
        }

        selectedBlocks.push(block.slice(0, remaining));
        usedLength += Math.min(block.length, remaining) + 5;
        usedChunkKeys.add(chunkKey);
    }

    return selectedBlocks.join('\n\n---\n\n').trim();
}

function buildTextOnlyBatches(textChunks, usedChunkKeys) {
    const batches = [];
    let currentBlocks = [];
    let currentLength = 0;

    for (let i = 0; i < textChunks.length; i += 1) {
        const chunk = textChunks[i];
        const chunkKey = `${chunk.fileName}::${Number(chunk.pageNumber) || 0}::${chunk.label}`;
        if (usedChunkKeys.has(chunkKey)) {
            continue;
        }

        const block = formatTextChunk(chunk);
        if (!block) {
            continue;
        }

        const blockLength = block.length + 5;
        if (
            currentBlocks.length > 0 &&
            currentLength + blockLength > MAX_TEXT_SUMMARY_PER_BATCH_LENGTH
        ) {
            batches.push({
                pages: [],
                textSummary: currentBlocks.join('\n\n---\n\n')
            });
            currentBlocks = [];
            currentLength = 0;
        }

        currentBlocks.push(block);
        currentLength += blockLength;
        usedChunkKeys.add(chunkKey);
    }

    if (currentBlocks.length > 0) {
        batches.push({
            pages: [],
            textSummary: currentBlocks.join('\n\n---\n\n')
        });
    }

    return batches;
}

function buildAIBatches(pages, textChunks) {
    const safePages = Array.isArray(pages) ? pages.filter((page) => page?.dataUrl) : [];
    const safeChunks = Array.isArray(textChunks) ? textChunks.filter(Boolean) : [];
    const adaptiveLimit = getAdaptiveBatchLimits(safePages);
    const pageBatches = [];
    const usedChunkKeys = new Set();
    let currentPages = [];
    let currentBytes = 0;

    for (let i = 0; i < safePages.length; i += 1) {
        const page = safePages[i];
        const pageBytes = estimatePagePayloadBytes(page);
        const shouldStartNewBatch =
            currentPages.length > 0 &&
            (currentPages.length >= adaptiveLimit.maxPages ||
                currentBytes + pageBytes > adaptiveLimit.maxPayloadBytes);

        if (shouldStartNewBatch) {
            pageBatches.push({
                pages: currentPages,
                textSummary: buildBatchTextSummary(currentPages, safeChunks, usedChunkKeys)
            });
            currentPages = [];
            currentBytes = 0;
        }

        currentPages.push(page);
        currentBytes += pageBytes;
    }

    if (currentPages.length > 0) {
        pageBatches.push({
            pages: currentPages,
            textSummary: buildBatchTextSummary(currentPages, safeChunks, usedChunkKeys)
        });
    }

    const textOnlyBatches = buildTextOnlyBatches(safeChunks, usedChunkKeys);
    const batches = [...pageBatches, ...textOnlyBatches];

    if (batches.length === 0) {
        return [{ pages: [], textSummary: '' }];
    }

    console.info(
        '[AI批处理] 总页数=%d，批次数=%d，阈值=%d页/%s',
        safePages.length,
        batches.length,
        adaptiveLimit.maxPages,
        formatBytes(adaptiveLimit.maxPayloadBytes)
    );

    return batches;
}

function reindexSlides(slides) {
    return slides.map((slide, index) => ({
        ...slide,
        id: index + 1
    }));
}

function createPayloadTooLargeError(payloadBytes, maxBytes) {
    const error = new Error(
        `请求体过大（${formatBytes(payloadBytes)}），超过安全阈值 ${formatBytes(maxBytes)}。`
    );
    error.status = 413;
    error.payloadBytes = payloadBytes;
    return error;
}

function isLikelyOversizeOrTransportError(error) {
    const status = Number(error?.status || 0);
    const message = String(error?.message || '').toLowerCase();
    if (status === 408 || status === 413 || status === 429 || status === 502 || status === 503 || status === 504 || status === 524) {
        return true;
    }
    if (error?.name === 'AbortError') {
        return true;
    }
    return (
        message.includes('failed to fetch') ||
        message.includes('network') ||
        message.includes('payload') ||
        message.includes('request body') ||
        message.includes('请求体') ||
        message.includes('超时')
    );
}

function isTimeoutLikeAIError(error) {
    const status = Number(error?.status || 0);
    const message = String(error?.message || '').toLowerCase();
    return (
        status === 408 ||
        status === 504 ||
        status === 524 ||
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('超时') ||
        message.includes('处理时间过长') ||
        message.includes('网关')
    );
}

function splitAIBatch(batch) {
    const pages = Array.isArray(batch?.pages) ? batch.pages : [];
    const half = Math.ceil(pages.length / 2);
    return [
        {
            pages: pages.slice(0, half),
            textSummary: batch?.textSummary || ''
        },
        {
            pages: pages.slice(half),
            textSummary: batch?.textSummary || ''
        }
    ].filter((item) => item.pages.length > 0 || item.textSummary);
}

function splitTextSummary(textSummary) {
    const text = String(textSummary || '').trim();
    if (text.length < 800) {
        return [];
    }

    const middle = Math.floor(text.length / 2);
    const separators = ['\n\n---\n\n', '\n\n', '。', '\n'];
    let splitAt = middle;

    for (const separator of separators) {
        const leftIndex = text.lastIndexOf(separator, middle);
        const rightIndex = text.indexOf(separator, middle);
        const candidates = [leftIndex, rightIndex]
            .filter((index) => index > 200 && index < text.length - 200)
            .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
        if (candidates.length > 0) {
            splitAt = candidates[0] + separator.length;
            break;
        }
    }

    const left = text.slice(0, splitAt).trim();
    const right = text.slice(splitAt).trim();
    if (!left || !right) {
        return [];
    }

    return [
        { pages: [], textSummary: left },
        { pages: [], textSummary: right }
    ];
}

function getSegmentTextSummary(page, segmentIndex, segmentCount, fallbackText = '') {
    const text = String(page?.text || fallbackText || '').trim();
    if (!text) {
        return '';
    }

    const chunkSize = Math.ceil(text.length / segmentCount);
    const start = Math.max(0, segmentIndex * chunkSize - Math.floor(chunkSize * 0.12));
    const end = Math.min(text.length, (segmentIndex + 1) * chunkSize + Math.floor(chunkSize * 0.12));
    return text.slice(start, end).trim().slice(0, SEGMENT_TEXT_SUMMARY_LENGTH);
}

async function createPageSegmentBatch(batch, segmentIndex, segmentCount) {
    const page = Array.isArray(batch?.pages) ? batch.pages[0] : null;
    if (!page?.dataUrl) {
        return null;
    }

    const image = await loadImageElement(page.dataUrl);
    if (!image) {
        return null;
    }

    const sourceWidth = image.naturalWidth || image.width || page.width || 1;
    const sourceHeight = image.naturalHeight || image.height || page.height || 1;
    const parentSegment = batch?.segmentMeta || null;
    const parentStartRatio = parentSegment
        ? clampNumber(parentSegment.yStartRatio, 0, 1)
        : 0;
    const parentEndRatio = parentSegment
        ? clampNumber(parentSegment.yEndRatio, parentStartRatio, 1)
        : 1;
    const parentHeightRatio = Math.max(0.01, parentEndRatio - parentStartRatio);
    const overlapRatio = 0.08;
    const segmentHeightRatio = 1 / segmentCount;
    const yStartRatio = Math.max(0, segmentIndex * segmentHeightRatio - overlapRatio);
    const yEndRatio = Math.min(1, (segmentIndex + 1) * segmentHeightRatio + overlapRatio);
    const originalYStartRatio = parentStartRatio + yStartRatio * parentHeightRatio;
    const originalYEndRatio = parentStartRatio + yEndRatio * parentHeightRatio;
    const sourceY = Math.floor(sourceHeight * yStartRatio);
    const sourceH = Math.max(1, Math.ceil(sourceHeight * (yEndRatio - yStartRatio)));

    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, sourceY, sourceWidth, sourceH, 0, 0, canvas.width, canvas.height);

    const segmentPage = createOptimizedPage({
        source: canvas,
        sourceWidth: canvas.width,
        sourceHeight: canvas.height,
        id: `${page.id}_S${segmentIndex + 1}`,
        fileName: page.fileName,
        pageNumber: page.pageNumber,
        sourceType: `${page.sourceType || 'page'}-segment`,
        text: getSegmentTextSummary(page, segmentIndex, segmentCount, batch?.textSummary),
        encodeOptions: {
            targetBytes: Math.max(MIN_TRANSPORT_PAGE_IMAGE_BYTES, 260 * 1024),
            maxLongEdge: 980,
            minLongEdge: 560,
            initialQuality: 0.72,
            minQuality: 0.38
        }
    });

    canvas.width = 0;
    canvas.height = 0;

    return {
        pages: [segmentPage],
        textSummary: segmentPage.text || '',
        segmentMeta: {
            originalPageId: parentSegment?.originalPageId || page.id,
            originalFileName: parentSegment?.originalFileName || page.fileName,
            originalPageNumber: parentSegment?.originalPageNumber || page.pageNumber,
            yStartRatio: originalYStartRatio,
            yEndRatio: originalYEndRatio
        }
    };
}

async function degradeSinglePageBatch(batch, degradeLevel) {
    const page = Array.isArray(batch?.pages) ? batch.pages[0] : null;
    if (!page?.dataUrl) {
        return batch;
    }

    const pageBytes = estimatePagePayloadBytes(page);
    const ratio = Math.max(0.45, 0.82 - degradeLevel * 0.12);
    const targetBytes = Math.max(
        MIN_TRANSPORT_PAGE_IMAGE_BYTES,
        Math.floor(pageBytes * ratio)
    );
    const maxLongEdge = Math.max(720, Math.floor(TRANSPORT_MAX_LONG_EDGE * Math.pow(0.86, degradeLevel)));
    const minLongEdge = Math.max(520, Math.floor(TRANSPORT_MIN_LONG_EDGE * Math.pow(0.84, degradeLevel)));

    const compressedPage = await recompressPageForTransport(page, {
        targetBytes,
        maxLongEdge,
        minLongEdge,
        initialQuality: Math.max(0.45, PAGE_IMAGE_JPEG_QUALITY - degradeLevel * 0.08),
        minQuality: Math.max(0.32, TRANSPORT_MIN_JPEG_QUALITY - degradeLevel * 0.05)
    });

    return {
        ...batch,
        pages: [compressedPage]
    };
}

async function resolveAIBatchWithFallback({
    batch,
    fileNames,
    batchIndex,
    totalBatches,
    usageOperationKey,
    pathLabel = '',
    depth = 0,
    degradeLevel = 0,
    textSplitDepth = 0
}) {
    const pageCount = Array.isArray(batch?.pages) ? batch.pages.length : 0;
    const payloadHint =
        pageCount > 0
            ? formatBytes(getTotalPagesPayloadBytes(batch.pages))
            : formatBytes(estimateStringBytes(batch?.textSummary || ''));
    const batchName = pathLabel
        ? `第 ${batchIndex}/${totalBatches} 批-${pathLabel}`
        : `第 ${batchIndex}/${totalBatches} 批`;

    showProcessing(`AI正在识别题目（${batchName}，${pageCount} 页，载荷约 ${payloadHint}）...`);

    try {
        const aiResponse = await callAIAPI({
            pages: batch.pages,
            textSummary: batch.textSummary,
            fileNames,
            batchIndex,
            totalBatches,
            usageOperationKey,
            onRetry: (retryCount) => {
                showProcessing(
                    `${batchName} 请求异常，自动重试中（${retryCount}/${AI_CONFIG.retryCount}）...`
                );
            }
        });
        try {
            return parseAIResponse(aiResponse);
        } catch (error) {
            if (error?.code !== 'ACADEMIC_FORMULA_INVALID') {
                throw error;
            }

            return repairAcademicFormulaFields({
                slides: error.slides,
                violations: error.violations,
                batch,
                fileNames,
                batchIndex,
                totalBatches,
                batchName,
                usageOperationKey
            });
        }
    } catch (error) {
        const canDegrade = isLikelyOversizeOrTransportError(error);
        if (!canDegrade) {
            throw error;
        }

        if (pageCount === 0 && batch?.textSummary && textSplitDepth < MAX_AI_TEXT_SPLIT_DEPTH) {
            const textBatches = splitTextSummary(batch.textSummary);
            if (textBatches.length === 2) {
                showProcessing(`${batchName} 文本内容较长，正在拆分后重试...`);
                const leftSlides = await resolveAIBatchWithFallback({
                    batch: textBatches[0],
                    fileNames,
                    batchIndex,
                    totalBatches,
                    usageOperationKey,
                    pathLabel: `${pathLabel || 'T'}A`,
                    depth,
                    degradeLevel,
                    textSplitDepth: textSplitDepth + 1
                });
                const rightSlides = await resolveAIBatchWithFallback({
                    batch: textBatches[1],
                    fileNames,
                    batchIndex,
                    totalBatches,
                    usageOperationKey,
                    pathLabel: `${pathLabel || 'T'}B`,
                    depth,
                    degradeLevel,
                    textSplitDepth: textSplitDepth + 1
                });
                return [...leftSlides, ...rightSlides];
            }
        }

        if (pageCount === 1 && isTimeoutLikeAIError(error) && depth < MAX_AI_BATCH_SPLIT_DEPTH) {
            const segmentCount = 2;
            const segmentSlides = [];
            showProcessing(`${batchName} 单页识别耗时较长，正在分段识别后合并...`);
            for (let i = 0; i < segmentCount; i += 1) {
                const segmentBatch = await createPageSegmentBatch(batch, i, segmentCount);
                if (!segmentBatch) {
                    continue;
                }
                const slides = await resolveAIBatchWithFallback({
                    batch: segmentBatch,
                    fileNames,
                    batchIndex,
                    totalBatches,
                    usageOperationKey,
                    pathLabel: `${pathLabel || 'P'}${i + 1}`,
                    depth: depth + 1,
                    degradeLevel,
                    textSplitDepth
                });
                segmentSlides.push(...mapSegmentSlidesToOriginalPage(slides, segmentBatch.segmentMeta));
            }

            if (segmentSlides.length > 0) {
                return dedupeSlidesByContent(segmentSlides);
            }
        }

        if (pageCount > 1 && depth < MAX_AI_BATCH_SPLIT_DEPTH) {
            const [leftBatch, rightBatch] = splitAIBatch(batch);
            if (leftBatch && rightBatch) {
                showProcessing(`${batchName} 载荷过大，正在自动拆分后重试...`);
                const leftSlides = await resolveAIBatchWithFallback({
                    batch: leftBatch,
                    fileNames,
                    batchIndex,
                    totalBatches,
                    usageOperationKey,
                    pathLabel: `${pathLabel || 'S'}A`,
                    depth: depth + 1,
                    degradeLevel,
                    textSplitDepth
                });
                const rightSlides = await resolveAIBatchWithFallback({
                    batch: rightBatch,
                    fileNames,
                    batchIndex,
                    totalBatches,
                    usageOperationKey,
                    pathLabel: `${pathLabel || 'S'}B`,
                    depth: depth + 1,
                    degradeLevel,
                    textSplitDepth
                });
                return [...leftSlides, ...rightSlides];
            }
        }

        if (pageCount === 1 && degradeLevel < MAX_SINGLE_PAGE_DEGRADE_LEVEL) {
            showProcessing(
                `${batchName} 单页仍然过大，正在降采样重试（${degradeLevel + 1}/${MAX_SINGLE_PAGE_DEGRADE_LEVEL}）...`
            );
            const degradedBatch = await degradeSinglePageBatch(batch, degradeLevel + 1);
            return resolveAIBatchWithFallback({
                batch: degradedBatch,
                fileNames,
                batchIndex,
                totalBatches,
                usageOperationKey,
                pathLabel: pathLabel || 'S',
                depth,
                degradeLevel: degradeLevel + 1,
                textSplitDepth
            });
        }

        if (pageCount === 1 && depth < MAX_AI_BATCH_SPLIT_DEPTH) {
            const segmentCount = 2;
            const segmentSlides = [];
            showProcessing(`${batchName} 单页题量较密，正在分段识别后合并...`);
            for (let i = 0; i < segmentCount; i += 1) {
                const segmentBatch = await createPageSegmentBatch(batch, i, segmentCount);
                if (!segmentBatch) {
                    continue;
                }
                const slides = await resolveAIBatchWithFallback({
                    batch: segmentBatch,
                    fileNames,
                    batchIndex,
                    totalBatches,
                    usageOperationKey,
                    pathLabel: `${pathLabel || 'P'}${i + 1}`,
                    depth: depth + 1,
                    degradeLevel,
                    textSplitDepth
                });
                segmentSlides.push(...mapSegmentSlidesToOriginalPage(slides, segmentBatch.segmentMeta));
            }

            if (segmentSlides.length > 0) {
                return dedupeSlidesByContent(segmentSlides);
            }
        }

        throw error;
    }
}

function normalizeComparableText(text) {
    return String(text || '')
        .replace(/\s+/g, '')
        .replace(/[，。！？；：,.!?;:]/g, '')
        .slice(0, 120);
}

function dedupeSlidesByContent(slides) {
    const seen = new Set();
    const result = [];

    for (const slide of Array.isArray(slides) ? slides : []) {
        const key = normalizeComparableText(slide?.question || '');
        if (key && seen.has(key)) {
            continue;
        }
        if (key) {
            seen.add(key);
        }
        result.push(slide);
    }

    return result;
}

function mapSegmentBoxToOriginal(box, segmentMeta) {
    const normalizedBox = normalizeBBox(box);
    if (!normalizedBox || !segmentMeta) {
        return normalizedBox;
    }

    const yStartRatio = clampNumber(segmentMeta.yStartRatio, 0, 1);
    const yEndRatio = clampNumber(segmentMeta.yEndRatio, yStartRatio, 1);
    const segmentHeightRatio = Math.max(0.01, yEndRatio - yStartRatio);
    const mappedY = yStartRatio + normalizedBox.y * segmentHeightRatio;
    const mappedHeight = normalizedBox.height * segmentHeightRatio;

    return normalizeBBox({
        x: normalizedBox.x,
        y: mappedY,
        width: normalizedBox.width,
        height: mappedHeight
    });
}

function mapSegmentFigureToOriginalPage(figure, segmentMeta) {
    if (!figure || !segmentMeta) {
        return figure;
    }

    const mappedBoxes = getFigureBoxes(figure)
        .map((box) => mapSegmentBoxToOriginal(box, segmentMeta))
        .filter(Boolean);
    const mappedBBox = mergeBBoxes(mappedBoxes);

    return {
        ...figure,
        sourcePageId: segmentMeta.originalPageId || figure.sourcePageId,
        sourceFile: segmentMeta.originalFileName || figure.sourceFile,
        sourcePage: segmentMeta.originalPageNumber || figure.sourcePage,
        bbox: mappedBBox,
        bboxes: mappedBoxes
    };
}

function mapSegmentSlidesToOriginalPage(slides, segmentMeta) {
    return (Array.isArray(slides) ? slides : []).map((slide) => ({
        ...slide,
        figure: mapSegmentFigureToOriginalPage(slide.figure, segmentMeta)
    }));
}

async function identifyQuestionsWithAI(parsedResult, fileNames, usageOperationKey) {
    const batches = buildAIBatches(parsedResult.pages, parsedResult.textChunks);
    const combinedSlides = [];

    for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i];
        const slides = await resolveAIBatchWithFallback({
            batch,
            fileNames,
            batchIndex: i + 1,
            totalBatches: batches.length,
            usageOperationKey
        });
        combinedSlides.push(...slides);
    }

    return reindexSlides(combinedSlides);
}

function safeParseJSON(text) {
    const raw = String(text || '').trim();
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw);
    } catch (_error) {
        return null;
    }
}

function isHTMLErrorText(text) {
    const raw = String(text || '').trim();
    return /^<!doctype\s+html/i.test(raw) || /^<html[\s>]/i.test(raw);
}

async function ensureUsageTokenForAI(options = {}) {
    await detectLocalAIRuntime();
    if (AI_CONFIG.localRuntime) {
        return 'local-runtime';
    }

    const force = Boolean(options.force);
    const suppressCreditReject = Boolean(options.suppressCreditReject);
    const currentToken =
        window.HZQ && typeof window.HZQ.getUsageToken === 'function'
            ? window.HZQ.getUsageToken()
            : '';

    if (!force && currentToken) {
        return currentToken;
    }

    if (!window.HZQ || typeof window.HZQ.checkCredit !== 'function') {
        const error = new Error('权限模块未加载，请刷新页面后重试。');
        error.status = 402;
        throw error;
    }

    const pass = await window.HZQ.checkCredit();
    if (!pass) {
        if (suppressCreditReject) {
            return '';
        }
        const error = new Error('请先完成登录、免费体验或积分扣除后再使用功能。');
        error.status = 402;
        throw error;
    }

    return typeof window.HZQ.getUsageToken === 'function'
        ? window.HZQ.getUsageToken()
        : '';
}

async function completeUsageOperation(usageOperationKey) {
    await detectLocalAIRuntime();
    if (!AI_CONFIG.platformRuntime) {
        return;
    }

    const response = await fetch('/api/usage-operation/complete', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'X-HZQ-Usage-Operation': usageOperationKey
        }
    });
    const rawText = await response.text();
    const data = safeParseJSON(rawText);
    if (!response.ok) {
        const error = new Error(getAPIErrorMessage(response.status, data, rawText));
        error.status = response.status;
        error.code = data?.code || '';
        throw error;
    }
}

function buildAIRequestHeaders(usageOperationKey = '') {
    const headers = {
        'Content-Type': 'application/json'
    };
    if (usageOperationKey) {
        headers['X-HZQ-Usage-Operation'] = usageOperationKey;
    }

    if (AI_CONFIG.localRuntime) {
        return headers;
    }
    const token =
        window.HZQ && typeof window.HZQ.getUsageToken === 'function'
            ? window.HZQ.getUsageToken()
            : '';
    if (token) {
        headers['X-HZQ-Usage-Token'] = token;
    }
    return headers;
}

function getAPIErrorMessage(status, data, rawText) {
    const rawLooksLikeHTML = isHTMLErrorText(rawText);
    const serviceMessage =
        (typeof data?.error === 'string' ? data.error : data?.error?.message) ||
        data?.message ||
        (!rawLooksLikeHTML && typeof rawText === 'string' ? rawText.trim().slice(0, 200) : '');

    if (status === 402) {
        return serviceMessage || '请先完成登录、免费体验或积分扣除后再使用功能。';
    }

    if (status === 413) {
        return '上传内容过大，系统已自动压缩并分批处理；若仍超限将继续拆批重试。';
    }

    if (status === 429) {
        return 'AI服务当前较忙，已触发限流，请稍后重试。';
    }

    if (status === 504) {
        return 'AI服务处理超时，系统会自动缩小批次后重试。';
    }

    if (status === 524) {
        return 'AI服务处理时间过长，系统会自动拆分内容并重试。';
    }

    if (status >= 500) {
        return `AI服务暂时不可用（${status}）。${serviceMessage || '系统会自动重试，请稍后。'}`;
    }

    return `API请求失败：${status}${serviceMessage ? `，${serviceMessage}` : ''}`;
}

function isRetryableRequestError(error) {
    const status = Number(error?.status || 0);
    if (status === 402) {
        return true;
    }
    if (status === 504 || status === 524) {
        return false;
    }
    if (status === 408 || status === 429) {
        return true;
    }
    if (status >= 500 && status < 600) {
        return true;
    }
    if (error?.name === 'AbortError') {
        return true;
    }
    return error instanceof TypeError || /Failed to fetch/i.test(String(error?.message || ''));
}

function normalizeRequestError(error, timeoutMs) {
    const status = Number(error?.status || 0);

    if (status === 413) {
        const oversizedError = new Error(
            '上传内容仍然超过服务限制，请减少单次上传页数或拆分大文件后重试。'
        );
        oversizedError.status = status;
        return oversizedError;
    }

    if (error?.name === 'AbortError') {
        const timeoutError = new Error(
            `AI请求超时（${Math.round(timeoutMs / 1000)} 秒），请稍后重试。`
        );
        timeoutError.status = status;
        return timeoutError;
    }

    if (error instanceof TypeError || /Failed to fetch/i.test(String(error?.message || ''))) {
        const networkError = new Error(
            '网络请求失败，可能是网络中断、服务暂时不可用或请求体超限。系统将自动拆分并降载重试。'
        );
        networkError.status = status;
        return networkError;
    }

    if (error instanceof Error) {
        return error;
    }

    const fallbackError = new Error(String(error || 'AI请求失败。'));
    fallbackError.status = status;
    return fallbackError;
}

async function postJSONWithRetry(url, payload, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || AI_CONFIG.timeoutMs;
    const retryCount = Number(options.retryCount ?? AI_CONFIG.retryCount);
    const retryDelayMs = Number(options.retryDelayMs ?? AI_CONFIG.retryDelayMs);
    const usageOperationKey = String(options.usageOperationKey || '');
    const requestBody = JSON.stringify(payload);
    let lastError = null;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        const controller =
            typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller
            ? setTimeout(() => {
                controller.abort();
            }, timeoutMs)
            : null;

        try {
            if (
                !AI_CONFIG.localRuntime
                && !buildAIRequestHeaders(usageOperationKey)['X-HZQ-Usage-Token']
            ) {
                await ensureUsageTokenForAI();
            }
            const response = await fetch(url, {
                method: 'POST',
                headers: buildAIRequestHeaders(usageOperationKey),
                body: requestBody,
                signal: controller?.signal
            });

            const rawText = await response.text();
            const data = safeParseJSON(rawText);

            if (!response.ok) {
                const apiError = new Error(getAPIErrorMessage(response.status, data, rawText));
                apiError.status = response.status;
                apiError.usageTokenInvalid =
                    response.status === 402 ||
                    response.headers.get('x-hzq-usage-token-invalid') === '1';
                throw apiError;
            }

            if (!data) {
                throw new Error('AI接口返回了空响应或非法JSON。');
            }

            if (data.error) {
                const streamError = new Error(data.error || 'AI接口返回错误。');
                streamError.status = Number(data.status || response.status || 500);
                throw streamError;
            }

            return data;
        } catch (error) {
            const normalizedError = normalizeRequestError(error, timeoutMs);
            const canRetry = attempt < retryCount && isRetryableRequestError(error);

            if (!canRetry) {
                throw normalizedError;
            }

            if (error?.usageTokenInvalid) {
                showProcessing('体验次数或积分凭证已刷新，正在继续生成...');
                await ensureUsageTokenForAI({ force: true });
            }

            lastError = normalizedError;
            if (typeof options.onRetry === 'function') {
                options.onRetry(attempt + 1, normalizedError);
            }
            await waitMilliseconds(retryDelayMs * Math.pow(2, attempt));
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    throw lastError || new Error('AI请求失败。');
}

async function callAIAPI({
    pages,
    textSummary,
    fileNames,
    batchIndex = 1,
    totalBatches = 1,
    usageOperationKey,
    onRetry
}) {
    const pageIndexText = pages
        .map((page) => `${page.id}：${createPageLabel(page)}`)
        .join('\n');
    const batchInstruction =
        totalBatches > 1
            ? `当前仅处理第 ${batchIndex}/${totalBatches} 批页面，请只输出本批页面中的题目，禁止重复输出其他批次的题目。`
            : '请识别当前上传内容中的全部题目。';

    const prompt = `你是一个专业的试卷讲评课件助手。请基于上传文件内容识别所有题目，并输出可直接用于生成课件的数据。

${batchInstruction}

请严格返回 JSON 数组（不要 markdown 代码块），格式如下：
[
  {
    "id": 1,
    "type": "选择题/填空题/解答题",
    "subject": "数学/物理/化学/生物/地理/语文/英语/政治/历史/综合",
    "difficulty": "简单/中等难度/较难",
    "score": 5,
    "question": "完整题目内容",
    "options": [
      {"letter": "A", "text": "选项内容", "correct": false}
    ],
    "answer": "所有题目的答案；选择题填写正确选项字母",
    "analysis": "分步骤讲解，便于课堂讲评",
    "knowledge": ["知识点1", "知识点2"],
    "figure": {
      "exists": true,
      "description": "图形简述",
      "source_page_id": "P3",
      "source_file": "文件名.pdf",
      "source_page": 2,
      "bbox": {"x": 0.12, "y": 0.18, "width": 0.42, "height": 0.30},
      "bboxes": [
        {"x": 0.12, "y": 0.18, "width": 0.22, "height": 0.24},
        {"x": 0.40, "y": 0.20, "width": 0.14, "height": 0.20}
      ]
    }
  }
]

规则要求：
1. 识别到图形时，figure.exists 必须为 true，且 bbox 必须覆盖该题的所有相关图形（相对坐标，范围 0~1）。
2. 没有图形时，figure.exists 为 false，description 置空，bbox 置 null。
3. source_page_id 必须使用我提供的页面编号（例如 P1、P2）。
4. 选择题必须完整返回全部 options、正确项的 correct=true，并在 answer 中填写正确选项字母；非选择题必须返回完整 answer。
5. analysis 要可讲、可读，拆分为步骤化解释。
6. 输出必须是合法 JSON，不要额外说明文字。
7. question、options.text、answer、analysis、knowledge 中的所有学科符号与公式必须使用规范 LaTeX：行内公式写为 \\(...\\)，独立公式写为 \\[...\\]。禁止输出 sqrt(3)、x^2、2*sqrt(2)、sin(theta)、H2SO4、-> 等程序式或纯文本公式。
   - 数学：使用 \\frac、\\sqrt、上下标、\\sin、\\cos、\\tan、\\log、\\lim、\\sum、\\int、集合、概率、矩阵和几何命令。例如 \\(\\frac{\\sqrt{3}}{2}\\)、\\(y=(x-3)^2\\)、\\(\\sin\\theta\\)。
   - 物理：矢量使用 \\vec 或 \\overrightarrow，单位使用 \\mathrm，科学计数法使用 \\times 10^{n}。例如 \\(\\vec{F}=m\\vec{a}\\)、\\(9.8\\,\\mathrm{m\\,s^{-2}}\\)。
   - 化学：分子式、离子、电荷、状态和反应式统一放在 \\ce{} 中。例如 \\(\\ce{2H2 + O2 -> 2H2O}\\)、\\(\\ce{Fe^{3+}}\\)。
   - 生物：遗传、统计公式使用数学 LaTeX，基因型和核酸序列使用 \\mathrm。例如 \\(p^2+2pq+q^2=1\\)、\\(\\mathrm{5'-ATCG-3'}\\)。
   - 地理：经纬度、角度、比例尺、太阳高度、时区与单位使用标准上标和正体单位。例如 \\(30^\\circ\\mathrm{N}\\)、\\(h=90^\\circ-|\\varphi-\\delta|\\)。
   - JSON 必须合法，LaTeX 反斜杠必须按 JSON 字符串规则正确转义；不得因为转义而丢失公式命令。
8. 按页面与题目出现顺序输出，不要省略题目，不要臆造不存在的题目。
9. 当同一道题有多个分离图形时，必须返回 bboxes 数组列出全部图形框，并保证 bbox 是它们的总覆盖框。
10. 图形框必须完整包住坐标轴、题图文字标注、几何辅助线、函数图像、表格、统计图等所有与本题相关的图形元素，宁可保留少量题图周边空白，也不要裁掉任何图形边缘。
11. 图形框必须限定在“当前题目相关图形”的边界附近，禁止包含其他题目的图形或装饰内容。
12. 若原题有图形但边界不确定，仍需将 figure.exists 设为 true，并给出覆盖完整图形的最大合理 bbox；禁止因为边界不确定而丢弃题图。
13. 每道题必须返回 knowledge，至少 1 个，最多 4 个，使用课堂可直接呈现的短知识点名称。

已上传文件：${fileNames.join('、')}

页面编号索引：
${pageIndexText || '（无图像页面，仅文本）'}
`;

    const content = [{ type: 'text', text: prompt }];

    if (textSummary) {
        content.push({
            type: 'text',
            text: `文档文本摘录（用于补充识别）：\n${textSummary}`
        });
    }

    pages.forEach((page) => {
        content.push({
            type: 'text',
            text: `页面 ${page.id}（${createPageLabel(page)}）`
        });
        content.push({
            type: 'image_url',
            image_url: {
                url: page.dataUrl
            }
        });
    });

    const requestPayload = {
        messages: [{ role: 'user', content }],
        max_tokens: 8192,
        temperature: 0.2
    };
    const payloadBytes = estimateStringBytes(JSON.stringify(requestPayload));
    if (payloadBytes > MAX_AI_REQUEST_BODY_BYTES) {
        throw createPayloadTooLargeError(payloadBytes, MAX_AI_REQUEST_BODY_BYTES);
    }

    const data = await postJSONWithRetry(AI_CONFIG.apiUrl, requestPayload, {
        timeoutMs: AI_CONFIG.timeoutMs,
        retryCount: AI_CONFIG.retryCount,
        retryDelayMs: AI_CONFIG.retryDelayMs,
        usageOperationKey,
        onRetry
    });

    return data?.choices?.[0]?.message?.content || '';
}

async function callAIFormulaRepair({
    batch,
    slides,
    violations,
    fileNames,
    batchIndex,
    totalBatches,
    attempt,
    usageOperationKey,
    onRetry
}) {
    if (!window.AcademicRepair?.buildRepairPrompt) {
        const error = new Error('公式修复模块未加载，无法完成严格质量校验。');
        error.code = 'ACADEMIC_FORMULA_ENGINE_MISSING';
        throw error;
    }

    const prompt = window.AcademicRepair.buildRepairPrompt({
        slides,
        violations,
        attempt,
        maxAttempts: MAX_ACADEMIC_REPAIR_ATTEMPTS
    });
    const content = [{
        type: 'text',
        text: `${prompt}\n\n文件：${fileNames.join('、')}\n批次：${batchIndex}/${totalBatches}`
    }];

    if (batch?.textSummary) {
        content.push({
            type: 'text',
            text: `原文文本摘录（只用于核对被诊断字段）：\n${batch.textSummary}`
        });
    }

    (Array.isArray(batch?.pages) ? batch.pages : []).forEach((page) => {
        content.push({
            type: 'text',
            text: `原试卷页面 ${page.id}（${createPageLabel(page)}）`
        });
        content.push({
            type: 'image_url',
            image_url: { url: page.dataUrl }
        });
    });

    const requestPayload = {
        messages: [{ role: 'user', content }],
        max_tokens: 4096,
        temperature: 0
    };
    const payloadBytes = estimateStringBytes(JSON.stringify(requestPayload));
    if (payloadBytes > MAX_AI_REQUEST_BODY_BYTES) {
        throw createPayloadTooLargeError(payloadBytes, MAX_AI_REQUEST_BODY_BYTES);
    }

    const data = await postJSONWithRetry(AI_CONFIG.apiUrl, requestPayload, {
        timeoutMs: AI_CONFIG.timeoutMs,
        retryCount: AI_CONFIG.retryCount,
        retryDelayMs: AI_CONFIG.retryDelayMs,
        usageOperationKey,
        onRetry
    });
    return data?.choices?.[0]?.message?.content || '';
}

async function repairAcademicFormulaFields({
    slides,
    violations,
    batch,
    fileNames,
    batchIndex,
    totalBatches,
    batchName,
    usageOperationKey
}) {
    let candidateSlides = Array.isArray(slides) ? slides : [];
    let currentViolations = Array.isArray(violations)
        ? violations
        : collectAcademicFormulaViolations(candidateSlides);
    let lastRepairError = null;

    while (currentViolations.length > 0) {
        for (let attempt = 1; attempt <= MAX_ACADEMIC_REPAIR_ATTEMPTS; attempt += 1) {
            const summary = window.AcademicRepair?.summarizeViolations?.(currentViolations) || '公式字段';
            showProcessing(
                `${batchName} 检出 ${currentViolations.length} 个问题字段，正在精确修复 ${summary}（${attempt}/${MAX_ACADEMIC_REPAIR_ATTEMPTS}）...`,
                '正在校验公式'
            );

            try {
                const repairResponse = await callAIFormulaRepair({
                    batch,
                    slides: candidateSlides,
                    violations: currentViolations,
                    fileNames,
                    batchIndex,
                    totalBatches,
                    attempt,
                    usageOperationKey,
                    onRetry: (retryCount) => {
                        showProcessing(
                            `${summary} 修复请求重试中（${retryCount}/${AI_CONFIG.retryCount}）...`,
                            '正在校验公式'
                        );
                    }
                });

                candidateSlides = window.AcademicRepair.applyRepairResponse(
                    candidateSlides,
                    currentViolations,
                    repairResponse,
                    normalizeAcademicText
                );
                currentViolations = collectAcademicFormulaViolations(candidateSlides);
                if (currentViolations.length === 0) {
                    return candidateSlides;
                }

                lastRepairError = new Error('字段补丁仍未通过公式结构校验。');
            } catch (error) {
                if (error?.code !== 'ACADEMIC_REPAIR_RESPONSE_INVALID') {
                    throw error;
                }
                lastRepairError = error;
            }
        }

        const summary = window.AcademicRepair?.summarizeViolations?.(currentViolations) || '部分题目公式';
        const error = new Error(`公式字段定向修复未通过：${summary}`);
        error.code = 'ACADEMIC_FORMULA_REPAIR_EXHAUSTED';
        error.status = 422;
        error.violations = currentViolations;
        error.repairCause = lastRepairError?.message || '';
        error.userMessage = `${summary}没有完整返回。当前生成进度已保留，可继续修复。`;
        await waitForProcessingRetry(error);
        lastRepairError = null;
    }

    return candidateSlides;
}

function parseAIResponse(responseText) {
    try {
        if (!window.PptAIJson?.parseResponse) {
            throw new Error('AI 响应解析模块未加载。');
        }
        const parsed = window.PptAIJson.parseResponse(responseText);
        const rawSlides = extractSlideRecords(parsed);
        if (rawSlides.length === 0) {
            const error = new Error('AI 未返回任何可用题目，请重试。');
            error.code = 'AI_RESPONSE_EMPTY';
            error.status = 422;
            error.userMessage = error.message;
            throw error;
        }

        const slides = rawSlides.map((item, index) => normalizeSlide(item, index));
        assertAcademicFormulaQuality(slides);
        return slides;
    } catch (error) {
        if (String(error?.code || '').startsWith('ACADEMIC_') || error?.code === 'AI_RESPONSE_EMPTY') {
            throw error;
        }
        console.error('AI响应解析失败:', error, responseText);
        throw new Error('AI响应格式异常，请重试。');
    }
}

function extractSlideRecords(payload, depth = 0) {
    if (depth > 4 || payload == null) return [];
    if (Array.isArray(payload)) return payload;
    if (typeof payload !== 'object') return [];

    for (const key of ['slides', 'questions', 'items', 'data', 'result', 'output']) {
        const records = extractSlideRecords(payload[key], depth + 1);
        if (records.length > 0) return records;
    }
    return [];
}

function collectAcademicFormulaViolations(slides) {
    if (!window.AcademicMath?.findFormulaIssues || !window.AcademicRepair?.collectViolations) {
        const error = new Error('公式质量校验模块未完整加载。');
        error.code = 'ACADEMIC_FORMULA_ENGINE_MISSING';
        throw error;
    }
    return window.AcademicRepair.collectViolations(slides, window.AcademicMath);
}

function assertAcademicFormulaQuality(slides) {
    const violations = collectAcademicFormulaViolations(slides);

    if (violations.length > 0) {
        const detail = violations
            .slice(0, 3)
            .map((violation) => `第 ${violation.slideId} 题${violation.fieldLabel}：${violation.issues[0].fragment}`)
            .join('；');
        const error = new Error(`AI 返回的学科公式仍不规范：${detail}`);
        error.code = 'ACADEMIC_FORMULA_INVALID';
        error.status = 422;
        error.slides = slides;
        error.violations = violations;
        throw error;
    }
}

function normalizeSlide(item, index) {
    const id = Number(item.id) || index + 1;
    const subject = String(item.subject || '综合').trim();
    let answer = normalizeAcademicText(item.answer || '', subject);
    const options = normalizeOptions(item.options || [], subject, answer, item.analysis);
    if (!answer) {
        answer = options.filter((option) => option.correct).map((option) => option.letter).join('、');
    }
    const knowledge = normalizeKnowledge(item.knowledge || [], subject);
    const figure = normalizeFigure(item.figure || item.diagram || {});

    return {
        id,
        type: String(item.type || '题目').trim(),
        subject,
        difficulty: String(item.difficulty || '中等难度').trim(),
        score: Number(item.score) > 0 ? Number(item.score) : 5,
        question: normalizeAcademicText(item.question || '题目内容未识别', subject),
        options,
        answer,
        analysis: normalizeAcademicText(item.analysis || '暂无解析', subject),
        knowledge,
        figure
    };
}

function normalizeAcademicText(value, subject = '综合') {
    const text = String(value || '').trim();
    if (!text || !window.AcademicMath?.normalizeText) {
        return text;
    }
    return window.AcademicMath.normalizeText(text, subject);
}

function normalizeOptions(options, subject = '综合', answer = '', analysis = '') {
    if (!Array.isArray(options)) {
        return [];
    }
    const normalized = options
        .map((opt, idx) => ({
            letter: String(opt.letter || String.fromCharCode(65 + idx)).trim(),
            text: normalizeAcademicText(opt.text || '', subject),
            correct: normalizeBooleanFlag(opt.correct)
        }))
        .filter((opt) => opt.text);
    if (!normalized.some((option) => option.correct)) {
        const inferredLetters = extractChoiceAnswerLetters(answer, analysis);
        normalized.forEach((option) => {
            option.correct = inferredLetters.has(option.letter.toUpperCase());
        });
    }
    return normalized;
}

function normalizeBooleanFlag(value) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    return ['true', '1', 'yes', '是', '正确'].includes(normalized);
}

function extractChoiceAnswerLetters(answer, analysis) {
    const direct = String(answer || '').trim().toUpperCase();
    const source = /^[A-H](?:[、,，\s]+[A-H])*$/u.test(direct)
        ? direct
        : String(analysis || '').toUpperCase().match(/(?:答案|故选|选择|正确选项)(?:为|是)?[：:\s]*([A-H](?:[、,，\s]+[A-H])*)/u)?.[1] || '';
    return new Set(source.match(/[A-H]/gu) || []);
}

function normalizeKnowledge(knowledge, subject = '综合') {
    if (!Array.isArray(knowledge)) {
        return ['待补充'];
    }

    const list = knowledge
        .map((item) => normalizeAcademicText(item || '', subject))
        .filter(Boolean)
        .slice(0, 4);

    return list.length > 0 ? list : ['待补充'];
}

function hasAnswerVisible() {
    return Boolean(answerVisibilityToggle?.checked);
}

function hasExplanationPathVisible() {
    return Boolean(explanationPathToggle?.checked);
}

function normalizeFigure(figure) {
    const normalizedBoxes = getFigureBoxes(figure);
    const mergedBox = mergeBBoxes(normalizedBoxes);

    const sourcePageId = String(figure.source_page_id || figure.sourcePageId || '').trim();
    const sourceFile = String(figure.source_file || figure.sourceFile || '').trim();
    const sourcePage = Number(figure.source_page || figure.sourcePage || 0) || null;
    const description = String(figure.description || '').trim();
    const hasBox = mergedBox && mergedBox.width > 0.02 && mergedBox.height > 0.02;
    const modelReportedFigure = getBooleanFlag(figure.exists || figure.has_figure || figure.hasFigure);
    const exists = Boolean(modelReportedFigure || hasBox);

    return {
        exists,
        description,
        sourcePageId,
        sourceFile,
        sourcePage,
        bbox: hasBox ? mergedBox : null,
        bboxes: hasBox ? normalizedBoxes : [],
        imageDataUrl: '',
        sourceLabel: ''
    };
}

function getBooleanFlag(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', '1', '是', '有'].includes(normalized)) {
            return true;
        }
        if (['false', 'no', '0', '否', '无'].includes(normalized)) {
            return false;
        }
    }
    return Boolean(value);
}

function normalizeBBox(bbox) {
    if (!bbox || typeof bbox !== 'object') {
        return null;
    }

    const x = clampNumber(bbox.x, 0, 1);
    const y = clampNumber(bbox.y, 0, 1);
    const maxWidth = Math.max(0, 1 - x);
    const maxHeight = Math.max(0, 1 - y);
    const width = Math.min(clampNumber(bbox.width, 0, 1), maxWidth);
    const height = Math.min(clampNumber(bbox.height, 0, 1), maxHeight);

    if (width <= 0.01 || height <= 0.01) {
        return null;
    }

    return { x, y, width, height };
}

function mergeBBoxes(boxes) {
    if (!Array.isArray(boxes) || boxes.length === 0) {
        return null;
    }

    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    let count = 0;

    for (const rawBox of boxes) {
        const box = normalizeBBox(rawBox);
        if (!box) {
            continue;
        }
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
        count += 1;
    }

    if (count === 0) {
        return null;
    }

    return {
        x: clampNumber(minX, 0, 1),
        y: clampNumber(minY, 0, 1),
        width: clampNumber(maxX - minX, 0, 1),
        height: clampNumber(maxY - minY, 0, 1)
    };
}

function clampNumber(value, min, max) {
    const n = Number(value);
    if (Number.isNaN(n)) {
        return min;
    }
    return Math.max(min, Math.min(max, n));
}

async function enrichSlidesWithFigureImages(slides, pages) {
    if (!Array.isArray(slides) || slides.length === 0) {
        return [];
    }

    const pageMap = new Map();
    pages.forEach((page) => {
        pageMap.set(page.id, page);
    });

    const imageCache = new Map();
    const enriched = [];

    for (let i = 0; i < slides.length; i += 1) {
        const slide = slides[i];
        const nextSlide = { ...slide, figure: { ...slide.figure } };

        if (!slide.figure?.exists) {
            enriched.push(nextSlide);
            continue;
        }

        const matchedPage = findFigureSourcePage(slide.figure, pages, pageMap);
        if (!matchedPage) {
            nextSlide.figure.exists = false;
            enriched.push(nextSlide);
            continue;
        }

        const imageDataUrl = await cropFigureImage(matchedPage, slide.figure, imageCache);

        if (!imageDataUrl) {
            nextSlide.figure.exists = false;
            enriched.push(nextSlide);
            continue;
        }

        nextSlide.figure.imageDataUrl = imageDataUrl;
        nextSlide.figure.sourceLabel = `${matchedPage.fileName}${matchedPage.pageNumber ? ` 第${matchedPage.pageNumber}页` : ''}`;
        enriched.push(nextSlide);
    }

    return enriched;
}

function findFigureSourcePage(figure, pages, pageMap) {
    const safePages = Array.isArray(pages) ? pages : [];
    if (safePages.length === 0) {
        return null;
    }

    if (figure.sourcePageId && pageMap.has(figure.sourcePageId)) {
        return pageMap.get(figure.sourcePageId);
    }

    const sourceFile = String(figure.sourceFile || '').trim().toLowerCase();
    const sourcePage = Number(figure.sourcePage || 0) || null;

    if (sourceFile && sourcePage) {
        const exactMatch = safePages.find(
            (page) =>
                String(page.fileName || '').trim().toLowerCase() === sourceFile &&
                Number(page.pageNumber) === sourcePage
        );
        if (exactMatch) {
            return exactMatch;
        }
    }

    if (sourceFile) {
        const sameFilePages = safePages.filter(
            (page) => String(page.fileName || '').trim().toLowerCase() === sourceFile
        );
        if (sameFilePages.length === 1) {
            return sameFilePages[0];
        }
    }

    if (sourcePage) {
        const samePageNumber = safePages.filter(
            (page) => Number(page.pageNumber) === sourcePage
        );
        if (samePageNumber.length === 1) {
            return samePageNumber[0];
        }
    }

    // 仅单页场景允许兜底，避免误截取到其他题目页面
    if (safePages.length === 1) {
        return safePages[0];
    }

    return null;
}

function getFigureBoxes(figure) {
    const arrayBoxes = [];
    if (Array.isArray(figure?.bboxes)) {
        arrayBoxes.push(...figure.bboxes);
    }
    if (Array.isArray(figure?.boxes)) {
        arrayBoxes.push(...figure.boxes);
    }
    if (Array.isArray(figure?.regions)) {
        arrayBoxes.push(...figure.regions);
    }

    const bboxCandidates =
        arrayBoxes.length > 0
            ? arrayBoxes
            : [figure?.bbox, figure?.region].filter(Boolean);

    const dedupedBoxes = [];
    const normalizedBoxes = bboxCandidates
        .map((item) => normalizeBBox(item))
        .filter(Boolean);

    for (const box of normalizedBoxes) {
        const duplicated = dedupedBoxes.some((existingBox) => getBBoxIoU(existingBox, box) >= 0.96);
        if (!duplicated) {
            dedupedBoxes.push(box);
        }
    }

    return dedupedBoxes;
}

function getBBoxIoU(a, b) {
    if (!a || !b) {
        return 0;
    }

    const ax2 = a.x + a.width;
    const ay2 = a.y + a.height;
    const bx2 = b.x + b.width;
    const by2 = b.y + b.height;

    const interLeft = Math.max(a.x, b.x);
    const interTop = Math.max(a.y, b.y);
    const interRight = Math.min(ax2, bx2);
    const interBottom = Math.min(ay2, by2);
    const interWidth = Math.max(0, interRight - interLeft);
    const interHeight = Math.max(0, interBottom - interTop);
    const intersection = interWidth * interHeight;
    if (intersection <= 0) {
        return 0;
    }

    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const union = areaA + areaB - intersection;
    if (union <= 0) {
        return 0;
    }

    return intersection / union;
}

function expandRangeWithMinLength(start, end, minLength, lowerBound = 0, upperBound = 1) {
    let rangeStart = Number.isFinite(start) ? start : lowerBound;
    let rangeEnd = Number.isFinite(end) ? end : upperBound;
    const safeMinLength = Math.max(0, Number(minLength) || 0);
    const currentLength = rangeEnd - rangeStart;

    if (currentLength < safeMinLength) {
        const center = (rangeStart + rangeEnd) / 2;
        rangeStart = center - safeMinLength / 2;
        rangeEnd = center + safeMinLength / 2;
    }

    if (rangeStart < lowerBound) {
        rangeEnd = Math.min(upperBound, rangeEnd + (lowerBound - rangeStart));
        rangeStart = lowerBound;
    }
    if (rangeEnd > upperBound) {
        rangeStart = Math.max(lowerBound, rangeStart - (rangeEnd - upperBound));
        rangeEnd = upperBound;
    }

    return {
        start: clampNumber(rangeStart, lowerBound, upperBound),
        end: clampNumber(rangeEnd, lowerBound, upperBound)
    };
}

function expandFigureBox(box) {
    const area = box.width * box.height;
    const aspectRatio = box.width / Math.max(0.001, box.height);
    // 裁切以“完整但不过度”为目标：小图形需要上下文，大图形只保留标注安全区。
    let padXFactor = 0.22;
    let padYFactor = 0.26;
    let minWidth = 0.2;
    let minHeight = 0.18;
    let maxPadX = 0.1;
    let maxPadY = 0.12;

    if (area <= 0.02) {
        padXFactor = 0.52;
        padYFactor = 0.62;
        minWidth = 0.34;
        minHeight = 0.28;
        maxPadX = 0.15;
        maxPadY = 0.17;
    } else if (area <= 0.05) {
        padXFactor = 0.38;
        padYFactor = 0.44;
        minWidth = 0.28;
        minHeight = 0.24;
        maxPadX = 0.13;
        maxPadY = 0.15;
    } else if (area <= 0.12) {
        padXFactor = 0.28;
        padYFactor = 0.32;
        minWidth = 0.24;
        minHeight = 0.2;
        maxPadX = 0.11;
        maxPadY = 0.13;
    }

    // 宽图优先补足上下文高度，竖图优先补足左右标注，避免按同一比例盲目扩张。
    if (aspectRatio >= 2.2) {
        padYFactor *= 1.35;
        minHeight = Math.max(minHeight, 0.24);
    } else if (aspectRatio <= 0.48) {
        padXFactor *= 1.35;
        minWidth = Math.max(minWidth, 0.28);
    }

    const padX = clampNumber(Math.max(0.012, box.width * padXFactor), 0.012, maxPadX);
    const padY = clampNumber(Math.max(0.012, box.height * padYFactor), 0.012, maxPadY);

    const xRange = expandRangeWithMinLength(
        box.x - padX,
        box.x + box.width + padX,
        minWidth,
        0,
        1
    );
    const yRange = expandRangeWithMinLength(
        box.y - padY,
        box.y + box.height + padY,
        minHeight,
        0,
        1
    );

    const width = Math.max(0.01, xRange.end - xRange.start);
    const height = Math.max(0.01, yRange.end - yRange.start);

    return {
        x: xRange.start,
        y: yRange.start,
        width,
        height
    };
}

function buildFigureCropPlan(figure) {
    const baseBoxes = getFigureBoxes(figure);
    if (baseBoxes.length === 0 && !figure?.exists) {
        return null;
    }

    const expandedBoxes =
        baseBoxes.length > 0
            ? baseBoxes
                .map((box) => expandFigureBox(box))
                .sort((a, b) => {
                    if (Math.abs(a.y - b.y) > 0.03) {
                        return a.y - b.y;
                    }
                    return a.x - b.x;
                })
            : [
                {
                    x: 0.04,
                    y: 0.04,
                    width: 0.92,
                    height: 0.92
                }
            ];

    const mergedBox = mergeBBoxes(expandedBoxes);
    if (!mergedBox) {
        return null;
    }

    if (expandedBoxes.length === 1) {
        return {
            mode: 'single',
            boxes: expandedBoxes,
            mergedBox
        };
    }

    const totalArea = expandedBoxes.reduce((sum, box) => sum + box.width * box.height, 0);
    const mergedArea = mergedBox.width * mergedBox.height;
    const spreadRatio = totalArea > 0 ? mergedArea / totalArea : Number.POSITIVE_INFINITY;
    const mode = spreadRatio >= 1.9 ? 'multi' : 'merged';

    return {
        mode,
        boxes: expandedBoxes,
        mergedBox
    };
}

function toPixelCropRect(box, imageWidth, imageHeight) {
    if (!box || imageWidth <= 1 || imageHeight <= 1) {
        return null;
    }

    const x1 = Math.floor(clampNumber(box.x, 0, 1) * imageWidth);
    const y1 = Math.floor(clampNumber(box.y, 0, 1) * imageHeight);
    const x2 = Math.ceil(clampNumber(box.x + box.width, 0, 1) * imageWidth);
    const y2 = Math.ceil(clampNumber(box.y + box.height, 0, 1) * imageHeight);

    const sx = Math.max(0, Math.min(imageWidth - 1, x1));
    const sy = Math.max(0, Math.min(imageHeight - 1, y1));
    const ex = Math.max(sx + 1, Math.min(imageWidth, x2));
    const ey = Math.max(sy + 1, Math.min(imageHeight, y2));
    const sw = Math.max(1, ex - sx);
    const sh = Math.max(1, ey - sy);

    return {
        sx,
        sy,
        sw,
        sh
    };
}

function renderSingleCrop(image, cropRect, maxOutWidth, maxOutHeight) {
    if (!cropRect) {
        return '';
    }

    const maxScale = Math.min(maxOutWidth / cropRect.sw, maxOutHeight / cropRect.sh);
    const preferredScale = Math.min(maxScale, 1);
    const minimumReadableScale = Math.max(280 / cropRect.sw, 180 / cropRect.sh);
    const scale = Math.min(maxScale, Math.max(preferredScale, minimumReadableScale));
    const width = Math.max(1, Math.round(cropRect.sw * scale));
    const height = Math.max(1, Math.round(cropRect.sh * scale));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return '';
    }

    canvas.width = width;
    canvas.height = height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(
        image,
        cropRect.sx,
        cropRect.sy,
        cropRect.sw,
        cropRect.sh,
        0,
        0,
        width,
        height
    );
    return canvas.toDataURL('image/png');
}

function renderStackedCrops(image, cropRects, maxOutWidth, maxOutHeight) {
    if (!Array.isArray(cropRects) || cropRects.length === 0) {
        return '';
    }

    const baseWidth = Math.min(
        maxOutWidth,
        Math.max(...cropRects.map((rect) => Math.max(1, rect.sw)))
    );
    const gap = 16;
    const layers = cropRects.map((rect) => {
        const widthScale = baseWidth / rect.sw;
        const minimumReadableScale = Math.max(180 / rect.sw, 110 / rect.sh);
        const scale = Math.min(widthScale, Math.max(Math.min(widthScale, 1), minimumReadableScale));
        return {
            ...rect,
            drawWidth: Math.max(1, Math.round(rect.sw * scale)),
            drawHeight: Math.max(1, Math.round(rect.sh * scale))
        };
    });
    const contentWidth = Math.max(...layers.map((layer) => layer.drawWidth));
    const contentHeight =
        layers.reduce((sum, layer) => sum + layer.drawHeight, 0) + gap * (layers.length - 1);
    const finalScale = Math.min(1, maxOutWidth / contentWidth, maxOutHeight / contentHeight);
    const scaledGap = Math.max(8, Math.round(gap * finalScale));
    const canvasWidth = Math.max(280, Math.round(contentWidth * finalScale));
    const canvasHeight = Math.max(180, Math.round(contentHeight * finalScale));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return '';
    }

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    let drawY = 0;
    layers.forEach((layer, index) => {
        const drawWidth = Math.max(1, Math.round(layer.drawWidth * finalScale));
        const drawHeight = Math.max(1, Math.round(layer.drawHeight * finalScale));
        const drawX = Math.round((canvasWidth - drawWidth) / 2);
        ctx.drawImage(
            image,
            layer.sx,
            layer.sy,
            layer.sw,
            layer.sh,
            drawX,
            drawY,
            drawWidth,
            drawHeight
        );

        drawY += drawHeight;
        if (index < layers.length - 1) {
            drawY += scaledGap;
        }
    });

    return canvas.toDataURL('image/png');
}

async function cropFigureImage(page, figure, imageCache) {
    if (!page?.dataUrl) {
        return '';
    }

    const image = await loadImageElement(page.dataUrl, imageCache);
    if (!image) {
        return '';
    }

    const cropPlan = buildFigureCropPlan(figure);
    if (!cropPlan) {
        return '';
    }

    const imageWidth = image.naturalWidth || image.width || 0;
    const imageHeight = image.naturalHeight || image.height || 0;
    if (imageWidth < 2 || imageHeight < 2) {
        return '';
    }

    const maxOutWidth = 2200;
    const maxOutHeight = 1400;

    if (cropPlan.mode === 'multi') {
        const cropRects = cropPlan.boxes
            .map((box) => toPixelCropRect(box, imageWidth, imageHeight))
            .filter(Boolean);
        if (cropRects.length === 0) {
            return '';
        }
        if (cropRects.length === 1) {
            return renderSingleCrop(image, cropRects[0], maxOutWidth, maxOutHeight);
        }
        return renderStackedCrops(image, cropRects, maxOutWidth, maxOutHeight);
    }

    const mergedCropRect = toPixelCropRect(cropPlan.mergedBox, imageWidth, imageHeight);
    return renderSingleCrop(image, mergedCropRect, maxOutWidth, maxOutHeight);
}

function loadImageElement(dataUrl, imageCache = null) {
    if (imageCache && imageCache.has(dataUrl)) {
        return imageCache.get(dataUrl);
    }

    const promise = new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });

    if (imageCache) {
        imageCache.set(dataUrl, promise);
    }
    return promise;
}
function showProcessing(message = 'AI正在识别试卷内容...', title = '正在制作课件') {
    processingRetryAction = null;
    uploadArea.style.display = 'flex';
    uploadArea.style.pointerEvents = 'none';
    uploadArea.classList.add('is-processing');
    processingStatus.dataset.state = 'working';
    processingStatus.setAttribute('role', 'status');
    processingStatus.style.display = 'flex';
    if (processingTitle) processingTitle.textContent = title;
    processingText.textContent = message;
    if (processingRetryBtn) {
        processingRetryBtn.style.display = 'none';
        processingRetryBtn.disabled = false;
    }
}

function hideProcessing() {
    processingRetryAction = null;
    uploadArea.style.display = 'flex';
    uploadArea.style.pointerEvents = '';
    uploadArea.classList.remove('is-processing');
    processingStatus.style.display = 'none';
    processingStatus.dataset.state = 'idle';
}

function showProcessingFailure(error, retryAction) {
    const copy = getProcessingFailureCopy(error);
    processingRetryAction = retryAction;
    uploadArea.style.display = 'flex';
    uploadArea.style.pointerEvents = 'none';
    uploadArea.classList.add('is-processing');
    processingStatus.dataset.state = 'error';
    processingStatus.setAttribute('role', 'alert');
    processingStatus.style.display = 'flex';
    if (processingTitle) processingTitle.textContent = copy.title;
    processingText.textContent = copy.message;
    if (processingRetryBtn) {
        const label = processingRetryBtn.querySelector('.processing-retry-label');
        if (label) label.textContent = copy.actionLabel;
        processingRetryBtn.style.display = 'inline-flex';
        processingRetryBtn.disabled = false;
    }
    refreshIcons();
}

function waitForProcessingRetry(error) {
    return new Promise((resolve) => {
        showProcessingFailure(error, resolve);
    });
}

function getProcessingFailureCopy(error) {
    if (error?.code === 'ACADEMIC_FORMULA_REPAIR_EXHAUSTED') {
        return {
            title: '公式校验还差一步',
            message: error.userMessage || '部分公式没有完整返回。试卷已保留，可继续修复。',
            actionLabel: '继续修复'
        };
    }
    if (error?.code === 'ACADEMIC_FORMULA_ENGINE_MISSING') {
        return {
            title: '公式校验组件未就绪',
            message: '页面资源没有完整加载。刷新页面后可继续使用同一份试卷。',
            actionLabel: '重新生成'
        };
    }
    return {
        title: '本次生成未完成',
        message: String(error?.userMessage || error?.message || '生成过程被中断，请重新生成。'),
        actionLabel: '重新生成'
    };
}

function showPreview() {
    previewSection.style.display = 'flex';
    currentSlideIndex = 0;
    renderSlideNav();
    renderSlide(0);
    slideCount.textContent = `${generatedSlides.length} 张`;
    refreshIcons();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
        top: Math.max(0, previewSection.offsetTop - 12),
        behavior: reduceMotion ? 'auto' : 'smooth'
    });
}

function renderSlideNav() {
    slideNavList.innerHTML = generatedSlides
        .map(
            (slide, index) => `
        <button
            type="button"
            class="slide-nav-item ${index === currentSlideIndex ? 'active' : ''}"
            onclick="selectSlide(${index})"
            ${index === currentSlideIndex ? 'aria-current="page"' : ''}
            aria-label="第 ${index + 1} 张：${escapeHTML(slide.type)}，原题第 ${slide.id} 题"
        >
            <span class="num">${String(index + 1).padStart(2, '0')}</span>
            <span class="text">${escapeHTML(slide.type)} 第${slide.id}题</span>
        </button>
    `
        )
        .join('');
}

function selectSlide(index, options = {}) {
    const safeOptions = options || {};

    if (!Number.isInteger(index) || index < 0 || index >= generatedSlides.length) {
        return;
    }

    currentSlideIndex = index;
    renderSlideNav();
    renderSlide(index);

    if (safeOptions.ensurePreviewVisible !== false) {
        requestAnimationFrame(() => ensurePreviewVisible());
    }
}

function ensurePreviewVisible() {
    if (window.innerWidth <= 768 || previewSection.style.display === 'none') {
        return;
    }

    const rect = slidePreview.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const visibleArea = visibleWidth * visibleHeight;
    const previewArea = Math.max(1, rect.width * rect.height);
    const visibleRatio = visibleArea / previewArea;
    const isOutsideViewport = rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth;
    const isMostlyHidden = visibleRatio < 0.3;

    if (isOutsideViewport || isMostlyHidden) {
        const targetTop = window.scrollY + rect.top - Math.max(16, (viewportHeight - rect.height) / 2);
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({
            top: Math.max(0, targetTop),
            behavior: reduceMotion ? 'auto' : 'smooth'
        });
    }
}

function getAnalysisSegments(text, maxSegments = 5) {
    const normalized = String(text || '暂无解析')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim();

    if (!normalized) {
        return [{ label: '', text: '暂无解析' }];
    }

    const explicitParts = normalized
        .split(/\n+/)
        .map((part) => part.trim())
        .filter(Boolean);

    let parts = explicitParts;
    const stepBoundaryPattern = /(?=(?:第[一二三四五六七八九十\d]+步|首先|其次|然后|接着|最后(?:说明)?|结论)[：:，,\s])/g;
    const inlineStepMarkers = normalized.match(
        /(?:第[一二三四五六七八九十\d]+步|首先|其次|然后|接着|最后(?:说明)?|结论)[：:，,\s]/g
    );

    if (parts.length <= 1 && (inlineStepMarkers?.length || 0) >= 2) {
        parts = normalized
            .split(stepBoundaryPattern)
            .map((part) => part.trim())
            .filter(Boolean);
    }

    if (parts.length <= 1) {
        const sentences = normalized.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [normalized];
        parts = [];
        let buffer = '';

        for (const sentence of sentences.map((item) => item.trim()).filter(Boolean)) {
            if (buffer && buffer.length + sentence.length > 88) {
                parts.push(buffer);
                buffer = sentence;
            } else {
                buffer += sentence;
            }
        }
        if (buffer) {
            parts.push(buffer);
        }
    }

    if (parts.length > maxSegments) {
        const head = parts.slice(0, maxSegments - 1);
        const tail = parts.slice(maxSegments - 1).join('');
        parts = [...head, tail];
    }

    const markerPattern = /^(第[一二三四五六七八九十\d]+步|首先|其次|然后|接着|最后(?:说明)?|结论)[：:，,\s]*/;
    return parts.map((part) => {
        const marker = part.match(markerPattern);
        return {
            label: marker ? marker[1] : '',
            text: marker ? part.replace(markerPattern, '').trim() || part : part
        };
    });
}

function getSlideViewModel(slide) {
    const hasFigure = Boolean(slide.figure?.exists && slide.figure?.imageDataUrl);
    const optionsCount = Array.isArray(slide.options) ? slide.options.length : 0;
    const layout = hasFigure ? 'figure' : optionsCount >= 2 ? 'choice' : 'solution';

    const showExplanationPath = hasExplanationPathVisible();
    return {
        hasFigure,
        layout,
        showExplanationPath,
        analysisSegments: showExplanationPath ? getAnalysisSegments(slide.analysis) : [],
        knowledge: normalizeKnowledge(slide.knowledge, slide.subject)
    };
}

function buildResponseHTML(slide, showAnswer) {
    if (Array.isArray(slide.options) && slide.options.length > 0) {
        return `
            <section class="response-zone slide-module" aria-label="作答选项">
                <div class="module-heading"><h3>作答</h3></div>
                <div class="options-list">
                    ${slide.options
                        .map(
                            (option) => `
                                <div class="option-item ${showAnswer && option.correct ? 'correct' : ''}">
                                    <span class="letter">${escapeHTML(option.letter)}</span>
                                     <span class="text">${formatAcademicText(option.text, slide.subject)}</span>
                                    ${showAnswer && option.correct ? '<i data-lucide="check"></i>' : ''}
                                </div>
                            `
                        )
                        .join('')}
                </div>
            </section>
        `;
    }

    return `
        <section class="response-zone slide-module" aria-label="参考答案">
            <div class="answer-box ${showAnswer ? '' : 'answer-hidden'}">
                <span class="answer-label">${showAnswer ? '参考答案' : '课堂揭晓'}</span>
                ${showAnswer && slide.answer
                    ? `<span class="answer-value">${formatAcademicText(slide.answer, slide.subject)}</span>`
                    : '<span class="answer-placeholder">保留思考时间，暂不展示答案</span>'}
            </div>
        </section>
    `;
}

function bindFigureAspect() {
    const image = slidePreview.querySelector('.figure-media img');
    if (!image) {
        slidePreview.dataset.figureAspect = 'none';
        return;
    }

    const updateAspect = () => {
        const ratio = (image.naturalWidth || 1) / Math.max(1, image.naturalHeight || 1);
        slidePreview.dataset.figureAspect = ratio >= 1.65 ? 'wide' : ratio <= 0.72 ? 'tall' : 'balanced';
        applySlideFitMode();
    };

    if (image.complete && image.naturalWidth > 0) {
        updateAspect();
    } else {
        image.addEventListener('load', updateAspect, { once: true });
    }
}

function renderSlide(index) {
    const slide = generatedSlides[index];
    if (!slide) {
        return;
    }

    const renderRevision = ++slideRenderRevision;

    const showAnswer = hasAnswerVisible();
    const viewModel = getSlideViewModel(slide);
    const responseHTML = buildResponseHTML(slide, showAnswer);

    const figureHTML = viewModel.hasFigure
        ? `
            <section class="figure-zone slide-module">
                <div class="module-heading"><h3>原题图形</h3></div>
                <div class="figure-container">
                    <div class="figure-media">
                        <img src="${slide.figure.imageDataUrl}" alt="${escapeHTML(slide.figure.description || '原题相关图形')}">
                    </div>
                    <p class="figure-caption">
                        <span>${escapeHTML(slide.figure.description || '已自动匹配原题图形')}</span>
                        ${slide.figure.sourceLabel
                            ? `<span class="figure-source">${escapeHTML(slide.figure.sourceLabel)}</span>`
                            : ''}
                    </p>
                </div>
            </section>
        `
        : '';

    const analysisHTML = viewModel.analysisSegments
        .map(
            (segment, segmentIndex) => `
                <div class="reasoning-step">
                    <span class="reasoning-index">${String(segmentIndex + 1).padStart(2, '0')}</span>
                    <div class="reasoning-copy">
                        ${segment.label ? `<strong class="reasoning-label">${escapeHTML(segment.label)}</strong>` : ''}
                         <p>${formatAcademicText(segment.text, slide.subject)}</p>
                    </div>
                </div>
            `
        )
        .join('');

    slidePreview.innerHTML = `
        <div class="slide-canvas">
        <header class="slide-header">
            <div class="slide-identity">
                <span class="slide-question-index">Q${String(slide.id).padStart(2, '0')}</span>
                <div class="slide-title-group">
                    <span class="slide-type">${escapeHTML(slide.type)}</span>
                    <span class="slide-subject">${escapeHTML(slide.subject)} · 试卷讲评</span>
                </div>
            </div>
            <div class="slide-meta">
                <span class="difficulty">${escapeHTML(slide.difficulty)}</span>
                <span>${Number(slide.score) || 0} 分</span>
            </div>
        </header>

        <div class="slide-content layout-${viewModel.layout}${viewModel.showExplanationPath ? '' : ' explanation-hidden'}" role="group" aria-label="第 ${slide.id} 题讲评课件">
            <section class="question-zone slide-module">
                <div class="module-heading"><h3>题目</h3></div>
                <div class="question-text">${formatAcademicText(slide.question, slide.subject)}</div>
            </section>

            ${responseHTML}
            ${figureHTML}

            ${viewModel.showExplanationPath ? `<section class="analysis-zone slide-module">
                <div class="module-heading"><h3>讲解路径</h3></div>
                <div class="reasoning-flow">${analysisHTML}</div>
            </section>` : ''}

            <section class="knowledge-zone slide-module">
                <div class="module-heading"><h3>考点</h3></div>
                <div class="knowledge-list">
                    ${viewModel.knowledge
                        .map((item) => `<span class="knowledge-item">${formatAcademicText(item, slide.subject)}</span>`)
                        .join('')}
                </div>
            </section>
        </div>
        </div>
    `;

    slidePreview.dataset.layout = viewModel.layout;
    slidePreview.dataset.subject = slide.subject;
    syncSlideCanvasScale();
    bindFigureAspect();
    applySlideFitMode({ hasFigure: viewModel.hasFigure, layoutMode: viewModel.layout });
    refreshIcons(slidePreview);
    activeAcademicTypesetPromise = scheduleAcademicTypeset(slidePreview, renderRevision, viewModel);
}

async function downloadPPT() {
    if (generatedSlides.length === 0) {
        alert('请先上传试卷并生成课件。');
        return;
    }

    if (typeof window.html2canvas !== 'function') {
        alert('导出组件加载失败，请刷新页面后重试。');
        return;
    }

    if (isExportingPPT) {
        return;
    }

    const pptx = new PptxGenJS();
    pptx.author = '试卷变课件';
    pptx.title = '试卷讲评课件';
    pptx.subject = '自动生成的讲评课件';
    pptx.layout = 'LAYOUT_WIDE';
    const originalIndex = currentSlideIndex;
    const originalWindowScrollY = window.scrollY;

    const textEl = downloadBtn.querySelector('span');
    const originalBtnText = textEl ? textEl.textContent : '';
    const originalBtnDisabled = downloadBtn.disabled;
    const originalFullscreenDisabled = fullscreenBtn.disabled;
    const originalAnswerToggleDisabled = answerVisibilityToggle?.disabled || false;
    const originalExplanationToggleDisabled = explanationPathToggle?.disabled || false;
    const originalUploadPointerEvents = uploadArea.style.pointerEvents;
    const originalNavPointerEvents = slideNavList.style.pointerEvents;

    isExportingPPT = true;
    downloadBtn.disabled = true;
    fullscreenBtn.disabled = true;
    if (answerVisibilityToggle) {
        answerVisibilityToggle.disabled = true;
    }
    if (explanationPathToggle) {
        explanationPathToggle.disabled = true;
    }
    uploadArea.style.pointerEvents = 'none';
    slideNavList.style.pointerEvents = 'none';
    if (textEl) {
        textEl.textContent = '正在导出PPT...';
    }

    try {
        for (let index = 0; index < generatedSlides.length; index += 1) {
            if (textEl) {
                textEl.textContent = `正在导出第 ${index + 1}/${generatedSlides.length} 题...`;
            }

            selectSlide(index, { ensurePreviewVisible: false });
            await waitForPreviewStable();
            const screenshotDataUrl = await capturePreviewAsDataUrl(slidePreview);
            const page = pptx.addSlide();
            page.addImage({
                data: screenshotDataUrl,
                x: 0,
                y: 0,
                w: 13.333,
                h: 7.5
            });
        }

        await pptx.writeFile({ fileName: '试卷讲评课件.pptx' });
    } catch (error) {
        console.error('导出PPT失败：', error);
        alert(`导出失败：${error.message || '未知错误，请稍后重试。'}`);
    } finally {
        const restoreIndex = Math.min(originalIndex, Math.max(0, generatedSlides.length - 1));
        selectSlide(restoreIndex, { ensurePreviewVisible: false });
        window.scrollTo({ left: 0, top: originalWindowScrollY, behavior: 'auto' });

        isExportingPPT = false;
        downloadBtn.disabled = originalBtnDisabled;
        fullscreenBtn.disabled = originalFullscreenDisabled;
        if (answerVisibilityToggle) {
            answerVisibilityToggle.disabled = originalAnswerToggleDisabled;
        }
        if (explanationPathToggle) {
            explanationPathToggle.disabled = originalExplanationToggleDisabled;
        }
        uploadArea.style.pointerEvents = originalUploadPointerEvents;
        slideNavList.style.pointerEvents = originalNavPointerEvents;
        if (textEl) {
            textEl.textContent = originalBtnText;
        }
    }
}

async function waitForPreviewStable() {
    await waitForAnimationFrames(2);

    try {
        await Promise.race([activeAcademicTypesetPromise, waitMilliseconds(5000)]);
    } catch (error) {
        console.warn('公式排版等待失败，使用当前可读内容继续导出。', error);
    }

    const images = Array.from(slidePreview.querySelectorAll('img'));
    if (images.length > 0) {
        await Promise.all(images.map((img) => waitForImageReady(img)));
    }

    if (document.fonts?.ready) {
        try {
            await Promise.race([document.fonts.ready, waitMilliseconds(1200)]);
        } catch (error) {
            console.warn('字体加载等待超时，继续导出。', error);
        }
    }

    await waitForAnimationFrames(1);
}

function waitForAnimationFrames(frameCount = 1) {
    return new Promise((resolve) => {
        const next = (remaining) => {
            if (remaining <= 0) {
                resolve();
                return;
            }
            requestAnimationFrame(() => next(remaining - 1));
        };
        next(frameCount);
    });
}

function waitForImageReady(image) {
    if (image.complete) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            image.removeEventListener('load', finish);
            image.removeEventListener('error', finish);
            clearTimeout(timer);
            resolve();
        };

        const timer = setTimeout(finish, 2500);
        image.addEventListener('load', finish, { once: true });
        image.addEventListener('error', finish, { once: true });
    });
}

function waitMilliseconds(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function capturePreviewAsDataUrl(previewElement) {
    const sourceElement = previewElement.querySelector('.slide-canvas');
    if (!sourceElement) {
        throw new Error('课件逻辑画布不存在，请重新生成预览后再导出。');
    }

    // 导出始终抓取固定逻辑画布，避免窄屏预览先缩小再放大导致文字发糊。
    const exportHost = previewElement.cloneNode(true);
    exportHost.removeAttribute('id');
    Object.assign(exportHost.style, {
        position: 'fixed',
        left: '-20000px',
        top: '0',
        width: `${SLIDE_LOGICAL_WIDTH}px`,
        height: `${SLIDE_LOGICAL_HEIGHT}px`,
        aspectRatio: 'auto',
        overflow: 'visible',
        boxShadow: 'none',
        pointerEvents: 'none'
    });

    const exportCanvasElement = exportHost.querySelector('.slide-canvas');
    exportCanvasElement.style.transform = 'none';
    document.body.appendChild(exportHost);

    try {
        const images = Array.from(exportCanvasElement.querySelectorAll('img'));
        await Promise.all(images.map((image) => waitForImageReady(image)));

        const scale = Math.min(
            3,
            PREVIEW_EXPORT_WIDTH / SLIDE_LOGICAL_WIDTH,
            PREVIEW_EXPORT_HEIGHT / SLIDE_LOGICAL_HEIGHT
        );
        const sourceCanvas = await window.html2canvas(exportCanvasElement, {
            backgroundColor: '#FCFCF8',
            useCORS: true,
            allowTaint: false,
            logging: false,
            scale,
            width: SLIDE_LOGICAL_WIDTH,
            height: SLIDE_LOGICAL_HEIGHT,
            scrollX: 0,
            scrollY: 0,
            windowWidth: SLIDE_LOGICAL_WIDTH,
            windowHeight: SLIDE_LOGICAL_HEIGHT
        });

        return normalizeCanvasDataUrl(sourceCanvas, PREVIEW_EXPORT_WIDTH, PREVIEW_EXPORT_HEIGHT);
    } finally {
        exportHost.remove();
    }
}

function applySlideFitMode(options = {}) {
    const hasFigure = options.hasFigure ?? slidePreview.dataset.figureAspect !== 'none';
    const layoutMode = options.layoutMode || slidePreview.dataset.layout || 'solution';

    slidePreview.classList.remove(
        'has-figure',
        'no-figure',
        'layout-choice',
        'layout-figure',
        'layout-solution',
        'overflow-warning',
        ...DENSITY_CLASSES
    );

    slidePreview.classList.add(hasFigure ? 'has-figure' : 'no-figure');
    slidePreview.classList.add(`layout-${layoutMode}`);
    slidePreview.dataset.fitState = 'regular';

    if (isSlideContentFit()) {
        return;
    }

    for (const densityClass of DENSITY_CLASSES) {
        slidePreview.classList.remove(...DENSITY_CLASSES);
        slidePreview.classList.add(densityClass);
        if (isSlideContentFit()) {
            slidePreview.dataset.fitState = densityClass.replace('density-', '');
            return;
        }
    }

    slidePreview.classList.add('overflow-warning');
    slidePreview.dataset.fitState = 'clamped';
}

function isSlideContentFit() {
    const contentEl = slidePreview.querySelector('.slide-content');
    if (!contentEl) {
        return true;
    }

    const overflowCandidates = [
        contentEl,
        ...contentEl.querySelectorAll(
            '.question-zone, .response-zone, .figure-zone, .analysis-zone, .reasoning-flow, .knowledge-zone'
        )
    ];

    return overflowCandidates.every(
        (element) =>
            element.scrollHeight <= element.clientHeight + 2 &&
            element.scrollWidth <= element.clientWidth + 2
    );
}

function normalizeCanvasDataUrl(sourceCanvas, targetWidth, targetHeight) {
    if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) {
        throw new Error('截图画布无效，无法导出。');
    }

    const normalizedCanvas = document.createElement('canvas');
    normalizedCanvas.width = targetWidth;
    normalizedCanvas.height = targetHeight;

    const ctx = normalizedCanvas.getContext('2d');
    if (!ctx) {
        throw new Error('无法创建导出画布上下文。');
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    const sourceRatio = sourceCanvas.width / sourceCanvas.height;
    const targetRatio = targetWidth / targetHeight;
    let drawWidth;
    let drawHeight;
    let drawX = 0;
    let drawY = 0;

    if (sourceRatio > targetRatio) {
        drawWidth = targetWidth;
        drawHeight = drawWidth / sourceRatio;
        drawY = (targetHeight - drawHeight) / 2;
    } else {
        drawHeight = targetHeight;
        drawWidth = drawHeight * sourceRatio;
        drawX = (targetWidth - drawWidth) / 2;
    }

    ctx.drawImage(sourceCanvas, drawX, drawY, drawWidth, drawHeight);
    return normalizedCanvas.toDataURL('image/jpeg', 0.92);
}

function toggleFullscreen() {
    const previewElement = slidePreview;

    if (!document.fullscreenElement) {
        previewElement.requestFullscreen().catch(() => {
            alert('无法进入全屏模式。');
        });
    } else {
        document.exitFullscreen();
    }
}

function formatAcademicText(text, subject = '综合') {
    if (window.AcademicMath?.render) {
        return window.AcademicMath.render(String(text || ''), subject);
    }
    return escapeHTML(String(text || '')).replace(/\n/g, '<br>');
}

function scheduleAcademicTypeset(rootElement, renderRevision, viewModel) {
    academicTypesetQueue = academicTypesetQueue
        .catch(() => false)
        .then(async () => {
            if (renderRevision !== slideRenderRevision || !window.AcademicMath?.typeset) {
                return false;
            }

            const rendered = await window.AcademicMath.typeset(rootElement);
            if (renderRevision === slideRenderRevision) {
                applySlideFitMode({
                    hasFigure: viewModel.hasFigure,
                    layoutMode: viewModel.layout
                });
                syncSlideCanvasScale();
            }
            return rendered;
        });

    return academicTypesetQueue;
}

function escapeHTML(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return String(text || '').replace(/[&<>"']/g, (ch) => map[ch]);
}

function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function readFileAsText(file, encoding = 'utf-8') {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsText(file, encoding);
    });
}

window.selectSlide = selectSlide;

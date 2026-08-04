import { getPlatformSiteKey, resolveResultImageUrl } from './result-image-path.js';

const state = {
  knowledgeFiles: [],
  styleReferences: [],
  results: [],
  lastGeneratePayload: null,
  generationRule: null,
  generationRuleSignature: '',
  activeGenerateController: null,
  activeRuleController: null,
  activeGenerationBatchIds: new Set(),
  retryControllers: new Map(),
  retryingIndexes: new Set(),
  isGenerating: false,
  isConfirmingRule: false,
  apiConfigured: false,
  ruleApiConfigured: false,
  currentUser: null,
  setupRequired: false,
  planConfirmResolve: null,
  planConfirmOriginalCount: 0,
  pointConfirmResolve: null,
  pointConfirmMode: 'confirm',
  pointConfirmAllowChangeCount: true,
  pointConfirmOriginalCount: 0,
  pointConfirmBalanceValue: 0,
  preview: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  },
};

const PLATFORM_SITE_KEY = getPlatformSiteKey();
const IS_PLATFORM_MODE = Boolean(PLATFORM_SITE_KEY);

const DEFAULT_OPTIONS = Object.freeze({
  printFriendly: false,
  answerSpace: false,
  lowInk: false,
});
const PREVIEW_MIN_SCALE = 0.25;
const PREVIEW_MAX_SCALE = 6;
const PREVIEW_ZOOM_STEP = 0.25;
const MAX_GENERATION_COUNT = 120;
const CLIENT_BATCH_ITEM_MAX_CHARS = 600;
const RULE_CONTENT_INVENTORY_MAX_ITEMS = 120;
const RULE_COVERAGE_CHECKLIST_MAX_ITEMS = 80;
const RULE_RISK_NOTES_MAX_ITEMS = 30;
const KNOWLEDGE_BLUEPRINT_MAX_ANCHORS = 120;
const KNOWLEDGE_BLUEPRINT_MAX_SOURCE_SUMMARIES = 40;
const KNOWLEDGE_BLUEPRINT_MAX_UNCERTAINTY_NOTES = 40;
const KNOWLEDGE_ANCHOR_TEXT_MAX_CHARS = 420;
const KNOWLEDGE_ANCHOR_MUST_INCLUDE_MAX_CHARS = 180;
const GENERATED_IMAGE_PATH_PREFIX = '/generated/';
const PROMPT_PLACEHOLDER = '请填写你的需求，用大白话即可，越具体效果越好';
const PLANNING_PROGRESS_MESSAGE = '正在智能规划内容，制定出图计划，请稍等';
const PDF_EVIDENCE_MAX_PAGE_COUNT = 60;
const PDF_EVIDENCE_TARGET_WIDTH = 720;
const PDF_EVIDENCE_IMAGE_QUALITY = 0.76;
const PDF_TEXT_MAX_CHARS = 60000;
const KNOWLEDGE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const KNOWLEDGE_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const KNOWLEDGE_FILE_ACCEPT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'txt',
  'md',
  'csv',
]);

const form = document.querySelector('#generatorForm');
const promptInput = document.querySelector('#prompt');
const materialTypeInput = document.querySelector('#materialType');
const scenarioInput = document.querySelector('#scenario');
const countInput = document.querySelector('#count');
const layoutFixedInput = document.querySelector('#layoutFixed');
const aspectRatioInput = document.querySelector('#aspectRatio');
const customAspectRatioInput = document.querySelector('#customAspectRatio');
const customRatioField = document.querySelector('#customRatioField');
const knowledgeInput = document.querySelector('#knowledgeInput');
const knowledgeStrip = document.querySelector('#knowledgeStrip');
const knowledgeUploadZone = document.querySelector('#knowledgeUploadZone');
const referenceInput = document.querySelector('#referenceInput');
const referenceStrip = document.querySelector('#referenceStrip');
const styleUploadZone = document.querySelector('#styleUploadZone');
const resultGrid = document.querySelector('#resultGrid');
const batchSummary = document.querySelector('#batchSummary');
const ruleButton = document.querySelector('#ruleButton');
const rulePanel = document.querySelector('#rulePanel');
const generateButton = document.querySelector('#generateButton');
const clearButton = document.querySelector('#clearButton');
const downloadAllButton = document.querySelector('#downloadAllButton');
const userBadge = document.querySelector('#userBadge');
const authButton = document.querySelector('#authButton');
const logoutButton = document.querySelector('#logoutButton');
const redeemButton = document.querySelector('#redeemButton');
const authModal = document.querySelector('#authModal');
const authUsernameInput = document.querySelector('#authUsername');
const authPasswordInput = document.querySelector('#authPassword');
const loginButton = document.querySelector('#loginButton');
const registerButton = document.querySelector('#registerButton');
const redeemModal = document.querySelector('#redeemModal');
const redeemCodeInput = document.querySelector('#redeemCodeInput');
const redeemSubmitButton = document.querySelector('#redeemSubmitButton');
const pointConfirmModal = document.querySelector('#pointConfirmModal');
const planConfirmModal = document.querySelector('#planConfirmModal');
const planConfirmSuggestedCount = document.querySelector('#planConfirmSuggestedCount');
const planConfirmCountInput = document.querySelector('#planConfirmCountInput');
const planConfirmCancelButton = document.querySelector('#planConfirmCancelButton');
const planConfirmSubmitButton = document.querySelector('#planConfirmSubmitButton');
const pointConfirmCost = document.querySelector('#pointConfirmCost');
const pointConfirmCount = document.querySelector('#pointConfirmCount');
const pointConfirmBalance = document.querySelector('#pointConfirmBalance');
const pointConfirmAfter = document.querySelector('#pointConfirmAfter');
const pointConfirmConfirmButton = document.querySelector('#pointConfirmConfirmButton');
const pointConfirmCancelButton = document.querySelector('#pointConfirmCancelButton');
const pointChangeCountButton = document.querySelector('#pointChangeCountButton');
const pointConfirmWarning = document.querySelector('#pointConfirmWarning');
const pointInsufficientWarning = document.querySelector('#pointInsufficientWarning');
const pointInsufficientMessage = document.querySelector('#pointInsufficientMessage');
const pointInsufficientBuyButton = document.querySelector('#pointInsufficientBuyButton');
const pointInsufficientContinueButton = document.querySelector('#pointInsufficientContinueButton');
const pointChangeBackButton = document.querySelector('#pointChangeBackButton');
const pointChangeProceedButton = document.querySelector('#pointChangeProceedButton');
const pointConfirmEditor = document.querySelector('#pointConfirmEditor');
const pointConfirmCountInput = document.querySelector('#pointConfirmCountInput');
const planningProgressModal = document.querySelector('#planningProgressModal');
const toast = document.querySelector('#toast');
const previewModal = document.querySelector('#previewModal');
const previewStage = document.querySelector('#previewStage');
const previewImage = document.querySelector('#previewImage');
const previewTitle = document.querySelector('#previewTitle');
const zoomOutput = document.querySelector('#zoomOutput');
const zoomOutButton = document.querySelector('#zoomOutButton');
const zoomInButton = document.querySelector('#zoomInButton');
const zoomResetButton = document.querySelector('#zoomResetButton');

const sampleMarkup = resultGrid.innerHTML;
const resultImageSources = new WeakMap();

[
  promptInput,
  materialTypeInput,
  scenarioInput,
  countInput,
  layoutFixedInput,
  aspectRatioInput,
  customAspectRatioInput,
].forEach((input) => {
  input.addEventListener('input', invalidateGenerationRule);
  input.addEventListener('change', invalidateGenerationRule);
});

promptInput.addEventListener('input', () => {
  promptInput.setCustomValidity('');
  promptInput.classList.remove('input-needs-attention');
});

countInput.addEventListener('blur', () => {
  const count = parseGenerationCount({ showError: false, allowEmpty: true });
  if (count) countInput.value = String(count);
});

aspectRatioInput.addEventListener('change', syncCustomRatioField);

knowledgeInput.addEventListener('change', async (event) => {
  await addKnowledgeFiles([...event.target.files]);
  knowledgeInput.value = '';
});

referenceInput.addEventListener('change', async (event) => {
  await addReferenceFiles([...event.target.files]);
  referenceInput.value = '';
});

bindUploadZone(knowledgeUploadZone, addKnowledgeFiles);
bindUploadZone(styleUploadZone, addReferenceFiles);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await generateTeachingAids();
});

ruleButton?.addEventListener('click', async () => {
  await confirmGenerationRules();
});

clearButton.addEventListener('click', () => {
  cancelActiveGenerationBatches();
  if (state.activeGenerateController) {
    state.activeGenerateController.abort();
    state.activeGenerateController = null;
  }
  if (state.activeRuleController) {
    state.activeRuleController.abort();
    state.activeRuleController = null;
  }
  abortRetryControllers();
  state.knowledgeFiles = [];
  state.styleReferences = [];
  state.results = [];
  state.lastGeneratePayload = null;
  state.generationRule = null;
  state.generationRuleSignature = '';
  promptInput.value = '';
  promptInput.setCustomValidity('');
  promptInput.classList.remove('input-needs-attention');
  materialTypeInput.value = '';
  scenarioInput.value = '';
  countInput.value = '';
  layoutFixedInput.checked = true;
  aspectRatioInput.value = '9:16';
  customAspectRatioInput.value = '';
  syncCustomRatioField();
  renderKnowledgeFiles();
  renderReferences();
  renderGenerationRule();
  renderResults();
  batchSummary.textContent = '等待生成';
});

downloadAllButton.addEventListener('click', () => {
  const images = state.results.filter((item) => Boolean(getResultActionImage(item)));
  if (images.length === 0) {
    showToast('暂无可下载图片');
    return;
  }

  images.forEach((item, index) => {
    window.setTimeout(() => downloadImage(getResultActionImage(item), `k12-teaching-aid-${index + 1}.png`), index * 250);
  });
});

authButton?.addEventListener('click', () => openAuthModal());
logoutButton?.addEventListener('click', logoutCurrentUser);
redeemButton?.addEventListener('click', () => {
  if (!requireLoggedIn()) return;
  openRedeemModal();
});
loginButton?.addEventListener('click', () => submitAuth('login'));
registerButton?.addEventListener('click', () => submitAuth('register'));
redeemSubmitButton?.addEventListener('click', redeemPoints);
authUsernameInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitAuth('login');
});
authPasswordInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitAuth('login');
});
redeemCodeInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') redeemPoints();
});
pointConfirmConfirmButton?.addEventListener('click', submitPointConfirmDialog);
pointConfirmCancelButton?.addEventListener('click', () => closePointConfirmDialog({ action: 'cancel' }));
pointChangeCountButton?.addEventListener('click', showPointChangeWarning);
pointChangeBackButton?.addEventListener('click', resetPointConfirmMode);
pointChangeProceedButton?.addEventListener('click', showPointCountEditor);
pointInsufficientBuyButton?.addEventListener('click', () => closePointConfirmDialog({ action: 'cancel' }));
pointInsufficientContinueButton?.addEventListener('click', () => {
  closePointConfirmDialog({
    action: 'use-balance',
    count: state.pointConfirmBalanceValue,
  });
});
pointConfirmCountInput?.addEventListener('input', syncPointConfirmPreviewFromInput);
pointConfirmCountInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitPointConfirmDialog();
});
planConfirmCancelButton?.addEventListener('click', () => closePlanConfirmDialog({ action: 'cancel' }));
planConfirmSubmitButton?.addEventListener('click', submitPlanConfirmDialog);
planConfirmCountInput?.addEventListener('input', syncPlanConfirmButton);
planConfirmCountInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitPlanConfirmDialog();
});
document.querySelectorAll('[data-plan-cancel]').forEach((button) => {
  button.addEventListener('click', () => closePlanConfirmDialog({ action: 'cancel' }));
});
document.querySelectorAll('[data-point-cancel]').forEach((button) => {
  button.addEventListener('click', () => closePointConfirmDialog({ action: 'cancel' }));
});

document.querySelectorAll('[data-auth-close]').forEach((button) => {
  button.addEventListener('click', closeAuthModal);
});

document.querySelectorAll('[data-redeem-close]').forEach((button) => {
  button.addEventListener('click', closeRedeemModal);
});

document.querySelectorAll('[data-preview-close]').forEach((button) => {
  button.addEventListener('click', closePreview);
});

zoomOutButton.addEventListener('click', () => changePreviewZoom(-PREVIEW_ZOOM_STEP));
zoomInButton.addEventListener('click', () => changePreviewZoom(PREVIEW_ZOOM_STEP));
zoomResetButton.addEventListener('click', resetPreviewTransform);

previewStage.addEventListener(
  'wheel',
  (event) => {
    if (!previewImage.src) return;
    event.preventDefault();
    changePreviewZoom(event.deltaY > 0 ? -PREVIEW_ZOOM_STEP : PREVIEW_ZOOM_STEP);
  },
  { passive: false },
);

previewStage.addEventListener('pointerdown', (event) => {
  if (!previewImage.src || event.button !== 0) return;
  state.preview.isDragging = true;
  state.preview.startX = event.clientX;
  state.preview.startY = event.clientY;
  state.preview.originX = state.preview.offsetX;
  state.preview.originY = state.preview.offsetY;
  previewStage.setPointerCapture(event.pointerId);
  previewStage.classList.add('dragging');
});

previewStage.addEventListener('pointermove', (event) => {
  if (!state.preview.isDragging) return;
  state.preview.offsetX = state.preview.originX + event.clientX - state.preview.startX;
  state.preview.offsetY = state.preview.originY + event.clientY - state.preview.startY;
  renderPreviewTransform();
});

previewStage.addEventListener('pointerup', stopPreviewDrag);
previewStage.addEventListener('pointercancel', stopPreviewDrag);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && planConfirmModal.classList.contains('open')) {
    closePlanConfirmDialog({ action: 'cancel' });
    return;
  }
  if (event.key === 'Escape' && pointConfirmModal.classList.contains('open')) {
    closePointConfirmDialog({ action: 'cancel' });
    return;
  }
  if (!previewModal.classList.contains('open')) return;
  if (event.key === 'Escape') closePreview();
  if (event.key === '+' || event.key === '=') changePreviewZoom(PREVIEW_ZOOM_STEP);
  if (event.key === '-') changePreviewZoom(-PREVIEW_ZOOM_STEP);
  if (event.key === '0') resetPreviewTransform();
});

window.addEventListener('pagehide', () => {
  cancelActiveGenerationBatches();
});

promptInput.placeholder = PROMPT_PLACEHOLDER;
materialTypeInput.value = '';
scenarioInput.value = '';
syncCustomRatioField();
renderGenerationRule();
refreshCurrentUser();
checkHealth();

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    state.apiConfigured = Boolean(data.configured);
    state.ruleApiConfigured = Boolean(data.ruleConfigured);
  } catch {
    state.apiConfigured = false;
    state.ruleApiConfigured = false;
  }
}

async function refreshCurrentUser() {
  try {
    const response = await fetch('/api/auth/me');
    const data = await response.json();
    state.currentUser = data.authenticated ? data.user : null;
    state.setupRequired = Boolean(data.setupRequired);
  } catch {
    state.currentUser = null;
    state.setupRequired = false;
  }
  renderAuthState();
}

function renderAuthState() {
  if (state.currentUser) {
    if (userBadge) userBadge.textContent = `${state.currentUser.username}｜积分 ${state.currentUser.points}`;
    if (authButton) authButton.hidden = true;
    if (logoutButton) logoutButton.hidden = false;
    if (redeemButton) redeemButton.disabled = false;
    generateButton.textContent = state.isGenerating
      ? '生成中'
      : state.isConfirmingRule
        ? '规划中'
        : '生成教辅图片';
    return;
  }

  if (userBadge) userBadge.textContent = '未登录';
  if (authButton) authButton.hidden = false;
  if (logoutButton) logoutButton.hidden = true;
  if (redeemButton) redeemButton.disabled = false;
  if (!state.isGenerating && !state.isConfirmingRule) {
    generateButton.textContent = '登录后生成';
  }
}

function applyPointBalance(points) {
  if (!state.currentUser || !Number.isFinite(Number(points))) return;
  state.currentUser = {
    ...state.currentUser,
    points: Math.max(0, Math.floor(Number(points))),
  };
  renderAuthState();
}

function requireLoggedIn() {
  if (state.currentUser) return true;
  openAuthModal();
  showToast('请先登录或注册');
  return false;
}

function openAuthModal() {
  authModal.classList.add('open');
  authModal.setAttribute('aria-hidden', 'false');
  authUsernameInput.focus();
}

function closeAuthModal() {
  authModal.classList.remove('open');
  authModal.setAttribute('aria-hidden', 'true');
}

function openRedeemModal() {
  redeemModal.classList.add('open');
  redeemModal.setAttribute('aria-hidden', 'false');
  redeemCodeInput.focus();
}

function closeRedeemModal() {
  redeemModal.classList.remove('open');
  redeemModal.setAttribute('aria-hidden', 'true');
}

async function submitAuth(mode) {
  const username = authUsernameInput.value.trim();
  const password = authPasswordInput.value;
  if (!username || !password) {
    showToast('请填写账号和密码');
    return;
  }

  const button = mode === 'register' ? registerButton : loginButton;
  button.disabled = true;
  try {
    const data = await requestJson(`/api/auth/${mode}`, {
      method: 'POST',
      body: { username, password },
    });
    state.currentUser = data.user;
    closeAuthModal();
    renderAuthState();
    showToast(mode === 'register'
      ? data.setupAdminCreated
        ? '注册成功，首个账号已成为管理员'
        : '注册成功'
      : '登录成功');
  } catch (error) {
    showToast(error instanceof Error ? error.message : '登录失败');
  } finally {
    button.disabled = false;
  }
}

async function logoutCurrentUser() {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } catch {
    // 退出时本地清理优先，接口失败也不阻塞用户界面。
  }
  state.currentUser = null;
  renderAuthState();
  showToast('已退出登录');
}

async function redeemPoints() {
  const code = redeemCodeInput.value.trim();
  if (!code) {
    showToast('请填写积分卡密');
    return;
  }

  redeemSubmitButton.disabled = true;
  try {
    const data = await requestJson('/api/points/redeem', {
      method: 'POST',
      body: { code },
    });
    state.currentUser = data.user;
    redeemCodeInput.value = '';
    closeRedeemModal();
    renderAuthState();
    showToast(`兑换成功，增加 ${data.redeemedPoints} 积分`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '兑换失败');
  } finally {
    redeemSubmitButton.disabled = false;
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body
      ? { 'Content-Type': 'application/json' }
      : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || '请求失败');
    error.status = response.status;
    throw error;
  }
  return data;
}

function bindUploadZone(zone, addFiles) {
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dragging');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragging');
  });

  zone.addEventListener('drop', async (event) => {
    event.preventDefault();
    zone.classList.remove('dragging');
    await addFiles([...event.dataTransfer.files]);
  });
}

async function addKnowledgeFiles(files) {
  const acceptedFiles = files.filter(isSupportedKnowledgeFile);
  if (acceptedFiles.length < files.length) {
    showToast('部分知识库文件格式暂不支持');
  }

  for (const file of acceptedFiles) {
    try {
      const fileId = createClientId();
      const encoded = isKnowledgeImageFile(file)
        ? await compressImage(file, { maxEdge: 1600, quality: 0.86 })
        : await readFileAsDataUrl(file);
      state.knowledgeFiles.push({
        id: fileId,
        name: file.name,
        mimeType: encoded.mimeType || file.type || inferMimeType(file.name),
        size: file.size,
        dataUrl: encoded.dataUrl,
      });
      if (isPdfKnowledgeFile(file)) {
        batchSummary.textContent = '正在读取 PDF 页面内容';
        try {
          const pdfEvidence = await extractPdfKnowledgeEvidence(file, fileId);
          state.knowledgeFiles.push(...pdfEvidence.files);
          if (pdfEvidence.files.length > 0) {
            showToast(`已读取 PDF 页面内容 ${pdfEvidence.pageImageCount} 页作为知识库证据`);
          }
        } catch {
          showToast(`PDF 页面截图读取失败，将继续使用可提取文本：${file.name}`);
        }
      }
    } catch {
      showToast(`无法读取知识库文件：${file.name}`);
    }
  }

  invalidateGenerationRule();
  renderKnowledgeFiles();
}

async function addReferenceFiles(files) {
  const imageFiles = files.filter(isKnowledgeImageFile);
  const availableSlots = Math.max(0, 4 - state.styleReferences.length);
  const selected = imageFiles.slice(0, availableSlots);

  if (selected.length < imageFiles.length) {
    showToast('参考风格图最多保留 4 张');
  }

  for (const file of selected) {
    try {
      const compressed = await compressImage(file);
      state.styleReferences.push(compressed);
    } catch {
      showToast(`无法读取参考风格图：${file.name}`);
    }
  }

  invalidateGenerationRule();
  renderReferences();
}

function renderKnowledgeFiles() {
  knowledgeStrip.innerHTML = '';
  state.knowledgeFiles.filter((file) => !file.hidden).forEach((file) => {
    const index = state.knowledgeFiles.indexOf(file);
    const item = document.createElement('div');
    item.className = 'knowledge-item';
    const evidenceCount = state.knowledgeFiles.filter(
      (candidate) => candidate.hidden && candidate.sourceFileId === file.id && candidate.evidenceKind === 'pdf-page-image',
    ).length;
    item.innerHTML = `
      <span class="knowledge-type">${escapeHtml(getFileBadge(file.name, file.mimeType))}</span>
      <span class="knowledge-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}${evidenceCount > 0 ? `（已读取 ${evidenceCount} 页内容）` : ''}</span>
      <button type="button" aria-label="移除知识库文件">×</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      const removed = state.knowledgeFiles[index];
      state.knowledgeFiles = state.knowledgeFiles.filter(
        (candidate, candidateIndex) =>
          candidateIndex !== index &&
          (!removed?.id || candidate.sourceFileId !== removed.id),
      );
      invalidateGenerationRule();
      renderKnowledgeFiles();
    });
    knowledgeStrip.appendChild(item);
  });
}

function renderReferences() {
  referenceStrip.innerHTML = '';
  state.styleReferences.forEach((image, index) => {
    const item = document.createElement('div');
    item.className = 'reference-item';
    item.innerHTML = `
      <img src="${image.dataUrl}" alt="参考风格图 ${index + 1}" />
      <button type="button" aria-label="移除参考风格图">×</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      state.styleReferences.splice(index, 1);
      invalidateGenerationRule();
      renderReferences();
    });
    referenceStrip.appendChild(item);
  });
}

async function confirmGenerationRules(options = {}) {
  const silent = Boolean(options.silent);
  const validation = options.validation || validateGenerationInputs({ allowAutoCount: true });
  if (!validation.ok) return;

  if (!state.ruleApiConfigured) {
    batchSummary.textContent = '未配置密钥';
    showToast('请联系管理员配置生成规则确认接口');
    return;
  }

  const payload = buildGenerationPayload(validation);

  setRuleConfirming(true);
  if (!silent) {
    renderGenerationRule({
      pending: true,
      message: PLANNING_PROGRESS_MESSAGE,
    });
  }
  batchSummary.textContent = PLANNING_PROGRESS_MESSAGE;

  try {
    const data = await fetchJson('/api/generation-rule', payload, { maxAttempts: 2 });
    const rule = normalizeRuleForClient(data.rule, data.count || validation.count || 0);
    state.generationRule = rule;
    countInput.value = String(rule.count);
    const confirmedPayload = buildGenerationPayload({
      ...validation,
      count: rule.count,
    });
    state.generationRuleSignature = createGenerationRuleSignature(confirmedPayload);
    if (!silent) {
      renderGenerationRule();
      showToast('生成规则已确认');
    }
    batchSummary.textContent = `准备生成 ${rule.count} 张`;
    return {
      rule,
      validation: {
        ...validation,
        count: rule.count,
      },
    };
  } catch (error) {
    state.generationRule = null;
    state.generationRuleSignature = '';
    if (error?.status === 401) {
      state.currentUser = null;
      renderAuthState();
      openAuthModal();
    }
    if (!silent) {
      renderGenerationRule({
        error: error instanceof Error ? error.message : '生成规则失败',
      });
    }
    batchSummary.textContent = '规则生成失败';
    showToast(error instanceof Error ? error.message : '生成规则失败');
    return null;
  } finally {
    setRuleConfirming(false);
  }
}

async function generateTeachingAids() {
  const validation = validateGenerationInputs({ allowAutoCount: true });
  if (!validation.ok) return;

  if (!requireLoggedIn()) return;

  if (!state.apiConfigured) {
    batchSummary.textContent = '未配置密钥';
    showToast('请联系管理员配置 AI 生图接口');
    return;
  }

  if (!state.ruleApiConfigured) {
    batchSummary.textContent = '未配置密钥';
    showToast('请联系管理员配置生成规则确认接口');
    return;
  }

  abortRetryControllers();

  let confirmation = await confirmGenerationRules({
    validation,
    silent: true,
  });

  let confirmedValidation = null;
  while (confirmation) {
    const planDecision = await openPlanConfirmDialog(confirmation.validation.count);

    if (planDecision.action === 'change-count') {
      countInput.value = String(planDecision.count);
      invalidateGenerationRule();
      batchSummary.textContent = `正在按 ${planDecision.count} 张重新规划内容`;
      showToast(`正在按 ${planDecision.count} 张重新规划内容`);
      confirmation = await confirmGenerationRules({
        validation: {
          ...confirmation.validation,
          count: planDecision.count,
        },
        silent: true,
      });
      continue;
    }

    if (planDecision.action !== 'confirm') return;

    const decision = await confirmPointCharge(confirmation.validation.count, {
      allowChangeCount: false,
    });

    if (decision.action === 'confirm') {
      confirmedValidation = confirmation.validation;
      break;
    }

    if (decision.action !== 'use-balance') {
      return;
    }

    countInput.value = String(decision.count);
    invalidateGenerationRule();
    batchSummary.textContent = `正在按 ${decision.count} 张重新规划内容`;
    showToast(`正在按 ${decision.count} 张重新规划内容`);
    confirmation = await confirmGenerationRules({
      validation: {
        ...confirmation.validation,
        count: decision.count,
      },
      silent: true,
    });

    if (decision.action === 'use-balance' && confirmation) {
      confirmedValidation = confirmation.validation;
      break;
    }
  }

  if (!confirmedValidation) return;

  const payload = buildGenerationPayload(confirmedValidation, { includeRule: true });
  const signature = createGenerationRuleSignature(payload);
  if (!state.generationRule || state.generationRuleSignature !== signature) {
    showToast('生成规则已过期，请重新点击生成');
    return;
  }

  const count = confirmedValidation.count;
  setGenerating(true);
  state.results = createPendingResults(count);
  renderResults();
  batchSummary.textContent = '图片生成中，AI正在推理和绘制，为保证质量，时间可能会较久，请耐心等待3-10分钟';

  state.lastGeneratePayload = clonePayload(payload);

  try {
    const data = await fetchGenerationStream('/api/generate/stream', payload, {
      onStart(event) {
        if (event.points) {
          applyPointBalance(event.points.balance);
        }
        if (Array.isArray(event.batchItems) && event.batchItems.length === count) {
          state.lastGeneratePayload.batchItems = event.batchItems;
          state.results = createPendingResults(count, event.batchItems);
          renderResults();
        }
      },
      onResult(result) {
        mergeFinalResult(result);
        renderResultAt(result?.index);
        updateBatchSummary();
      },
    });

    updateBatchSummary(data.summary);
    if (data.summary?.points) {
      applyPointBalance(data.summary.points.balance);
    } else {
      await refreshCurrentUser();
    }
    if (
      data.summary.success === 0 &&
      data.summary.failed > 0 &&
      hasReferenceAssets()
    ) {
      renderReferenceFallbackNotice();
    }
  } catch (error) {
    if (error?.status === 401) {
      state.currentUser = null;
      renderAuthState();
      openAuthModal();
    }
    const hasReturnedResult = state.results.some((item) => item.status === 'ok' || item.status === 'error');
    if (hasReturnedResult) {
      state.results = state.results.map((item) =>
        item.status === 'pending'
          ? { ...item, status: 'error', error: '本张未返回，已停止继续生成' }
          : item,
      );
      renderResults();
      updateBatchSummary();
    } else {
      resultGrid.innerHTML = '';
      const card = document.createElement('article');
      card.className = 'error-card';
      card.textContent = error instanceof Error ? error.message : '生成失败';
      resultGrid.appendChild(card);
    }
    if (hasReferenceAssets()) {
      renderReferenceFallbackNotice();
    }
    batchSummary.textContent = '生成失败';
    showToast(error instanceof Error ? error.message : '生成失败');
    await refreshCurrentUser();
  } finally {
    setGenerating(false);
  }
}

function openPlanConfirmDialog(count) {
  const normalizedCount = Math.max(1, Math.min(MAX_GENERATION_COUNT, Number(count) || 1));
  state.planConfirmOriginalCount = normalizedCount;
  planConfirmSuggestedCount.textContent = String(normalizedCount);
  planConfirmCountInput.value = String(normalizedCount);
  syncPlanConfirmButton();
  planConfirmModal.classList.add('open');
  planConfirmModal.setAttribute('aria-hidden', 'false');
  planConfirmSubmitButton.focus();

  return new Promise((resolve) => {
    state.planConfirmResolve = resolve;
  });
}

function closePlanConfirmDialog(decision = { action: 'cancel' }) {
  if (!planConfirmModal.classList.contains('open')) return;
  planConfirmModal.classList.remove('open');
  planConfirmModal.setAttribute('aria-hidden', 'true');
  const resolve = state.planConfirmResolve;
  state.planConfirmResolve = null;
  resolve?.(decision);
}

function syncPlanConfirmButton() {
  const count = Number(planConfirmCountInput.value);
  const valid = Number.isInteger(count) && count >= 1 && count <= MAX_GENERATION_COUNT;
  planConfirmSubmitButton.disabled = !valid;
  planConfirmSubmitButton.textContent = valid && count !== state.planConfirmOriginalCount
    ? '按新数量重新规划'
    : '确认数量并继续';
}

function submitPlanConfirmDialog() {
  const count = Number(planConfirmCountInput.value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATION_COUNT) {
    planConfirmCountInput.setCustomValidity(`图片数量必须是 1-${MAX_GENERATION_COUNT} 的整数`);
    planConfirmCountInput.reportValidity();
    return;
  }
  planConfirmCountInput.setCustomValidity('');
  closePlanConfirmDialog(count === state.planConfirmOriginalCount
    ? { action: 'confirm' }
    : { action: 'change-count', count });
}

async function confirmPointCharge(count, options = {}) {
  await refreshCurrentUser();
  if (!state.currentUser) {
    if (IS_PLATFORM_MODE) location.replace('/?login=1');
    else openAuthModal();
    return { action: 'cancel' };
  }

  if (IS_PLATFORM_MODE) {
    try {
      const allowed = typeof window.HZQ?.checkCredit === 'function'
        ? await window.HZQ.checkCredit()
        : true;
      return allowed ? { action: 'confirm' } : { action: 'cancel' };
    } catch (error) {
      showToast(error instanceof Error ? error.message : '积分状态读取失败');
      return { action: 'cancel' };
    }
  }

  const cost = Math.max(1, Number(count) || 0);
  if (state.currentUser.points < cost) {
    return openPointInsufficientDialog(cost, state.currentUser.points);
  }

  return openPointConfirmDialog(cost, state.currentUser.points, options);
}

function openPointInsufficientDialog(cost, balance) {
  state.pointConfirmMode = 'insufficient';
  state.pointConfirmAllowChangeCount = false;
  state.pointConfirmOriginalCount = cost;
  state.pointConfirmBalanceValue = balance;
  pointConfirmCost.textContent = String(cost);
  pointConfirmCount.textContent = String(cost);
  pointConfirmBalance.textContent = String(balance);
  pointConfirmAfter.textContent = '不足';
  pointInsufficientMessage.textContent = `AI 建议生成 ${cost} 张，需要 ${cost} 积分；当前仅有 ${balance} 积分。`;
  pointInsufficientContinueButton.textContent = `按 ${balance} 张继续生成`;
  pointInsufficientContinueButton.hidden = balance < 1;
  renderPointConfirmMode();
  pointConfirmModal.classList.add('open');
  pointConfirmModal.setAttribute('aria-hidden', 'false');
  (balance > 0 ? pointInsufficientContinueButton : pointInsufficientBuyButton).focus();

  return new Promise((resolve) => {
    state.pointConfirmResolve = resolve;
  });
}

function openPointConfirmDialog(cost, balance, options = {}) {
  state.pointConfirmMode = 'confirm';
  state.pointConfirmAllowChangeCount = options.allowChangeCount !== false;
  state.pointConfirmOriginalCount = cost;
  state.pointConfirmBalanceValue = balance;
  pointConfirmCost.textContent = String(cost);
  pointConfirmCount.textContent = String(cost);
  pointConfirmBalance.textContent = String(balance);
  pointConfirmAfter.textContent = String(Math.max(0, balance - cost));
  pointConfirmCountInput.value = String(cost);
  renderPointConfirmMode();
  pointConfirmModal.classList.add('open');
  pointConfirmModal.setAttribute('aria-hidden', 'false');
  pointConfirmConfirmButton.focus();

  return new Promise((resolve) => {
    state.pointConfirmResolve = resolve;
  });
}

function closePointConfirmDialog(decision = { action: 'cancel' }) {
  if (!pointConfirmModal.classList.contains('open')) return;
  pointConfirmModal.classList.remove('open');
  pointConfirmModal.setAttribute('aria-hidden', 'true');
  resetPointConfirmMode({ restoreCount: true, focus: false });
  const resolve = state.pointConfirmResolve;
  state.pointConfirmResolve = null;
  resolve?.(normalizePointConfirmDecision(decision));
}

function normalizePointConfirmDecision(decision) {
  if (decision === true) return { action: 'confirm' };
  if (decision === false || !decision || typeof decision !== 'object') return { action: 'cancel' };
  if (decision.action === 'change-count') {
    const count = Number(decision.count);
    return Number.isInteger(count) && count >= 1 && count <= MAX_GENERATION_COUNT
      ? { action: 'change-count', count }
      : { action: 'cancel' };
  }
  if (decision.action === 'use-balance') {
    const count = Number(decision.count);
    return Number.isInteger(count) && count >= 1 && count <= MAX_GENERATION_COUNT
      ? { action: 'use-balance', count }
      : { action: 'cancel' };
  }
  return decision.action === 'confirm' ? { action: 'confirm' } : { action: 'cancel' };
}

function showPointChangeWarning() {
  if (!state.pointConfirmAllowChangeCount) return;
  state.pointConfirmMode = 'warning';
  renderPointConfirmMode();
  pointChangeProceedButton?.focus();
}

function resetPointConfirmMode(options = {}) {
  const restoreCount = options.restoreCount !== false;
  state.pointConfirmMode = 'confirm';
  if (restoreCount && state.pointConfirmOriginalCount) {
    pointConfirmCost.textContent = String(state.pointConfirmOriginalCount);
    pointConfirmCount.textContent = String(state.pointConfirmOriginalCount);
    pointConfirmAfter.textContent = String(Math.max(0, state.pointConfirmBalanceValue - state.pointConfirmOriginalCount));
    pointConfirmCountInput.value = String(state.pointConfirmOriginalCount);
  }
  renderPointConfirmMode();
  if (options.focus !== false) {
    pointChangeCountButton?.focus();
  }
}

function showPointCountEditor() {
  state.pointConfirmMode = 'editing';
  pointConfirmCountInput.value = String(state.pointConfirmOriginalCount || 1);
  renderPointConfirmMode();
  syncPointConfirmPreviewFromInput();
  pointConfirmCountInput.focus();
  pointConfirmCountInput.select();
}

function submitPointConfirmDialog() {
  if (state.pointConfirmMode === 'editing') {
    const nextCount = parsePointConfirmDialogCount();
    if (!nextCount) return;

    if (nextCount === state.pointConfirmOriginalCount) {
      closePointConfirmDialog({ action: 'confirm' });
      return;
    }

    closePointConfirmDialog({
      action: 'change-count',
      count: nextCount,
    });
    return;
  }

  if (state.pointConfirmMode === 'warning') return;
  closePointConfirmDialog({ action: 'confirm' });
}

function renderPointConfirmMode() {
  const mode = state.pointConfirmMode;
  pointConfirmModal.dataset.mode = mode;
  pointConfirmWarning.hidden = mode !== 'warning';
  pointInsufficientWarning.hidden = mode !== 'insufficient';
  pointConfirmEditor.hidden = mode !== 'editing';
  pointChangeCountButton.hidden = !state.pointConfirmAllowChangeCount || mode !== 'confirm';
  pointConfirmConfirmButton.hidden = mode === 'insufficient';
  pointConfirmConfirmButton.disabled = mode === 'warning';
  pointConfirmConfirmButton.textContent = mode === 'editing' ? '按新数量重新规划' : '确认生成';
}

function syncPointConfirmPreviewFromInput() {
  if (state.pointConfirmMode !== 'editing') return;
  const nextCount = Number(pointConfirmCountInput.value);
  if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > MAX_GENERATION_COUNT) return;
  pointConfirmCost.textContent = String(nextCount);
  pointConfirmCount.textContent = String(nextCount);
  pointConfirmAfter.textContent = String(Math.max(0, state.pointConfirmBalanceValue - nextCount));
}

function parsePointConfirmDialogCount() {
  const nextCount = Number(pointConfirmCountInput.value);
  if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > MAX_GENERATION_COUNT) {
    showToast(`最终生成图片数量必须是 1 到 ${MAX_GENERATION_COUNT} 的整数`);
    pointConfirmCountInput.focus();
    return 0;
  }
  return nextCount;
}

function validateGenerationInputs(options = {}) {
  const prompt = promptInput.value.trim();
  promptInput.setCustomValidity('');
  promptInput.classList.remove('input-needs-attention');
  const aspectRatio = aspectRatioInput.value;
  const customAspectRatio = customAspectRatioInput.value.trim();
  const allowAutoCount = Boolean(options.allowAutoCount);
  let count = parseGenerationCount({ allowEmpty: allowAutoCount });
  let resolvedAspectRatio = aspectRatio;
  let resolvedCustomAspectRatio = customAspectRatio;

  if (!prompt) {
    const message = '请先填写提示词，再生成教辅图片';
    showToast(message);
    promptInput.setCustomValidity(message);
    promptInput.classList.add('input-needs-attention');
    promptInput.focus();
    promptInput.reportValidity();
    return { ok: false };
  }

  if (!count) {
    if (allowAutoCount) {
      count = null;
    } else if (state.generationRule?.count) {
      count = state.generationRule.count;
      countInput.value = String(count);
    } else {
      showToast('批量数量建议留空，由 AI 在生成前智能判断数量');
      return { ok: false };
    }
  }

  if (aspectRatio === 'custom' && !isValidAspectRatio(customAspectRatio)) {
    showToast('请填写有效图片比例，例如 2:1、1.6:1 或 3:4');
    customAspectRatioInput.focus();
    return { ok: false };
  }

  if (aspectRatio === 'reference') {
    const referenceRatio = getReferenceAspectRatio();
    if (!referenceRatio) {
      showToast('选择“与参考图比例一致”时，请先上传参考风格图');
      referenceInput.focus();
      return { ok: false };
    }
    resolvedAspectRatio = 'custom';
    resolvedCustomAspectRatio = referenceRatio;
  }

  return {
    ok: true,
    prompt,
    count,
    aspectRatio,
    customAspectRatio,
    resolvedAspectRatio,
    resolvedCustomAspectRatio,
  };
}

function parseGenerationCount(options = {}) {
  const showError = options.showError !== false;
  const allowEmpty = Boolean(options.allowEmpty);
  if (countInput.value.trim() === '') {
    return allowEmpty ? null : 0;
  }

  const count = Number(countInput.value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATION_COUNT) {
    if (showError) {
      showToast(`批量数量必须是 1 到 ${MAX_GENERATION_COUNT} 的整数，或留空由 AI 智能判断`);
    }
    return 0;
  }
  return count;
}

function buildGenerationPayload(validation, options = {}) {
  const includeRule = Boolean(options.includeRule);
  const includeKnowledgeFiles = !includeRule || !hasCompleteKnowledgeGrounding(state.generationRule, validation.count);
  const payload = {
    prompt: validation.prompt,
    count: validation.count || undefined,
    grade: '',
    subject: '',
    materialType: materialTypeInput.value,
    scenario: scenarioInput.value,
    aspectRatio: validation.resolvedAspectRatio || validation.aspectRatio,
    customAspectRatio: validation.resolvedCustomAspectRatio || validation.customAspectRatio,
    options: {
      ...DEFAULT_OPTIONS,
      layoutFixed: layoutFixedInput.checked,
    },
    styleReferenceProvided: state.styleReferences.length > 0,
    styleReferenceCount: state.styleReferences.length,
  };

  if (!includeRule) {
    payload.styleReferenceImages = state.styleReferences;
  }

  if (includeKnowledgeFiles) {
    payload.knowledgeFiles = state.knowledgeFiles.map(serializeKnowledgeFileForApi);
  }

  if (includeRule && state.generationRule) {
    payload.generationRule = state.generationRule;
    payload.batchItems = state.generationRule.batchItems;
  }

  return payload;
}

function createGenerationRuleSignature(payload) {
  const knowledgeFiles = Array.isArray(payload.knowledgeFiles)
    ? payload.knowledgeFiles
    : state.knowledgeFiles.map(serializeKnowledgeFileForApi);
  const styleReferenceImages = Array.isArray(payload.styleReferenceImages)
    ? payload.styleReferenceImages
    : state.styleReferences;
  return JSON.stringify({
    prompt: payload.prompt,
    count: payload.count || null,
    materialType: payload.materialType,
    scenario: payload.scenario,
    aspectRatio: payload.aspectRatio,
    customAspectRatio: payload.customAspectRatio,
    layoutFixed: Boolean(payload.options?.layoutFixed),
    knowledgeFiles: knowledgeFiles.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      length: file.dataUrl.length,
    })),
    styleReferenceImages: styleReferenceImages.map((image) => ({
      name: image.name,
      mimeType: image.mimeType,
      width: image.width || 0,
      height: image.height || 0,
      length: image.dataUrl.length,
    })),
  });
}

function hasCompleteKnowledgeGrounding(rule, count) {
  if (!rule || typeof rule !== 'object') return false;
  const anchors = Array.isArray(rule.knowledgeBlueprint?.anchors) ? rule.knowledgeBlueprint.anchors : [];
  if (anchors.length === 0 || anchors.some((anchor) => !isCompleteKnowledgeAnchor(anchor))) return false;

  const resolvedCount = Number(count || rule.count);
  const pages = Array.isArray(rule.pages) ? rule.pages : [];
  if (!Number.isInteger(resolvedCount) || pages.length !== resolvedCount) return false;
  return pages.every((page) => isCompleteKnowledgeAnchor(page?.knowledgeAnchor));
}

function isCompleteKnowledgeAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') return false;
  return Boolean(String(anchor.title || '').trim() && String(anchor.content || '').trim());
}

function invalidateGenerationRule() {
  if (!state.generationRule) return;
  state.generationRuleSignature = '';
  renderGenerationRule();
}

function renderGenerationRule(status = {}) {
  if (rulePanel) {
    rulePanel.hidden = true;
    rulePanel.setAttribute('aria-hidden', 'true');
    rulePanel.classList.remove('stale');
    rulePanel.innerHTML = '';
  }
  if (ruleButton) {
    ruleButton.hidden = true;
    ruleButton.setAttribute('aria-hidden', 'true');
  }
  if (!status.show) return;

  if (status.pending) {
    rulePanel.hidden = false;
    rulePanel.classList.remove('stale');
    rulePanel.innerHTML = `
      <strong>${escapeHtml(status.message || '正在梳理生成规则')}</strong>
      <p>AI 正在理解任务意图、知识库主题层级和内容覆盖边界。</p>
    `;
    return;
  }

  if (status.error) {
    rulePanel.hidden = false;
    rulePanel.classList.add('stale');
    rulePanel.innerHTML = `
      <strong>生成规则失败</strong>
      <p>${escapeHtml(status.error)}</p>
    `;
    return;
  }

  if (!state.generationRule) {
    rulePanel.hidden = true;
    rulePanel.classList.remove('stale');
    rulePanel.innerHTML = '';
    return;
  }

  const stale = status.stale || !state.generationRuleSignature;
  const rule = state.generationRule;
  rulePanel.hidden = false;
  rulePanel.classList.toggle('stale', stale);

  const pages = rule.pages
    .map((page, index) => `
      <li>
        <strong>第 ${index + 1} 张：${escapeHtml(page.title || page.focus || '页面规划')}</strong>
        <p>${escapeHtml(page.focus || '')}</p>
      </li>
    `)
    .join('');
  const checklist = rule.coverageChecklist
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const inventory = rule.contentInventory
    .slice(0, 40)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const hierarchy = rule.contentHierarchy
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const coverageMap = rule.coverageMap
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const coverageAudit = rule.coverageAudit
    .slice(0, 40)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const evidence = renderRuleEvidence(rule.evidence);

  rulePanel.innerHTML = `
    <strong>${stale ? '生成规则需重新确认' : '生成规则已确认'}</strong>
    <p>AI 基于内容规划判定生成数量：${escapeHtml(String(rule.count))} 张${rule.countReason ? `，${escapeHtml(rule.countReason)}` : ''}</p>
    ${status.message ? `<p>${escapeHtml(status.message)}</p>` : ''}
    ${evidence}
    <div class="rule-section">
      <h3>意图与整体逻辑</h3>
      ${rule.intentAnalysis ? `<p>${escapeHtml(rule.intentAnalysis)}</p>` : ''}
      ${rule.countStrategy ? `<p>${escapeHtml(rule.countStrategy)}</p>` : ''}
      <p>${escapeHtml(rule.summary || '已完成生成意图整理。')}</p>
      ${rule.contentLogic ? `<p>${escapeHtml(rule.contentLogic)}</p>` : ''}
      ${rule.contentProductionStrategy ? `<p>${escapeHtml(rule.contentProductionStrategy)}</p>` : ''}
      ${rule.styleAdvice ? `<p>${escapeHtml(rule.styleAdvice)}</p>` : ''}
    </div>
    ${inventory ? `
      <div class="rule-section">
        <h3>内容盘点</h3>
        <ul class="rule-list">${inventory}</ul>
      </div>
    ` : ''}
    ${hierarchy ? `
      <div class="rule-section">
        <h3>主题层级</h3>
        <ul class="rule-list">${hierarchy}</ul>
      </div>
    ` : ''}
    ${coverageMap ? `
      <div class="rule-section">
        <h3>覆盖映射</h3>
        <ul class="rule-list">${coverageMap}</ul>
      </div>
    ` : ''}
    ${coverageAudit ? `
      <div class="rule-section">
        <h3>覆盖审计</h3>
        <ul class="rule-list">${coverageAudit}</ul>
      </div>
    ` : ''}
    <div class="rule-section">
      <h3>页面规划</h3>
      <ul class="rule-list">${pages}</ul>
    </div>
    ${checklist ? `
      <div class="rule-section">
        <h3>覆盖检查</h3>
        <ul class="rule-list">${checklist}</ul>
      </div>
    ` : ''}
  `;
}

function renderRuleEvidence(evidence) {
  if (!evidence) return '';

  const fileItems = Array.isArray(evidence.files)
    ? evidence.files.slice(0, 6).map((file) => `
      <li>
        <strong>${escapeHtml(file.name || '知识库文件')}</strong>
        <p>${escapeHtml(file.note || '已作为知识库内容证据读取')}</p>
        ${file.renderedPageCount > 0 ? `<small>${escapeHtml(formatSampledPageText(file))}</small>` : ''}
      </li>
    `).join('')
    : '';

  return `
    <div class="rule-section">
      <h3>分析依据</h3>
      <p>${escapeHtml(formatRuleEvidenceSummary(evidence))}</p>
      ${fileItems ? `<ul class="rule-list compact">${fileItems}</ul>` : ''}
    </div>
  `;
}

function formatSampledPageText(file) {
  const pages = Array.isArray(file.sampledPages) && file.sampledPages.length > 0
    ? file.sampledPages.join('、')
    : `${file.renderedPageCount} 页`;
  return `PDF 页面截图仅作内容识别证据：${pages}`;
}

function formatRuleEvidenceSummary(evidence) {
  const parts = [
    `已读取文本/标题线索 ${evidence.totalTextChars || 0} 字符`,
  ];
  if (evidence.pdfPageImageCount > 0) {
    parts.push(`PDF 页面截图 ${evidence.pdfPageImageCount} 张仅作内容识别`);
  }
  if (evidence.knowledgeImageCount > 0) {
    parts.push(`知识库图片 ${evidence.knowledgeImageCount} 张仅作内容证据`);
  }
  parts.push('源文件页数、截图数量和上传图片数量不作为生成数量依据');
  return `${parts.join('，')}。`;
}

function normalizeRuleForClient(rule, count) {
  const resolvedCount = resolveClientRuleCount(rule, count);
  const knowledgeBlueprint = normalizeClientKnowledgeBlueprint(rule?.knowledgeBlueprint);
  const pages = Array.isArray(rule?.pages)
    ? rule.pages.slice(0, resolvedCount).map((page, index) => {
        const title = cleanRuleTextForClient(page?.title || `第 ${index + 1} 张`, 120);
        const focus = cleanRuleTextForClient(page?.focus, 360);
        const anchorIndex = Number(page?.knowledgeAnchorIndex);
        return {
          index,
          title: isBadClientRuleText(title) ? `第 ${index + 1} 张` : title,
          focus: isBadClientRuleText(focus) ? `整理知识库中的第 ${index + 1} 个核心内容单元` : focus,
          sourceLogic: cleanRuleTextForClient(page?.sourceLogic, 260),
          mustInclude: normalizeClientList(page?.mustInclude, 12, 200),
          avoid: normalizeClientList(page?.avoid, 6, 140),
          knowledgeAnchorIndex: Number.isInteger(anchorIndex) ? anchorIndex : -1,
          knowledgeAnchor: normalizeClientKnowledgeAnchor(page?.knowledgeAnchor),
        };
      })
    : [];

  while (pages.length < resolvedCount) {
    const index = pages.length;
    pages.push({
      index,
      title: `第 ${index + 1} 张`,
      focus: `围绕用户需求生成第 ${index + 1} 张独立教辅页面`,
      sourceLogic: '',
      mustInclude: [],
      avoid: [],
      knowledgeAnchorIndex: -1,
      knowledgeAnchor: null,
    });
  }

  const batchItems = Array.isArray(rule?.batchItems)
    ? rule.batchItems.slice(0, resolvedCount).map((item) => cleanRuleTextForClient(item, CLIENT_BATCH_ITEM_MAX_CHARS))
    : [];

  return {
    count: resolvedCount,
    recommendedCount: resolvedCount,
    countReason: cleanRuleTextForClient(rule?.countReason, 500),
    evidence: normalizeRuleEvidence(rule?.evidence),
    knowledgeBlueprint,
    intentAnalysis: cleanRuleTextForClient(rule?.intentAnalysis, 1000),
    countStrategy: cleanRuleTextForClient(rule?.countStrategy, 1200),
    summary: cleanRuleTextForClient(rule?.summary, 800),
    contentLogic: cleanRuleTextForClient(rule?.contentLogic, 1200),
    contentProductionStrategy: cleanRuleTextForClient(rule?.contentProductionStrategy, 1200),
    layoutLogic: cleanRuleTextForClient(rule?.layoutLogic, 1200),
    styleLogic: cleanRuleTextForClient(rule?.styleLogic, 1200),
    styleAdvice: cleanRuleTextForClient(rule?.styleAdvice, 1000),
    contentInventory: normalizeClientList(rule?.contentInventory, RULE_CONTENT_INVENTORY_MAX_ITEMS, 280),
    contentUnits: normalizeClientList(rule?.contentUnits, MAX_GENERATION_COUNT, 180),
    contentHierarchy: normalizeClientList(rule?.contentHierarchy, MAX_GENERATION_COUNT, 260),
    coverageMap: normalizeClientList(rule?.coverageMap, MAX_GENERATION_COUNT, 260),
    coverageChecklist: normalizeClientList(rule?.coverageChecklist, RULE_COVERAGE_CHECKLIST_MAX_ITEMS, 260),
    coverageAudit: normalizeClientList(rule?.coverageAudit, RULE_COVERAGE_CHECKLIST_MAX_ITEMS, 280),
    riskNotes: normalizeClientList(rule?.riskNotes, RULE_RISK_NOTES_MAX_ITEMS, 260),
    pages,
    batchItems: pages.map((page, index) =>
      batchItems[index] ||
      cleanClientText(
        [
          page.title,
          page.focus,
          page.sourceLogic ? `资料依据：${page.sourceLogic}` : '',
          page.mustInclude.length > 0 ? `必须包含：${page.mustInclude.join('；')}` : '',
          page.avoid.length > 0 ? `避免混入：${page.avoid.join('；')}` : '',
          page.knowledgeAnchor ? `知识库锚点：${page.knowledgeAnchor.title}；${page.knowledgeAnchor.content}` : '',
        ].filter(Boolean).join('。'),
        CLIENT_BATCH_ITEM_MAX_CHARS,
      ),
    ),
  };
}

function normalizeClientKnowledgeBlueprint(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    intent: cleanRuleTextForClient(source.intent, 800),
    sourceSummaries: normalizeClientList(source.sourceSummaries, KNOWLEDGE_BLUEPRINT_MAX_SOURCE_SUMMARIES, 260),
    anchors: Array.isArray(source.anchors)
      ? source.anchors.map(normalizeClientKnowledgeAnchor).filter(Boolean).slice(0, KNOWLEDGE_BLUEPRINT_MAX_ANCHORS)
      : [],
    uncertaintyNotes: normalizeClientList(source.uncertaintyNotes, KNOWLEDGE_BLUEPRINT_MAX_UNCERTAINTY_NOTES, 260),
  };
}

function normalizeClientKnowledgeAnchor(value) {
  if (!value || typeof value !== 'object') return null;
  const title = cleanRuleTextForClient(value.title, 120);
  const content = cleanRuleTextForClient(value.content || value.focus || value.summary, KNOWLEDGE_ANCHOR_TEXT_MAX_CHARS);
  const mustInclude = normalizeClientList(value.mustInclude, 16, KNOWLEDGE_ANCHOR_MUST_INCLUDE_MAX_CHARS);
  const source = cleanRuleTextForClient(value.source || value.sourceLogic, 220);
  const confidence = ['high', 'medium', 'low'].includes(String(value.confidence || '').toLowerCase())
    ? String(value.confidence).toLowerCase()
    : 'medium';
  if (!title && !content && mustInclude.length === 0) return null;
  return {
    title: title || content.slice(0, 80) || '知识库内容锚点',
    content: content || title,
    mustInclude,
    source,
    confidence,
  };
}

function normalizeClientList(value, limit, maxLength) {
  const source = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return source
    .map((item) => cleanRuleTextForClient(item, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeRuleEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return {
      totalPages: 0,
      totalTextChars: 0,
      estimatedContentUnits: 0,
      knowledgeImageCount: 0,
      pdfPageImageCount: 0,
      pdfPageImageLimit: 0,
      files: [],
    };
  }

  return {
    totalPages: toSafeNonNegativeInteger(evidence.totalPages),
    totalTextChars: toSafeNonNegativeInteger(evidence.totalTextChars),
    estimatedContentUnits: toSafeNonNegativeInteger(evidence.estimatedContentUnits),
    knowledgeImageCount: toSafeNonNegativeInteger(evidence.knowledgeImageCount),
    pdfPageImageCount: toSafeNonNegativeInteger(evidence.pdfPageImageCount),
    pdfPageImageLimit: toSafeNonNegativeInteger(evidence.pdfPageImageLimit),
    files: Array.isArray(evidence.files)
      ? evidence.files.slice(0, 20).map((file) => ({
          name: cleanRuleTextForClient(file?.name, 120),
          pageCount: toSafeNonNegativeInteger(file?.pageCount),
          textChars: toSafeNonNegativeInteger(file?.textChars),
          headingCount: toSafeNonNegativeInteger(file?.headingCount),
          estimatedUnits: toSafeNonNegativeInteger(file?.estimatedUnits),
          renderedPageCount: toSafeNonNegativeInteger(file?.renderedPageCount),
          sampledPages: normalizeSampledPages(file?.sampledPages),
          note: cleanRuleTextForClient(file?.note, 220),
        }))
      : [],
  };
}

function normalizeSampledPages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
    .slice(0, 24);
}

function toSafeNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function resolveClientRuleCount(rule, count) {
  const candidates = [
    Number(count),
    Number(rule?.count),
    Number(rule?.recommendedCount),
    Array.isArray(rule?.pages) ? rule.pages.length : 0,
    Array.isArray(rule?.batchItems) ? rule.batchItems.length : 0,
  ];

  for (const candidate of candidates) {
    if (Number.isInteger(candidate) && candidate >= 1 && candidate <= MAX_GENERATION_COUNT) {
      return candidate;
    }
  }

  return 1;
}

function cleanRuleTextForClient(value, maxLength) {
  return cleanClientText(
    stringifyRuleTextForClient(value)
      .replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/giu, ' ')
      .replace(/!\[[^\]]*\]\([^)]+\)/gu, ' ')
      .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gu, ' ')
      .replace(/[A-Za-z0-9+/=_-]{180,}/gu, ' ')
      .replace(/\[image_\d+\]/giu, ' ')
      .replace(/<img[^>]*>/giu, ' '),
    maxLength,
  );
}

function stringifyRuleTextForClient(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyRuleTextForClient).filter(Boolean).join('；');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value || '');
}

function isBadClientRuleText(value) {
  const text = cleanClientText(value, 80).replace(/[“”"'\s，。；:：、]/g, '');
  if (!text) return true;
  return /^(不要遗漏|别遗漏|确保不要遗漏|参考风格一样|风格一样|根据知识库内容|知识库内容|生成图片|独立页面|页面规划)$/u.test(text);
}

function cleanClientText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function createPendingResults(count, batchItems = []) {
  return Array.from({ length: count }, (_, index) => ({
    id: `pending-${index}`,
    index,
    status: 'pending',
    item: batchItems[index] || '',
  }));
}

function mergeFinalResult(result) {
  if (!result || !Number.isInteger(Number(result.index))) return;
  const index = Number(result.index);
  if (result.status === 'ok') {
    const storedImage = result.storedImage || result.image || '';
    state.results[index] = {
      ...result,
      index,
      image: storedImage,
      storedImage,
      saving: false,
      retrying: false,
      retryError: '',
    };
    return;
  }

  state.results[index] = {
    ...result,
    index,
    storedImage: '',
    saving: false,
    retrying: false,
  };
}

function getResultDisplayImage(item) {
  return resolveResultImageUrl(getResultSavedImage(item), PLATFORM_SITE_KEY);
}

function getResultSavedImage(item) {
  if (!item || item.status !== 'ok') return '';
  return item.storedImage || item.image || '';
}

function getResultActionImage(item) {
  return getResultDisplayImage(item);
}

function isResultSaved(item) {
  return Boolean(getResultSavedImage(item));
}

function renderResults() {
  if (state.results.length === 0) {
    resultGrid.innerHTML = sampleMarkup;
    return;
  }

  resultGrid.innerHTML = '';
  const fragment = document.createDocumentFragment();
  state.results.forEach((rawItem, index) => {
    fragment.appendChild(createResultElement(rawItem, index));
  });
  resultGrid.appendChild(fragment);
}

function renderResultAt(index) {
  const resolvedIndex = Number(index);
  if (!Number.isInteger(resolvedIndex) || resolvedIndex < 0 || resolvedIndex >= state.results.length) return;
  const item = state.results[resolvedIndex] || { id: `pending-${resolvedIndex}`, index: resolvedIndex, status: 'pending' };
  const current = resultGrid.querySelector(`[data-result-index="${resolvedIndex}"]`);

  if (current?.classList.contains('result-card') && item.status === 'ok') {
    updateSuccessResultCard(current, item, resolvedIndex);
    return;
  }

  const replacement = createResultElement(item, resolvedIndex);
  if (current) {
    current.replaceWith(replacement);
    return;
  }

  const following = [...resultGrid.querySelectorAll('[data-result-index]')].find(
    (element) => Number(element.dataset.resultIndex) > resolvedIndex,
  );
  resultGrid.insertBefore(replacement, following || null);
}

function createResultElement(rawItem, index) {
  const item = rawItem || { id: `pending-${index}`, index, status: 'pending' };
  if (item.status === 'pending') return createPendingResultElement(index);
  if (item.status !== 'ok') return createErrorResultElement(item, index);
  return createSuccessResultElement(item, index);
}

function createPendingResultElement(index) {
  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton';
  skeleton.dataset.resultIndex = String(index);
  return skeleton;
}

function createErrorResultElement(item, index) {
  const errorCard = document.createElement('article');
  errorCard.className = 'error-card retryable';
  errorCard.dataset.resultIndex = String(index);
  errorCard.setAttribute('role', 'button');
  errorCard.setAttribute('tabindex', '0');
  errorCard.setAttribute('aria-label', `重新生成第 ${index + 1} 张`);
  errorCard.innerHTML = `
    <strong>第 ${index + 1} 张失败</strong>
    <p>${escapeHtml(normalizeGenerationErrorMessage(item.error || '生成失败'))}</p>
    <button class="result-action" type="button" data-action="retry-single">重新生成本张</button>
  `;
  const retry = async () => {
    await retrySingleResult(index);
  };
  errorCard.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    retry();
  });
  errorCard.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    retry();
  });
  errorCard.querySelector('[data-action="retry-single"]').addEventListener('click', retry);
  return errorCard;
}

function createSuccessResultElement(item, index) {
  const card = document.createElement('article');
  card.className = 'result-card';
  card.dataset.resultIndex = String(index);
  card.innerHTML = `
    <div class="result-media">
      <button class="result-preview-button" type="button" data-action="preview" aria-label="预览第 ${index + 1} 张">
        <img alt="生成结果 ${index + 1}" loading="eager" decoding="async" fetchpriority="high" />
      </button>
    </div>
    <div class="result-meta">
      <strong></strong>
      <div class="result-actions">
        <button class="result-action" type="button" data-action="download">下载</button>
        <button class="result-action" type="button" data-action="reference">作风格参考</button>
        <button class="result-action" type="button" data-action="retry-single" hidden>重新生成</button>
      </div>
    </div>
  `;

  card.querySelector('[data-action="preview"]').addEventListener('click', () => {
    const image = card.querySelector('img');
    const source = image?.currentSrc || image?.src || resultImageSources.get(image) || '';
    if (source) openPreview(source, `第 ${index + 1} 张`);
  });
  card.querySelector('[data-action="download"]').addEventListener('click', () => {
    const source = getResultActionImage(state.results[index]);
    if (!source) {
      showToast('图片已生成，正在保存，稍后可下载');
      return;
    }
    downloadImage(source, `k12-teaching-aid-${index + 1}.png`);
  });
  card.querySelector('[data-action="reference"]').addEventListener('click', async () => {
    const source = getResultActionImage(state.results[index]);
    if (!source) {
      showToast('图片已生成，正在保存，稍后可作为参考图');
      return;
    }
    await addGeneratedImageAsReference(source, `generated-${index + 1}.png`);
  });
  card.querySelector('[data-action="retry-single"]').addEventListener('click', async () => {
    await retrySingleResult(index);
  });
  bindResultImageLoadGuard(card.querySelector('img'), index);
  updateSuccessResultCard(card, item, index);
  return card;
}

function updateSuccessResultCard(card, item, index) {
  const displayImage = getResultDisplayImage(item);
  const actionImage = getResultActionImage(item);
  const image = card.querySelector('img');
  const title = card.querySelector('.result-meta strong');
  const downloadButton = card.querySelector('[data-action="download"]');
  const referenceButton = card.querySelector('[data-action="reference"]');
  const retryButton = card.querySelector('[data-action="retry-single"]');

  card.classList.remove('is-saving', 'is-local-only');
  title.textContent = `第 ${index + 1} 张`;
  downloadButton.disabled = !actionImage;
  referenceButton.disabled = !actionImage;
  retryButton.hidden = true;
  card.querySelector('.result-status-badge')?.remove();

  const currentSource = resultImageSources.get(image) || '';
  if (displayImage && currentSource !== displayImage) {
    setResultImageSource(image, displayImage);
  }
}

function setResultImageSource(image, canonicalSource, requestSource = canonicalSource) {
  resultImageSources.set(image, canonicalSource);
  image.classList.remove('is-waiting-for-final');
  image.src = requestSource;
}

function normalizeGenerationErrorMessage(message) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  return text || '生成失败';
}

function bindResultImageLoadGuard(image) {
  image.addEventListener('load', () => {
    image.classList.remove('is-waiting-for-final');
  });
  image.addEventListener('error', () => {
    if (!image.isConnected) return;
    image.classList.add('is-waiting-for-final');
  });
}

async function retrySingleResult(index) {
  if (!state.lastGeneratePayload) {
    showToast('缺少上次生成参数，请重新发起整批生成');
    return;
  }

  if (state.retryingIndexes.has(index)) {
    showToast(`第 ${index + 1} 张正在重新生成`);
    return;
  }

  const current = state.results[index];
  if (!current || current.status === 'ok') return;

  const payload = clonePayload(state.lastGeneratePayload);
  payload.targetIndex = index;
  payload.count = Math.max(Number(payload.count) || 1, state.results.length);
  payload.batchItems = state.results.map((item) => item?.item || '');

  if (payload.options?.layoutFixed && index > 0) {
    const layoutReferenceImage = resolveRetryLayoutReferenceImage(state.results[0]);
    if (!layoutReferenceImage) {
      showToast('第 1 张母版仅保存在本地，无法用于固定排版重试；请先重新生成第 1 张');
      return;
    }
    payload.layoutReferenceImage = layoutReferenceImage;
  }

  const chargeDecision = await confirmPointCharge(1, { allowChangeCount: false });
  if (chargeDecision.action !== 'confirm') return;
  if (state.results[index] !== current || state.retryingIndexes.has(index)) {
    showToast(`第 ${index + 1} 张状态已变化，请重新操作`);
    return;
  }

  const retryBase = state.results[index] || current;
  let retryResultReceived = false;
  const controller = new AbortController();
  const retryAttemptId = createClientId();
  const retryContext = { controller, retryAttemptId };
  const isCurrentRetry = () => state.retryControllers.get(index) === retryContext;

  state.results[index] = {
    ...retryBase,
    status: 'pending',
    error: '',
    retryAttemptId,
  };
  state.retryingIndexes.add(index);
  state.retryControllers.set(index, retryContext);
  renderResultAt(index);
  batchSummary.textContent = `正在重新生成第 ${index + 1} 张`;

  try {
    const data = await fetchGenerationStream('/api/generate/stream', payload, {
      controller,
      trackGlobalController: false,
      onStart(event) {
        if (event.points) {
          applyPointBalance(event.points.balance);
        }
      },
      onResult(result) {
        if (!isCurrentRetry()) return;
        retryResultReceived = true;
        mergeFinalResult(result);
        renderResultAt(index);
        updateBatchSummary();
      },
    });

    if (isCurrentRetry() && (!retryResultReceived || !isResultSaved(state.results[index]))) {
      state.results[index] = {
        ...retryBase,
        id: retryBase.id || `retry-error-${index}`,
        status: 'error',
        error: '重新生成未返回图片结果',
      };
    }
    const latest = state.results[index];
    updateBatchSummary();
    if (data.summary?.points) {
      applyPointBalance(data.summary.points.balance);
    } else {
      await refreshCurrentUser();
    }
    showToast(latest?.status === 'ok'
      ? `第 ${index + 1} 张已重新生成`
      : `第 ${index + 1} 张仍然生成失败`);
  } catch (error) {
    if (controller.signal.aborted || !isCurrentRetry()) return;
    if (error?.status === 401) {
      state.currentUser = null;
      renderAuthState();
      openAuthModal();
    }
    state.results[index] = {
      ...retryBase,
      id: retryBase.id || `retry-error-${index}`,
      status: 'error',
      error: error instanceof Error ? error.message : '重新生成失败',
    };
    renderResultAt(index);
    updateBatchSummary();
    showToast(error instanceof Error ? error.message : '重新生成失败');
    await refreshCurrentUser();
  } finally {
    if (isCurrentRetry()) {
      state.retryingIndexes.delete(index);
      state.retryControllers.delete(index);
    }
    if (state.results[index]?.retryAttemptId === retryAttemptId) {
      state.results[index] = {
        ...state.results[index],
        retrying: false,
        retryAttemptId: '',
      };
      renderResultAt(index);
      updateBatchSummary();
    }
  }
}

function resolveRetryLayoutReferenceImage(item) {
  const source = getResultSavedImage(item);
  if (!source) return '';
  try {
    const url = new URL(source, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith(GENERATED_IMAGE_PATH_PREFIX)) {
      return '';
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return '';
  }
}

function openPreview(source, title) {
  previewImage.src = source;
  previewTitle.textContent = title;
  resetPreviewTransform();
  previewModal.classList.add('open');
  previewModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('preview-open');
  zoomInButton.focus();
}

function closePreview() {
  previewModal.classList.remove('open');
  previewModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('preview-open');
  previewImage.removeAttribute('src');
  stopPreviewDrag();
}

function resetPreviewTransform() {
  state.preview.scale = 1;
  state.preview.offsetX = 0;
  state.preview.offsetY = 0;
  renderPreviewTransform();
}

function changePreviewZoom(delta) {
  state.preview.scale = clampNumber(
    state.preview.scale + delta,
    PREVIEW_MIN_SCALE,
    PREVIEW_MAX_SCALE,
  );
  renderPreviewTransform();
}

function renderPreviewTransform() {
  const zoomPercent = `${Math.round(state.preview.scale * 100)}%`;
  previewImage.style.transform = `translate(${state.preview.offsetX}px, ${state.preview.offsetY}px) scale(${state.preview.scale})`;
  zoomOutput.value = zoomPercent;
  zoomOutput.textContent = zoomPercent;
}

function stopPreviewDrag(event) {
  if (event && previewStage.hasPointerCapture(event.pointerId)) {
    previewStage.releasePointerCapture(event.pointerId);
  }
  state.preview.isDragging = false;
  previewStage.classList.remove('dragging');
}

function renderReferenceFallbackNotice() {
  const notice = document.createElement('article');
  notice.className = 'fallback-card';
  notice.innerHTML = `
    <strong>参考图生成失败</strong>
    <p>参考风格图请求已自动重试仍未成功。可以直接点击失败图片重试，或先移除参考风格图后再试；知识库图片仍会作为内容证据保留。</p>
    <button class="result-action" type="button">移除参考风格重试</button>
  `;
  notice.querySelector('button').addEventListener('click', async () => {
    state.styleReferences = [];
    renderKnowledgeFiles();
    renderReferences();
    await generateTeachingAids();
  });
  resultGrid.prepend(notice);
}

async function addGeneratedImageAsReference(source, name) {
  if (state.styleReferences.length >= 4) {
    showToast('参考风格图最多保留 4 张');
    return;
  }

  try {
    const dataUrl = source.startsWith('data:image/')
      ? source
      : await fetchImageAsDataUrl(source);
    const dimensions = await getImageDimensions(dataUrl);
    state.styleReferences.push({
      name,
      mimeType: dataUrl.slice(5, dataUrl.indexOf(';')),
      dataUrl,
      ...dimensions,
    });
    renderReferences();
    showToast('已加入参考风格');
  } catch {
    showToast('当前图片无法加入参考风格');
  }
}

async function compressImage(file, options = {}) {
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(bitmapUrl);
    const maxEdge = options.maxEdge || 1024;
    const quality = options.quality || 0.78;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return {
      name: file.name,
      mimeType: 'image/jpeg',
      dataUrl,
      width,
      height,
      originalWidth: image.naturalWidth,
      originalHeight: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

async function getImageDimensions(source) {
  const image = await loadImage(source);
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

async function fetchImageAsDataUrl(source) {
  const response = await fetch(source);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function createClientId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function serializeKnowledgeFileForApi(file) {
  return {
    name: file.name,
    mimeType: file.mimeType,
    size: file.size || 0,
    dataUrl: file.dataUrl,
  };
}

function isPdfKnowledgeFile(file) {
  return file?.type === 'application/pdf' || getFileExtension(file?.name) === 'pdf';
}

let pdfJsModulePromise = null;

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('/vendor/pdfjs/pdf.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
      return pdfjs;
    });
  }
  return pdfJsModulePromise;
}

async function extractPdfKnowledgeEvidence(file, sourceFileId) {
  const pdfjs = await loadPdfJsModule();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const documentProxy = await loadingTask.promise;
  try {
    const pageNumbers = selectPdfEvidencePages(documentProxy.numPages, PDF_EVIDENCE_MAX_PAGE_COUNT);
    const files = [];
    const textParts = await extractPdfDocumentReadableText(documentProxy, PDF_TEXT_MAX_CHARS);
    const failedPages = [];
    let pageImageCount = 0;
    for (const pageNumber of pageNumbers) {
      const page = await documentProxy.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2.4, Math.max(0.4, PDF_EVIDENCE_TARGET_WIDTH / viewport.width));
        const scaledViewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(scaledViewport.width);
        canvas.height = Math.ceil(scaledViewport.height);
        const context = canvas.getContext('2d', { alpha: false });
        await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
        files.push({
          id: createClientId(),
          hidden: true,
          sourceFileId,
          evidenceKind: 'pdf-page-image',
          name: `${file.name}-第${pageNumber}页内容截图.jpg`,
          mimeType: 'image/jpeg',
          size: 0,
          dataUrl: canvas.toDataURL('image/jpeg', PDF_EVIDENCE_IMAGE_QUALITY),
          pageNumber,
        });
        pageImageCount += 1;
        canvas.width = 0;
        canvas.height = 0;
      } catch {
        failedPages.push(pageNumber);
      } finally {
        page.cleanup?.();
      }
    }

    const readableText = normalizePdfReadableText(textParts.join('\n\n')).slice(0, PDF_TEXT_MAX_CHARS);
    if (readableText) {
      files.unshift({
        id: createClientId(),
        hidden: true,
        sourceFileId,
        evidenceKind: 'pdf-text',
        name: `${file.name}-可读文本摘录.txt`,
        mimeType: 'text/plain',
        size: new TextEncoder().encode(readableText).length,
        dataUrl: createTextDataUrl(readableText),
      });
    }

    const evidenceNote = createPdfEvidenceNote(file.name, documentProxy.numPages, pageNumbers, pageImageCount, failedPages, readableText);
    if (evidenceNote) {
      files.push({
        id: createClientId(),
        hidden: true,
        sourceFileId,
        evidenceKind: 'pdf-note',
        name: `${file.name}-读取说明.txt`,
        mimeType: 'text/plain',
        size: new TextEncoder().encode(evidenceNote).length,
        dataUrl: createTextDataUrl(evidenceNote),
      });
    }

    return { files, pageImageCount };
  } finally {
    await documentProxy.destroy();
  }
}

async function extractPdfDocumentReadableText(documentProxy, maxChars) {
  const textParts = [];
  let totalChars = 0;
  for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
    if (totalChars >= maxChars) break;
    let page = null;
    try {
      page = await documentProxy.getPage(pageNumber);
      const pageText = await extractPdfPageReadableText(page, pageNumber);
      if (!pageText) continue;
      textParts.push(pageText);
      totalChars += pageText.length;
    } catch {
      // 单页文字层读取失败时继续读取后续页面，避免整份 PDF 证据失效。
    } finally {
      page?.cleanup?.();
    }
  }
  return textParts;
}

async function extractPdfPageReadableText(page, pageNumber) {
  const textContent = await page.getTextContent().catch(() => null);
  const rows = Array.isArray(textContent?.items)
    ? textContent.items.map((item) => {
        const text = String(item?.str || '').replace(/\s+/g, ' ').trim();
        const transform = Array.isArray(item?.transform) ? item.transform : [];
        return {
          text,
          x: Number(transform[4]) || 0,
          y: Number(transform[5]) || 0,
        };
      }).filter((item) => item.text)
    : [];
  if (rows.length === 0) return '';

  rows.sort((left, right) => {
    if (Math.abs(left.y - right.y) > 4) return right.y - left.y;
    return left.x - right.x;
  });

  const lines = [];
  let currentLine = [];
  let currentY = null;
  for (const row of rows) {
    if (currentY === null || Math.abs(row.y - currentY) <= 4) {
      currentLine.push(row.text);
      currentY = currentY === null ? row.y : currentY;
      continue;
    }
    lines.push(currentLine.join(' '));
    currentLine = [row.text];
    currentY = row.y;
  }
  if (currentLine.length > 0) lines.push(currentLine.join(' '));

  const text = normalizePdfReadableText(lines.join('\n'));
  return text ? `第 ${pageNumber} 页：\n${text}` : '';
}

function normalizePdfReadableText(value) {
  return String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createTextDataUrl(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return `data:text/plain;base64,${btoa(binary)}`;
}

function createPdfEvidenceNote(fileName, totalPages, sampledPages, renderedCount, failedPages, readableText) {
  const lines = [];
  const sampledLabel = Array.isArray(sampledPages) && sampledPages.length > 0 ? sampledPages.join('、') : '无';
  if (Number(totalPages) > sampledPages.length) {
    lines.push(`PDF《${fileName}》共有 ${totalPages} 页；本次已附视觉截图页码：${sampledLabel}。源文件页数和截图数量不能作为生成图片数量依据。`);
    lines.push('如果可读文本摘录已经覆盖全部页面，请优先依据文本摘录做全量内容盘点；如果可读文本摘录为空或明显缺漏，只能依据已附页面截图识别内容，不得编造未读取页面的细节。');
  }
  if (failedPages.length > 0) {
    lines.push(`以下页码截图渲染失败，规则确认时不得猜测这些页面的具体内容：${failedPages.join('、')}。`);
  }
  if (!readableText && renderedCount > 0) {
    lines.push('未提取到可读文字层，说明这可能是扫描型或图片型 PDF；规则确认必须从已附页面截图中读取真实题目、知识点和主题层级。');
  }
  return lines.join('\n');
}

function selectPdfEvidencePages(pageCount, maxCount) {
  const total = Math.max(0, Number(pageCount) || 0);
  const limit = Math.min(Math.max(1, maxCount), PDF_EVIDENCE_MAX_PAGE_COUNT);
  if (total <= 0) return [];
  if (total <= limit) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set();
  const edgeCount = Math.min(3, Math.floor(limit / 3));
  for (let page = 1; page <= edgeCount; page += 1) {
    pages.add(page);
    pages.add(total - page + 1);
  }

  const remaining = limit - pages.size;
  if (remaining > 0) {
    for (let index = 0; index < remaining; index += 1) {
      const denominator = Math.max(1, remaining - 1);
      pages.add(Math.round(1 + (index * (total - 1)) / denominator));
    }
  }

  for (let page = 1; pages.size < limit && page <= total; page += 1) {
    pages.add(page);
  }

  return [...pages]
    .filter((page) => page >= 1 && page <= total)
    .sort((left, right) => left - right)
    .slice(0, limit);
}

function isSupportedKnowledgeFile(file) {
  if (!file) return false;
  if (isKnowledgeImageFile(file)) return true;
  const extension = getFileExtension(file.name);
  return KNOWLEDGE_FILE_ACCEPT_EXTENSIONS.has(extension);
}

function isKnowledgeImageFile(file) {
  return (
    KNOWLEDGE_IMAGE_MIME_TYPES.has(file.type) ||
    KNOWLEDGE_IMAGE_EXTENSIONS.has(getFileExtension(file.name))
  );
}

function inferMimeType(name) {
  const extension = getFileExtension(name);
  const mimeTypes = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
  };
  return mimeTypes[extension] || 'application/octet-stream';
}

function getFileBadge(name, mimeType) {
  const extension = getFileExtension(name);
  if (extension) return extension.toUpperCase();
  if (mimeType.startsWith('image/')) return 'IMG';
  return 'FILE';
}

function getFileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/u);
  return match ? match[1] : '';
}

function hasReferenceAssets() {
  return state.styleReferences.length > 0;
}

function abortRetryControllers() {
  state.retryControllers.forEach((retryContext) => {
    retryContext.controller.abort();
  });
  state.retryControllers.clear();
  state.retryingIndexes.clear();
}

function downloadImage(source, filename) {
  const anchor = document.createElement('a');
  anchor.href = source;
  anchor.download = filename;
  anchor.target = '_blank';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function updateBatchSummary(summary = null) {
  if (summary) {
    const success = Math.max(0, Number(summary.success) || 0);
    const failed = Math.max(0, Number(summary.failed) || 0);
    batchSummary.textContent = `成功 ${success} 张，失败 ${failed} 张`;
    return;
  }

  const saved = state.results.filter(isResultSaved).length;
  const failed = state.results.filter((item) => item.status === 'error').length;
  const pending = state.results.filter((item) => item.status === 'pending').length;

  if (pending > 0) {
    batchSummary.textContent = `已显示 ${saved} 张，失败 ${failed} 张，生成中 ${pending} 张`;
    return;
  }

  batchSummary.textContent = `成功 ${saved} 张，失败 ${failed} 张`;
}

async function fetchGenerationStream(url, payload, handlers = {}) {
  const controller = handlers.controller || new AbortController();
  const trackGlobalController = handlers.trackGlobalController !== false;
  const clientBatchId = createClientId();
  const requestPayload = { ...payload, clientBatchId };
  // 请求发出前登记批次，确保刷新早于服务端 start 事件时也能取消未开始的生成。
  state.activeGenerationBatchIds.add(clientBatchId);
  if (trackGlobalController) {
    state.activeGenerateController = controller;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': clientBatchId,
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    if (!response.ok) {
      state.activeGenerationBatchIds.delete(clientBatchId);
      const errorPayload = await response.json().catch(() => ({}));
      const error = new Error(errorPayload.message || '生成请求失败');
      error.status = response.status;
      throw error;
    }

    if (!response.body) {
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || '生成请求失败');
      data.results.forEach((result) => handlers.onResult?.(result));
      return data;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const lineChunks = [];
    let summary = null;

    const dispatchStreamLine = (line) => {
      const event = parseStreamEvent(line);
      if (!event) return;
      trackStreamGenerationBatch(event);
      applyStreamPointBalance(event);
      if (event.type === 'start') {
        handlers.onStart?.(event);
      } else if (event.type === 'result') {
        handlers.onResult?.(event.result);
      } else if (event.type === 'done') {
        summary = event.summary;
      } else if (event.type === 'error') {
        throw new Error(event.message || '生成失败');
      }
    };

    const consumeDecodedChunk = (chunk) => {
      let offset = 0;
      while (offset < chunk.length) {
        const newlineIndex = chunk.indexOf('\n', offset);
        if (newlineIndex < 0) {
          lineChunks.push(chunk.slice(offset));
          return;
        }

        lineChunks.push(chunk.slice(offset, newlineIndex));
        dispatchStreamLine(lineChunks.join(''));
        lineChunks.length = 0;
        offset = newlineIndex + 1;
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        consumeDecodedChunk(decoder.decode(value, { stream: true }));
      }
      consumeDecodedChunk(decoder.decode());
      if (lineChunks.length > 0) dispatchStreamLine(lineChunks.join(''));
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }

    if (!summary) {
      const success = state.results.filter(isResultSaved).length;
      const failed = state.results.filter((item) => item.status === 'error').length;
      summary = { success, failed };
    }

    return {
      ok: true,
      summary,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('已停止当前生成请求');
    }
    throw error;
  } finally {
    if (trackGlobalController && state.activeGenerateController === controller) {
      state.activeGenerateController = null;
    }
  }
}

function applyStreamPointBalance(event) {
  const points = event?.points || event?.summary?.points;
  if (!points || !Number.isFinite(Number(points.balance))) return;
  applyPointBalance(points.balance);
}

function trackStreamGenerationBatch(event) {
  const batchId = event?.points?.batchId || event?.summary?.points?.batchId;
  if (!batchId) return;
  if (event.type === 'start') {
    state.activeGenerationBatchIds.add(batchId);
    return;
  }
  if (event.type === 'done' || event.type === 'error') {
    state.activeGenerationBatchIds.delete(batchId);
  }
}

function cancelActiveGenerationBatches() {
  if (state.activeGenerationBatchIds.size === 0) return;
  const batchIds = Array.from(state.activeGenerationBatchIds);
  state.activeGenerationBatchIds.clear();
  batchIds.forEach((batchId) => {
    const body = JSON.stringify({ batchId });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/generate/cancel', blob);
      return;
    }
    fetch('/api/generate/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  });
}

async function fetchJson(url, payload, options = {}) {
  if (state.activeRuleController) {
    state.activeRuleController.abort();
  }

  const controller = new AbortController();
  state.activeRuleController = controller;
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 1);

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.ok) {
          const error = new Error(data.message || '请求失败');
          error.status = response.status;
          throw error;
        }

        return data;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('已停止当前规则生成请求');
        }
        if (!isRetryableRuleFetchError(error) || attempt === maxAttempts) {
          throw error;
        }
        await wait(900 * attempt);
      }
    }
  } catch (error) {
    throw error;
  } finally {
    if (state.activeRuleController === controller) {
      state.activeRuleController = null;
    }
  }
}

function isRetryableRuleFetchError(error) {
  return error instanceof TypeError || /fetch failed|failed to fetch|network/i.test(String(error?.message || ''));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function parseStreamEvent(line) {
  const text = line.trim();
  if (!text) return null;
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    throw new Error(`生成数据流协议错误：服务端返回了无法解析的 ${text.length} 字符事件`);
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('生成数据流协议错误：服务端事件必须是 JSON 对象');
  }
  return event;
}

function clonePayload(payload) {
  return {
    ...payload,
    options: payload.options ? { ...payload.options } : undefined,
    knowledgeFiles: Array.isArray(payload.knowledgeFiles)
      ? payload.knowledgeFiles.map((file) => ({ ...file }))
      : undefined,
    styleReferenceImages: Array.isArray(payload.styleReferenceImages)
      ? payload.styleReferenceImages.map((image) => ({ ...image }))
      : [],
    batchItems: Array.isArray(payload.batchItems) ? [...payload.batchItems] : undefined,
  };
}

function setGenerating(value) {
  state.isGenerating = value;
  batchSummary.classList.toggle('is-generation-progress', value);
  generateButton.disabled = value || state.isConfirmingRule;
  if (ruleButton) {
    ruleButton.disabled = value || state.isConfirmingRule;
  }
  generateButton.textContent = value ? '生成中' : '生成教辅图片';
}

function setRuleConfirming(value) {
  state.isConfirmingRule = value;
  setPlanningProgressVisible(value);
  if (ruleButton) {
    ruleButton.disabled = value || state.isGenerating;
    ruleButton.textContent = value ? '规划中' : '生成规则确认';
    ruleButton.hidden = true;
    ruleButton.setAttribute('aria-hidden', 'true');
  }
  generateButton.disabled = value || state.isGenerating;
  generateButton.textContent = value ? '规划中' : '生成教辅图片';
}

function setPlanningProgressVisible(value) {
  if (!planningProgressModal) return;
  planningProgressModal.classList.toggle('open', value);
  planningProgressModal.setAttribute('aria-hidden', value ? 'false' : 'true');
}

function syncCustomRatioField() {
  const isCustom = aspectRatioInput.value === 'custom';
  customRatioField.hidden = !isCustom;
  customAspectRatioInput.disabled = !isCustom;
  if (!isCustom) {
    customAspectRatioInput.value = '';
  }
}

function getReferenceAspectRatio() {
  const reference = state.styleReferences.find((image) => image.width > 0 && image.height > 0);
  if (!reference) return '';
  return simplifyAspectRatio(reference.width, reference.height);
}

function simplifyAspectRatio(width, height) {
  const safeWidth = Math.max(1, Math.round(Number(width) || 0));
  const safeHeight = Math.max(1, Math.round(Number(height) || 0));
  const divisor = greatestCommonDivisor(safeWidth, safeHeight);
  return `${safeWidth / divisor}:${safeHeight / divisor}`;
}

function greatestCommonDivisor(a, b) {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right > 0) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left || 1;
}

function isValidAspectRatio(value) {
  const normalized = value.trim();
  if (!normalized) return false;
  if (/^\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?$/u.test(normalized)) {
    const [width, height] = normalized.split(':').map((item) => Number(item.trim()));
    return width > 0 && height > 0;
  }
  return /^\d+(?:\.\d+)?$/u.test(normalized) && Number(normalized) > 0;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

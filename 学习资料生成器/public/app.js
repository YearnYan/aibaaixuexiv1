const MAX_FILES = 8;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_MANUAL_LENGTH = 12_000;
const MIN_MANUAL_LENGTH = 2;
const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "pdf", "doc", "docx"];
const EXPLICIT_SUBJECT_RULES = [
  ["语文", /语文/u], ["数学", /数学/u], ["英语", /英语|英文/u],
  ["物理", /物理/u], ["化学", /化学/u], ["生物", /生物/u],
  ["历史", /历史/u], ["地理", /地理/u], ["道德与法治", /道德与法治|道法|政治/u]
];
const SUBJECT_FEATURE_RULES = [
  ["数学", /方程|函数|几何|概率|分数|代数|数列|导数|向量|三角形|圆/u],
  ["英语", /\b(?:grammar|vocabulary|tense|pronoun|preposition|english)\b|单词|语法|时态|介词|英语阅读/iu],
  ["物理", /力学|电路|电流|电压|光学|声学|牛顿|机械能|压强|浮力/u],
  ["化学", /元素|化合物|化学反应|化学方程式|酸碱盐|氧化还原/u],
  ["生物", /细胞|分子|生态|遗传|基因|光合作用|呼吸作用/u],
  ["历史", /朝代|年代|历史事件|改革|战争|文明演变/u],
  ["地理", /气候|人口|地形|经纬度|板块|洋流|区域地理/u],
  ["道德与法治", /法律|法治|道德|权利|义务|公民|宪法/u],
  ["语文", /作文|阅读理解|文言文|古诗|诗词|修辞|病句|议论文|记叙文|说明文|小说|散文/u]
];

const FIGURE_RENDER_CONCURRENCY = 5;
const FIGURE_REQUEST_TIMEOUT_MS = 15_000;
const FIGURE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000];

const state = {
  files: [],
  sourceMode: "upload",
  previewUrls: new Map(),
  material: null,
  aiReady: false,
  processingTimer: null,
  processingElapsedTimer: null,
  processingStartedAt: 0,
  toastTimer: null,
  tocObserver: null,
  revealObserver: null,
  tocLockUntil: 0,
  generationToken: 0,
  figureLoadToken: 0,
  figureLoadPromise: Promise.resolve("empty")
};

const elements = {
  views: [...document.querySelectorAll(".view")],
  setupView: document.querySelector("#setup-view"),
  processingView: document.querySelector("#processing-view"),
  resultView: document.querySelector("#result-view"),
  generatorForm: document.querySelector("#generator-form"),
  dropzone: document.querySelector("#dropzone"),
  fileInput: document.querySelector("#file-input"),
  fileList: document.querySelector("#file-list"),
  fileCount: document.querySelector("#file-count"),
  uploadActionLabel: document.querySelector("#upload-action-label"),
  sourceModeButtons: [...document.querySelectorAll("[data-source-mode]")],
  uploadSourcePanel: document.querySelector("#upload-source-panel"),
  manualSourcePanel: document.querySelector("#manual-source-panel"),
  manualInput: document.querySelector("#manual-input"),
  manualCount: document.querySelector("#manual-count"),
  generateButton: document.querySelector("#generate-button"),
  gradeSelect: document.querySelector("#grade-select"),
  subjectSelect: document.querySelector("#subject-select"),
  autoSubjectOption: document.querySelector("#auto-subject-option"),
  depthToggle: document.querySelector("#depth-toggle"),
  processingSteps: [...document.querySelectorAll("#processing-steps li")],
  processingFileName: document.querySelector("#processing-file-name"),
  processingElapsed: document.querySelector("#processing-elapsed"),
  studyPaper: document.querySelector("#study-paper"),
  tocNav: document.querySelector("#toc-nav"),
  tocCount: document.querySelector("#toc-count"),
  mobileStageNav: document.querySelector("#mobile-stage-nav"),
  toolbarTitle: document.querySelector("#toolbar-title"),
  sourceCount: document.querySelector("#source-count"),
  sourceName: document.querySelector("#source-name"),
  backButton: document.querySelector("#back-button"),
  brandHome: document.querySelector("#brand-home"),
  pdfButton: document.querySelector("#pdf-button"),
  wordButton: document.querySelector("#word-button"),
  copyButton: document.querySelector("#copy-button"),
  focusButton: document.querySelector("#focus-button"),
  exportMenu: document.querySelector("#export-menu"),
  readingProgress: document.querySelector("#reading-progress"),
  readingStatus: document.querySelector("#reading-status"),
  serviceStatus: document.querySelector("#service-status"),
  statusText: document.querySelector("#status-text"),
  resultNotice: document.querySelector("#result-notice"),
  noticeText: document.querySelector("#notice-text"),
  noticeClose: document.querySelector("#notice-close"),
  progressRing: document.querySelector("#progress-ring"),
  progressValue: document.querySelector("#progress-value"),
  checklistTip: document.querySelector("#checklist-tip"),
  checklistInputs: [...document.querySelectorAll("[data-check]")],
  toast: document.querySelector("#toast")
};

const stageDefinitions = [
  {
    id: "overview",
    title: "本课导航",
    navTitle: "导航",
    kicker: "先看全局，再进入具体知识",
    summary: "明确学习目标、核心问题和知识关系，知道整份资料先看什么、后做什么。",
    render: renderOverviewWorkbookStage
  },
  {
    id: "key-points",
    title: "重点精讲",
    navTitle: "重点",
    kicker: "把最关键的判断讲透",
    summary: "每个重点都讲清是什么、为什么、什么时候用，以及哪些情况不能直接套。",
    render: renderKeyPoints
  },
  {
    id: "strategies",
    title: "解题策略",
    navTitle: "策略",
    kicker: "看到信号，就知道下一步怎么做",
    summary: "把题型或情境转成可执行步骤，并标明得分点、失分点和条件变化后的处理方法。",
    render: renderStrategyStage
  },
  {
    id: "close-reading",
    title: "资料精读",
    navTitle: "精读",
    kicker: "回到关键句，把每层意思拆开",
    summary: "用原句或准确转述定位依据，再解释关键词、关系和这段内容真正支持的结论。",
    render: renderCloseReading
  },
  {
    id: "concepts",
    title: "概念词典",
    navTitle: "词典",
    kicker: "先把术语换成听得懂的话",
    summary: "集中解释必须掌握的词语、概念和表达，并用主题内例子帮助理解。",
    render: renderConcepts
  },
  {
    id: "visuals",
    title: "图解知识点",
    navTitle: "图解",
    kicker: "用一张结构图看清完整知识系统",
    summary: "先看 SVG 全景图，再用流程、对比和关系图确认知识之间的联系。",
    render: renderKnowledgeDiagramStage
  },
  {
    id: "mistakes",
    title: "易错辨析",
    navTitle: "易错",
    kicker: "把错误起点和正确改法放在一起看",
    summary: "逐项对照常见误解、正确理解和出错原因，避免在相似题里重复失分。",
    render: renderMistakes
  },
  {
    id: "examples",
    title: "例题拆解",
    navTitle: "例题",
    kicker: "完整看见高手是怎样一步步判断的",
    summary: "从题目线索、策略选择到分步推理和答案检查，展示完整思考过程。",
    render: renderWorkedExamples
  },
  {
    id: "practice",
    title: "分层练习",
    navTitle: "练习",
    kicker: "从基础判断练到综合应用",
    summary: "每题先写作答顺序，完成后再展开答案、得分点和错后修复方法。",
    render: renderPractice
  },
  {
    id: "mastery",
    title: "掌握证明",
    navTitle: "证明",
    kicker: "用可检查的成果证明真的会了",
    summary: "依次完成复述、应用和换题检验，并按复习计划巩固还不稳定的部分。",
    render: renderMasteryWorkbookStage
  }
];

const stageGroups = [
  {
    id: "orient",
    number: "01",
    label: "第一阶段",
    title: "先看全局",
    description: "明确范围与目标",
    stageIds: ["overview"]
  },
  {
    id: "understand",
    number: "02",
    label: "第二阶段",
    title: "理解知识",
    description: "讲透概念与方法",
    stageIds: ["key-points", "strategies", "close-reading", "concepts", "visuals"]
  },
  {
    id: "apply",
    number: "03",
    label: "第三阶段",
    title: "练会应用",
    description: "辨析、示范与练习",
    stageIds: ["mistakes", "examples", "practice"]
  },
  {
    id: "verify",
    number: "04",
    label: "第四阶段",
    title: "检查掌握",
    description: "用成果核对掌握",
    stageIds: ["mastery"]
  }
];

const routeRelationDefinitions = [
  {
    key: "knowledgeNodeIds",
    label: "知识节点",
    prefix: "knowledge-node",
    getItems: (material) => material.knowledgeMap?.nodes || [],
    getLabel: (item) => item.label || item.title || "知识节点"
  },
  {
    key: "keyPointIds",
    label: "重点精讲",
    prefix: "key-point",
    getItems: (material) => material.keyPoints || [],
    getLabel: (item) => item.title || "重点"
  },
  {
    key: "exampleIds",
    label: "看示范",
    prefix: "worked-example",
    getItems: (material) => material.workedExamples || [],
    getLabel: (item) => item.title || item.questionType || "示范题"
  },
  {
    key: "practiceIds",
    label: "独立练",
    prefix: "practice",
    getItems: (material) => material.practice || [],
    getLabel: (item) => item.question || item.type || "练习"
  },
  {
    key: "masteryCheckIds",
    label: "掌握证明",
    prefix: "mastery-check",
    getItems: (material) => material.masteryChecks || [],
    getLabel: (item) => item.level || item.task || "掌握任务"
  }
];

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = sanitizeDisplayText(text);
  return element;
}

function sanitizeDisplayText(value) {
  return String(value ?? "").replaceAll("自学", "学习");
}

function createDisplayTextNode(value) {
  return document.createTextNode(sanitizeDisplayText(value));
}

function clearElement(element) {
  while (element.firstChild) element.firstChild.remove();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getExtension(filename) {
  return filename.split(".").pop()?.toLowerCase() || "文件";
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = sanitizeDisplayText(message);
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 3200);
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function isRetryableNetworkError(error) {
  return error instanceof TypeError
    || /failed to fetch|networkerror|load failed|fetch failed|socket|connection/iu.test(String(error?.message || ""));
}

async function fetchWithRecovery(url, createOptions, { attempts = 3, onRetry } = {}) {
  const maximumAttempts = Math.max(1, Math.min(4, Number(attempts) || 1));
  let lastError;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const options = typeof createOptions === "function" ? createOptions() : createOptions;
      const response = await fetch(url, options);
      const canRetry = RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < maximumAttempts - 1;
      if (!canRetry) return response;
      lastError = new Error(`服务暂时返回 ${response.status}`);
      try {
        await response.body?.cancel();
      } catch {
        // 响应体已经结束时无需处理。
      }
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error) || attempt === maximumAttempts - 1) throw error;
    }
    onRetry?.(attempt + 1, lastError);
    await wait(650 * (2 ** attempt));
  }
  throw lastError || new Error("请求未完成");
}

function createTaskId(prefix) {
  const id = window.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function switchView(view) {
  elements.views.forEach((item) => item.classList.toggle("is-active", item === view));
  document.body.classList.toggle("result-active", view === elements.resultView);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function getManualText() {
  return elements.manualInput.value.trim();
}

function inferSubjectFromText(text) {
  const explicitMatches = EXPLICIT_SUBJECT_RULES
    .map(([subject, pattern], priority) => {
      const match = pattern.exec(text);
      return match ? { subject, index: match.index, priority } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index || left.priority - right.priority);
  if (explicitMatches.length) return explicitMatches[0].subject;
  return SUBJECT_FEATURE_RULES.find(([, pattern]) => pattern.test(text))?.[0] || "";
}

function updateAutoSubjectLabel() {
  const detected = state.sourceMode === "manual" ? inferSubjectFromText(getManualText()) : "";
  elements.autoSubjectOption.textContent = detected ? `自动识别（${detected}）` : "自动识别";
}

function hasValidSource() {
  if (state.sourceMode === "manual") return getManualText().length >= MIN_MANUAL_LENGTH;
  return state.files.length > 0;
}

function updateGenerateAvailability() {
  elements.generateButton.disabled = !state.aiReady || !hasValidSource();
}

function setSourceMode(mode) {
  state.sourceMode = mode === "manual" ? "manual" : "upload";
  const manualMode = state.sourceMode === "manual";
  elements.uploadSourcePanel.hidden = manualMode;
  elements.manualSourcePanel.hidden = !manualMode;
  elements.sourceModeButtons.forEach((button) => {
    const selected = button.dataset.sourceMode === state.sourceMode;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  updateAutoSubjectLabel();
  updateGenerateAvailability();
}

function validateFile(file) {
  const extension = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return `“${file.name}”格式不支持，请上传图片、PDF 或 Word。`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `“${file.name}”超过 20 MB，请压缩后再上传。`;
  }
  return "";
}

function addFiles(fileList) {
  const incoming = [...fileList];
  const errors = [];

  for (const file of incoming) {
    const error = validateFile(file);
    if (error) {
      errors.push(error);
      continue;
    }

    const duplicated = state.files.some((existing) => (
      existing.name === file.name
      && existing.size === file.size
      && existing.lastModified === file.lastModified
    ));
    if (duplicated) continue;

    if (state.files.length >= MAX_FILES) {
      errors.push(`一次最多上传 ${MAX_FILES} 个文件。`);
      break;
    }

    state.files.push(file);
  }

  elements.fileInput.value = "";
  renderFileList();
  if (errors.length) showToast(errors[0]);
}

function removeFile(index) {
  const [removed] = state.files.splice(index, 1);
  const previewUrl = state.previewUrls.get(removed);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  state.previewUrls.delete(removed);
  renderFileList();
}

function getPreviewUrl(file) {
  if (!file.type.startsWith("image/")) return "";
  if (!state.previewUrls.has(file)) {
    state.previewUrls.set(file, URL.createObjectURL(file));
  }
  return state.previewUrls.get(file);
}

function renderFileList() {
  clearElement(elements.fileList);
  elements.dropzone.classList.toggle("has-files", state.files.length > 0);
  updateGenerateAvailability();
  elements.fileCount.textContent = state.files.length ? `已选择 ${state.files.length} / ${MAX_FILES}` : "尚未选择";
  elements.uploadActionLabel.textContent = state.files.length ? "继续添加教材" : "选择或拖入教材";

  state.files.forEach((file, index) => {
    const item = createElement("div", "file-item");
    const thumb = createElement("div", "file-thumb");
    const previewUrl = getPreviewUrl(file);
    if (previewUrl) {
      const image = createElement("img");
      image.src = previewUrl;
      image.alt = "";
      thumb.append(image);
    } else {
      thumb.textContent = getExtension(file.name).toUpperCase();
    }

    const meta = createElement("div", "file-meta");
    meta.append(
      createElement("strong", "", file.name),
      createElement("small", "", `${formatFileSize(file.size)} · 等待分析`)
    );

    const removeButton = createElement("button", "remove-file", "×");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `移除 ${file.name}`);
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeFile(index);
    });

    item.append(thumb, meta, removeButton);
    elements.fileList.append(item);
  });
}

function resetProcessingSteps() {
  elements.processingSteps.forEach((step, index) => {
    step.classList.toggle("is-active", index === 0);
    step.classList.remove("is-complete");
  });
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function stopProcessingTimers() {
  window.clearInterval(state.processingTimer);
  window.clearInterval(state.processingElapsedTimer);
  state.processingTimer = null;
  state.processingElapsedTimer = null;
}

function startProcessing(filename) {
  stopProcessingTimers();
  resetProcessingSteps();
  elements.processingFileName.textContent = filename;
  elements.processingElapsed.textContent = "00:00";
  state.processingStartedAt = Date.now();
  switchView(elements.processingView);
  let activeIndex = 0;
  state.processingTimer = window.setInterval(() => {
    if (activeIndex >= elements.processingSteps.length - 1) return;
    elements.processingSteps[activeIndex].classList.remove("is-active");
    elements.processingSteps[activeIndex].classList.add("is-complete");
    activeIndex += 1;
    elements.processingSteps[activeIndex].classList.add("is-active");
  }, 6_500);
  state.processingElapsedTimer = window.setInterval(() => {
    elements.processingElapsed.textContent = formatElapsed(Date.now() - state.processingStartedAt);
  }, 1_000);
}

async function finishProcessing() {
  stopProcessingTimers();
  elements.processingSteps.forEach((step) => {
    step.classList.remove("is-active");
    step.classList.add("is-complete");
  });
  await new Promise((resolve) => window.setTimeout(resolve, 330));
}

function getFormOptions() {
  const selectedGoal = document.querySelector('input[name="goal"]:checked');
  return {
    grade: elements.gradeSelect.value,
    subject: elements.subjectSelect.value,
    goal: selectedGoal?.value || "understand",
    depth: elements.depthToggle.checked ? "detailed" : "standard"
  };
}

async function generateMaterial(event) {
  event.preventDefault();
  if (!state.aiReady) {
    showToast("AI 服务尚未就绪，请稍后重试或联系管理员。");
    return;
  }
  if (!hasValidSource()) {
    showToast(state.sourceMode === "manual" ? "请至少输入 2 个字的知识点。" : "请先上传一份教材资料。");
    return;
  }

  const options = getFormOptions();
  const formData = new FormData();
  if (state.sourceMode === "manual") {
    formData.append("manualText", getManualText());
  } else {
    state.files.forEach((file) => formData.append("files", file));
  }
  Object.entries(options).forEach(([key, value]) => formData.append(key, value));

  const sourceLabel = state.sourceMode === "manual"
    ? "正在分析手动输入的知识点"
    : state.files.length === 1 ? state.files[0].name : `正在分析 ${state.files.length} 份教材`;
  const generationToken = ++state.generationToken;
  const generationId = createTaskId("material");
  startProcessing(sourceLabel);

  try {
    const startedAt = Date.now();
    const response = await fetchWithRecovery("/api/generate", () => ({
      method: "POST",
      headers: { "X-Generation-Id": generationId },
      body: formData
    }), {
      attempts: 3,
      onRetry: () => {
        elements.processingFileName.textContent = "连接有波动，正在自动恢复本次生成";
      }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "生成失败，请稍后重试。");
    if (generationToken !== state.generationToken) return;

    const remaining = Math.max(0, 1_700 - (Date.now() - startedAt));
    if (remaining) await wait(remaining);
    await finishProcessing();
    if (generationToken !== state.generationToken) return;
    renderResult(result);
  } catch (error) {
    if (generationToken !== state.generationToken) return;
    stopProcessingTimers();
    switchView(elements.setupView);
    const message = isRetryableNetworkError(error)
      ? "连接暂时中断，本次生成未丢失。请确认服务运行后再次点击生成。"
      : (error.message || "生成失败，请稍后重试。");
    showToast(message);
  }
}

function getStageGroup(stageId) {
  return stageGroups.find((group) => group.stageIds.includes(stageId));
}

function makeSectionHeading(index, definition, group) {
  const heading = createElement("header", "section-heading");
  const indexBlock = createElement("div", "section-index");
  indexBlock.setAttribute("aria-hidden", "true");
  indexBlock.append(
    createElement("span", "section-number", String(index).padStart(2, "0")),
    createElement("span", "section-total", `/ ${String(stageDefinitions.length).padStart(2, "0")}`)
  );
  const copy = createElement("div", "section-heading-copy");
  const phase = createElement("p", "section-phase");
  phase.append(
    createElement("span", "", group?.label || "学习阶段"),
    createElement("strong", "", group?.title || "理解与应用")
  );
  copy.append(
    phase,
    createElement("h2", "section-title", definition.title),
    createElement("p", "section-kicker", definition.kicker)
  );
  if (definition.summary) copy.append(createElement("p", "stage-summary", definition.summary));
  heading.append(indexBlock, copy);
  return heading;
}

function getDisplayMaterialTitle(material) {
  const rawTitle = String(material?.meta?.title || "学习讲义")
    .replaceAll("自学", "学习")
    .replace(/(?:[\s·｜|—–:：-]*(?:课堂|学习)?(?:指南|讲义|工作页|任务单))$/u, "")
    .trim();
  return rawTitle || "学习讲义";
}

function getCoverTopicTitle(material) {
  let title = getDisplayMaterialTitle(material);
  [material?.meta?.grade, material?.meta?.subject]
    .filter((item) => String(item || "").trim().length > 1)
    .forEach((item) => {
      title = title.replaceAll(String(item).trim(), "");
    });

  return title.replace(/^[\s·｜|—–:：-]+|[\s·｜|—–:：-]+$/gu, "").trim() || getDisplayMaterialTitle(material);
}

function renderCoverRoadmap() {
  const roadmap = createElement("div", "cover-roadmap");
  roadmap.setAttribute("aria-label", "本课学习路线：先看全局、理解知识、练会应用、检查掌握");
  roadmap.append(createElement("p", "cover-roadmap-label", "建议阅读顺序"));
  const list = createElement("ol", "cover-roadmap-list");
  stageGroups.forEach((group) => {
    const item = createElement("li");
    item.append(
      createElement("span", "", group.number),
      createElement("strong", "", group.title),
      createElement("small", "", group.description)
    );
    list.append(item);
  });
  roadmap.append(list);
  return roadmap;
}

function renderCover(material) {
  const cover = createElement("header", "paper-cover");
  cover.id = "cover";
  const label = createElement("p", "paper-label", "学习资料生成器 · 完整学习报告");
  const title = createElement("h1", "", getCoverTopicTitle(material));
  const summary = createElement("p", "cover-summary", material.meta.summary);
  const meta = createElement("dl", "cover-meta");
  [
    ["学科", material.meta.subject],
    ["阶段", material.meta.grade],
    ["建议用时", `${material.meta.estimatedMinutes} 分钟`],
    ["难度", material.meta.difficulty]
  ].forEach(([label, value]) => {
    const item = createElement("div", "cover-meta-item");
    item.append(createElement("dt", "", label), createElement("dd", "", value));
    meta.append(item);
  });

  cover.append(label, title, summary, renderCoverRoadmap(), meta);
  return cover;
}

function renderLearningGoals(material) {
  const fragment = document.createDocumentFragment();
  const list = createElement("div", "goals-list");
  material.learningGoals.forEach((goal) => {
    const row = createElement("div", "goal-row");
    row.append(
      createElement("strong", "goal-level", goal.level),
      createElement("p", "", goal.text)
    );
    list.append(row);
  });
  fragment.append(list, renderLearningRoute(material));
  return fragment;
}

function entityAnchorId(prefix, item, index = 0) {
  const rawId = item?.id ?? `${prefix}-${index + 1}`;
  return `study-${prefix}-${encodeURIComponent(String(rawId)).replaceAll("%", "_")}`;
}

function sourceRefsOverlap(first = [], second = []) {
  if (!first.length || !second.length) return false;
  const references = new Set(first.map((item) => String(item)));
  return second.some((item) => references.has(String(item)));
}

function resolveRouteRelationItems(material, route, relation) {
  const items = relation.getItems(material);
  const requestedIds = Array.isArray(route?.[relation.key]) ? route[relation.key] : [];
  const wanted = new Set(requestedIds.map((item) => String(item)));
  const explicitItems = wanted.size
    ? items.filter((item) => wanted.has(String(item?.id)))
    : [];

  if (explicitItems.length) return explicitItems;

  const routeSourceRefs = Array.isArray(route?.sourceRefs) ? route.sourceRefs : [];
  if (!routeSourceRefs.length) return [];
  return items.filter((item) => sourceRefsOverlap(routeSourceRefs, item?.sourceRefs || []));
}

function scrollToStudyEntity(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.closest("details")?.setAttribute("open", "");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderRouteRelationGraph(material, route, className = "") {
  const graph = createElement("div", `learning-route-graph ${className}`.trim());
  let hasRelations = false;

  routeRelationDefinitions.forEach((relation) => {
    const items = resolveRouteRelationItems(material, route, relation);
    if (!items.length) return;
    hasRelations = true;

    const group = createElement("div", "route-relation");
    group.append(createElement("strong", "", relation.label));
    const collection = relation.getItems(material);
    items.forEach((item) => {
      const button = createElement("button", "route-entity-link", relation.getLabel(item));
      button.type = "button";
      const targetId = entityAnchorId(relation.prefix, item, collection.indexOf(item));
      button.dataset.target = targetId;
      button.addEventListener("click", () => scrollToStudyEntity(targetId));
      group.append(button);
    });
    graph.append(group);
  });

  if (route?.evidenceFocus) {
    const evidence = createElement("p", "route-evidence-focus");
    evidence.append(createElement("strong", "", "资料焦点"), createDisplayTextNode(route.evidenceFocus));
    graph.append(evidence);
  }

  return hasRelations ? graph : null;
}

function renderLearningRoute(material) {
  const section = createElement("section", "learning-route-contract");
  const heading = createElement("div", "learning-route-heading");
  heading.append(
    createElement("span", "", "目标到掌握"),
    createElement("h3", "", "每个目标都要落到可完成的学习动作")
  );
  section.append(heading);

  const list = createElement("div", "learning-route-list");
  (material.learningRoute || []).forEach((route, index) => {
    const item = createElement("article", "learning-route-item");
    const marker = createElement("div", "learning-route-marker");
    marker.append(
      createElement("span", "", String(index + 1).padStart(2, "0")),
      createElement("strong", "", route.goalLevel || `目标 ${index + 1}`)
    );
    const content = createElement("div", "learning-route-content");
    const target = createElement("p", "learning-route-target", route.goal || "完成这一条学习目标。");
    const decision = createElement("div", "learning-route-decision");
    decision.append(createElement("strong", "", "关键判断"), createElement("p", "", route.focus || "先说清楚这一题或这一段真正考查的关系。"));
    const action = createElement("div", "learning-route-action");
    action.append(createElement("strong", "", "现在去做"), createElement("p", "", route.action || "完成关联的示范与独立练习。"));
    const proof = createElement("div", "learning-route-proof");
    proof.append(createElement("strong", "", "完成证据"), createElement("p", "", route.proof || "脱稿解释理由，并完成对应练习。"));
    content.append(target);
    const relationGraph = renderRouteRelationGraph(material, route);
    if (relationGraph) content.append(relationGraph);
    content.append(decision, action, proof);
    if (route.sharedExampleReason) {
      content.append(createElement("p", "route-shared-reason", `示范复用说明：${route.sharedExampleReason}`));
    }
    item.append(marker, content);
    list.append(item);
  });
  section.append(list);
  return section;
}

function renderOverview(material, { includeModel = true } = {}) {
  const fragment = document.createDocumentFragment();
  const question = createElement("div", "overview-question");
  question.append(
    createElement("span", "", "本课核心问题"),
    createElement("p", "", material.overview.coreQuestion)
  );

  const tip = createElement("div", "reading-tip");
  tip.append(
    createElement("strong", "", "怎么学更快"),
    createElement("p", "", material.overview.readingTip)
  );

  const outline = createElement("div", "outline-list");
  material.overview.outline.forEach((item, index) => {
    const row = createElement("div", "outline-item");
    row.append(
      createElement("span", "", String(index + 1).padStart(2, "0")),
      createElement("p", "", item)
    );
    outline.append(row);
  });

  fragment.append(question, tip, outline);
  if (includeModel) fragment.append(renderCoreModel(material.overview.coreModel));
  return fragment;
}

function renderCoreModel(coreModel) {
  const section = createElement("div", "core-model");
  const claim = createElement("div", "core-claim");
  claim.append(
    createElement("span", "", "核心原理"),
    createElement("p", "", coreModel.coreClaim)
  );

  const chain = createElement("div", "reasoning-chain");
  coreModel.reasoningChain.forEach((link, index) => {
    const item = createElement("div", "reasoning-link");
    item.append(
      createElement("span", "", String(index + 1).padStart(2, "0")),
      createElement("strong", "", link.from),
      createElement("p", "", link.because),
      createElement("small", "", `所以：${link.therefore}`)
    );
    chain.append(item);
  });

  const boundaryTitle = createElement("p", "core-subtitle", "条件边界");
  const boundaries = createElement("div", "boundary-list");
  coreModel.boundaries.forEach((boundary) => {
    const item = createElement("div", "boundary-item");
    item.append(
      createElement("strong", "", boundary.when),
      createElement("p", "", boundary.rule),
      createElement("small", "", `为什么：${boundary.why}`)
    );
    boundaries.append(item);
  });

  const confusion = createElement("div", "confusion-pair");
  confusion.append(
    createElement("span", "", "易混辨析"),
    createElement("strong", "", coreModel.confusionPair.title),
    createElement("p", "", coreModel.confusionPair.difference),
    createElement("small", "", `判断口诀：${coreModel.confusionPair.decisionRule}`)
  );

  section.append(claim, chain, boundaryTitle, boundaries, confusion);
  return section;
}

function renderQuickStart(material) {
  const fragment = document.createDocumentFragment();
  const prerequisiteBlock = createElement("div", "quick-prerequisites");
  prerequisiteBlock.append(createElement("p", "quick-block-label", "开始前先确认"));
  const prerequisiteList = createElement("div", "quick-prerequisite-list");
  material.quickStart.prerequisites.forEach((item) => {
    const label = createElement("label", "quick-prerequisite");
    const input = document.createElement("input");
    input.type = "checkbox";
    const copy = createElement("span");
    copy.append(createElement("strong", "", item.topic), createElement("small", "", item.check));
    label.append(input, copy);
    prerequisiteList.append(label);
  });
  prerequisiteBlock.append(prerequisiteList);

  const timeline = createElement("div", "quick-timeline");
  material.quickStart.studyPlan.forEach((step, index) => {
    const row = createElement("div", "quick-step");
    const time = createElement("div", "quick-time");
    time.append(
      createElement("strong", "", String(step.minutes)),
      createElement("span", "", "分钟")
    );
    const content = createElement("div", "quick-step-copy");
    content.append(
      createElement("span", "", `启动 ${String(index + 1).padStart(2, "0")}`),
      createElement("p", "", step.task),
      createElement("small", "", `完成标志：${step.outcome}`)
    );
    row.append(time, content);
    timeline.append(row);
  });

  const challenge = createElement("div", "first-challenge");
  challenge.append(
    createElement("span", "", "先别往下看"),
    createElement("strong", "", "首个挑战"),
    createElement("p", "", material.quickStart.firstChallenge)
  );
  fragment.append(prerequisiteBlock, timeline, challenge);
  return fragment;
}

function renderKnowledgeMap(material) {
  const canvas = createElement("div", "knowledge-canvas");
  const coverage = createElement("div", "knowledge-coverage");
  const scopeLabels = {
    closed: "有限体系 · 逐项列全",
    open: "开放体系 · 分类覆盖",
    single: "单一概念 · 多维讲透"
  };
  const coverageHeader = createElement("div", "knowledge-coverage-header");
  coverageHeader.append(
    createElement("span", "knowledge-coverage-type", scopeLabels[material.knowledgeMap.scopeType] || scopeLabels.single),
    createElement("strong", "", "本讲义覆盖范围")
  );
  const dimensions = createElement("div", "knowledge-coverage-dimensions");
  (material.knowledgeMap.coverageDimensions || []).forEach((item) => {
    dimensions.append(createElement("span", "", item));
  });
  coverage.append(
    coverageHeader,
    createElement("p", "knowledge-coverage-scope", material.knowledgeMap.scope),
    createElement("p", "knowledge-coverage-summary", material.knowledgeMap.coverageSummary),
    dimensions
  );

  const center = createElement("div", "map-center");
  center.append(
    createElement("span", "map-center-label", "核心主题"),
    createElement("strong", "", material.knowledgeMap.center)
  );
  const grid = createElement("div", "map-node-grid");
  if (material.knowledgeMap.nodes.length > 8) {
    grid.classList.add("is-dense");
  }
  material.knowledgeMap.nodes.forEach((node, index) => {
    const item = createElement("div", "map-node");
    item.id = entityAnchorId("knowledge-node", node, index);
    const content = createElement("div", "map-node-content");
    content.append(
      createElement("strong", "", node.label),
      createElement("p", "", node.detail)
    );
    if (Array.isArray(node.members) && node.members.length) {
      const members = createElement("div", "map-node-members");
      node.members.forEach((member) => members.append(createElement("span", "", member)));
      content.append(members);
    }
    item.append(createElement("span", "map-node-index", String(index + 1).padStart(2, "0")), content);
    grid.append(item);
  });
  canvas.append(coverage, center, grid);
  return canvas;
}

function renderOverviewWorkbookStage(material) {
  const fragment = document.createDocumentFragment();
  const mapSection = createElement("section", "overview-knowledge-map");
  mapSection.append(
    createElement("h3", "workbook-subheading", "知识关系一览"),
    createElement("p", "workbook-subheading-note", "先看中心主题，再沿编号认识本课需要连接起来的知识。"),
    renderKnowledgeMap(material)
  );
  fragment.append(renderOrientStage(material), mapSection);
  return fragment;
}

function renderPointDiagnostic(diagnostic, index) {
  const section = createElement("section", "point-diagnostic");
  const heading = createElement("div", "point-diagnostic-heading");
  heading.append(
    createElement("span", "", "60 秒先判一题"),
    createElement("strong", "", "先写判断，再核对逻辑")
  );
  const prompt = createElement("p", "point-diagnostic-prompt", diagnostic.prompt);
  const answerId = `point-diagnostic-${index + 1}`;
  const toggle = createElement("button", "diagnostic-toggle", "写完再核对");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", answerId);

  const answer = createElement("div", "point-diagnostic-answer");
  answer.id = answerId;
  const expected = createElement("div", "diagnostic-answer is-expected");
  expected.append(createElement("strong", "", "判断逻辑"), createElement("p", "", diagnostic.expected));
  const trap = createElement("div", "diagnostic-answer is-trap");
  trap.append(createElement("strong", "", "最易误判"), createElement("p", "", diagnostic.trap));
  const repair = createElement("div", "diagnostic-answer is-repair");
  repair.append(createElement("strong", "", "答错只修这一步"), createElement("p", "", diagnostic.repair));
  answer.append(expected, trap, repair);

  toggle.addEventListener("click", () => {
    const opening = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(opening));
    answer.classList.toggle("is-open", opening);
    toggle.textContent = opening ? "收起核对逻辑" : "写完再核对";
  });

  section.append(heading, prompt, toggle, answer);
  return section;
}

function renderKeyPoints(material) {
  const list = createElement("div", "key-points");
  material.keyPoints.forEach((point, index) => {
    const item = createElement("div", "key-point");
    item.id = entityAnchorId("key-point", point, index);
    const marker = createElement("div", "point-marker");
    marker.append(
      createElement("strong", "", String(index + 1).padStart(2, "0")),
      createElement("span", "", point.importance)
    );

    const content = createElement("div", "point-content");
    content.append(
      createElement("h3", "", point.title),
      createElement("p", "", point.explanation)
    );

    const decision = createElement("div", "point-decision-grid");
    const principle = createElement("div", "point-decision is-principle");
    principle.append(createElement("span", "", "核心原理"), createElement("p", "", point.principle));
    const useWhen = createElement("div", "point-decision is-use");
    useWhen.append(createElement("span", "", "何时使用"), createElement("p", "", point.useWhen));
    decision.append(principle, useWhen);
    content.append(decision);

    const boundary = createElement("div", "point-boundary");
    boundary.append(createElement("span", "", "条件边界"), createElement("p", "", point.boundary));
    content.append(boundary);

    // 重点中的电路、函数、受力等自然图形需求，直接跟在规则与边界之后，
    // 让“先理解 → 再看图 → 再做判断”的阅读顺序稳定可见。
    const relatedFigures = getTeachingFigures(material, "keyPoints", point.id || `K${index + 1}`);
    if (relatedFigures.length) {
      content.append(renderTeachingFigureGroup(relatedFigures, "is-key-point"));
    }

    content.append(renderPointDiagnostic(point.diagnostic, index));

    if (point.example) {
      const example = createElement("div", "point-example");
      example.append(
        createElement("span", "", "结合资料看"),
        createElement("p", "", point.example)
      );
      content.append(example);
    }

    if (point.memoryTip) {
      const memory = createElement("div", "memory-tip");
      memory.append(
        createElement("span", "", "记忆小招"),
        createElement("p", "", point.memoryTip)
      );
      content.append(memory);
    }

    const retrieval = createElement("p", "retrieval-question");
    retrieval.append(createElement("strong", "", "脱稿自问："), createDisplayTextNode(point.retrievalQuestion));
    content.append(retrieval);

    item.append(marker, content);
    list.append(item);
  });
  return list;
}

function renderStrategyStage(material) {
  return renderStrategyCards(material, material.strategyCards);
}

function renderStrategyCards(material, cards) {
  const section = createElement("div", "strategy-cards");
  const heading = createElement("div", "strategy-heading");
  heading.append(
    createElement("span", "", "从重点到动作"),
    createElement("h3", "", "高价值策略")
  );
  section.append(heading);
  cards.forEach((card, index) => {
    const item = createElement("article", "strategy-card");
    const title = createElement("div", "strategy-title");
    title.append(
      createElement("span", "", `策略 ${String(index + 1).padStart(2, "0")}`),
      createElement("h4", "", card.scenario)
    );
    const trigger = createElement("div", "strategy-trigger");
    trigger.append(createElement("strong", "", "触发信号"), createElement("p", "", card.trigger));
    const firstMove = createElement("div", "strategy-first-move");
    firstMove.append(createElement("strong", "", "第一步"), createElement("p", "", card.firstMove));
    const route = createElement("ol", "strategy-route");
    card.route.forEach((step) => {
      const row = createElement("li");
      row.append(createElement("strong", "", step.action), createElement("p", "", step.reason));
      route.append(row);
    });
    const proof = createElement("div", "strategy-proof");
    const scoring = createElement("div", "strategy-proof-item is-score");
    scoring.append(createElement("span", "", "得分证据"));
    const scoringList = createElement("ul");
    card.scoringPoints.forEach((point) => scoringList.append(createElement("li", "", point)));
    scoring.append(scoringList);
    const loss = createElement("div", "strategy-proof-item is-loss");
    loss.append(createElement("span", "", "容易失分"), createElement("p", "", card.commonLoss));
    proof.append(scoring, loss);
    const variation = createElement("p", "strategy-variation");
    variation.append(createElement("strong", "", "变式："), createDisplayTextNode(card.variation));
    item.append(title, trigger, firstMove, route, proof, variation);
    const relatedFigures = getTeachingFigures(material, "strategyCards", card.id || `S${index + 1}`);
    if (relatedFigures.length) {
      item.append(renderTeachingFigureGroup(relatedFigures, "is-inline-reference is-strategy-figure"));
    }
    section.append(item);
  });
  return section;
}

function renderDecisionFork(decisionFork) {
  const section = createElement("section", "worked-decision-fork");
  const heading = createElement("div", "worked-fork-heading");
  heading.append(
    createElement("span", "", "关键分叉"),
    createElement("strong", "", "为什么这条路看似能走，实际会失分？")
  );
  const tempting = createElement("div", "worked-fork-item is-tempting");
  tempting.append(createElement("strong", "", "看似可行"), createElement("p", "", decisionFork.temptingMove));
  const reason = createElement("div", "worked-fork-item is-reason");
  reason.append(createElement("strong", "", "为什么不通"), createElement("p", "", decisionFork.whyItFails));
  const recovery = createElement("div", "worked-fork-item is-recovery");
  recovery.append(createElement("strong", "", "回到这里"), createElement("p", "", decisionFork.recoveryMove));
  section.append(heading, tempting, reason, recovery);
  return section;
}

function getTeachingFigures(material, section, refId) {
  const figures = Array.isArray(material?.teachingFigures) ? material.teachingFigures : [];
  return figures.filter((figure) => (
    figure?.placement?.section === section
    && figure?.placement?.refId === refId
  ));
}

function getTeachingFigure(material, section, refId) {
  return getTeachingFigures(material, section, refId)[0] || null;
}

function appendTeachingFigureLoading(frame, figure) {
  frame.classList.add("is-pending");
  frame.setAttribute("role", "status");
  frame.setAttribute("aria-live", "polite");
  const status = createElement("div", "figure-render-status");
  const title = createElement("strong", "figure-render-title", "图形正在生产中");
  const progress = createElement("div", "figure-render-progress");
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", `${figure?.title || "教学图形"}正在生成`);
  progress.append(createElement("span", "figure-render-progress-bar"));
  status.append(title, progress);
  frame.append(status);
}

function parseTeachingFigureSvg(source) {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(String(source || ""), "image/svg+xml");
  const svg = documentNode.documentElement;
  const forbidden = svg.querySelector?.("script, style[src], iframe, object, embed, foreignObject");
  if (svg.nodeName.toLowerCase() !== "svg" || forbidden || documentNode.querySelector("parsererror")) {
    return null;
  }
  svg.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (/^on/iu.test(attribute.name) || /(?:javascript:|data:text\/html)/iu.test(attribute.value)) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return svg;
}

function createTeachingFigureSvg(figure) {
  const frame = createElement("div", "teaching-figure-canvas");
  if (figure?.renderStatus !== "ready" || !figure?.svg) {
    appendTeachingFigureLoading(frame, figure);
    return frame;
  }
  const svg = parseTeachingFigureSvg(figure.svg);
  if (!svg) {
    figure.svg = "";
    figure.renderStatus = "pending";
    appendTeachingFigureLoading(frame, figure);
    return frame;
  }
  svg.classList.add("teaching-figure-svg");
  frame.append(document.importNode(svg, true));
  return frame;
}

function createBoundTeachingFigureSvg(figure) {
  const frame = createTeachingFigureSvg(figure);
  frame.dataset.figureId = figure.id;
  frame.dataset.figureStatus = figure.renderStatus || "pending";
  return frame;
}

function renderTeachingFigure(figure, index = 0) {
  const figureElement = createElement("figure", "teaching-figure");
  figureElement.dataset.figureType = figure.type;
  figureElement.dataset.figureId = figure.id;
  figureElement.dataset.figureStatus = figure.renderStatus || "pending";
  figureElement.setAttribute("aria-busy", String(figure.renderStatus !== "ready"));
  const heading = createElement("div", "teaching-figure-heading");
  const eyebrow = createElement("span", "teaching-figure-eyebrow", `学科图形 ${String(index + 1).padStart(2, "0")}`);
  const title = createElement("h4", "", figure.title);
  const purpose = createElement("p", "", figure.purpose);
  heading.append(eyebrow, title, purpose);
  const caption = createElement("figcaption", "teaching-figure-caption");
  caption.append(
    createElement("strong", "", "读图提示"),
    createElement("span", "", figure.caption)
  );
  figureElement.append(heading, createTeachingFigureSvg(figure), caption);
  return figureElement;
}

function renderTeachingFigureGroup(figures, className = "") {
  const group = createElement("div", `teaching-figure-group ${className}`.trim());
  figures.forEach((figure, index) => group.append(renderTeachingFigure(figure, index)));
  return group;
}

function buildTeachingFigureRequest(figure) {
  return {
    id: figure.id,
    subject: figure.subject,
    figureType: figure.type,
    stem: figure.stem,
    title: figure.title,
    purpose: figure.purpose,
    description: figure.description || [
      figure.title,
      figure.purpose,
      figure.stem,
      figure.caption
    ].filter(Boolean).join("；"),
    caption: figure.caption,
    placement: figure.placement,
    params: figure.params,
    constraints: figure.constraints,
    rejectedRenderVersion: figure.rejectedRenderVersion || undefined
  };
}

function applyTeachingFigureResult(figure, svg) {
  if (!svg || !parseTeachingFigureSvg(svg)) return false;
  figure.svg = svg;
  figure.renderStatus = "ready";
  figure.renderAttempt = 0;
  figure.rejectedRenderVersion = "";
  const roots = elements.studyPaper.querySelectorAll(`[data-figure-id="${CSS.escape(figure.id)}"]`);
  roots.forEach((root) => {
    root.dataset.figureStatus = "ready";
    root.setAttribute("aria-busy", "false");
    const currentCanvas = root.classList.contains("teaching-figure-canvas")
      ? root
      : root.querySelector(".teaching-figure-canvas");
    if (currentCanvas) {
      const nextCanvas = createBoundTeachingFigureSvg(figure);
      currentCanvas.replaceWith(nextCanvas);
    }
  });
  return true;
}

function setTeachingFigureRenderStatus(figure, renderStatus, renderAttempt = 1) {
  if (!figure || figure.renderStatus === "ready") return;
  figure.renderStatus = renderStatus;
  figure.renderAttempt = renderAttempt;
  const roots = elements.studyPaper.querySelectorAll(`[data-figure-id="${CSS.escape(figure.id)}"]`);
  roots.forEach((root) => {
    root.dataset.figureStatus = renderStatus;
    root.setAttribute("aria-busy", "true");
    const currentCanvas = root.classList.contains("teaching-figure-canvas")
      ? root
      : root.querySelector(".teaching-figure-canvas");
    if (currentCanvas?.isConnected) currentCanvas.replaceWith(createBoundTeachingFigureSvg(figure));
  });
}

function setFigureExportAvailability(ready) {
  [elements.pdfButton, elements.wordButton].forEach((button) => {
    if (!button) return;
    button.disabled = !ready;
    button.setAttribute("aria-disabled", String(!ready));
    button.title = ready ? "" : "图形完成后即可下载完整报告";
  });
}

function createFigureRequestSignal() {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(FIGURE_REQUEST_TIMEOUT_MS)
    : undefined;
}

function normalizeFigurePollDelay(value, retryCount) {
  const fallback = FIGURE_RETRY_DELAYS_MS[Math.min(retryCount, FIGURE_RETRY_DELAYS_MS.length - 1)];
  const delay = Number(value);
  return Number.isFinite(delay) ? Math.max(300, Math.min(10_000, delay)) : fallback;
}

async function pollTeachingFigureOnce(figure, token, renderTaskId, retryCount) {
  const renderAttempt = retryCount + 1;
  setTeachingFigureRenderStatus(figure, retryCount ? "retrying" : "generating", renderAttempt);
  try {
    const response = await fetchWithRecovery("/api/render/figure", () => ({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Render-Id": renderTaskId
      },
      body: JSON.stringify(buildTeachingFigureRequest(figure)),
      signal: createFigureRequestSignal()
    }), { attempts: 1 });
    const result = await response.json().catch(() => ({}));
    if (token !== state.figureLoadToken) return { stale: true };
    if (!response.ok) {
      const error = new Error(result.error || `图形服务返回 ${response.status}`);
      error.status = response.status;
      error.retryable = result.retryable !== false;
      throw error;
    }
    if (result?.renderStatus === "ready") {
      if (applyTeachingFigureResult(figure, result.svg)) {
        return { ready: true, pollAfterMs: 0 };
      }
      figure.rejectedRenderVersion = result.renderVersion || "";
      setTeachingFigureRenderStatus(figure, "retrying", renderAttempt + 1);
      return { ready: false, pollAfterMs: 300 };
    }
    return {
      ready: false,
      pollAfterMs: normalizeFigurePollDelay(result?.pollAfterMs, retryCount)
    };
  } catch (error) {
    if (token !== state.figureLoadToken) return { stale: true };
    return {
      ready: false,
      pollAfterMs: normalizeFigurePollDelay(
        error?.status === 400 || error?.retryable === false ? 5_000 : undefined,
        retryCount
      )
    };
  }
}

async function renderTeachingFiguresProgressively(figures, token, renderTaskId) {
  const tasks = figures.map((figure, index) => ({
    figure,
    index,
    active: false,
    ready: false,
    retryCount: 0,
    nextAttemptAt: Date.now(),
    queueOrder: index
  }));
  let completedCount = 0;
  let queueSequence = tasks.length;

  const claimNextTask = () => {
    const now = Date.now();
    const dueTask = tasks
      .filter((task) => !task.active && !task.ready && task.nextAttemptAt <= now)
      .sort((left, right) => left.queueOrder - right.queueOrder)[0];
    if (dueTask) {
      dueTask.active = true;
      return { task: dueTask, waitMs: 0 };
    }
    const nextTask = tasks
      .filter((task) => !task.active && !task.ready)
      .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt || left.queueOrder - right.queueOrder)[0];
    return {
      task: null,
      waitMs: nextTask ? Math.max(20, Math.min(500, nextTask.nextAttemptAt - now)) : 50
    };
  };

  const worker = async () => {
    while (token === state.figureLoadToken && completedCount < tasks.length) {
      const claim = claimNextTask();
      if (!claim.task) {
        await wait(claim.waitMs);
        continue;
      }

      const task = claim.task;
      try {
        const result = await pollTeachingFigureOnce(
          task.figure,
          token,
          renderTaskId,
          task.retryCount
        );
        if (result.stale) return;
        if (result.ready) {
          task.ready = true;
          completedCount += 1;
          continue;
        }
        task.retryCount += 1;
        task.nextAttemptAt = Date.now() + result.pollAfterMs;
        task.queueOrder = queueSequence;
        queueSequence += 1;
      } finally {
        task.active = false;
      }
    }
  };
  const workerCount = Math.min(FIGURE_RENDER_CONCURRENCY, figures.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return token === state.figureLoadToken && completedCount === tasks.length;
}

async function loadTeachingFigures(material) {
  const figures = Array.isArray(material?.teachingFigures) ? material.teachingFigures : [];
  if (!figures.length) {
    setFigureExportAvailability(true);
    return "empty";
  }
  const figuresToRender = figures.filter((figure) => (
    figure?.renderStatus !== "ready" || !figure?.svg || !parseTeachingFigureSvg(figure.svg)
  ));
  figuresToRender.forEach((figure) => {
    figure.svg = "";
    figure.renderStatus = "pending";
    figure.renderAttempt = 0;
    figure.rejectedRenderVersion = "";
  });
  if (!figuresToRender.length) {
    setFigureExportAvailability(true);
    return "ready";
  }
  const token = ++state.figureLoadToken;
  const renderTaskId = createTaskId("figures");
  setFigureExportAvailability(false);
  elements.studyPaper.querySelectorAll("[data-figure-id]").forEach((item) => {
    if (item.dataset.figureStatus !== "ready") item.setAttribute("aria-busy", "true");
  });
  try {
    await renderTeachingFiguresProgressively(figuresToRender, token, renderTaskId);
  } finally {
    if (token === state.figureLoadToken) {
      elements.studyPaper.querySelectorAll("[data-figure-id]").forEach((item) => {
        item.setAttribute("aria-busy", String(item.dataset.figureStatus !== "ready"));
      });
    }
  }
  if (token !== state.figureLoadToken) return "stale";
  const allReady = figures.every((figure) => figure.renderStatus === "ready" && figure.svg);
  setFigureExportAvailability(allReady);
  if (!allReady) showToast("图形仍在自动生成，请保持页面打开，完成后即可下载。");
  return allReady ? "ready" : "pending";
}

function renderWorkedExamples(material) {
  const list = createElement("div", "worked-examples");
  material.workedExamples.forEach((example, exampleIndex) => {
    const article = createElement("article", "worked-example");
    article.id = entityAnchorId("worked-example", example, exampleIndex);
    const heading = createElement("div", "worked-example-heading");
    heading.append(
      createElement("span", "", `示范 ${String(exampleIndex + 1).padStart(2, "0")}`),
      createElement("h3", "", example.title)
    );
    const meta = createElement("div", "worked-meta");
    meta.append(
      createElement("span", "", example.questionType),
      createElement("span", "", `触发信号：${example.trigger}`)
    );
    const problem = createElement("div", "worked-problem");
    problem.append(createElement("span", "", "题目"), createElement("p", "", example.problem));
    const relatedFigures = getTeachingFigures(material, "workedExamples", example.id || `E${exampleIndex + 1}`);
    const briefing = createElement("div", "worked-briefing");
    const given = createElement("div", "worked-brief is-given");
    given.append(createElement("strong", "", "给定条件"), createElement("p", "", example.given));
    const target = createElement("div", "worked-brief is-target");
    target.append(createElement("strong", "", "本题目标"), createElement("p", "", example.target));
    briefing.append(given, target);
    const strategy = createElement("div", "worked-strategy");
    strategy.append(
      createElement("strong", "", "先定策略"),
      createElement("p", "", example.strategy),
      createElement("small", "", `判断规则：${example.decisionRule}`)
    );
    const steps = createElement("ol", "worked-steps");
    example.steps.forEach((step) => {
      const item = createElement("li");
      const copy = createElement("div");
      const rationale = createElement("small", "worked-rationale", `为什么：${step.rationale}`);
      const checkpoint = createElement("small", "worked-checkpoint", `检查：${step.checkpoint}`);
      copy.append(createElement("strong", "", step.label), createElement("p", "", step.explanation), rationale, checkpoint);
      item.append(copy);
      steps.append(item);
    });

    const result = createElement("div", "worked-result");
    const answer = createElement("div", "worked-result-item is-answer");
    answer.append(createElement("span", "", "完整答案"), createElement("p", "", example.answer));
    const selfCheck = createElement("div", "worked-result-item worked-self-check is-check");
    selfCheck.append(createElement("span", "", "自检点"), createElement("p", "", example.selfCheck));
    result.append(answer, selfCheck);
    const quality = createElement("div", "worked-quality");
    const scoring = createElement("div", "worked-quality-item is-score");
    scoring.append(createElement("span", "", "得分证据"));
    const scoringList = createElement("ul");
    example.scoringPoints.forEach((point) => scoringList.append(createElement("li", "", point)));
    scoring.append(scoringList);
    const wrongPath = createElement("div", "worked-quality-item is-loss");
    wrongPath.append(createElement("span", "", "错误路径"), createElement("p", "", example.commonWrongPath));
    quality.append(scoring, wrongPath);
    const boundary = createElement("p", "worked-boundary");
    boundary.append(createElement("strong", "", "边界检查："), createDisplayTextNode(example.boundaryCheck));
    const variation = createElement("p", "worked-variation");
    variation.append(createElement("strong", "", "变式迁移："), createDisplayTextNode(example.variation));
    article.append(heading, meta, problem);
    if (relatedFigures.length) article.append(renderTeachingFigureGroup(relatedFigures, "is-worked-example"));
    article.append(briefing, strategy, renderDecisionFork(example.decisionFork), steps, result, quality, boundary, variation);
    list.append(article);
  });
  return list;
}

function renderCloseReading(material) {
  const list = createElement("div", "close-reading-list");
  material.closeReading.forEach((reading, index) => {
    const item = createElement("div", "close-reading-item");
    item.append(
      createElement("h3", "", reading.heading),
      createElement("blockquote", "original-quote", reading.original),
      createElement("p", "close-explanation", reading.explanation),
      createElement("p", "thinking-question", reading.question)
    );
    const relatedFigures = getTeachingFigures(material, "closeReading", reading.id || `C${index + 1}`);
    if (relatedFigures.length) {
      item.append(renderTeachingFigureGroup(relatedFigures, "is-inline-reference is-reading-figure"));
    }
    list.append(item);
  });
  return list;
}

function renderConcepts(material) {
  const list = createElement("div", "glossary-list");
  material.concepts.forEach((concept) => {
    const item = createElement("div", "concept-item");
    item.append(
      createElement("h3", "", concept.term),
      createElement("p", "", concept.definition),
      createElement("p", "concept-example", `例：${concept.example}`)
    );
    list.append(item);
  });
  return list;
}

function renderFlowVisual(visual) {
  const container = createElement("div", "flow-visual");
  const items = visual.items.length ? visual.items : ["观察资料", "理解重点", "完成练习"];
  items.forEach((item, index) => {
    const node = createElement("div", "flow-item", item);
    node.dataset.index = String(index + 1).padStart(2, "0");
    container.append(node);
    if (index < items.length - 1) container.append(createElement("span", "flow-connector"));
  });
  return container;
}

function renderCompareVisual(visual) {
  const container = createElement("div", "compare-visual");
  const left = createElement("div", "compare-column is-negative");
  const right = createElement("div", "compare-column is-positive");
  const leftList = createElement("ul");
  const rightList = createElement("ul");
  const leftItems = visual.leftItems.length ? visual.leftItems : ["只记住表面结论"];
  const rightItems = visual.rightItems.length ? visual.rightItems : ["理解关系并主动应用"];
  leftItems.forEach((item) => leftList.append(createElement("li", "", item)));
  rightItems.forEach((item) => rightList.append(createElement("li", "", item)));
  left.append(createElement("h4", "", visual.leftTitle), leftList);
  right.append(createElement("h4", "", visual.rightTitle), rightList);
  container.append(left, right);
  return container;
}

function renderTimelineVisual(visual) {
  const container = createElement("div", "timeline-visual");
  const items = visual.items.length ? visual.items : ["开始", "发展", "结果"];
  items.forEach((item) => container.append(createElement("div", "timeline-item", item)));
  return container;
}

function renderVisuals(material) {
  const list = createElement("div", "visuals-list");
  material.visuals.forEach((visual, visualIndex) => {
    const block = createElement("div", "visual-block");
    const heading = createElement("div", "visual-heading");
    heading.append(
      createElement("h3", "", visual.title),
      createElement("p", "", visual.caption)
    );
    const figure = getTeachingFigure(material, "visuals", `V${visualIndex + 1}`);
    block.append(heading);
    if (figure) {
      block.append(createBoundTeachingFigureSvg(figure));
    }
    const details = createElement("ul", "visual-detail-list");
    if (visual.type === "compare") {
      [...visual.leftItems.map((item) => `容易混淆：${item}`), ...visual.rightItems.map((item) => `正确理解：${item}`)]
        .forEach((item) => details.append(createElement("li", "", item)));
    } else {
      (visual.items.length ? visual.items : ["观察资料", "理解重点", "完成练习"])
        .forEach((item) => details.append(createElement("li", "", item)));
    }
    block.append(details);
    list.append(block);
  });
  return list;
}

function renderKnowledgeDiagrams(material) {
  const list = createElement("div", "knowledge-diagram-list");
  const diagrams = Array.isArray(material.knowledgeDiagrams) ? material.knowledgeDiagrams : [];

  diagrams.forEach((diagram, index) => {
    const article = createElement("article", "knowledge-diagram-card");
    const heading = createElement("header", "knowledge-diagram-heading");
    heading.append(
      createElement("span", "knowledge-diagram-index", `图解 ${String(index + 1).padStart(2, "0")}`),
      createElement("h3", "", diagram.title),
      createElement("p", "", diagram.purpose)
    );

    const figure = getTeachingFigure(material, "knowledgeDiagrams", `D${index + 1}`);
    const visual = createElement("div", "knowledge-diagram-visual");
    if (figure) {
      visual.append(createBoundTeachingFigureSvg(figure));
    } else {
      visual.append(createElement("p", "teaching-figure-error", "图形暂时无法显示，请重新生成本资料。"));
    }

    const footer = createElement("div", "knowledge-diagram-footer");
    footer.append(createElement("p", "knowledge-diagram-explanation", diagram.explanation));

    const guide = createElement("ol", "knowledge-diagram-guide");
    diagram.readingGuide.forEach((item) => guide.append(createElement("li", "", item)));
    footer.append(guide);

    article.append(heading, visual, footer);
    list.append(article);
  });

  return list;
}

function renderKnowledgeDiagramStage(material) {
  const fragment = document.createDocumentFragment();
  fragment.append(renderKnowledgeDiagrams(material));

  const support = createElement("section", "diagram-support-visuals");
  support.append(
    createElement("h3", "workbook-subheading", "SVG辅助图"),
    renderVisuals(material)
  );
  fragment.append(support);
  return fragment;
}

function renderMistakes(material) {
  const list = createElement("div", "mistakes-list");
  material.mistakes.forEach((mistake, index) => {
    const row = createElement("div", "mistake-row");
    const wrong = createElement("div", "mistake-side is-wrong");
    wrong.append(createElement("span", "", "容易这样想"), createElement("p", "", mistake.wrong));
    const right = createElement("div", "mistake-side is-right");
    right.append(createElement("span", "", "应该这样理解"), createElement("p", "", mistake.right));
    row.append(
      wrong,
      createElement("div", "mistake-arrow", "→"),
      right,
      createElement("p", "mistake-reason", `为什么：${mistake.reason}`)
    );
    const relatedFigures = getTeachingFigures(material, "mistakes", mistake.id || `X${index + 1}`);
    if (relatedFigures.length) {
      row.append(renderTeachingFigureGroup(relatedFigures, "is-inline-reference is-mistake-figure"));
    }
    list.append(row);
  });
  return list;
}

function renderPractice(material) {
  const list = createElement("div", "practice-list");
  const letters = "ABCDEF";

  material.practice.forEach((practice, index) => {
    const item = createElement("div", "practice-item");
    item.id = entityAnchorId("practice", practice, index);
    const question = createElement("div", "practice-question");
    const meta = createElement("div", "question-meta");
    meta.append(
      createElement("span", "", practice.type),
      createElement("span", "", practice.difficulty)
    );
    question.append(meta, createElement("h3", "", practice.question));

    const plan = createElement("p", "practice-plan");
    plan.append(createElement("strong", "", "先这样做："), createDisplayTextNode(practice.solvingPlan));
    question.append(plan);

    const relatedFigures = getTeachingFigures(material, "practice", practice.id || `P${index + 1}`);
    if (relatedFigures.length) question.append(renderTeachingFigureGroup(relatedFigures, "is-practice"));

    if (practice.options.length) {
      const options = createElement("ul", "option-list");
      practice.options.forEach((option, optionIndex) => {
        const row = createElement("li");
        row.append(createElement("span", "", letters[optionIndex]), createElement("div", "", option));
        options.append(row);
      });
      question.append(options);
    }

    const answerId = `answer-${index + 1}`;
    const toggle = createElement("button", "answer-toggle", "做完了，查看答案与解析");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", answerId);

    const answer = createElement("div", "answer-panel");
    answer.id = answerId;
    const answerText = createElement("p");
    answerText.append(createElement("strong", "", "参考答案："), createDisplayTextNode(practice.answer));
    const explanation = createElement("p");
    explanation.append(createElement("strong", "", "思路解析："), createDisplayTextNode(practice.explanation));
    const scoring = createElement("div", "answer-scoring");
    scoring.append(createElement("strong", "", "得分点"));
    const scoringList = createElement("ul");
    practice.scoringPoints.forEach((point) => scoringList.append(createElement("li", "", point)));
    scoring.append(scoringList);
    const losses = createElement("div", "answer-losses");
    losses.append(createElement("strong", "", "常见失分"));
    const lossList = createElement("ul");
    practice.commonLosses.forEach((loss) => lossList.append(createElement("li", "", loss)));
    losses.append(lossList);
    const repair = createElement("p", "answer-repair");
    repair.append(createElement("strong", "", "错后修复："), createDisplayTextNode(practice.repairAction));
    answer.append(answerText, explanation, scoring, losses, repair);

    toggle.addEventListener("click", () => {
      const opening = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(opening));
      answer.classList.toggle("is-open", opening);
      toggle.textContent = opening ? "收起答案与解析" : "做完了，查看答案与解析";
    });

    item.append(question, toggle, answer);
    list.append(item);
  });
  return list;
}

function renderMasteryChecks(material) {
  const ladder = createElement("div", "mastery-ladder");
  material.masteryChecks.forEach((check, index) => {
    const item = createElement("div", `mastery-level mastery-level-${index + 1}`);
    item.id = entityAnchorId("mastery-check", check, index);
    const marker = createElement("div", "mastery-marker");
    marker.append(
      createElement("span", "", `第 ${index + 1} 关`),
      createElement("strong", "", check.level)
    );
    const content = createElement("div", "mastery-content");
    content.append(createElement("p", "mastery-task", check.task));
    const deliverable = createElement("div", "mastery-deliverable");
    deliverable.append(createElement("strong", "", "提交证据"), createElement("p", "", check.deliverable));
    const criteria = createElement("div", "mastery-criteria");
    criteria.append(createElement("strong", "", "通过标准"), createElement("p", "", check.criteria));
    const rubric = createElement("div", "mastery-rubric");
    rubric.append(createElement("strong", "", "评分维度"));
    const rubricList = createElement("ul");
    check.rubric.forEach((item) => rubricList.append(createElement("li", "", item)));
    rubric.append(rubricList);
    const outputFrame = createElement("div", "mastery-output-frame");
    outputFrame.append(createElement("strong", "", "输出骨架"));
    const frameList = createElement("ol");
    check.outputFrame.forEach((step) => frameList.append(createElement("li", "", step)));
    outputFrame.append(frameList);
    const rescue = createElement("div", "mastery-rescue");
    rescue.append(createElement("strong", "", "卡住时"), createElement("p", "", check.ifStuck));
    const completed = createElement("label", "mastery-completed");
    const input = document.createElement("input");
    input.type = "checkbox";
    completed.append(input, createElement("span", "", "我已独立通过这一关"));
    content.append(deliverable, outputFrame, criteria, rubric, rescue);
    content.append(completed);
    item.append(marker, content);
    const relatedFigures = getTeachingFigures(material, "masteryChecks", check.id || `M${index + 1}`);
    if (relatedFigures.length) {
      item.append(renderTeachingFigureGroup(relatedFigures, "is-inline-reference is-mastery-figure"));
    }
    ladder.append(item);
  });
  return ladder;
}

function renderReviewPlan(material) {
  const grid = createElement("div", "review-grid");
  material.reviewPlan.forEach((review) => {
    const item = createElement("div", "review-item");
    item.append(
      createElement("span", "", review.day),
      createElement("p", "", review.task),
      createElement("small", "", `建议用时 ${review.duration}`)
    );
    grid.append(item);
  });
  return grid;
}

function createStageBlock(index, title, description, content) {
  const block = createElement("section", "stage-block");
  const heading = createElement("header", "stage-block-heading");
  heading.append(
    createElement("span", "stage-block-index", index),
    createElement("h3", "", title),
    createElement("p", "", description)
  );
  block.append(heading, content);
  return block;
}

function renderRouteLearningLoops(material) {
  const list = createElement("div", "route-loop-list");
  const routes = material.learningRoute || [];

  routes.forEach((route, index) => {
    const loop = createElement("article", "route-loop");
    const heading = createElement("div", "route-loop-heading");
    heading.append(
      createElement("span", "", `闭环 ${String(index + 1).padStart(2, "0")}`),
      createElement("h4", "", route.goal || route.goalLevel || `完成第 ${index + 1} 条学习路径`)
    );
    const prompt = createElement("p", "route-loop-prompt", "按“抓住重点 → 看示范 → 独立练 → 提交证据”的顺序完成，点击关联项可直接跳转。");
    const graph = renderRouteRelationGraph(material, route, "route-loop-graph");
    const actions = createElement("div", "route-loop-actions");
    [
      ["先判断", route.focus || "先识别本题或本段的关键关系。"],
      ["再行动", route.action || "完成关联练习，并写出理由。"],
      ["最后证明", route.proof || "脱稿说明做法与结论。"]
    ].forEach(([label, text]) => {
      const action = createElement("div");
      action.append(createElement("strong", "", label), createElement("p", "", text));
      actions.append(action);
    });
    loop.append(heading, prompt);
    if (graph) loop.append(graph);
    loop.append(actions);
    if (route.sharedExampleReason) {
      loop.append(createElement("p", "route-shared-reason", `示范复用说明：${route.sharedExampleReason}`));
    }
    list.append(loop);
  });

  return list;
}

function getFirstRouteItem(material, route, relationKey, fallbackItems, index) {
  const relation = routeRelationDefinitions.find((item) => item.key === relationKey);
  const linkedItems = relation ? resolveRouteRelationItems(material, route, relation) : [];
  return linkedItems[0] || fallbackItems[index] || fallbackItems[0] || null;
}

function getLearningUnits(material) {
  const routes = Array.isArray(material.learningRoute) ? material.learningRoute : [];
  const goals = Array.isArray(material.learningGoals) ? material.learningGoals : [];
  const keyPoints = Array.isArray(material.keyPoints) ? material.keyPoints : [];
  const examples = Array.isArray(material.workedExamples) ? material.workedExamples : [];
  const practices = Array.isArray(material.practice) ? material.practice : [];
  const checks = Array.isArray(material.masteryChecks) ? material.masteryChecks : [];

  return Array.from({ length: 3 }, (_, index) => {
    const point = keyPoints[index] || keyPoints[0] || null;
    const route = routes[index] || {
      goalLevel: goals[index]?.level || `目标 ${index + 1}`,
      goal: goals[index]?.text || point?.title || "完成这一项关键学习动作。",
      focus: point?.principle || point?.explanation || "先说清楚这一段内容真正考查的关系。",
      proof: checks[index]?.criteria || "能独立完成练习，并说明理由。",
      sourceRefs: point?.sourceRefs || []
    };

    return {
      index,
      route,
      goal: goals[index] || { level: route.goalLevel || `目标 ${index + 1}`, text: route.goal || "完成这一项关键学习动作。" },
      point: getFirstRouteItem(material, route, "keyPointIds", keyPoints, index),
      example: getFirstRouteItem(material, route, "exampleIds", examples, index),
      practice: getFirstRouteItem(material, route, "practiceIds", practices, index),
      check: getFirstRouteItem(material, route, "masteryCheckIds", checks, index)
    };
  });
}

function createUnitField(label, text, className = "") {
  const field = createElement("div", `unit-field ${className}`.trim());
  field.append(createElement("span", "", label), createElement("p", "", text || "请先用自己的话说清楚这一点。"));
  return field;
}

function isTemplatePlaceholder(value) {
  return /手动输入的知识点|资料标题|核心表达|逐词翻译/u.test(String(value || ""));
}

function getStudentCoreQuestion(material) {
  const question = material.overview?.coreQuestion;
  if (question && !isTemplatePlaceholder(question)) return question;

  const firstPoint = material.keyPoints?.[0];
  if (firstPoint?.title) return `看到题目时，先找什么线索，才能用对“${firstPoint.title}”这条规则？`;
  return "这类题先看什么，再决定怎样写？";
}

function getStudentStarterTask(material) {
  const challenge = material.quickStart?.firstChallenge;
  if (challenge && !isTemplatePlaceholder(challenge)) return challenge;

  const firstPoint = material.keyPoints?.[0];
  if (firstPoint?.principle) return `先不看后面的讲解，用自己的话写下：${firstPoint.principle}`;
  return "先写下你的第一步判断，再继续往下学。";
}

function renderOrientStage(material) {
  const fragment = document.createDocumentFragment();
  const units = getLearningUnits(material);
  const goalList = createElement("ol", "orientation-goals");

  units.forEach((unit) => {
    const item = createElement("li", "orientation-goal");
    const heading = createElement("div", "orientation-goal-heading");
    heading.append(
      createElement("span", "", String(unit.index + 1).padStart(2, "0")),
      createElement("h3", "", unit.goal.text || `完成第 ${unit.index + 1} 个目标`)
    );
    const proof = createElement("p", "orientation-goal-proof");
    proof.append(
      createElement("span", "", "完成标准"),
      createDisplayTextNode(unit.route.proof || unit.check?.criteria || "能独立完成练习，并说明理由。")
    );
    item.append(heading, proof);
    goalList.append(item);
  });

  const prompt = createElement("section", "orientation-prompt");
  const coreQuestion = createElement("div", "orientation-question");
  coreQuestion.append(
    createElement("span", "", "这一课要解决什么"),
    createElement("p", "", getStudentCoreQuestion(material))
  );
  const challenge = createElement("div", "orientation-challenge");
  challenge.append(
    createElement("span", "", "先想一想"),
    createElement("p", "", getStudentStarterTask(material))
  );
  prompt.append(coreQuestion, challenge);
  fragment.append(goalList, prompt);
  return fragment;
}

function compactLogicLabel(value, maxLength = 17) {
  const text = String(value || "")
    .replace(/\s+/gu, " ")
    .replaceAll("自学", "学习")
    .trim();
  const characters = [...text];
  return characters.length > maxLength ? `${characters.slice(0, maxLength).join("")}…` : text;
}

function createLogicMapSvg(labels) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.classList.add("logic-map-svg");
  svg.setAttribute("viewBox", "0 0 400 300");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "做题判断顺序图");

  const add = (tag, attrs, text = "") => {
    const node = document.createElementNS(namespace, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text) node.textContent = text;
    svg.append(node);
    return node;
  };

  const steps = labels.slice(0, 5);
  steps.forEach((label, index) => {
    const y = 18 + index * 54;
    add("rect", {
      x: 48,
      y,
      width: 304,
      height: 32,
      rx: 8,
      fill: index === steps.length - 1 ? "#eaf4ef" : "#f3f7f8",
      stroke: index === steps.length - 1 ? "#39705f" : "#315e74",
      "stroke-width": 1.5
    });
    add("text", {
      x: 200,
      y: y + 21,
      "text-anchor": "middle",
      fill: "#17252c",
      "font-size": 13,
      "font-family": "Microsoft YaHei, sans-serif",
      "font-weight": 700
    }, compactLogicLabel(label, 22));
    if (index < steps.length - 1) {
      add("line", { x1: 200, y1: y + 32, x2: 200, y2: y + 48, stroke: "#c18b31", "stroke-width": 2 });
      add("polygon", { points: `${194},${y + 44} ${206},${y + 44} ${200},${y + 52}`, fill: "#c18b31" });
    }
  });
  return svg;
}

function renderLessonLogicMap(material) {
  const points = (material.keyPoints || [])
    .slice(0, 3)
    .map((point) => compactLogicLabel(point.title || point.principle))
    .filter(Boolean);
  if (!points.length) return null;

  const flow = ["先找题目里的线索", ...points, "写出答案，再检查一遍"];
  const figure = createElement("figure", "lesson-logic-map");
  const caption = createElement("figcaption");
  caption.append(
    createElement("strong", "", "一张图看懂做题顺序"),
    createElement("span", "", "先找线索，再按箭头一步一步想。")
  );
  figure.append(caption, createLogicMapSvg(flow));
  return figure;
}

function renderCompactExample(example) {
  const section = createElement("section", "unit-example");
  const heading = createElement("div", "unit-subheading");
  heading.append(createElement("span", "", "跟着做一遍"), createElement("strong", "", example?.title || "示范步骤"));
  section.append(heading);

  if (example?.problem) section.append(createElement("p", "unit-example-problem", example.problem));

  const steps = createElement("ol", "unit-example-steps");
  const exampleSteps = Array.isArray(example?.steps) ? example.steps.slice(0, 3) : [];
  if (exampleSteps.length) {
    exampleSteps.forEach((step) => {
      const item = createElement("li");
      item.append(createElement("strong", "", step.label), createElement("p", "", step.explanation));
      steps.append(item);
    });
  } else {
    const item = createElement("li");
    item.append(createElement("strong", "", "先做什么"), createElement("p", "", example?.strategy || "先找出已知条件、目标和它们之间的关系。"));
    steps.append(item);
  }
  section.append(steps);
  return section;
}

function renderCompactPractice(material, practice, unitIndex) {
  const section = createElement("section", "unit-practice");
  const heading = createElement("div", "unit-subheading");
  heading.append(createElement("span", "", "现在独立做"), createElement("strong", "", practice?.type || "独立练习"));
  section.append(heading);
  section.append(createElement("p", "unit-practice-question", practice?.question || "不看示范，用刚才的判断完成一道同类练习。"));

  const relatedFigures = getTeachingFigures(material, "practice", practice?.id || `P${unitIndex + 1}`);
  if (relatedFigures.length) section.append(renderTeachingFigureGroup(relatedFigures, "is-practice"));

  if (Array.isArray(practice?.options) && practice.options.length) {
    const options = createElement("ol", "unit-practice-options");
    practice.options.forEach((option) => options.append(createElement("li", "", option)));
    section.append(options);
  }

  const answerId = `unit-answer-${unitIndex + 1}`;
  const toggle = createElement("button", "unit-answer-toggle", "完成后核对答案");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", answerId);

  const answer = createElement("div", "unit-answer-panel");
  answer.id = answerId;
  answer.append(
    createUnitField("参考答案", practice?.answer || "请用关键判断写出结论。", "is-answer"),
    createUnitField("关键理由", practice?.explanation || practice?.solvingPlan || "核对是否先判断条件，再完成推理。"),
    createUnitField("错后只改", practice?.repairAction || "回到关键判断，重做第一步。", "is-repair")
  );

  toggle.addEventListener("click", () => {
    const opening = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(opening));
    toggle.textContent = opening ? "收起答案" : "完成后核对答案";
    answer.classList.toggle("is-open", opening);
  });

  section.append(toggle, answer);
  return section;
}

function renderLearningUnit(material, unit) {
  const article = createElement("article", "learning-unit");
  article.id = `learning-unit-${unit.index + 1}`;
  const heading = createElement("header", "learning-unit-heading");
  heading.append(
    createElement("span", "", `单元 ${String(unit.index + 1).padStart(2, "0")}`),
    createElement("h3", "", unit.route.goal || unit.goal.text || `完成第 ${unit.index + 1} 个学习目标`)
  );

  const explanation = unit.point?.explanation || unit.point?.principle || unit.route.action || "把关键关系用自己的话重新说明一遍。";
  const useWhen = unit.point?.useWhen || unit.example?.trigger || "出现与本单元相同的条件或题型时使用。";
  const boundary = unit.point?.boundary || unit.example?.boundaryCheck || "条件不满足时，先重新判断，不要直接套用。";
  const focus = createElement("section", "unit-focus");
  focus.append(
    createUnitField("关键判断", unit.route.focus || unit.point?.principle || "先判断题目真正考查的关系。", "is-decision"),
    createUnitField("讲清这一点", explanation),
    createUnitField("何时用", useWhen),
    createUnitField("边界", boundary, "is-boundary")
  );

  const pass = createElement("section", "unit-pass");
  pass.append(
    createElement("span", "", "过关标准"),
    createElement("p", "", unit.check?.criteria || unit.route.proof || "能独立完成练习，并用一句话说明关键判断。")
  );

  article.append(heading, focus, renderCompactExample(unit.example), renderCompactPractice(material, unit.practice, unit.index), pass);
  return article;
}

function renderUnderstandStage(material) {
  const list = createElement("div", "insight-list");
  (material.keyPoints || []).slice(0, 3).forEach((point, index) => {
    const item = createElement("article", "insight-item");
    item.id = entityAnchorId("key-point", point, index);

    const heading = createElement("header", "insight-heading");
    heading.append(
      createElement("span", "", `判断 ${String(index + 1).padStart(2, "0")}`),
      createElement("h3", "", point.title || `关键判断 ${index + 1}`)
    );

    const principle = createElement("div", "insight-principle");
    principle.append(
      createElement("span", "", "一句话规则"),
      createElement("p", "", point.principle || point.explanation || "先确认条件，再给出结论。")
    );

    const details = createElement("dl", "insight-details");
    [
      ["意思是", point.explanation || "理解这个规则为什么这样用。"],
      ["看到什么时用", point.useWhen || "题目出现相同条件时使用。"],
      ["最容易错在哪儿", point.boundary || "条件不满足时，先重新判断。"]
    ].forEach(([label, value]) => {
      const row = createElement("div", "insight-detail");
      row.append(createElement("dt", "", label), createElement("dd", "", value));
      details.append(row);
    });

    item.append(heading, principle, details);
    const support = renderInsightSupport(point);
    if (support) item.append(support);
    if (index === 0) {
      const logicMap = renderLessonLogicMap(material);
      if (logicMap) item.append(logicMap);
    }
    list.append(item);
  });
  return list;
}

function createInsightSupportRow(label, value, className = "") {
  const row = createElement("div", `insight-support-row ${className}`.trim());
  row.append(createElement("span", "", label), createElement("p", "", value));
  return row;
}

function renderInsightSupport(point) {
  const hasExample = Boolean(point?.example);
  const hasMemoryTip = Boolean(point?.memoryTip);
  const hasRetrievalQuestion = Boolean(point?.retrievalQuestion);
  const checkPrompt = point?.retrievalQuestion || point?.diagnostic?.prompt;

  if (!hasExample && !hasMemoryTip && !checkPrompt) return null;

  const support = createElement("section", "insight-support");
  support.append(createElement("h4", "", "把规则用在题目里"));

  if (hasExample) {
    support.append(createInsightSupportRow("举个例子", point.example, "is-example"));
  }
  if (hasMemoryTip) {
    support.append(createInsightSupportRow("记住它", point.memoryTip, "is-memory"));
  }
  if (!checkPrompt) return support;

  const check = createElement("details", "insight-check");
  const summary = createElement("summary");
  summary.append(
    createElement("strong", "", "30 秒检查"),
    createElement("span", "", "先自己想一想，再展开核对")
  );
  const prompt = createElement("p", "insight-check-prompt", checkPrompt);
  const answer = createElement("div", "insight-check-answer");
  const diagnostic = point?.diagnostic || {};
  const trimTerminalPunctuation = (value) => String(value || "").trim().replace(/[。；！？]+$/u, "");
  const retrievalGuide = [
    point?.useWhen ? `先找：${trimTerminalPunctuation(point.useWhen)}` : "",
    point?.principle ? `再判断：${trimTerminalPunctuation(point.principle)}` : ""
  ].filter(Boolean).join("；");
  const answerRows = (hasRetrievalQuestion
    ? [
      ["核对要点", retrievalGuide],
      ["容易错在哪", point?.boundary || diagnostic.trap],
      ["卡住时", "回到“一句话规则”，先圈出题里的线索，再重新判断。"]
    ]
    : [
      ["核对思路", diagnostic.expected],
      ["容易错在哪", diagnostic.trap],
      ["卡住时", diagnostic.repair]
    ]
  ).filter(([, value]) => value);

  answerRows.forEach(([label, value]) => {
    answer.append(createInsightSupportRow(label, value));
  });
  check.append(summary, prompt);
  if (answerRows.length) check.append(answer);
  support.append(check);
  return support;
}

function renderPassTasks(material) {
  const list = createElement("ol", "pass-task-list");
  const units = getLearningUnits(material);
  units.forEach((unit) => {
    const check = unit.check || {};
    const item = createElement("li", "pass-task");
    const heading = createElement("div", "pass-task-heading");
    heading.append(
      createElement("span", "", String(unit.index + 1).padStart(2, "0")),
      createElement("strong", "", check.level || unit.goal.level || `第 ${unit.index + 1} 关`),
      createElement("p", "", check.task || unit.route.proof || "脱稿完成这一单元的关键输出。")
    );
    const evidence = createElement("p", "pass-task-evidence");
    evidence.append(createElement("span", "", "交付"), createDisplayTextNode(check.deliverable || unit.route.proof || "写出结论与关键理由。"));
    const criterion = createElement("p", "pass-task-criterion");
    criterion.append(createElement("span", "", "通过"), createDisplayTextNode(check.criteria || "结论正确，并能说明关键判断。"));
    item.append(heading, evidence, criterion);
    list.append(item);
  });
  return list;
}

function renderCompactReviewPlan(material) {
  const list = createElement("ol", "compact-review-list");
  (material.reviewPlan || []).slice(0, 4).forEach((review, index) => {
    const item = createElement("li");
    item.append(
      createElement("span", "", review.day || `第 ${index + 1} 次`),
      createElement("p", "", review.task || "脱稿回忆关键判断，再完成一道练习。"),
      createElement("small", "", review.duration || "10 分钟")
    );
    list.append(item);
  });
  return list;
}

function renderWorkedExample(material, example, index) {
  const item = createElement("article", "worked-strip");
  item.id = entityAnchorId("worked-example", example, index);
  const heading = createElement("header", "worked-strip-heading");
  heading.append(
    createElement("span", "", `示范 ${String(index + 1).padStart(2, "0")}`),
    createElement("h3", "", example.title || example.questionType || "跟着做一遍")
  );

  const problem = createElement("div", "worked-strip-problem");
  problem.append(createElement("span", "", "题目"), createElement("p", "", example.problem || example.given || "根据给定条件完成判断。"));

  const rule = createElement("div", "worked-strip-rule");
  rule.append(createElement("span", "", "关键判断"), createElement("p", "", example.decisionRule || example.strategy || "先找条件，再选择对应的方法。"));

  const steps = createElement("ol", "worked-strip-steps");
  (example.steps || []).slice(0, 3).forEach((step) => {
    const row = createElement("li");
    row.append(createElement("strong", "", step.label || "这一步"), createElement("p", "", step.explanation || step.rationale || "完成这一项推理。"));
    steps.append(row);
  });
  if (!steps.children.length) {
    const row = createElement("li");
    row.append(createElement("strong", "", "第一步"), createElement("p", "", example.strategy || "先列出已知条件与要解决的问题。"));
    steps.append(row);
  }

  const answer = createElement("p", "worked-strip-answer");
  answer.append(createElement("span", "", "答案"), createDisplayTextNode(example.answer || "写出结论，并回到题干说明理由。"));
  item.append(heading, problem, rule, steps, answer);
  return item;
}

function renderPracticeTask(material, practice, index) {
  const item = createElement("article", "practice-task");
  item.id = entityAnchorId("practice", practice, index);
  const heading = createElement("header", "practice-task-heading");
  heading.append(
    createElement("span", "", `练习 ${String(index + 1).padStart(2, "0")}`),
    createElement("strong", "", practice.type || "独立练习")
  );
  const question = createElement("p", "practice-task-question", practice.question || "不看示范，独立完成这道练习。" );
  const plan = createElement("p", "practice-task-plan");
  plan.append(createElement("span", "", "先这样做"), createDisplayTextNode(practice.solvingPlan || "先找条件，再写出判断与理由。"));

  if (Array.isArray(practice.options) && practice.options.length) {
    const options = createElement("ol", "practice-task-options");
    practice.options.forEach((option) => options.append(createElement("li", "", option)));
    item.append(heading, question, plan, options);
  } else {
    item.append(heading, question, plan);
  }

  const answerId = `practice-check-${index + 1}`;
  const toggle = createElement("button", "practice-check-toggle", "完成后核对");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", answerId);

  const answer = createElement("div", "practice-check-answer");
  answer.id = answerId;
  [
    ["参考答案", practice.answer || "写出结论，并保留关键理由。"],
    ["为什么", practice.explanation || "核对是否按条件完成了判断。"],
    ["错后只改", practice.repairAction || "回到第一步，重新找出判断条件。"]
  ].forEach(([label, value]) => {
    const row = createElement("div", "practice-answer-row");
    row.append(createElement("span", "", label), createElement("p", "", value));
    answer.append(row);
  });

  toggle.addEventListener("click", () => {
    const opening = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(opening));
    toggle.textContent = opening ? "收起核对" : "完成后核对";
    answer.classList.toggle("is-open", opening);
  });

  item.append(toggle, answer);
  return item;
}

function renderPracticeStage(material) {
  const fragment = document.createDocumentFragment();
  const examples = createElement("section", "worked-section");
  examples.append(createElement("h3", "", "先看两道示范，知道每一步怎么想"));
  const exampleList = createElement("div", "worked-strip-list");
  (material.workedExamples || []).slice(0, 2).forEach((example, index) => {
    exampleList.append(renderWorkedExample(material, example, index));
  });
  examples.append(exampleList);

  const practice = createElement("section", "practice-section");
  practice.append(createElement("h3", "", "再自己做三题，做完后再核对"));
  const practiceList = createElement("div", "practice-task-list");
  (material.practice || []).slice(0, 3).forEach((item, index) => {
    practiceList.append(renderPracticeTask(material, item, index));
  });
  practice.append(practiceList);
  fragment.append(examples, practice);
  return fragment;
}

function renderMasteryStage(material) {
  const fragment = document.createDocumentFragment();
  const checks = createElement("ol", "mastery-check-list");
  (material.masteryChecks || []).slice(0, 3).forEach((check, index) => {
    const item = createElement("li", "mastery-check-item");
    item.id = entityAnchorId("mastery-check", check, index);
    const heading = createElement("header", "mastery-check-heading");
    heading.append(
      createElement("span", "", String(index + 1).padStart(2, "0")),
      createElement("h3", "", check.level || `第 ${index + 1} 关`),
      createElement("p", "", check.task || "脱稿完成这一项输出。")
    );
    const details = createElement("dl", "mastery-check-details");
    [
       ["要完成什么", check.deliverable || "写出结论与关键理由。"],
       ["做到这样就可以", check.criteria || "结论正确，并能说明理由。"],
       ["卡住时先做", check.ifStuck || "回到对应规则，重做第一步。"]
    ].forEach(([label, value]) => {
      const row = createElement("div");
      row.append(createElement("dt", "", label), createElement("dd", "", value));
      details.append(row);
    });
    item.append(heading, details);
    checks.append(item);
  });

  const review = createElement("section", "short-review");
  review.append(createElement("h3", "", "隔一段时间，再回来检查一遍"));
  const reviewList = createElement("ol", "short-review-list");
  (material.reviewPlan || []).slice(0, 2).forEach((item, index) => {
    const row = createElement("li");
    row.append(
      createElement("span", "", item.day || `第 ${index + 1} 次`),
      createElement("p", "", item.task || "脱稿回忆关键判断，再完成一道同类练习。"),
      createElement("small", "", item.duration || "5 分钟")
    );
    reviewList.append(row);
  });
  review.append(reviewList);
  fragment.append(checks, review);
  return fragment;
}

function renderReviewStage(material) {
  const fragment = document.createDocumentFragment();
  const taskSection = createElement("section", "review-section");
  taskSection.append(createElement("h3", "", "完成这三关，再算学会"), renderPassTasks(material));
  const planSection = createElement("section", "review-section");
  planSection.append(createElement("h3", "", "按这个节奏复习"), renderCompactReviewPlan(material));
  fragment.append(taskSection, planSection);
  return fragment;
}

function renderMasteryWorkbookStage(material) {
  const fragment = document.createDocumentFragment();
  const review = createElement("section", "workbook-review-plan");
  review.append(
    createElement("h3", "workbook-subheading", "复习安排"),
    createElement("p", "workbook-subheading-note", "按间隔回看仍不稳定的判断，每次都留下一个可检查结果。"),
    renderReviewPlan(material)
  );
  fragment.append(renderMasteryChecks(material), review);
  return fragment;
}

function createPaperSection(definition, index, material) {
  const group = getStageGroup(definition.id);
  const section = createElement("section", `paper-section learning-stage stage-${definition.id}`);
  section.id = definition.id;
  section.dataset.toc = definition.title;
  section.dataset.phase = group?.id || "understand";
  section.append(
    makeSectionHeading(index + 1, definition, group),
    definition.render(material)
  );
  return section;
}

function renderPaper(material) {
  clearElement(elements.studyPaper);
  elements.studyPaper.classList.add("minimal-study-paper", "comprehensive-study-paper", "editorial-study-paper");
  elements.studyPaper.append(renderCover(material));
  stageDefinitions.forEach((definition, index) => {
    elements.studyPaper.append(createPaperSection(definition, index, material));
  });
  const footer = createElement("footer", "paper-footer");
  footer.append(
    createElement("span", "", "最后一分钟"),
    createElement("h2", "", "合上资料，用自己的话讲出重点、方法和一个例子。"),
    createElement("p", "", "哪一步说不清，就从目录回到对应栏目精准核对，不必从头重看。")
  );
  elements.studyPaper.append(footer);
}

function renderStudyMath(root = elements.studyPaper) {
  root.dataset.mathRenderState = "pending";
  const errors = [];
  try {
    if (typeof window.renderMathInElement !== "function") throw new Error("公式渲染组件未加载");
    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false }
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      strict(errorCode) {
        return errorCode === "unicodeTextInMathMode" ? "ignore" : "error";
      },
      throwOnError: true,
      trust: false,
      errorCallback(message) {
        errors.push(message);
      }
    });
    if (errors.length) throw new Error(errors[0]);
    root.querySelectorAll(".katex-display").forEach((formula) => {
      const container = formula.parentElement?.childNodes.length === 1 ? formula.parentElement : formula;
      const nextNode = container.nextSibling;
      if (nextNode?.nodeType === Node.TEXT_NODE) {
        const cleanedText = String(nextNode.textContent || "").replace(/^[\s，。；：、,.!?！？]+/u, "");
        if (cleanedText) nextNode.textContent = cleanedText;
        else nextNode.remove();
      }
    });
    root.dataset.mathRenderState = "ready";
    delete root.dataset.mathRenderError;
  } catch (error) {
    root.dataset.mathRenderState = "error";
    root.dataset.mathRenderError = String(error?.message || "公式无法渲染").slice(0, 240);
    console.error("讲义公式渲染失败", error);
  }
  return root.dataset.mathRenderState;
}

function getStageNavigationButtons() {
  return [
    ...elements.tocNav.querySelectorAll("[data-target]"),
    ...(elements.mobileStageNav ? [...elements.mobileStageNav.querySelectorAll("[data-target]")] : [])
  ];
}

function setActiveStageNavigation(targetId) {
  getStageNavigationButtons().forEach((button) => {
    const isActive = button.dataset.target === targetId;
    button.classList.toggle("is-active", isActive);
    if (isActive) button.setAttribute("aria-current", "location");
    else button.removeAttribute("aria-current");
  });
}

function createStageNavigationButton(definition, className) {
  const button = createElement("button", className);
  button.type = "button";
  button.dataset.target = definition.id;
  button.append(
    createElement("span", "stage-nav-number", String(stageDefinitions.indexOf(definition) + 1).padStart(2, "0")),
    createElement("span", "stage-nav-title", definition.navTitle || definition.title)
  );
  button.addEventListener("click", () => {
    state.tocLockUntil = Date.now() + 900;
    setActiveStageNavigation(definition.id);
    document.getElementById(definition.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      state.tocLockUntil = 0;
      updateReadingProgress();
    }, 950);
  });
  return button;
}

function renderToc() {
  if (elements.tocNav) {
    clearElement(elements.tocNav);
    stageGroups.forEach((group) => {
      const groupElement = createElement("section", "toc-group");
      groupElement.dataset.group = group.id;
      const groupHeading = createElement("div", "toc-group-label");
      groupHeading.append(
        createElement("span", "toc-group-number", group.number),
        createElement("div", "toc-group-copy")
      );
      groupHeading.lastElementChild.append(
        createElement("strong", "", `${group.label} · ${group.title}`),
        createElement("small", "", group.description)
      );
      groupElement.append(groupHeading);
      const links = createElement("div", "toc-group-links");
      group.stageIds.forEach((stageId) => {
        const definition = stageDefinitions.find((stage) => stage.id === stageId);
        if (definition) links.append(createStageNavigationButton(definition, "toc-link"));
      });
      groupElement.append(links);
      elements.tocNav.append(groupElement);
    });
  }

  if (elements.mobileStageNav) {
    clearElement(elements.mobileStageNav);
    stageDefinitions.forEach((definition) => {
      elements.mobileStageNav.append(createStageNavigationButton(definition, "mobile-stage-link"));
    });
  }
}

function setupObservers() {
  state.tocObserver?.disconnect();
  state.revealObserver?.disconnect();

  const sections = [...elements.studyPaper.querySelectorAll(".paper-section")];
  const tocButtons = getStageNavigationButtons();

  state.tocObserver = new IntersectionObserver((entries) => {
    if (Date.now() < state.tocLockUntil) return;
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((first, second) => second.intersectionRatio - first.intersectionRatio)[0];
    if (!visible) return;
    setActiveStageNavigation(visible.target.id);
  }, { rootMargin: "-16% 0px -68% 0px", threshold: [0, 0.05, 0.2] });

  state.revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });

  sections.forEach((section) => {
    section.classList.add("reveal-ready");
    state.tocObserver.observe(section);
    state.revealObserver.observe(section);
  });
  tocButtons[0]?.classList.add("is-active");
}

function renderNotice(warnings) {
  if (!warnings?.length) {
    elements.resultNotice.hidden = true;
    return;
  }
  elements.noticeText.textContent = warnings.join("；");
  elements.resultNotice.hidden = false;
}

function resetChecklist() {
  elements.checklistInputs.forEach((input) => {
    input.checked = false;
  });
  updateChecklist();
}

function updateChecklist() {
  const completed = elements.checklistInputs.filter((input) => input.checked).length;
  const percent = Math.round((completed / elements.checklistInputs.length) * 100);
  elements.progressRing.style.setProperty("--progress", `${percent * 3.6}deg`);
  elements.progressValue.textContent = `${percent}%`;
  const tips = [
    "先看清三个目标和首个挑战。",
    "已确定目标，逐个完成三个学习单元。",
    "关键点已讲透，开始完成过关任务。",
    "三个阶段完成，现在脱稿说出三个关键判断。"
  ];
  elements.checklistTip.textContent = tips[Math.min(completed, tips.length - 1)];
}

function updateReadingProgress() {
  if (!elements.resultView.classList.contains("is-active") || !state.material) return;
  const start = elements.studyPaper.offsetTop;
  const distance = Math.max(1, elements.studyPaper.offsetHeight - window.innerHeight);
  const percent = Math.min(100, Math.max(0, Math.round(((window.scrollY - start) / distance) * 100)));
  elements.readingProgress.style.width = `${percent}%`;
  elements.readingStatus.textContent = percent < 3 ? "准备开始" : percent >= 97 ? "已读到结尾" : `已阅读 ${percent}%`;

  if (Date.now() >= state.tocLockUntil) {
    const sections = [...elements.studyPaper.querySelectorAll(".paper-section")];
    const readingLine = Math.min(180, window.innerHeight * 0.24);
    const activeSection = sections.reduce((current, section) => {
      return section.getBoundingClientRect().top <= readingLine ? section : current;
    }, sections[0]);
    if (activeSection?.id) setActiveStageNavigation(activeSection.id);
  }
}

function setFocusMode(enabled) {
  document.body.classList.toggle("focus-mode", enabled);
  elements.focusButton.setAttribute("aria-pressed", String(enabled));
  elements.focusButton.querySelector("span").textContent = enabled ? "退出专注" : "专注";
  window.requestAnimationFrame(updateReadingProgress);
}

function renderResult(result) {
  // 先使上一份资料的异步绘图响应失效，避免相同 placement ID 把旧主题图形写入新页面。
  state.figureLoadToken += 1;
  state.material = result.material;
  renderPaper(result.material);
  const mathRenderState = renderStudyMath();
  renderToc();
  renderNotice(result.warnings);
  resetChecklist();

  const displayTitle = getDisplayMaterialTitle(result.material);
  const overview = [result.material.meta.grade, result.material.meta.subject].filter(Boolean).join(" · ");
  elements.toolbarTitle.textContent = displayTitle;
  elements.sourceCount.textContent = displayTitle;
  elements.sourceName.textContent = `${overview || "本节学习"} · ${result.material.meta.estimatedMinutes || 40} 分钟 · ${stageDefinitions.length} 个栏目`;
  if (elements.tocCount) elements.tocCount.textContent = `${stageDefinitions.length} 个栏目`;
  document.title = `${displayTitle} · 学习资料生成器`;

  if (mathRenderState === "error") showToast("部分公式没有正确显示，请重新生成后再下载。");

  switchView(elements.resultView);
  setFigureExportAvailability(false);
  state.figureLoadPromise = loadTeachingFigures(result.material).catch(() => {
    setFigureExportAvailability(false);
    return "pending";
  });
  window.requestAnimationFrame(() => {
    setupObservers();
    updateReadingProgress();
  });
}

async function copyOutline() {
  if (!state.material) return;
  const material = state.material;
  const lines = [
    `《${getDisplayMaterialTitle(material)}》学习提纲`,
    "",
    "一、本课导航｜这节课要会什么",
    ...(material.learningGoals || []).slice(0, 3).map((goal, index) => `${index + 1}. ${goal.text}`),
    "",
    "核心问题：",
    material.overview?.coreQuestion || "这一课的关键关系是什么？",
    "",
    "二、重点精讲｜三个关键判断",
    ...(material.keyPoints || []).slice(0, 3).flatMap((point, index) => [
      `${index + 1}. ${point.title}`,
      `判断：${point.principle}`,
      `适用：${point.useWhen}`,
      `边界：${point.boundary}`
    ]),
    "",
    "三、解题策略｜看到什么信号后怎样做",
    ...(material.strategyCards || []).map((item, index) => `${index + 1}. ${item.scenario}｜${item.trigger}｜第一步：${item.firstMove}`),
    "",
    "四、资料精读｜回到关键原句",
    ...(material.closeReading || []).map((item, index) => `${index + 1}. ${item.heading}｜${item.question}`),
    "",
    "五、概念词典｜必须说清的词",
    ...(material.concepts || []).map((item) => `${item.term}：${item.definition}`),
    "",
    "六、图解知识点｜用结构看清完整系统",
    ...(material.knowledgeDiagrams || []).flatMap((item, index) => [
      `${index + 1}. ${item.title}｜${item.purpose}`,
      `读图说明：${item.explanation}`
    ]),
    ...(material.visuals || []).map((item, index) => `辅助图 ${index + 1}. ${item.title}｜${item.caption}`),
    "",
    "七、易错辨析｜错误起点与正确改法",
    ...(material.mistakes || []).map((item, index) => `${index + 1}. 错：${item.wrong}｜对：${item.right}`),
    "",
    "八、例题拆解｜完整思考过程",
    ...(material.workedExamples || []).map((item, index) => `${index + 1}. ${item.title}｜判断：${item.decisionRule}`),
    "",
    "九、分层练习｜先想，再写",
    ...(material.practice || []).map((item, index) => `${index + 1}. ${item.question}（先做：${item.solvingPlan}）`),
    "",
    "十、掌握证明｜看看自己会不会",
    ...(material.masteryChecks || []).slice(0, 3).map((item) => `${item.level}｜${item.task}｜通过：${item.criteria}`),
    "",
    "复习安排：",
    ...(material.reviewPlan || []).map((item) => `${item.day}｜${item.task}（${item.duration}）`)
  ];

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showToast("学习提纲已复制。");
  } catch {
    showToast("当前浏览器无法自动复制，请手动选择文本复制。");
  }
}

function safeDownloadName(title, extension) {
  const safeTitle = String(title || "学习资料报告")
    .replace(/[<>:"/\\|?*：？＊\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64) || "学习资料报告";
  return `${safeTitle}-完整学习报告.${extension}`;
}

function markServiceDisconnected() {
  state.aiReady = false;
  elements.serviceStatus.classList.remove("is-ready");
  elements.serviceStatus.classList.add("is-error");
  elements.statusText.textContent = "服务未连接";
  renderFileList();
}

function getDownloadErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message)) {
    markServiceDisconnected();
    return "下载服务连接已中断，请刷新页面后重试；若仍失败，请重新启动应用。";
  }
  return message || "文件生成失败，请稍后重试。";
}

async function downloadReport(format, button) {
  if (!state.material || button.disabled) return;
  const label = button.querySelector("span");
  const originalLabel = label.innerHTML;
  button.disabled = true;
  button.classList.add("is-loading");
  label.textContent = format === "pdf" ? "正在生成 PDF…" : "正在生成 Word…";

  try {
    const figureStatus = await state.figureLoadPromise;
    if (!["ready", "empty"].includes(figureStatus)) {
      throw new Error("图形仍在生成中，完成后即可下载完整报告。");
    }
    label.textContent = format === "pdf" ? "正在生成 PDF…" : "正在生成 Word…";
    const response = await fetch(`/api/export/${format}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material: state.material })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "文件生成失败，请稍后重试。");
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = safeDownloadName(getDisplayMaterialTitle(state.material), format === "pdf" ? "pdf" : "docx");
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
    showToast(format === "pdf" ? "PDF 完整报告已下载。" : "Word 完整报告已下载。");
  } catch (error) {
    showToast(getDownloadErrorMessage(error));
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
    label.innerHTML = originalLabel;
    elements.exportMenu.open = false;
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("服务不可用");
    const health = await response.json();
    state.aiReady = health.aiConfigured;
    elements.serviceStatus.classList.toggle("is-ready", health.aiConfigured);
    elements.serviceStatus.classList.toggle("is-error", !health.aiConfigured);
    elements.statusText.textContent = health.aiConfigured ? "AI 分析服务已就绪" : "AI 服务未配置";
    renderFileList();
  } catch {
    markServiceDisconnected();
  }
}

function bindEvents() {
  elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
  elements.sourceModeButtons.forEach((button) => {
    button.addEventListener("click", () => setSourceMode(button.dataset.sourceMode));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = elements.sourceModeButtons.indexOf(button);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + elements.sourceModeButtons.length) % elements.sourceModeButtons.length;
      const nextButton = elements.sourceModeButtons[nextIndex];
      setSourceMode(nextButton.dataset.sourceMode);
      nextButton.focus();
    });
  });
  elements.manualInput.addEventListener("input", () => {
    const length = Math.min(MAX_MANUAL_LENGTH, elements.manualInput.value.length);
    elements.manualCount.textContent = `${length} / ${MAX_MANUAL_LENGTH}`;
    updateAutoSubjectLabel();
    updateGenerateAvailability();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove("is-dragging");
    });
  });

  elements.dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
  elements.generatorForm.addEventListener("submit", generateMaterial);
  elements.pdfButton.addEventListener("click", () => downloadReport("pdf", elements.pdfButton));
  elements.wordButton.addEventListener("click", () => downloadReport("docx", elements.wordButton));
  elements.copyButton.addEventListener("click", copyOutline);
  elements.focusButton.addEventListener("click", () => {
    setFocusMode(!document.body.classList.contains("focus-mode"));
  });
  elements.noticeClose.addEventListener("click", () => {
    elements.resultNotice.hidden = true;
  });

  elements.backButton.addEventListener("click", () => {
    setFocusMode(false);
    document.title = "学习资料生成器";
    switchView(elements.setupView);
  });

  elements.brandHome.addEventListener("click", () => {
    setFocusMode(false);
    document.title = "学习资料生成器";
    switchView(elements.setupView);
  });

  elements.checklistInputs.forEach((input) => input.addEventListener("change", updateChecklist));
  document.addEventListener("click", (event) => {
    if (elements.exportMenu.open && !elements.exportMenu.contains(event.target)) elements.exportMenu.open = false;
  });
  window.addEventListener("scroll", () => {
    elements.exportMenu.open = false;
    updateReadingProgress();
  }, { passive: true });
  window.addEventListener("resize", updateReadingProgress);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("focus-mode")) setFocusMode(false);
  });
}

window.renderStudyReportForExport = (material) => {
  state.material = material;
  setFocusMode(false);
  renderPaper(material);
  const mathRenderState = renderStudyMath();
  elements.resultNotice.hidden = true;
  document.body.classList.add("export-render");
  switchView(elements.resultView);
  document.title = `${getDisplayMaterialTitle(material)} · 完整学习报告`;
  return mathRenderState;
};

bindEvents();
setSourceMode("upload");
renderFileList();
checkHealth();
window.setInterval(() => {
  if (!document.hidden) void checkHealth();
}, 30_000);

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx", "png", "jpg", "jpeg", "txt", "md"];

const form = document.querySelector("#analysisForm");
const analyzeButton = document.querySelector("#analyzeButton");
const reportPanel = document.querySelector("#reportPanel");
const toast = document.querySelector("#toast");
const settingsLink = document.querySelector(".settings-link");
const scorePointsList = document.querySelector("#scorePoints");
const downloadPdfButton = document.querySelector("#downloadPdfButton");
const downloadWordButton = document.querySelector("#downloadWordButton");

const POINT_GUIDANCE = {
  答题对象: {
    requirement: "明确题目要求回答的对象、范围和任务动词。",
    analysis: "先圈出题干中的作答对象与限定条件，后续结论和依据都必须围绕它展开。",
    suggestion: "写答案前先确认“回答谁、回答什么、回答到什么范围”。",
  },
  核心结论: {
    requirement: "给出能够直接回应题问的核心判断或结论。",
    analysis: "先形成明确结论，再补材料或计算过程，避免只有过程没有最终回答。",
    suggestion: "把核心结论放在答案开头或每个要点的首句。",
  },
  关键依据: {
    requirement: "选取能够支撑结论的题干条件、材料信息、公式或事实。",
    analysis: "逐一核对结论依赖的已知条件，区分有效依据与无关信息。",
    suggestion: "在每个结论后补上对应条件、材料原句或公式来源。",
  },
  推理步骤: {
    requirement: "呈现从已知条件到结论的关键推导、计算或论证链。",
    analysis: "检查相邻步骤之间是否存在跳步，并说明每一步使用了什么条件或规律。",
    suggestion: "按“条件—方法—过程—结论”补齐中间推导。",
  },
  关键词: {
    requirement: "使用学科规范术语、关键概念和必要符号。",
    analysis: "对照题目所属知识点，检查表达是否准确、是否使用了阅卷可识别的术语。",
    suggestion: "把口语化表述替换为教材中的规范概念、公式符号或术语。",
  },
  格式要求: {
    requirement: "满足题目要求的分点、单位、符号、书写和答案格式。",
    analysis: "完成内容后检查分点层次、单位、符号、答句和书写规范。",
    suggestion: "按题目要求整理分点，并补全单位、符号或完整答句。",
  },
};

let toastTimer;
let currentReport;

function showToast(message, type = "info") {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", type === "error");
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function validateFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new Error("仅支持 PDF、Word、PNG、JPG、TXT 和 Markdown 文件");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("单个文件不能超过 15 MB");
  }
}

function initUploadZone(zoneId, inputId) {
  const zone = document.querySelector(`#${zoneId}`);
  const input = document.querySelector(`#${inputId}`);
  const summary = zone.querySelector(".file-summary");
  const removeButton = zone.querySelector(".remove-file");

  function update(file) {
    if (!file) {
      input.value = "";
      summary.textContent = "";
      zone.classList.remove("has-file");
      return;
    }
    try {
      validateFile(file);
      summary.textContent = `${file.name} · ${formatFileSize(file.size)}`;
      zone.classList.add("has-file");
    } catch (error) {
      input.value = "";
      zone.classList.remove("has-file");
      showToast(error.message, "error");
    }
  }

  input.addEventListener("change", () => update(input.files[0]));
  zone.addEventListener("keydown", (event) => {
    if (event.target !== zone || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    input.click();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
    });
  });

  zone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (!file) return;
    try {
      validateFile(file);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      update(file);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  removeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    update(null);
  });
}

function formatScore(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1).replace(/\.0$/, "");
}

function statusPresentation(point, hasStudentWork) {
  if (Number(point.score) === 0) {
    if (!hasStudentWork) return { className: "pending", label: "解题指导" };
    if (point.status === "missing") return { className: "missing", label: "有待补全" };
    if (point.status === "partial") return { className: "partial", label: "需要完善" };
    return { className: "support", label: "已检查" };
  }
  switch (point.status) {
    case "covered":
      return { className: "covered", label: "已掌握" };
    case "compliant":
      return { className: "covered", label: "书写规范" };
    case "partial":
      return { className: "partial", label: "需要完善" };
    case "missing":
      return { className: "missing", label: "有待补全" };
    default:
      return { className: "pending", label: hasStudentWork ? "待核查" : "解题指导" };
  }
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function detailItem(label, content, className = "") {
  const item = makeElement("div", `point-detail-item ${className}`.trim());
  const description = makeElement("dd");
  window.AcademicRendering.setText(description, content);
  item.append(makeElement("dt", "", label), description);
  return item;
}

function evidencePresentation(point) {
  if (point.evidence) return { label: "作答依据", content: point.evidence };
  if (["covered", "compliant"].includes(point.status)) {
    return {
      label: "判定说明",
      content: "该维度已达到得分要求；当前结果未返回可单独摘录的作答片段，请结合原图复核对应位置。",
    };
  }
  if (point.status === "partial") {
    return {
      label: "判定说明",
      content: "已识别到部分有效作答，但当前结果未返回可单独摘录的完整依据，请结合原图复核。",
    };
  }
  return {
    label: "作答依据",
    content: "当前作答中未识别到能支撑本维度的有效表达。",
  };
}

function resultStateOf(report) {
  if (["guidance", "needs_improvement", "full_score"].includes(report.resultState)) {
    return report.resultState;
  }
  const hasStudentWork = Boolean(report.hasStudentWork ?? report.hasStudentAnswer);
  if (!hasStudentWork) return "guidance";
  return Number(report.missingScore) === 0 ? "full_score" : "needs_improvement";
}

function renderScorePoint(point, index, resultState) {
  const hasStudentWork = resultState !== "guidance";
  const status = statusPresentation(point, hasStudentWork);
  const fallback = POINT_GUIDANCE[point.label] || POINT_GUIDANCE.核心结论;
  const requirement = point.requirement || fallback.requirement;
  const analysis = point.analysis || fallback.analysis;
  const suggestion = point.suggestion || fallback.suggestion;
  const detailId = `score-point-detail-${index + 1}`;
  const row = makeElement("li", `score-point-row ${status.className} order-${index}`);
  const summary = makeElement("button", "point-summary");
  summary.type = "button";
  summary.setAttribute("aria-expanded", "false");
  summary.setAttribute("aria-controls", detailId);
  summary.setAttribute("aria-label", `${point.label}，${status.label}`);

  const chevron = makeElement("span", "point-chevron");
  chevron.setAttribute("aria-hidden", "true");
  chevron.append(makeElement("span", "lucide-icon icon-chevron-down"));

  summary.append(
    makeElement("span", "point-index", String(index + 1).padStart(2, "0")),
    makeElement("strong", "point-label", point.label),
    makeElement("span", "point-score", Number(point.score) > 0 ? `${formatScore(point.score)} 分` : "不单列分值"),
    makeElement("span", "point-status", status.label),
    chevron,
  );

  const detail = makeElement("div", "point-detail");
  detail.id = detailId;
  detail.hidden = true;
  const details = makeElement("dl", "point-detail-list");
  const analysisLabel = resultState === "guidance" ? "解题指导" : resultState === "full_score" ? "表现分析" : "作答诊断";
  const suggestionLabel = resultState === "guidance" ? "解题建议" : resultState === "full_score" ? "保持建议" : "提分动作";
  details.append(
    detailItem("评分观察", requirement),
    detailItem(analysisLabel, analysis),
    detailItem(suggestionLabel, suggestion),
  );
  if (hasStudentWork) {
    const evidence = evidencePresentation(point);
    details.append(detailItem(evidence.label, evidence.content, "evidence"));
  }
  detail.append(details);

  row.append(summary, detail);
  return row;
}

function renderReport(report) {
  currentReport = {
    ...report,
    subject: report.subject || document.querySelector("#subject").value,
  };
  const resultState = resultStateOf(report);
  const hasStudentWork = resultState !== "guidance";
  const isFullScore = resultState === "full_score";
  reportPanel.classList.toggle("guidance-mode", resultState === "guidance");
  reportPanel.classList.toggle("full-score-mode", isFullScore);
  window.AcademicRendering.setText(document.querySelector("#questionPreview"), report.questionPreview);
  document.querySelector("#totalScoreDisplay").textContent = `${formatScore(report.totalScore)} 分`;
  window.AcademicRendering.setText(document.querySelector("#revisionAdvice"), report.revisionAdvice);
  document.querySelector("#adviceLabel").textContent = resultState === "guidance"
    ? "解题建议："
    : isFullScore ? "表现总结：" : "提分建议：";

  if (hasStudentWork) {
    document.querySelector("#earnedScore").textContent = formatScore(report.earnedScore);
    document.querySelector("#earnedLabel").textContent = "已获得";
    document.querySelector("#earnedScoreSmall").textContent = formatScore(report.earnedScore);
    document.querySelector("#earnedScoreUnit").textContent = "分";
    document.querySelector("#missingLabel").textContent = isFullScore ? "未失分" : "待补充";
    document.querySelector("#missingScore").textContent = formatScore(report.missingScore);
    document.querySelector("#missingScoreUnit").textContent = "分";
  } else {
    document.querySelector("#earnedScore").textContent = "—";
    document.querySelector("#earnedLabel").textContent = "分析模式";
    document.querySelector("#earnedScoreSmall").textContent = "解题指导";
    document.querySelector("#earnedScoreUnit").textContent = "";
    document.querySelector("#missingLabel").textContent = "题目总分";
    document.querySelector("#missingScore").textContent = formatScore(report.totalScore);
    document.querySelector("#missingScoreUnit").textContent = "分";
  }

  const modeText = isFullScore
    ? "六维得分点均已覆盖"
    : report.studentWorkSource === "question_file"
    ? "已检测到题面作答，按六维逐项诊断"
    : report.studentWorkSource === "answer_file"
      ? "已结合答案文件，按六维逐项诊断"
      : "未检测到作答，提供六维解题指导";
  document.querySelector("#analysisMode").textContent = modeText;

  const reviewPrefix = isFullScore
    ? "AI分析完成，全部得分点已覆盖"
    : hasStudentWork
      ? (report.requiresTeacherReview ? "AI评分结果需教师复核" : "AI分析完成，建议教师抽查")
    : "当前为解题指导模式";
  window.AcademicRendering.setText(
    document.querySelector("#reviewNote"),
    report.reviewNote ? `${reviewPrefix} · ${report.reviewNote}` : reviewPrefix,
  );

  scorePointsList.replaceChildren(...report.scorePoints.map((point, index) => (
    renderScorePoint(point, index, resultState)
  )));

  reportPanel.classList.remove("is-loading");
  reportPanel.classList.add("is-updating");
  window.setTimeout(() => reportPanel.classList.remove("is-updating"), 900);
  downloadPdfButton.disabled = false;
  downloadWordButton.disabled = false;
}

async function downloadReport(format, button) {
  if (!currentReport) {
    showToast("请先生成得分点报告", "error");
    return;
  }
  const originalLabel = button.querySelector("span:last-child").textContent;
  button.disabled = true;
  button.classList.add("is-loading");
  button.querySelector("span:last-child").textContent = format === "pdf" ? "生成 PDF" : "生成 Word";
  try {
    if (format === "pdf") await window.ReportExporter.downloadPdf(currentReport);
    else await window.ReportExporter.downloadWord(currentReport);
    showToast(format === "pdf" ? "PDF 报告已下载" : "Word 报告已下载");
  } catch (error) {
    showToast(error.message || "报告生成失败，请重试", "error");
  } finally {
    button.classList.remove("is-loading");
    button.querySelector("span:last-child").textContent = originalLabel;
    button.disabled = false;
  }
}

function setLoading(isLoading) {
  analyzeButton.disabled = isLoading;
  analyzeButton.classList.toggle("is-loading", isLoading);
  reportPanel.classList.toggle("is-loading", isLoading);
  reportPanel.setAttribute("aria-busy", String(isLoading));
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || "请求失败，请稍后重试");
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}

function validateReport(report) {
  const numericFields = ["totalScore", "earnedScore", "missingScore"];
  const hasValidNumbers = numericFields.every((field) => Number.isFinite(Number(report?.[field])));
  const hasValidPoints = Array.isArray(report?.scorePoints)
    && report.scorePoints.length === 6
    && report.scorePoints.every((point) => (
      point
      && typeof point.label === "string"
      && Number.isFinite(Number(point.score))
      && typeof point.status === "string"
      && [point.requirement, point.analysis, point.suggestion]
        .every((text) => typeof text === "string" && text.trim())
    ));

  if (!report || typeof report !== "object" || !hasValidNumbers || !hasValidPoints) {
    const error = new Error("AI 返回的报告内容不完整，请重试；若持续失败请在配置页切换模型");
    error.code = "AI_RESPONSE_INVALID";
    throw error;
  }
  return report;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const questionInput = document.querySelector("#questionFile");
  const totalScore = Number(document.querySelector("#totalScore").value);

  if (!questionInput.files[0]) {
    showToast("请先上传题目资料", "error");
    document.querySelector("#questionZone").focus();
    return;
  }
  if (!Number.isInteger(totalScore) || totalScore < 1 || totalScore > 150) {
    showToast("题目总分必须是 1 到 150 的整数", "error");
    document.querySelector("#totalScore").focus();
    return;
  }

  setLoading(true);
  try {
    const body = new FormData(form);
    const response = await fetch("/api/analyze", { method: "POST", body });
    const report = validateReport(await readJson(response));
    renderReport(report);
    const resultState = resultStateOf(report);
    showToast(resultState === "full_score"
      ? "分析完成，全部得分点已覆盖"
      : resultState === "needs_improvement" ? "六维作答诊断完成" : "六维解题指导已生成");
    if (window.innerWidth <= 800) reportPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    reportPanel.classList.remove("is-loading");
    showToast(error.message, "error");
    if (error.code === "AI_NOT_CONFIGURED") {
      settingsLink.focus();
      settingsLink.title = "请先完成 AI 配置";
    }
  } finally {
    setLoading(false);
  }
});

initUploadZone("questionZone", "questionFile");
initUploadZone("answerZone", "answerFile");

scorePointsList.addEventListener("click", (event) => {
  const summary = event.target.closest(".point-summary");
  if (!summary || !scorePointsList.contains(summary)) return;
  const row = summary.closest(".score-point-row");
  const detail = document.querySelector(`#${summary.getAttribute("aria-controls")}`);
  const willOpen = summary.getAttribute("aria-expanded") !== "true";
  summary.setAttribute("aria-expanded", String(willOpen));
  row.classList.toggle("is-open", willOpen);
  detail.hidden = !willOpen;
});

downloadPdfButton.addEventListener("click", () => downloadReport("pdf", downloadPdfButton));
downloadWordButton.addEventListener("click", () => downloadReport("word", downloadWordButton));

const initialPoints = Array.from(scorePointsList.children).map((row) => ({
  label: row.dataset.initialLabel,
  score: Number(row.dataset.initialScore),
  status: row.dataset.initialStatus,
  evidence: "示例报告未展示学生原文，重新分析后将呈现实际作答依据。",
  ...POINT_GUIDANCE[row.dataset.initialLabel],
}));
scorePointsList.replaceChildren(...initialPoints.map((point, index) => renderScorePoint(point, index, "needs_improvement")));

fetch("/api/health")
  .then(readJson)
  .then((health) => {
    if (!health.configured) settingsLink.title = "AI 尚未配置，点击打开配置页";
  })
  .catch(() => {
    settingsLink.title = "服务状态异常，点击检查 AI 配置";
  });

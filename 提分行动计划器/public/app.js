const defaultReport = {
  generatedAt: "2024-05-20T10:30:00+08:00",
  weakPoints: [
    { name: "立体几何", ratio: 32, severity: "high", reason: "空间关系辨识与证明步骤不稳定。" },
    { name: "函数与导数", ratio: 28, severity: "high", reason: "导数应用与最值问题容易丢步骤分。" },
    { name: "解析几何", ratio: 18, severity: "medium", reason: "联立计算和图形转化效率不足。" },
    { name: "数列", ratio: 12, severity: "low", reason: "通项和求和模型需要巩固。" },
    { name: "概率统计", ratio: 10, severity: "low", reason: "条件概率与统计图表读取需提高准确率。" }
  ],
  weeklyFocus: [
    { week: "第1周", theme: "立体几何基础强化", methods: ["空间想象与建系方法"], goal: "+6-8分" },
    { week: "第2周", theme: "函数与导数综合提升", methods: ["导数应用与最值问题"], goal: "+6-8分" },
    { week: "第3周", theme: "解析几何突破", methods: ["直线与圆、圆锥曲线"], goal: "+5-6分" },
    { week: "第4周", theme: "综合题型训练", methods: ["真题演练与错题巩固"], goal: "+5-6分" }
  ],
  dailyActions: [
    { day: "周一", title: "立体几何基础", tasks: ["空间点线面关系", "基本图形性质", "例题精讲6题", "随堂练习8题"] },
    { day: "周二", title: "空间向量", tasks: ["向量概念运算", "向量法解夹角问题", "例题精讲6题", "随堂练习8题"] },
    { day: "周三", title: "建系与计算", tasks: ["空间直角坐标系", "距离与角度计算", "例题精讲6题", "随堂练习8题"] },
    { day: "周四", title: "综合应用", tasks: ["综合题解题策略", "真题片段训练", "限时训练1套", "错题整理复盘"] },
    { day: "周五", title: "错题复盘", tasks: ["本周错题回顾", "薄弱点再巩固", "强化练习10题", "总结与反思"] }
  ],
  reviewSchedule: [
    { time: "当天回顾", action: "当天错题及时订正", detail: "标注错因并补齐步骤。" },
    { time: "3天后", action: "错题重做巩固记忆", detail: "脱离答案重新完成。" },
    { time: "7天后", action: "变式训练强化理解", detail: "做同类题迁移。" },
    { time: "15天后", action: "综合应用避免再错", detail: "放入套卷检验。" },
    { time: "30天后", action: "定期回顾长期巩固", detail: "回收反复错题。" }
  ],
  checklist: ["今日学习计划已完成", "学习时间达标", "错题已整理并订正", "今日总结与反思已完成"],
  fullReport: {
    executiveSummary: "本报告基于学生上传资料、当前分数与目标分数建立学习诊断模型，重点识别失分集中区、能力短板、可提分路径和执行风险。当前最值得优先处理的是高频失分模块与中档题稳定性。",
    diagnosis: "当前分数说明基础框架已经具备，但综合题拆解、空间想象、导数应用和步骤规范仍是主要失分来源。接下来要把薄弱模块拆成可训练动作，减少重复性失分。",
    scoreStrategy: "30天内优先处理失分占比最高的模块，前两周补基础和中档题，第三周强化压轴题步骤，第四周用真题套卷检验稳定性。",
    dataInsights: [
      { label: "失分集中度", value: "60%", level: "高", interpretation: "前两个薄弱模块贡献主要失分，应优先进入专项训练。" },
      { label: "中档题稳定性", value: "中等", level: "预警", interpretation: "会做但不稳定的题目是短期提分主战场。" },
      { label: "过程分回收空间", value: "8-12分", level: "可回收", interpretation: "规范书写、关键步骤补全可直接提升卷面得分。" },
      { label: "执行可达性", value: "较高", level: "可推进", interpretation: "每天2小时足以支撑专项训练和错题回收闭环。" }
    ],
    dimensionScores: [
      { dimension: "概念掌握", score: 72, max: 100, level: "基础可用", evidence: "核心公式与基本模型基本具备，但迁移场景下不够稳定。", action: "用每日10分钟口述公式、条件和适用边界。" },
      { dimension: "题型识别", score: 64, max: 100, level: "需要强化", evidence: "综合题容易卡在条件转化和模型选择。", action: "按题型建立解题入口清单，先判断再计算。" },
      { dimension: "运算准确", score: 68, max: 100, level: "波动明显", evidence: "联立计算、坐标运算和符号处理容易失分。", action: "每周安排2次限时计算专项，记录错误类型。" },
      { dimension: "步骤表达", score: 58, max: 100, level: "优先修复", evidence: "证明题和解答题过程分回收不足。", action: "对照评分标准重写关键步骤，形成模板化表达。" }
    ],
    lossAttribution: [
      { category: "知识漏洞", ratio: 32, scoreLoss: "约9分", diagnosis: "概念边界和公式条件掌握不完整。", intervention: "用错题反推知识点，建立一页式公式条件卡。" },
      { category: "模型迁移", ratio: 28, scoreLoss: "约8分", diagnosis: "遇到变式题时不能快速定位解题入口。", intervention: "同一题型连续做3道变式，并总结共同结构。" },
      { category: "计算失误", ratio: 22, scoreLoss: "约6分", diagnosis: "化简、代入、符号处理导致非能力性失分。", intervention: "建立草稿规范，关键计算二次验算。" },
      { category: "表达扣分", ratio: 18, scoreLoss: "约5分", diagnosis: "证明和解答步骤缺少必要条件。", intervention: "按评分点补齐因果链和结论句。" }
    ],
    abilityRadar: [
      { ability: "基础题拿分", current: 78, target: 90, comment: "通过限时小题训练稳定送分题。" },
      { ability: "中档题拆解", current: 62, target: 82, comment: "短期提分核心能力。" },
      { ability: "综合题建模", current: 54, target: 72, comment: "先突破第一问和关键转化。" },
      { ability: "卷面规范", current: 58, target: 85, comment: "过程分回收空间大。" }
    ],
    questionTypeMatrix: [
      { type: "选择填空基础题", accuracy: "78%", loss: "约4分", priority: "稳分", strategy: "限时训练，减少低级错误。" },
      { type: "中档解答题", accuracy: "61%", loss: "约12分", priority: "高", strategy: "拆题干、找模型、写步骤。" },
      { type: "综合压轴前两问", accuracy: "38%", loss: "约8分", priority: "中", strategy: "先拿入口分和过程分。" },
      { type: "证明与规范表达", accuracy: "55%", loss: "约6分", priority: "高", strategy: "用评分点模板重写答案。" }
    ],
    dailyRhythm: ["用10分钟复述当天公式和模型", "用70-90分钟完成专项训练", "用20分钟整理错题、写清错因和订正步骤"],
    thirtyDayPlan: [
      { range: "第1-7天", focus: "立体几何基础与空间关系", tasks: ["梳理点线面关系", "完成基础证明题", "建立错题标签"] },
      { range: "第8-14天", focus: "函数与导数核心题型", tasks: ["导数单调性训练", "最值问题拆解", "规范书写步骤"] },
      { range: "第15-21天", focus: "解析几何和综合题突破", tasks: ["训练联立计算", "总结常见模型", "限时完成中档题"] },
      { range: "第22-30天", focus: "真题套卷与稳定输出", tasks: ["每两天一套卷", "回收反复错题", "完成考前清单"] }
    ],
    milestoneChecks: [
      { node: "第7天", standard: "核心公式和基础题型正确率达到85%以上", action: "未达标则延长基础训练2天。" },
      { node: "第15天", standard: "中档题步骤完整度达到80%以上", action: "重点回收过程分。" },
      { node: "第23天", standard: "整卷限时完成率达到95%以上", action: "调整答题顺序和时间分配。" },
      { node: "第30天", standard: "目标模块失分较首测下降50%以上", action: "形成下一阶段计划。" }
    ],
    wrongQuestionMethod: ["先写清楚错因，不只抄答案", "三天后不看解析重做", "七天后做一道同类变式题"],
    riskWarnings: ["只刷题不复盘会导致重复失分", "学习时间被打断会影响连续性", "步骤表达不规范会损失过程分"],
    parentAdvice: ["每周关注完成度和错题回收", "帮助固定学习时间段", "用阶段小目标替代一次性高压目标"]
  }
};

let activeReport = defaultReport;
let uploadedFiles = [];

const els = {
  form: document.querySelector("#plannerForm"),
  uploadZone: document.querySelector("#uploadZone"),
  fileInput: document.querySelector("#fileInput"),
  fileList: document.querySelector("#fileList"),
  generateButton: document.querySelector("#generateButton"),
  statusLine: document.querySelector("#statusLine"),
  generatedAt: document.querySelector("#generatedAt"),
  bannerDays: document.querySelector("#bannerDays"),
  bannerCurrent: document.querySelector("#bannerCurrent"),
  bannerTarget: document.querySelector("#bannerTarget"),
  bannerGap: document.querySelector("#bannerGap"),
  scoreCurrent: document.querySelector("#scoreCurrent"),
  scoreTarget: document.querySelector("#scoreTarget"),
  scoreGap: document.querySelector("#scoreGap"),
  dailyGain: document.querySelector("#dailyGain"),
  progressText: document.querySelector("#progressText"),
  currentMaxHint: document.querySelector("#currentMaxHint"),
  targetMaxHint: document.querySelector("#targetMaxHint"),
  weakList: document.querySelector("#weakList"),
  weakSummary: document.querySelector("#weakSummary"),
  weeklyFocus: document.querySelector("#weeklyFocus"),
  dailyActions: document.querySelector("#dailyActions"),
  reviewSchedule: document.querySelector("#reviewSchedule"),
  checklistItems: document.querySelector("#checklistItems"),
  checklistDone: document.querySelector("#checklistDone"),
  donut: document.querySelector(".donut"),
  donutValue: document.querySelector("#donutValue"),
  openFullReport: document.querySelector("#openFullReport"),
  closeModal: document.querySelector("#closeModal"),
  modalBackdrop: document.querySelector("#modalBackdrop"),
  fullReportContent: document.querySelector("#fullReportContent")
};

renderReport(defaultReport);
bindEvents();

function bindEvents() {
  els.fileInput.addEventListener("change", () => {
    replaceUploadedFiles([...els.fileInput.files]);
    els.fileInput.value = "";
  });

  els.fileList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-file]");
    if (!removeButton) return;
    removeUploadedFile(Number(removeButton.dataset.removeFile));
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.uploadZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.uploadZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.uploadZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.uploadZone.classList.remove("dragging");
    });
  });

  els.uploadZone.addEventListener("drop", (event) => {
    replaceUploadedFiles([...event.dataTransfer.files]);
  });

  els.form.addEventListener("submit", handleSubmit);
  els.openFullReport.addEventListener("click", openFullReport);
  document.querySelector("#downloadReport").addEventListener("click", downloadFullReportPdf);
  els.closeModal.addEventListener("click", closeFullReport);
  els.modalBackdrop.addEventListener("click", (event) => {
    if (event.target === els.modalBackdrop) closeFullReport();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeFullReport();
  });

  document.querySelectorAll("#maxScore,#currentScore,#targetScore,#planDays").forEach((input) => {
    input.addEventListener("input", () => renderScoreHeader());
  });

  els.checklistItems.addEventListener("change", updateChecklistProgress);
}

function replaceUploadedFiles(files) {
  if (!files.length) return;
  uploadedFiles = files;
  renderUploadedFiles();
}

function removeUploadedFile(index) {
  if (!Number.isInteger(index)) return;
  uploadedFiles.splice(index, 1);
  renderUploadedFiles();
}

function renderUploadedFiles() {
  if (!uploadedFiles.length) {
    els.fileList.hidden = true;
    els.fileList.innerHTML = "";
    return;
  }

  els.fileList.innerHTML = uploadedFiles.map((file, index) => {
    const extension = file.name.split(".").pop().toUpperCase();
    return `
      <div class="file-card">
        <div class="file-type">${escapeHtml((extension || "FILE").slice(0, 4))}</div>
        <div class="file-meta">
          <strong>${escapeHtml(file.name)}</strong>
          <span>${formatFileSize(file.size)}</span>
        </div>
        <button class="file-ok" type="button" aria-label="文件已就绪"></button>
        <button class="icon-button" data-remove-file="${index}" type="button" aria-label="移除文件">×</button>
      </div>
    `;
  }).join("");
  els.fileList.hidden = false;
}

async function handleSubmit(event) {
  event.preventDefault();
  const formData = new FormData(els.form);
  formData.delete("file");
  formData.delete("files");
  uploadedFiles.forEach((file) => {
    formData.append("files", file);
  });

  setLoading(true);
  setStatus("正在调用 AI 分析资料并生成提分计划…");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      body: formData
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "生成失败，请稍后重试。");
    }

    activeReport = payload.report;
    renderReport(activeReport);
    setStatus("报告已生成，可点击查看完整报告。");
  } catch (error) {
    setStatus(error.message || "AI分析失败，请检查网络或接口配置。", true);
  } finally {
    setLoading(false);
  }
}

function renderReport(report) {
  renderScoreHeader();
  renderGeneratedAt(report.generatedAt);
  renderWeakPoints(report.weakPoints);
  renderWeeklyFocus(report.weeklyFocus);
  renderDailyActions(report.dailyActions);
  renderReviewSchedule(report.reviewSchedule);
  renderChecklist(report.checklist);
  renderFullReport(report.fullReport);
}

function renderScoreHeader() {
  const maxScore = Math.max(1, toNumber(document.querySelector("#maxScore").value, 150));
  const currentScoreInput = document.querySelector("#currentScore");
  const targetScoreInput = document.querySelector("#targetScore");
  const currentScore = Math.min(maxScore, Math.max(0, toNumber(currentScoreInput.value, 92)));
  const targetScore = Math.min(maxScore, Math.max(0, toNumber(targetScoreInput.value, 120)));
  const planDays = Math.max(1, toNumber(document.querySelector("#planDays").value, 30));
  const gap = Math.max(0, targetScore - currentScore);
  const dailyGain = gap / planDays;

  currentScoreInput.max = maxScore;
  targetScoreInput.max = maxScore;
  if (toNumber(currentScoreInput.value, 0) !== currentScore) {
    currentScoreInput.value = currentScore;
  }
  if (toNumber(targetScoreInput.value, 0) !== targetScore) {
    targetScoreInput.value = targetScore;
  }
  els.currentMaxHint.textContent = `（满分 ${maxScore} 分）`;
  els.targetMaxHint.textContent = `（满分 ${maxScore} 分）`;

  els.bannerDays.textContent = planDays;
  els.bannerCurrent.textContent = currentScore;
  els.bannerTarget.textContent = targetScore;
  els.bannerGap.textContent = gap;
  els.scoreCurrent.textContent = currentScore;
  els.scoreTarget.textContent = targetScore;
  els.scoreGap.textContent = gap;
  els.dailyGain.textContent = dailyGain.toFixed(2);
  els.progressText.textContent = `已完成 0 天 / ${planDays} 天`;
}

function renderGeneratedAt(value) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  els.generatedAt.textContent = `报告生成时间： ${formatDate(safeDate)}`;
}

function renderWeakPoints(items) {
  const rows = normalizeArray(items).slice(0, 5);
  els.weakList.innerHTML = rows.map((item, index) => {
    const severity = item.severity || (index < 2 ? "high" : index === 2 ? "medium" : "low");
    return `
      <div class="weak-row" title="${escapeHtml(item.reason || "")}">
        <span class="weak-index">${index + 1}</span>
        <span class="weak-name">${escapeHtml(item.name || "薄弱点")}</span>
        <span class="bar ${severity}">
          <span style="width:${Math.max(4, Number(item.ratio) || 0)}%"></span>
        </span>
        <span>${Math.round(Number(item.ratio) || 0)}%</span>
      </div>
    `;
  }).join("");

  const topNames = rows.slice(0, 2).map((item) => item.name).join("和");
  const lostScore = Math.round(rows.reduce((sum, item) => sum + (Number(item.ratio) || 0), 0) * 0.58);
  els.weakSummary.textContent = `共失分 ${lostScore || 58} 分，主要集中在${topNames || "核心薄弱模块"}`;
}

function renderWeeklyFocus(items) {
  els.weeklyFocus.innerHTML = normalizeArray(items).slice(0, 4).map((item, index) => {
    const method = Array.isArray(item.methods) ? item.methods[0] : "";
    return `
      <div class="week-item">
        <strong>${escapeHtml(item.week || `第${index + 1}周`)}</strong>
        <span>${escapeHtml(item.theme || "专项提升")} ${method ? `｜ ${escapeHtml(method)}` : ""}</span>
        <em>目标：${escapeHtml(item.goal || "+5-6分")}</em>
      </div>
    `;
  }).join("");
}

function renderDailyActions(items) {
  els.dailyActions.innerHTML = normalizeArray(items).slice(0, 5).map((item) => {
    const tasks = normalizeArray(item.tasks).slice(0, 4);
    return `
      <div class="day-column">
        <h4>${escapeHtml(item.day || "今日")}　${escapeHtml(item.title || "专项训练")}</h4>
        <div class="task-list">
          ${tasks.map((task) => `
            <label>
              <input type="checkbox" />
              <span>${escapeHtml(task)}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderReviewSchedule(items) {
  els.reviewSchedule.innerHTML = normalizeArray(items).slice(0, 5).map((item) => `
    <div class="review-step" title="${escapeHtml(item.detail || "")}">
      <strong>${escapeHtml(item.time || "复盘")}</strong>
      <span>${escapeHtml(item.action || "错题复盘")}</span>
    </div>
  `).join("");
}

function renderChecklist(items) {
  els.checklistItems.innerHTML = normalizeArray(items).slice(0, 4).map((item) => `
    <label class="check-item">
      <input type="checkbox" />
      <span>${escapeHtml(item)}</span>
    </label>
  `).join("");
  updateChecklistProgress();
}

function updateChecklistProgress() {
  const boxes = [...els.checklistItems.querySelectorAll("input")];
  const checked = boxes.filter((box) => box.checked).length;
  const total = boxes.length || 4;
  const percent = Math.round((checked / total) * 100);
  els.donut.style.background = `conic-gradient(var(--green) ${percent * 3.6}deg, #e2e2e2 0deg)`;
  els.donutValue.textContent = `${percent}%`;
  els.checklistDone.textContent = `完成 ${checked} / ${total} 项`;
}

function renderFullReport(report) {
  const data = report || defaultReport.fullReport;
  const score = getScoreSnapshot();
  const dataInsights = normalizeArray(data.dataInsights).length
    ? data.dataInsights
    : defaultReport.fullReport.dataInsights;
  const dimensionScores = normalizeArray(data.dimensionScores).length
    ? data.dimensionScores
    : defaultReport.fullReport.dimensionScores;
  const lossAttribution = normalizeArray(data.lossAttribution).length
    ? data.lossAttribution
    : defaultReport.fullReport.lossAttribution;
  const abilityRadar = normalizeArray(data.abilityRadar).length
    ? data.abilityRadar
    : defaultReport.fullReport.abilityRadar;
  const questionTypeMatrix = normalizeArray(data.questionTypeMatrix).length
    ? data.questionTypeMatrix
    : defaultReport.fullReport.questionTypeMatrix;
  const milestoneChecks = normalizeArray(data.milestoneChecks).length
    ? data.milestoneChecks
    : defaultReport.fullReport.milestoneChecks;

  els.fullReportContent.innerHTML = `
    <div class="professional-report">
      <section class="report-cover">
        <div>
          <span>Professional Learning Analytics</span>
          <h2>提分行动计划详情报告</h2>
          <p>${escapeHtml(data.executiveSummary || data.diagnosis || "")}</p>
        </div>
        <div class="report-kpis">
          ${renderMetricTile("当前得分率", `${score.currentRate}%`, `${score.currentScore}/${score.maxScore}`)}
          ${renderMetricTile("目标得分率", `${score.targetRate}%`, `${score.targetScore}/${score.maxScore}`)}
          ${renderMetricTile("目标分差", `${score.gap}分`, `${score.planDays}天周期`)}
          ${renderMetricTile("日均提升", `${score.dailyGain}分`, "按线性目标测算")}
        </div>
      </section>

      <section class="pro-section narrative">
        <div class="section-label">01 / 综合判断</div>
        <h3>学习现状诊断与提分主线</h3>
        <p>${escapeHtml(data.diagnosis || "")}</p>
        <p>${escapeHtml(data.scoreStrategy || "")}</p>
      </section>

      <section class="pro-section">
        <div class="section-label">02 / 数据洞察</div>
        <h3>关键数据结论</h3>
        <div class="insight-grid">
          ${dataInsights.map((item) => `
            <article class="insight-card">
              <span>${escapeHtml(item.level || "洞察")}</span>
              <strong>${escapeHtml(item.value || "")}</strong>
              <h4>${escapeHtml(item.label || "")}</h4>
              <p>${escapeHtml(item.interpretation || "")}</p>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="pro-section">
        <div class="section-label">03 / 能力模型</div>
        <h3>四维能力评分</h3>
        <div class="dimension-grid">
          ${dimensionScores.map((item) => {
            const scoreValue = clampDisplayNumber(item.score, 0, item.max || 100, 60);
            const maxValue = clampDisplayNumber(item.max, 1, 1000, 100);
            const width = Math.round((scoreValue / maxValue) * 100);
            return `
              <article class="dimension-card">
                <div>
                  <strong>${escapeHtml(item.dimension || "能力维度")}</strong>
                  <span>${escapeHtml(item.level || "待提升")}</span>
                </div>
                <div class="dimension-score">${scoreValue}<small>/${maxValue}</small></div>
                <div class="dimension-track"><i style="width:${width}%"></i></div>
                <p>${escapeHtml(item.evidence || "")}</p>
                <em>${escapeHtml(item.action || "")}</em>
              </article>
            `;
          }).join("")}
        </div>
      </section>

      <section class="pro-section">
        <div class="section-label">04 / 失分归因</div>
        <h3>失分贡献度与干预策略</h3>
        <div class="loss-list">
          ${lossAttribution.map((item) => `
            <article class="loss-item">
              <div class="loss-ratio">${escapeHtml(item.ratio || 0)}%</div>
              <div>
                <h4>${escapeHtml(item.category || "失分类型")} <span>${escapeHtml(item.scoreLoss || "")}</span></h4>
                <p>${escapeHtml(item.diagnosis || "")}</p>
                <em>${escapeHtml(item.intervention || "")}</em>
              </div>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="pro-section">
        <div class="section-label">05 / 题型矩阵</div>
        <h3>题型表现与优先级</h3>
        <div class="matrix-grid">
          <div>题型</div><div>正确率</div><div>失分</div><div>优先级</div><div>策略</div>
          ${questionTypeMatrix.map((item) => `
            <div>${escapeHtml(item.type || "")}</div>
            <div>${escapeHtml(item.accuracy || "")}</div>
            <div>${escapeHtml(item.loss || "")}</div>
            <div><span class="priority-pill">${escapeHtml(item.priority || "中")}</span></div>
            <div>${escapeHtml(item.strategy || "")}</div>
          `).join("")}
        </div>
      </section>

      <section class="pro-section">
        <div class="section-label">06 / 能力差距</div>
        <h3>当前能力与目标能力差距</h3>
        <div class="radar-list">
          ${abilityRadar.map((item) => {
            const current = clampDisplayNumber(item.current, 0, 100, 50);
            const target = clampDisplayNumber(item.target, current, 100, 80);
            return `
              <article class="radar-row">
                <strong>${escapeHtml(item.ability || "能力项")}</strong>
                <div class="radar-track">
                  <span style="width:${target}%"></span>
                  <i style="width:${current}%"></i>
                </div>
                <em>${current} → ${target}</em>
                <p>${escapeHtml(item.comment || "")}</p>
              </article>
            `;
          }).join("")}
        </div>
      </section>

      <section class="pro-section">
        <div class="section-label">07 / 30天路径</div>
        <h3>阶段化执行路线</h3>
        <div class="stage-grid">
          ${normalizeArray(data.thirtyDayPlan).map((item) => `
            <article class="stage-card">
              <span>${escapeHtml(item.range || "阶段")}</span>
              <h4>${escapeHtml(item.focus || "")}</h4>
              <ul>${normalizeArray(item.tasks).map((task) => `<li>${escapeHtml(task)}</li>`).join("")}</ul>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="pro-section">
        <div class="section-label">08 / 验收机制</div>
        <h3>阶段验收与纠偏标准</h3>
        <div class="milestone-list">
          ${milestoneChecks.map((item) => `
            <article>
              <strong>${escapeHtml(item.node || "节点")}</strong>
              <p>${escapeHtml(item.standard || "")}</p>
              <em>${escapeHtml(item.action || "")}</em>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="pro-section action-pack">
        <div>
          <div class="section-label">09 / 执行系统</div>
          <h3>每日节奏与错题闭环</h3>
          <ul>${normalizeArray(data.dailyRhythm).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <ul>${normalizeArray(data.wrongQuestionMethod).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
        <div>
          <div class="section-label">10 / 风险控制</div>
          <h3>风险提醒与家长协同</h3>
          <ul>${normalizeArray(data.riskWarnings).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <ul>${normalizeArray(data.parentAdvice).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      </section>
    </div>
  `;
}

function getScoreSnapshot() {
  const maxScore = Math.max(1, toNumber(document.querySelector("#maxScore").value, 150));
  const currentScore = Math.min(maxScore, Math.max(0, toNumber(document.querySelector("#currentScore").value, 92)));
  const targetScore = Math.min(maxScore, Math.max(0, toNumber(document.querySelector("#targetScore").value, 120)));
  const planDays = Math.max(1, toNumber(document.querySelector("#planDays").value, 30));
  const gap = Math.max(0, targetScore - currentScore);
  return {
    maxScore,
    currentScore,
    targetScore,
    planDays,
    gap,
    currentRate: ((currentScore / maxScore) * 100).toFixed(1),
    targetRate: ((targetScore / maxScore) * 100).toFixed(1),
    dailyGain: (gap / planDays).toFixed(2)
  };
}

function renderMetricTile(label, value, note) {
  return `
    <article class="metric-tile">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <em>${escapeHtml(note)}</em>
    </article>
  `;
}

function openFullReport() {
  renderFullReport(activeReport.fullReport);
  els.modalBackdrop.hidden = false;
  document.body.style.overflow = "hidden";
}

async function downloadFullReportPdf() {
  renderFullReport(activeReport.fullReport);
  const button = document.querySelector("#downloadReport");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在生成PDF…";

  try {
    const response = await fetch("/api/report-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "XX天提分行动计划详情报告",
        html: els.fullReportContent.innerHTML,
        generatedAt: new Date().toISOString()
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || "PDF生成失败，请稍后重试。");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `提分行动计划详情报告-${formatDateForFilename(new Date())}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    setStatus(error.message || "PDF下载失败，请稍后重试。", true);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function closeFullReport() {
  els.modalBackdrop.hidden = true;
  document.body.style.overflow = "";
}

function setLoading(isLoading) {
  els.generateButton.disabled = isLoading;
  els.generateButton.querySelector("strong").textContent = isLoading ? "AI正在分析中…" : "生成提分行动计划";
}

function setStatus(message, isError = false) {
  els.statusLine.textContent = message;
  els.statusLine.classList.toggle("error", isError);
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "0KB";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function formatDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateForFilename(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampDisplayNumber(value, min, max, fallback) {
  const number = toNumber(value, fallback);
  return Math.min(max, Math.max(min, number));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

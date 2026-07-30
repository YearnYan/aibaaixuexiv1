const defaultReport = {
  grade: "初中八年级",
  subject: "数学",
  topic: "二元一次方程组的应用（行程问题）",
  recognizedType: "二元一次方程组的应用（行程问题）",
  difficulty: "中档难度",
  tags: ["高频考点", "中档难度"],
  features: "已知路程、速度、时间等量的关系，设未知数列方程组求解。",
  commonMethods: ["相遇问题", "追及问题", "环形路问题", "流水行船问题"],
  knowledge: [
    { title: "等量关系", detail: "路程 = 速度 × 时间；相遇时路程和；追及时路程差。" },
    { title: "设未知数", detail: "通常设速度或时间为未知数，注意单位统一。" },
    { title: "列方程组", detail: "根据题意列出两个相等关系，构成二元一次方程组。" },
    { title: "解与检验", detail: "解方程组求出未知数，带入原题检验并答题。" }
  ],
  tip: "行程问题的核心是找准等量关系，根据运动过程选择合适的等量关系列方程。",
  solutionSteps: [
    { title: "审题建模", detail: "抓住关键词（相遇、追及、同时、往返等），画线段图梳理数量关系。", tone: "blue" },
    { title: "列方程组", detail: "设未知数，根据等量关系列出二元一次方程组。", tone: "green" },
    { title: "求解并检验", detail: "解方程组得到结果，检验是否符合题意，写出答案。", tone: "orange" }
  ],
  mistakes: [
    { title: "等量关系错误", detail: "忽略同时、相遇、追及等关键词，导致等量关系不正确。" },
    { title: "单位不统一", detail: "速度单位（千米/时、米/分等）不统一，导致计算错误。" },
    { title: "方程组列错", detail: "方程组中系数或常数项错误，或只列一个方程。" },
    { title: "检验缺失", detail: "未检验结果是否符合题意，导致答案错误。" }
  ],
  practice: [
    {
      title: "题目 1（基础巩固）",
      body: "甲、乙两人从相距 18 千米的两地同时出发，相向而行，甲的速度是 5 千米/时，乙的速度是 4 千米/时。两人出发后多少小时相遇？",
      answer: "设 x 小时后相遇，则 5x+4x=18，解得 x=2，所以 2 小时后相遇。"
    },
    {
      title: "题目 2（能力提升）",
      body: "甲、乙两人从 A、B 两地同时出发，同向而行，甲的速度是 6 千米/时，乙的速度是 4 千米/时，甲在乙后 20 分钟追上乙。A、B 两地相距多少千米？",
      answer: "20 分钟为 1/3 小时，追及路程差为 (6-4)×1/3=2/3 千米。"
    }
  ],
  checklist: [
    { item: "关键条件是否抓全（时间、速度、路程等）", score: 25 },
    { item: "等量关系是否正确", score: 25 },
    { item: "方程组是否正确", score: 25 },
    { item: "计算过程是否正确", score: 15 },
    { item: "结果是否检验并符合题意", score: 10 }
  ],
  mastery: 70,
  nextSuggestions: [
    { title: "基础巩固", detail: "建议完成 8 道基础题，巩固等量关系与方程组建立。", count: "8题" },
    { title: "能力提升", detail: "建议完成 6 道提升题，训练多条件行程问题建模能力。", count: "6题" },
    { title: "拓展挑战", detail: "建议完成 4 道拓展题，提升综合应用与变式能力。", count: "4题" }
  ]
};

const icons = {
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8l4-4m0 0v4m0-4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 20h18L12 4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5m0 3h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h.01M11 9h5M8 14h.01M11 14h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12.2 11 14.7 20 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6.5 6.5 0 0 0-3.8 11.8c.5.4.8.9.8 1.5V17h6v-.7c0-.6.3-1.1.8-1.5A6.5 6.5 0 0 0 12 3Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 20h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.3-5 9-5 9 5 9 5-3.3 5-9 5-9-5-9-5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
};

const form = document.querySelector("#analysisForm");
const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const fileList = document.querySelector("#fileList");
const generateBtn = document.querySelector("#generateBtn");
const exportBtn = document.querySelector("#exportBtn");
const regenBtn = document.querySelector("#regenBtn");
const exampleBtn = document.querySelector("#exampleBtn");
const statusBar = document.querySelector("#statusBar");
const statusText = document.querySelector("#statusText");
const reportRoot = document.querySelector("#reportRoot");
const toast = document.querySelector("#toast");

let selectedFiles = [];
let lastGeneratedAt = "2025-05-24 14:32";

renderReport(defaultReport, lastGeneratedAt);
bindEvents();

function bindEvents() {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitGenerate();
  });

  fileInput.addEventListener("change", () => {
    selectedFiles = Array.from(fileInput.files || []);
    renderFileList();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragover");
    });
  });

  dropZone.addEventListener("drop", (event) => {
    selectedFiles = Array.from(event.dataTransfer.files || []);
    renderFileList();
  });

  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  exportBtn.addEventListener("click", () => window.print());
  regenBtn.addEventListener("click", () => submitGenerate(true));
  exampleBtn.addEventListener("click", () => {
    renderReport(defaultReport, "2025-05-24 14:32");
    showToast("已载入示例报告");
  });
}

async function submitGenerate(isRegen = false) {
  if (!form.reportValidity()) return;

  const data = new FormData(form);
  const topic = String(data.get("topic") || "").trim();
  if (!topic && !selectedFiles.length) {
    showToast("请上传题目文件，或填写题型名称。");
    return;
  }

  data.delete("files");
  selectedFiles.forEach((file) => data.append("files", file));

  setLoading(true, isRegen ? "AI 正在重新生成报告..." : "AI 正在分析题目资料...");

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      body: data
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "生成失败，请稍后重试。");
    }

    lastGeneratedAt = payload.generatedAt || currentMinute();
    renderReport(payload.report, lastGeneratedAt);
    showToast("题型提分报告已生成");
  } catch (error) {
    showToast(error.message || "生成失败，请稍后重试。");
  } finally {
    setLoading(false);
  }
}

function setLoading(loading, text = "") {
  generateBtn.disabled = loading;
  regenBtn.disabled = loading;
  statusBar.hidden = !loading;
  statusText.textContent = text || "AI 正在分析题目资料...";
  generateBtn.querySelector("span").textContent = loading ? "AI 分析中..." : "生成题型提分卡";
}

function renderFileList() {
  if (!selectedFiles.length) {
    fileList.hidden = true;
    fileList.innerHTML = "";
    return;
  }

  fileList.hidden = false;
  fileList.innerHTML = selectedFiles
    .slice(0, 4)
    .map((file) => {
      const ext = getExt(file.name);
      return `
        <div class="file-row">
          <div class="file-badge">${escapeHtml(ext)}</div>
          <div>
            <div class="file-name">${escapeHtml(file.name)}</div>
            <div class="file-size">${formatFileSize(file.size)}</div>
          </div>
          <div class="file-ok">✓</div>
        </div>
      `;
    })
    .join("");
}

function renderReport(report, generatedAt) {
  const safe = mergeReport(report);
  const mastery = clamp(Number(safe.mastery) || 70, 0, 100);

  reportRoot.classList.remove("rendering");
  reportRoot.innerHTML = `
    <div class="meta-strip">
      <span><strong>年级：</strong>${escapeHtml(safe.grade)}</span>
      <span class="meta-divider"></span>
      <span><strong>科目：</strong>${escapeHtml(safe.subject)}</span>
      <span class="meta-divider"></span>
      <span><strong>题型：</strong>${escapeHtml(safe.recognizedType)}</span>
      <span class="meta-time">生成时间：${escapeHtml(generatedAt || currentMinute())}</span>
    </div>

    <div class="report-grid">
      <section class="report-card identify-card">
        ${sectionTitle(1, "题型识别")}
        <div class="inner-box">
          <div class="identify-result">
            <div class="target-icon">${icons.target}</div>
            <div>
              <div class="label-small">识别结果</div>
              <div class="recognized-type">${escapeHtml(safe.recognizedType)}</div>
              <div class="tags">
                ${safe.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
              </div>
            </div>
          </div>
          <div class="mini-title">题型特征</div>
          <p class="body-copy">${escapeHtml(safe.features)}</p>
          <div class="mini-title">常见考查方式</div>
          <div class="method-row">
            ${safe.commonMethods.map((item) => `<span class="method">${escapeHtml(item)}</span>`).join("")}
          </div>
        </div>
      </section>

      <section class="report-card wide">
        ${sectionTitle(2, "考点拆解")}
        <div class="knowledge-layout">
          <div class="knowledge-list">
            ${safe.knowledge.map((item, index) => knowledgeItem(item, index)).join("")}
          </div>
          <div class="tip-box">
            <div class="tip-heading">${icons.bulb}<span>考点提示</span></div>
            <p>${escapeHtml(safe.tip)}</p>
          </div>
        </div>
      </section>

      <section class="report-card">
        ${sectionTitle(3, "三步解题法")}
        <div class="inner-box steps-box">
          ${safe.solutionSteps.map((item, index) => stepItem(item, index)).join("")}
        </div>
      </section>

      <section class="report-card">
        ${sectionTitle(4, "易错提醒")}
        <div class="inner-box mistake-list">
          ${safe.mistakes.map((item) => mistakeItem(item)).join("")}
        </div>
      </section>

      <section class="report-card practice-card">
        <div class="practice-top">
          ${sectionTitle(5, "跟练题", "建议用时：12分钟")}
        </div>
        <div class="inner-box">
          ${safe.practice.map((item) => practiceItem(item)).join("")}
        </div>
      </section>

      <section class="report-card check-card">
        ${sectionTitle(6, "评分 / 检查清单", "学生自查")}
        ${checkTable(safe.checklist)}
      </section>

      <section class="report-card next-card">
        ${sectionTitle(7, "下一步练习建议")}
        <div class="next-inner">
          <div class="mastery-row">
            <span>建议掌握程度</span>
            <div class="progress" aria-label="掌握程度 ${mastery}%">
              <div class="progress-fill" style="--value:${mastery}%"></div>
            </div>
            <span>${mastery}%</span>
          </div>
          <div class="suggestion-grid">
            ${safe.nextSuggestions.map((item) => suggestionItem(item)).join("")}
          </div>
          <div class="next-footnote">完成练习后，可重新生成提分卡，查看进步情况。</div>
        </div>
      </section>
    </div>
  `;
  requestAnimationFrame(() => reportRoot.classList.add("rendering"));
}

function sectionTitle(num, title, extra = "") {
  return `
    <div class="section-title">
      <span class="num">${num}</span>
      <h3>${escapeHtml(title)}</h3>
      ${extra ? `<span class="section-extra">${escapeHtml(extra)}</span>` : ""}
    </div>
  `;
}

function knowledgeItem(item, index) {
  const iconList = [icons.sun, icons.alert, icons.list, icons.check];
  return `
    <div class="knowledge-item">
      <div class="knowledge-icon">${iconList[index % iconList.length]}</div>
      <div>
        <p class="knowledge-title">${escapeHtml(item.title)}</p>
        <p class="knowledge-detail">${escapeHtml(item.detail)}</p>
      </div>
    </div>
  `;
}

function stepItem(item, index) {
  const tone = ["blue", "green", "orange"].includes(item.tone) ? item.tone : ["blue", "green", "orange"][index % 3];
  return `
    <div class="step-row">
      <div class="step-num ${tone}">${index + 1}</div>
      <div class="step-arrow">${index === 2 ? "" : "↓"}</div>
      <div class="step-content">
        <p class="step-title ${tone}">${escapeHtml(item.title)}</p>
        <p class="step-detail">${escapeHtml(item.detail)}</p>
      </div>
    </div>
  `;
}

function mistakeItem(item) {
  return `
    <div class="mistake-item">
      <div class="warn-icon">${icons.alert}</div>
      <div>
        <p class="mistake-title">${escapeHtml(item.title)}</p>
        <p class="mistake-detail">${escapeHtml(item.detail)}</p>
      </div>
    </div>
  `;
}

function practiceItem(item) {
  return `
    <div class="practice-item">
      <p class="practice-title">${escapeHtml(item.title).replace(/（(.+?)）/g, "<span>（$1）</span>")}</p>
      <p class="practice-body">${escapeHtml(item.body)}</p>
      ${
        item.answer
          ? `<details class="answer-details">
              <summary>${icons.eye} 查看参考答案与解析</summary>
              <p class="answer-text">${escapeHtml(item.answer)}</p>
            </details>`
          : ""
      }
    </div>
  `;
}

function checkTable(items) {
  const rows = items
    .map(
      (item, index) => `
      <tr>
        <td>${index + 1}. ${escapeHtml(item.item)}</td>
        <td><span class="check-box"></span></td>
        <td>/${Number(item.score) || 0}</td>
      </tr>
    `
    )
    .join("");

  return `
    <table class="check-table">
      <thead>
        <tr><th>检查项</th><th>自查</th><th>得分</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><th>合计</th><th></th><th><span class="total-score">/100</span></th></tr>
      </tfoot>
    </table>
  `;
}

function suggestionItem(item) {
  return `
    <div class="suggestion">
      <h4>${escapeHtml(item.title)}</h4>
      <p>${escapeHtml(item.detail)}</p>
      <button class="practice-link" type="button">去练习（${escapeHtml(item.count)}）</button>
    </div>
  `;
}

function mergeReport(report) {
  const merged = {
    ...defaultReport,
    ...(report || {})
  };

  merged.tags = nonEmptyArray(merged.tags, defaultReport.tags);
  if (!merged.tags.includes(merged.difficulty)) {
    merged.tags = [merged.tags[0], merged.difficulty].filter(Boolean).slice(0, 3);
  }

  merged.commonMethods = nonEmptyArray(merged.commonMethods, defaultReport.commonMethods);
  merged.knowledge = nonEmptyArray(merged.knowledge, defaultReport.knowledge);
  merged.solutionSteps = nonEmptyArray(merged.solutionSteps, defaultReport.solutionSteps);
  merged.mistakes = nonEmptyArray(merged.mistakes, defaultReport.mistakes);
  merged.practice = nonEmptyArray(merged.practice, defaultReport.practice);
  merged.checklist = nonEmptyArray(merged.checklist, defaultReport.checklist);
  merged.nextSuggestions = nonEmptyArray(merged.nextSuggestions, defaultReport.nextSuggestions);

  return merged;
}

function nonEmptyArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

function formatFileSize(size) {
  if (!Number.isFinite(size)) return "";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / 1024 / 1024).toFixed(2)}MB`;
}

function getExt(name) {
  const match = String(name || "").match(/\.([^.]+)$/);
  return match ? match[1].slice(0, 4).toUpperCase() : "FILE";
}

function currentMinute() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let toastTimer = null;
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

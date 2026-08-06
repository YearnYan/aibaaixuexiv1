const sampleReport = {
  summary: {
    subject: "数学",
    grade: "初二",
    examType: "期中考试",
    generatedAt: "2024-05-20 14:32",
    overallDiagnosis: "知识漏洞和方法迁移是本次丢分主因，计算表达与审题需要同步纠偏。",
    scoreEstimate: "暂无",
    totalLossRate: 0
  },
  dimensions: [
    {
      name: "知识丢分",
      percentage: 32,
      severity: "严重",
      priorityAdvice: "优先处理",
      analysis: "函数图像、性质理解和几何证明条件掌握不够稳定。",
      actionItems: ["回补一次函数图像性质", "整理几何证明条件清单"]
    },
    {
      name: "方法丢分",
      percentage: 20,
      severity: "较重",
      priorityAdvice: "优先处理",
      analysis: "遇到综合题时题型识别慢，解法选择不够准确。",
      actionItems: ["建立题型识别卡", "用同类题训练方法迁移"]
    },
    {
      name: "审题丢分",
      percentage: 18,
      severity: "中等",
      priorityAdvice: "及时处理",
      analysis: "关键条件圈画不足，容易漏读限定词。",
      actionItems: ["做题前圈出条件", "交卷前复查单位和范围"]
    },
    {
      name: "计算/表达丢分",
      percentage: 20,
      severity: "较重",
      priorityAdvice: "优先处理",
      analysis: "步骤跳跃和符号顺序错误造成不必要扣分。",
      actionItems: ["统一草稿纸分区", "保留关键推导步骤"]
    },
    {
      name: "习惯丢分",
      percentage: 10,
      severity: "较轻",
      priorityAdvice: "持续优化",
      analysis: "订正记录不够系统，错题复现率偏高。",
      actionItems: ["每日错题归因", "每周回做旧错题"]
    }
  ],
  topLossPoints: [
    {
      rank: 1,
      point: "一次函数图像与性质理解不准确",
      questions: "第15题(1)",
      category: "知识丢分",
      percentage: 12,
      severity: "严重",
      priorityAdvice: "优先处理",
      cause: "核心概念混淆",
      correctionPlan: "用图像变化题做专项训练"
    },
    {
      rank: 2,
      point: "二次函数最值问题方法选择错误",
      questions: "第21题",
      category: "方法丢分",
      percentage: 8,
      severity: "较重",
      priorityAdvice: "优先处理",
      cause: "建模路径不清",
      correctionPlan: "整理最值问题三类模型"
    },
    {
      rank: 3,
      point: "几何证明题条件理解不完整",
      questions: "第18题(2)",
      category: "审题丢分",
      percentage: 7,
      severity: "较重",
      priorityAdvice: "优先处理",
      cause: "隐含条件漏用",
      correctionPlan: "训练条件到结论的映射"
    },
    {
      rank: 4,
      point: "计算过程出错（符号、运算顺序）",
      questions: "第6题，第13题",
      category: "计算/表达丢分",
      percentage: 6,
      severity: "中等",
      priorityAdvice: "及时处理",
      cause: "过程书写跳步",
      correctionPlan: "固定二次检查动作"
    },
    {
      rank: 5,
      point: "单位填写不规范，答案未化简",
      questions: "第9题，第20题",
      category: "习惯丢分",
      percentage: 4,
      severity: "较轻",
      priorityAdvice: "持续优化",
      cause: "收尾检查不足",
      correctionPlan: "建立答案格式核对表"
    }
  ],
  details: {
    overall: {
      conclusion: "本次丢分呈现“知识基础不稳、方法迁移不足、过程规范偏弱”的组合特征。优先回补高频知识点，再通过同类题训练把方法固化下来。",
      strengths: ["基础题完成度尚可", "能识别部分常规题型", "具备继续提升的题感基础"],
      risks: ["综合题遇到变式容易失分", "计算过程扣分会持续拉低总分", "错题复盘如果只改答案，短期容易反复"]
    },
    analyticsSummary: {
      reportLevel: "B级重点干预",
      evidenceCount: 12,
      dominantLossType: "知识-方法复合型失分",
      estimatedRecoverableScore: "8-12分",
      urgentIndex: 82,
      stabilityIndex: 58,
      dataConclusion: "本次资料呈现高价值题集中失分、低价值习惯项可控的结构。优先处理函数、几何证明和计算表达，预计短期可追回一批无谓扣分。"
    },
    dataQuality: {
      completeness: 76,
      readability: 84,
      evidenceStrength: 78,
      crossValidation: "试卷题号、失分点和维度占比之间可以相互印证；缺少原始总分和逐题扣分细则，因此提分空间以区间估算呈现。",
      limitations: ["缺少老师批改细则", "缺少班级均分和年级排名", "缺少学生完整答题过程照片"]
    },
    lossAttribution: [
      {
        factor: "核心概念边界不清",
        weight: 32,
        evidence: "一次函数图像与性质、几何证明条件理解不完整",
        interpretation: "属于高复现风险失分，后续综合题会反复出现。"
      },
      {
        factor: "题型识别和方法迁移不足",
        weight: 24,
        evidence: "二次函数最值问题方法选择错误",
        interpretation: "会做基础题，但遇到变式时路径选择不稳定。"
      },
      {
        factor: "过程表达与计算规范不足",
        weight: 22,
        evidence: "符号、运算顺序、答案化简出现扣分",
        interpretation: "短期最容易追回，但需要固定检查动作。"
      },
      {
        factor: "审题条件提取不足",
        weight: 14,
        evidence: "几何证明题隐含条件未完整使用",
        interpretation: "影响证明题和应用题的启动速度。"
      }
    ],
    priorityMatrix: [
      {
        item: "函数图像与性质回补",
        impact: 92,
        urgency: 88,
        difficulty: 62,
        quadrant: "高影响高紧急",
        action: "先用图像-解析式-性质三列表回补，再做变式题。"
      },
      {
        item: "计算表达规范化",
        impact: 78,
        urgency: 76,
        difficulty: 35,
        quadrant: "高影响低难度",
        action: "建立草稿分区、关键步骤保留和二次复核。"
      },
      {
        item: "几何证明条件链",
        impact: 84,
        urgency: 70,
        difficulty: 68,
        quadrant: "中高影响中高难度",
        action: "训练条件到结论的证明链表达。"
      }
    ],
    abilityBenchmarks: [
      {
        ability: "知识调用准确度",
        current: 61,
        target: 82,
        gapReason: "概念和图像性质对应关系不稳",
        evidence: "第15题(1)、第18题(2)"
      },
      {
        ability: "题型迁移能力",
        current: 56,
        target: 78,
        gapReason: "综合题方法选择依赖直觉，缺少模型化判断",
        evidence: "第21题"
      },
      {
        ability: "计算表达稳定性",
        current: 64,
        target: 86,
        gapReason: "跳步、符号顺序和单位检查不足",
        evidence: "第6题、第13题、第9题"
      }
    ],
    evidenceMatrix: [
      {
        source: "第15题(1)",
        observed: "函数图像与性质判断不准确",
        inference: "核心知识边界不清，变式题易失分",
        confidence: "高"
      },
      {
        source: "第21题",
        observed: "最值问题方法选择错误",
        inference: "题型识别和方法迁移链路不足",
        confidence: "高"
      },
      {
        source: "第6题、第13题",
        observed: "符号和运算顺序错误",
        inference: "计算表达规范尚未固化",
        confidence: "中"
      }
    ],
    learningProfile: {
      summary: "学生不是单纯粗心型失分，而是“概念理解不够牢 + 综合题方法选择不稳定 + 过程规范不足”叠加导致。",
      abilityLevel: "中等基础，有提分空间但稳定性不足",
      keySignals: ["基础题失分较少，说明底层学习意愿和常规能力存在", "综合题和函数题失分集中，说明迁移能力需要专项训练", "计算表达扣分占比偏高，说明答题流程还没有固化"],
      evidence: ["第15题、第21题、第18题属于高价值失分题", "计算/表达丢分占比达到20%", "习惯丢分占比相对较低，可作为辅助优化项"]
    },
    rootCauseChain: [
      {
        phenomenon: "函数和几何综合题扣分明显",
        cause: "概念边界不清，遇到变式时无法快速匹配方法",
        evidence: "第15题(1)、第21题、第18题(2)",
        impact: "后续压轴题和综合应用题稳定性会偏弱"
      },
      {
        phenomenon: "计算过程符号和顺序错误",
        cause: "步骤书写跳跃，缺少固定复核动作",
        evidence: "第6题、第13题",
        impact: "即使会做，也容易丢掉可避免分"
      }
    ],
    questionTypeDiagnosis: [
      {
        type: "函数图像与性质",
        performance: "概念知道但应用不稳",
        weakPoint: "图像变化和性质对应关系不清",
        sampleQuestions: "第15题(1)",
        intervention: "用图像、解析式、性质三列表做专项复盘"
      },
      {
        type: "几何证明",
        performance: "条件提取不完整",
        weakPoint: "隐含条件没有转化为证明步骤",
        sampleQuestions: "第18题(2)",
        intervention: "训练条件到结论的证明链"
      }
    ],
    knowledgeMap: [
      {
        module: "一次函数",
        mastery: "薄弱",
        evidence: "图像性质理解不准确",
        nextAction: "回补图像、斜率、截距和增减性"
      },
      {
        module: "计算表达",
        mastery: "不稳定",
        evidence: "符号和运算顺序扣分",
        nextAction: "建立草稿分区和二次复核"
      }
    ],
    knowledge: {
      summary: "知识点需要从概念、图像、条件三个层面重新打通。",
      items: ["按章节列出高频扣分概念", "用例题反推知识点边界", "每次订正补一句错误原因"]
    },
    methods: {
      summary: "方法问题集中在题型识别和解法迁移。",
      items: ["整理函数最值、几何证明、方程应用三类方法卡", "每类题至少完成 5 道变式"]
    },
    review: {
      summary: "审题要从读题习惯变成固定流程。",
      items: ["第一遍读条件，第二遍圈目标", "对范围、单位、是否化简做交卷前检查"]
    },
    calculation: {
      summary: "计算表达需要降低无谓失分。",
      items: ["草稿纸按题号分区", "关键步骤不省略", "每道计算题至少回代或估算一次"]
    },
    habit: {
      summary: "习惯维度目前不是最大问题，但会影响修正效率。",
      items: ["错题按原因归档", "每周固定回做旧错题", "用红笔标出真正的失分动作"]
    },
    practicePlan: {
      within7Days: ["完成一次函数和几何证明专题回补", "整理本卷 TOP5 错题并重做", "每天 15 分钟计算规范训练"],
      within30Days: ["建立三类高频题型方法卡", "每周完成一套错因复盘", "用限时训练修正审题节奏"],
      parentTeacherTips: ["家长关注错因分类，不只看分数", "老师可优先安排函数图像和证明题面批", "下次测试重点观察计算表达扣分是否下降"]
    },
    scoreRecoveryPath: {
      immediate: ["先修正计算符号、单位、答案化简等无谓失分", "把 TOP5 错题按错因重做一遍"],
      shortTerm: ["2到4周集中突破函数和几何证明", "每周用一套限时小卷观察错因是否下降"],
      mediumTerm: ["建立题型方法卡和错题复盘档案", "训练综合题的条件提取和解题路径选择"]
    },
    teacherFollowUp: {
      focus: ["函数图像性质和几何证明条件转化", "计算表达规范和解题步骤完整性"],
      homeworkDesign: ["每次只布置一类高频错因题", "同一题型做基础、变式、综合三层练习"],
      checkMethod: ["检查错因说明是否具体", "观察同类题二次正确率"]
    },
    riskForecast: [
      {
        risk: "综合题继续波动",
        probability: "高",
        trigger: "函数、几何题换一种问法或条件隐藏",
        prevention: "每周做 2 组变式题并写出题型识别依据"
      },
      {
        risk: "会做题仍被过程扣分",
        probability: "中高",
        trigger: "限时训练或草稿混乱",
        prevention: "固定草稿分区和交卷前 3 项复核"
      }
    ],
    remediationROI: [
      {
        action: "计算表达规范训练",
        expectedGain: "2-4分",
        effort: "每天15分钟",
        priority: "P0",
        reason: "投入低、见效快，是短期最容易追回的无谓扣分。"
      },
      {
        action: "函数图像性质专题",
        expectedGain: "3-5分",
        effort: "连续7天专项",
        priority: "P0",
        reason: "关联多个高频题型，是当前主导失分源。"
      },
      {
        action: "几何证明条件链训练",
        expectedGain: "2-3分",
        effort: "每周3次",
        priority: "P1",
        reason: "难度中等，但对综合题稳定性提升明显。"
      }
    ],
    reviewIndicators: {
      nextExamSignals: ["函数和几何相关题扣分是否下降", "计算过程扣分是否控制在 5% 内", "同类题二次正确率是否超过 80%"],
      weeklyCheckpoints: ["错题是否能说清具体错因", "是否完成一类题型三层训练", "是否保留关键推导步骤"],
      stopDoing: ["只抄正确答案不写错因", "一次性刷大量混杂题", "把所有错误都归因为粗心"]
    },
    confidence: {
      level: "中",
      basis: "基于示例试卷结构和失分点分布生成，适合展示报告样式。",
      missingEvidence: ["真实答题痕迹", "原始分数和班级均分", "老师批改细则"]
    }
  }
};

const elements = {
  form: document.querySelector("#diagnosis-form"),
  fileInput: document.querySelector("#file-input"),
  uploadBox: document.querySelector("#upload-box"),
  fileList: document.querySelector("#file-list"),
  note: document.querySelector("#note"),
  noteCount: document.querySelector("#note-count"),
  submitButton: document.querySelector("#submit-button"),
  statusMessage: document.querySelector("#status-message"),
  metaSubject: document.querySelector("#meta-subject"),
  metaGrade: document.querySelector("#meta-grade"),
  metaType: document.querySelector("#meta-type"),
  metaTime: document.querySelector("#meta-time"),
  radarCanvas: document.querySelector("#radar-canvas"),
  dimensionList: document.querySelector("#dimension-list"),
  lossTable: document.querySelector("#loss-table"),
  toggleReport: document.querySelector("#toggle-report"),
  fullReport: document.querySelector("#full-report"),
  downloadPdf: document.querySelector("#download-pdf"),
  downloadWord: document.querySelector("#download-word"),
  overallConclusion: document.querySelector("#overall-conclusion"),
  strengthList: document.querySelector("#strength-list"),
  riskList: document.querySelector("#risk-list"),
  detailGroups: document.querySelector("#detail-groups"),
  professionalSections: document.querySelector("#professional-sections"),
  plan7: document.querySelector("#plan-7"),
  plan30: document.querySelector("#plan-30"),
  planFamily: document.querySelector("#plan-family")
};

let selectedFiles = [];
let currentReport = sampleReport;

renderReport(sampleReport);
bindEvents();
applyInitialViewMode();

function bindEvents() {
  elements.note.addEventListener("input", () => {
    elements.noteCount.textContent = String(elements.note.value.length);
  });

  elements.fileInput.addEventListener("change", () => {
    const files = Array.from(elements.fileInput.files || []);
    addSelectedFiles(files);
  });

  elements.uploadBox.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.uploadBox.classList.add("dragging");
  });

  elements.uploadBox.addEventListener("dragleave", () => {
    elements.uploadBox.classList.remove("dragging");
  });

  elements.uploadBox.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.uploadBox.classList.remove("dragging");
    const files = Array.from(event.dataTransfer.files || []);
    addSelectedFiles(files);
  });

  elements.form.addEventListener("submit", handleSubmit);

  elements.toggleReport.addEventListener("click", () => {
    const willShow = elements.fullReport.hidden;
    setFullReportVisible(willShow);
  });

  elements.downloadPdf.addEventListener("click", () => downloadReport("pdf"));
  elements.downloadWord.addEventListener("click", () => downloadReport("word"));
}

function applyInitialViewMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "full") {
    setFullReportVisible(true);
  }
}

function setFullReportVisible(visible) {
  elements.fullReport.hidden = !visible;
  elements.toggleReport.querySelector("span").textContent = visible ? "收起完整报告" : "查看完整报告";
}

async function downloadReport(format) {
  if (!currentReport || !elements.downloadPdf || !elements.downloadWord) return;
  const reportShell = document.querySelector(".report-shell");
  if (!reportShell) return;

  const previousHidden = elements.fullReport.hidden;
  const previousActionDisplay = document.querySelector(".report-action")?.style.display || "";
  const button = format === "pdf" ? elements.downloadPdf : elements.downloadWord;
  let exportCopy = null;
  try {
    await ensureAuthenticated();
    if (format === "pdf" && (!window.html2canvas || !window.jspdf?.jsPDF)) {
      throw new Error("PDF 组件未加载，请刷新页面后重试。");
    }
    button.disabled = true;
    await document.fonts?.ready;
    exportCopy = createExportCopy(reportShell);

    if (format === "pdf") {
      const canvas = await window.html2canvas(exportCopy.shell, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageHeight = canvas.height * pageWidth / canvas.width;
      const image = canvas.toDataURL("image/jpeg", 0.95);
      let offset = 0;
      while (offset < imageHeight) {
        if (offset > 0) pdf.addPage();
        pdf.addImage(image, "JPEG", 0, -offset, pageWidth, imageHeight, undefined, "FAST");
        offset += pageHeight;
      }
      pdf.save(`AI丢分诊断完整报告-${currentReport.summary?.subject || "学科"}.pdf`);
      showStatus("完整 PDF 报告已下载。");
      return;
    }

    const clone = exportCopy.shell;
    clone.querySelectorAll("canvas").forEach((canvas) => {
      const image = document.createElement("img");
      image.src = canvas.toDataURL("image/png");
      image.alt = "五类丢分维度雷达图";
      image.style.cssText = "display:block;width:100%;height:auto;";
      canvas.replaceWith(image);
    });
    const styles = await getInlineStyles();
    const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>AI丢分诊断完整报告</title>${styles}<style>${getExportCss()}</style></head><body>${clone.outerHTML}</body></html>`;
    const blob = new Blob(["\ufeff", doc], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `AI丢分诊断完整报告-${currentReport.summary?.subject || "学科"}.doc`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showStatus("完整 Word 报告已下载。");
  } catch (error) {
    showStatus(error.message || "报告下载失败，请重试。", true);
  } finally {
    elements.fullReport.hidden = previousHidden;
    const action = document.querySelector(".report-action");
    if (action) action.style.display = previousActionDisplay;
    exportCopy?.host.remove();
    button.disabled = false;
  }
}

async function getInlineStyles() {
  const nodes = Array.from(document.querySelectorAll("link[rel=stylesheet], style"));
  const chunks = await Promise.all(nodes.map(async (node) => {
    if (node.tagName === "STYLE") return node.textContent || "";
    const href = node.href;
    try {
      const response = await fetch(href, { credentials: "same-origin", cache: "no-store" });
      return response.ok ? await response.text() : "";
    } catch {
      return "";
    }
  }));
  return chunks.filter(Boolean).map((css) => `<style>${css}</style>`).join("\n");
}

async function ensureAuthenticated() {
  const response = await fetch("/api/auth/me", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.authenticated) {
    throw new Error("请先登录后再下载报告。");
  }
  return data.user;
}

function createExportCopy(source) {
  const host = document.createElement("div");
  host.className = "report-export-host";
  host.style.cssText = "position:absolute;left:-100000px;top:0;width:794px;min-height:1px;overflow:visible;background:#fff;";
  const style = document.createElement("style");
  style.textContent = getExportCss();
  const shell = source.cloneNode(true);
  shell.classList.add("report-export-copy");
  shell.querySelector("#full-report")?.removeAttribute("hidden");
  shell.querySelector(".report-action")?.remove();
  shell.querySelector(".status-message")?.remove();
  shell.querySelectorAll(".scan-corner").forEach((node) => node.remove());
  source.querySelectorAll("canvas").forEach((canvas, index) => {
    const target = shell.querySelectorAll("canvas")[index];
    const context = target?.getContext("2d");
    if (context) context.drawImage(canvas, 0, 0);
  });
  host.append(style, shell);
  document.body.appendChild(host);
  return { host, shell };
}

function getExportCss() {
  return `
    .report-export-host { color: #07142d; }
    .report-export-copy *,
    .report-export-copy *::before,
    .report-export-copy *::after {
      animation: none !important;
      transition: none !important;
      opacity: 1 !important;
      filter: none !important;
    }
    .report-export-copy { width: 794px !important; max-width: none !important; min-height: 0 !important; height: auto !important; overflow: visible !important; padding: 18px !important; border: 1px solid #b9d3fb !important; border-radius: 0 !important; box-shadow: none !important; background: #fff !important; }
    .report-export-copy .report-grid { grid-template-columns: 300px minmax(0, 1fr) !important; gap: 12px !important; }
    .report-export-copy #radar-canvas { width: 100% !important; max-width: none !important; height: auto !important; }
    .report-export-copy .dimension-head,
    .report-export-copy .dimension-row { grid-template-columns: minmax(0, .9fr) minmax(0, 1.15fr) minmax(0, .82fr) minmax(0, .9fr) !important; column-gap: 6px !important; padding-left: 6px !important; padding-right: 6px !important; min-width: 0 !important; overflow: hidden !important; }
    .report-export-copy .dimension-card,
    .report-export-copy .dimension-name,
    .report-export-copy .severity,
    .report-export-copy .priority { min-width: 0 !important; overflow-wrap: anywhere !important; word-break: break-word !important; }
    .report-export-copy .percent-wrap { grid-template-columns: 42px minmax(0, 1fr) !important; gap: 5px !important; }
    .report-export-copy .percent-value { font-size: 18px !important; }
    .report-export-copy .table-scroll { overflow: visible !important; }
    .report-export-copy .table-scroll table { width: 100% !important; min-width: 0 !important; table-layout: fixed !important; }
    .report-export-copy .table-scroll th,
    .report-export-copy .table-scroll td { padding: 6px 4px !important; font-size: 10px !important; line-height: 1.35 !important; word-break: break-word !important; white-space: normal !important; }
    .report-export-copy .full-report { margin-top: 14px !important; animation: none !important; opacity: 1 !important; transform: none !important; }
    .report-export-copy .full-report-grid { gap: 10px !important; }
    .report-export-copy .full-report article { padding: 12px 14px !important; border-radius: 8px !important; }
    .report-export-copy .full-report p,
    .report-export-copy .full-report ul { font-size: 12px !important; line-height: 1.55 !important; }
    .report-export-copy .professional-sections { gap: 10px !important; }
  `;
}

function addSelectedFiles(files) {
  const validFiles = [];
  const rejected = [];

  files.forEach((file) => {
    const validationError = validateClientFile(file);
    if (validationError) {
      rejected.push(`${file.name}：${validationError}`);
      return;
    }

    const exists = selectedFiles.some((item) => {
      return item.name === file.name && item.size === file.size && item.lastModified === file.lastModified;
    });

    if (!exists) {
      validFiles.push(file);
    }
  });

  selectedFiles = selectedFiles.concat(validFiles);
  elements.fileInput.value = "";
  renderFileList();

  if (rejected.length) {
    showStatus(rejected.join("；"), true);
  } else if (validFiles.length) {
    showStatus(`已添加 ${validFiles.length} 个文件，共 ${selectedFiles.length} 个文件。`);
  }
}

function validateClientFile(file) {
  if (!/\.(pdf|doc|docx|png|jpe?g)$/i.test(file.name)) {
    return "暂时只支持 PDF、Word、PNG、JPG";
  }

  if (file.size > 50 * 1024 * 1024) {
    return "单个文件不能超过 50MB";
  }

  return "";
}

function renderFileList() {
  if (!selectedFiles.length) {
    elements.fileList.innerHTML = "";
    return;
  }

  elements.fileList.innerHTML = `
    <div class="file-summary">已选择 ${selectedFiles.length} 个文件</div>
    ${selectedFiles.map((file, index) => `
      <div class="file-item">
        <span class="file-badge">${getFileBadge(file.name)}</span>
        <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="file-size">${formatFileSize(file.size)}</span>
        <button class="file-remove" type="button" data-index="${index}" aria-label="移除文件">×</button>
      </div>
    `).join("")}
  `;

  elements.fileList.querySelectorAll(".file-remove").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(button.dataset.index);
      selectedFiles.splice(index, 1);
      renderFileList();
      showStatus(selectedFiles.length ? `已选择 ${selectedFiles.length} 个文件。` : "");
    });
  });
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!selectedFiles.length) {
    showStatus("请先上传至少 1 个试卷、作业或错题图片后再生成诊断", true);
    return;
  }

  const formData = new FormData(elements.form);
  formData.set("grade", document.querySelector("#grade").value);
  formData.set("subject", document.querySelector("#subject").value);
  formData.set("examType", document.querySelector("#exam-type").value);
  formData.set("note", elements.note.value.trim());
  formData.delete("files");
  selectedFiles.forEach((file) => {
    formData.append("files", file);
  });

  setLoading(true);
  showStatus("AI 正在读取资料并生成诊断报告，请稍候...");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "诊断失败，请稍后重试");
    }

    currentReport = data;
    renderReport(data);
    showStatus("诊断完成，报告已更新。");
  } catch (error) {
    showStatus(error.message || "AI 诊断失败，请稍后重试", true);
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  elements.submitButton.disabled = isLoading;
  elements.submitButton.querySelector("span").textContent = isLoading ? "AI诊断中..." : "生成丢分诊断";
}

function showStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("error", Boolean(isError));
}

function renderReport(report) {
  elements.metaSubject.textContent = report.summary.subject;
  elements.metaGrade.textContent = report.summary.grade;
  elements.metaType.textContent = report.summary.examType;
  elements.metaTime.textContent = report.summary.generatedAt;

  renderDimensions(report.dimensions);
  renderRadar(report.dimensions);
  renderTopLossPoints(report.topLossPoints);
  renderFullReport(report);
}

function renderDimensions(dimensions) {
  elements.dimensionList.innerHTML = dimensions.map((item) => {
    const severityClass = getSeverityClass(item.severity);
    const priorityClass = getPriorityClass(item.priorityAdvice);
    return `
      <div class="dimension-row">
        <div class="dimension-name">${escapeHtml(item.name)}</div>
        <div class="percent-wrap">
          <span class="percent-value">${item.percentage}%</span>
          <span class="bar"><span style="width: ${Math.max(4, item.percentage)}%"></span></span>
        </div>
        <span class="severity ${severityClass}">${escapeHtml(item.severity)}</span>
        <span class="priority ${priorityClass}">${escapeHtml(item.priorityAdvice)}</span>
      </div>
    `;
  }).join("");
}

function renderTopLossPoints(points) {
  elements.lossTable.innerHTML = points.map((item, index) => {
    const severityClass = getSeverityClass(item.severity);
    const priorityClass = getPriorityClass(item.priorityAdvice);
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.point)}</td>
        <td>${escapeHtml(item.questions)}</td>
        <td>${escapeHtml(item.category)}</td>
        <td>${item.percentage}%</td>
        <td><span class="severity ${severityClass}">${escapeHtml(item.severity)}</span></td>
        <td><span class="priority ${priorityClass}">${escapeHtml(item.priorityAdvice)}</span></td>
      </tr>
    `;
  }).join("");
}

function renderFullReport(report) {
  const details = report.details;
  elements.overallConclusion.textContent = details.overall.conclusion || report.summary.overallDiagnosis;
  renderList(elements.strengthList, details.overall.strengths, ["已具备基础学习能力"]);
  renderList(elements.riskList, details.overall.risks, ["需要继续观察高频错因"]);

  const groups = [
    ["知识掌握", details.knowledge],
    ["方法迁移", details.methods],
    ["审题表达", details.review],
    ["计算过程", details.calculation],
    ["学习习惯", details.habit]
  ];

  elements.detailGroups.innerHTML = groups.map(([title, group]) => `
    <div class="detail-group">
      <h4>${title}</h4>
      <p>${escapeHtml(group.summary)}</p>
      <ul>${toListHtml(group.items, ["结合错题进行专项复盘"])}</ul>
    </div>
  `).join("");

  renderProfessionalSections(details);
  renderList(elements.plan7, mergeLists(details.practicePlan.within7Days, details.scoreRecoveryPath.immediate), ["完成本次错题订正"]);
  renderList(elements.plan30, mergeLists(details.practicePlan.within30Days, details.scoreRecoveryPath.shortTerm), ["建立错题复盘节奏"]);
  renderList(elements.planFamily, details.practicePlan.parentTeacherTips, ["围绕错因沟通后续学习安排"]);
}

function renderProfessionalSections(details) {
  const profile = details.learningProfile || {};
  const confidence = details.confidence || {};
  const analytics = details.analyticsSummary || {};
  const dataQuality = details.dataQuality || {};
  elements.professionalSections.innerHTML = [
    renderProfessionalBlock("数据诊断总览", `
      <div class="executive-brief">
        <div>
          <span class="report-stamp">Score Loss Intelligence</span>
          <h4>${escapeHtml(analytics.reportLevel || "重点干预")}</h4>
          <p>${escapeHtml(analytics.dataConclusion || "AI 将基于上传资料生成数据化总判断。")}</p>
        </div>
        <div class="brief-index">
          <span>紧急指数</span>
          <strong>${asPercent(analytics.urgentIndex)}</strong>
        </div>
      </div>
      ${renderMetricStrip([
        ["证据样本", analytics.evidenceCount || 0, "项"],
        ["主导失分", analytics.dominantLossType || "待识别", ""],
        ["可追回", analytics.estimatedRecoverableScore || "待估算", ""],
        ["稳定指数", asPercent(analytics.stabilityIndex), ""]
      ])}
    `, "span-2 premium"),
    renderProfessionalBlock("资料可信度评估", `
      ${renderQualityGauge("完整度", dataQuality.completeness)}
      ${renderQualityGauge("可读性", dataQuality.readability)}
      ${renderQualityGauge("证据强度", dataQuality.evidenceStrength)}
      <p>${escapeHtml(dataQuality.crossValidation || "上传资料后将生成多文件交叉验证结论。")}</p>
      ${renderMiniList("资料限制", dataQuality.limitations, ["建议补充原始分数、批改细则和完整答题痕迹"])}
    `),
    renderProfessionalBlock("失分归因权重", renderAttributionBars(details.lossAttribution), "analysis-panel"),
    renderProfessionalBlock("优先级矩阵", renderPriorityCards(details.priorityMatrix), "analysis-panel"),
    renderProfessionalBlock("能力基准差距", renderBenchmarkRows(details.abilityBenchmarks), "analysis-panel"),
    renderProfessionalBlock("证据链矩阵", renderEvidenceMatrix(details.evidenceMatrix), "span-2"),
    renderProfessionalBlock("学情画像", `
      <p>${escapeHtml(profile.summary || "等待 AI 基于资料生成学情画像。")}</p>
      <div class="insight-badge">能力层级：${escapeHtml(profile.abilityLevel || "待判断")}</div>
      ${renderMiniList("关键表现信号", profile.keySignals, ["待结合资料补充"])}
      ${renderMiniList("判断证据", profile.evidence, ["待结合资料补充"])}
    `),
    renderProfessionalBlock("根因链路", renderObjectRows(details.rootCauseChain, [
      ["现象", "phenomenon"],
      ["深层原因", "cause"],
      ["证据", "evidence"],
      ["影响", "impact"]
    ], "AI 将根据多个文件交叉识别表层失分和深层原因。")),
    renderProfessionalBlock("题型突破口", renderObjectRows(details.questionTypeDiagnosis, [
      ["题型", "type"],
      ["表现", "performance"],
      ["薄弱点", "weakPoint"],
      ["证据", "sampleQuestions"],
      ["干预", "intervention"]
    ], "上传资料后会输出题型级突破建议。")),
    renderProfessionalBlock("知识模块热区", renderObjectRows(details.knowledgeMap, [
      ["模块", "module"],
      ["掌握度", "mastery"],
      ["证据", "evidence"],
      ["下一步", "nextAction"]
    ], "上传资料后会输出知识模块掌握热区。")),
    renderProfessionalBlock("提分路径", `
      ${renderMiniList("立刻减少扣分", details.scoreRecoveryPath && details.scoreRecoveryPath.immediate, ["先修正无谓扣分动作"])}
      ${renderMiniList("2到4周", details.scoreRecoveryPath && details.scoreRecoveryPath.shortTerm, ["围绕高频题型做专项训练"])}
      ${renderMiniList("1到2个月", details.scoreRecoveryPath && details.scoreRecoveryPath.mediumTerm, ["建立错题和方法迁移体系"])}
    `),
    renderProfessionalBlock("老师跟进", `
      ${renderMiniList("跟进重点", details.teacherFollowUp && details.teacherFollowUp.focus, ["优先处理高占比失分维度"])}
      ${renderMiniList("练习设计", details.teacherFollowUp && details.teacherFollowUp.homeworkDesign, ["用同类变式巩固方法"])}
      ${renderMiniList("反馈方式", details.teacherFollowUp && details.teacherFollowUp.checkMethod, ["检查二次正确率和错因说明"])}
    `),
    renderProfessionalBlock("风险预测", renderForecastCards(details.riskForecast), "analysis-panel"),
    renderProfessionalBlock("补救ROI排序", renderRoiCards(details.remediationROI), "analysis-panel"),
    renderProfessionalBlock("复测观察指标", renderIndicatorColumns(details.reviewIndicators), "span-2"),
    renderProfessionalBlock("诊断可信度", `
      <div class="insight-badge">可信度：${escapeHtml(confidence.level || "中")}</div>
      <p>${escapeHtml(confidence.basis || "基于本次上传资料生成。")}</p>
      ${renderMiniList("仍建议补充", confidence.missingEvidence, ["原始答题痕迹、老师批注或近期成绩"])}
    `)
  ].join("");
}

function renderMetricStrip(items) {
  return `
    <div class="metric-strip">
      ${items.map(([label, value, unit]) => `
        <div class="metric-cell">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}${unit ? `<em>${escapeHtml(unit)}</em>` : ""}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderQualityGauge(label, value) {
  const score = clampVisualNumber(value);
  return `
    <div class="quality-gauge">
      <span>${escapeHtml(label)}</span>
      <div class="gauge-track"><i style="width:${score}%"></i></div>
      <strong>${score}</strong>
    </div>
  `;
}

function renderAttributionBars(list) {
  if (!Array.isArray(list) || !list.length) {
    return "<p>AI 将根据上传资料生成失分归因权重。</p>";
  }

  return `
    <div class="attribution-list">
      ${list.map((item) => `
        <div class="attribution-item">
          <div class="attribution-head">
            <strong>${escapeHtml(item.factor)}</strong>
            <span>${clampVisualNumber(item.weight)}%</span>
          </div>
          <div class="weight-bar"><i style="width:${clampVisualNumber(item.weight)}%"></i></div>
          <p>${escapeHtml(item.interpretation || item.evidence || "待补充解释")}</p>
          <small>${escapeHtml(item.evidence || "证据待补充")}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderPriorityCards(list) {
  if (!Array.isArray(list) || !list.length) {
    return "<p>AI 将根据影响、紧急度和难度生成处理优先级。</p>";
  }

  return `
    <div class="priority-matrix">
      ${list.map((item) => `
        <div class="priority-card">
          <div class="matrix-score">
            <b>${clampVisualNumber(item.impact)}</b>
            <span>影响</span>
          </div>
          <div>
            <h5>${escapeHtml(item.item)}</h5>
            <p>${escapeHtml(item.action)}</p>
            <div class="mini-metrics">
              <span>紧急 ${clampVisualNumber(item.urgency)}</span>
              <span>难度 ${clampVisualNumber(item.difficulty)}</span>
              <span>${escapeHtml(item.quadrant)}</span>
            </div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderBenchmarkRows(list) {
  if (!Array.isArray(list) || !list.length) {
    return "<p>AI 将生成能力当前值、目标值和差距原因。</p>";
  }

  return `
    <div class="benchmark-list">
      ${list.map((item) => {
        const current = clampVisualNumber(item.current);
        const target = clampVisualNumber(item.target);
        return `
          <div class="benchmark-row">
            <div class="benchmark-title">
              <strong>${escapeHtml(item.ability)}</strong>
              <span>${current}/${target}</span>
            </div>
            <div class="benchmark-track">
              <i class="target" style="left:${target}%"></i>
              <b style="width:${current}%"></b>
            </div>
            <p>${escapeHtml(item.gapReason)} · ${escapeHtml(item.evidence)}</p>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderEvidenceMatrix(list) {
  if (!Array.isArray(list) || !list.length) {
    return "<p>上传文件后会输出证据来源、观察现象、分析推断和置信度。</p>";
  }

  return `
    <div class="evidence-matrix">
      <div class="evidence-matrix-head">
        <span>证据来源</span><span>观察现象</span><span>分析推断</span><span>置信度</span>
      </div>
      ${list.map((item) => `
        <div class="evidence-matrix-row">
          <strong>${escapeHtml(item.source)}</strong>
          <span>${escapeHtml(item.observed)}</span>
          <span>${escapeHtml(item.inference)}</span>
          <b>${escapeHtml(item.confidence || "中")}</b>
        </div>
      `).join("")}
    </div>
  `;
}

function renderForecastCards(list) {
  if (!Array.isArray(list) || !list.length) {
    return "<p>AI 将预测下次考试中最可能复现的风险。</p>";
  }

  return `
    <div class="forecast-list">
      ${list.map((item) => `
        <div class="forecast-card">
          <span class="risk-tag">${escapeHtml(item.probability || "中")}</span>
          <h5>${escapeHtml(item.risk)}</h5>
          <p><strong>触发：</strong>${escapeHtml(item.trigger)}</p>
          <p><strong>预防：</strong>${escapeHtml(item.prevention)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function renderRoiCards(list) {
  if (!Array.isArray(list) || !list.length) {
    return "<p>AI 将按投入产出比排序补救动作。</p>";
  }

  return `
    <div class="roi-list">
      ${list.map((item) => `
        <div class="roi-card">
          <div>
            <span>${escapeHtml(item.priority || "P1")}</span>
            <strong>${escapeHtml(item.expectedGain || "待估算")}</strong>
          </div>
          <h5>${escapeHtml(item.action)}</h5>
          <p>${escapeHtml(item.reason)}</p>
          <small>投入：${escapeHtml(item.effort || "待估算")}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderIndicatorColumns(indicators = {}) {
  return `
    <div class="indicator-columns">
      ${renderMiniList("下次考试信号", indicators.nextExamSignals, ["观察高频错因是否下降"])}
      ${renderMiniList("每周检查点", indicators.weeklyCheckpoints, ["检查错题复盘是否具体"])}
      ${renderMiniList("停止低效动作", indicators.stopDoing, ["停止只抄答案不复盘"])}
    </div>
  `;
}

function clampVisualNumber(value) {
  const number = Number(String(value || 0).replace("%", ""));
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function asPercent(value) {
  return `${clampVisualNumber(value)}%`;
}

function renderProfessionalBlock(title, content, variant = "") {
  return `
    <section class="professional-block ${variant}">
      <h4>${escapeHtml(title)}</h4>
      ${content}
    </section>
  `;
}

function renderObjectRows(list, fields, fallback) {
  if (!Array.isArray(list) || !list.length) {
    return `<p>${escapeHtml(fallback)}</p>`;
  }

  return `
    <div class="evidence-rows">
      ${list.map((item) => `
        <div class="evidence-row">
          ${fields.map(([label, key]) => `
            <p><strong>${escapeHtml(label)}</strong><span>${escapeHtml(item[key] || "待补充")}</span></p>
          `).join("")}
        </div>
      `).join("")}
    </div>
  `;
}

function renderMiniList(title, list, fallback) {
  return `
    <div class="mini-list">
      <h5>${escapeHtml(title)}</h5>
      <ul>${toListHtml(list, fallback)}</ul>
    </div>
  `;
}

function mergeLists(first, second) {
  return []
    .concat(Array.isArray(first) ? first : [])
    .concat(Array.isArray(second) ? second : [])
    .filter(Boolean)
    .slice(0, 8);
}

function renderList(target, list, fallback) {
  target.innerHTML = toListHtml(list, fallback);
}

function toListHtml(list, fallback) {
  const source = Array.isArray(list) && list.length ? list : fallback;
  return source.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderRadar(dimensions) {
  const canvas = elements.radarCanvas;
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = 330;
  const cssHeight = 310;

  canvas.width = cssWidth * ratio;
  canvas.height = cssHeight * ratio;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const center = { x: cssWidth / 2, y: 158 };
  const radius = 94;
  const count = dimensions.length;
  const maxValue = Math.max(40, ...dimensions.map((item) => item.percentage));
  const angles = dimensions.map((_, index) => -Math.PI / 2 + index * Math.PI * 2 / count);

  context.lineWidth = 1;
  context.strokeStyle = "#c8d9ef";
  context.fillStyle = "rgba(237, 246, 255, 0.38)";

  for (let ring = 1; ring <= 4; ring += 1) {
    const ringRadius = radius * ring / 4;
    context.beginPath();
    angles.forEach((angle, index) => {
      const point = polar(center, ringRadius, angle);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.fill();
    context.stroke();
  }

  angles.forEach((angle) => {
    const edge = polar(center, radius, angle);
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(edge.x, edge.y);
    context.stroke();
  });

  const dataPoints = dimensions.map((item, index) => {
    const valueRadius = radius * Math.max(0.08, item.percentage / maxValue);
    return polar(center, valueRadius, angles[index]);
  });

  context.beginPath();
  dataPoints.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.fillStyle = "rgba(18, 105, 232, 0.18)";
  context.strokeStyle = "#0e68e9";
  context.lineWidth = 2;
  context.fill();
  context.stroke();

  dataPoints.forEach((point) => {
    context.beginPath();
    context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fillStyle = "#106be9";
    context.fill();
    context.strokeStyle = "#004fc3";
    context.stroke();
  });

  context.font = "700 13px Microsoft YaHei, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";

  dimensions.forEach((item, index) => {
    const labelPoint = polar(center, radius + 38, angles[index]);
    const lines = splitDimensionName(item.name);
    context.fillStyle = "#111827";
    context.fillText(lines[0], labelPoint.x, labelPoint.y - 8);
    if (lines[1]) context.fillText(lines[1], labelPoint.x, labelPoint.y + 8);
    context.fillStyle = "#005fe7";
    context.font = "800 15px Microsoft YaHei, sans-serif";
    context.fillText(`${item.percentage}%`, labelPoint.x, labelPoint.y + (lines[1] ? 26 : 12));
    context.font = "700 13px Microsoft YaHei, sans-serif";
  });
}

function polar(center, radius, angle) {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius
  };
}

function splitDimensionName(name) {
  if (name === "计算/表达丢分") return ["计算/表达丢分", ""];
  return [name, ""];
}

function getSeverityClass(severity) {
  if (severity === "严重") return "severe";
  if (severity === "较重") return "heavy";
  if (severity === "中等") return "medium";
  return "light";
}

function getPriorityClass(priority) {
  if (priority === "优先处理") return "urgent";
  if (priority === "及时处理") return "normal";
  return "soft";
}

function getFileBadge(filename) {
  const ext = filename.split(".").pop().toUpperCase();
  if (ext === "JPEG") return "JPG";
  return ext.slice(0, 4);
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "未知";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.addEventListener("resize", () => {
  renderRadar(currentReport.dimensions);
});

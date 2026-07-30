const defaultReport = {
  grade: '初二',
  subject: '数学',
  maxScore: 100,
  currentScore: 68,
  targetScore: 85,
  gap: 17,
  testDate: '2024-05-20',
  levelLabel: '中等偏下',
  levelDescription: '已掌握基础知识点的60%-70%，具备提升空间。通过针对性补强与方法优化，有望实现稳步提分。',
  gapTitle: '目标差距说明',
  gapDescription: '距离目标还有 17 分差距，主要集中在中档题与综合应用能力上。',
  stagePlan: [
    { title: '先拿回 9分', subtitle: '夯实基础' },
    { title: '再冲刺 8分', subtitle: '提升稳定性' },
    { title: '挑战 8+分', subtitle: '攻克压轴' }
  ],
  priorities: [
    { title: '基础计算与概念应用', reason: '计算错误较多，概念理解不扎实，建议优先巩固基础题型。', scoreRange: '可提分：6~8分' },
    { title: '函数与方程应用题', reason: '审题与建模能力不足，步骤易失分，需强化方法与题型训练。', scoreRange: '可提分：5~6分' },
    { title: '几何证明与综合题', reason: '思路不完整，书写不规范，需提升逻辑表达与综合运用能力。', scoreRange: '可提分：4~6分' }
  ],
  thirtyDayPlan: [
    { week: '第1周', title: '夯实基础', detail: '回顾教材核心概念，完成基础题专项训练' },
    { week: '第2周', title: '专题突破', detail: '针对函数与方程应用题，掌握解题方法' },
    { week: '第3周', title: '综合提升', detail: '强化几何与综合题，提升解题规范与速度' },
    { week: '第4周', title: '模考冲刺', detail: '真题模拟训练，查漏补缺，稳定心态' }
  ],
  dimensions: [
    { name: '基础掌握', score: 68, status: '待巩固', analysis: '基础题已有一定正确率，但易在概念边界和计算细节上丢分。', suggestion: '每天固定完成基础题复盘，建立错因标签。' },
    { name: '方法迁移', score: 60, status: '偏弱', analysis: '遇到变式题时方法调用不够稳定，容易依赖题感。', suggestion: '按题型总结解题入口，训练同类迁移。' },
    { name: '综合应用', score: 56, status: '需提升', analysis: '综合题拆解能力不足，步骤衔接和表达完整度有待提升。', suggestion: '用分步拆题法训练压轴题前两问。' },
    { name: '考试稳定性', score: 63, status: '波动', analysis: '会做题仍可能因时间安排或粗心导致失分。', suggestion: '每周一次限时训练，复盘时间分配。' },
    { name: '学习习惯', score: 65, status: '可优化', analysis: '错题复盘和阶段总结还不够系统。', suggestion: '建立错题本，按错因而非日期归类。' }
  ],
  fullReport: {
    reportSubtitle: '初二数学提分空间与失分结构诊断',
    evidenceSummary: '当前默认报告基于示例表单生成。提交资料后，AI会结合表单、分数、家长选项和上传材料重新分析。',
    diagnosis: '当前成绩说明孩子具备基础理解能力，但知识结构还不够稳，综合应用和考试稳定性是主要提分入口。',
    paperRecognition: {
      readableQuality: '示例',
      recognizedScope: '尚未提交试卷或作业，当前展示示例报告结构。',
      detectedSubject: '数学',
      questionTypes: ['基础题', '中档应用题', '综合题'],
      visibleScoreMarks: '示例状态，提交后由AI识别批改痕迹与错题信息。',
      limitation: '示例报告不代表真实孩子情况，提交资料后会重算。'
    },
    scoreAnalytics: {
      currentRate: 68,
      targetRate: 85,
      gapRate: 17,
      recoverableScore: '示例：17分目标差距',
      stabilityIndex: '中',
      priorityIndex: '高',
      summary: '当前得分率68%，目标得分率85%，优先确认中档题与综合题的可回收分。'
    },
    materialFindings: [
      { title: '资料依据', detail: '尚未上传试卷或作业，当前仅展示示例诊断。' }
    ],
    abilityModules: [
      { name: '基础掌握', score: 68, level: '待巩固', evidence: '示例数据', analysis: '基础题已有一定正确率，但概念边界和计算细节仍易丢分。', suggestion: '每天固定完成基础题复盘，建立错因标签。' },
      { name: '方法迁移', score: 60, level: '偏弱', evidence: '示例数据', analysis: '遇到变式题时方法调用不够稳定，容易依赖题感。', suggestion: '按题型总结解题入口，训练同类迁移。' }
    ],
    questionTypeBreakdown: [
      { type: '基础题', observedEvidence: '示例数据', mastery: '68%', lossRisk: '中', estimatedRecoverableScore: '6~8分', strategy: '先修复概念边界与计算细节。' },
      { type: '中档应用题', observedEvidence: '示例数据', mastery: '中', lossRisk: '中高', estimatedRecoverableScore: '5~6分', strategy: '按题型建立方法入口。' },
      { type: '综合题', observedEvidence: '示例数据', mastery: '偏弱', lossRisk: '高', estimatedRecoverableScore: '4~6分', strategy: '训练拆题和步骤表达。' }
    ],
    knowledgeMap: [
      { knowledgePoint: '基础概念', masteryLevel: '中', evidence: '示例数据', typicalError: '概念边界不清', remediation: '回归课本定义，做概念辨析题。' },
      { knowledgePoint: '方法迁移', masteryLevel: '中低', evidence: '示例数据', typicalError: '遇到变式卡顿', remediation: '训练同类题变式迁移。' },
      { knowledgePoint: '表达规范', masteryLevel: '待提升', evidence: '示例数据', typicalError: '步骤得分点遗漏', remediation: '按评分点重写过程。' }
    ],
    lossAttribution: [
      { category: '概念基础', estimatedLoss: '6~8分', evidence: '示例数据', intervention: '概念辨析与基础题复盘。' },
      { category: '方法迁移', estimatedLoss: '5~6分', evidence: '示例数据', intervention: '同题型变式训练。' },
      { category: '步骤表达', estimatedLoss: '4~6分', evidence: '示例数据', intervention: '按评分点整理答题过程。' }
    ],
    knowledgeGaps: [
      { point: '基础概念', evidence: '示例数据', fix: '回归课本定义，做概念辨析题。' }
    ],
    errorPatterns: [
      { pattern: '会做但不稳', cause: '步骤和检查习惯不足', action: '限时训练后做错因归类。' }
    ],
    trainingPlan: [
      { stage: '第1阶段', goal: '夯实基础', task: '修复概念和计算漏洞。' }
    ],
    learningPath: [
      { phase: '第1周', focus: '基础校准', task: '复盘核心概念与基础错题', kpi: '基础题正确率稳定' },
      { phase: '第2周', focus: '题型突破', task: '训练中档题方法迁移', kpi: '能说出解题入口' },
      { phase: '第3周', focus: '综合表达', task: '重写综合题得分步骤', kpi: '步骤分遗漏减少' },
      { phase: '第4周', focus: '模拟校验', task: '限时套卷与弱项回炉', kpi: '模拟分接近目标区间' }
    ],
    reportQualityNote: '当前为示例结构。提交资料后，报告会标明哪些结论来自材料识别，哪些来自分数与表单推断。',
    closing: '这份测评是初步诊断，不承诺保分；只要训练路径稳定，提分空间可以被逐步兑现。'
  }
};

const form = document.querySelector('#assessmentForm');
const submitButton = document.querySelector('#submitButton');
const fileInput = document.querySelector('#fileInput');
const dropZone = document.querySelector('#dropZone');
const fileList = document.querySelector('#fileList');
const openReportButton = document.querySelector('#openReportButton');
const closeReportButton = document.querySelector('#closeReportButton');
const reportDialog = document.querySelector('#reportDialog');
const dialogBody = document.querySelector('#dialogBody');
const copyButton = document.querySelector('#copyButton');
const downloadButton = document.querySelector('#downloadButton');
const toast = document.querySelector('#toast');
const scoreTrack = document.querySelector('#scoreTrack');

let selectedFiles = [];
let currentReport = defaultReport;
let toastTimer = null;

renderReport(currentReport);
refreshIcons();

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const concerns = [...form.querySelectorAll('input[name="concerns"]:checked')].map((input) => input.value);
  formData.set('concerns', JSON.stringify(concerns));
  formData.set('testDate', getToday());
  formData.delete('files');
  selectedFiles.forEach((file) => formData.append('files', file));

  setLoading(true);

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      body: formData
    });

    const data = await readApiResponse(response);
    if (!response.ok) {
      throw new Error(data?.error || 'AI分析失败，请稍后重试。');
    }

    currentReport = mergeReport(data.report);
    renderReport(currentReport);
    showToast('AI测评已生成，右侧报告已更新。');
  } catch (error) {
    showToast(error.message || 'AI分析失败，请稍后重试。');
  } finally {
    setLoading(false);
  }
});

fileInput.addEventListener('change', () => {
  selectedFiles = [...fileInput.files];
  renderFileList();
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
});

dropZone.addEventListener('drop', (event) => {
  selectedFiles = [...event.dataTransfer.files].slice(0, 5);
  renderFileList();
});

openReportButton.addEventListener('click', () => {
  renderDialog(currentReport);
  reportDialog.showModal();
  refreshIcons();
});

closeReportButton.addEventListener('click', () => {
  reportDialog.close();
});

reportDialog.addEventListener('click', (event) => {
  if (event.target === reportDialog) {
    reportDialog.close();
  }
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(reportToText(currentReport));
  showToast('报告摘要已复制。');
});

downloadButton.addEventListener('click', async () => {
  await downloadPdfReport(currentReport);
});

function renderReport(report) {
  const maxScore = normalizeMaxScore(report.maxScore);
  const current = clamp(report.currentScore, maxScore);
  const target = clamp(report.targetScore, maxScore);
  const gap = Math.max(0, target - current);
  const currentPercent = toPercent(current, maxScore);
  const targetPercent = toPercent(target, maxScore);

  document.querySelector('#metaGrade').textContent = report.grade || '初二';
  document.querySelector('#metaSubject').textContent = report.subject || '数学';
  document.querySelector('#metaMax').textContent = maxScore;
  document.querySelector('#metaCurrent').textContent = current;
  document.querySelector('#metaCurrentMax').textContent = maxScore;
  document.querySelector('#metaTarget').textContent = target;
  document.querySelector('#metaTargetMax').textContent = maxScore;
  document.querySelector('#metaDate').textContent = report.testDate || getToday();
  document.querySelector('#levelLabel').textContent = report.levelLabel || scoreLayer(current);
  document.querySelector('#levelDescription').textContent = report.levelDescription || defaultReport.levelDescription;
  document.querySelector('#badgeGap').textContent = gap;
  document.querySelector('#currentMarkerText').textContent = `当前 ${current}`;
  document.querySelector('#targetMarkerText').textContent = `目标 ${target}`;

  const visibleTargetPercent = Math.max(currentPercent + 1, targetPercent);
  scoreTrack.style.setProperty('--current', `${currentPercent}%`);
  scoreTrack.style.setProperty('--target', `${visibleTargetPercent}%`);
  document.documentElement.style.setProperty('--current', `${currentPercent}%`);
  document.documentElement.style.setProperty('--target', `${visibleTargetPercent}%`);

  renderStageCards(report.stagePlan);
  renderPriorities(report.priorities);
  renderWeeks(report.thirtyDayPlan);
  refreshIcons();
}

function renderStageCards(items = []) {
  document.querySelector('#stageCards').innerHTML = items.slice(0, 3).map((item) => `
    <article class="stage-card">
      <strong>${escapeHtml(item.title || '')}</strong>
      <span>${escapeHtml(item.subtitle || '')}</span>
    </article>
  `).join('');
}

function renderPriorities(items = []) {
  document.querySelector('#priorityList').innerHTML = items.slice(0, 3).map((item, index) => `
    <article class="priority-item">
      <span class="priority-index">${index + 1}</span>
      <div>
        <strong>${escapeHtml(item.title || '')}</strong>
        <p>${escapeHtml(item.reason || '')}</p>
      </div>
      <span class="score-range">${escapeHtml(item.scoreRange || '')}</span>
    </article>
  `).join('');
}

function renderWeeks(items = []) {
  const icons = ['calendar-check', 'line-chart', 'graduation-cap', 'anchor'];
  document.querySelector('#weekList').innerHTML = items.slice(0, 4).map((item, index) => `
    <article class="week-item">
      <span class="week-icon"><i data-lucide="${icons[index] || 'check'}"></i></span>
      <div>
        <strong>${escapeHtml(item.week || `第${index + 1}周`)} ${escapeHtml(item.title || '')}</strong>
        <p>${escapeHtml(item.detail || '')}</p>
      </div>
    </article>
  `).join('');
}

async function downloadPdfReport(report) {
  const html2canvasLib = window.html2canvas;
  const JsPdf = window.jspdf?.jsPDF;

  if (!html2canvasLib || !JsPdf) {
    showToast('PDF生成组件加载失败，请刷新页面后重试。');
    return;
  }

  downloadButton.disabled = true;
  showToast('正在生成PDF完整报告...');

  const exportRoot = document.createElement('div');
  exportRoot.className = 'pdf-export-root';
  exportRoot.innerHTML = `
    <article class="pdf-export-shell">
      <header class="pdf-export-header">
        <div>
          <span>AI提分空间测评</span>
          <h2>完整报告详情</h2>
        </div>
      </header>
      <main class="dialog-body pdf-export-body">
        ${buildFullReportHtml(report)}
      </main>
    </article>
  `;
  document.body.append(exportRoot);

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));

    const shell = exportRoot.querySelector('.pdf-export-shell');
    const canvas = await html2canvasLib(shell, {
      backgroundColor: '#fffdf9',
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: 1120
    });

    const pdf = new JsPdf('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const imageWidth = pageWidth - margin * 2;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;
    const pageContentHeight = pageHeight - margin * 2;
    const imageData = canvas.toDataURL('image/jpeg', 0.96);

    let offsetY = margin;
    let remainingHeight = imageHeight;
    pdf.addImage(imageData, 'JPEG', margin, offsetY, imageWidth, imageHeight, undefined, 'FAST');
    remainingHeight -= pageContentHeight;

    while (remainingHeight > 0) {
      pdf.addPage();
      offsetY = margin - (imageHeight - remainingHeight);
      pdf.addImage(imageData, 'JPEG', margin, offsetY, imageWidth, imageHeight, undefined, 'FAST');
      remainingHeight -= pageContentHeight;
    }

    pdf.save(`AI提分空间测评完整报告-${safeFilePart(report.grade)}-${safeFilePart(report.subject)}.pdf`);
    showToast('PDF完整报告已下载。');
  } catch (error) {
    console.error(error);
    showToast('PDF生成失败，请稍后重试。');
  } finally {
    exportRoot.remove();
    downloadButton.disabled = false;
  }
}

function renderDialog(report) {
  dialogBody.innerHTML = buildFullReportHtml(report);
}

function buildFullReportHtml(report) {
  const full = report.fullReport || defaultReport.fullReport;
  const dimensions = Array.isArray(report.dimensions) ? report.dimensions : defaultReport.dimensions;
  const abilityModules = Array.isArray(full.abilityModules) && full.abilityModules.length ? full.abilityModules : dimensions;
  const maxScore = normalizeMaxScore(report.maxScore);
  const current = clamp(report.currentScore, maxScore);
  const target = clamp(report.targetScore, maxScore);
  const gap = Math.max(0, target - current);
  const analytics = full.scoreAnalytics || {};
  const recognition = full.paperRecognition || {};
  const currentRate = analytics.currentRate ?? Math.round(toPercent(current, maxScore));
  const targetRate = analytics.targetRate ?? Math.round(toPercent(target, maxScore));
  const gapRate = analytics.gapRate ?? Math.round(toPercent(gap, maxScore));

  return `
    <section class="report-cover">
      <div>
        <span class="report-kicker">AI识别分析报告</span>
        <h3>${escapeHtml(report.grade || '')}${escapeHtml(report.subject || '')}提分空间专业测评</h3>
        <p>${escapeHtml(full.reportSubtitle || '基于上传资料、分数结构与目标差距生成的学业诊断报告')}</p>
      </div>
      <strong>${escapeHtml(report.testDate || getToday())}</strong>
    </section>

    <section class="metric-strip">
      ${renderMetricCard('当前得分率', `${escapeHtml(currentRate)}%`, `${current}/${maxScore}`)}
      ${renderMetricCard('目标得分率', `${escapeHtml(targetRate)}%`, `${target}/${maxScore}`)}
      ${renderMetricCard('差距强度', `${escapeHtml(gapRate)}%`, `差距 ${gap} 分`)}
      ${renderMetricCard('优先级指数', analytics.priorityIndex || '待确认', analytics.recoverableScore || '由AI依据材料估算')}
    </section>

    <section class="evidence-band">
      <div>
        <span>分析依据</span>
        <p>${escapeHtml(full.evidenceSummary || 'AI已根据本次表单与上传材料生成诊断；若未上传材料，则主要依据表单信息判断。')}</p>
      </div>
      <div>
        <span>识别质量</span>
        <strong>${escapeHtml(recognition.readableQuality || '待确认')}</strong>
        <small>${escapeHtml(recognition.limitation || full.reportQualityNote || '')}</small>
      </div>
    </section>

    ${renderRecognitionPanel(recognition, analytics)}

    <section class="full-section conclusion-section">
      <div class="section-title">
        <span>01</span>
        <h3>核心测评结论</h3>
      </div>
      <p>${escapeHtml(full.diagnosis || '')}</p>
      ${analytics.summary ? `<blockquote>${escapeHtml(analytics.summary)}</blockquote>` : ''}
    </section>

    ${renderObjectListSection('材料观察与证据摘录', full.materialFindings, ['title', 'detail', 'evidence'])}

    <section class="full-section">
      <div class="section-title">
        <span>02</span>
        <h3>多维能力画像</h3>
      </div>
      <div class="dimension-grid">
        ${abilityModules.map((item) => `
          <article class="dimension-card">
            <header>
              <h4>${escapeHtml(item.name || '')}</h4>
              <strong>${escapeHtml(String(item.score ?? ''))}分 · ${escapeHtml(item.level || item.status || '')}</strong>
            </header>
            <div class="mini-scorebar"><span style="width:${clamp(item.score, 100)}%"></span></div>
            ${item.evidence ? `<p><b>依据：</b>${escapeHtml(item.evidence)}</p>` : ''}
            <p>${escapeHtml(item.analysis || '')}</p>
            <p><b>建议：</b>${escapeHtml(item.suggestion || '')}</p>
          </article>
        `).join('')}
      </div>
    </section>

    ${renderQuestionMatrix(full.questionTypeBreakdown)}
    ${renderKnowledgeMap(full.knowledgeMap || full.knowledgeGaps)}
    ${renderLossAttribution(full.lossAttribution)}
    ${renderObjectListSection('失分模式深描', full.errorPatterns, ['pattern', 'cause', 'action'])}
    ${renderRoadmap(full.learningPath || full.trainingPlan || full.improvementPath)}

    <section class="full-section">
      <div class="section-title">
        <span>END</span>
        <h3>结语</h3>
      </div>
      <p>${escapeHtml(full.closing || '')}</p>
      ${full.reportQualityNote ? `<p class="quality-note">${escapeHtml(full.reportQualityNote)}</p>` : ''}
    </section>
  `;
}

function renderMetricCard(label, value, note) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note || '')}</small>
    </article>
  `;
}

function renderRecognitionPanel(recognition = {}, analytics = {}) {
  const questionTypes = Array.isArray(recognition.questionTypes) ? recognition.questionTypes : [];
  return `
    <section class="recognition-panel">
      <div class="section-title">
        <span>AI</span>
        <h3>上传材料识别摘要</h3>
      </div>
      <div class="recognition-grid">
        ${renderRecognitionItem('识别范围', recognition.recognizedScope)}
        ${renderRecognitionItem('识别学科', recognition.detectedSubject)}
        ${renderRecognitionItem('批改痕迹', recognition.visibleScoreMarks)}
        ${renderRecognitionItem('稳定性指数', analytics.stabilityIndex)}
      </div>
      <div class="tag-row">
        ${questionTypes.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
    </section>
  `;
}

function renderRecognitionItem(label, value) {
  return `
    <article>
      <span>${escapeHtml(label)}</span>
      <p>${escapeHtml(value || '待确认')}</p>
    </article>
  `;
}

function renderQuestionMatrix(items = []) {
  if (!Array.isArray(items) || !items.length) return '';

  return `
    <section class="full-section">
      <div class="section-title">
        <span>03</span>
        <h3>题型表现矩阵</h3>
      </div>
      <div class="analysis-matrix">
        <div class="matrix-head">
          <span>题型模块</span>
          <span>识别证据</span>
          <span>掌握度</span>
          <span>风险</span>
          <span>策略</span>
        </div>
        ${items.map((item) => `
          <article class="matrix-row">
            <strong>${escapeHtml(item.type || '')}</strong>
            <p>${escapeHtml(item.observedEvidence || item.evidence || '')}</p>
            <span>${escapeHtml(item.mastery || '')}</span>
            <em>${escapeHtml(item.lossRisk || '')}${item.estimatedRecoverableScore ? ` · ${escapeHtml(item.estimatedRecoverableScore)}` : ''}</em>
            <p>${escapeHtml(item.strategy || '')}</p>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderKnowledgeMap(items = []) {
  if (!Array.isArray(items) || !items.length) return '';

  return `
    <section class="full-section">
      <div class="section-title">
        <span>04</span>
        <h3>知识地图与补救路径</h3>
      </div>
      <div class="knowledge-grid">
        ${items.map((item) => `
          <article class="knowledge-card">
            <header>
              <strong>${escapeHtml(item.knowledgePoint || item.point || '')}</strong>
              <span>${escapeHtml(item.masteryLevel || '待确认')}</span>
            </header>
            <p><b>证据：</b>${escapeHtml(item.evidence || '')}</p>
            <p><b>典型风险：</b>${escapeHtml(item.typicalError || '')}</p>
            <p><b>补救动作：</b>${escapeHtml(item.remediation || item.fix || '')}</p>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderLossAttribution(items = []) {
  if (!Array.isArray(items) || !items.length) return '';

  return `
    <section class="full-section">
      <div class="section-title">
        <span>05</span>
        <h3>失分归因雷达</h3>
      </div>
      <div class="loss-stack">
        ${items.map((item, index) => `
          <article class="loss-item">
            <div>
              <strong>${escapeHtml(item.category || '')}</strong>
              <span>${escapeHtml(item.estimatedLoss || '')}</span>
            </div>
            <div class="risk-bar"><span style="width:${lossBarPercent(item.estimatedLoss, index)}%"></span></div>
            <p><b>证据：</b>${escapeHtml(item.evidence || '')}</p>
            <p><b>干预：</b>${escapeHtml(item.intervention || '')}</p>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderRoadmap(items = []) {
  if (!Array.isArray(items) || !items.length) return '';

  return `
    <section class="full-section">
      <div class="section-title">
        <span>06</span>
        <h3>30天提分训练路径</h3>
      </div>
      <div class="roadmap-grid">
        ${items.slice(0, 4).map((item, index) => `
          <article class="roadmap-card">
            <span>${escapeHtml(item.phase || item.stage || `第${index + 1}周`)}</span>
            <strong>${escapeHtml(item.focus || item.goal || '')}</strong>
            <p>${escapeHtml(item.task || '')}</p>
            <small>${escapeHtml(item.kpi || item.checkpoint || '')}</small>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function lossBarPercent(value, index) {
  const numbers = String(value || '').match(/\d+(\.\d+)?/g)?.map(Number) || [];
  if (!numbers.length) return Math.max(34, 76 - index * 9);
  const number = Math.max(...numbers);
  return Math.max(28, Math.min(92, number * 8));
}

function renderObjectListSection(title, items = [], keys = []) {
  if (!Array.isArray(items) || !items.length) return '';

  return `
    <section class="full-section">
      <div class="section-title">
        <span>DATA</span>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="detail-list">
        ${items.map((item) => `
          <article class="detail-item">
            ${keys.map((key) => item?.[key] ? `<p><b>${escapeHtml(labelForKey(key))}：</b>${escapeHtml(item[key])}</p>` : '').join('')}
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function labelForKey(key) {
  const labels = {
    title: '发现',
    detail: '说明',
    evidence: '依据',
    point: '漏洞',
    fix: '补救',
    pattern: '模式',
    cause: '原因',
    action: '行动',
    stage: '阶段',
    goal: '目标',
    task: '任务',
    checkpoint: '检查点'
  };
  return labels[key] || key;
}

function renderListSection(title, items = [], tone = '') {
  return `
    <section class="full-section list-section ${tone ? `list-${tone}` : ''}">
      <div class="section-title">
        <span>${tone ? escapeHtml(tone.toUpperCase()) : 'LIST'}</span>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <ol class="plain-list">
        ${(Array.isArray(items) ? items : []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ol>
    </section>
  `;
}

function renderFileList() {
  if (!selectedFiles.length) {
    fileList.textContent = '';
    return;
  }

  const names = selectedFiles.map((file) => file.name).join('、');
  fileList.textContent = `已选择 ${selectedFiles.length} 个文件：${names}`;
  fileList.title = names;
}

async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  const looksLikeHtml = /<!doctype|<html/i.test(text);
  return {
    error: looksLikeHtml
      ? '提交接口返回了网页内容。请确认用 http://localhost:3000 打开网站，并重新提交。'
      : text.slice(0, 240) || 'AI分析失败，请稍后重试。'
  };
}

function mergeReport(report) {
  return {
    ...defaultReport,
    ...(report || {}),
    fullReport: {
      ...defaultReport.fullReport,
      ...(report?.fullReport || {})
    },
    stagePlan: Array.isArray(report?.stagePlan) ? report.stagePlan : defaultReport.stagePlan,
    priorities: Array.isArray(report?.priorities) ? report.priorities : defaultReport.priorities,
    thirtyDayPlan: Array.isArray(report?.thirtyDayPlan) ? report.thirtyDayPlan : defaultReport.thirtyDayPlan,
    dimensions: Array.isArray(report?.dimensions) ? report.dimensions : defaultReport.dimensions
  };
}

function setLoading(isLoading) {
  form.classList.toggle('loading', isLoading);
  submitButton.disabled = isLoading;
  submitButton.querySelector('span').textContent = isLoading ? 'AI正在分析资料' : '生成提分空间测评';
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function reportToText(report) {
  const maxScore = normalizeMaxScore(report.maxScore);
  return [
    `AI提分空间测评：${report.grade} ${report.subject}`,
    `当前：${report.currentScore}/${maxScore}，目标：${report.targetScore}/${maxScore}，差距：${report.gap}分`,
    `${report.levelLabel}：${report.levelDescription}`,
    report.gapDescription,
    '优先提分方向：',
    ...report.priorities.map((item, index) => `${index + 1}. ${item.title}｜${item.reason}｜${item.scoreRange}`)
  ].join('\n');
}

function clamp(value, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(max, Math.round(number)));
}

function normalizeMaxScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 100;
  return Math.max(1, Math.min(1000, Math.round(number)));
}

function toPercent(score, maxScore) {
  return Math.max(0, Math.min(100, (score / maxScore) * 100));
}

function scoreLayer(score) {
  if (score >= 90) return '高分稳定';
  if (score >= 80) return '中等偏上';
  if (score >= 60) return '中等偏下';
  return '基础待补';
}

function getToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function safeFilePart(value) {
  return String(value || '报告')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 24) || '报告';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

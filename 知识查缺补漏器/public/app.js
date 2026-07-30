const state = {
  files: {
    examFile: [],
    knowledgeFile: []
  },
  activeTab: 'map',
  activeView: 'tree',
  report: null
};

const statusMeta = {
  good: { label: '掌握良好', className: 'good', color: '#11a86a' },
  gap: { label: '存在漏洞', className: 'gap', color: '#ee9f05' },
  severe: { label: '漏洞严重', className: 'severe', color: '#f04438' },
  untouched: { label: '未涉及', className: 'untouched', color: '#aab1ba' }
};

const elements = {
  form: document.querySelector('#analysisForm'),
  generatedAt: document.querySelector('#generatedAt'),
  loadingState: document.querySelector('#loadingState'),
  emptyState: document.querySelector('#emptyState'),
  treeStage: document.querySelector('#treeStage'),
  listStage: document.querySelector('#listStage'),
  statGrid: document.querySelector('#statGrid'),
  openReport: document.querySelector('#openReport'),
  reportModal: document.querySelector('#reportModal'),
  guideModal: document.querySelector('#guideModal'),
  reportContent: document.querySelector('#reportContent'),
  severityPanel: document.querySelector('#severityPanel'),
  priorityPanel: document.querySelector('#priorityPanel'),
  routePanel: document.querySelector('#routePanel')
};

document.addEventListener('DOMContentLoaded', () => {
  bindUploads();
  bindTabs();
  bindModals();
  bindForm();
  renderStats({ total: 0, good: 0, gap: 0, severe: 0, untouched: 0 });
  refreshIcons();
});

function bindUploads() {
  ['examFile', 'knowledgeFile'].forEach((name) => {
    const input = document.querySelector(`#${name}`);
    const dropzone = document.querySelector(`[data-dropzone="${name}"]`);

    input.addEventListener('change', () => {
      setFiles(name, input.files);
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add('dragging');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.remove('dragging');
      });
    });

    dropzone.addEventListener('drop', (event) => {
      setFiles(name, event.dataTransfer.files);
    });
  });
}

function setFiles(name, fileList) {
  const allowed = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'txt', 'md'];
  const incomingFiles = Array.from(fileList || []);
  const validFiles = incomingFiles.filter((file) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    return allowed.includes(ext);
  });

  if (validFiles.length !== incomingFiles.length) {
    showToast('已忽略不支持的文件，仅支持 PDF、Word、PNG、JPG、TXT 文件。');
  }

  if (validFiles.length === 0) {
    return;
  }

  state.files[name] = dedupeFiles([...(state.files[name] || []), ...validFiles]);
  renderFilePreview(name);
}

function dedupeFiles(files) {
  const seen = new Set();
  return files.filter((file) => {
    const key = `${file.name}-${file.size}-${file.lastModified}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function renderFilePreview(name) {
  const preview = document.querySelector(`#${name === 'examFile' ? 'examPreview' : 'knowledgePreview'}`);
  const files = state.files[name] || [];
  if (files.length === 0) {
    preview.hidden = true;
    preview.innerHTML = '';
    return;
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  preview.hidden = false;
  preview.innerHTML = `
    <div class="file-list">
      <div class="file-summary">
        <strong>${files.length} 个文件已选择</strong>
        <small>合计 ${formatFileSize(totalSize)}</small>
      </div>
      ${files.map((file, index) => `
        <div class="file-row">
          <span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <small>${formatFileSize(file.size)}</small>
          <button type="button" data-remove-file="${name}" data-file-index="${index}">移除</button>
        </div>
      `).join('')}
    </div>
    <div class="file-actions">
      <i data-lucide="check-circle-2"></i>
      <button type="button" data-clear-files="${name}">清空</button>
    </div>
  `;
  preview.querySelectorAll('[data-remove-file]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.fileIndex);
      state.files[name] = (state.files[name] || []).filter((_, fileIndex) => fileIndex !== index);
      renderFilePreview(name);
    });
  });
  preview.querySelector('[data-clear-files]').addEventListener('click', () => {
    state.files[name] = [];
    renderFilePreview(name);
  });
  refreshIcons();
}

function bindTabs() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach((tab) => {
        tab.classList.toggle('active', tab === button);
      });
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.remove('active');
      });
      document.querySelector(`#${state.activeTab}Panel`).classList.add('active');
    });
  });

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeView = button.dataset.view;
      document.querySelectorAll('[data-view]').forEach((view) => {
        view.classList.toggle('active', view === button);
      });
      updateMapView();
    });
  });
}

function bindModals() {
  document.querySelector('#openReport').addEventListener('click', () => {
    if (!state.report) return;
    renderFullReport(state.report);
    elements.reportModal.showModal();
    refreshIcons();
  });

  document.querySelector('[data-close-modal]').addEventListener('click', () => {
    elements.reportModal.close();
  });

  document.querySelector('[data-open-guide]').addEventListener('click', () => {
    elements.guideModal.showModal();
    refreshIcons();
  });

  document.querySelector('[data-close-guide]').addEventListener('click', () => {
    elements.guideModal.close();
  });
}

function bindForm() {
  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (state.files.examFile.length === 0) {
      showToast('请至少上传一份试卷/作业文件。知识点文件可选，AI 会自动识别。');
      return;
    }

    const formData = new FormData(elements.form);
    formData.delete('examFile');
    formData.delete('knowledgeFile');
    state.files.examFile.forEach((file) => formData.append('examFile', file));
    state.files.knowledgeFile.forEach((file) => formData.append('knowledgeFile', file));

    setLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || '生成失败，请稍后重试。');
      }
      state.report = payload.report;
      renderReport(payload.report);
      showToast('知识查缺补漏器报告已生成。');
    } catch (error) {
      showToast(error.message || '生成失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  });
}

function setLoading(isLoading) {
  const button = elements.form.querySelector('.generate-button');
  button.disabled = isLoading;
  button.querySelector('span').textContent = isLoading ? 'AI分析中...' : '生成漏洞地图';
  elements.loadingState.hidden = !isLoading;
  elements.emptyState.hidden = isLoading || Boolean(state.report);
  elements.treeStage.hidden = isLoading || !state.report || state.activeView !== 'tree';
  elements.listStage.hidden = isLoading || !state.report || state.activeView !== 'list';
}

function renderReport(report) {
  elements.generatedAt.textContent = report.generatedAt || '刚刚';
  elements.openReport.disabled = false;
  elements.emptyState.hidden = true;
  renderTree(report);
  renderList(report);
  renderStats(report.stats);
  renderSeverity(report.severity || []);
  renderPriority(report.priority || []);
  renderRoute(report.route30 || []);
  updateMapView();
  refreshIcons();
}

function renderTree(report) {
  const rootLabel = escapeHtml(report.map?.rootLabel || `${report.meta.grade}\n${report.meta.subject}`);
  const clusters = report.map?.clusters || [];
  elements.treeStage.innerHTML = `
    <div class="tree-canvas">
      <div class="root-node">${rootLabel}</div>
      <div class="cluster-list">
        ${clusters.map(renderCluster).join('')}
      </div>
    </div>
  `;
}

function renderCluster(cluster) {
  const status = statusMeta[cluster.status] || statusMeta.gap;
  return `
    <div class="cluster-row">
      <div class="cluster-node ${status.className}">
        <span class="dot ${status.className}"></span>
        <span class="point-name">${escapeHtml(cluster.name)}</span>
      </div>
      <div class="children-list">
        ${(cluster.children || []).map(renderPoint).join('')}
      </div>
    </div>
  `;
}

function renderPoint(point) {
  const status = statusMeta[point.status] || statusMeta.gap;
  const mastery = point.mastery === null || point.mastery === undefined ? null : Number(point.mastery);
  return `
    <div class="point-node ${status.className}">
      <span class="dot ${status.className}"></span>
      <span class="point-name" title="${escapeHtml(point.name)}">${escapeHtml(point.name)}</span>
      <span class="mastery ${status.className}">
        <span class="bar"><i style="--value:${mastery ?? 0}%"></i></span>
        ${mastery === null ? '未涉及' : `掌握度 ${mastery}%`}
      </span>
    </div>
  `;
}

function renderList(report) {
  const items = flattenPoints(report);
  elements.listStage.innerHTML = items.map((item) => {
    const status = statusMeta[item.status] || statusMeta.gap;
    return `
      <article class="list-item">
        <strong><span class="dot ${status.className}"></span>${escapeHtml(item.name)}</strong>
        <span>${status.label}${item.mastery === null ? '' : ` · ${item.mastery}%`}</span>
        <p>${escapeHtml(item.reason || item.evidence || '暂无说明')}</p>
      </article>
    `;
  }).join('');
}

function updateMapView() {
  if (!state.report) return;
  elements.treeStage.hidden = state.activeView !== 'tree';
  elements.listStage.hidden = state.activeView !== 'list';
}

function renderStats(stats = {}) {
  const total = Number(stats.total || 0);
  const good = Number(stats.good || 0);
  const gap = Number(stats.gap || 0);
  const severe = Number(stats.severe || 0);
  const untouched = Number(stats.untouched || 0);
  elements.statGrid.innerHTML = `
    ${renderStat('知识点总数', total, 'neutral')}
    ${renderStat('掌握良好', good, 'good', total)}
    ${renderStat('存在漏洞', gap, 'gap', total)}
    ${renderStat('漏洞严重', severe, 'severe', total)}
    ${renderStat('未涉及', untouched, 'untouched', total)}
  `;
}

function renderStat(label, value, className, total) {
  const percent = total ? `（${Math.round((value / total) * 100)}%）` : '';
  return `
    <article>
      <span>${label}</span>
      <strong class="${className}">${value}<small>个 ${percent}</small></strong>
    </article>
  `;
}

function renderSeverity(items) {
  elements.severityPanel.innerHTML = renderDimensionList(items, (item) => {
    const levelClass = item.level === '高' ? 'severe' : item.level === '中' ? 'gap' : 'good';
    return `
      <article class="dimension-item">
        <header>
          <h3><span class="dot ${levelClass}"></span>${escapeHtml(item.name || '风险项')}</h3>
          <span class="pill">严重程度：${escapeHtml(item.level || '中')}</span>
        </header>
        <p>${escapeHtml(item.reason || '')}</p>
        <p><strong>影响考点：</strong>${escapeHtml((item.affectedPoints || []).join('、') || '未列出')}</p>
        <p><strong>建议动作：</strong>${escapeHtml(item.recommendedAction || '')}</p>
      </article>
    `;
  }, '暂无严重程度报告');
}

function renderPriority(items) {
  const sorted = [...items].sort((a, b) => Number(a.priority || 9) - Number(b.priority || 9));
  elements.priorityPanel.innerHTML = renderDimensionList(sorted, (item) => `
    <article class="dimension-item">
      <header>
        <h3><span class="dot gap"></span>${escapeHtml(item.name || '优先任务')}</h3>
        <span class="pill">P${escapeHtml(item.priority || '3')} · ${escapeHtml(item.estimatedDays || '3')}天</span>
      </header>
      <p>${escapeHtml(item.objective || '')}</p>
      ${renderTaskList(item.tasks)}
    </article>
  `, '暂无优先级报告');
}

function renderRoute(items) {
  elements.routePanel.innerHTML = renderDimensionList(items, (item) => `
    <article class="dimension-item">
      <header>
        <h3><span class="dot good"></span>${escapeHtml(item.focus || '补漏任务')}</h3>
        <span class="pill">${escapeHtml(item.dayRange || '30天内')}</span>
      </header>
      ${renderTaskList(item.tasks)}
      <p><strong>交付结果：</strong>${escapeHtml(item.deliverable || '')}</p>
    </article>
  `, '暂无 30 天路线');
}

function renderDimensionList(items, renderer, emptyText) {
  if (!items.length) {
    return `<div class="empty-state"><strong>${emptyText}</strong><small>生成报告后会自动补全。</small></div>`;
  }
  return `<div class="dimension-list">${items.map(renderer).join('')}</div>`;
}

function renderTaskList(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) return '';
  return `<ul class="task-list">${tasks.map((task) => `<li>${escapeHtml(task)}</li>`).join('')}</ul>`;
}

function renderLegacyFullReport(report) {
  const full = report.fullReport || {};
  elements.reportContent.innerHTML = `
    ${renderReportSection('总体诊断', [full.overallDiagnosis || report.summary])}
    ${renderReportSection('学生画像', [full.studentProfile])}
    ${renderReportSection('教学建议', full.teachingRecommendations)}
    ${renderReportSection('练习计划', full.practicePlan)}
    ${renderReportSection('下次考试预测', [full.nextExamPrediction])}
    ${renderReportSection('风险提醒', full.risks)}
  `;
}

function renderReportSection(title, content) {
  const items = Array.isArray(content) ? content.filter(Boolean) : [content].filter(Boolean);
  if (!items.length) return '';
  const body = items.length === 1
    ? `<p>${escapeHtml(items[0])}</p>`
    : `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  return `<section class="report-section"><h3>${title}</h3>${body}</section>`;
}

function flattenPoints(report) {
  return (report.map?.clusters || []).flatMap((cluster) => [
    {
      name: cluster.name,
      status: cluster.status,
      mastery: cluster.mastery,
      reason: '一级知识模块'
    },
    ...(cluster.children || [])
  ]);
}

function formatFileSize(size) {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)}KB`;
  return `${(size / 1024 / 1024).toFixed(2)}MB`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  existing?.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

function renderFullReport(report) {
  const full = report.fullReport || {};
  const stats = report.stats || {};
  const snapshotCards = buildSnapshotCards(full.analyticalSnapshot, report);
  const dimensions = buildDataDimensions(full.dataDimensions, report);
  const patterns = asReportArray(full.errorPatternMatrix);
  const evidence = asReportArray(full.evidenceChain);
  const roots = asReportArray(full.rootCauseModel);
  const projection = full.scoreProjection || {};
  const interventions = asReportArray(full.interventionStrategy);

  elements.reportContent.innerHTML = `
    <div class="pro-report">
      <section class="report-hero">
        <div>
          <span class="report-kicker">Professional Diagnostic Report</span>
          <h3>${escapeHtml(report.title || '知识查缺补漏器')}</h3>
          <p>${escapeHtml(full.overallDiagnosis || report.summary || '已基于上传资料完成知识漏洞诊断。')}</p>
        </div>
        <div class="report-stamp">
          <strong>${escapeHtml(report.meta?.grade || '')}</strong>
          <span>${escapeHtml(report.meta?.subject || '')} · ${escapeHtml(report.meta?.targetExam || '')}</span>
          <small>${escapeHtml(report.generatedAt || '')}</small>
        </div>
      </section>

      <section class="snapshot-grid">
        ${snapshotCards.map(renderSnapshotCard).join('')}
      </section>

      <section class="report-block">
        <div class="block-title">
          <span>01</span>
          <div>
            <h3>数据诊断维度</h3>
            <p>从概念理解、计算稳定性、迁移能力、表达规范和提分弹性拆解学习表现。</p>
          </div>
        </div>
        <div class="dimension-board">
          ${dimensions.map(renderReportDimension).join('')}
        </div>
      </section>

      <section class="report-block">
        <div class="block-title">
          <span>02</span>
          <div>
            <h3>错因模式矩阵</h3>
            <p>把失分现象还原为可干预的行为模式，定位最该优先处理的学习漏洞。</p>
          </div>
        </div>
        <div class="matrix-list">
          ${patterns.length ? patterns.map(renderPatternItem).join('') : renderFallbackPatterns(report)}
        </div>
      </section>

      <section class="report-block">
        <div class="block-title">
          <span>03</span>
          <div>
            <h3>证据链与根因模型</h3>
            <p>每个判断都回到资料证据，避免只给结论不给依据。</p>
          </div>
        </div>
        <div class="evidence-grid">
          <div class="evidence-panel">
            <h4>诊断证据链</h4>
            ${evidence.length ? evidence.map(renderEvidenceItem).join('') : renderFallbackEvidence(report)}
          </div>
          <div class="evidence-panel">
            <h4>根因假设</h4>
            ${roots.length ? roots.map(renderRootCauseItem).join('') : renderFallbackRootCauses(report)}
          </div>
        </div>
      </section>

      <section class="report-block">
        <div class="block-title">
          <span>04</span>
          <div>
            <h3>提分预测与干预方案</h3>
            <p>把诊断结果翻译成可执行的教学动作、家庭动作和阶段验收标准。</p>
          </div>
        </div>
        <div class="projection-panel">
          <article>
            <span>当前区间</span>
            <strong>${escapeHtml(projection.currentRange || report.meta?.currentStage || '待校准')}</strong>
          </article>
          <article>
            <span>目标区间</span>
            <strong>${escapeHtml(projection.targetRange || '按30天路线冲刺')}</strong>
          </article>
          <article>
            <span>提分潜力</span>
            <strong>${escapeHtml(projection.gainPotential || full.nextExamPrediction || '需结合执行度判断')}</strong>
          </article>
        </div>
        ${renderConditionList(projection.conditions)}
        <div class="intervention-timeline">
          ${interventions.length ? interventions.map(renderInterventionItem).join('') : renderFallbackInterventions(report)}
        </div>
      </section>

      <section class="report-block report-two-col">
        ${renderProSection('教学建议', full.teachingRecommendations)}
        ${renderProSection('练习计划', full.practicePlan)}
        ${renderProSection('风险提醒', full.risks)}
        ${renderProSection('数据口径与限制', full.dataLimitations)}
      </section>
    </div>
  `;
}

function buildSnapshotCards(cards, report) {
  const normalized = asReportArray(cards).map((card) => ({
    label: card.label || card.name || '分析指标',
    value: card.value || card.score || '-',
    level: card.level || card.status || '已评估',
    description: card.description || card.finding || ''
  }));

  const stats = report.stats || {};
  const total = Number(stats.total || 0);
  const gap = Number(stats.gap || 0);
  const severe = Number(stats.severe || 0);
  const riskRate = total ? Math.round(((gap + severe) / total) * 100) : 0;
  const fallback = [
    { label: '知识点总量', value: `${total}个`, level: '覆盖规模', description: 'AI 从上传资料中抽取并归类的知识点数量。' },
    { label: '漏洞暴露率', value: `${riskRate}%`, level: riskRate >= 55 ? '高风险' : '中风险', description: '存在漏洞与严重漏洞占全部知识点的比例。' },
    { label: '严重漏洞', value: `${severe}个`, level: '优先处理', description: '会显著拖累综合题和考试稳定性的关键缺口。' },
    { label: '30天路线', value: `${asReportArray(report.route30).length}段`, level: '可执行', description: '按阶段拆解复习重点、任务和验收结果。' }
  ];
  return [...normalized, ...fallback].slice(0, 6);
}

function buildDataDimensions(dimensions, report) {
  const normalized = asReportArray(dimensions).map((item) => ({
    dimension: item.dimension || item.name || '分析维度',
    score: item.score ?? item.value ?? '-',
    status: item.status || '已评估',
    finding: item.finding || item.summary || '',
    evidence: item.evidence || '',
    action: item.action || item.recommendation || ''
  }));
  const fallback = (report.map?.clusters || []).slice(0, 6).map((cluster) => ({
    dimension: cluster.name,
    score: cluster.mastery ?? '-',
    status: statusMeta[cluster.status]?.label || '已评估',
    finding: `${cluster.name}包含 ${(cluster.children || []).length} 个下级知识点。`,
    evidence: '来自上传资料中的题型、错题描述和知识点分布。',
    action: cluster.status === 'severe' ? '优先拆解基础步骤并做限时纠错。' : '按路线进行巩固与复测。'
  }));
  return [...normalized, ...fallback].slice(0, 8);
}

function renderSnapshotCard(card) {
  return `
    <article class="snapshot-card">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <b>${escapeHtml(card.level)}</b>
      <p>${escapeHtml(card.description)}</p>
    </article>
  `;
}

function renderReportDimension(item) {
  const score = Number(item.score);
  const width = Number.isFinite(score) ? Math.max(6, Math.min(100, score)) : 0;
  return `
    <article class="report-dimension">
      <header>
        <h4>${escapeHtml(item.dimension)}</h4>
        <strong>${escapeHtml(item.score)}</strong>
      </header>
      <div class="dimension-meter"><i style="width:${width}%"></i></div>
      <span>${escapeHtml(item.status)}</span>
      <p>${escapeHtml(item.finding)}</p>
      ${item.evidence ? `<small>证据：${escapeHtml(item.evidence)}</small>` : ''}
      ${item.action ? `<small>动作：${escapeHtml(item.action)}</small>` : ''}
    </article>
  `;
}

function renderPatternItem(item) {
  return `
    <article class="matrix-item">
      <header>
        <h4>${escapeHtml(item.pattern || item.name || '错因模式')}</h4>
        <span>${escapeHtml(item.frequency || '中')}</span>
      </header>
      <p><strong>影响：</strong>${escapeHtml(item.impact || '')}</p>
      <p><strong>证据：</strong>${escapeHtml(item.evidence || '')}</p>
      <p><strong>干预：</strong>${escapeHtml(item.intervention || '')}</p>
    </article>
  `;
}

function renderEvidenceItem(item) {
  return `
    <article class="evidence-item">
      <b>${escapeHtml(item.confidence || '中')}</b>
      <h5>${escapeHtml(item.finding || '诊断发现')}</h5>
      <p>${escapeHtml(item.sourceEvidence || item.evidence || '')}</p>
      <small>${escapeHtml(item.inference || '')}</small>
    </article>
  `;
}

function renderRootCauseItem(item) {
  return `
    <article class="evidence-item root">
      <h5>${escapeHtml(item.cause || '根因')}</h5>
      <p>${escapeHtml(item.mechanism || '')}</p>
      ${renderInlineTags(item.symptoms)}
      <small>${escapeHtml(item.repairStrategy || '')}</small>
    </article>
  `;
}

function renderInterventionItem(item) {
  return `
    <article class="timeline-item">
      <span>${escapeHtml(item.stage || '阶段')}</span>
      <h4>${escapeHtml(item.objective || '')}</h4>
      <p>${escapeHtml(item.method || '')}</p>
      <small>验收标准：${escapeHtml(item.successMetric || '')}</small>
    </article>
  `;
}

function renderConditionList(conditions) {
  const items = asReportArray(conditions);
  if (!items.length) return '';
  return `<div class="condition-list">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`;
}

function renderProSection(title, content) {
  const items = asReportArray(content).filter(Boolean);
  if (!items.length) return '';
  return `
    <article class="pro-section">
      <h3>${escapeHtml(title)}</h3>
      ${items.length === 1
        ? `<p>${escapeHtml(items[0])}</p>`
        : `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`}
    </article>
  `;
}

function renderInlineTags(items) {
  const tags = asReportArray(items);
  if (!tags.length) return '';
  return `<div class="tag-row">${tags.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`;
}

function renderFallbackPatterns(report) {
  return asReportArray(report.severity).slice(0, 4).map((item) => renderPatternItem({
    pattern: item.name,
    frequency: item.level,
    impact: asReportArray(item.affectedPoints).join('、'),
    evidence: item.reason,
    intervention: item.recommendedAction
  })).join('');
}

function renderFallbackEvidence(report) {
  const points = flattenPoints(report).filter((item) => item.evidence || item.reason).slice(0, 5);
  return points.map((item) => renderEvidenceItem({
    confidence: item.status === 'severe' ? '高' : '中',
    finding: item.name,
    sourceEvidence: item.evidence || item.reason,
    inference: item.reason || '该知识点需要结合后续训练进一步复测。'
  })).join('');
}

function renderFallbackRootCauses(report) {
  return asReportArray(report.priority).slice(0, 4).map((item) => renderRootCauseItem({
    cause: item.name,
    mechanism: item.objective,
    symptoms: item.tasks,
    repairStrategy: `建议投入 ${item.estimatedDays || 3} 天完成专项修复。`
  })).join('');
}

function renderFallbackInterventions(report) {
  return asReportArray(report.route30).map((item) => renderInterventionItem({
    stage: item.dayRange,
    objective: item.focus,
    method: asReportArray(item.tasks).join('；'),
    successMetric: item.deliverable
  })).join('');
}

function asReportArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

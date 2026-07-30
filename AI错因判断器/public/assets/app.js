(function () {
  'use strict';

  const maxFileSize = 20 * 1024 * 1024;
  const allowedExtensions = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg'];
  const state = {
    file: null,
    report: null,
    source: null,
    analyzing: false,
    exporting: '',
    toastTimer: null,
    loadingTimer: null,
  };

  const elements = {
    form: document.querySelector('#diagnosis-form'),
    fileInput: document.querySelector('#question-file'),
    uploadZone: document.querySelector('#upload-zone'),
    uploadPlaceholder: document.querySelector('#upload-placeholder'),
    filePreview: document.querySelector('#file-preview'),
    fileName: document.querySelector('#file-name'),
    fileSize: document.querySelector('#file-size'),
    replaceFile: document.querySelector('#replace-file'),
    studentAnswer: document.querySelector('#student-answer'),
    answerCount: document.querySelector('#answer-count'),
    analyzeButton: document.querySelector('#analyze-button'),
    buttonContent: document.querySelector('.button-content'),
    buttonLoading: document.querySelector('.button-loading'),
    reportPanel: document.querySelector('.report-panel'),
    reportLoading: document.querySelector('#report-loading'),
    loadingMessage: document.querySelector('#loading-message'),
    downloadPdf: document.querySelector('#download-pdf'),
    downloadDocx: document.querySelector('#download-docx'),
    materialsDialog: document.querySelector('#materials-dialog'),
    materialsForm: document.querySelector('#materials-form'),
    openMaterials: document.querySelector('#open-materials'),
    materialCount: document.querySelector('#material-count'),
    reviewDialog: document.querySelector('#review-dialog'),
    reviewForm: document.querySelector('#review-form'),
    openReview: document.querySelector('#open-review'),
    toast: document.querySelector('#toast'),
    toastMessage: document.querySelector('#toast-message'),
    toastAction: document.querySelector('#toast-action'),
  };

  function initIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 2 } });
  }

  function renderMath(element) {
    if (!element || !window.renderMathInElement) return;
    window.renderMathInElement(element, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
      strict: 'error',
      trust: false,
    });
  }

  function getExtension(filename) {
    return filename.split('.').pop().toLowerCase();
  }

  function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function showToast(message, options = {}) {
    window.clearTimeout(state.toastTimer);
    elements.toastMessage.textContent = message;
    elements.toastAction.hidden = !options.settings;
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, options.duration || 5200);
  }

  function validateFile(file) {
    if (!allowedExtensions.includes(getExtension(file.name))) {
      return '仅支持 PDF、Word、PNG 或 JPG 文件';
    }
    if (file.size > maxFileSize) return '单个文件不能超过 20MB';
    if (file.size === 0) return '文件内容为空，请重新选择';
    return '';
  }

  function setFile(file) {
    const error = validateFile(file);
    if (error) {
      showToast(error);
      return;
    }
    state.file = file;
    elements.fileName.textContent = file.name;
    elements.fileSize.textContent = formatFileSize(file.size);
    elements.uploadPlaceholder.hidden = true;
    elements.filePreview.hidden = false;
    elements.uploadZone.classList.remove('is-invalid');
    initIcons();
  }

  function openFilePicker() {
    elements.fileInput.click();
  }

  elements.uploadZone.addEventListener('click', (event) => {
    if (!event.target.closest('button')) openFilePicker();
  });
  elements.uploadZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker();
    }
  });
  elements.fileInput.addEventListener('change', () => {
    if (elements.fileInput.files[0]) setFile(elements.fileInput.files[0]);
  });
  elements.replaceFile.addEventListener('click', (event) => {
    event.stopPropagation();
    openFilePicker();
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    elements.uploadZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.uploadZone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    elements.uploadZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.uploadZone.classList.remove('is-dragging');
    });
  });
  elements.uploadZone.addEventListener('drop', (event) => {
    const [file] = event.dataTransfer.files;
    if (file) setFile(file);
  });

  elements.studentAnswer.addEventListener('input', () => {
    elements.answerCount.textContent = elements.studentAnswer.value.length;
  });

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  elements.openMaterials.addEventListener('click', () => elements.materialsDialog.showModal());
  elements.openReview.addEventListener('click', () => {
    document.querySelector('#review-error-type').value = document.querySelector('#error-type-badge').textContent;
    elements.reviewDialog.showModal();
  });
  document.querySelectorAll('.dialog-close').forEach((button) => {
    button.addEventListener('click', () => closeDialog(button.closest('dialog')));
  });
  document.querySelectorAll('.app-dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });

  elements.materialsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = [
      document.querySelector('#correct-answer').value,
      document.querySelector('#standard-process').value,
      document.querySelector('#scoring-criteria').value,
      document.querySelector('#self-assessment').value,
    ];
    const count = values.filter((value) => value.trim()).length;
    elements.materialCount.textContent = count;
    elements.materialCount.hidden = count === 0;
    closeDialog(elements.materialsDialog);
    showToast(count ? `已保存 ${count} 项补充材料` : '补充材料已清空', { duration: 2400 });
  });

  elements.reviewForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const errorType = document.querySelector('#review-error-type').value;
    const note = document.querySelector('#review-note').value.trim();
    document.querySelector('#error-type-badge').textContent = errorType;
    document.querySelector('#summary-error-type').textContent = errorType;
    document.querySelector('#ai-judgment').textContent = errorType;
    if (note) document.querySelector('#error-type-reason').textContent = note;
    document.querySelector('#review-status').textContent = '教师已复核';
    if (state.report) {
      state.report.errorType = errorType;
      state.report.comparison.aiJudgment = errorType;
      if (note) state.report.errorTypeReason = note;
      state.report.needsTeacherReview = false;
      state.report.reviewReason = '';
    }
    renderMath(document.querySelector('#error-type-reason'));
    closeDialog(elements.reviewDialog);
    showToast('教师复核结果已更新', { duration: 2600 });
  });

  function setExportAvailability() {
    const disabled = !state.report || state.analyzing || Boolean(state.exporting);
    elements.downloadPdf.disabled = disabled;
    elements.downloadDocx.disabled = disabled;
  }

  function setLoading(isLoading) {
    state.analyzing = isLoading;
    elements.analyzeButton.disabled = isLoading;
    elements.buttonContent.hidden = isLoading;
    elements.buttonLoading.hidden = !isLoading;
    elements.reportLoading.hidden = !isLoading;
    window.clearInterval(state.loadingTimer);
    if (isLoading) {
      const messages = [
        '读取题目材料并还原学生作答链...',
        '对照原题与学生原始过程...',
        '定位第一个导致后续偏差的位置...',
        '整理证据与具体纠正动作...',
      ];
      let index = 0;
      elements.loadingMessage.textContent = messages[index];
      state.loadingTimer = window.setInterval(() => {
        index = Math.min(index + 1, messages.length - 1);
        elements.loadingMessage.textContent = messages[index];
      }, 2600);
    }
    setExportAvailability();
  }

  function setText(selector, value) {
    document.querySelector(selector).textContent = value;
  }

  function statusClass(status) {
    if (status === '正确') return 'is-correct';
    if (status === '首次出错') return 'is-error';
    if (status === '未判断') return 'is-unknown';
    return 'is-affected';
  }

  function renderTimeline(report) {
    report.timeline.forEach((item, index) => {
      const step = document.querySelector(`.timeline-step[data-step="${index + 1}"]`);
      step.className = `timeline-step ${statusClass(item.status)}`;
      step.querySelector('h3').textContent = item.stepName;
      step.querySelector('em').textContent = item.status;
      step.title = item.detail;
    });
    const progress = report.firstError.stepNumber === 0
      ? 0
      : Math.max(0, (report.firstError.stepNumber - 1) / 3 * 100);
    document.querySelector('#timeline-progress').style.width = `${progress}%`;
  }

  function renderChain(report) {
    const chain = document.querySelector('#error-chain');
    chain.replaceChildren();
    const affected = report.firstError.stepNumber === 0
      ? report.timeline.filter((item) => item.status === '未判断').slice(0, 2)
      : report.timeline.filter((item) => item.stepNumber > report.firstError.stepNumber);
    const fallback = report.firstError.stepNumber > 0
      ? report.timeline[report.firstError.stepNumber - 1]
      : report.timeline[0];
    const items = affected.length ? affected.slice(0, 3) : [fallback];
    items.forEach((item) => {
      const row = document.createElement('div');
      const dot = document.createElement('i');
      const paragraph = document.createElement('p');
      const status = document.createElement('b');
      const detail = document.createElement('small');
      paragraph.append(`第${item.stepNumber}步  ${item.stepName}：`);
      status.textContent = item.status;
      detail.textContent = `（${item.detail}）`;
      paragraph.append(status, detail);
      row.append(dot, paragraph);
      chain.append(row);
    });
  }

  function formatDate(isoDate) {
    const date = new Date(isoDate);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function renderReport(report) {
    state.report = report;
    setText('#summary-first-error', report.firstError.stepNumber === 0 ? '无法确定' : `第${report.firstError.stepNumber}步`);
    setText('#summary-error-type', report.errorType);
    setText('#first-error-location', report.firstError.stepNumber === 0 ? '信息不足：无法确定' : `第${report.firstError.stepNumber}步：${report.firstError.stepName}`);
    setText('#first-error-description', `${report.firstError.description}${report.firstError.impact ? `，${report.firstError.impact}` : ''}`);
    setText('#error-evidence', report.evidence);
    setText('#error-type-badge', report.errorType);
    setText('#error-type-reason', report.errorTypeReason);
    setText('#student-judgment', report.comparison.studentJudgment);
    setText('#ai-judgment', report.comparison.aiJudgment);
    setText('#comparison-conclusion', `结论：${report.comparison.conclusion}`);
    document.querySelector('#correction-action span').textContent = report.correction.action;
    setText('#correction-rationale', report.correction.rationale);
    setText('#review-status', report.needsTeacherReview ? '需要教师复核' : 'AI诊断完成');
    setText('#generated-time', formatDate(report.generatedAt));
    renderTimeline(report);
    renderChain(report);
    renderMath(elements.reportPanel);
    setExportAvailability();
  }

  function setExportLoading(format, isLoading) {
    const button = format === 'pdf' ? elements.downloadPdf : elements.downloadDocx;
    button.querySelector('.export-ready').hidden = isLoading;
    button.querySelector('.export-loading').hidden = !isLoading;
    if (isLoading) initIcons();
  }

  function getDownloadFilename(response, format) {
    const disposition = response.headers.get('Content-Disposition') || '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) {
      try {
        return decodeURIComponent(encoded);
      } catch (error) {
        // 响应头异常时使用本地安全文件名。
      }
    }
    const date = state.report?.generatedAt?.slice(0, 10).replaceAll('-', '') || '报告';
    const extension = format === 'pdf' ? 'pdf' : 'docx';
    return `AI错因诊断报告-${document.querySelector('#subject').value}-${date}.${extension}`;
  }

  async function downloadReport(format) {
    if (!state.report || state.exporting) return;
    state.exporting = format;
    setExportLoading(format, true);
    setExportAvailability();
    try {
      const response = await fetch(`/api/export/${format === 'pdf' ? 'pdf' : 'docx'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: document.querySelector('#subject').value,
          sourceFilename: state.source?.filename || '',
          report: state.report,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const error = new Error(payload?.message || '报告下载失败，请稍后重试');
        error.details = payload?.details;
        throw error;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = getDownloadFilename(response, format);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      showToast(format === 'pdf' ? 'PDF 报告已下载' : 'Word 报告已下载', { duration: 2600 });
    } catch (error) {
      showToast(error.details ? `${error.message}：${error.details}` : error.message, { duration: 12000 });
    } finally {
      setExportLoading(format, false);
      state.exporting = '';
      setExportAvailability();
    }
  }

  elements.downloadPdf.addEventListener('click', () => downloadReport('pdf'));
  elements.downloadDocx.addEventListener('click', () => downloadReport('docx'));

  function buildFormData() {
    const data = new FormData();
    data.append('questionFile', state.file, state.file.name);
    data.append('subject', document.querySelector('#subject').value);
    data.append('studentAnswer', elements.studentAnswer.value);
    data.append('correctAnswer', document.querySelector('#correct-answer').value);
    data.append('standardProcess', document.querySelector('#standard-process').value);
    data.append('scoringCriteria', document.querySelector('#scoring-criteria').value);
    data.append('selfAssessment', document.querySelector('#self-assessment').value);
    return data;
  }

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.file) {
      elements.uploadZone.classList.remove('is-invalid');
      void elements.uploadZone.offsetWidth;
      elements.uploadZone.classList.add('is-invalid');
      elements.uploadZone.focus();
      showToast('请先上传需要诊断的题目文件');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/analyze', { method: 'POST', body: buildFormData() });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(payload?.message || '分析失败，请稍后重试');
        error.code = payload?.code;
        error.details = payload?.details;
        throw error;
      }
      state.source = payload.source || null;
      renderReport(payload.report);
      if (payload.source?.warnings?.length) {
        showToast(payload.source.warnings.join('；'), { duration: 7000 });
      } else {
        showToast('错因诊断报告已生成', { duration: 2800 });
      }
      if (window.innerWidth <= 900) {
        document.querySelector('.report-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (error) {
      const settings = error.code === 'AI_NOT_CONFIGURED';
      showToast(error.details ? `${error.message}：${error.details}` : error.message, { settings, duration: 15000 });
    } finally {
      setLoading(false);
    }
  });

  initIcons();
  setExportAvailability();
}());

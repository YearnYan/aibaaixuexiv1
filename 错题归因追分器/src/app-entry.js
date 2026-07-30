import './style.css';
import './security-client.js';
import './main.js?v=20260625pdffix2';

const bindEvent = (id, eventName, handler) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(eventName, handler);
  }
};

bindEvent('wrongQuestionFile', 'change', (e) => window.handleWrongQuestionUpload(e.target, { autoGenerate: true }));
bindEvent('generateBtn', 'click', () => window.generateExam());
bindEvent('selectAllBtn', 'click', () => window.selectAllQuestions());
bindEvent('composeBtn', 'click', () => window.composeExam());
bindEvent('showAnswer', 'change', (e) => {
  const answerArea = document.getElementById('answerArea');
  if (answerArea) answerArea.style.display = e.target.checked ? 'block' : 'none';
  if (typeof window.saveSettings === 'function') {
    window.saveSettings();
  }
});
bindEvent('showOriginal', 'change', () => {
  if (typeof window.handleShowOriginalChange === 'function') {
    window.handleShowOriginalChange();
    return;
  }
  if (typeof window.saveSettings === 'function') {
    window.saveSettings();
  }
});
bindEvent('gradeSelect', 'change', () => window.saveSettings?.());
bindEvent('subjectSelect', 'change', () => window.saveSettings?.());
bindEvent('count_similar', 'change', () => window.saveSettings?.());
bindEvent('count_variant', 'change', () => window.saveSettings?.());
bindEvent('count_application', 'change', () => window.saveSettings?.());

const uploadZone = document.getElementById('uploadZone');
const uploadInput = document.getElementById('wrongQuestionFile');
if (uploadZone && uploadInput) {
  ['dragenter', 'dragover'].forEach((eventName) => {
    uploadZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      uploadZone.classList.add('dragging');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    uploadZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      uploadZone.classList.remove('dragging');
    });
  });
  uploadZone.addEventListener('drop', (event) => {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    uploadInput.files = files;
    window.handleWrongQuestionUpload(uploadInput, { autoGenerate: true });
  });
}

const backBtn = document.getElementById('backToMatrixBtn') || document.querySelector('.preview-bottom-bar .bar-btn');
if (backBtn) {
  backBtn.addEventListener('click', () => window.backToSelect());
}

const exportPdfBtn = document.getElementById('exportPdfBtn') || document.querySelectorAll('.preview-bottom-bar .bar-btn.primary')[0];
const exportWordBtn = document.getElementById('exportWordBtn') || document.querySelectorAll('.preview-bottom-bar .bar-btn.primary')[1];
if (exportPdfBtn) exportPdfBtn.addEventListener('click', () => window.exportToPdf());
if (exportWordBtn) exportWordBtn.addEventListener('click', () => window.exportToWord());

const modalCloseBtn = document.querySelector('#contactModal .modal-close');
if (modalCloseBtn) {
  modalCloseBtn.addEventListener('click', () => window.closeModal('contactModal'));
}

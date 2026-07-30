import './style.css';
import './main.js?v=20260725-editable-word-formulas';

const bindEvent = (id, eventName, handler) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(eventName, handler);
  }
};

bindEvent('examUploadInput', 'change', (event) => {
  window.handleUploadFiles(event.target.files);
  event.target.value = '';
});
bindEvent('generateBtn', 'click', () => window.generateExam());
bindEvent('showAnswer', 'change', (event) => {
  const answerArea = document.getElementById('answerArea');
  if (answerArea) answerArea.style.display = event.target.checked ? 'block' : 'none';
  if (typeof window.saveSettings === 'function') {
    window.saveSettings();
  }
});

const uploadBox = document.getElementById('examUploadBox');
if (uploadBox) {
  uploadBox.addEventListener('dragover', (event) => {
    event.preventDefault();
    uploadBox.classList.add('is-dragover');
  });
  uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('is-dragover'));
  uploadBox.addEventListener('drop', (event) => {
    event.preventDefault();
    uploadBox.classList.remove('is-dragover');
    window.handleUploadFiles(event.dataTransfer.files);
  });
}

const backBtn = document.querySelector('.preview-bottom-bar .bar-btn');
if (backBtn) {
  backBtn.addEventListener('click', () => window.backToSelect());
}

const exportButtons = document.querySelectorAll('.preview-bottom-bar .bar-btn.primary');
if (exportButtons[0]) {
  exportButtons[0].addEventListener('click', () => window.exportToPdf());
}
if (exportButtons[1]) {
  exportButtons[1].addEventListener('click', () => window.exportToWord());
}

const modalCloseBtn = document.querySelector('#contactModal .modal-close');
if (modalCloseBtn) {
  modalCloseBtn.addEventListener('click', () => window.closeModal('contactModal'));
}

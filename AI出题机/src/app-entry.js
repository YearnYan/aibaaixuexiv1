import './style.css';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import 'katex/contrib/mhchem';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import './security-client.js';
import './main.js';

window.katex = katex;
window.html2canvas = html2canvas;
window.jspdf = { ...(window.jspdf || {}), jsPDF };

function initializeHostBridge() {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    || window.location.protocol === 'file:';
  if (isLocal) return;

  const script = document.createElement('script');
  script.src = '/shared/hzq.js?v=20260630nav2';
  script.onload = () => {
    if (window.HZQ && typeof window.HZQ.init === 'function') window.HZQ.init('AI出卷机');
  };
  document.head.appendChild(script);
}

initializeHostBridge();

const bindEvent = (id, eventName, handler) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener(eventName, handler);
};

bindEvent('subject', 'change', () => window.onConfigChange());
bindEvent('grade', 'change', () => window.onConfigChange());
bindEvent('generateBtn', 'click', () => window.generateExam());
bindEvent('selectAllBtn', 'click', () => window.toggleSelectAllQuestions());
bindEvent('composeBtn', 'click', () => window.composeExam());
bindEvent('showAnswer', 'change', (event) => {
  const answerArea = document.getElementById('answerArea');
  if (answerArea) answerArea.style.display = event.target.checked ? 'block' : 'none';
  if (typeof window.saveSettings === 'function') window.saveSettings();
});
bindEvent('examType', 'change', () => {
  if (typeof window.saveSettings === 'function') window.saveSettings();
});

const backButton = document.querySelector('.preview-bottom-bar .bar-btn');
if (backButton) backButton.addEventListener('click', () => window.backToSelect());

const exportButtons = document.querySelectorAll('.preview-bottom-bar .bar-btn.primary');
if (exportButtons[0]) exportButtons[0].addEventListener('click', () => window.exportToPdf());
if (exportButtons[1]) exportButtons[1].addEventListener('click', () => window.exportToWord());

const modalCloseButton = document.querySelector('#contactModal .modal-close');
if (modalCloseButton) modalCloseButton.addEventListener('click', () => window.closeModal('contactModal'));

// ===== API =====
var trainingSessionId = '';
var submitting = false;

function createTrainingSession(gradeId, gradeLabel, subject, knowledgePoint) {
  return fetch('/api/training/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gradeId: gradeId,
      gradeLabel: gradeLabel,
      subject: subject,
      knowledgePoint: knowledgePoint
    })
  }).then(function(res) {
    if (!res.ok) {
      return res.json().catch(function() { return {}; }).then(function(data) {
        throw new Error(data.error || ('API ' + res.status));
      });
    }
    return res.json();
  }).then(function(data) {
    if (!data || !data.sessionId) throw new Error('会话创建失败');
    trainingSessionId = data.sessionId;
  });
}

function createGenerationRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'question-batch-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function generateBatch(gradeId, gradeLabel, subject, knowledgePoint) {
  if (!trainingSessionId) return Promise.reject(new Error('会话不存在'));
  return fetch('/api/training/questions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': createGenerationRequestId()
    },
    body: JSON.stringify({
      sessionId: trainingSessionId,
      gradeId: gradeId,
      gradeLabel: gradeLabel,
      subject: subject,
      knowledgePoint: knowledgePoint
    })
  }).then(function(res) {
    if (!res.ok) {
      return res.json().catch(function() { return {}; }).then(function(data) {
        throw new Error(data.error || ('API ' + res.status));
      });
    }
    return res.json();
  }).then(function(data) {
    if (!data || data.batchSize !== 10 || !data.batchId || !Array.isArray(data.questions)) {
      throw new Error('十题批次返回格式异常');
    }
    var questions = data.questions;
    var valid = [];
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      if (!q || typeof q !== 'object') continue;
      if (!q.questionId || !q.question) continue;
      if (!q.kp_shuffled || !q.method_shuffled || !q.trap_shuffled) continue;
      if (!Array.isArray(q.kp_shuffled.items) || !Array.isArray(q.method_shuffled.items) || !Array.isArray(q.trap_shuffled.items)) continue;
      if (q.kp_shuffled.items.length < 4 || q.method_shuffled.items.length < 4 || q.trap_shuffled.items.length < 4) continue;
      valid.push(q);
    }
    if (valid.length !== 10) throw new Error('十题尚未全部生成，请重新生成');
    return { batchId: data.batchId, questions: valid };
  });
}

function submitCurrentAnswer(questionId, selected) {
  if (!trainingSessionId) return Promise.reject(new Error('会话不存在'));
  return fetch('/api/training/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: trainingSessionId,
      questionId: questionId,
      selected: selected
    })
  }).then(function(res) {
    if (!res.ok) {
      return res.json().catch(function() { return {}; }).then(function(data) {
        throw new Error(data.error || ('API ' + res.status));
      });
    }
    return res.json();
  });
}

function installSourceProtection() {
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
  });
  document.addEventListener('keydown', function(e) {
    var key = (e.key || '').toLowerCase();
    var block = key === 'f12'
      || (e.ctrlKey && key === 'u')
      || (e.ctrlKey && e.shiftKey && (key === 'i' || key === 'j' || key === 'c'));
    if (block) {
      e.preventDefault();
    }
  });
}

// ===== 固定十题批次 =====
var questionBuffer = [];
var BATCH_SIZE = 10;
var generationInProgress = false;

function getGradeLabel() {
  for (var i = 0; i < GRADES.length; i++) {
    if (GRADES[i].id === state.grade) return GRADES[i].label;
  }
  return '';
}

function getKnowledgePoint() {
  var input = document.getElementById('knowledgeInput');
  return input ? input.value.trim() : state.knowledgePoint;
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeAcademicText(value) {
  var text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n');

  if (window.HZQ && typeof window.HZQ.normalizeReadableText === 'function') {
    text = window.HZQ.normalizeReadableText(text);
  }
  return text;
}

function latexToReadableText(value) {
  return String(value == null ? '' : value)
    .replace(/\\ce\s*\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, '根号($1)')
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:le|leq)\b/g, '≤')
    .replace(/\\(?:ge|geq)\b/g, '≥')
    .replace(/\\(?:ne|neq)\b/g, '≠')
    .replace(/\\approx\b/g, '≈')
    .replace(/\\pm\b/g, '±')
    .replace(/\\times\b/g, '×')
    .replace(/\\div\b/g, '÷')
    .replace(/\\cdot\b/g, '·')
    .replace(/\\rightarrow\b/g, '→')
    .replace(/\\leftarrow\b/g, '←')
    .replace(/\\Rightarrow\b/g, '⇒')
    .replace(/\\infty\b/g, '∞')
    .replace(/\\(?:left|right|,|;|!)/g, '')
    .replace(/[{}]/g, '');
}

function renderAcademicFormula(latex, displayMode) {
  try {
    if (!window.katex || typeof window.katex.renderToString !== 'function') throw new Error('KaTeX未加载');
    var html = window.katex.renderToString(latex.trim(), {
      displayMode: Boolean(displayMode),
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml'
    });
    return '<span class="academic-formula '+(displayMode?'academic-formula-display':'academic-formula-inline')+'">'+html+'</span>';
  } catch (error) {
    console.error('公式渲染失败:', error);
    return '<span class="academic-formula-fallback">'+escapeHtml(latexToReadableText(latex))+'</span>';
  }
}

function formatAcademicText(value) {
  var text = normalizeAcademicText(value);
  var pattern = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;
  var html = '';
  var cursor = 0;
  var match;
  while ((match = pattern.exec(text))) {
    html += escapeHtml(text.slice(cursor, match.index)).replace(/\n/g, '<br>');
    var source = match[0];
    var displayMode = source.indexOf('\\[') === 0 || source.indexOf('$$') === 0;
    var latex = source.indexOf('\\') === 0 ? source.slice(2, -2) : source.slice(displayMode ? 2 : 1, displayMode ? -2 : -1);
    html += renderAcademicFormula(latex, displayMode);
    cursor = match.index + source.length;
  }
  html += escapeHtml(text.slice(cursor)).replace(/\n/g, '<br>');
  return html;
}

function getNextQuestion() {
  if (questionBuffer.length === 0) return null;
  var q = questionBuffer.shift();
  updateBufferUI();
  return q;
}

function updateBufferUI() {
  var el = document.getElementById('bufferIndicator');
  if (!el) return;
  if (questionBuffer.length > 0) {
    el.textContent = '本组还剩 ' + questionBuffer.length + ' 题';
    el.classList.add('visible');
    setTimeout(function() { el.classList.remove('visible'); }, 1500);
  } else {
    el.textContent = '';
    el.classList.remove('visible');
  }
}

// ===== APP STATE =====
var GRADES = [
  { id: 'p3', label: '小学三年级', desc: '三年级' },
  { id: 'p4', label: '小学四年级', desc: '四年级' },
  { id: 'p5', label: '小学五年级', desc: '五年级' },
  { id: 'p6', label: '小学六年级', desc: '六年级' },
  { id: 'j1', label: '初一', desc: '七年级' },
  { id: 'j2', label: '初二', desc: '八年级' },
  { id: 'j3', label: '初三', desc: '九年级' },
  { id: 's1', label: '高一', desc: '十年级' },
  { id: 's2', label: '高二', desc: '十一年级' },
  { id: 's3', label: '高三', desc: '十二年级' }
];
var SUBJECTS_BY_GRADE = {
  p3: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'],
  p4: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'],
  p5: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'],
  p6: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'],
  j1: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'],
  j2: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'],
  j3: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'],
  s1: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'],
  s2: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'],
  s3: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治']
};
var state = {
  grade: null, subject: null, knowledgePoint: '',
  currentQuestion: null, questionNum: 0, batchId: '',
  selected: { kp: -1, method: -1, trap: -1 },
  batchResults: [], batchScore: 0,
  totalCount: 0, correctCount: 0, streak: 0
};

// --- Stats ---
function loadStats() {
  try {
    var s = JSON.parse(localStorage.getItem('tigan_stats_v2'));
    if (s) { state.totalCount = s.totalCount||0; state.correctCount = s.correctCount||0; state.streak = s.streak||0; }
  } catch(e) {}
  updateStatsUI();
}
function saveStats() {
  localStorage.setItem('tigan_stats_v2', JSON.stringify({
    totalCount: state.totalCount, correctCount: state.correctCount, streak: state.streak
  }));
}
function updateStatsUI() {
  document.getElementById('totalCount').textContent = state.totalCount;
  document.getElementById('avgScore').textContent = state.totalCount > 0
    ? Math.round(state.correctCount / (state.totalCount * 3) * 100) + '%' : '-';
  document.getElementById('streak').textContent = state.streak;
}

// --- Screen ---
function showScreen(id) {
  var screens = document.querySelectorAll('.screen');
  for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
  document.getElementById(id).classList.add('active');
  document.body.setAttribute('data-screen', id);
  window.scrollTo(0, 0);
}

// --- Setup ---
function renderSetup() {
  var g = document.getElementById('gradeGrid'), h = '';
  for (var i = 0; i < GRADES.length; i++) {
    var gr = GRADES[i];
    h += '<div class="chip" data-grade="'+gr.id+'" onclick="selectGrade(\''+gr.id+'\')">'+gr.label+'<br><small style="font-size:12px;opacity:0.5">'+gr.desc+'</small></div>';
  }
  g.innerHTML = h;
  renderSubjects();
}
function selectGrade(id) {
  state.grade = id; state.subject = null;
  var c = document.querySelectorAll('#gradeGrid .chip');
  for (var i = 0; i < c.length; i++) c[i].classList.toggle('active', c[i].getAttribute('data-grade')===id);
  renderSubjects(); checkReady();
}
function renderSubjects() {
  var g = document.getElementById('subjectGrid');
  if (!state.grade) { g.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text2);font-size:15px;padding:16px;">请先选择年级</div>'; return; }
  var s = SUBJECTS_BY_GRADE[state.grade], h = '';
  for (var i = 0; i < s.length; i++) h += '<div class="chip" data-subject="'+s[i]+'" onclick="selectSubject(\''+s[i]+'\')">'+s[i]+'</div>';
  g.innerHTML = h;
}
function selectSubject(name) {
  state.subject = name;
  var c = document.querySelectorAll('#subjectGrid .chip');
  for (var i = 0; i < c.length; i++) c[i].classList.toggle('active', c[i].getAttribute('data-subject')===name);
  checkReady();
}
function checkReady() {
  state.knowledgePoint = getKnowledgePoint();
  document.getElementById('startBtn').disabled = !(state.grade && state.subject && state.knowledgePoint);
}

// --- Step-based choice flow ---
var STEPS = [
  { key: 'kp', label: '这道题考的是什么知识点？', dataKey: 'kp_shuffled' },
  { key: 'method', label: '用什么方法切入？', dataKey: 'method_shuffled' },
  { key: 'trap', label: '陷阱在哪？', dataKey: 'trap_shuffled' }
];
var currentStep = 0;
var choiceToken = 0;

function getFirstMissingStepIndex() {
  for (var i = 0; i < STEPS.length; i++) {
    if (state.selected[STEPS[i].key] === -1) return i;
  }
  return -1;
}

function selectChoice(idx) {
  var stepIndex = currentStep;
  var step = STEPS[stepIndex];
  if (!step) return;
  state.selected[step.key] = idx;
  var items = document.getElementById('choiceOptions').querySelectorAll('.choice-item');
  for (var i = 0; i < items.length; i++) items[i].classList.toggle('selected', i === idx);
  choiceToken++;
  choiceToken++;
  var token = choiceToken;
  setTimeout(function() {
    if (token !== choiceToken) return;
    if (stepIndex < 2) {
      if (currentStep !== stepIndex) return;
      currentStep = stepIndex + 1;
      transitionToStep();
    }
    else { submitAnswer(); }
  }, 300);
}
function transitionToStep() {
  var card = document.getElementById('choiceCard');
  card.classList.add('swapping');
  setTimeout(function() { renderCurrentStep(); card.classList.remove('swapping'); }, 150);
}
function renderCurrentStep() {
  var step = STEPS[currentStep], q = state.currentQuestion, data = q[step.dataKey];
  document.getElementById('choiceStepNum').textContent = (currentStep+1) + ' / 3';
  document.getElementById('choiceLabel').textContent = step.label;
  for (var i = 0; i < 3; i++) {
    var dot = document.getElementById('stepDot'+i);
    dot.className = 'step-dot';
    if (i < currentStep) dot.classList.add('done');
    else if (i === currentStep) dot.classList.add('active');
  }
  var c = document.getElementById('choiceOptions'), labels = ['A','B','C','D'], h = '';
  for (var i = 0; i < data.items.length; i++) {
    h += '<div class="choice-item" onclick="selectChoice('+i+')"><span class="choice-letter">'+labels[i]+'</span><span class="choice-text">'+formatAcademicText(data.items[i])+'</span></div>';
  }
  c.innerHTML = h;
}

// --- Training ---
async function hasGenerationCredit() {
  if (!window.HZQ || typeof window.HZQ.checkCredit !== 'function') return true;
  try {
    return await window.HZQ.checkCredit();
  } catch (error) {
    console.error('积分校验失败:', error);
    window.alert('积分状态校验失败，请检查网络后重试。');
    return false;
  }
}

function acceptTrainingBatch(batch) {
  state.batchId = batch.batchId;
  state.questionNum = 0;
  state.currentQuestion = null;
  state.batchResults = [];
  state.batchScore = 0;
  questionBuffer = batch.questions.slice();
  updateBufferUI();
  showNextQuestion();
}

async function startTraining() {
  if (generationInProgress) return;
  generationInProgress = true;
  if (!(await hasGenerationCredit())) {
    generationInProgress = false;
    return;
  }
  trainingSessionId = '';
  submitting = false;
  questionBuffer = [];
  state.knowledgePoint = getKnowledgePoint();
  showScreen('loadingScreen');
  document.getElementById('loadingText').textContent = 'AI正在一次性生成10题...';
  document.getElementById('loadingProgress').textContent = '全部题目完成后才会开始训练，训练中不再生成新题';

  try {
    await createTrainingSession(state.grade, getGradeLabel(), state.subject, state.knowledgePoint);
    var batch = await generateBatch(state.grade, getGradeLabel(), state.subject, state.knowledgePoint);
    acceptTrainingBatch(batch);
  } catch (e) {
    console.error('生成十题失败:', e);
    document.getElementById('loadingText').textContent = '生成失败：' + e.message;
    document.getElementById('loadingProgress').textContent = '本次失败不会保留未完成题目，请稍后重试';
    setTimeout(function() { showScreen('setupScreen'); }, 3000);
  } finally {
    generationInProgress = false;
  }
}

async function continueTraining() {
  if (generationInProgress || state.questionNum !== BATCH_SIZE) return;
  generationInProgress = true;
  if (!(await hasGenerationCredit())) {
    generationInProgress = false;
    return;
  }
  showScreen('loadingScreen');
  document.getElementById('loadingText').textContent = 'AI正在继续生成10题...';
  document.getElementById('loadingProgress').textContent = '本次点击只生成这一组，完整生成后开始训练';
  try {
    var batch = await generateBatch(state.grade, getGradeLabel(), state.subject, state.knowledgePoint);
    acceptTrainingBatch(batch);
  } catch (e) {
    console.error('继续生成十题失败:', e);
    document.getElementById('loadingText').textContent = '生成失败：' + e.message;
    document.getElementById('loadingProgress').textContent = '可返回本轮结果后再次尝试';
    setTimeout(function() { showScreen('summaryScreen'); }, 3000);
  } finally {
    generationInProgress = false;
  }
}

function showNextQuestion() {
  if (state.questionNum >= BATCH_SIZE) {
    renderBatchSummary();
    showScreen('summaryScreen');
    return;
  }
  var q = getNextQuestion();
  if (!q) {
    window.alert('当前十题数据不完整，请返回后重新生成。');
    showScreen('setupScreen');
    return;
  }
  state.questionNum++;
  state.currentQuestion = q;
  state.selected = { kp: -1, method: -1, trap: -1 };
  currentStep = 0;
  renderQuestion(q);
  showScreen('questionScreen');
}

function renderQuestion(q) {
  var d = q.difficulty || 3;
  var diffLabels = ['','基础','较易','中等','较难','困难'];
  var badge = document.getElementById('diffBadge');
  badge.textContent = diffLabels[d] || '中等';
  badge.className = 'question-badge difficulty-' + d;
  document.getElementById('questionNum').textContent = '第 ' + state.questionNum + ' / ' + BATCH_SIZE + ' 题';
  document.getElementById('questionText').innerHTML = formatAcademicText(q.question);
  currentStep = 0;
  choiceToken = 0;
  renderCurrentStep();
  var bar = document.getElementById('progressBar');
  bar.style.display = 'flex';
  var dots = '';
  for (var i = 0; i < BATCH_SIZE; i++) {
    var cls = 'progress-dot';
    if (i < state.questionNum - 1) cls += ' done';
    else if (i === state.questionNum - 1) cls += ' current';
    dots += '<div class="'+cls+'"></div>';
  }
  bar.innerHTML = dots;
}

// --- Submit & Score ---
async function submitAnswer() {
  var missingStep = getFirstMissingStepIndex();
  if (missingStep !== -1) {
    if (currentStep !== missingStep) {
      currentStep = missingStep;
      transitionToStep();
    }
    return;
  }
  if (submitting) return;
  var q = state.currentQuestion;
  if (!q || !q.questionId) return;
  submitting = true;
  try {
    var result = await submitCurrentAnswer(q.questionId, {
      kp: state.selected.kp,
      method: state.selected.method,
      trap: state.selected.trap
    });

    state.totalCount++;
    state.correctCount += result.score;
    state.batchScore += result.score;
    state.batchResults.push(result);
    if (result.score === 3) state.streak++;
    else state.streak = 0;
    saveStats();
    updateStatsUI();

    renderFeedback(result);
    var nextButton = document.getElementById('feedbackNextBtn');
    nextButton.textContent = state.questionNum >= BATCH_SIZE ? '查看本轮结果' : '下一题';
    showScreen('feedbackScreen');
  } catch (e) {
    console.error('Submit error:', e);
    window.alert('提交失败：' + e.message);
  } finally {
    submitting = false;
  }
}

// --- Feedback ---
function renderFeedback(result) {
  var el = document.getElementById('scoreNum');
  el.textContent = result.score;
  el.className = 'score-number ' + (result.score===3?'perfect':result.score>=2?'good':'bad');
  var items = [
    {label:'知识点',correct:result.kpCorrect,selected:result.kpSelected,answer:result.kpAnswer},
    {label:'方法',correct:result.methodCorrect,selected:result.methodSelected,answer:result.methodAnswer},
    {label:'陷阱',correct:result.trapCorrect,selected:result.trapSelected,answer:result.trapAnswer}
  ];
  var c = document.getElementById('evalContainer'), h = '';
  for (var i = 0; i < items.length; i++) {
    var it = items[i], st = it.correct?'correct':'wrong', icon = it.correct?'\u2705':'\u274c';
    h += '<div class="eval-item '+st+'"><div class="eval-label">'+icon+' '+it.label+'判断：'+(it.correct?'正确':'错误')+'</div><div class="eval-comment">';
    if (!it.correct) h += '你选了：'+formatAcademicText(it.selected)+'<br>正确答案：'+formatAcademicText(it.answer);
    else h += formatAcademicText(it.answer);
    h += '</div></div>';
  }
  c.innerHTML = h;
  document.getElementById('correctAnalysis').innerHTML = '<h4>解析</h4><p>'+formatAcademicText(result.explanation||'暂无解析')+'</p>';
}

function renderBatchSummary() {
  var total = state.batchScore;
  var el = document.getElementById('summaryScore');
  el.textContent = total;
  el.className = 'score-number '+(total>=25?'perfect':total>=18?'good':'bad');
  var list = document.getElementById('summaryList'), h = '';
  for (var i = 0; i < state.batchResults.length; i++) {
    var r = state.batchResults[i];
    var lv = r.score===3?'high':r.score>=2?'mid':'low';
    h += '<div class="batch-summary-item"><div class="batch-q-num '+lv+'">'+(i+1)+'</div><div class="batch-q-text">'+formatAcademicText(r.question)+'</div><div class="batch-q-score">'+r.score+'/3</div></div>';
  }
  list.innerHTML = h;
  var avg = total/BATCH_SIZE, tip = '';
  if (avg>=2.5) tip='审题能力很强！你能快速抓住题目的核心考点。';
  else if (avg>=1.5) tip='审题感觉不错，陷阱识别还可以再加强。';
  else tip='继续训练，重点关注题目中的关键条件和隐含信息。';
  document.getElementById('summaryTip').textContent = tip;
}

function nextQuestion() { showNextQuestion(); }
function backToSetup() {
  trainingSessionId = '';
  submitting = false;
  generationInProgress = false;
  questionBuffer = [];
  state.currentQuestion = null;
  state.batchResults = [];
  state.batchScore = 0;
  state.streak=0; saveStats(); updateStatsUI(); showScreen('setupScreen');
}

// --- Init ---
installSourceProtection();
loadStats();
renderSetup();
var knowledgeInput = document.getElementById('knowledgeInput');
if (knowledgeInput) {
  knowledgeInput.addEventListener('input', function() {
    state.knowledgePoint = knowledgeInput.value.trim();
    questionBuffer = [];
    checkReady();
  });
}
document.body.setAttribute('data-screen', 'setupScreen');

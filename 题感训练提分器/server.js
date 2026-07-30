const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { auditAcademicText } = require('./academic-content');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || process.env.BIND_HOST || '127.0.0.1';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 30 * 60 * 1000);
const QUESTION_SOURCE_URL = process.env.QUESTION_SOURCE_URL || '';
const PLATFORM_MODE = process.env.PLATFORM_MODE === '1';
const PLATFORM_AI_BASE_URL = (process.env.PLATFORM_AI_BASE_URL || process.env.AI_BASE_URL || '').replace(/\/+$/, '');
const PLATFORM_AI_API_KEY = process.env.PLATFORM_AI_API_KEY || process.env.AI_API_KEY || '';
const PLATFORM_AI_MODEL = process.env.PLATFORM_AI_MODEL || process.env.AI_MODEL || 'platform-managed';
const TRAINING_BATCH_SIZE = 10;
const MAX_GENERATION_ATTEMPTS = 3;
const MAX_SOURCE_RESULT_COUNT = 20;
const SOURCE_RETRY_DELAYS_MS = [250, 750];
const distRoot = path.join(__dirname, 'dist');
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !fs.existsSync(distRoot)) {
  throw new Error('生产模式下缺少 dist 目录，请先执行 npm run build');
}
const staticRoot = isProduction ? distRoot : __dirname;

const sessions = new Map();

function now() {
  return Date.now();
}

function clampInteger(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n);
}

function sanitizePlainText(text) {
  if (text === null || text === undefined) return '';
  let t = String(text);
  t = t.replace(/```(?:json)?/gi, '').replace(/```/g, '');
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  t = t.replace(/�/g, '');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\s*\n\s*/g, '\n').trim();
  return t;
}

function sanitizeChoiceArray(list, subject) {
  if (!Array.isArray(list) || list.length !== 4) return [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const normalized = auditAcademicText(
      String(list[i] == null ? '' : list[i]).replace(/^\s*[A-D][.、．):：）]\s*/u, ''),
      subject,
    );
    if (!normalized.text || normalized.issues.length > 0) return [];
    out.push(normalized.text);
  }
  return new Set(out).size === out.length ? out : [];
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function shuffleChoices(choices, answerIdx) {
  if (!choices || choices.length < 4) return { items: choices || [], correct: answerIdx || 0 };
  const correctText = choices[answerIdx] || choices[0];
  const shuffled = shuffleArray(choices);
  let newIdx = 0;
  for (let i = 0; i < shuffled.length; i += 1) {
    if (shuffled[i] === correctText) {
      newIdx = i;
      break;
    }
  }
  return { items: shuffled, correct: newIdx };
}

function parseAnswerIndex(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 3) return -1;
  return n;
}

function normalizeQuestionItem(rawQuestion, subject) {
  if (!rawQuestion || typeof rawQuestion !== 'object') return null;
  const q = { ...rawQuestion };
  const normalizedQuestion = auditAcademicText(q.question, subject);
  const normalizedExplanation = auditAcademicText(q.explanation || '', subject);
  if (normalizedQuestion.issues.length > 0 || normalizedExplanation.issues.length > 0) return null;
  q.question = normalizedQuestion.text;
  q.explanation = normalizedExplanation.text;
  q.kp_choices = sanitizeChoiceArray(q.kp_choices, subject);
  q.method_choices = sanitizeChoiceArray(q.method_choices, subject);
  q.trap_choices = sanitizeChoiceArray(q.trap_choices, subject);
  if (!q.question || !q.explanation || q.kp_choices.length !== 4 || q.method_choices.length !== 4 || q.trap_choices.length !== 4) {
    return null;
  }

  const kpAnswer = parseAnswerIndex(q.kp_answer);
  const methodAnswer = parseAnswerIndex(q.method_answer);
  const trapAnswer = parseAnswerIndex(q.trap_answer);
  if (kpAnswer === -1 || methodAnswer === -1 || trapAnswer === -1) return null;
  const kpShuffled = shuffleChoices(q.kp_choices, kpAnswer);
  const methodShuffled = shuffleChoices(q.method_choices, methodAnswer);
  const trapShuffled = shuffleChoices(q.trap_choices, trapAnswer);
  const difficulty = clampInteger(q.difficulty, 1, 5, 3);
  const questionId = crypto.randomUUID();

  return {
    publicQuestion: {
      questionId,
      question: q.question,
      difficulty,
      kp_shuffled: { items: kpShuffled.items },
      method_shuffled: { items: methodShuffled.items },
      trap_shuffled: { items: trapShuffled.items }
    },
    privateAnswer: {
      question: q.question,
      kpCorrectIndex: kpShuffled.correct,
      methodCorrectIndex: methodShuffled.correct,
      trapCorrectIndex: trapShuffled.correct,
      kpOptions: kpShuffled.items,
      methodOptions: methodShuffled.items,
      trapOptions: trapShuffled.items,
      explanation: q.explanation || ''
    }
  };
}

function makeError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function isTransientUpstreamStatus(statusCode) {
  return statusCode === 408
    || statusCode === 425
    || statusCode === 429
    || statusCode >= 500;
}

function markRetryable(error) {
  error.retryable = true;
  return error;
}

function isRetryableSourceError(error) {
  if (error?.retryable === true) return true;
  if (error instanceof TypeError) return true;
  return ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']
    .includes(error?.code);
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getSessionOrThrow(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw makeError('缺少会话信息，请重新开始训练', 400);
  }
  const session = sessions.get(sessionId);
  if (!session) {
    throw makeError('会话已失效，请重新开始训练', 404);
  }
  if (now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    throw makeError('会话已过期，请重新开始训练', 410);
  }
  session.updatedAt = now();
  return session;
}

function createSession(payload) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    id: sessionId,
    createdAt: now(),
    updatedAt: now(),
    meta: {
      gradeId: payload.gradeId,
      gradeLabel: payload.gradeLabel,
      subject: payload.subject,
      knowledgePoint: payload.knowledgePoint
    },
    answerBank: new Map(),
    activeBatchId: null,
    batchNumber: 0,
    generationInProgress: false
  });
  return sessionId;
}

function cleanupExpiredSessions() {
  const t = now();
  for (const [sessionId, session] of sessions.entries()) {
    if (t - session.updatedAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
    }
  }
}

async function fetchRawQuestionsFromSource(payload) {
  if (PLATFORM_MODE) {
    return fetchRawQuestionsFromPlatformAI(payload);
  }
  if (!QUESTION_SOURCE_URL) {
    throw makeError('服务端未配置题源地址 QUESTION_SOURCE_URL', 500);
  }

  const response = await fetch(QUESTION_SOURCE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = makeError(`题源服务异常(${response.status}) ${text.slice(0, 120)}`, 502);
    if (isTransientUpstreamStatus(response.status)) markRetryable(error);
    throw error;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw markRetryable(makeError('题源返回格式异常：JSON 解析失败', 502));
  }
  if (!Array.isArray(data)) {
    throw markRetryable(makeError('题源返回格式异常：不是数组', 502));
  }
  return data;
}

async function fetchRawQuestionsWithRetry(payload) {
  let lastError;
  for (let attempt = 0; attempt <= SOURCE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchRawQuestionsFromSource(payload);
    } catch (error) {
      lastError = error;
      if (!isRetryableSourceError(error) || attempt === SOURCE_RETRY_DELAYS_MS.length) {
        throw error;
      }
      // 首次调用可能遇到 AI 冷启动或短暂网关异常，在本次点击内自动恢复。
      await wait(SOURCE_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

function buildQuestionPrompt(payload) {
  const avoided = Array.isArray(payload.avoidQuestions) && payload.avoidQuestions.length > 0
    ? `不要重复以下已通过题目：\n${payload.avoidQuestions.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
    : '';
  return [
    '请生成题感训练题目，只返回一个 JSON 对象，不要输出 Markdown 或额外说明。',
    `年级：${payload.gradeLabel || payload.gradeId}；学科：${payload.subject}；知识点：${payload.knowledgePoint}；本次需要 ${payload.count} 题。`,
    '返回对象必须包含 questions 数组；每题字段为 question、difficulty、kp_choices、kp_answer、method_choices、method_answer、trap_choices、trap_answer、explanation。',
    'kp_choices、method_choices、trap_choices 都必须恰好 4 项且内容互不重复，不要带 A/B/C/D 序号；答案字段必须是 0 到 3 的整数。',
    '题目必须互不重复，围绕指定知识点且符合该年级真实教学内容；干扰项必须对应可解释的典型错误，解析必须说明判断依据。',
    String.raw`所有字段中的学科符号和公式必须使用标准 LaTeX：行内公式统一使用 \(...\)，独立公式统一使用 \[...\]；JSON 字符串中的反斜杠必须双写。`,
    String.raw`数学需规范表达分式、根式、幂、函数、集合、向量、数列、极限、导数、积分、矩阵和分段函数；物理量、矢量与单位使用 LaTeX，例如 \(F=ma\)、\(9.8\,\mathrm{m/s^2}\)。`,
    String.raw`化学式、离子、电子、价态和反应方程式必须在公式内使用 mhchem 的 \ce{...}，例如 \(\ce{2H2 + O2 -> 2H2O}\)，不得使用 H2O、CO2、Fe3+ 等裸文本伪公式。`,
    String.raw`生物中的遗传组合、比例、物质转化和生理计算，地理中的比例尺、经纬度、坡度、时区和统计公式，也必须放入 LaTeX 定界符。`,
    '严禁在公式外使用 ^、sqrt、*、/ 代替规范结构，严禁裸露 LaTeX 命令、Unicode 上下标、希腊字母、根号、运算符、箭头、乱码或不可识别字符。',
    '没有公式的普通语言内容保持自然、准确、可读；上述规则作用于题干、全部选项和解析，不得遗漏任何字段。',
    avoided,
  ].filter(Boolean).join('\n');
}

async function fetchRawQuestionsFromPlatformAI(payload) {
  if (!PLATFORM_AI_BASE_URL || !PLATFORM_AI_API_KEY) {
    throw makeError('平台 AI 服务尚未配置，请联系管理员', 500);
  }
  const prompt = buildQuestionPrompt(payload);
  const response = await fetch(`${PLATFORM_AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PLATFORM_AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: PLATFORM_AI_MODEL,
      temperature: 0.3,
      max_tokens: 16000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是严谨的K12题感训练设计师，输出必须是可解析的JSON。' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = makeError(`平台 AI 服务异常(${response.status}) ${text.slice(0, 160)}`, 502);
    if (isTransientUpstreamStatus(response.status)) markRetryable(error);
    throw error;
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw markRetryable(makeError('平台 AI 返回格式异常：JSON 解析失败', 502));
  }
  const content = result?.choices?.[0]?.message?.content;
  const raw = typeof content === 'string' ? content.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim() : '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const objectStart = raw.indexOf('{');
    const objectEnd = raw.lastIndexOf('}');
    if (objectStart < 0 || objectEnd <= objectStart) {
      throw markRetryable(makeError('平台 AI 返回格式异常', 502));
    }
    try {
      parsed = JSON.parse(raw.slice(objectStart, objectEnd + 1));
    } catch {
      throw markRetryable(makeError('平台 AI 返回格式异常', 502));
    }
  }
  const questions = Array.isArray(parsed) ? parsed : parsed?.questions;
  if (!Array.isArray(questions)) {
    throw markRetryable(makeError('平台 AI 未返回题目数组', 502));
  }
  return questions.slice(0, MAX_SOURCE_RESULT_COUNT);
}

async function generateCompleteQuestionBatch(payload) {
  const normalizedQuestions = [];
  const seenQuestions = new Set();
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS && normalizedQuestions.length < TRAINING_BATCH_SIZE; attempt += 1) {
    const missingCount = TRAINING_BATCH_SIZE - normalizedQuestions.length;
    const rawQuestions = await fetchRawQuestionsWithRetry({
      ...payload,
      count: Math.min(TRAINING_BATCH_SIZE, missingCount + (attempt > 0 ? 2 : 0)),
      avoidQuestions: normalizedQuestions.map((item) => item.publicQuestion.question),
    });
    for (const rawQuestion of rawQuestions) {
      if (normalizedQuestions.length >= TRAINING_BATCH_SIZE) break;
      const normalized = normalizeQuestionItem(rawQuestion, payload.subject);
      if (!normalized) continue;
      const questionKey = normalized.publicQuestion.question.replace(/\s+/gu, '').toLocaleLowerCase('zh-CN');
      if (seenQuestions.has(questionKey)) continue;
      seenQuestions.add(questionKey);
      normalizedQuestions.push(normalized);
    }
  }
  if (normalizedQuestions.length !== TRAINING_BATCH_SIZE) {
    throw makeError(`生成结果未通过学科公式与完整性校验，仅得到 ${normalizedQuestions.length}/${TRAINING_BATCH_SIZE} 题，请重新生成`, 502);
  }
  return normalizedQuestions;
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.get('/api/training/health', (_req, res) => {
  res.json({
    ok: true,
    sessionCount: sessions.size,
    sourceConfigured: Boolean(QUESTION_SOURCE_URL || (PLATFORM_AI_BASE_URL && PLATFORM_AI_API_KEY)),
    batchSize: TRAINING_BATCH_SIZE
  });
});

app.post('/api/training/session', (req, res, next) => {
  try {
    const body = req.body || {};
    const gradeId = sanitizePlainText(body.gradeId);
    const gradeLabel = sanitizePlainText(body.gradeLabel);
    const subject = sanitizePlainText(body.subject);
    const knowledgePoint = sanitizePlainText(body.knowledgePoint).slice(0, 80);
    if (!gradeId || !subject || !knowledgePoint) {
      throw makeError('参数缺失：gradeId/subject/knowledgePoint', 400);
    }
    const sessionId = createSession({ gradeId, gradeLabel, subject, knowledgePoint });
    res.json({
      sessionId,
      ttlMs: SESSION_TTL_MS,
      batchSize: TRAINING_BATCH_SIZE
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/training/questions', async (req, res, next) => {
  let session;
  try {
    const body = req.body || {};
    session = getSessionOrThrow(body.sessionId);
    const gradeId = sanitizePlainText(body.gradeId || session.meta.gradeId);
    const gradeLabel = sanitizePlainText(body.gradeLabel || session.meta.gradeLabel);
    const subject = sanitizePlainText(body.subject || session.meta.subject);
    const knowledgePoint = sanitizePlainText(body.knowledgePoint || session.meta.knowledgePoint).slice(0, 80);
    if (!gradeId || !subject || !knowledgePoint) {
      throw makeError('参数缺失：gradeId/subject/knowledgePoint', 400);
    }

    // 会话参数不允许中途切换，避免混淆题目与判分。
    if (session.meta.gradeId !== gradeId || session.meta.subject !== subject || session.meta.knowledgePoint !== knowledgePoint) {
      throw makeError('会话参数与当前请求不一致，请重新开始训练', 400);
    }
    if (session.generationInProgress) {
      throw makeError('当前十题正在生成，请勿重复点击', 409);
    }
    if (session.answerBank.size > 0) {
      throw makeError('请先完成当前十题，再继续生成下一组', 409);
    }

    session.generationInProgress = true;
    const normalizedQuestions = await generateCompleteQuestionBatch({ gradeId, gradeLabel, subject, knowledgePoint });
    const batchId = crypto.randomUUID();
    session.activeBatchId = batchId;
    session.batchNumber += 1;
    const publicQuestions = normalizedQuestions.map((normalized) => {
      session.answerBank.set(normalized.publicQuestion.questionId, {
        ...normalized.privateAnswer,
        batchId,
      });
      return { ...normalized.publicQuestion, batchId };
    });

    res.json({
      batchId,
      batchSize: TRAINING_BATCH_SIZE,
      questions: publicQuestions,
    });
  } catch (err) {
    next(err);
  } finally {
    if (session) session.generationInProgress = false;
  }
});

app.post('/api/training/submit', (req, res, next) => {
  try {
    const body = req.body || {};
    const session = getSessionOrThrow(body.sessionId);
    const questionId = sanitizePlainText(body.questionId);
    if (!questionId) {
      throw makeError('参数缺失：questionId', 400);
    }

    const answer = session.answerBank.get(questionId);
    if (!answer) {
      throw makeError('题目状态失效，请跳过当前题', 404);
    }

    const selected = body.selected || {};
    const kpSelectedIndex = parseAnswerIndex(selected.kp);
    const methodSelectedIndex = parseAnswerIndex(selected.method);
    const trapSelectedIndex = parseAnswerIndex(selected.trap);
    if (kpSelectedIndex === -1 || methodSelectedIndex === -1 || trapSelectedIndex === -1) {
      throw makeError('答案参数错误', 400);
    }

    const kpCorrect = kpSelectedIndex === answer.kpCorrectIndex;
    const methodCorrect = methodSelectedIndex === answer.methodCorrectIndex;
    const trapCorrect = trapSelectedIndex === answer.trapCorrectIndex;
    const score = (kpCorrect ? 1 : 0) + (methodCorrect ? 1 : 0) + (trapCorrect ? 1 : 0);

    // 一题仅可提交一次，避免通过反复试探还原答案。
    session.answerBank.delete(questionId);
    if (session.answerBank.size === 0) session.activeBatchId = null;

    res.json({
      question: answer.question,
      score,
      kpCorrect,
      methodCorrect,
      trapCorrect,
      kpSelected: answer.kpOptions[kpSelectedIndex] || '',
      methodSelected: answer.methodOptions[methodSelectedIndex] || '',
      trapSelected: answer.trapOptions[trapSelectedIndex] || '',
      kpAnswer: answer.kpOptions[answer.kpCorrectIndex] || '',
      methodAnswer: answer.methodOptions[answer.methodCorrectIndex] || '',
      trapAnswer: answer.trapOptions[answer.trapCorrectIndex] || '',
      explanation: answer.explanation || ''
    });
  } catch (err) {
    next(err);
  }
});

app.get('/vendor/katex/mhchem.min.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'katex', 'dist', 'contrib', 'mhchem.min.js'));
});

app.use('/vendor/katex', express.static(path.join(__dirname, 'node_modules', 'katex', 'dist'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '30d' : 0,
}));

app.use(express.static(staticRoot, {
  extensions: ['html'],
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }
  res.sendFile(path.join(staticRoot, 'index.html'));
});

app.use((err, _req, res, _next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || '服务异常'
  });
});

setInterval(cleanupExpiredSessions, Math.min(SESSION_TTL_MS, 60 * 1000)).unref();

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${PORT}`);
    console.log(`[server] static root: ${staticRoot}`);
    console.log(`[server] source configured: ${Boolean(QUESTION_SOURCE_URL || PLATFORM_AI_BASE_URL)}`);
  });
}

module.exports = {
  app,
  buildQuestionPrompt,
  generateCompleteQuestionBatch,
  normalizeQuestionItem,
  sessions,
  TRAINING_BATCH_SIZE,
};

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 18 * 1024 * 1024
  }
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || process.env.BIND_HOST || '127.0.0.1';
const AI_BASE_URL = (process.env.AI_BASE_URL || '').replace(/\/$/, '');
const AI_MODEL = process.env.AI_MODEL || 'gemini-3.5-flash';
const AI_API_KEY = process.env.AI_API_KEY || '';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.png', '.jpg', '.jpeg', '.txt', '.md']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const MAX_TEXT_CHARS_PER_FILE = 22000;
const wordExtractor = new WordExtractor();

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    model: AI_MODEL,
    time: new Date().toISOString()
  });
});

app.post('/api/analyze', upload.any(), async (req, res) => {
  try {
    if (!AI_BASE_URL || !AI_API_KEY) {
      return res.status(500).json({ message: 'AI 服务配置缺失，请检查 .env。' });
    }

    const groupedFiles = groupUploadedFiles(req.files || []);
    const examFiles = groupedFiles.examFile || [];
    const knowledgeFiles = groupedFiles.knowledgeFile || [];

    if (examFiles.length === 0) {
      return res.status(400).json({ message: '请至少上传一份试卷/作业文件。知识点文件可选，未上传时 AI 会自动识别知识点。' });
    }

    [...examFiles, ...knowledgeFiles].forEach(validateFile);

    const form = {
      grade: cleanField(req.body.grade) || '未填写',
      subject: cleanField(req.body.subject) || '未填写',
      targetExam: cleanField(req.body.targetExam) || '未填写',
      currentStage: cleanField(req.body.currentStage) || '未填写'
    };

    const extracted = await Promise.all([
      ...examFiles.map((file, index) => extractFile(file, `试卷或作业文件 ${index + 1}`)),
      ...knowledgeFiles.map((file, index) => extractFile(file, `知识点文件 ${index + 1}`))
    ]);

    const report = await createAiReport({ form, files: extracted });

    res.json({
      report,
      generatedAt: report.generatedAt
    });
  } catch (error) {
    console.error(error);
    const status = error.statusCode || 500;
    res.status(status).json({
      message: error.publicMessage || error.message || '分析失败，请稍后重试。'
    });
  }
});

function cleanField(value) {
  return String(value || '').trim().slice(0, 80);
}

function groupUploadedFiles(files) {
  return files.reduce((grouped, file) => {
    if (file.fieldname !== 'examFile' && file.fieldname !== 'knowledgeFile') {
      return grouped;
    }
    if (!grouped[file.fieldname]) {
      grouped[file.fieldname] = [];
    }
    grouped[file.fieldname].push(file);
    return grouped;
  }, {});
}

function validateFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    const error = new Error('仅支持 PDF、Word、PNG、JPG、TXT 文件。');
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }
}

async function extractFile(file, role) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const base = {
    role,
    name: file.originalname,
    size: file.size,
    mimeType: file.mimetype || guessMimeType(ext),
    extension: ext
  };

  if (IMAGE_EXTENSIONS.has(ext)) {
    return {
      ...base,
      kind: 'image',
      dataUrl: `data:${base.mimeType};base64,${file.buffer.toString('base64')}`,
      text: ''
    };
  }

  if (ext === '.pdf') {
    const data = await pdfParse(file.buffer);
    return {
      ...base,
      kind: 'text',
      text: truncateText(data.text || '', MAX_TEXT_CHARS_PER_FILE)
    };
  }

  if (ext === '.docx') {
    const data = await mammoth.extractRawText({ buffer: file.buffer });
    return {
      ...base,
      kind: 'text',
      text: truncateText(data.value || '', MAX_TEXT_CHARS_PER_FILE)
    };
  }

  if (ext === '.doc') {
    const document = await wordExtractor.extract(file.buffer);
    const text = [
      document.getBody(),
      document.getHeaders(),
      document.getFooters(),
      document.getFootnotes(),
      document.getEndnotes(),
      document.getAnnotations(),
      document.getTextboxes()
    ].filter(Boolean).join('\n\n');

    return {
      ...base,
      kind: 'text',
      text: truncateText(text, MAX_TEXT_CHARS_PER_FILE)
    };
  }

  if (ext === '.txt' || ext === '.md') {
    return {
      ...base,
      kind: 'text',
      text: truncateText(file.buffer.toString('utf8'), MAX_TEXT_CHARS_PER_FILE)
    };
  }

  const error = new Error('无法解析该文件，请转换为 PDF、DOCX、TXT 或图片后重试。');
  error.statusCode = 400;
  error.publicMessage = error.message;
  throw error;
}

function guessMimeType(ext) {
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'text/plain';
}

function truncateText(text, maxLength) {
  const normalized = String(text || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}\n\n[内容过长，已截取前 ${maxLength} 字用于本次诊断]`;
}

async function createAiReport({ form, files }) {
  const prompt = buildPrompt({ form, files });
  const imageParts = files
    .filter((file) => file.kind === 'image')
    .map((file) => ({
      type: 'image_url',
      image_url: { url: file.dataUrl }
    }));

  const content = imageParts.length > 0
    ? [{ type: 'text', text: prompt }, ...imageParts]
    : prompt;

  const responseText = await callChatCompletions(content, true).catch(async (error) => {
    if (error.retryWithoutResponseFormat) {
      return callChatCompletions(content, false);
    }
    throw error;
  });

  const parsed = parseJsonFromText(responseText);
  return normalizeReport(parsed, form);
}

function buildPrompt({ form, files }) {
  const fileBlocks = files.map((file) => {
    if (file.kind === 'image') {
      return [
        `【${file.role}】`,
        `文件名：${file.name}`,
        `类型：图片。请结合随消息附带的图片内容进行识别和判断。`
      ].join('\n');
    }

    return [
      `【${file.role}】`,
      `文件名：${file.name}`,
      `提取文本：`,
      file.text || '未能提取到文本，请根据文件名和上下文谨慎判断。'
    ].join('\n');
  }).join('\n\n---\n\n');

  return `
你是一位资深中小学学科诊断老师，请基于用户上传的试卷/作业与知识点清单，生成“知识查缺补漏器”诊断报告。

学生与考试信息：
- 年级：${form.grade}
- 科目：${form.subject}
- 目标考试：${form.targetExam}
- 当前考试阶段/成绩段：${form.currentStage}

资料内容：
${fileBlocks}

分析要求：
1. 只根据资料和合理教学经验诊断，不要编造不存在的学生个人隐私。
2. 如果资料中没有单独的知识点文件，请从试卷、作业、错题、题干、章节名称和题型里自动识别知识点体系。
3. 输出一棵红黄绿知识点地图，至少包含 4 个一级知识模块、12 个以上知识点。
4. 状态枚举只能使用：
   - good：掌握良好，绿色
   - gap：存在漏洞，黄色
   - severe：漏洞严重，红色
   - untouched：未涉及，灰色
5. mastery 为 0-100 的整数；untouched 可以为 null。
6. 结合错题/试卷特征说明每个薄弱点的证据、原因、补救动作。
7. 给出严重程度、优先级、30 天路线和完整报告详情。
8. 完整报告必须像专业数据分析机构交付的诊断报告：有数据口径、评分指标、证据链、错因模式、根因假设、提分预测、干预策略和执行建议，不要只写普通作文式总结。
9. fullReport 的专业分析字段必须尽量饱满：analyticalSnapshot 4-6 项，dataDimensions 6-8 项，errorPatternMatrix 4-6 项，evidenceChain 4-6 项，rootCauseModel 3-5 项，interventionStrategy 4 项左右。
10. 必须返回严格 JSON，不要 Markdown，不要代码围栏，不要解释文字。

JSON 结构必须完全符合：
{
  "title": "知识查缺补漏器",
  "generatedAt": "YYYY-MM-DD HH:mm",
  "meta": {
    "grade": "",
    "subject": "",
    "targetExam": "",
    "currentStage": ""
  },
  "summary": "",
  "map": {
    "rootLabel": "",
    "clusters": [
      {
        "name": "",
        "status": "good|gap|severe|untouched",
        "mastery": 0,
        "children": [
          {
            "name": "",
            "status": "good|gap|severe|untouched",
            "mastery": 0,
            "evidence": "",
            "reason": "",
            "remedies": ["", ""],
            "priority": 1,
            "routeDay": 1
          }
        ]
      }
    ]
  },
  "stats": {
    "total": 0,
    "good": 0,
    "gap": 0,
    "severe": 0,
    "untouched": 0
  },
  "severity": [
    {
      "name": "",
      "level": "高|中|低",
      "reason": "",
      "affectedPoints": ["", ""],
      "recommendedAction": ""
    }
  ],
  "priority": [
    {
      "name": "",
      "priority": 1,
      "objective": "",
      "tasks": ["", ""],
      "estimatedDays": 3
    }
  ],
  "route30": [
    {
      "dayRange": "第1-3天",
      "focus": "",
      "tasks": ["", ""],
      "deliverable": ""
    }
  ],
  "fullReport": {
    "overallDiagnosis": "",
    "studentProfile": "",
    "analyticalSnapshot": [
      {
        "label": "知识掌握指数",
        "value": "72/100",
        "level": "中风险",
        "description": "说明这个指标如何由上传资料推断"
      }
    ],
    "dataDimensions": [
      {
        "dimension": "概念理解",
        "score": 78,
        "status": "优势|波动|风险",
        "finding": "",
        "evidence": "",
        "action": ""
      }
    ],
    "errorPatternMatrix": [
      {
        "pattern": "符号规则迁移失败",
        "frequency": "高|中|低",
        "impact": "影响哪些题型和分数段",
        "evidence": "",
        "intervention": ""
      }
    ],
    "evidenceChain": [
      {
        "finding": "",
        "sourceEvidence": "",
        "inference": "",
        "confidence": "高|中|低"
      }
    ],
    "rootCauseModel": [
      {
        "cause": "",
        "mechanism": "",
        "symptoms": ["", ""],
        "repairStrategy": ""
      }
    ],
    "scoreProjection": {
      "currentRange": "",
      "targetRange": "",
      "gainPotential": "",
      "conditions": ["", ""]
    },
    "interventionStrategy": [
      {
        "stage": "",
        "objective": "",
        "method": "",
        "successMetric": ""
      }
    ],
    "teachingRecommendations": ["", ""],
    "practicePlan": ["", ""],
    "nextExamPrediction": "",
    "risks": ["", ""],
    "dataLimitations": ["", ""]
  }
}
`.trim();
}

async function callChatCompletions(content, withResponseFormat) {
  const payload = {
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content: '你是严谨的教育诊断助手。所有输出必须为可解析 JSON。'
      },
      {
        role: 'user',
        content
      }
    ],
    temperature: 0.2,
    max_tokens: 9000
  };

  if (withResponseFormat) {
    payload.response_format = { type: 'json_object' };
  }

  const response = await fetchWithRetry(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseBody = await response.text();
  if (!response.ok) {
    const error = new Error(`AI 接口返回 ${response.status}`);
    error.statusCode = response.status >= 500 ? 502 : 400;
    error.publicMessage = extractApiMessage(responseBody) || 'AI 接口调用失败，请检查模型、密钥或上传内容。';
    error.retryWithoutResponseFormat = withResponseFormat && response.status < 500;
    throw error;
  }

  const json = JSON.parse(responseBody);
  const contentText = json.choices?.[0]?.message?.content;
  if (!contentText) {
    throw new Error('AI 返回为空，无法生成报告。');
  }

  return Array.isArray(contentText)
    ? contentText.map((item) => item.text || '').join('\n')
    : String(contentText);
}

async function fetchWithRetry(url, options, maxAttempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await sleep(attempt * 1200);
    }
  }

  const gatewayError = new Error('无法连接 AI 网关');
  gatewayError.statusCode = 502;
  gatewayError.publicMessage = `无法连接 AI 网关：${lastError?.cause?.message || lastError?.message || '网络超时'}`;
  throw gatewayError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractApiMessage(body) {
  try {
    const json = JSON.parse(body);
    return json.error?.message || json.message || '';
  } catch {
    return body?.slice(0, 180);
  }
}

function parseJsonFromText(text) {
  const trimmed = String(text || '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error('AI 返回内容不是有效 JSON。');
  }
}

function normalizeReport(report, form) {
  const generatedAt = formatDateTime(new Date());
  const clusters = Array.isArray(report?.map?.clusters)
    ? report.map.clusters.map(normalizeCluster).filter(Boolean)
    : [];

  if (clusters.length === 0) {
    throw new Error('AI 报告缺少知识点地图，请重试。');
  }

  const stats = computeStats(clusters);

  return {
    title: String(report.title || '知识查缺补漏器'),
    generatedAt,
    meta: {
      grade: String(report.meta?.grade || form.grade),
      subject: String(report.meta?.subject || form.subject),
      targetExam: String(report.meta?.targetExam || form.targetExam),
      currentStage: String(report.meta?.currentStage || form.currentStage)
    },
    summary: String(report.summary || ''),
    map: {
      rootLabel: String(report.map?.rootLabel || `${form.grade}\n${form.subject}`),
      clusters
    },
    stats,
    severity: ensureArray(report.severity).slice(0, 8),
    priority: ensureArray(report.priority).slice(0, 10),
    route30: ensureArray(report.route30).slice(0, 10),
    fullReport: {
      overallDiagnosis: String(report.fullReport?.overallDiagnosis || report.summary || ''),
      studentProfile: String(report.fullReport?.studentProfile || ''),
      analyticalSnapshot: ensureArray(report.fullReport?.analyticalSnapshot).slice(0, 8),
      dataDimensions: ensureArray(report.fullReport?.dataDimensions).slice(0, 12),
      errorPatternMatrix: ensureArray(report.fullReport?.errorPatternMatrix).slice(0, 10),
      evidenceChain: ensureArray(report.fullReport?.evidenceChain).slice(0, 12),
      rootCauseModel: ensureArray(report.fullReport?.rootCauseModel).slice(0, 8),
      scoreProjection: normalizeObject(report.fullReport?.scoreProjection),
      interventionStrategy: ensureArray(report.fullReport?.interventionStrategy).slice(0, 8),
      teachingRecommendations: ensureArray(report.fullReport?.teachingRecommendations),
      practicePlan: ensureArray(report.fullReport?.practicePlan),
      nextExamPrediction: String(report.fullReport?.nextExamPrediction || ''),
      risks: ensureArray(report.fullReport?.risks),
      dataLimitations: ensureArray(report.fullReport?.dataLimitations)
    }
  };
}

function normalizeCluster(cluster) {
  if (!cluster?.name) return null;
  const children = ensureArray(cluster.children)
    .map((child) => normalizePoint(child))
    .filter(Boolean);

  return {
    name: String(cluster.name),
    status: normalizeStatus(cluster.status),
    mastery: normalizeMastery(cluster.mastery),
    children
  };
}

function normalizePoint(point) {
  if (!point?.name) return null;
  return {
    name: String(point.name),
    status: normalizeStatus(point.status),
    mastery: normalizeMastery(point.mastery),
    evidence: String(point.evidence || ''),
    reason: String(point.reason || ''),
    remedies: ensureArray(point.remedies).map(String).slice(0, 4),
    priority: clampNumber(point.priority, 1, 5, 3),
    routeDay: clampNumber(point.routeDay, 1, 30, 1)
  };
}

function normalizeStatus(status) {
  if (['good', 'gap', 'severe', 'untouched'].includes(status)) return status;
  return 'gap';
}

function normalizeMastery(value) {
  if (value === null || value === undefined || value === '') return null;
  return clampNumber(value, 0, 100, null);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function computeStats(clusters) {
  const points = clusters.flatMap((cluster) => [
    { status: cluster.status },
    ...cluster.children.map((child) => ({ status: child.status }))
  ]);
  const stats = {
    total: points.length,
    good: 0,
    gap: 0,
    severe: 0,
    untouched: 0
  };
  points.forEach((point) => {
    stats[point.status] += 1;
  });
  return stats;
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes())
  ].join('');
}

startServer(PORT);

function startServer(port, attempt = 0) {
  const server = app.listen(port, HOST, () => {
    console.log(`知识查缺补漏器已启动：http://${HOST}:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempt < 10) {
      startServer(port + 1, attempt + 1);
      return;
    }
    throw error;
  });
}

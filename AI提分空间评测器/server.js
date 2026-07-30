import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import sharp from 'sharp';
import { jsonrepair } from 'jsonrepair';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || process.env.BIND_HOST || '127.0.0.1';
const aiApiUrl = (process.env.AI_API_URL || 'https://cccapi.top/v1').replace(/\/$/, '');
const aiChatUrl = /\/chat\/completions$/i.test(aiApiUrl)
  ? aiApiUrl
  : `${aiApiUrl}/chat/completions`;
const aiModel = process.env.AI_MODEL || 'gemini-3.5-flash';
const aiApiKey = process.env.AI_API_KEY;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 5
  }
});
const uploadAssessment = upload.array('files', 5);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/lucide', express.static(path.join(__dirname, 'node_modules', 'lucide', 'dist', 'umd')));
app.use('/vendor/html2canvas', express.static(path.join(__dirname, 'node_modules', 'html2canvas', 'dist')));
app.use('/vendor/jspdf', express.static(path.join(__dirname, 'node_modules', 'jspdf', 'dist')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: aiModel,
    hasKey: Boolean(aiApiKey)
  });
});

app.post('/api/analyze', (req, res) => {
  uploadAssessment(req, res, async (uploadError) => {
    if (uploadError) {
      res.status(400).json({ error: formatUploadError(uploadError) });
      return;
    }

    try {
      if (!aiApiKey) {
        res.status(500).json({ error: '服务端缺少 AI_API_KEY，请在 .env 中配置接口密钥。' });
        return;
      }

      const payload = normalizeForm(req.body);
      const files = await extractFiles(req.files || []);
      const report = await generateAiReport(payload, files);

      res.json({ report: normalizeReport(report, payload) });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'AI分析失败，请稍后重试。'
      });
    }
  });
});

function normalizeForm(body) {
  const maxScore = clampScore(body.maxScore, 100, 1000);
  const currentScore = clampScore(body.currentScore, Math.round(maxScore * 0.68), maxScore);
  const targetScore = clampScore(body.targetScore, Math.round(maxScore * 0.85), maxScore);

  return {
    grade: safeText(body.grade, '初二'),
    subject: safeText(body.subject, '数学'),
    maxScore,
    currentScore,
    targetScore,
    performance: safeText(body.performance, '中等水平，波动较大'),
    concerns: parseJsonList(body.concerns),
    testDate: safeText(body.testDate, new Date().toISOString().slice(0, 10))
  };
}

function clampScore(value, fallback, upperLimit = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(upperLimit, Math.round(number)));
}

function safeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 300) : fallback;
}

function parseJsonList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 10) : [];
  } catch {
    return String(value).split(',').map((item) => item.trim()).filter(Boolean).slice(0, 10);
  }
}

async function extractFiles(files) {
  const extracted = [];
  const images = [];

  for (const file of files) {
    const mime = file.mimetype || 'application/octet-stream';
    const name = file.originalname || '未命名文件';

    if (mime.startsWith('image/')) {
      const optimized = await optimizeImage(file.buffer);
      images.push({
        name,
        mime: optimized.mime,
        dataUrl: `data:${optimized.mime};base64,${optimized.buffer.toString('base64')}`
      });
      continue;
    }

    if (mime.includes('pdf') || name.toLowerCase().endsWith('.pdf')) {
      const parsed = await pdfParse(file.buffer);
      extracted.push({
        name,
        type: 'PDF',
        text: trimLongText(parsed.text || '')
      });
      continue;
    }

    if (
      mime.includes('wordprocessingml') ||
      mime.includes('msword') ||
      name.toLowerCase().endsWith('.docx')
    ) {
      const parsed = await mammoth.extractRawText({ buffer: file.buffer });
      extracted.push({
        name,
        type: 'Word',
        text: trimLongText(parsed.value || '')
      });
      continue;
    }

    if (mime.startsWith('text/') || /\.(txt|md|csv)$/i.test(name)) {
      extracted.push({
        name,
        type: '文本',
        text: trimLongText(file.buffer.toString('utf8'))
      });
      continue;
    }

    extracted.push({
      name,
      type: '未解析附件',
      text: '该文件类型暂未提取文本，请结合用户填写信息进行诊断。'
    });
  }

  return { extracted, images };
}

async function optimizeImage(buffer) {
  try {
    const optimized = await sharp(buffer, { limitInputPixels: 30_000_000 })
      .rotate()
      .resize({
        width: 1280,
        height: 1280,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();

    return { mime: 'image/jpeg', buffer: optimized };
  } catch {
    return { mime: 'image/jpeg', buffer };
  }
}

function formatUploadError(error) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return '单个文件不能超过15MB，请压缩后再上传。';
    if (error.code === 'LIMIT_FILE_COUNT') return '一次最多上传5个文件，请删减后再提交。';
    return `上传失败：${error.message}`;
  }

  return error instanceof Error ? error.message : '上传失败，请重新选择文件。';
}

function trimLongText(text) {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 12000);
}

async function generateAiReport(form, files) {
  const prompt = buildPrompt(form, files);
  const content = [
    { type: 'text', text: prompt },
    ...files.images.map((image) => ({
      type: 'image_url',
      image_url: { url: image.dataUrl }
    }))
  ];

  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiApiKey}`
    },
    body: JSON.stringify({
      model: aiModel,
      temperature: 0.35,
      max_tokens: 16000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            '你是一名资深K12学业诊断老师，擅长基于成绩、学习表现、家长担忧和试卷作业材料输出可执行的提分空间测评。只返回严格JSON，不要Markdown。'
        },
        {
          role: 'user',
          content
        }
      ]
    })
  };
  let response = await fetchWithRetry(aiChatUrl, requestOptions);
  if (!response.ok && [400, 422].includes(response.status)) {
    const compatibilityBody = JSON.parse(requestOptions.body);
    delete compatibilityBody.response_format;
    response = await fetchWithRetry(aiChatUrl, {
      ...requestOptions,
      body: JSON.stringify(compatibilityBody)
    });
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`AI接口调用失败：${response.status} ${responseText.slice(0, 240)}`);
  }

  const data = parseAiEnvelope(responseText);
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error('AI接口没有返回可用内容。');
  }

  const parsed = parseJsonObject(raw);
  validateAiReport(parsed);
  return parsed;
}

async function fetchWithRetry(url, options, retries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(900 * (attempt + 1));
      }
    }
  }

  throw new Error(formatAiNetworkError(lastError));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatAiNetworkError(error) {
  const code = error?.cause?.code || error?.code;
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || /timeout/i.test(String(error?.message))) {
    return 'AI接口连接超时，请稍后重新生成。';
  }

  return 'AI接口连接失败，请检查网络或稍后重试。';
}

function parseAiEnvelope(text) {
  try {
    return JSON.parse(text);
  } catch {
    if (/<!doctype|<html/i.test(text)) {
      throw new Error('AI接口返回了网页内容，通常是上传图片过大或网关临时异常。系统已压缩图片，请稍后重新提交。');
    }

    throw new Error('AI接口返回内容不是有效JSON，请稍后重试。');
  }
}

function buildPrompt(form, fileBundle) {
  const concernText = form.concerns.length ? form.concerns.join('、') : '用户未填写，可不作为强约束';
  const extractedFiles = fileBundle.extracted || [];
  const imageFiles = fileBundle.images || [];
  const scoreRate = Math.round((form.currentScore / form.maxScore) * 100);
  const targetRate = Math.round((form.targetScore / form.maxScore) * 100);
  const gap = Math.max(0, form.targetScore - form.currentScore);
  const gapRate = Math.round((gap / form.maxScore) * 100);
  const fileText = extractedFiles.length
    ? extractedFiles
        .map((file, index) => `附件${index + 1}：${file.name}（${file.type}）\n${file.text || '未提取到文本'}`)
        .join('\n\n')
    : '本次未上传可提取文本的附件。';
  const imageText = imageFiles.length
    ? imageFiles.map((file, index) => `图片${index + 1}：${file.name}（请结合图片可见内容分析）`).join('\n')
    : '本次未上传图片附件。';

  return `
请根据以下信息生成一份“AI提分空间测评”报告。
报告定位：面向家长展示的专业提分空间数据分析报告，要求像教育数据分析机构出具的诊断结论。

学生信息：
- 年级：${form.grade}
- 科目：${form.subject}
- 试卷满分：${form.maxScore}
- 当前分数：${form.currentScore}/${form.maxScore}
- 目标分数：${form.targetScore}/${form.maxScore}
- 当前得分率：${scoreRate}%
- 目标得分率：${targetRate}%
- 目标差距：${gap}分（约${gapRate}%）
- 学习表现：${form.performance}
- 家长最焦虑的问题：${concernText}
- 测评日期：${form.testDate}

上传资料摘要（文本类）：
${fileText}

上传资料摘要（图片类）：
${imageText}

请严格返回JSON，字段结构如下：
{
  "levelLabel": "当前分数层级，例：中等偏下",
  "levelDescription": "基于分数比例、表单和上传资料的一句话诊断，必须体现上传材料识别结论，70字以内",
  "gapTitle": "目标差距说明标题，20字以内",
  "gapDescription": "说明距离目标的主要差距，60字以内",
  "stagePlan": [
    {"title":"先拿回 9分","subtitle":"夯实基础"},
    {"title":"再冲刺 8分","subtitle":"提升稳定性"},
    {"title":"挑战 8+分","subtitle":"攻克压轴"}
  ],
  "priorities": [
    {"title":"由上传材料推导出的优先提分方向","reason":"必须引用材料证据或说明材料可见信息有限，55字以内","scoreRange":"可提分：6~8分","evidence":"来自上传试卷/作业/表单的依据"}
  ],
  "thirtyDayPlan": [
    {"week":"第1周","title":"由AI识别结果确定的阶段主题","detail":"围绕识别到的薄弱点安排训练，45字以内","kpi":"本周检查指标"}
  ],
  "dimensions": [
    {"name":"基础掌握","score":68,"status":"偏弱","analysis":"诊断说明，60字以内","suggestion":"建议，55字以内","evidence":"来自表单或上传资料的依据"}
  ],
  "fullReport": {
    "reportSubtitle":"一句话专业副标题，体现本次学科与提分空间",
    "evidenceSummary":"说明本报告依据了哪些输入：分数、满分、学习表现、家长选项、上传图片/文档；如资料识别有限也要说明，120字以内",
    "diagnosis":"完整诊断结论，180字以内，必须先讲可确认事实，再讲推断，不要编造",
    "paperRecognition":{
      "readableQuality":"高/中/低/上传材料可见信息有限",
      "recognizedScope":"识别到的资料范围，例如试卷页、作业页、错题照；若不是试卷要说明",
      "detectedSubject":"从材料中识别或结合表单确认的学科",
      "questionTypes":["材料中可见的题型；无法确认时写上传材料可见信息有限"],
      "visibleScoreMarks":"能否看到批改痕迹、分数、错号、空题等",
      "limitation":"识别限制与不确定性说明"
    },
    "scoreAnalytics":{
      "currentRate":${scoreRate},
      "targetRate":${targetRate},
      "gapRate":${gapRate},
      "recoverableScore":"基于材料推断的可回收分区间，例如8~12分；证据不足时要说明",
      "stabilityIndex":"高/中/低",
      "priorityIndex":"高/中/低",
      "summary":"用数据语言解释当前分数、目标差距和优先级，90字以内"
    },
    "materialFindings":[
      {"title":"可见材料发现","detail":"从上传资料或表单中观察到的事实，不要编造题号","evidence":"对应依据"}
    ],
    "abilityModules":[
      {"name":"能力模块名","score":68,"level":"偏弱/中等/较好","evidence":"依据","analysis":"细致分析，70字以内","suggestion":"训练建议，60字以内"}
    ],
    "questionTypeBreakdown":[
      {"type":"题型/模块名","observedEvidence":"材料中看到的证据；证据不足必须说明","mastery":"掌握度百分比或高/中/低","lossRisk":"失分风险高/中/低","estimatedRecoverableScore":"预计可回收分","strategy":"专项提分策略"}
    ],
    "knowledgeMap":[
      {"knowledgePoint":"知识点","masteryLevel":"高/中/低","evidence":"来自上传内容或表单的依据","typicalError":"典型错误或风险","remediation":"补救动作"}
    ],
    "lossAttribution":[
      {"category":"失分归因类别","estimatedLoss":"估计失分","evidence":"依据","intervention":"干预动作"}
    ],
    "knowledgeGaps":[
      {"point":"知识漏洞","evidence":"依据","fix":"补救方式"}
    ],
    "errorPatterns":[
      {"pattern":"失分模式","cause":"可能原因","action":"纠偏动作"}
    ],
    "trainingPlan":[
      {"stage":"第1阶段","goal":"阶段目标","task":"训练任务","checkpoint":"检查标准"}
    ],
    "learningPath":[
      {"phase":"第1周","focus":"训练重点","task":"具体任务","kpi":"量化检查指标"}
    ],
    "reportQualityNote":"说明本报告哪些结论来自材料识别，哪些来自分数和表单推断，80字以内",
    "closing":"克制鼓励性结论，60字以内，不得承诺保分"
  }
}

要求：
1. 必须基于真实输入分析：表单、分数/满分比例、家长可选项、上传文本和图片可见内容。
2. 如果上传图片内容无法清晰识别，必须写“上传材料可见信息有限”，不要编造具体题号、错题内容、知识点或孩子表现。
3. “优先提分方向”和“30天提分建议”必须由上传资料识别内容、questionTypeBreakdown、knowledgeMap、lossAttribution推导；不得复用示例，不得固定写函数/几何/计算，除非材料或表单支持。
4. 如果材料不是学科试卷/作业，必须明确写“上传材料不属于可分析试卷/作业”，并主要依据表单做保守分析。
5. 不要套话，不要只给泛泛建议；每个能力模块、题型矩阵、知识地图和失分模式都要有 evidence/依据。
6. 结论必须具体、克制，不承诺保分；不要写“一定能达到目标”“完全可以弥补”“保证提分”等过度承诺。
7. priorities固定返回3项，thirtyDayPlan固定返回4项，dimensions返回8项，fullReport.abilityModules返回8项。
8. materialFindings返回3-5项，questionTypeBreakdown返回4-6项，knowledgeMap返回5-8项，lossAttribution返回4-6项。
9. knowledgeGaps返回4-6项，errorPatterns返回4-6项，trainingPlan返回4项，learningPath返回4项。
10. stagePlan根据目标差距拆成3段，标题里的分数总和接近目标差距。
11. 所有内容使用中文，适合展示给家长。
`.trim();
}

function parseJsonObject(raw) {
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI返回内容不是有效JSON。');
    try {
      return JSON.parse(match[0]);
    } catch {
      return JSON.parse(jsonrepair(match[0]));
    }
  }
}

function validateAiReport(report) {
  const requiredArrays = [
    ['priorities', report?.priorities],
    ['thirtyDayPlan', report?.thirtyDayPlan],
    ['dimensions', report?.dimensions],
    ['fullReport.abilityModules', report?.fullReport?.abilityModules],
    ['fullReport.questionTypeBreakdown', report?.fullReport?.questionTypeBreakdown],
    ['fullReport.knowledgeMap', report?.fullReport?.knowledgeMap],
    ['fullReport.lossAttribution', report?.fullReport?.lossAttribution]
  ];
  const missing = requiredArrays
    .filter(([, value]) => !Array.isArray(value) || value.length === 0)
    .map(([key]) => key);

  if (!report || typeof report !== 'object' || missing.length) {
    throw new Error(`AI返回报告结构不完整，请重新生成。缺少字段：${missing.join('、') || 'report'}`);
  }
}

function normalizeReport(report, form) {
  const gap = Math.max(0, form.targetScore - form.currentScore);
  const fallback = buildFallbackReport(form);
  const hasAiReport = report && typeof report === 'object' && Object.keys(report).length > 0;
  const merged = { ...fallback, ...(report || {}) };
  const fullReport = normalizeFullReport(merged.fullReport, fallback.fullReport, hasAiReport);
  const arrayFallback = hasAiReport ? [] : fallback;

  return {
    ...merged,
    maxScore: form.maxScore,
    currentScore: form.currentScore,
    targetScore: form.targetScore,
    gap,
    grade: form.grade,
    subject: form.subject,
    testDate: form.testDate,
    stagePlan: ensureArray(merged.stagePlan, arrayFallback.stagePlan || []).slice(0, 3),
    priorities: ensureArray(merged.priorities, arrayFallback.priorities || []).slice(0, 3),
    thirtyDayPlan: ensureArray(merged.thirtyDayPlan, arrayFallback.thirtyDayPlan || []).slice(0, 4),
    dimensions: ensureArray(merged.dimensions, arrayFallback.dimensions || []).slice(0, 8),
    fullReport
  };
}

function normalizeFullReport(value, fallback, hasAiReport = false) {
  const merged = { ...fallback, ...(value || {}) };
  const arrayKeys = [
    'materialFindings',
    'abilityModules',
    'questionTypeBreakdown',
    'knowledgeMap',
    'lossAttribution',
    'knowledgeGaps',
    'errorPatterns',
    'trainingPlan',
    'learningPath',
  ];

  for (const key of arrayKeys) {
    merged[key] = ensureArray(merged[key], hasAiReport ? [] : fallback[key] || []);
  }

  merged.paperRecognition = {
    ...(hasAiReport ? {} : fallback.paperRecognition || {}),
    ...(merged.paperRecognition || {})
  };
  merged.scoreAnalytics = {
    ...(hasAiReport ? {} : fallback.scoreAnalytics || {}),
    ...(merged.scoreAnalytics || {})
  };

  return merged;
}

function ensureArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

function buildFallbackReport(form) {
  const gap = Math.max(0, form.targetScore - form.currentScore);
  const scoreRate = form.currentScore / form.maxScore;
  const percentScore = Math.round(scoreRate * 100);
  const levelLabel = scoreRate >= 0.85 ? '优秀稳定' : scoreRate >= 0.7 ? '中等偏上' : scoreRate >= 0.6 ? '中等偏下' : '基础待补';
  return {
    levelLabel,
    levelDescription: '已根据当前分数、目标分数和学习表现形成初步诊断；上传资料后可进一步细化到题型与错因。',
    gapTitle: '目标差距说明',
    gapDescription: `距离目标还有 ${gap} 分差距，主要集中在基础稳固、综合应用与解题稳定性上。`,
    stagePlan: [
      { title: `先拿回 ${Math.max(4, Math.round(gap * 0.5))}分`, subtitle: '夯实基础' },
      { title: `再冲刺 ${Math.max(3, Math.round(gap * 0.3))}分`, subtitle: '提升稳定性' },
      { title: `挑战 ${Math.max(2, Math.round(gap * 0.2))}+分`, subtitle: '攻克压轴' }
    ],
    priorities: [
      { title: '基础计算与概念应用', reason: '计算错误较多，概念理解不扎实，建议优先巩固基础题型。', scoreRange: '可提分：6~8分' },
      { title: '函数与方程应用题', reason: '审题与建模能力不足，步骤易失分，需强化典型题训练。', scoreRange: '可提分：5~6分' },
      { title: '几何证明与综合题', reason: '思路不完整，书写不规范，需提升逻辑表达与综合运用能力。', scoreRange: '可提分：4~6分' }
    ],
    thirtyDayPlan: [
      { week: '第1周', title: '夯实基础', detail: '回顾教材核心概念，完成基础题专项训练' },
      { week: '第2周', title: '专题突破', detail: '针对函数与方程应用题，掌握解题方法' },
      { week: '第3周', title: '综合提升', detail: '强化几何与综合题，提升解题规范与速度' },
      { week: '第4周', title: '模考冲刺', detail: '真题模拟训练，查漏补缺，稳定心态' }
    ],
    dimensions: [
      { name: '基础掌握', score: percentScore, status: '待巩固', analysis: '基础题具备一定正确率，但仍需结合试卷进一步定位概念漏洞。', suggestion: '每天固定完成基础题复盘，建立错因标签。', evidence: '来自表单分数比例' },
      { name: '方法迁移', score: Math.max(40, percentScore - 8), status: '偏弱', analysis: '遇到变式题时方法调用可能不够稳定，容易依赖题感。', suggestion: '按题型总结解题入口，训练同类迁移。', evidence: '来自学习表现与目标差距' },
      { name: '综合应用', score: Math.max(35, percentScore - 12), status: '需提升', analysis: '综合题拆解能力需要通过上传试卷进一步验证。', suggestion: '用分步拆题法训练综合题前两问。', evidence: '来自目标差距' },
      { name: '考试稳定性', score: Math.max(45, percentScore - 5), status: '波动', analysis: '当前表单显示成绩稳定性需要关注。', suggestion: '每周一次限时训练，复盘时间分配。', evidence: '来自学习表现选项' },
      { name: '审题阅读', score: Math.max(40, percentScore - 10), status: '待观察', analysis: '如应用题困难被勾选，应重点检查审题与信息提取。', suggestion: '训练画关键词、列条件、写目标。', evidence: '来自家长选项或表单' },
      { name: '表达规范', score: Math.max(40, percentScore - 9), status: '待规范', analysis: '步骤分和书写规范需要结合卷面进一步判断。', suggestion: '用标准答案反推得分点。', evidence: '来自目标差距' },
      { name: '错题复盘', score: Math.max(40, percentScore - 7), status: '可优化', analysis: '若错题只改答案不改错因，提分效率会下降。', suggestion: '错题按概念、计算、审题、表达分类。', evidence: '来自表单诊断' },
      { name: '训练节奏', score: Math.max(40, percentScore - 6), status: '可优化', analysis: '需要把目标分拆解成可执行的周训练任务。', suggestion: '按周设置题型目标和检查标准。', evidence: '来自目标分数' }
    ],
    fullReport: {
      reportSubtitle: `${form.grade}${form.subject}提分空间与失分结构诊断`,
      evidenceSummary: '当前为基于表单的初步诊断；如果上传试卷、作业或错题图片，AI会结合可见材料进一步定位知识点、错因和训练优先级。',
      diagnosis: '当前成绩说明孩子具备基础理解能力，但知识结构还不够稳，综合应用和考试稳定性是主要提分入口。该结论会在上传材料后进一步细化。',
      paperRecognition: {
        readableQuality: '上传材料可见信息有限',
        recognizedScope: '当前主要依据表单信息，尚未识别到可分析的试卷页或作业页。',
        detectedSubject: form.subject,
        questionTypes: ['上传材料可见信息有限'],
        visibleScoreMarks: '未确认批改痕迹、错号或题面细节。',
        limitation: '未上传清晰学科材料时，具体题号和知识点只能做保守推断。'
      },
      scoreAnalytics: {
        currentRate: percentScore,
        targetRate: Math.round((form.targetScore / form.maxScore) * 100),
        gapRate: Math.round((gap / form.maxScore) * 100),
        recoverableScore: `目标差距${gap}分，需结合试卷确认可回收区间`,
        stabilityIndex: scoreRate >= 0.75 ? '中' : '低',
        priorityIndex: gap >= form.maxScore * 0.15 ? '高' : '中',
        summary: `当前得分率${percentScore}%，目标得分率${Math.round((form.targetScore / form.maxScore) * 100)}%，需要优先确认高频失分题型。`
      },
      materialFindings: [
        { title: '分数依据', detail: `当前 ${form.currentScore}/${form.maxScore}，目标 ${form.targetScore}/${form.maxScore}，差距 ${gap} 分。`, evidence: '表单分数' },
        { title: '表现依据', detail: `学习表现为“${form.performance}”。`, evidence: '表单学习表现' },
        { title: '资料状态', detail: '尚未从上传材料中提取到更多题目细节。', evidence: '上传材料状态' }
      ],
      abilityModules: [
        { name: '基础掌握', score: percentScore, level: '待巩固', evidence: '表单分数比例', analysis: '基础题具备一定正确率，但仍需通过试卷定位具体概念漏洞。', suggestion: '优先复盘基础概念和高频计算错因。' },
        { name: '方法迁移', score: Math.max(40, percentScore - 8), level: '偏弱', evidence: '目标差距', analysis: '从当前到目标仍有提升空间，说明方法迁移需要训练。', suggestion: '按题型整理解题入口和变式条件。' },
        { name: '综合应用', score: Math.max(35, percentScore - 12), level: '需提升', evidence: '目标差距', analysis: '综合应用可能是主要增分区，需要通过材料进一步定位。', suggestion: '每周训练综合题拆解和步骤表达。' }
      ],
      questionTypeBreakdown: [
        { type: '基础题', observedEvidence: '来自表单分数比例，未识别到具体题面。', mastery: `${percentScore}%`, lossRisk: '中', estimatedRecoverableScore: '需结合试卷确认', strategy: '先用基础题复盘确认概念和计算漏洞。' },
        { type: '中档应用题', observedEvidence: '来自目标差距与学习表现推断。', mastery: '中', lossRisk: '中高', estimatedRecoverableScore: '需结合试卷确认', strategy: '建立题型方法清单并做同类迁移。' },
        { type: '综合题', observedEvidence: '来自目标差距推断，材料证据不足。', mastery: '待确认', lossRisk: '中高', estimatedRecoverableScore: '需结合试卷确认', strategy: '训练分步拆题和评分点表达。' }
      ],
      knowledgeMap: [
        { knowledgePoint: '基础概念边界', masteryLevel: '中', evidence: '表单分数比例', typicalError: '概念适用条件不清', remediation: '回归定义、性质和公式条件。' },
        { knowledgePoint: '题型方法调用', masteryLevel: '中低', evidence: '目标差距', typicalError: '遇到变式入口不稳', remediation: '整理题型入口和变式条件。' },
        { knowledgePoint: '错因归类', masteryLevel: '待确认', evidence: '上传材料可见信息有限', typicalError: '只改答案不改原因', remediation: '按概念、计算、审题、表达打标签。' }
      ],
      lossAttribution: [
        { category: '概念与基础', estimatedLoss: '需结合试卷确认', evidence: '当前得分率', intervention: '基础题复盘与概念辨析。' },
        { category: '方法迁移', estimatedLoss: '需结合试卷确认', evidence: '目标差距', intervention: '同类题变式训练。' },
        { category: '表达与步骤', estimatedLoss: '需结合试卷确认', evidence: '未见卷面细节', intervention: '按标准答案反推得分点。' }
      ],
      knowledgeGaps: [
        { point: '基础概念边界', evidence: '表单分数比例', fix: '回归定义、性质、公式适用条件。' },
        { point: '题型方法调用', evidence: '目标差距', fix: '建立题型方法清单，做同类变式。' },
        { point: '错因归类', evidence: '表单诊断', fix: '按概念、计算、审题、表达分类复盘。' }
      ],
      errorPatterns: [
        { pattern: '会做但不稳', cause: '步骤和检查习惯不足', action: '限时训练后做错因归类。' },
        { pattern: '遇到变式卡顿', cause: '方法入口不清晰', action: '训练同题型多变式迁移。' },
        { pattern: '综合题丢步骤分', cause: '表达和逻辑链不完整', action: '按评分点重写解题过程。' }
      ],
      trainingPlan: [
        { stage: '第1阶段', goal: '补基础漏洞', task: '复盘核心概念与计算错题', checkpoint: '基础题正确率连续稳定' },
        { stage: '第2阶段', goal: '攻中档题', task: '训练典型题型方法迁移', checkpoint: '中档题能写出完整步骤' },
        { stage: '第3阶段', goal: '提考试稳定性', task: '限时套卷和错题回炉', checkpoint: '错题复错率下降' },
        { stage: '第4阶段', goal: '冲目标分', task: '综合模拟与弱项补缺', checkpoint: '模拟分接近目标分' }
      ],
      learningPath: [
        { phase: '第1周', focus: '基础校准', task: '复盘核心概念与基础错题', kpi: '基础题正确率连续稳定' },
        { phase: '第2周', focus: '题型突破', task: '训练中档题方法迁移', kpi: '同类题能说出解题入口' },
        { phase: '第3周', focus: '综合表达', task: '重写综合题得分步骤', kpi: '步骤分遗漏减少' },
        { phase: '第4周', focus: '模拟校验', task: '限时套卷与弱项回炉', kpi: '模拟分接近目标区间' }
      ],
      reportQualityNote: '当前具体题目证据有限，核心数据来自表单分数与学习表现；上传清晰试卷后可进一步校准。',
      closing: '这份测评是初步诊断，不承诺保分；只要训练路径稳定，提分空间可以被逐步兑现。'
    }
  };
}

app.listen(port, host, () => {
  console.log(`AI提分空间测评网站已启动：http://${host}:${port}`);
});

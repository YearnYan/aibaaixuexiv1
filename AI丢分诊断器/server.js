const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const HOST = process.env.HOST || process.env.BIND_HOST || "127.0.0.1";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_TEXT = 24000;
const MAX_TOTAL_TEXT_IN_PROMPT = 90000;
const AI_TIMEOUT_MS = 120000;

loadEnv(path.join(ROOT_DIR, ".env"));

const AI_API_KEY = String(
  process.env.PLATFORM_AI_API_KEY
  || process.env.AI_API_KEY
  || process.env.CCC_API_KEY
  || ''
).trim();
const AI_BASE_URL = (
  process.env.PLATFORM_AI_BASE_URL
  || process.env.AI_BASE_URL
  || process.env.CCC_API_URL
  || 'https://cccapi.top/v1'
).replace(/\/+$/, '');
const AI_MODEL = (
  process.env.PLATFORM_AI_MODEL
  || process.env.AI_MODEL
  || process.env.CCC_MODEL
  || 'gemini-3.5-flash'
).trim();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES
  }
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  maxAge: "1h"
}));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    model: AI_MODEL,
    apiConfigured: Boolean(AI_API_KEY)
  });
});

app.post("/api/analyze", (req, res) => {
  upload.any()(req, res, async (error) => {
    if (error) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "文件大小不能超过 50MB"
        : "文件上传失败，请检查文件格式后重试";
      res.status(400).json({ error: message });
      return;
    }

    try {
      const report = await analyzeRequest(req.body, req.files || []);
      res.json(report);
    } catch (err) {
      const statusCode = err.statusCode || 500;
      if (statusCode >= 500) {
        console.error(err);
      } else {
        console.warn(err.publicMessage || err.message);
      }
      res.status(statusCode).json({
        error: err.publicMessage || "AI 诊断失败，请稍后重试"
      });
    }
  });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const port = Number(process.env.PORT || 3000);
startServer(port);

function startServer(preferredPort, attempt = 0) {
  const server = app.listen(preferredPort, HOST, () => {
    console.log(`孩子丢分CT诊断已启动：http://${HOST}:${preferredPort}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attempt < 10) {
      const nextPort = preferredPort + 1;
      console.log(`端口 ${preferredPort} 已被占用，正在尝试：http://localhost:${nextPort}`);
      startServer(nextPort, attempt + 1);
      return;
    }

    console.error(error);
    process.exit(1);
  });
}

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;

    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function analyzeRequest(fields, files) {
  const grade = cleanField(fields.grade, "初二");
  const subject = cleanField(fields.subject, "数学");
  const examType = cleanField(fields.examType, "期中考试");
  const note = cleanField(fields.note, "");
  const uploadedFiles = Array.isArray(files) ? files : [];

  if (!uploadedFiles.length) {
    const error = new Error("请先上传试卷、作业或错题图片后再生成诊断");
    error.publicMessage = error.message;
    error.statusCode = 400;
    throw error;
  }

  uploadedFiles.forEach(validateFile);
  const fileContexts = await Promise.all(uploadedFiles.map(extractFileContext));

  const payload = buildAiPayload({
    grade,
    subject,
    examType,
    note,
    fileContexts
  });

  const aiResult = await requestAi(payload);
  return normalizeReport(aiResult, {
    grade,
    subject,
    examType
  });
}

function cleanField(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function validateFile(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const allowedExt = new Set([".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg"]);

  if (!allowedExt.has(ext)) {
    const error = new Error("暂时只支持 PDF、Word、PNG、JPG 文件");
    error.publicMessage = error.message;
    error.statusCode = 400;
    throw error;
  }
}

async function extractFileContext(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mimeType = file.mimetype || guessMimeType(ext);
  const baseContext = {
    filename: file.originalname,
    mimeType,
    size: file.size,
    extractedText: "",
    extractionNote: ""
  };

  if (ext === ".pdf") {
    const data = await pdfParse(file.buffer);
    baseContext.extractedText = truncateText(data.text || "");
    baseContext.pageCount = data.numpages || null;
    if (!baseContext.extractedText) {
      baseContext.extractionNote = "PDF 未抽取出可读文字，可能是扫描件。建议上传清晰图片以提升视觉识别效果。";
    }
    return baseContext;
  }

  if (ext === ".docx") {
    const data = await mammoth.extractRawText({ buffer: file.buffer });
    baseContext.extractedText = truncateText(data.value || "");
    baseContext.extractionNote = data.messages && data.messages.length
      ? data.messages.map((item) => item.message).join("；")
      : "";
    return baseContext;
  }

  if (ext === ".doc") {
    baseContext.extractionNote = "旧版 .doc 文件无法稳定抽取正文，建议另存为 .docx 或 PDF。";
    return baseContext;
  }

  if (isImageMime(mimeType)) {
    baseContext.imageDataUri = `data:${mimeType};base64,${file.buffer.toString("base64")}`;
    return baseContext;
  }

  return baseContext;
}

function truncateText(text) {
  const normalized = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= MAX_EXTRACTED_TEXT) return normalized;
  return `${normalized.slice(0, MAX_EXTRACTED_TEXT)}\n\n[内容过长，已截取前 ${MAX_EXTRACTED_TEXT} 字用于诊断]`;
}

function guessMimeType(ext) {
  const map = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  };
  return map[ext] || "application/octet-stream";
}

function isImageMime(mimeType) {
  return /^image\/(png|jpe?g)$/i.test(mimeType || "");
}

function buildFilePrompt(fileContexts) {
  if (!fileContexts.length) {
    return "本次未上传文件，只能根据表单信息和补充说明进行初步诊断。";
  }

  let remainingTextBudget = MAX_TOTAL_TEXT_IN_PROMPT;
  const lines = [`本次共上传 ${fileContexts.length} 个文件，请综合分析，不要孤立判断。`];

  fileContexts.forEach((context, index) => {
    lines.push("");
    lines.push(`文件 ${index + 1}`);
    lines.push(`文件名：${context.filename}`);
    lines.push(`文件类型：${context.mimeType}`);
    lines.push(`文件大小：${formatBytes(context.size)}`);
    if (context.pageCount) lines.push(`PDF 页数：${context.pageCount}`);
    if (context.extractionNote) lines.push(`文件抽取说明：${context.extractionNote}`);
    if (context.imageDataUri) lines.push("图片资料：已作为视觉输入随请求发送，请结合图像内容判断。");

    if (context.extractedText && remainingTextBudget > 0) {
      const text = context.extractedText.slice(0, remainingTextBudget);
      remainingTextBudget -= text.length;
      lines.push(`抽取到的资料正文：\n${text}`);

      if (text.length < context.extractedText.length) {
        lines.push(`[该文件正文因整体资料较多被截断，请优先使用已提供内容和其他证据进行谨慎诊断]`);
      }
    } else if (context.extractedText) {
      lines.push("抽取到正文，但本次多文件文本总量过大，已省略该文件正文。请结合文件名、抽取说明和其他已提供证据谨慎诊断。");
    }
  });

  return lines.join("\n");
}

function buildAiPayload({ grade, subject, examType, note, fileContexts }) {
  const contexts = Array.isArray(fileContexts) ? fileContexts : [];
  const systemPrompt = [
    "你是一名资深教培学情诊断专家，擅长从试卷、作业、错题图片和补充说明中分析学生丢分原因。",
    "请输出可直接用于学生补救和教学跟进的结构化报告。",
    "必须只返回 JSON，不要返回 Markdown、解释文字或代码块。",
    "如果资料不足，也要基于现有信息给出谨慎诊断，并在 details.overall.risks 中说明不确定性。",
    "如果上传了多个文件，请把它们视为同一次诊断的证据集合，交叉识别试卷、答题痕迹、错题、批注和补充说明之间的关系。",
    "不要凭空编造题号、分数或错因；没有证据时，请在 confidence.missingEvidence 中说明缺失证据。",
    "五个维度必须固定为：知识丢分、方法丢分、审题丢分、计算/表达丢分、习惯丢分。",
    "severity 只能取：严重、较重、中等、较轻。",
    "priorityAdvice 建议取：优先处理、及时处理、持续优化。"
  ].join("\n");

  const fileLines = buildFilePrompt(contexts);

  const schema = {
    summary: {
      subject,
      grade,
      examType,
      generatedAt: "YYYY-MM-DD HH:mm",
      overallDiagnosis: "一句话总诊断",
      scoreEstimate: "可选，例如 82/100 或 暂无",
      totalLossRate: 0
    },
    dimensions: [
      {
        name: "知识丢分",
        percentage: 32,
        severity: "严重",
        priorityAdvice: "优先处理",
        analysis: "该维度的原因解释",
        actionItems: ["具体补救动作"]
      }
    ],
    topLossPoints: [
      {
        rank: 1,
        point: "主要失分点",
        questions: "对应题号",
        category: "知识丢分",
        percentage: 12,
        severity: "严重",
        priorityAdvice: "优先处理",
        cause: "原因归类",
        correctionPlan: "纠正方案"
      }
    ],
    details: {
      overall: {
        conclusion: "综合结论",
        strengths: ["目前优势"],
        risks: ["主要风险"]
      },
      analyticsSummary: {
        reportLevel: "诊断等级，例如 A/B/C 或 高风险/中风险/低风险",
        evidenceCount: 0,
        dominantLossType: "主导失分类型",
        estimatedRecoverableScore: "预计可追回分值，例如 8-12分",
        urgentIndex: 0,
        stabilityIndex: 0,
        dataConclusion: "数据化总判断"
      },
      dataQuality: {
        completeness: 0,
        readability: 0,
        evidenceStrength: 0,
        crossValidation: "多文件交叉验证结论",
        limitations: ["资料限制"]
      },
      lossAttribution: [
        {
          factor: "归因因子",
          weight: 0,
          evidence: "证据",
          interpretation: "解释"
        }
      ],
      priorityMatrix: [
        {
          item: "处理事项",
          impact: 0,
          urgency: 0,
          difficulty: 0,
          quadrant: "高影响高紧急",
          action: "处理动作"
        }
      ],
      abilityBenchmarks: [
        {
          ability: "能力项",
          current: 0,
          target: 0,
          gapReason: "差距原因",
          evidence: "证据"
        }
      ],
      evidenceMatrix: [
        {
          source: "文件/题号/批注",
          observed: "观察到的现象",
          inference: "分析推断",
          confidence: "高/中/低"
        }
      ],
      learningProfile: {
        summary: "学生当前学情画像",
        abilityLevel: "基础薄弱/中等稳定/有潜力但不稳定等",
        keySignals: ["从资料中观察到的表现信号"],
        evidence: ["支撑判断的文件证据或题目证据"]
      },
      rootCauseChain: [
        {
          phenomenon: "表层失分现象",
          cause: "深层原因",
          evidence: "来自资料的证据",
          impact: "对后续学习或考试的影响"
        }
      ],
      questionTypeDiagnosis: [
        {
          type: "题型或模块",
          performance: "表现判断",
          weakPoint: "薄弱点",
          sampleQuestions: "对应题号或证据",
          intervention: "干预动作"
        }
      ],
      knowledgeMap: [
        {
          module: "知识模块",
          mastery: "掌握程度",
          evidence: "证据",
          nextAction: "下一步动作"
        }
      ],
      knowledge: {
        summary: "知识掌握诊断",
        items: ["知识点建议"]
      },
      methods: {
        summary: "解题方法诊断",
        items: ["方法建议"]
      },
      review: {
        summary: "审题与表达诊断",
        items: ["审题表达建议"]
      },
      calculation: {
        summary: "计算和过程诊断",
        items: ["计算表达建议"]
      },
      habit: {
        summary: "学习习惯诊断",
        items: ["习惯建议"]
      },
      practicePlan: {
        within7Days: ["7天内行动"],
        within30Days: ["30天内行动"],
        parentTeacherTips: ["家校沟通建议"]
      },
      scoreRecoveryPath: {
        immediate: ["立刻能减少无谓扣分的动作"],
        shortTerm: ["2到4周提分动作"],
        mediumTerm: ["1到2个月能力建设动作"]
      },
      teacherFollowUp: {
        focus: ["老师或助教跟进重点"],
        homeworkDesign: ["作业和练习设计建议"],
        checkMethod: ["检查和反馈方式"]
      },
      riskForecast: [
        {
          risk: "未来风险",
          probability: "高/中/低",
          trigger: "触发条件",
          prevention: "预防动作"
        }
      ],
      remediationROI: [
        {
          action: "补救动作",
          expectedGain: "预计收益",
          effort: "投入成本",
          priority: "优先级",
          reason: "为什么值得做"
        }
      ],
      reviewIndicators: {
        nextExamSignals: ["下次考试观察指标"],
        weeklyCheckpoints: ["每周检查点"],
        stopDoing: ["应该停止的低效动作"]
      },
      confidence: {
        level: "高/中/低",
        basis: "可信度依据",
        missingEvidence: ["仍缺少哪些资料会影响判断"]
      }
    }
  };

  const userText = [
    `学生年级：${grade}`,
    `学科：${subject}`,
    `考试/作业类型：${examType}`,
    `补充说明：${note || "无"}`,
    "",
    fileLines,
    "",
    "请按下面 JSON 结构返回。topLossPoints 请给出 5 条，dimensions 请给出完整 5 项，并让 percentage 使用整数百分比。",
    JSON.stringify(schema, null, 2)
  ].join("\n");

  const userContent = [{ type: "text", text: userText }];
  contexts
    .filter((context) => context.imageDataUri)
    .forEach((context) => {
      userContent.push({
        type: "image_url",
        image_url: {
          url: context.imageDataUri
        }
      });
    });

  return {
    model: AI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent }
    ],
    temperature: 0.2,
    max_tokens: 12000,
    response_format: { type: "json_object" }
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "未知";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 2)}${units[index]}`;
}

async function requestAi(payload) {
  const apiKey = AI_API_KEY;
  const baseUrl = AI_BASE_URL;

  if (!apiKey) {
    const error = new Error("缺少 AI 接口密钥，请在平台后台配置全局 AI 接口");
    error.publicMessage = error.message;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    let { response, raw } = await postChatCompletion(baseUrl, apiKey, payload, controller.signal);
    if (!response.ok && payload.response_format && [400, 422].includes(response.status)) {
      const retryPayload = { ...payload };
      delete retryPayload.response_format;
      ({ response, raw } = await postChatCompletion(baseUrl, apiKey, retryPayload, controller.signal));
    }

    if (!response.ok) {
      const error = new Error(`AI 接口返回异常：${response.status} ${raw.slice(0, 300)}`);
      error.publicMessage = "AI 接口返回异常，请检查接口配置或稍后重试";
      throw error;
    }

    const data = JSON.parse(raw);
    const rawContent = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    const content = Array.isArray(rawContent)
      ? rawContent.map((item) => item.text || item.content || "").join("\n")
      : rawContent;

    if (!content) {
      const error = new Error("AI 接口未返回可解析内容");
      error.publicMessage = "AI 没有返回诊断内容，请重试";
      throw error;
    }

    return parseJsonFromContent(content);
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("AI 接口响应超时");
      timeoutError.publicMessage = "AI 诊断超时，请缩小文件或稍后重试";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function postChatCompletion(baseUrl, apiKey, payload, signal) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal
  });

  const raw = await response.text();
  return { response, raw };
}

function parseJsonFromContent(content) {
  if (typeof content === "object" && content !== null) return content;

  const text = String(content || "").trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(text);
  } catch (firstError) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw firstError;
  }
}

function normalizeReport(report, fallback) {
  const now = formatDateTime(new Date());
  const dimensionOrder = [
    "知识丢分",
    "方法丢分",
    "审题丢分",
    "计算/表达丢分",
    "习惯丢分"
  ];

  const dimensions = dimensionOrder.map((name) => {
    const item = Array.isArray(report.dimensions)
      ? report.dimensions.find((entry) => entry && normalizeName(entry.name) === normalizeName(name))
      : null;

    const percentage = clampPercent(item && item.percentage);
    const severity = normalizeSeverity(item && item.severity, percentage);

    return {
      name,
      percentage,
      severity,
      priorityAdvice: normalizePriority(item && item.priorityAdvice, severity),
      analysis: cleanText(item && item.analysis, "该维度需要结合错题进一步复盘。"),
      actionItems: normalizeList(item && item.actionItems)
    };
  });

  const topLossPoints = normalizeTopLossPoints(report.topLossPoints, dimensions);
  const details = normalizeDetails(report.details);

  return {
    summary: {
      subject: cleanText(report.summary && report.summary.subject, fallback.subject),
      grade: cleanText(report.summary && report.summary.grade, fallback.grade),
      examType: cleanText(report.summary && report.summary.examType, fallback.examType),
      generatedAt: cleanText(report.summary && report.summary.generatedAt, now),
      overallDiagnosis: cleanText(report.summary && report.summary.overallDiagnosis, details.overall.conclusion),
      scoreEstimate: cleanText(report.summary && report.summary.scoreEstimate, "暂无"),
      totalLossRate: clampPercent(report.summary && report.summary.totalLossRate)
    },
    dimensions,
    topLossPoints,
    details
  };
}

function normalizeName(name) {
  return String(name || "").replace(/\s+/g, "");
}

function clampPercent(value) {
  const number = Number(String(value || "0").replace("%", ""));
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function clampNumber(value, min, max) {
  const number = Number(String(value || "0").replace("%", ""));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeSeverity(value, percentage) {
  const text = String(value || "").trim();
  if (["严重", "较重", "中等", "较轻"].includes(text)) return text;
  if (percentage >= 28) return "严重";
  if (percentage >= 18) return "较重";
  if (percentage >= 10) return "中等";
  return "较轻";
}

function normalizePriority(value, severity) {
  const text = String(value || "").trim();
  if (["优先处理", "及时处理", "持续优化"].includes(text)) return text;
  if (severity === "严重" || severity === "较重") return "优先处理";
  if (severity === "中等") return "及时处理";
  return "持续优化";
}

function normalizeTopLossPoints(points, dimensions) {
  const source = Array.isArray(points) ? points.slice(0, 5) : [];
  const dimensionNames = new Set(dimensions.map((item) => item.name));

  return Array.from({ length: 5 }, (_, index) => {
    const item = source[index] || {};
    const category = dimensionNames.has(item.category) ? item.category : dimensions[index % dimensions.length].name;
    const percentage = clampPercent(item.percentage);
    const severity = normalizeSeverity(item.severity, percentage);

    return {
      rank: index + 1,
      point: cleanText(item.point, "待结合错题补充失分点"),
      questions: cleanText(item.questions, "待确认"),
      category,
      percentage,
      severity,
      priorityAdvice: normalizePriority(item.priorityAdvice, severity),
      cause: cleanText(item.cause, "需要继续核对原题和作答过程。"),
      correctionPlan: cleanText(item.correctionPlan, "整理同类题并进行针对性订正。")
    };
  });
}

function normalizeDetails(details = {}) {
  return {
    overall: {
      conclusion: cleanText(details.overall && details.overall.conclusion, "本次诊断已完成，请优先处理高占比失分维度。"),
      strengths: normalizeList(details.overall && details.overall.strengths),
      risks: normalizeList(details.overall && details.overall.risks)
    },
    analyticsSummary: {
      reportLevel: cleanText(details.analyticsSummary && details.analyticsSummary.reportLevel, "B级重点干预"),
      evidenceCount: clampNumber(details.analyticsSummary && details.analyticsSummary.evidenceCount, 0, 999),
      dominantLossType: cleanText(details.analyticsSummary && details.analyticsSummary.dominantLossType, "知识与方法复合型失分"),
      estimatedRecoverableScore: cleanText(details.analyticsSummary && details.analyticsSummary.estimatedRecoverableScore, "待结合原始分数估算"),
      urgentIndex: clampNumber(details.analyticsSummary && details.analyticsSummary.urgentIndex, 0, 100),
      stabilityIndex: clampNumber(details.analyticsSummary && details.analyticsSummary.stabilityIndex, 0, 100),
      dataConclusion: cleanText(details.analyticsSummary && details.analyticsSummary.dataConclusion, "当前失分结构需要优先处理高占比、高复现风险项目。")
    },
    dataQuality: {
      completeness: clampNumber(details.dataQuality && details.dataQuality.completeness, 0, 100),
      readability: clampNumber(details.dataQuality && details.dataQuality.readability, 0, 100),
      evidenceStrength: clampNumber(details.dataQuality && details.dataQuality.evidenceStrength, 0, 100),
      crossValidation: cleanText(details.dataQuality && details.dataQuality.crossValidation, "本次资料可用于生成初步诊断，建议补充原始分数和批改细则。"),
      limitations: normalizeList(details.dataQuality && details.dataQuality.limitations)
    },
    lossAttribution: normalizeObjectList(details.lossAttribution, (item) => ({
      factor: cleanText(item.factor, "待确认归因因子"),
      weight: clampNumber(item.weight, 0, 100),
      evidence: cleanText(item.evidence, "证据不足"),
      interpretation: cleanText(item.interpretation, "需要结合错题继续验证")
    })),
    priorityMatrix: normalizeObjectList(details.priorityMatrix, (item) => ({
      item: cleanText(item.item, "待处理事项"),
      impact: clampNumber(item.impact, 0, 100),
      urgency: clampNumber(item.urgency, 0, 100),
      difficulty: clampNumber(item.difficulty, 0, 100),
      quadrant: cleanText(item.quadrant, "待定位"),
      action: cleanText(item.action, "制定专项训练动作")
    })),
    abilityBenchmarks: normalizeObjectList(details.abilityBenchmarks, (item) => ({
      ability: cleanText(item.ability, "待评估能力"),
      current: clampNumber(item.current, 0, 100),
      target: clampNumber(item.target, 0, 100),
      gapReason: cleanText(item.gapReason, "差距原因待确认"),
      evidence: cleanText(item.evidence, "证据不足")
    })),
    evidenceMatrix: normalizeObjectList(details.evidenceMatrix, (item) => ({
      source: cleanText(item.source, "待确认来源"),
      observed: cleanText(item.observed, "观察现象待确认"),
      inference: cleanText(item.inference, "分析推断待确认"),
      confidence: cleanText(item.confidence, "中")
    })),
    learningProfile: {
      summary: cleanText(details.learningProfile && details.learningProfile.summary, "当前资料显示，学生需要从错因归类和关键题型突破入手。"),
      abilityLevel: cleanText(details.learningProfile && details.learningProfile.abilityLevel, "待结合更多成绩数据判断"),
      keySignals: normalizeList(details.learningProfile && details.learningProfile.keySignals),
      evidence: normalizeList(details.learningProfile && details.learningProfile.evidence)
    },
    rootCauseChain: normalizeObjectList(details.rootCauseChain, (item) => ({
      phenomenon: cleanText(item.phenomenon, "表层失分现象待补充"),
      cause: cleanText(item.cause, "深层原因待结合错题确认"),
      evidence: cleanText(item.evidence, "证据不足"),
      impact: cleanText(item.impact, "可能影响后续同类题稳定性")
    })),
    questionTypeDiagnosis: normalizeObjectList(details.questionTypeDiagnosis, (item) => ({
      type: cleanText(item.type, "待确认题型"),
      performance: cleanText(item.performance, "表现待确认"),
      weakPoint: cleanText(item.weakPoint, "薄弱点待确认"),
      sampleQuestions: cleanText(item.sampleQuestions, "待确认"),
      intervention: cleanText(item.intervention, "用同类题进行专项复盘")
    })),
    knowledgeMap: normalizeObjectList(details.knowledgeMap, (item) => ({
      module: cleanText(item.module, "待确认模块"),
      mastery: cleanText(item.mastery, "待确认"),
      evidence: cleanText(item.evidence, "证据不足"),
      nextAction: cleanText(item.nextAction, "补充同类题训练")
    })),
    knowledge: normalizeDetailGroup(details.knowledge, "知识点掌握存在薄弱环节。"),
    methods: normalizeDetailGroup(details.methods, "解题方法需要从题型识别和步骤迁移上强化。"),
    review: normalizeDetailGroup(details.review, "审题和表达需要建立固定检查动作。"),
    calculation: normalizeDetailGroup(details.calculation, "计算过程需要提升规范性和复核意识。"),
    habit: normalizeDetailGroup(details.habit, "学习习惯需要通过每日复盘持续优化。"),
    practicePlan: {
      within7Days: normalizeList(details.practicePlan && details.practicePlan.within7Days),
      within30Days: normalizeList(details.practicePlan && details.practicePlan.within30Days),
      parentTeacherTips: normalizeList(details.practicePlan && details.practicePlan.parentTeacherTips)
    },
    scoreRecoveryPath: {
      immediate: normalizeList(details.scoreRecoveryPath && details.scoreRecoveryPath.immediate),
      shortTerm: normalizeList(details.scoreRecoveryPath && details.scoreRecoveryPath.shortTerm),
      mediumTerm: normalizeList(details.scoreRecoveryPath && details.scoreRecoveryPath.mediumTerm)
    },
    teacherFollowUp: {
      focus: normalizeList(details.teacherFollowUp && details.teacherFollowUp.focus),
      homeworkDesign: normalizeList(details.teacherFollowUp && details.teacherFollowUp.homeworkDesign),
      checkMethod: normalizeList(details.teacherFollowUp && details.teacherFollowUp.checkMethod)
    },
    riskForecast: normalizeObjectList(details.riskForecast, (item) => ({
      risk: cleanText(item.risk, "待评估风险"),
      probability: cleanText(item.probability, "中"),
      trigger: cleanText(item.trigger, "触发条件待确认"),
      prevention: cleanText(item.prevention, "建立预防动作")
    })),
    remediationROI: normalizeObjectList(details.remediationROI, (item) => ({
      action: cleanText(item.action, "补救动作待确认"),
      expectedGain: cleanText(item.expectedGain, "收益待估算"),
      effort: cleanText(item.effort, "投入待估算"),
      priority: cleanText(item.priority, "中"),
      reason: cleanText(item.reason, "需要结合资料继续判断")
    })),
    reviewIndicators: {
      nextExamSignals: normalizeList(details.reviewIndicators && details.reviewIndicators.nextExamSignals),
      weeklyCheckpoints: normalizeList(details.reviewIndicators && details.reviewIndicators.weeklyCheckpoints),
      stopDoing: normalizeList(details.reviewIndicators && details.reviewIndicators.stopDoing)
    },
    confidence: {
      level: cleanText(details.confidence && details.confidence.level, "中"),
      basis: cleanText(details.confidence && details.confidence.basis, "基于本次上传资料和补充说明生成。"),
      missingEvidence: normalizeList(details.confidence && details.confidence.missingEvidence)
    }
  };
}

function normalizeDetailGroup(group, fallbackSummary) {
  return {
    summary: cleanText(group && group.summary, fallbackSummary),
    items: normalizeList(group && group.items)
  };
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeObjectList(list, mapper) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === "object")
    .map(mapper)
    .slice(0, 8);
}

function cleanText(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function formatDateTime(date) {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return formatter.format(date).replace(/\//g, "-");
}

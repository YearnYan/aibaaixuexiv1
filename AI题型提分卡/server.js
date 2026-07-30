const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

loadLocalEnv();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 4
  }
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || process.env.BIND_HOST || "127.0.0.1";
const API_URL = (process.env.CCC_API_URL || "https://cccapi.top/v1").replace(/\/+$/, "");
const MODEL = process.env.CCC_MODEL || "gemini-3.5-flash";
const API_KEY = process.env.CCC_API_KEY || "";
const MAX_TEXT_CHARS = 18000;
const DEFAULT_NEXT_SUGGESTIONS = [
  { title: "基础巩固", detail: "建议完成 8 道基础题，巩固核心等量关系。", count: "8题" },
  { title: "能力提升", detail: "建议完成 6 道提升题，训练多条件建模能力。", count: "6题" },
  { title: "拓展挑战", detail: "建议完成 4 道拓展题，提升综合应用与变式能力。", count: "4题" }
];

app.use(express.json({ limit: "2mb" }));
app.get("/favicon.ico", (req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    apiConfigured: Boolean(API_KEY),
    time: new Date().toISOString()
  });
});

app.post("/api/generate", upload.array("files", 4), async (req, res) => {
  try {
    const grade = normalizeText(req.body.grade);
    const subject = normalizeText(req.body.subject);
    const topic = normalizeText(req.body.topic);
    const files = req.files || [];

    if (!API_KEY) {
      return res.status(500).json({ error: "AI 接口密钥未配置，请检查 .env 文件。" });
    }

    if (!grade || !subject) {
      return res.status(400).json({ error: "请完整填写年级和科目。" });
    }

    if (!topic && !files.length) {
      return res.status(400).json({ error: "请上传题目文件，或填写题型名称用于生成。" });
    }

    const extracted = await extractFiles(files);
    const prompt = buildPrompt({ grade, subject, topic, extracted });
    const report = await generateReport(prompt, extracted.images);

    res.json({
      ok: true,
      generatedAt: formatLocalDateTime(new Date()),
      report: normalizeReport(report, { grade, subject, topic })
    });
  } catch (error) {
    console.error("[generate-error]", error);
    res.status(500).json({
      error: error.message || "生成失败，请稍后重试。"
    });
  }
});

app.use((error, req, res, next) => {
  if (error && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "单个文件不能超过 20MB。" });
  }
  if (error) {
    return res.status(500).json({ error: error.message || "服务异常。" });
  }
  next();
});

app.listen(PORT, HOST, () => {
  console.log(`AI题型提分卡已启动：http://${HOST}:${PORT}`);
});

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function extractFiles(files) {
  const textBlocks = [];
  const images = [];
  const warnings = [];

  for (const file of files) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = file.mimetype || "";
    const title = `【${file.originalname || "未命名文件"}】`;

    try {
      if (ext === ".pdf" || mime.includes("pdf")) {
        const result = await pdfParse(file.buffer);
        textBlocks.push(`${title}\n${trimLongText(result.text || "")}`);
      } else if (ext === ".docx") {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        textBlocks.push(`${title}\n${trimLongText(result.value || "")}`);
      } else if ([".txt", ".md", ".csv"].includes(ext) || mime.startsWith("text/")) {
        textBlocks.push(`${title}\n${trimLongText(file.buffer.toString("utf8"))}`);
      } else if (mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
        const dataUrl = `data:${mime || "image/png"};base64,${file.buffer.toString("base64")}`;
        images.push({ name: file.originalname || "图片文件", dataUrl });
      } else if (ext === ".doc") {
        warnings.push(`${file.originalname} 是旧版 Word 格式，建议转换为 .docx 或 PDF 后上传。`);
      } else {
        warnings.push(`${file.originalname} 暂不支持解析，已跳过。`);
      }
    } catch (error) {
      warnings.push(`${file.originalname} 解析失败：${error.message}`);
    }
  }

  return {
    text: trimLongText(textBlocks.filter(Boolean).join("\n\n---\n\n")),
    images,
    warnings
  };
}

function trimLongText(text) {
  const clean = String(text || "").replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (clean.length <= MAX_TEXT_CHARS) return clean;
  return `${clean.slice(0, MAX_TEXT_CHARS)}\n\n【内容过长，已截取前 ${MAX_TEXT_CHARS} 字用于分析】`;
}

function buildPrompt({ grade, subject, topic, extracted }) {
  const topicLine = topic
    ? `- 用户填写的题型名称：${topic}`
    : "- 用户未填写题型名称：请优先根据上传资料识别题型，不要硬套默认题型。";
  const fileText = extracted.text || "未提取到文字内容。若有图片，请结合图片内容识别题目信息。";
  const warnings = extracted.warnings.length
    ? `\n\n文件解析提醒：\n${extracted.warnings.map((item) => `- ${item}`).join("\n")}`
    : "";

  return `
你是一名资深 ${subject} 教研老师，请根据用户上传的题目资料和填写信息，生成一份“AI题型提分卡”的结构化报告。

基本信息：
- 年级：${grade}
- 科目：${subject}
${topicLine}

上传资料文字内容：
${fileText}
${warnings}

请只输出 JSON，不要输出 Markdown、解释文字或代码块。JSON 结构必须完全符合：
{
  "recognizedType": "识别出的题型名称",
  "difficulty": "基础考点/中档难度/压轴提升等短标签",
  "tags": ["标签1", "标签2"],
  "features": "题型特征，80字以内",
  "commonMethods": ["常见考查方式1", "常见考查方式2", "常见考查方式3"],
  "knowledge": [
    {"title": "考点名称", "detail": "学生能听懂的解释，50字以内"}
  ],
  "tip": "考点提示，120字以内",
  "solutionSteps": [
    {"title": "步骤名", "detail": "做法说明，60字以内", "tone": "blue"}
  ],
  "mistakes": [
    {"title": "易错点", "detail": "错误原因和提醒，60字以内"}
  ],
  "practice": [
    {"title": "题目 1（基础巩固）", "body": "一道同题型练习题，120字以内", "answer": "参考答案与解析，120字以内"}
  ],
  "checklist": [
    {"item": "检查项", "score": 25}
  ],
  "mastery": 70,
  "nextSuggestions": [
    {"title": "基础巩固", "detail": "练习建议，50字以内", "count": "8题"}
  ]
}

要求：
1. 内容必须贴合上传题目，不要泛泛而谈。
2. knowledge 输出 3 到 4 项；solutionSteps 输出 3 项；mistakes 输出 4 项；practice 输出 2 题。
3. checklist 输出 5 项，分值合计 100。
4. mastery 是 0 到 100 的整数。
5. tags、commonMethods、nextSuggestions 要简短，适合直接展示在报告卡片里。
`.trim();
}

async function generateReport(prompt, images) {
  const userContent = images.length
    ? [
        { type: "text", text: prompt },
        ...images.slice(0, 3).map((image) => ({
          type: "image_url",
          image_url: { url: image.dataUrl }
        }))
      ]
    : prompt;

  const body = {
    model: MODEL,
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content: "你是严谨的教研分析助手。必须输出合法 JSON，不能输出 Markdown。"
      },
      {
        role: "user",
        content: userContent
      }
    ],
    response_format: { type: "json_object" }
  };

  let response = await callChatCompletions(body);
  if (!response.ok && response.text.includes("response_format")) {
    const retryBody = { ...body };
    delete retryBody.response_format;
    response = await callChatCompletions(retryBody);
  }

  if (!response.ok) {
    throw new Error(`AI 接口调用失败：${response.status} ${response.text.slice(0, 300)}`);
  }

  const data = JSON.parse(response.text);
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI 接口未返回有效内容。");
  }

  return parseJsonContent(content);
}

async function callChatCompletions(body) {
  const res = await fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    text
  };
}

function parseJsonContent(content) {
  const raw = String(content || "").trim();
  const withoutFence = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  try {
    return JSON.parse(withoutFence);
  } catch (error) {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("AI 返回内容不是合法 JSON，请重新生成。");
  }
}

function normalizeReport(report, fallback) {
  const safe = report && typeof report === "object" ? report : {};
  const recognizedType = normalizeText(safe.recognizedType) || fallback.topic || "AI识别题型";
  const checklist = ensureArray(safe.checklist).slice(0, 5);
  const normalizedChecklist = checklist.length
    ? normalizeChecklist(checklist)
    : [
        { item: "关键条件是否抓全（时间、速度、路程等）", score: 25 },
        { item: "等量关系是否正确", score: 25 },
        { item: "方程组是否正确", score: 25 },
        { item: "计算过程是否正确", score: 15 },
        { item: "结果是否检验并符合题意", score: 10 }
      ];

  return {
    grade: fallback.grade,
    subject: fallback.subject,
    topic: fallback.topic || recognizedType,
    recognizedType,
    difficulty: normalizeText(safe.difficulty) || "中档难度",
    tags: ensureArray(safe.tags).map(normalizeText).filter(Boolean).slice(0, 3),
    features: normalizeText(safe.features) || "已根据题目条件识别核心数量关系，适合用结构化步骤拆解。",
    commonMethods: ensureArray(safe.commonMethods).map(normalizeText).filter(Boolean).slice(0, 4),
    knowledge: ensureArray(safe.knowledge).map(normalizePair).filter(Boolean).slice(0, 4),
    tip: normalizeText(safe.tip) || "先找准题目中的等量关系，再选择合适方法建立模型。",
    solutionSteps: padArray(
      ensureArray(safe.solutionSteps).map(normalizeStep).filter(Boolean),
      [
        { title: "审题建模", detail: "抓住关键词，画图梳理数量关系。", tone: "blue" },
        { title: "列方程组", detail: "设未知数，根据等量关系列出方程组。", tone: "green" },
        { title: "求解并检验", detail: "解出结果，代回题意检验并答题。", tone: "orange" }
      ],
      3
    ),
    mistakes: ensureArray(safe.mistakes).map(normalizePair).filter(Boolean).slice(0, 4),
    practice: ensureArray(safe.practice).map(normalizePractice).filter(Boolean).slice(0, 2),
    checklist: normalizedChecklist,
    mastery: clampInt(safe.mastery, 70, 0, 100),
    nextSuggestions: padArray(
      ensureArray(safe.nextSuggestions).map(normalizeSuggestion).filter(Boolean),
      DEFAULT_NEXT_SUGGESTIONS,
      3
    )
  };
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePair(item) {
  if (!item || typeof item !== "object") return null;
  const title = normalizeText(item.title);
  const detail = normalizeText(item.detail);
  return title && detail ? { title, detail } : null;
}

function normalizeStep(item, index) {
  const pair = normalizePair(item);
  if (!pair) return null;
  const tones = ["blue", "green", "orange"];
  return {
    ...pair,
    tone: tones[index % tones.length]
  };
}

function normalizePractice(item, index) {
  if (!item || typeof item !== "object") return null;
  const title = normalizeText(item.title) || `题目 ${index + 1}`;
  const body = normalizeText(item.body);
  const answer = normalizeText(item.answer);
  return body ? { title, body, answer } : null;
}

function normalizeSuggestion(item, index) {
  if (!item || typeof item !== "object") return null;
  const title = normalizeText(item.title) || ["基础巩固", "能力提升", "拓展挑战"][index] || "专项练习";
  const detail = normalizeText(item.detail);
  const count = normalizeText(item.count) || `${index === 0 ? 8 : index === 1 ? 6 : 4}题`;
  return detail ? { title, detail, count } : null;
}

function padArray(items, fallback, targetLength) {
  const result = items.slice(0, targetLength);
  const titles = new Set(result.map((item) => normalizeText(item.title)).filter(Boolean));
  for (const item of fallback) {
    if (result.length >= targetLength) break;
    const title = normalizeText(item.title);
    if (title && titles.has(title)) continue;
    result.push(item);
    if (title) titles.add(title);
  }
  return result;
}

function normalizeChecklist(items) {
  const normalized = items
    .map((item) => ({
      item: normalizeText(item.item),
      score: clampInt(item.score, 20, 1, 100)
    }))
    .filter((item) => item.item);

  const total = normalized.reduce((sum, item) => sum + item.score, 0);
  if (total === 100 || !normalized.length) return normalized;

  const diff = 100 - total;
  normalized[normalized.length - 1].score = Math.max(1, normalized[normalized.length - 1].score + diff);
  return normalized;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function formatLocalDateTime(date) {
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

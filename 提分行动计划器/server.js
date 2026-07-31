const path = require("path");
const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const { chromium } = require("playwright");
require("dotenv").config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 18 * 1024 * 1024
  }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || process.env.BIND_HOST || "127.0.0.1";
const AI_BASE_URL = (
  process.env.PLATFORM_AI_BASE_URL
  || process.env.AI_BASE_URL
  || "https://cccapi.top/v1"
).replace(/\/$/, "");
const AI_MODEL = (
  process.env.PLATFORM_AI_MODEL
  || process.env.AI_MODEL
  || "gemini-3.5-flash"
).trim();
const AI_API_KEY = String(
  process.env.PLATFORM_AI_API_KEY
  || process.env.AI_API_KEY
  || ""
).trim();

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: AI_MODEL, apiConfigured: Boolean(AI_API_KEY) });
});

app.post("/api/analyze", upload.any(), async (req, res) => {
  try {
    if (!AI_API_KEY) {
      return res.status(500).json({ error: "服务端缺少 AI_API_KEY，请检查 .env 配置。" });
    }

    const fields = normalizeFields(req.body);
    const uploadedFiles = (req.files || []).filter((file) => ["file", "files"].includes(file.fieldname));
    const fileContext = await extractFilesContext(uploadedFiles);
    const report = await createAiReport(fields, fileContext);

    res.json({
      ok: true,
      report: normalizeReport(report, fields),
      extractedTextLength: fileContext.text.length
    });
  } catch (error) {
    console.error("AI analysis failed:", error);
    res.status(500).json({
      error: error.message || "生成分析报告失败，请稍后重试。"
    });
  }
});

app.post("/api/report-pdf", async (req, res) => {
  try {
    const html = String(req.body?.html || "");
    const title = String(req.body?.title || "提分行动计划详情报告");

    if (!html.trim()) {
      return res.status(400).json({ error: "缺少可导出的报告内容。" });
    }

    const pdf = await renderReportPdf(title, html);
    const filename = encodeURIComponent(`${title}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
    res.send(pdf);
  } catch (error) {
    console.error("PDF export failed:", error);
    res.status(500).json({ error: error.message || "PDF生成失败，请稍后重试。" });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

startServer(Number(PORT) || 3000);

function startServer(port, attempt = 0) {
  const server = app.listen(port, HOST, () => {
    console.log(`XX天提分行动计划器已启动：http://${HOST}:${port}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attempt < 10) {
      const nextPort = port + 1;
      console.warn(`端口 ${port} 已被占用，正在尝试 ${nextPort}...`);
      startServer(nextPort, attempt + 1);
      return;
    }

    throw error;
  });
}

function normalizeFields(body) {
  const maxScore = clampNumber(body.maxScore, 1, 1000, 150);
  return {
    grade: String(body.grade || "高二").trim(),
    subject: String(body.subject || "数学").trim(),
    maxScore,
    currentScore: clampNumber(body.currentScore, 0, maxScore, Math.min(92, maxScore)),
    targetScore: clampNumber(body.targetScore, 0, maxScore, Math.min(120, maxScore)),
    planDays: clampNumber(body.planDays, 1, 120, 30),
    dailyHours: clampNumber(body.dailyHours, 0.5, 12, 2)
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function extractFileContext(file) {
  if (!file) {
    return {
      filename: "未上传文件",
      mimeType: "",
      text: "用户未上传试卷或作业文件，请根据表单信息生成可执行学习诊断和提分计划。",
      imageParts: []
    };
  }

  const mimeType = file.mimetype || "";
  const filename = file.originalname || "uploaded-file";

  if (mimeType.includes("pdf") || filename.toLowerCase().endsWith(".pdf")) {
    const parsed = await pdfParse(file.buffer);
    return {
      filename,
      mimeType,
      text: truncateText(parsed.text || "", 18000),
      imageParts: []
    };
  }

  if (
    mimeType.includes("wordprocessingml") ||
    filename.toLowerCase().endsWith(".docx")
  ) {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    return {
      filename,
      mimeType,
      text: truncateText(parsed.value || "", 18000),
      imageParts: []
    };
  }

  if (mimeType.startsWith("image/")) {
    return {
      filename,
      mimeType,
      text: `图片文件：${filename}。请结合图片中的试题、批改痕迹、分数与学生作答情况做学习诊断。`,
      imageParts: [
        {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${file.buffer.toString("base64")}`
          }
        }
      ]
    };
  }

  if (mimeType.startsWith("text/") || filename.toLowerCase().endsWith(".txt")) {
    return {
      filename,
      mimeType,
      text: truncateText(file.buffer.toString("utf8"), 18000),
      imageParts: []
    };
  }

  return {
    filename,
    mimeType,
    text: `已上传文件 ${filename}，当前格式无法直接提取正文。请结合用户填写的信息生成计划。`,
    imageParts: []
  };
}

async function extractFilesContext(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return extractFileContext(null);
  }

  const contexts = [];
  for (const [index, file] of files.entries()) {
    const context = await extractFileContext(file);
    contexts.push({
      ...context,
      index: index + 1
    });
  }

  return {
    filename: contexts.map((context) => context.filename).join("、"),
    mimeType: `${contexts.length} files`,
    text: truncateText(
      contexts.map((context) => [
        `【文件${context.index}】`,
        `文件名：${context.filename}`,
        `文件类型：${context.mimeType || "未知"}`,
        "可提取内容：",
        context.text || "未提取到文字内容"
      ].join("\n")).join("\n\n"),
      26000
    ),
    imageParts: contexts.flatMap((context) => context.imageParts || [])
  };
}

async function createAiReport(fields, fileContext) {
  const messages = buildMessages(fields, fileContext);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);

  try {
    const requestBody = JSON.stringify({
      model: AI_MODEL,
      messages,
      temperature: 0.35,
      max_tokens: 12000
    });
    let response;
    let lastNetworkError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(`${AI_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${AI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: requestBody,
          signal: controller.signal
        });
        break;
      } catch (error) {
        lastNetworkError = error;
        if (error.name === "AbortError" || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    if (!response) {
      if (lastNetworkError?.name === "AbortError") throw lastNetworkError;
      throw new Error("AI 接口网络连接失败，请确认接口地址可访问后重试");
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `AI接口返回 ${response.status}`;
      throw new Error(message);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI接口未返回可解析内容。");
    }

    return parseJsonFromContent(content);
  } finally {
    clearTimeout(timer);
  }
}

function buildMessages(fields, fileContext) {
  const prompt = `
你是一名兼具教研经验、学习数据分析能力和升学规划经验的专业学习诊断顾问。请根据学生上传资料和表单信息，生成一份像专业数据分析机构出具的提分行动计划报告：结论明确、数据维度完整、诊断有依据、行动计划可执行。

学生信息：
- 年级：${fields.grade}
- 科目：${fields.subject}
- 当前分数：${fields.currentScore} / ${fields.maxScore}
- 目标分数：${fields.targetScore} / ${fields.maxScore}
- 满分分数：${fields.maxScore}
- 计划天数：${fields.planDays}
- 每天学习时间：${fields.dailyHours}小时

上传文件：
- 文件名：${fileContext.filename}
- 文件类型：${fileContext.mimeType || "未知"}
- 可提取内容：
${fileContext.text || "未提取到文字内容"}

请严格只输出 JSON，不要使用 Markdown，不要解释。JSON 结构必须为：
{
  "weakPoints": [{"name":"薄弱点名称","ratio":32,"severity":"high|medium|low","reason":"一句诊断原因"}],
  "weeklyFocus": [{"week":"第1周","theme":"重点主题","methods":["方法1","方法2"],"goal":"+6-8分"}],
  "dailyActions": [{"day":"周一","title":"模块标题","tasks":["任务1","任务2","任务3","任务4"]}],
  "reviewSchedule": [{"time":"当天回顾","action":"错题复盘及订正","detail":"具体做法"}],
  "checklist": ["今日学习计划已完成","学习时间达标","错题已整理并订正","今日总结与反思已完成"],
  "fullReport": {
    "executiveSummary":"120-180字报告摘要，像专业分析机构的执行摘要",
    "diagnosis":"180-260字综合诊断，必须结合上传资料和分数结构",
    "scoreStrategy":"180-260字提分策略，说明优先级、提分路径和取舍逻辑",
    "dataInsights":[{"label":"失分集中度","value":"60%","level":"高|中|低|可回收|预警","interpretation":"一句专业解读"}],
    "dimensionScores":[{"dimension":"概念掌握","score":72,"max":100,"level":"基础可用","evidence":"证据或依据","action":"干预动作"}],
    "lossAttribution":[{"category":"知识漏洞","ratio":32,"scoreLoss":"约9分","diagnosis":"归因诊断","intervention":"干预策略"}],
    "abilityRadar":[{"ability":"基础题拿分","current":78,"target":90,"comment":"差距解释"}],
    "questionTypeMatrix":[{"type":"题型名称","accuracy":"78%","loss":"约4分","priority":"高|中|低|稳分","strategy":"题型策略"}],
    "dailyRhythm":["上午/课前怎么做","晚上怎么做","周末怎么做"],
    "thirtyDayPlan":[{"range":"第1-7天","focus":"核心目标","tasks":["任务1","任务2","任务3"]}],
    "milestoneChecks":[{"node":"第7天","standard":"验收标准","action":"未达标纠偏动作"}],
    "wrongQuestionMethod":["步骤1","步骤2","步骤3"],
    "riskWarnings":["风险1","风险2","风险3"],
    "parentAdvice":["建议1","建议2","建议3"]
  }
}

要求：
1. weakPoints 返回 5 项，ratio 总和为 100，名称必须来自上传资料可推断的知识点/题型/能力短板；不要依赖用户手动选择。
2. weeklyFocus 返回 4 项，dailyActions 返回 5 项，reviewSchedule 返回 5 项。
3. fullReport.dataInsights 返回 4 项；dimensionScores 返回 4 项；lossAttribution 返回 4 项；abilityRadar 返回 4 项；questionTypeMatrix 返回 4 项；milestoneChecks 返回 4 项。
4. 所有内容必须具体、可执行，避免空话；要体现专业数据分析报告感。
5. 如果资料信息不足，可以基于年级、科目、当前分数、目标分数和常见考试结构合理推断，但不要编造具体题号、排名、真实班级数据。
`.trim();

  if (fileContext.imageParts.length > 0) {
    return [
      {
        role: "system",
        content: "你是严谨的中文学习诊断与提分计划生成助手，必须输出严格 JSON。"
      },
      {
        role: "user",
        content: [{ type: "text", text: prompt }, ...fileContext.imageParts]
      }
    ];
  }

  return [
    {
      role: "system",
      content: "你是严谨的中文学习诊断与提分计划生成助手，必须输出严格 JSON。"
    },
    {
      role: "user",
      content: prompt
    }
  ];
}

function parseJsonFromContent(content) {
  const raw = Array.isArray(content)
    ? content.map((item) => item.text || "").join("")
    : String(content);
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("AI返回内容不是 JSON。");
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeReport(report, fields) {
  const fallback = createFallbackReport(fields);
  const normalized = {
    generatedAt: new Date().toISOString(),
    weakPoints: Array.isArray(report.weakPoints) && report.weakPoints.length
      ? report.weakPoints
      : fallback.weakPoints,
    weeklyFocus: Array.isArray(report.weeklyFocus) && report.weeklyFocus.length
      ? report.weeklyFocus
      : fallback.weeklyFocus,
    dailyActions: Array.isArray(report.dailyActions) && report.dailyActions.length
      ? report.dailyActions
      : fallback.dailyActions,
    reviewSchedule: Array.isArray(report.reviewSchedule) && report.reviewSchedule.length
      ? report.reviewSchedule
      : fallback.reviewSchedule,
    checklist: Array.isArray(report.checklist) && report.checklist.length
      ? report.checklist
      : fallback.checklist,
    fullReport: report.fullReport && typeof report.fullReport === "object"
      ? { ...fallback.fullReport, ...report.fullReport }
      : fallback.fullReport
  };

  normalized.weakPoints = normalized.weakPoints.slice(0, 5).map((item, index) => ({
    name: String(item.name || fallback.weakPoints[index]?.name || "薄弱点"),
    ratio: clampNumber(item.ratio, 1, 100, fallback.weakPoints[index]?.ratio || 20),
    severity: ["high", "medium", "low"].includes(item.severity) ? item.severity : "medium",
    reason: String(item.reason || "需要通过专项训练提升稳定性。")
  }));

  normalized.weeklyFocus = normalized.weeklyFocus.slice(0, 4);
  normalized.dailyActions = normalized.dailyActions.slice(0, 5);
  normalized.reviewSchedule = normalized.reviewSchedule.slice(0, 5);
  return normalized;
}

function createFallbackReport(fields) {
  const selected = ["函数与导数", "立体几何", "解析几何", "数列", "概率统计"];
  return {
    weakPoints: selected.slice(0, 5).map((name, index) => ({
      name,
      ratio: [32, 28, 18, 12, 10][index] || 10,
      severity: index < 2 ? "high" : index === 2 ? "medium" : "low",
      reason: "需要结合基础概念、题型辨识和限时训练同步提升。"
    })),
    weeklyFocus: [
      { week: "第1周", theme: "基础概念强化", methods: ["错题归因", "核心公式复述"], goal: "+6-8分" },
      { week: "第2周", theme: "综合题型提升", methods: ["典型题拆解", "同类题变式"], goal: "+6-8分" },
      { week: "第3周", theme: "压轴模块突破", methods: ["限时训练", "步骤规范"], goal: "+5-6分" },
      { week: "第4周", theme: "真题演练复盘", methods: ["整卷模拟", "错因回收"], goal: "+5-6分" }
    ],
    dailyActions: [
      { day: "周一", title: "立体几何基础", tasks: ["空间点线面关系", "基本图形性质", "例题精讲6题", "随堂练习8题"] },
      { day: "周二", title: "空间向量", tasks: ["向量概念运算", "向量法解夹角问题", "例题精讲6题", "随堂练习8题"] },
      { day: "周三", title: "建系与计算", tasks: ["空间直角坐标系", "距离与角度计算", "例题精讲6题", "随堂练习8题"] },
      { day: "周四", title: "综合应用", tasks: ["综合题解题策略", "真题片段训练", "限时训练1套", "错题整理复盘"] },
      { day: "周五", title: "错题复盘", tasks: ["本周错题回顾", "薄弱点再巩固", "强化练习10题", "总结与反思"] }
    ],
    reviewSchedule: [
      { time: "当天回顾", action: "当天错题及时订正", detail: "标出错因、补齐关键步骤。" },
      { time: "3天后", action: "错题重做巩固记忆", detail: "只看题干不看答案，检验是否真正会做。" },
      { time: "7天后", action: "变式训练强化理解", detail: "找同类题做迁移训练。" },
      { time: "15天后", action: "综合应用避免再错", detail: "放入套卷场景中重新检验。" },
      { time: "30天后", action: "定期回顾长期巩固", detail: "回收反复错题和易混概念。" }
    ],
    checklist: ["今日学习计划已完成", "学习时间达标", "错题已整理并订正", "今日总结与反思已完成"],
    fullReport: {
      executiveSummary: `本报告基于${fields.grade}${fields.subject}学习资料、当前得分 ${fields.currentScore}/${fields.maxScore} 与目标得分 ${fields.targetScore}/${fields.maxScore} 建立诊断视角，重点识别短期可回收分数、核心薄弱模块和30天执行路径。`,
      diagnosis: "当前分数说明基础框架已经具备，但高频失分多集中在概念迁移、步骤规范和综合题拆解。接下来要减少盲目刷题，把错题转化成明确训练模块。",
      scoreStrategy: "优先处理失分占比最高的两个模块，用前两周稳住基础分和中档题；第三周突破综合题步骤，第四周通过真题套卷稳定输出。",
      dataInsights: [
        { label: "失分集中度", value: "60%", level: "高", interpretation: "前两个薄弱模块贡献主要失分，应优先进入专项训练。" },
        { label: "中档题稳定性", value: "中等", level: "预警", interpretation: "会做但不稳定的题目是短期提分主战场。" },
        { label: "过程分回收空间", value: "8-12分", level: "可回收", interpretation: "规范书写、关键步骤补全可直接提升卷面得分。" },
        { label: "执行可达性", value: "较高", level: "可推进", interpretation: `每天${fields.dailyHours}小时可支撑专项训练和错题回收闭环。` }
      ],
      dimensionScores: [
        { dimension: "概念掌握", score: 72, max: 100, level: "基础可用", evidence: "核心公式与基本模型基本具备，但迁移场景下不够稳定。", action: "用每日10分钟口述公式、条件和适用边界。" },
        { dimension: "题型识别", score: 64, max: 100, level: "需要强化", evidence: "综合题容易卡在条件转化和模型选择。", action: "按题型建立解题入口清单，先判断再计算。" },
        { dimension: "运算准确", score: 68, max: 100, level: "波动明显", evidence: "联立计算、坐标运算和符号处理容易失分。", action: "每周安排2次限时计算专项，记录错误类型。" },
        { dimension: "步骤表达", score: 58, max: 100, level: "优先修复", evidence: "证明题和解答题过程分回收不足。", action: "对照评分标准重写关键步骤，形成模板化表达。" }
      ],
      lossAttribution: [
        { category: "知识漏洞", ratio: 32, scoreLoss: "约9分", diagnosis: "概念边界和公式条件掌握不完整。", intervention: "用错题反推知识点，建立一页式公式条件卡。" },
        { category: "模型迁移", ratio: 28, scoreLoss: "约8分", diagnosis: "遇到变式题时不能快速定位解题入口。", intervention: "同一题型连续做3道变式，并总结共同结构。" },
        { category: "计算失误", ratio: 22, scoreLoss: "约6分", diagnosis: "化简、代入、符号处理导致非能力性失分。", intervention: "建立草稿规范，关键计算二次验算。" },
        { category: "表达扣分", ratio: 18, scoreLoss: "约5分", diagnosis: "证明和解答步骤缺少必要条件。", intervention: "按评分点补齐因果链和结论句。" }
      ],
      abilityRadar: [
        { ability: "基础题拿分", current: 78, target: 90, comment: "通过限时小题训练稳定送分题。" },
        { ability: "中档题拆解", current: 62, target: 82, comment: "短期提分核心能力。" },
        { ability: "综合题建模", current: 54, target: 72, comment: "先突破第一问和关键转化。" },
        { ability: "卷面规范", current: 58, target: 85, comment: "过程分回收空间大。" }
      ],
      questionTypeMatrix: [
        { type: "选择填空基础题", accuracy: "78%", loss: "约4分", priority: "稳分", strategy: "限时训练，减少低级错误。" },
        { type: "中档解答题", accuracy: "61%", loss: "约12分", priority: "高", strategy: "拆题干、找模型、写步骤。" },
        { type: "综合压轴前两问", accuracy: "38%", loss: "约8分", priority: "中", strategy: "先拿入口分和过程分。" },
        { type: "证明与规范表达", accuracy: "55%", loss: "约6分", priority: "高", strategy: "用评分点模板重写答案。" }
      ],
      dailyRhythm: ["开始前用10分钟复述公式与模型", "主体训练控制在90分钟内并记录错因", "结束后用20分钟整理错题和二次订正"],
      thirtyDayPlan: [
        { range: "第1-7天", focus: "基础概念与高频题型", tasks: ["梳理公式", "完成基础题", "建立错题标签"] },
        { range: "第8-14天", focus: "中档综合题", tasks: ["拆解题干条件", "训练步骤表达", "同类题变式"] },
        { range: "第15-21天", focus: "压轴模块突破", tasks: ["限时训练", "复盘卡点", "总结通用策略"] },
        { range: "第22-30天", focus: "整卷模拟与稳定提分", tasks: ["真题套卷", "错题回收", "考前清单"] }
      ],
      milestoneChecks: [
        { node: "第7天", standard: "核心公式和基础题型正确率达到85%以上", action: "未达标则延长基础训练2天。" },
        { node: "第15天", standard: "中档题步骤完整度达到80%以上", action: "重点回收过程分。" },
        { node: "第23天", standard: "整卷限时完成率达到95%以上", action: "调整答题顺序和时间分配。" },
        { node: "第30天", standard: "目标模块失分较首测下降50%以上", action: "形成下一阶段计划。" }
      ],
      wrongQuestionMethod: ["记录原错因", "不看答案重做", "三天后做同类变式"],
      riskWarnings: ["只刷题不复盘会导致重复失分", "每天学习时间不足会压缩巩固效果", "综合题步骤不规范会损失过程分"],
      parentAdvice: ["每周只看完成度和错题回收，不用每天追问分数", "帮助学生固定学习时间段", "用阶段小目标替代一次性高压目标"]
    }
  };
}

async function renderReportPdf(title, reportHtml) {
  const appCss = await fsReadText(path.join(__dirname, "public", "styles.css"));
  const printHtml = buildPrintableReportHtml(title, appCss, reportHtml);
  const executablePath = process.env.EXPORT_BROWSER_PATH?.trim();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
    await page.setContent(printHtml, { waitUntil: "networkidle" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "12mm",
        right: "10mm",
        bottom: "12mm",
        left: "10mm"
      }
    });
  } finally {
    await browser.close();
  }
}

function buildPrintableReportHtml(title, appCss, reportHtml) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtmlText(title)}</title>
    <style>
      ${appCss}

      @page {
        size: A4;
        margin: 12mm 10mm;
      }

      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      body {
        margin: 0;
        background: #f8fcf9;
      }

      .pdf-page {
        width: 100%;
      }

      .professional-report {
        gap: 14px;
        padding: 0;
      }

      .report-cover,
      .pro-section,
      .insight-card,
      .dimension-card,
      .loss-item,
      .stage-card,
      .milestone-list article,
      .action-pack > div {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .report-cover {
        grid-template-columns: 1fr 0.8fr;
        min-height: 0;
        padding: 20px;
      }

      .report-cover h2 {
        font-size: 28px;
      }

      .report-cover p,
      .pro-section p {
        font-size: 12px;
      }

      .report-kpis,
      .insight-grid,
      .dimension-grid,
      .stage-grid,
      .milestone-list {
        grid-template-columns: 1fr 1fr;
      }

      .metric-tile {
        min-height: 74px;
      }

      .metric-tile strong,
      .insight-card strong {
        font-size: 24px;
      }

      .pro-section {
        padding: 16px;
      }

      .pro-section h3 {
        font-size: 18px;
      }

      .dimension-card {
        min-height: 0;
      }

      .dimension-score {
        font-size: 28px;
      }

      .matrix-grid {
        grid-template-columns: 1.2fr 0.65fr 0.65fr 0.65fr 1.25fr;
      }

      .matrix-grid > div,
      .stage-card li,
      .action-pack li,
      .insight-card p,
      .dimension-card p,
      .loss-item p,
      .radar-row p,
      .milestone-list p {
        font-size: 10px;
      }

      .radar-row {
        grid-template-columns: 90px 1fr 58px 1fr;
      }
    </style>
  </head>
  <body>
    <main class="pdf-page">${reportHtml}</main>
  </body>
</html>`;
}

async function fsReadText(filePath) {
  const fs = require("fs/promises");
  return fs.readFile(filePath, "utf8");
}

function escapeHtmlText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function truncateText(text, maxLength) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[内容过长，已截断]`;
}

import path from "node:path";
import { existsSync } from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import { ZodError } from "zod";
import { analyzeQuestion, testAiConnection } from "./ai.js";
import {
  assertConfigurationAccess,
  buildCandidateConfig,
  loadEffectiveConfig,
  publicConfigStatus,
  saveConfig,
} from "./config-store.js";
import { parseUploadedFiles } from "./file-parser.js";
import { validateAnalysisLatex } from "./latex-renderer.js";
import { generatePdfReport } from "./report-pdf.js";
import { generateWordReport } from "./report-word.js";
import { analyzeInputSchema, configInputSchema, reportRequestSchema } from "./schemas.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || process.env.BIND_HOST || "127.0.0.1";

app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
      },
    },
  }),
);
app.use(express.json({ limit: "256kb" }));

const analyzeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "分析请求过于频繁，请稍后再试" },
});

const configLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "配置请求过于频繁，请稍后再试" },
});

const exportLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "报告生成请求过于频繁，请稍后再试" },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 5,
    fileSize: 15 * 1024 * 1024,
  },
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/config/status", async (_request, response, next) => {
  try {
    response.json(publicConfigStatus(await loadEffectiveConfig()));
  } catch (error) {
    next(error);
  }
});

app.put("/api/config", configLimiter, async (request, response, next) => {
  try {
    assertConfigurationAccess(request.header("x-config-password"));
    const input = configInputSchema.parse(request.body);
    const result = await saveConfig(input);
    response.json(publicConfigStatus(result));
  } catch (error) {
    next(error);
  }
});

app.post("/api/config/test", configLimiter, async (request, response, next) => {
  try {
    assertConfigurationAccess(request.header("x-config-password"));
    const input = configInputSchema.parse(request.body);
    const candidate = await buildCandidateConfig(input);
    if (!candidate.apiKey) {
      response.status(400).json({ error: "请填写 API 密钥" });
      return;
    }
    await testAiConnection(candidate);
    response.json({ ok: true, message: "连接成功" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/analyze", analyzeLimiter, upload.array("files", 5), async (request, response, next) => {
  try {
    const input = analyzeInputSchema.parse(request.body);
    const files = (request.files || []) as Express.Multer.File[];
    if (files.length === 0) {
      response.status(400).json({ error: "请先上传题目、试卷或作业文件" });
      return;
    }

    const effectiveConfig = await loadEffectiveConfig();
    if (!effectiveConfig.config.apiKey) {
      response.status(503).json({ error: "尚未配置 AI，请先打开 AI 配置页面完成设置" });
      return;
    }

    const parsedFiles = await parseUploadedFiles(files);
    const analysis = await analyzeQuestion(effectiveConfig.config, input, parsedFiles);
    response.json({
      analysis,
      meta: {
        subject: input.subject,
        grade: input.grade,
        source: "用户上传",
        recognizedAt: new Date().toISOString(),
        fileNames: parsedFiles.fileNames,
      },
    });
  } catch (error) {
    next(error);
  }
});

function reportFileName(extension: "pdf" | "docx") {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `AI审题分析报告-${stamp}.${extension}`;
}

function setDownloadHeaders(response: Response, fileName: string, contentType: string, length: number) {
  const fallback = fileName.endsWith(".pdf") ? "ai-question-review.pdf" : "ai-question-review.docx";
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", String(length));
  response.setHeader("Content-Disposition", `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  response.setHeader("Cache-Control", "no-store");
}

function ensureReportFormulaQuality(report: ReturnType<typeof reportRequestSchema.parse>) {
  const issues = validateAnalysisLatex(report.analysis);
  if (issues.length > 0) {
    const error = new Error("报告包含无法规范渲染的公式，请重新分析题目后再下载");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }
}

app.post("/api/export/pdf", exportLimiter, async (request, response, next) => {
  try {
    const report = reportRequestSchema.parse(request.body);
    ensureReportFormulaQuality(report);
    const file = await generatePdfReport(report);
    const fileName = reportFileName("pdf");
    setDownloadHeaders(response, fileName, "application/pdf", file.length);
    response.send(file);
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/word", exportLimiter, async (request, response, next) => {
  try {
    const report = reportRequestSchema.parse(request.body);
    ensureReportFormulaQuality(report);
    const file = await generateWordReport(report);
    const fileName = reportFileName("docx");
    setDownloadHeaders(
      response,
      fileName,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      file.length,
    );
    response.send(file);
  } catch (error) {
    next(error);
  }
});

const distDirectory = path.resolve(process.cwd(), "dist");
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory, { index: false, maxAge: "1h" }));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(distDirectory, "index.html"));
  });
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? "单个文件不能超过 15 MB" : "上传文件不符合要求";
    response.status(400).json({ error: message });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({ error: error.issues[0]?.message || "输入内容不符合要求" });
    return;
  }

  const statusCode = (error as { statusCode?: number }).statusCode || 500;
  const message = error instanceof Error ? error.message : "服务暂时不可用";
  if (statusCode >= 500) {
    console.error("服务错误：", message);
  }
  response.status(statusCode).json({ error: message });
});

app.listen(port, host, () => {
  console.log(`AI 审题网站已启动：http://${host}:${port}`);
  console.log(`AI 配置页面：http://${host}:${port}/config`);
});

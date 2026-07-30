const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const multer = require("multer");
const { requestAnalysis, testConnection } = require("./ai-client");
const { assertSupportedFile } = require("./file-content");
const { AppError } = require("./errors");

const MAX_FILE_SIZE = 15 * 1024 * 1024;

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isLoopback(address) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address || "");
}

function createAdminGuard(env) {
  return (req, _res, next) => {
    const configuredPassword = env.ADMIN_PASSWORD || "";
    const suppliedPassword = req.get("x-admin-password") || "";

    if (configuredPassword) {
      if (!timingSafeEqual(configuredPassword, suppliedPassword)) {
        return next(new AppError("ADMIN_UNAUTHORIZED", "管理密码不正确", 401));
      }
      return next();
    }

    if (env.NODE_ENV === "production" || !isLoopback(req.socket.remoteAddress)) {
      return next(new AppError(
        "ADMIN_PASSWORD_REQUIRED",
        "远程配置前必须在服务端设置 ADMIN_PASSWORD",
        401,
      ));
    }
    return next();
  };
}

function createUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: 2, fields: 5 },
    fileFilter: (_req, file, callback) => {
      try {
        assertSupportedFile(file);
        callback(null, true);
      } catch (error) {
        callback(error);
      }
    },
  });
}

function parseAnalyzeFields(body) {
  const subject = String(body.subject || "").trim();
  const totalScore = Number(body.totalScore);
  if (!subject || subject.length > 30) {
    throw new AppError("SUBJECT_INVALID", "请选择有效学科");
  }
  if (!Number.isInteger(totalScore) || totalScore < 1 || totalScore > 150) {
    throw new AppError("TOTAL_SCORE_INVALID", "题目总分必须是 1 到 150 的整数");
  }
  return { subject, totalScore };
}

function createApp({
  configStore,
  env = process.env,
  analyze = requestAnalysis,
  testAi = testConnection,
  disableRateLimit = false,
} = {}) {
  if (!configStore) throw new Error("configStore is required");

  const app = express();
  if (env.TRUST_PROXY) app.set("trust proxy", env.TRUST_PROXY === "true" ? 1 : env.TRUST_PROXY);

  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
  }));
  app.use(express.json({ limit: "100kb" }));

  const publicDir = path.join(__dirname, "..", "public");
  const nodeModulesDir = path.join(__dirname, "..", "node_modules");
  app.use("/icons", express.static(path.join(__dirname, "..", "node_modules", "lucide-static", "icons"), {
    maxAge: "7d",
    immutable: true,
  }));
  app.use("/vendor/katex", express.static(path.join(nodeModulesDir, "katex", "dist"), {
    maxAge: "7d",
    immutable: true,
  }));
  app.get("/vendor/html2pdf.bundle.min.js", (_req, res) => {
    res.sendFile(path.join(nodeModulesDir, "html2pdf.js", "dist", "html2pdf.bundle.min.js"));
  });
  app.get("/vendor/html2canvas.min.js", (_req, res) => {
    res.sendFile(path.join(nodeModulesDir, "html2canvas", "dist", "html2canvas.min.js"));
  });
  app.get("/vendor/docx.iife.js", (_req, res) => {
    res.sendFile(path.join(nodeModulesDir, "docx", "dist", "index.iife.js"));
  });
  app.use(express.static(publicDir, {
    maxAge: env.NODE_ENV === "production" ? "1h" : 0,
    setHeaders: (res, filePath) => {
      if (path.extname(filePath).toLowerCase() === ".html") {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  }));

  app.get("/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(publicDir, "config.html"));
  });

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" } },
  });
  const configLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" } },
  });

  const guard = createAdminGuard(env);
  const upload = createUpload();

  app.get("/api/health", async (_req, res, next) => {
    try {
      const config = await configStore.getResolvedConfig();
      res.json({ ok: true, configured: Boolean(config.apiKey) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/config", disableRateLimit ? guard : [configLimiter, guard], async (_req, res, next) => {
    try {
      res.json(await configStore.getPublicConfig());
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/config", disableRateLimit ? guard : [configLimiter, guard], async (req, res, next) => {
    try {
      res.json(await configStore.save(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/config/test", disableRateLimit ? guard : [configLimiter, guard], async (req, res, next) => {
    try {
      const candidate = configStore.validateInput(req.body);
      const saved = await configStore.getResolvedConfig();
      const config = { ...candidate, apiKey: candidate.apiKey.trim() || saved.apiKey };
      res.json(await testAi({ config }));
    } catch (error) {
      next(error);
    }
  });

  const analyzeMiddleware = [
    ...(disableRateLimit ? [] : [apiLimiter]),
    upload.fields([
      { name: "questionFile", maxCount: 1 },
      { name: "answerFile", maxCount: 1 },
    ]),
  ];

  app.post("/api/analyze", analyzeMiddleware, async (req, res, next) => {
    try {
      const { subject, totalScore } = parseAnalyzeFields(req.body);
      const questionFile = req.files?.questionFile?.[0];
      const answerFile = req.files?.answerFile?.[0];
      if (!questionFile) {
        throw new AppError("QUESTION_FILE_REQUIRED", "请先上传题目资料");
      }
      const config = await configStore.getResolvedConfig();
      const report = await analyze({
        config,
        subject,
        totalScore,
        questionFile,
        answerFile,
      });
      res.json(report);
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (_req, _res, next) => next(new AppError("API_NOT_FOUND", "接口不存在", 404)));

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "单个文件不能超过 15 MB"
        : "上传文件数量或表单内容超出限制";
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: { code: error.code, message },
      });
    }

    const status = error instanceof AppError ? error.status : 500;
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    const message = error instanceof AppError ? error.message : "服务器处理失败，请稍后重试";
    if (status >= 500) console.error(`[${code}] ${error.stack || error.message}`);
    return res.status(status).json({ error: { code, message } });
  });

  return app;
}

module.exports = { createApp, parseAnalyzeFields, isLoopback };

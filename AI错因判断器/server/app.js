const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const multer = require('multer');
const { ZodError } = require('zod');
const { AiServiceError, analyzeWithAi, testConnection } = require('./ai-client');
const { getConfig, saveConfig, toPublicConfig } = require('./config-store');
const { FileParseError, parseQuestionFile } = require('./file-parser');
const { ExportError, buildDocx, generatePdf } = require('./report-export');
const { analyzeFieldsSchema, exportRequestSchema } = require('./schemas');

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg']);

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdmin(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next();
  if (!safeEqual(req.get('X-Admin-Password'), password)) {
    return res.status(401).json({ ok: false, code: 'ADMIN_UNAUTHORIZED', message: '管理密码不正确' });
  }
  return next();
}

function sendDownload(res, file, contentType) {
  const encodedFilename = encodeURIComponent(file.filename);
  res.set({
    'Content-Type': contentType,
    'Content-Length': String(file.buffer.length),
    'Content-Disposition': `attachment; filename="report"; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'no-store',
  });
  res.send(file.buffer);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
  }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'ai-error-diagnosis' });
  });

  app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
  });

  app.get('/api/config', async (req, res, next) => {
    try {
      res.json({ ok: true, config: toPublicConfig(await getConfig()) });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/config', requireAdmin, async (req, res, next) => {
    try {
      const saved = await saveConfig(req.body);
      res.json({ ok: true, message: 'AI 配置已保存', config: toPublicConfig(saved) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/config/test', requireAdmin, rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }), async (req, res, next) => {
    try {
      const config = await getConfig();
      const result = await testConnection(config);
      res.json({
        ok: true,
        message: '模型连接成功',
        model: config.model,
        latencyMs: result.latencyMs,
      });
    } catch (error) {
      next(error);
    }
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: 20 * 1024 * 1024, fields: 10 },
    fileFilter: (req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      if (!allowedExtensions.has(extension)) {
        return callback(new FileParseError('仅支持 PDF、DOC、DOCX、PNG、JPG 或 JPEG 文件'));
      }
      return callback(null, true);
    },
  });

  app.post('/api/analyze', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }), upload.single('questionFile'), async (req, res, next) => {
    try {
      if (!req.file) throw new FileParseError('请上传题目文件');
      const fields = analyzeFieldsSchema.parse(req.body);
      const parsedFile = await parseQuestionFile(req.file);
      const report = await analyzeWithAi(await getConfig(), fields, parsedFile);
      res.json({
        ok: true,
        report,
        source: {
          filename: req.file.originalname,
          warnings: parsedFile.warnings,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  const exportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  app.post('/api/export/pdf', exportLimiter, async (req, res, next) => {
    try {
      const payload = exportRequestSchema.parse(req.body);
      sendDownload(res, await generatePdf(payload), 'application/pdf');
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/export/docx', exportLimiter, async (req, res, next) => {
    try {
      const payload = exportRequestSchema.parse(req.body);
      sendDownload(
        res,
        await buildDocx(payload),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    } catch (error) {
      next(error);
    }
  });

  app.use('/vendor/katex', express.static(path.join(projectRoot, 'node_modules', 'katex', 'dist'), {
    immutable: true,
    maxAge: '30d',
  }));
  app.use('/vendor', express.static(path.join(projectRoot, 'node_modules', 'lucide', 'dist', 'umd'), {
    immutable: true,
    maxAge: '30d',
  }));
  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '接口不存在' });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 20MB' : '文件上传失败';
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        ok: false,
        code: error.code,
        message,
      });
    }
    if (error instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: error.issues[0]?.message || '输入内容不符合要求',
        fields: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    if (error instanceof FileParseError || error instanceof AiServiceError || error instanceof ExportError) {
      return res.status(error.status).json({
        ok: false,
        code: error.code,
        message: error.message,
        details: error.details || undefined,
      });
    }
    console.error('[服务器错误]', error.message);
    return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '服务器处理失败，请稍后重试' });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || process.env.BIND_HOST || '127.0.0.1';
  createApp().listen(port, host, () => {
    console.log(`AI 错因判断网站已启动：http://${host}:${port}`);
  });
}

module.exports = { createApp };

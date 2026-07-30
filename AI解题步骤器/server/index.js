import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { ZodError } from 'zod';
import { generateSolutionPlan, testAiConnection } from './ai-client.js';
import { ConfigStore } from './config-store.js';
import { AppError, assertOrThrow } from './errors.js';
import { parseUploadedFile } from './file-parser.js';
import { analysisFormSchema, configInputSchema, CONTENT_SCHEMA_VERSION } from './schemas.js';
import { SessionStore } from './session-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isLoopback(req) {
  const address = req.socket.remoteAddress || '';
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

function createAdminGuard(env) {
  return (req, _res, next) => {
    const expected = env.ADMIN_PASSWORD || '';
    if (!expected && isLoopback(req)) return next();
    const actual = req.get('x-admin-password') || '';
    if (expected && timingSafeEqualText(actual, expected)) return next();
    return next(new AppError(401, 'ADMIN_UNAUTHORIZED', '请输入正确的配置管理密码。'));
  };
}

export function createApp({
  env = process.env,
  configStore = new ConfigStore({ env }),
  sessionStore = new SessionStore(),
} = {}) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  const adminGuard = createAdminGuard(env);
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 180,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后再试。', code: 'RATE_LIMITED' },
  });
  const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'AI 请求过于频繁，请稍后再试。', code: 'AI_RATE_LIMITED' },
  });

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
      },
    },
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', generalLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      configured: configStore.getPublicConfig().configured,
      contentSchemaVersion: CONTENT_SCHEMA_VERSION,
    });
  });

  app.get('/api/config/status', (_req, res) => {
    const config = configStore.getPublicConfig();
    res.json({
      configured: config.configured,
      providerName: config.providerName,
      model: config.model,
    });
  });

  app.get('/api/config', adminGuard, (_req, res) => {
    res.json(configStore.getPublicConfig());
  });

  app.put('/api/config', adminGuard, (req, res, next) => {
    try {
      const input = configInputSchema.parse(req.body);
      const current = configStore.getConfig();
      assertOrThrow(
        Boolean(input.apiKey || current.apiKey),
        400,
        'API_KEY_REQUIRED',
        '首次保存配置时必须填写 API 密钥。',
      );
      res.json(configStore.saveConfig(input));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/config/test', adminGuard, aiLimiter, async (req, res, next) => {
    try {
      const input = configInputSchema.parse(req.body);
      const current = configStore.getConfig();
      const testConfig = { ...input, apiKey: input.apiKey || current.apiKey };
      assertOrThrow(
        Boolean(testConfig.apiKey),
        400,
        'API_KEY_REQUIRED',
        '连接测试需要 API 密钥。',
      );
      const startedAt = Date.now();
      const reply = await testAiConnection(testConfig);
      res.json({ ok: true, latencyMs: Date.now() - startedAt, reply });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/analyze', aiLimiter, upload.single('file'), async (req, res, next) => {
    try {
      const form = analysisFormSchema.parse(req.body);
      assertOrThrow(req.file, 400, 'FILE_REQUIRED', '请先上传题目文件。');
      const config = configStore.getConfig();
      assertOrThrow(
        Boolean(config.apiKey),
        503,
        'AI_NOT_CONFIGURED',
        'AI 服务暂时不可用，请联系管理员。',
      );
      const source = await parseUploadedFile(req.file);
      const plan = await generateSolutionPlan(config, { ...form, source });
      const session = sessionStore.create({ plan });
      res.status(201).json(session);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/sessions/:sessionId', (req, res, next) => {
    try {
      res.json(sessionStore.getPublic(req.params.sessionId));
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', (_req, _res, next) => {
    next(new AppError(404, 'API_NOT_FOUND', '请求的接口不存在。'));
  });

  const distPath = path.join(projectRoot, 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { maxAge: '1h', etag: true }));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.use((error, _req, res, next) => {
    void next;
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? '文件不能超过 10 MB。'
        : '文件上传失败，请重新选择文件。';
      return res.status(413).json({ error: message, code: error.code });
    }
    if (/multipart|boundary|form/i.test(error?.message || '')) {
      return res.status(400).json({
        error: '上传请求格式无效，请重新选择文件。',
        code: 'UPLOAD_INVALID',
      });
    }
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: error.issues[0]?.message || '提交内容不符合要求。',
        code: 'VALIDATION_ERROR',
      });
    }
    if (error instanceof AppError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error('未处理的服务端错误', error);
    return res.status(500).json({ error: '服务暂时不可用，请稍后重试。', code: 'INTERNAL_ERROR' });
  });

  return app;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  const portArgumentIndex = process.argv.indexOf('--port');
  const portArgument = portArgumentIndex >= 0 ? process.argv[portArgumentIndex + 1] : '';
  const inlinePortArgument = process.argv.find((argument) => argument.startsWith('--port='))?.slice(7);
  const port = Number(inlinePortArgument || portArgument || process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => {
    console.log(`AI 解题步骤器已启动：http://${host}:${port}`);
  });
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  buildCorsOptions,
  applySecurityHeaders,
  attachRequestId,
  createMemoryRateLimiter,
  issueSecurityBootstrap,
  verifyProtectedRequest
} = require('./middleware/security');

const knowledgeRouter = require('./routes/knowledge');
const examRouter = require('./routes/exam');
const renderRouter = require('./routes/render');
const publicRouter = require('./routes/public');
const aiConfigRouter = require('./routes/ai-config');

const app = express();
const PORT = process.env.PORT || 5100;
// 使用 IPv6 未指定地址监听，兼容将 localhost 解析为 ::1 的浏览器环境。
const HOST = process.env.HOST || process.env.BIND_HOST || '::';

app.disable('x-powered-by');
app.use(cors(buildCorsOptions()));
app.use(applySecurityHeaders);
app.use(attachRequestId);
app.use(express.json({ limit: '10mb' }));

// 防止任何 sourcemap 文件被探测
app.get(/\.map$/i, (req, res) => {
  res.status(404).end();
});

app.use(express.static(path.join(__dirname, '../dist'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store');
  }
}));

app.get(
  '/api/security/bootstrap',
  createMemoryRateLimiter({ windowMs: 60 * 1000, max: 120, scope: 'bootstrap' }),
  issueSecurityBootstrap
);

app.use(
  '/api/public',
  createMemoryRateLimiter({ windowMs: 60 * 1000, max: 240, scope: 'public' }),
  publicRouter
);

app.use('/api/admin/ai-config', aiConfigRouter);

app.use(
  '/api/knowledge',
  createMemoryRateLimiter({ windowMs: 60 * 1000, max: 200, scope: 'knowledge' }),
  knowledgeRouter
);

app.use(
  '/api/exam',
  createMemoryRateLimiter({ windowMs: 60 * 1000, max: 40, scope: 'exam' }),
  verifyProtectedRequest,
  examRouter
);

app.use(
  '/api/render',
  createMemoryRateLimiter({ windowMs: 60 * 1000, max: 90, scope: 'render' }),
  verifyProtectedRequest,
  renderRouter
);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`服务已启动: http://${HOST}:${PORT}`);
});

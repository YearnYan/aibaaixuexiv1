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

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || process.env.BIND_HOST || '127.0.0.1';

app.disable('x-powered-by');
app.use(cors(buildCorsOptions()));
app.use(applySecurityHeaders);
app.use(attachRequestId);
// 原始文件以 Data URL 放入 JSON，Base64 会比二进制大约增加三分之一。
// 70MB 可完整承载接口约定的 48MB 原文件总量，并低于统一平台的 80MB 上限。
app.use(express.json({ limit: '70mb' }));

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

// 平台模式下，当前源码前端使用独立的站点 API 前缀；保留原本地 /api 路由，
// 仅为主站代理增加别名，不改变子站本地开发行为。
const platformApiPrefix = process.env.PLATFORM_MODE === '1' ? '/api/site/exam-variant' : null;
if (platformApiPrefix) {
  app.get(
    `${platformApiPrefix}/security/bootstrap`,
    createMemoryRateLimiter({ windowMs: 60 * 1000, max: 120, scope: 'platform-bootstrap' }),
    issueSecurityBootstrap
  );
}

app.use(
  '/api/public',
  createMemoryRateLimiter({ windowMs: 60 * 1000, max: 240, scope: 'public' }),
  publicRouter
);
if (platformApiPrefix) app.use(`${platformApiPrefix}/public`, publicRouter);

app.use(
  '/api/knowledge',
  createMemoryRateLimiter({ windowMs: 60 * 1000, max: 200, scope: 'knowledge' }),
  knowledgeRouter
);
if (platformApiPrefix) {
  app.use(
    `${platformApiPrefix}/knowledge`,
    createMemoryRateLimiter({ windowMs: 60 * 1000, max: 200, scope: 'platform-knowledge' }),
    knowledgeRouter
  );
}

app.use(
  '/api/exam',
  createMemoryRateLimiter({ windowMs: 60 * 1000, max: 40, scope: 'exam' }),
  verifyProtectedRequest,
  examRouter
);
if (platformApiPrefix) {
  app.use(
    `${platformApiPrefix}/exam`,
    createMemoryRateLimiter({ windowMs: 60 * 1000, max: 40, scope: 'platform-exam' }),
    verifyProtectedRequest,
    examRouter
  );
}

app.use(
  '/api/render',
  createMemoryRateLimiter({ windowMs: 60 * 1000, max: 90, scope: 'render' }),
  verifyProtectedRequest,
  renderRouter
);
if (platformApiPrefix) {
  app.use(
    `${platformApiPrefix}/render`,
    createMemoryRateLimiter({ windowMs: 60 * 1000, max: 90, scope: 'platform-render' }),
    verifyProtectedRequest,
    renderRouter
  );
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`服务已启动: http://${HOST}:${PORT}`);
});

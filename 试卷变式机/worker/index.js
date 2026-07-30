import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { securityHeaders, attachRequestId } from './middleware/headers.js';
import { createRateLimiter, issueBootstrap, verifyProtectedRequest } from './middleware/security.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { examRoutes } from './routes/exam.js';
import { renderRoutes } from './routes/render.js';
import { publicRoutes } from './routes/public.js';

const app = new Hono();

// Global error handler
app.onError((err, c) => {
  console.error('Worker error:', err.message, err.stack);
  return c.json({ error: err.message }, 500);
});

// Global middleware
app.use('*', cors({
  origin: '*',
  credentials: true,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-CX-Request-Token', 'X-CX-Request-Id'],
  maxAge: 600,
}));

app.use('*', securityHeaders);
app.use('*', attachRequestId);

// Block sourcemap files
app.get('*.map', (c) => c.text('', 404));

// Health check (before other routes for quick response)
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// Security bootstrap
app.get('/api/security/bootstrap',
  createRateLimiter({ windowMs: 60000, max: 120, scope: 'bootstrap' }),
  issueBootstrap
);

// Public routes
app.route('/api/public', publicRoutes);

// Knowledge routes
app.route('/api/knowledge', knowledgeRoutes);

// Protected exam routes
app.post('/api/exam/*',
  createRateLimiter({ windowMs: 60000, max: 40, scope: 'exam' }),
  verifyProtectedRequest
);
app.route('/api/exam', examRoutes);

// Protected render routes
app.post('/api/render/*',
  createRateLimiter({ windowMs: 60000, max: 90, scope: 'render' }),
  verifyProtectedRequest
);
app.route('/api/render', renderRoutes);

// SPA fallback: pass through to static assets
app.all('*', async (c) => {
  try {
    return await c.env.ASSETS.fetch(c.req.raw);
  } catch {
    return c.env.ASSETS.fetch(new Request(new URL('/', c.req.url), c.req.raw));
  }
});

export default app;

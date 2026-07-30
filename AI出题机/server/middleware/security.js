const crypto = require('crypto');
require('../config/ai');
const {
  appendContinuationGrantSignature,
  createContinuationGrantPayload,
  parseContinuationGrant
} = require('../../shared/continuation-grant');

const SESSION_COOKIE_NAME = 'cx_sid';

const SESSION_TTL_MS = toInt(process.env.SECURITY_SESSION_TTL_MS, 2 * 60 * 60 * 1000, 10 * 60 * 1000);
const TOKEN_TTL_MS = toInt(process.env.SECURITY_TOKEN_TTL_MS, 90 * 1000, 10 * 1000);
const TOKEN_MAX_USES = toInt(process.env.SECURITY_TOKEN_MAX_USES, 8, 1);
const TRIAL_CREDITS_DEFAULT = toInt(process.env.TRIAL_CREDITS_DEFAULT, 3, 0);
const CONTINUATION_GRANT_TTL_MS = toInt(
  process.env.CONTINUATION_GRANT_TTL_MS,
  SESSION_TTL_MS,
  60 * 1000
);

const rateLimitStore = new Map();
const sessionStore = new Map();

const cleanupTimer = setInterval(cleanupMemoryStores, 60 * 1000);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

function toInt(value, fallback, min = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return (req.ip || req.socket?.remoteAddress || 'unknown').toString();
}

function isLoopbackAddress(value) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(value || ''));
}

function safeEqualText(actualValue, expectedValue) {
  const actual = Buffer.from(String(actualValue || ''));
  const expected = Buffer.from(String(expectedValue || ''));
  return actual.length > 0
    && actual.length === expected.length
    && crypto.timingSafeEqual(actual, expected);
}

function getPlatformSecuritySession(req) {
  const platformMode = String(process.env.PLATFORM_MODE || '') === '1';
  const expectedToken = String(process.env.PLATFORM_INTERNAL_TOKEN || '').trim();
  const userId = String(req.headers['x-platform-user-id'] || '').trim().slice(0, 128);
  if (
    !platformMode
    || !expectedToken
    || !isLoopbackAddress(req.socket?.remoteAddress)
    || !safeEqualText(req.headers['x-platform-internal-token'], expectedToken)
    || !userId
  ) {
    return null;
  }

  const platformPoints = Math.max(
    0,
    Math.floor(Number(req.headers['x-platform-user-points']) || 0)
  );
  return {
    id: `platform:${userId}`,
    platformManaged: true,
    platformUserId: userId,
    platformPoints,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    tokens: new Map()
  };
}

function parseCookies(req) {
  const rawCookie = req.headers.cookie;
  if (!rawCookie) return {};

  const result = {};
  const segments = rawCookie.split(';');
  for (const segment of segments) {
    const [rawName, ...rest] = segment.trim().split('=');
    if (!rawName) continue;
    result[rawName] = decodeURIComponent(rest.join('=') || '');
  }
  return result;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (Number.isFinite(options.maxAge)) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function buildCorsOptions() {
  const fromEnv = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const allowList = new Set(fromEnv);

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowList.size === 0) {
        callback(null, true);
        return;
      }

      if (allowList.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('CORS_NOT_ALLOWED'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CX-Request-Token', 'X-CX-Request-Id'],
    maxAge: 600
  };
}

function applySecurityHeaders(req, res, next) {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const isProduction = nodeEnv === 'production';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (isProduction) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
    );
  }
  next();
}

function attachRequestId(req, res, next) {
  const incomingId = req.headers['x-cx-request-id'];
  const requestId = typeof incomingId === 'string' && incomingId.trim()
    ? incomingId.trim().slice(0, 128)
    : crypto.randomBytes(12).toString('hex');

  req.requestId = requestId;
  res.setHeader('X-CX-Request-Id', requestId);
  next();
}

function createMemoryRateLimiter(options = {}) {
  const windowMs = toInt(options.windowMs, 60 * 1000, 1000);
  const max = toInt(options.max, 120, 1);
  const scope = options.scope || 'default';

  return (req, res, next) => {
    const now = Date.now();
    const ip = getClientIp(req);
    const key = `${scope}:${ip}`;
    let state = rateLimitStore.get(key);

    if (!state || now > state.windowEnd) {
      state = {
        count: 0,
        windowEnd: now + windowMs
      };
    }

    state.count += 1;
    rateLimitStore.set(key, state);

    const remaining = Math.max(0, max - state.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(state.windowEnd));

    if (state.count > max) {
      res.status(429).json({
        error: '请求过于频繁，请稍后重试',
        code: 'RATE_LIMIT_EXCEEDED'
      });
      return;
    }

    next();
  };
}

function issueSecurityBootstrap(req, res) {
  const session = ensureSession(req, res);
  const tokenValue = createToken(session);
  const tokenInfo = session.tokens.get(tokenValue);
  const trialCreditsRemaining = getRemainingTrialCredits(session);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    requestToken: tokenValue,
    expiresAt: tokenInfo.expiresAt,
    maxUses: TOKEN_MAX_USES,
    trialCreditsRemaining
  });
}

function verifyProtectedRequest(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  const platformSession = getPlatformSecuritySession(req);
  if (platformSession) {
    req.securitySession = platformSession;
    req.platformUserId = platformSession.platformUserId;
    next();
    return;
  }

  const session = getExistingSession(req);
  if (!session) {
    rejectInvalidToken(res);
    return;
  }

  cleanupSessionTokens(session, Date.now());

  const requestToken = req.headers['x-cx-request-token'];
  if (typeof requestToken !== 'string' || !requestToken.trim()) {
    rejectInvalidToken(res);
    return;
  }

  const tokenInfo = session.tokens.get(requestToken.trim());
  if (!tokenInfo) {
    rejectInvalidToken(res);
    return;
  }

  if (tokenInfo.expiresAt < Date.now()) {
    session.tokens.delete(requestToken.trim());
    rejectInvalidToken(res);
    return;
  }

  tokenInfo.remainingUses -= 1;
  if (tokenInfo.remainingUses <= 0) {
    session.tokens.delete(requestToken.trim());
  }

  session.lastSeenAt = Date.now();
  req.securitySession = session;
  next();
}

function rejectInvalidToken(res) {
  res.setHeader('x-cx-token-invalid', '1');
  res.status(403).json({
    error: '请求校验失败，请刷新页面后重试',
    code: 'SECURITY_TOKEN_INVALID'
  });
}

function ensureSession(req, res) {
  const existing = getExistingSession(req);
  if (existing) {
    existing.lastSeenAt = Date.now();
    return existing;
  }

  const sessionId = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const session = {
    id: sessionId,
    createdAt: now,
    lastSeenAt: now,
    ip: getClientIp(req),
    tokens: new Map(),
    trialCredits: TRIAL_CREDITS_DEFAULT
  };
  sessionStore.set(sessionId, session);

  const forceSecure = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';
  const cookieSecure = forceSecure || (process.env.NODE_ENV === 'production' && req.secure);
  const serialized = serializeCookie(SESSION_COOKIE_NAME, sessionId, {
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    httpOnly: true,
    sameSite: 'Lax',
    secure: cookieSecure
  });
  res.append('Set-Cookie', serialized);

  return session;
}

function getExistingSession(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return null;

  const session = sessionStore.get(sessionId);
  if (!session) return null;

  if (session.lastSeenAt + SESSION_TTL_MS < Date.now()) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session;
}

function createToken(session) {
  cleanupSessionTokens(session, Date.now());
  if (session.tokens.size > 30) {
    session.tokens.clear();
  }

  const value = crypto.randomBytes(24).toString('base64url');
  session.tokens.set(value, {
    expiresAt: Date.now() + TOKEN_TTL_MS,
    remainingUses: TOKEN_MAX_USES
  });
  return value;
}

function cleanupSessionTokens(session, now) {
  for (const [token, info] of session.tokens.entries()) {
    if (info.expiresAt < now || info.remainingUses <= 0) {
      session.tokens.delete(token);
    }
  }
}

function cleanupMemoryStores() {
  const now = Date.now();

  for (const [key, state] of rateLimitStore.entries()) {
    if (now > state.windowEnd + 60 * 1000) {
      rateLimitStore.delete(key);
    }
  }

  for (const [sessionId, session] of sessionStore.entries()) {
    if (session.lastSeenAt + SESSION_TTL_MS < now) {
      sessionStore.delete(sessionId);
      continue;
    }
    cleanupSessionTokens(session, now);
  }
}

function getRemainingTrialCredits(session) {
  if (!session) return 0;
  if (session.platformManaged) return session.platformPoints;
  const parsed = Number.parseInt(session.trialCredits, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    session.trialCredits = 0;
    return 0;
  }
  session.trialCredits = parsed;
  return parsed;
}

function consumeTrialCredit(session) {
  if (session?.platformManaged) {
    return { allowed: true, remaining: getRemainingTrialCredits(session) };
  }
  const remaining = getRemainingTrialCredits(session);
  if (remaining <= 0) {
    return { allowed: false, remaining: 0 };
  }

  session.trialCredits = remaining - 1;
  session.lastSeenAt = Date.now();
  return { allowed: true, remaining: session.trialCredits };
}

function getContinuationGrantSecret() {
  const firstConfiguredKey = String(process.env.AI_API_KEYS || '').split(/[\r\n,]+/)[0]?.trim();
  const secret = [
    process.env.CONTINUATION_GRANT_SECRET,
    process.env.SESSION_SECRET,
    process.env.AI_API_KEY,
    firstConfiguredKey
  ].map((value) => String(value || '').trim()).find((value) => value.length >= 16);
  if (!secret) {
    throw new Error('缺少 CONTINUATION_GRANT_SECRET、SESSION_SECRET 或有效 AI 密钥，无法签发续题凭证');
  }
  return secret;
}

function signPaperContinuationPayload(payload) {
  return crypto
    .createHmac('sha256', getContinuationGrantSecret())
    .update(`paper-continuation:${payload}`)
    .digest('base64url');
}

function issuePaperContinuationGrant(session) {
  if (!session) throw new Error('缺少安全会话，无法签发续题凭证');
  const payload = createContinuationGrantPayload(
    Date.now() + CONTINUATION_GRANT_TTL_MS,
    crypto.randomBytes(18).toString('base64url')
  );
  session.lastSeenAt = Date.now();
  return appendContinuationGrantSignature(payload, signPaperContinuationPayload(payload));
}

function verifyPaperContinuationGrant(session, candidate) {
  const grant = parseContinuationGrant(candidate, { maxTtlMs: CONTINUATION_GRANT_TTL_MS });
  if (!grant) return false;
  const expectedBuffer = Buffer.from(signPaperContinuationPayload(grant.payload));
  const candidateBuffer = Buffer.from(grant.signature);
  const valid = expectedBuffer.length === candidateBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, candidateBuffer);
  if (valid && session) session.lastSeenAt = Date.now();
  return valid;
}

module.exports = {
  buildCorsOptions,
  applySecurityHeaders,
  attachRequestId,
  createMemoryRateLimiter,
  issueSecurityBootstrap,
  verifyProtectedRequest,
  consumeTrialCredit,
  getRemainingTrialCredits,
  issuePaperContinuationGrant,
  verifyPaperContinuationGrant,
  _internals: {
    getPlatformSecuritySession,
    getContinuationGrantSecret,
    signPaperContinuationPayload
  }
};

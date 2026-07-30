// Security middleware for Cloudflare Workers
// Uses HMAC-signed cookies for stateless session management
import continuationGrant from '../../shared/continuation-grant.js';

const {
  appendContinuationGrantSignature,
  createContinuationGrantPayload,
  parseContinuationGrant
} = continuationGrant;

const SESSION_COOKIE_NAME = 'cx_sid';
const TOKEN_TTL_MS = 90 * 1000;
const TOKEN_MAX_USES = 8;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const CONTINUATION_GRANT_TTL_MS = SESSION_TTL_MS;

// In-isolate rate limiting (approximate, per-isolate)
const rateLimitStore = new Map();

function getClientIp(c) {
  return c.req.header('cf-connecting-ip')
    || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || '0.0.0.0';
}

// --- HMAC-based session signing ---

async function importSigningKey(secret) {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

async function getSigningKey(env) {
  const firstConfiguredKey = String(env.AI_API_KEYS || '').split(/[\r\n,]+/)[0]?.trim();
  const secret = env.SESSION_SECRET || env.AI_API_KEY || firstConfiguredKey || 'default-session-secret-change-me';
  return importSigningKey(secret);
}

async function getContinuationSigningKey(env) {
  const firstConfiguredKey = String(env.AI_API_KEYS || '').split(/[\r\n,]+/)[0]?.trim();
  const secret = env.CONTINUATION_GRANT_SECRET
    || env.SESSION_SECRET
    || env.AI_API_KEY
    || firstConfiguredKey
    || 'default-session-secret-change-me';
  return importSigningKey(secret);
}

async function signSession(sessionData, env) {
  const key = await getSigningKey(env);
  const payload = JSON.stringify(sessionData);
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const sigHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return `${btoa(payload)}.${sigHex}`;
}

async function verifySession(cookieValue, env) {
  if (!cookieValue || !cookieValue.includes('.')) return null;
  try {
    const [payloadB64, sigHex] = cookieValue.split('.');
    const payload = atob(payloadB64);
    const key = await getSigningKey(env);
    const encoder = new TextEncoder();
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payload));
    if (!valid) return null;
    const data = JSON.parse(payload);
    if (data.createdAt + SESSION_TTL_MS < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const result = {};
  for (const segment of cookieHeader.split(';')) {
    const [rawName, ...rest] = segment.trim().split('=');
    if (rawName) result[rawName] = decodeURIComponent(rest.join('=') || '');
  }
  return result;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signPaperContinuationPayload(payload, env) {
  const key = await getContinuationSigningKey(env);
  const encoded = new TextEncoder().encode(`paper-continuation:${payload}`);
  const signature = await crypto.subtle.sign('HMAC', key, encoded);
  return bytesToBase64Url(new Uint8Array(signature));
}

// --- HMAC-based request tokens ---

async function createSignedToken(sessionId, env) {
  const key = await getSigningKey(env);
  const tokenData = {
    sid: sessionId,
    exp: Date.now() + TOKEN_TTL_MS,
    uses: TOKEN_MAX_USES,
    nonce: crypto.randomUUID()
  };
  const payload = JSON.stringify(tokenData);
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const sigHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return {
    token: `${btoa(payload)}.${sigHex}`,
    expiresAt: tokenData.exp
  };
}

async function verifySignedToken(tokenValue, env) {
  if (!tokenValue || !tokenValue.includes('.')) return false;
  try {
    const [payloadB64, sigHex] = tokenValue.split('.');
    const payload = atob(payloadB64);
    const key = await getSigningKey(env);
    const encoder = new TextEncoder();
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payload));
    if (!valid) return false;
    const data = JSON.parse(payload);
    return data.exp > Date.now();
  } catch {
    return false;
  }
}

// --- Rate limiting (per-isolate, approximate) ---

export function createRateLimiter({ windowMs = 60000, max = 120, scope = 'default' } = {}) {
  return async (c, next) => {
    const now = Date.now();
    const ip = getClientIp(c);
    const key = `${scope}:${ip}`;
    let state = rateLimitStore.get(key);

    if (!state || now > state.windowEnd) {
      state = { count: 0, windowEnd: now + windowMs };
    }
    state.count += 1;
    rateLimitStore.set(key, state);

    const remaining = Math.max(0, max - state.count);
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(state.windowEnd));

    if (state.count > max) {
      return c.json({
        error: '请求过于频繁，请稍后重试',
        code: 'RATE_LIMIT_EXCEEDED'
      }, 429);
    }

    // Cleanup old entries periodically
    if (rateLimitStore.size > 10000) {
      for (const [k, v] of rateLimitStore.entries()) {
        if (now > v.windowEnd + 60000) rateLimitStore.delete(k);
      }
    }

    await next();
  };
}

// --- Bootstrap endpoint ---

export async function issueBootstrap(c) {
  const env = c.env;
  const cookies = parseCookies(c.req.header('cookie'));
  let session = await verifySession(cookies[SESSION_COOKIE_NAME], env);

  const trialDefault = parseInt(env.TRIAL_CREDITS_DEFAULT || '3', 10) || 3;

  if (!session) {
    session = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      trialCredits: trialDefault
    };
  }

  // Create signed request token
  const { token, expiresAt } = await createSignedToken(session.id, env);

  // Sign and set session cookie
  const signedSession = await signSession(session, env);
  const cookieStr = serializeCookie(SESSION_COOKIE_NAME, signedSession, {
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    httpOnly: true,
    sameSite: 'Lax',
    secure: true
  });

  c.header('Set-Cookie', cookieStr);
  c.header('Cache-Control', 'no-store');
  return c.json({
    requestToken: token,
    expiresAt,
    maxUses: TOKEN_MAX_USES,
    trialCreditsRemaining: session.trialCredits
  });
}

// --- Protected request verification ---

export async function verifyProtectedRequest(c, next) {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const env = c.env;
  const cookies = parseCookies(c.req.header('cookie'));
  const session = await verifySession(cookies[SESSION_COOKIE_NAME], env);

  if (!session) {
    c.header('x-cx-token-invalid', '1');
    return c.json({
      error: '请求校验失败，请刷新页面后重试',
      code: 'SECURITY_TOKEN_INVALID'
    }, 403);
  }

  const requestToken = c.req.header('x-cx-request-token');
  const tokenValid = await verifySignedToken(requestToken, env);

  if (!tokenValid) {
    c.header('x-cx-token-invalid', '1');
    return c.json({
      error: '请求校验失败，请刷新页面后重试',
      code: 'SECURITY_TOKEN_INVALID'
    }, 403);
  }

  c.set('session', session);
  c.set('sessionEnv', env);
  await next();
}

// --- Trial credit management ---

export function consumeTrialCredit(session) {
  const remaining = parseInt(session.trialCredits, 10) || 0;
  if (remaining <= 0) {
    return { allowed: false, remaining: 0 };
  }
  session.trialCredits = remaining - 1;
  return { allowed: true, remaining: session.trialCredits };
}

export function getRemainingTrialCredits(session) {
  if (!session) return 0;
  const parsed = parseInt(session.trialCredits, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export async function issuePaperContinuationGrant(session, env) {
  if (!session) throw new Error('缺少安全会话，无法签发续题凭证');
  const payload = createContinuationGrantPayload(
    Date.now() + CONTINUATION_GRANT_TTL_MS,
    crypto.randomUUID().replace(/-/g, '')
  );
  return appendContinuationGrantSignature(payload, await signPaperContinuationPayload(payload, env));
}

export async function verifyPaperContinuationGrant(session, candidate, env) {
  if (!session) return false;
  const grant = parseContinuationGrant(candidate, { maxTtlMs: CONTINUATION_GRANT_TTL_MS });
  if (!grant) return false;
  try {
    const key = await getContinuationSigningKey(env);
    const encoded = new TextEncoder().encode(`paper-continuation:${grant.payload}`);
    return crypto.subtle.verify('HMAC', key, base64UrlToBytes(grant.signature), encoded);
  } catch {
    return false;
  }
}

export async function updateSessionCookie(c, session) {
  const env = c.env;
  const signedSession = await signSession(session, env);
  const cookieStr = serializeCookie(SESSION_COOKIE_NAME, signedSession, {
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    httpOnly: true,
    sameSite: 'Lax',
    secure: true
  });
  c.header('Set-Cookie', cookieStr);
}

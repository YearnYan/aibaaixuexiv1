const CONTINUATION_GRANT_VERSION = 'cg1';
const CONTINUATION_SIGNATURE_LENGTH = 43;
const CONTINUATION_NONCE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
const CONTINUATION_EXPIRY_PATTERN = /^[0-9a-z]{8,12}$/;
const CLOCK_SKEW_MS = 30 * 1000;

function createContinuationGrantPayload(expiresAt, nonce) {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new Error('续题凭证过期时间无效');
  }
  const normalizedNonce = String(nonce || '');
  if (!CONTINUATION_NONCE_PATTERN.test(normalizedNonce)) {
    throw new Error('续题凭证随机数格式无效');
  }
  return `${CONTINUATION_GRANT_VERSION}.${expiresAt.toString(36)}.${normalizedNonce}`;
}

function appendContinuationGrantSignature(payload, signature) {
  const normalizedSignature = String(signature || '');
  if (!new RegExp(`^[A-Za-z0-9_-]{${CONTINUATION_SIGNATURE_LENGTH}}$`).test(normalizedSignature)) {
    throw new Error('续题凭证签名格式无效');
  }
  return `${payload}.${normalizedSignature}`;
}

function parseContinuationGrant(candidate, options = {}) {
  const source = String(candidate || '');
  if (source.length < 32 || source.length > 128) return null;
  const parts = source.split('.');
  if (parts.length !== 4 || parts[0] !== CONTINUATION_GRANT_VERSION) return null;
  const [, encodedExpiry, nonce, signature] = parts;
  if (!CONTINUATION_EXPIRY_PATTERN.test(encodedExpiry)) return null;
  if (!CONTINUATION_NONCE_PATTERN.test(nonce)) return null;
  if (!new RegExp(`^[A-Za-z0-9_-]{${CONTINUATION_SIGNATURE_LENGTH}}$`).test(signature)) return null;

  const expiresAt = Number.parseInt(encodedExpiry, 36);
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const maxTtlMs = Number.isFinite(options.maxTtlMs) ? Number(options.maxTtlMs) : 0;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  if (maxTtlMs > 0 && expiresAt > now + maxTtlMs + CLOCK_SKEW_MS) return null;

  return {
    payload: parts.slice(0, 3).join('.'),
    signature,
    expiresAt
  };
}

module.exports = {
  CONTINUATION_GRANT_VERSION,
  appendContinuationGrantSignature,
  createContinuationGrantPayload,
  parseContinuationGrant
};

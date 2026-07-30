const OpenAI = require('openai');
const { AI_CONFIG } = require('../config/ai');

const KEY_COOLDOWN_MS = Number.parseInt(process.env.AI_KEY_COOLDOWN_MS || '120000', 10);
const KEY_FAILURE_THRESHOLD = Number.parseInt(process.env.AI_KEY_FAILURE_THRESHOLD || '2', 10);

let pool = [];

let cursor = 0;

function configurePool() {
  pool = AI_CONFIG.apiKeys.map((key, index) => ({
    key,
    index,
    client: new OpenAI({
      apiKey: key,
      baseURL: AI_CONFIG.baseURL
    }),
    failures: 0,
    cooldownUntil: 0,
    successCount: 0
  }));
  cursor = 0;
}

configurePool();

function now() {
  return Date.now();
}

function maskKey(key) {
  const raw = String(key || '');
  if (raw.length <= 8) return '****';
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function pickCandidate() {
  if (!pool.length) return null;

  const size = pool.length;
  const t = now();
  let fallback = null;

  for (let offset = 0; offset < size; offset += 1) {
    const idx = (cursor + offset) % size;
    const item = pool[idx];
    if (!fallback || item.cooldownUntil < fallback.cooldownUntil) {
      fallback = item;
    }
    if (item.cooldownUntil <= t) {
      cursor = (idx + 1) % size;
      return item;
    }
  }

  // 全部在冷却时，选最快恢复的key，避免请求完全阻塞
  cursor = (fallback.index + 1) % size;
  return fallback;
}

function isRetriableError(error) {
  const status = error?.status || error?.response?.status;
  if (!status) return true;
  // 429 / 5xx 认为可以切换key重试，4xx 业务错误不切换
  return status === 429 || status >= 500;
}

function recordFailure(item, reason = '') {
  item.failures += 1;
  if (item.failures >= KEY_FAILURE_THRESHOLD) {
    item.cooldownUntil = now() + KEY_COOLDOWN_MS;
  }
  console.warn(
    `[AI_KEY_POOL] key=${maskKey(item.key)} fail=${item.failures} cooldownUntil=${item.cooldownUntil} reason=${reason || 'unknown'}`
  );
}

function recordSuccess(item) {
  item.failures = 0;
  item.cooldownUntil = 0;
  item.successCount += 1;
}

async function withClient(task) {
  if (!pool.length) {
    throw new Error('AI 密钥池为空，请检查 AI_API_KEY / AI_API_KEYS 配置');
  }

  let lastError = null;
  const tried = new Set();

  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const candidate = pickCandidate();
    if (!candidate || tried.has(candidate.index)) {
      break;
    }
    tried.add(candidate.index);

    try {
      const result = await task(candidate.client, candidate);
      recordSuccess(candidate);
      return result;
    } catch (error) {
      lastError = error;
      const reason = error?.error?.message || error?.message || 'unknown';
      if (!isRetriableError(error)) {
        throw error;
      }
      recordFailure(candidate, reason);
    }
  }

  if (lastError) throw lastError;
  throw new Error('AI 密钥池不可用，请稍后重试');
}

module.exports = {
  withClient,
  configurePool
};

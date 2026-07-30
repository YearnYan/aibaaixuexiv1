// AI 配置与运行时更新工具。
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_FILE = path.join(__dirname, '../.env');
const DEFAULT_AI_API_URL = 'https://api.linapi.net/v1/chat/completions';
const DEFAULT_AI_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_TEMPERATURE = 0.7;

dotenv.config({ path: ENV_FILE });

function normalizeOpenAIBaseURL(apiURL) {
  const input = String(apiURL || '').trim();
  if (!input) return 'https://api.linapi.net/v1';

  return input
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/+$/, '');
}

function parseApiKeys(values) {
  const source = Array.isArray(values) ? values : [values];
  return Array.from(new Set(source
    .flatMap((value) => String(value || '').split(/[\r\n,]+/))
    .map((item) => item.trim())
    .filter(Boolean)));
}

function readInitialKeys() {
  return parseApiKeys([
    process.env.AI_API_KEYS || '',
    process.env.AI_API_KEY || ''
  ]);
}

const AI_CONFIG = {
  apiKey: '',
  apiKeys: [],
  apiURL: process.env.AI_API_URL || DEFAULT_AI_API_URL,
  baseURL: normalizeOpenAIBaseURL(process.env.AI_API_URL || DEFAULT_AI_API_URL),
  model: process.env.AI_MODEL || DEFAULT_AI_MODEL,
  maxTokens: Number.parseInt(process.env.AI_MAX_TOKENS || String(DEFAULT_MAX_TOKENS), 10),
  temperature: Number.parseFloat(process.env.AI_TEMPERATURE || String(DEFAULT_TEMPERATURE))
};

function applyAIConfig(input = {}) {
  const nextURL = String(input.apiURL || AI_CONFIG.apiURL || DEFAULT_AI_API_URL).trim();
  const nextModel = String(input.model || AI_CONFIG.model || DEFAULT_AI_MODEL).trim();
  const nextMaxTokens = Number.parseInt(input.maxTokens ?? AI_CONFIG.maxTokens, 10);
  const nextTemperature = Number.parseFloat(input.temperature ?? AI_CONFIG.temperature);

  let parsedKeys;
  if (Object.prototype.hasOwnProperty.call(input, 'apiKeys')) {
    parsedKeys = parseApiKeys(input.apiKeys);
  } else if (Object.prototype.hasOwnProperty.call(input, 'apiKey')) {
    parsedKeys = parseApiKeys(input.apiKey);
  } else {
    parsedKeys = AI_CONFIG.apiKeys.slice();
  }

  if (!/^https?:\/\//i.test(nextURL)) {
    throw new Error('API 地址必须以 http:// 或 https:// 开头');
  }
  if (!nextModel) throw new Error('模型名称不能为空');
  if (!Number.isInteger(nextMaxTokens) || nextMaxTokens < 256 || nextMaxTokens > 32000) {
    throw new Error('最大输出 Token 需在 256 到 32000 之间');
  }
  if (!Number.isFinite(nextTemperature) || nextTemperature < 0 || nextTemperature > 2) {
    throw new Error('温度需在 0 到 2 之间');
  }

  AI_CONFIG.apiURL = nextURL;
  AI_CONFIG.baseURL = normalizeOpenAIBaseURL(nextURL);
  AI_CONFIG.model = nextModel;
  AI_CONFIG.maxTokens = nextMaxTokens;
  AI_CONFIG.temperature = nextTemperature;
  AI_CONFIG.apiKeys = parsedKeys;
  AI_CONFIG.apiKey = parsedKeys[0] || '';

  process.env.AI_API_URL = nextURL;
  process.env.AI_MODEL = nextModel;
  process.env.AI_MAX_TOKENS = String(nextMaxTokens);
  process.env.AI_TEMPERATURE = String(nextTemperature);
  process.env.AI_API_KEYS = parsedKeys.join(',');
  process.env.AI_API_KEY = parsedKeys[0] || '';

  return AI_CONFIG;
}

applyAIConfig({
  apiURL: AI_CONFIG.apiURL,
  model: AI_CONFIG.model,
  maxTokens: AI_CONFIG.maxTokens,
  temperature: AI_CONFIG.temperature,
  apiKeys: readInitialKeys()
});

function getAIConfigView() {
  return {
    apiURL: AI_CONFIG.apiURL,
    model: AI_CONFIG.model,
    maxTokens: AI_CONFIG.maxTokens,
    temperature: AI_CONFIG.temperature,
    configured: AI_CONFIG.apiKeys.length > 0,
    keyCount: AI_CONFIG.apiKeys.length,
    maskedKeys: AI_CONFIG.apiKeys.map(maskKey)
  };
}

function maskKey(key) {
  const raw = String(key || '');
  if (raw.length <= 8) return '****';
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function updateEnvLine(lines, key, value) {
  const lineIndex = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
  const nextLine = `${key}=${value}`;
  if (lineIndex >= 0) lines[lineIndex] = nextLine;
  else lines.push(nextLine);
}

function persistAIConfig(input = {}) {
  const nextKeys = Object.prototype.hasOwnProperty.call(input, 'apiKeys')
    ? parseApiKeys(input.apiKeys)
    : Object.prototype.hasOwnProperty.call(input, 'apiKey')
      ? parseApiKeys(input.apiKey)
      : AI_CONFIG.apiKeys.slice();
  const next = applyAIConfig({ ...input, apiKeys: nextKeys });
  const source = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const lines = source.split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line !== '');
  updateEnvLine(lines, 'AI_API_URL', next.apiURL);
  updateEnvLine(lines, 'AI_MODEL', next.model);
  updateEnvLine(lines, 'AI_MAX_TOKENS', next.maxTokens);
  updateEnvLine(lines, 'AI_TEMPERATURE', next.temperature);
  updateEnvLine(lines, 'AI_API_KEYS', next.apiKeys.join(','));
  lines.push('');
  fs.writeFileSync(ENV_FILE, lines.join('\n'), 'utf8');
  return next;
}

module.exports = {
  AI_CONFIG,
  ENV_FILE,
  applyAIConfig,
  persistAIConfig,
  getAIConfigView,
  maskKey
};

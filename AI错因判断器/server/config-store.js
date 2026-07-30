const fs = require('node:fs/promises');
const path = require('node:path');
const { configInputSchema } = require('./schemas');

const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(projectRoot, 'data');
const configPath = path.join(dataDir, 'ai-config.json');

const defaultConfig = Object.freeze({
  provider: 'openai',
  baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  apiKey: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || 'gpt-4.1-mini',
  temperature: Number(process.env.AI_TEMPERATURE || 0.2),
  timeoutMs: Number(process.env.AI_TIMEOUT_MS || 90000),
});

function normalizeConfig(config) {
  return {
    ...config,
    baseUrl: config.baseUrl.replace(/\/+$/, ''),
  };
}

async function readStoredConfig() {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function getConfig() {
  if (process.env.PLATFORM_MODE === '1') {
    return normalizeConfig({
      ...defaultConfig,
      baseUrl: process.env.PLATFORM_AI_BASE_URL || process.env.AI_BASE_URL || defaultConfig.baseUrl,
      apiKey: process.env.PLATFORM_AI_API_KEY || process.env.AI_API_KEY || '',
      model: process.env.PLATFORM_AI_MODEL || process.env.AI_MODEL || defaultConfig.model,
    });
  }
  const stored = await readStoredConfig();
  return normalizeConfig({ ...defaultConfig, ...(stored || {}) });
}

async function saveConfig(input) {
  const current = await getConfig();
  const parsed = configInputSchema.parse(input);
  const next = normalizeConfig({
    provider: parsed.provider,
    baseUrl: parsed.baseUrl,
    apiKey: parsed.clearApiKey ? '' : (parsed.apiKey || current.apiKey),
    model: parsed.model,
    temperature: parsed.temperature,
    timeoutMs: parsed.timeoutMs,
  });

  await fs.mkdir(dataDir, { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(temporaryPath, configPath);
  return next;
}

function toPublicConfig(config) {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
    hasApiKey: Boolean(config.apiKey),
    requiresAdminPassword: Boolean(process.env.ADMIN_PASSWORD),
  };
}

module.exports = {
  configPath,
  getConfig,
  saveConfig,
  toPublicConfig,
};

// AI 配置文件
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_AI_API_URL = 'https://api.linapi.net/v1/chat/completions';

function normalizeOpenAIBaseURL(apiURL) {
  const input = String(apiURL || '').trim();
  if (!input) return 'https://api.linapi.net/v1';

  return input
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/+$/, '');
}

const apiURL = process.env.AI_API_URL || DEFAULT_AI_API_URL;
const configuredApiKey = String(process.env.AI_API_KEY || '').trim();

const AI_CONFIG = {
  apiKey: configuredApiKey || 'not-configured',
  configured: Boolean(configuredApiKey),
  apiURL,
  baseURL: normalizeOpenAIBaseURL(apiURL),
  model: process.env.AI_MODEL || 'gemini-3.1-pro-preview',
  maxTokens: parseInt(process.env.AI_MAX_TOKENS || '8000', 10),
  temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7')
};

module.exports = { AI_CONFIG };

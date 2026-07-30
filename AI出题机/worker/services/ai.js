// AI service for Cloudflare Workers - uses OpenAI-compatible API
import structuredOutput from '../../shared/ai-structured-output.js';

const { buildStructuredOutputRequest, extractStructuredToolArguments } = structuredOutput;

function normalizeBaseURL(apiURL) {
  const input = String(apiURL || '').trim();
  if (!input) return 'https://api.linapi.net/v1';
  return input
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/+$/, '');
}

function getAIConfig(env) {
  const apiURL = env.AI_API_URL || 'https://api.linapi.net/v1/chat/completions';
  const keyStr = String(env.AI_API_KEYS || '');
  const keys = keyStr.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
  const fallback = String(env.AI_API_KEY || '').trim();
  if (fallback) keys.unshift(fallback);
  const uniqueKeys = [...new Set(keys)];

  return {
    apiKey: uniqueKeys[0] || '',
    apiKeys: uniqueKeys,
    baseURL: normalizeBaseURL(apiURL),
    model: env.AI_MODEL || 'gemini-3-flash-preview',
    maxTokens: parseInt(env.AI_MAX_TOKENS || '8000', 10),
    temperature: parseFloat(env.AI_TEMPERATURE || '0.7')
  };
}

function buildUserContent(userPrompt, imageUrls = []) {
  const text = String(userPrompt || '').trim();
  if (!imageUrls.length) return text;

  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const url of imageUrls) {
    if (!url || typeof url !== 'string') continue;
    content.push({ type: 'image_url', image_url: { url } });
  }
  return content.length ? content : text;
}

async function callOpenAICompat(config, apiKey, messages, options = {}) {
  const url = `${config.baseURL}/chat/completions`;
  const body = {
    model: options.model || config.model,
    temperature: options.temperature ?? config.temperature,
    max_tokens: options.maxTokens || config.maxTokens,
    messages
  };
  if (options.structuredOutput) {
    Object.assign(body, buildStructuredOutputRequest(options.structuredOutput));
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    const err = new Error(`API error ${resp.status}: ${errorText.substring(0, 200)}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const choice = data?.choices?.[0];
  const message = choice?.message;
  if (options.structuredOutput) {
    return extractStructuredToolArguments(message, options.structuredOutput);
  }
  const content = message?.content;
  if (!content) throw new Error('API返回空内容');

  let text = '';
  if (typeof content === 'string') text = content.trim();
  if (Array.isArray(content)) {
    text = content
      .map(p => (typeof p === 'string' ? p : p?.text || ''))
      .join('')
      .trim();
  }
  if (!text) throw new Error('API返回空内容');
  if (options.includeMetadata) {
    return {
      content: text,
      finishReason: choice?.finish_reason || null,
      responseId: data?.id || null,
      usage: data?.usage || null
    };
  }
  return text;
}

function isRetriable(error) {
  const status = error?.status;
  if (!status) return true;
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

export async function generateContent(env, systemPrompt, userPrompt, options = {}) {
  const config = getAIConfig(env);
  if (!config.apiKeys.length) {
    throw new Error('缺少 AI_API_KEY 配置');
  }

  const messages = [
    { role: 'system', content: String(systemPrompt || '') },
    { role: 'user', content: buildUserContent(userPrompt, options.imageUrls) }
  ];

  let lastError = null;
  const tried = new Set();

  // Try each key, rotating on retriable errors
  for (const apiKey of config.apiKeys) {
    if (tried.has(apiKey)) continue;
    tried.add(apiKey);

    try {
      return await callOpenAICompat(config, apiKey, messages, options);
    } catch (error) {
      lastError = error;
      if (!isRetriable(error)) throw error;
      console.warn(`[AI] Key ${apiKey.slice(0, 6)}... failed: ${error.message}`);
    }
  }

  throw lastError || new Error('AI API 不可用');
}

export { getAIConfig };

const express = require('express');
const { persistAIConfig, getAIConfigView, AI_CONFIG } = require('../config/ai');
const { configurePool, withClient } = require('../services/ai-key-pool');

const router = express.Router();

function isLocalRequest(req) {
  const address = String(req.socket?.remoteAddress || req.ip || '').toLowerCase();
  return address === '::1'
    || address === '127.0.0.1'
    || address === '::ffff:127.0.0.1';
}

function requireLocalDevelopment(req, res, next) {
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProduction || !isLocalRequest(req)) {
    return res.status(403).json({ error: 'AI 配置仅允许在本机开发环境中修改' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return next();
}

router.use(requireLocalDevelopment);

router.get('/', (req, res) => {
  res.json(getAIConfigView());
});

router.put('/', (req, res) => {
  try {
    const payload = {
      apiURL: req.body?.apiURL,
      model: req.body?.model,
      maxTokens: req.body?.maxTokens,
      temperature: req.body?.temperature
    };
    const apiKeys = String(req.body?.apiKeys || '').trim();
    if (apiKeys) payload.apiKeys = apiKeys;
    if (!apiKeys && !AI_CONFIG.apiKeys.length) {
      return res.status(400).json({ error: '首次配置时必须填写至少一个 API Key' });
    }

    persistAIConfig(payload);
    configurePool();
    return res.json({
      message: 'AI 配置已保存并立即生效',
      config: getAIConfigView()
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'AI 配置保存失败' });
  }
});

router.post('/test', async (req, res) => {
  if (!AI_CONFIG.apiKeys.length) {
    return res.status(400).json({ error: '请先保存 API Key' });
  }

  const startedAt = Date.now();
  try {
    const completion = await withClient((client) => client.chat.completions.create({
      model: AI_CONFIG.model,
      temperature: 0,
      max_tokens: 16,
      messages: [{ role: 'user', content: '仅回复：连接成功' }]
    }));
    const content = completion?.choices?.[0]?.message?.content;
    return res.json({
      message: '连接成功',
      latencyMs: Date.now() - startedAt,
      responsePreview: typeof content === 'string' ? content.trim().slice(0, 60) : ''
    });
  } catch (error) {
    const reason = error?.error?.message || error?.message || '未知错误';
    return res.status(502).json({ error: `连接失败：${reason}` });
  }
});

module.exports = router;

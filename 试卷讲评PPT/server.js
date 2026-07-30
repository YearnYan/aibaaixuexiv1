const path = require('path');
const express = require('express');
const OpenAI = require('openai');
const dotenv = require('dotenv');

dotenv.config();

const DEFAULT_BASE_URL = 'https://api.linapi.net/v1';
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0.2;
const CONFIG_LIMITS = Object.freeze({
    baseURLLength: 2048,
    apiKeyLength: 4096,
    modelLength: 200,
    timeoutMs: [5000, 600000],
    maxTokens: [256, 65536],
    temperature: [0, 2]
});

const app = express();
const port = Number(process.env.PORT || 5270);
const host = process.env.HOST || '127.0.0.1';
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '80mb';
const maxChatRequestBodyBytes = Number(process.env.MAX_CHAT_REQUEST_BYTES || 8 * 1024 * 1024);
const environmentConfig = Object.freeze(createEnvironmentConfig());
let runtimeConfig = Object.freeze({ ...environmentConfig });
let clientState = {
    apiKey: null,
    baseURL: null,
    client: null
};

if (!environmentConfig.apiKey) {
    console.warn('[警告] 未设置 OPENAI_API_KEY，请访问 /ai-config/ 完成当前运行实例配置。');
}

app.use(express.json({ limit: requestBodyLimit }));
app.use(express.static(path.resolve(__dirname, 'public')));

app.use((error, _req, res, next) => {
    if (error?.type === 'entity.too.large') {
        return res.status(413).json({
            error: {
                message: `请求体超过服务限制（${requestBodyLimit}）。系统已支持更大文件，但建议继续使用前端自动压缩与分批处理。`
            }
        });
    }

    if (error) {
        console.error('[请求解析错误]', error.message || error);
        return res.status(400).json({
            error: {
                message: error.message || '请求体解析失败。'
            }
        });
    }

    next();
});

app.use('/api/config', requireLoopbackRequest, (_req, res, next) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    next();
});

app.get('/api/config', (_req, res) => {
    return res.json(getPublicRuntimeConfig());
});

app.put('/api/config', (req, res) => {
    try {
        const nextConfig = validateRuntimeConfigUpdate(req.body);
        runtimeConfig = Object.freeze(nextConfig);
        invalidateOpenAIClient();
        return res.json(getPublicRuntimeConfig());
    } catch (error) {
        return sendAPIError(res, error, '运行配置保存失败。');
    }
});

app.post('/api/config/reset', (_req, res) => {
    runtimeConfig = Object.freeze({ ...environmentConfig });
    invalidateOpenAIClient();
    return res.json(getPublicRuntimeConfig());
});

app.post('/api/config/test', async (_req, res) => {
    const config = { ...runtimeConfig };
    const startedAt = Date.now();

    try {
        assertApiKeyConfigured(config);
        const completion = await withTimeout(
            getOpenAIClient(config).chat.completions.create({
                model: config.model,
                messages: [{ role: 'user', content: '连接检查：请只回复“连接正常”。' }],
                temperature: 0,
                max_tokens: Math.min(32, config.maxTokens)
            }),
            config.timeoutMs,
            `AI 上游请求超时（${Math.round(config.timeoutMs / 1000)} 秒）。`
        );
        const reply = String(completion?.choices?.[0]?.message?.content || '').trim();

        return res.json({
            ok: true,
            model: config.model,
            latencyMs: Date.now() - startedAt,
            reply: reply || '上游已响应'
        });
    } catch (error) {
        return sendAPIError(res, error, '连接测试失败。', config);
    }
});

app.post(['/api/chat', '/api/site/exam-ppt'], handleChatRequest);

async function handleChatRequest(req, res) {
    const config = { ...runtimeConfig };

    try {
        assertApiKeyConfigured(config);

        const body = req.body || {};
        const requestBytes = estimateJsonBytes(body);
        if (requestBytes > maxChatRequestBodyBytes) {
            const error = new Error(
                `请求体过大（${formatBytes(requestBytes)}），超过服务安全阈值 ${formatBytes(
                    maxChatRequestBodyBytes
                )}。请减少单次页面数量，系统会自动分批。`
            );
            error.status = 413;
            throw error;
        }

        const messages = body.messages;
        if (!Array.isArray(messages) || messages.length === 0) {
            const error = new Error('messages 必须是非空数组。');
            error.status = 400;
            throw error;
        }
        if (messages.length > 128) {
            const error = new Error('单次请求最多允许 128 条消息。');
            error.status = 400;
            throw error;
        }

        const requestedMaxTokens =
            body.max_tokens === undefined
                ? config.maxTokens
                : validateInteger(body.max_tokens, 'max_tokens', 1, CONFIG_LIMITS.maxTokens[1]);
        const temperature =
            body.temperature === undefined
                ? config.temperature
                : validateNumber(
                      body.temperature,
                      'temperature',
                      CONFIG_LIMITS.temperature[0],
                      CONFIG_LIMITS.temperature[1]
                  );

        const completion = await withTimeout(
            getOpenAIClient(config).chat.completions.create({
                model: config.model,
                messages,
                temperature,
                max_tokens: Math.min(requestedMaxTokens, config.maxTokens)
            }),
            config.timeoutMs,
            `AI 上游请求超时（${Math.round(config.timeoutMs / 1000)} 秒）。`
        );

        return res.json(completion);
    } catch (error) {
        return sendAPIError(res, error, '调用 AI 接口失败，请稍后重试。', config, req.path);
    }
}

function createEnvironmentConfig() {
    let baseURL = DEFAULT_BASE_URL;
    let model = DEFAULT_MODEL;

    try {
        baseURL = validateBaseURL(process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL);
    } catch (error) {
        console.warn(`[警告] OPENAI_BASE_URL 无效，已回退默认网关：${error.message}`);
    }

    try {
        model = validateModel(process.env.OPENAI_MODEL || DEFAULT_MODEL);
    } catch (error) {
        console.warn(`[警告] OPENAI_MODEL 无效，已回退默认模型：${error.message}`);
    }

    return {
        baseURL,
        apiKey: normalizeApiKey(process.env.OPENAI_API_KEY || ''),
        model,
        timeoutMs: readBoundedEnvironmentInteger(
            process.env.AI_REQUEST_TIMEOUT_MS,
            DEFAULT_TIMEOUT_MS,
            ...CONFIG_LIMITS.timeoutMs
        ),
        maxTokens: readBoundedEnvironmentInteger(
            process.env.AI_MAX_TOKENS,
            DEFAULT_MAX_TOKENS,
            ...CONFIG_LIMITS.maxTokens
        ),
        temperature: readBoundedEnvironmentNumber(
            process.env.AI_TEMPERATURE,
            DEFAULT_TEMPERATURE,
            ...CONFIG_LIMITS.temperature
        )
    };
}

function readBoundedEnvironmentInteger(rawValue, fallback, min, max) {
    const value = Number(rawValue);
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function readBoundedEnvironmentNumber(rawValue, fallback, min, max) {
    const value = Number(rawValue);
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function validateRuntimeConfigUpdate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw createValidationError('配置请求体必须是 JSON 对象。');
    }

    const allowedFields = new Set([
        'baseURL',
        'apiKey',
        'model',
        'timeoutMs',
        'maxTokens',
        'temperature',
        'clearApiKey'
    ]);
    const fields = Object.keys(body);
    const unknownFields = fields.filter((field) => !allowedFields.has(field));

    if (fields.length === 0) {
        throw createValidationError('至少提供一个要更新的配置字段。');
    }
    if (unknownFields.length > 0) {
        throw createValidationError(`存在不支持的配置字段：${unknownFields.join('、')}。`);
    }

    const nextConfig = { ...runtimeConfig };

    if (Object.prototype.hasOwnProperty.call(body, 'baseURL')) {
        nextConfig.baseURL = validateBaseURL(body.baseURL);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'model')) {
        nextConfig.model = validateModel(body.model);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'timeoutMs')) {
        nextConfig.timeoutMs = validateInteger(
            body.timeoutMs,
            '请求超时',
            ...CONFIG_LIMITS.timeoutMs
        );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'maxTokens')) {
        nextConfig.maxTokens = validateInteger(
            body.maxTokens,
            '最大输出 Token',
            ...CONFIG_LIMITS.maxTokens
        );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'temperature')) {
        nextConfig.temperature = validateNumber(
            body.temperature,
            'Temperature',
            ...CONFIG_LIMITS.temperature
        );
    }

    const clearApiKey = body.clearApiKey === true;
    if (Object.prototype.hasOwnProperty.call(body, 'clearApiKey') && typeof body.clearApiKey !== 'boolean') {
        throw createValidationError('clearApiKey 必须是布尔值。');
    }

    if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
        if (typeof body.apiKey !== 'string') {
            throw createValidationError('API Key 必须是字符串。');
        }
        const apiKey = normalizeApiKey(body.apiKey);
        if (apiKey.length > CONFIG_LIMITS.apiKeyLength) {
            throw createValidationError(`API Key 不能超过 ${CONFIG_LIMITS.apiKeyLength} 个字符。`);
        }
        if (clearApiKey && apiKey) {
            throw createValidationError('不能同时设置并清除 API Key。');
        }
        if (apiKey) {
            nextConfig.apiKey = apiKey;
        }
    }

    if (clearApiKey) {
        nextConfig.apiKey = '';
    }

    return nextConfig;
}

function validateBaseURL(rawValue) {
    if (typeof rawValue !== 'string') {
        throw createValidationError('API 网关地址必须是字符串。');
    }

    const value = rawValue.trim().replace(/\/chat\/completions\/?$/i, '').replace(/\/+$/, '');
    if (!value) {
        throw createValidationError('API 网关地址不能为空。');
    }
    if (value.length > CONFIG_LIMITS.baseURLLength) {
        throw createValidationError(`API 网关地址不能超过 ${CONFIG_LIMITS.baseURLLength} 个字符。`);
    }

    let parsedURL;
    try {
        parsedURL = new URL(value);
    } catch (_error) {
        throw createValidationError('API 网关地址格式无效。');
    }

    if (!['http:', 'https:'].includes(parsedURL.protocol)) {
        throw createValidationError('API 网关地址只支持 HTTP 或 HTTPS。');
    }
    if (parsedURL.username || parsedURL.password) {
        throw createValidationError('API 网关地址不能包含用户名或密码。');
    }
    if (parsedURL.search || parsedURL.hash) {
        throw createValidationError('API 网关地址不能包含查询参数或片段。');
    }

    return value;
}

function validateModel(rawValue) {
    if (typeof rawValue !== 'string') {
        throw createValidationError('模型名称必须是字符串。');
    }

    const value = rawValue.trim();
    if (!value || value.length > CONFIG_LIMITS.modelLength) {
        throw createValidationError(`模型名称长度必须为 1–${CONFIG_LIMITS.modelLength} 个字符。`);
    }
    if (/[\u0000-\u001F\u007F]/.test(value)) {
        throw createValidationError('模型名称不能包含控制字符。');
    }

    return value;
}

function validateInteger(rawValue, label, min, max) {
    if (!Number.isInteger(rawValue) || rawValue < min || rawValue > max) {
        throw createValidationError(`${label}必须是 ${min}–${max} 之间的整数。`);
    }
    return rawValue;
}

function validateNumber(rawValue, label, min, max) {
    if (!Number.isFinite(rawValue) || rawValue < min || rawValue > max) {
        throw createValidationError(`${label}必须是 ${min}–${max} 之间的数字。`);
    }
    return rawValue;
}

function normalizeApiKey(rawValue) {
    return String(rawValue || '').trim();
}

function createValidationError(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}

function assertApiKeyConfigured(config) {
    if (config.apiKey) {
        return;
    }
    const error = new Error('当前运行实例尚未配置 API Key，请先打开 /ai-config/ 完成配置。');
    error.status = 503;
    throw error;
}

function getPublicRuntimeConfig() {
    return {
        scope: 'memory',
        localOnly: true,
        baseURL: runtimeConfig.baseURL,
        model: runtimeConfig.model,
        timeoutMs: runtimeConfig.timeoutMs,
        maxTokens: runtimeConfig.maxTokens,
        temperature: runtimeConfig.temperature,
        hasApiKey: Boolean(runtimeConfig.apiKey),
        apiKeySource: !runtimeConfig.apiKey
            ? 'missing'
            : runtimeConfig.apiKey === environmentConfig.apiKey
              ? 'environment'
              : 'runtime'
    };
}

function requireLoopbackRequest(req, res, next) {
    const remoteAddress = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    const isLoopback = remoteAddress === '::1' || /^127(?:\.\d{1,3}){3}$/.test(remoteAddress);

    if (!isLoopback) {
        return res.status(403).json({
            error: {
                message: 'AI 运行配置仅允许从本机访问。'
            }
        });
    }

    const origin = req.get('origin');
    if (origin && !isTrustedLocalOrigin(origin, req.get('host'))) {
        return res.status(403).json({
            error: {
                message: 'AI 运行配置拒绝跨站请求。'
            }
        });
    }

    next();
}

function isTrustedLocalOrigin(origin, requestHost) {
    try {
        const parsedOrigin = new URL(origin);
        const hostname = parsedOrigin.hostname.replace(/^\[|\]$/g, '');
        const isLocalHostname = hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
        return isLocalHostname && parsedOrigin.host === String(requestHost || '');
    } catch (_error) {
        return false;
    }
}

function getOpenAIClient(config) {
    if (
        !clientState.client ||
        clientState.apiKey !== config.apiKey ||
        clientState.baseURL !== config.baseURL
    ) {
        clientState = {
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            client: new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
        };
    }
    return clientState.client;
}

function invalidateOpenAIClient() {
    clientState = { apiKey: null, baseURL: null, client: null };
}

function sanitizeErrorMessage(rawMessage, config = runtimeConfig) {
    let message = String(rawMessage || '');
    const secrets = [config?.apiKey, runtimeConfig?.apiKey, environmentConfig?.apiKey].filter(Boolean);
    secrets.forEach((secret) => {
        message = message.split(secret).join('[已隐藏密钥]');
    });
    return message;
}

function sendAPIError(res, error, fallbackMessage, config = runtimeConfig, requestPath = '') {
    const status = normalizeErrorStatus(error);
    const rawMessage = error?.error?.message || error?.message || fallbackMessage;
    const message = sanitizeErrorMessage(rawMessage, config);
    const pathLabel = requestPath ? ` ${requestPath}` : '';
    console.error(`[API错误]${pathLabel}`, message);

    return res.status(status).json({
        error: {
            message
        }
    });
}

function normalizeErrorStatus(error) {
    const status = Number(error?.status || error?.code || 0);
    if (status >= 400 && status < 600) {
        return status;
    }
    if (error?.name === 'AbortError') {
        return 504;
    }
    return 500;
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return promise;
    }

    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const timeoutError = new Error(timeoutMessage || '请求超时。');
            timeoutError.name = 'AbortError';
            reject(timeoutError);
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

function estimateJsonBytes(data) {
    try {
        return Buffer.byteLength(JSON.stringify(data ?? {}), 'utf8');
    } catch (_error) {
        return 0;
    }
}

function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

app.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    console.log(`服务已启动：http://${displayHost}:${port}`);
    console.log(`AI 配置页：http://${displayHost}:${port}/ai-config/`);
    console.log(`AI 模型：${runtimeConfig.model}`);
    console.log(`AI 网关：${runtimeConfig.baseURL}`);
    console.log(`API Key：${runtimeConfig.apiKey ? '已配置' : '未配置'}`);
    console.log(`请求体限制：${requestBodyLimit}`);
    console.log(`单次AI请求安全阈值：${maxChatRequestBodyBytes} bytes`);
    console.log(`AI 超时：${runtimeConfig.timeoutMs}ms`);
});

function normalizeBaseURL(rawUrl = '') {
  const fallback = 'https://api.linapi.net/v1';
  const value = String(rawUrl || '').trim() || fallback;
  return value.replace(/\/chat\/completions\/?$/i, '');
}

const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MAX_CHAT_REQUEST_BYTES = 8 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      ['/api/chat', '/api/site/exam-ppt'].includes(url.pathname) &&
      request.method === 'POST'
    ) {
      return handleChatRequest(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return json(
        {
          error: {
            message: '接口不存在。',
          },
        },
        404
      );
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleChatRequest(request, env) {
  try {
    const apiKey = env.OPENAI_API_KEY || '';
    if (!apiKey) {
      return json(
        {
          error: {
            message: '服务端未配置 OPENAI_API_KEY，请先在 Cloudflare Secret 中设置。',
          },
        },
        500
      );
    }

    const model = env.OPENAI_MODEL || 'gemini-3-flash-preview';
    const baseURL = normalizeBaseURL(env.OPENAI_BASE_URL);
    const timeoutMs = Number(env.AI_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    const maxRequestBytes = Number(
      env.MAX_CHAT_REQUEST_BYTES || DEFAULT_MAX_CHAT_REQUEST_BYTES
    );

    const headerSize = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(headerSize) && headerSize > maxRequestBytes) {
      return json(
        {
          error: {
            message: `请求体过大（${formatBytes(
              headerSize
            )}），超过服务阈值 ${formatBytes(maxRequestBytes)}。`,
          },
        },
        413
      );
    }

    const body = await request.json().catch(() => ({}));
    const requestBytes = estimateJsonBytes(body);
    if (requestBytes > maxRequestBytes) {
      return json(
        {
          error: {
            message: `请求体过大（${formatBytes(
              requestBytes
            )}），超过服务阈值 ${formatBytes(maxRequestBytes)}。`,
          },
        },
        413
      );
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const temperature =
      typeof body.temperature === 'number' ? body.temperature : 0.2;
    const maxTokens =
      typeof body.max_tokens === 'number' ? body.max_tokens : 8192;

    if (messages.length === 0) {
      return json(
        {
          error: {
            message: 'messages 不能为空。',
          },
        },
        400
      );
    }

    const upstreamResponse = await fetchWithTimeout(
      `${baseURL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      },
      timeoutMs
    );

    const text = await upstreamResponse.text();
    return new Response(text, {
      status: upstreamResponse.status,
      headers: {
        'Content-Type':
          upstreamResponse.headers.get('content-type') ||
          'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const status = normalizeErrorStatus(error);
    const message = error?.message || '调用 AI 接口失败，请稍后重试。';

    return json(
      {
        error: {
          message,
        },
      },
      status
    );
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetch(url, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(
        `AI上游请求超时（${Math.round(timeoutMs / 1000)} 秒）。`
      );
      timeoutError.name = 'AbortError';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeErrorStatus(error) {
  const status = Number(error?.status || 0);
  if (status >= 400 && status < 600) {
    return status;
  }
  if (error?.name === 'AbortError') {
    return 504;
  }
  return 500;
}

function estimateJsonBytes(data) {
  try {
    const text = JSON.stringify(data ?? {});
    return new TextEncoder().encode(text).length;
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

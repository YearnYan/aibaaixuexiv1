// 前端安全请求封装：用于请求令牌与自动重试
(function initSecurityClient(global) {
  const API_PATH = '/api';

  function resolveApiBase() {
    const explicitBase = String(global.__AI_EXAM_API_BASE__ || '').trim().replace(/\/$/, '');
    if (explicitBase) return explicitBase;

    const { protocol, hostname, port } = global.location;
    if (protocol === 'file:') return 'http://127.0.0.1:5100/api';

    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocal && port !== '5100') {
      return `${protocol}//${hostname}:5100/api`;
    }
    return API_PATH;
  }

  const API_BASE = resolveApiBase();
  const BOOTSTRAP_URL = `${API_BASE}/security/bootstrap`;

  const state = {
    requestToken: '',
    expiresAt: 0,
    bootstrapPromise: null,
    trialCreditsRemaining: null
  };

  function createRequestId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function hasValidToken() {
    if (!state.requestToken) return false;
    return Date.now() < (state.expiresAt - 5000);
  }

  function resolveApiUrl(url) {
    if (typeof url !== 'string') return url;
    if (API_BASE !== API_PATH && url.startsWith(API_PATH)) {
      return `${API_BASE}${url.slice(API_PATH.length)}`;
    }
    return url;
  }

  function createNetworkError(error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('连接出题服务超时，请检查本地服务后重试');
      timeoutError.code = 'API_TIMEOUT';
      timeoutError.cause = error;
      return timeoutError;
    }
    const networkError = new Error('无法连接本地出题服务，请确认服务已启动');
    networkError.code = 'API_NETWORK_UNAVAILABLE';
    networkError.cause = error;
    return networkError;
  }

  async function request(url, options) {
    try {
      return await global.fetch(resolveApiUrl(url), {
        ...options,
        credentials: 'include'
      });
    } catch (error) {
      throw createNetworkError(error);
    }
  }

  async function ensureRequestToken(forceRefresh = false) {
    if (!forceRefresh && hasValidToken()) {
      return state.requestToken;
    }

    if (state.bootstrapPromise) {
      return state.bootstrapPromise;
    }

    state.bootstrapPromise = (async () => {
      const resp = await request(BOOTSTRAP_URL, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'X-CX-Request-Id': createRequestId()
        }
      });

      if (!resp.ok) {
        throw new Error('安全令牌初始化失败');
      }

      const data = await resp.json();
      state.requestToken = data.requestToken || '';
      state.expiresAt = Number(data.expiresAt) || 0;
      if (typeof data.trialCreditsRemaining !== 'undefined') {
        state.trialCreditsRemaining = Number.parseInt(data.trialCreditsRemaining, 10);
      }
      global.__trialCreditsRemaining = state.trialCreditsRemaining;
      return state.requestToken;
    })();

    try {
      return await state.bootstrapPromise;
    } finally {
      state.bootstrapPromise = null;
    }
  }

  async function apiFetch(url, options = {}, retry = true) {
    const resolvedUrl = resolveApiUrl(url);
    const isProtectedApi = typeof resolvedUrl === 'string'
      && resolvedUrl.startsWith(API_BASE)
      && !resolvedUrl.startsWith(BOOTSTRAP_URL);

    const headers = {
      ...(options.headers || {}),
      'X-CX-Request-Id': createRequestId()
    };

    if (isProtectedApi) {
      const token = await ensureRequestToken();
      if (token) {
        headers['X-CX-Request-Token'] = token;
      }
    }

    let resp = await request(resolvedUrl, {
      ...options,
      headers
    });

    if (
      retry
      && isProtectedApi
      && resp.status === 403
      && resp.headers.get('x-cx-token-invalid') === '1'
    ) {
      await ensureRequestToken(true);
      const retryHeaders = {
        ...(options.headers || {}),
        'X-CX-Request-Id': createRequestId()
      };
      if (state.requestToken) {
        retryHeaders['X-CX-Request-Token'] = state.requestToken;
      }
      resp = await request(resolvedUrl, {
        ...options,
        headers: retryHeaders
      });
    }

    return resp;
  }

  global.apiFetch = apiFetch;
  global.ensureRequestToken = ensureRequestToken;
  global.__EXAM_API_BASE__ = API_BASE;
})(window);

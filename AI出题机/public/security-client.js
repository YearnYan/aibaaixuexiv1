// 前端安全请求封装：用于请求令牌与自动重试
(function initSecurityClient(global) {
  function resolveApiBase() {
    const pathname = String(global.location.pathname || '/');
    const routeEnd = pathname.indexOf('/', 1);
    const routePrefix = routeEnd > 0 ? pathname.slice(0, routeEnd) : pathname;
    if (routePrefix && routePrefix !== '/' && !/\.[^/]+$/u.test(routePrefix)) {
      return `${routePrefix}/api`;
    }
    return '/api';
  }

  const API_BASE = resolveApiBase();
  const BOOTSTRAP_URL = `${API_BASE}/security/bootstrap`;

  function resolveApiUrl(url) {
    if (typeof url !== 'string' || API_BASE === '/api' || !url.startsWith('/api')) {
      return url;
    }
    return `${API_BASE}${url.slice('/api'.length)}`;
  }

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

  async function ensureRequestToken(forceRefresh = false) {
    if (!forceRefresh && hasValidToken()) {
      return state.requestToken;
    }

    if (state.bootstrapPromise) {
      return state.bootstrapPromise;
    }

    state.bootstrapPromise = (async () => {
      const resp = await global.fetch(BOOTSTRAP_URL, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
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
    const isProtectedApi = typeof url === 'string'
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

    let resp = await global.fetch(resolvedUrl, {
      ...options,
      credentials: 'same-origin',
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
      resp = await global.fetch(resolvedUrl, {
        ...options,
        credentials: 'same-origin',
        headers: retryHeaders
      });
    }

    return resp;
  }

  global.apiFetch = apiFetch;
  global.ensureRequestToken = ensureRequestToken;
})(window);

// 试卷变式机的同源安全请求封装，统一使用平台的请求令牌契约。
(function initSecurityClient(global) {
  const API_BASE = '/api/site/exam-variant';
  const state = {
    requestToken: '',
    expiresAt: 0,
    bootstrapPromise: null
  };

  function createRequestId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function hasValidToken() {
    return Boolean(state.requestToken) && Date.now() < state.expiresAt - 5000;
  }

  async function ensureRequestToken(forceRefresh = false) {
    if (!forceRefresh && hasValidToken()) return state.requestToken;
    if (state.bootstrapPromise) return state.bootstrapPromise;

    state.bootstrapPromise = (async () => {
      const response = await global.fetch(`${API_BASE}/security/bootstrap`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
        headers: { 'X-CX-Request-Id': createRequestId() }
      });
      if (!response.ok) throw new Error('安全令牌初始化失败');
      const data = await response.json();
      state.requestToken = String(data.requestToken || '');
      state.expiresAt = Number(data.expiresAt) || 0;
      global.__trialCreditsRemaining = data.trialCreditsRemaining;
      return state.requestToken;
    })();

    try {
      return await state.bootstrapPromise;
    } finally {
      state.bootstrapPromise = null;
    }
  }

  async function apiFetch(url, options = {}, retry = true) {
    const headers = new Headers(options.headers || {});
    headers.set('X-CX-Request-Id', createRequestId());
    const protectedRequest = typeof url === 'string'
      && url.startsWith(API_BASE)
      && !url.endsWith('/security/bootstrap');

    if (protectedRequest) {
      const token = await ensureRequestToken();
      if (token) headers.set('X-CX-Request-Token', token);
    }

    const response = await global.fetch(url, {
      ...options,
      credentials: options.credentials || 'same-origin',
      headers
    });

    if (
      retry
      && protectedRequest
      && response.status === 403
      && response.headers.get('x-cx-token-invalid') === '1'
    ) {
      await ensureRequestToken(true);
      return apiFetch(url, options, false);
    }
    return response;
  }

  global.apiFetch = apiFetch;
  global.ensureRequestToken = ensureRequestToken;
  global.__EXAM_VARIANT_API_BASE__ = API_BASE;
})(window);

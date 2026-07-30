// 主站兼容请求封装：保留旧入口名，实际走 shared/hzq.js 的统一安全与计费逻辑。
(function initSecurityClient(global) {
  function createRequestId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function ensureRequestToken() {
    if (global.HZQ && typeof global.HZQ.getUsageToken === 'function') {
      return global.HZQ.getUsageToken();
    }
    return '';
  }

  async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('X-HZQ-Request-Id', createRequestId());

    if (
      global.HZQ
      && typeof global.HZQ.getUsageToken === 'function'
      && !headers.has('X-HZQ-Usage-Token')
    ) {
      const usageToken = global.HZQ.getUsageToken();
      if (usageToken) {
        headers.set('X-HZQ-Usage-Token', usageToken);
      }
    }

    return global.fetch(url, {
      ...options,
      credentials: options.credentials || 'same-origin',
      headers
    });
  }

  global.apiFetch = apiFetch;
  global.ensureRequestToken = ensureRequestToken;
})(window);

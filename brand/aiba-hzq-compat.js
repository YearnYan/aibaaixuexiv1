(function installAibaLegacyCompatibility(global) {
  'use strict';

  if (!global || global.HZQ) return;

  function resolveHomeUrl() {
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(global.location.hostname);
    if (localHost) {
      const host = global.location.hostname === '::1' ? '[::1]' : global.location.hostname;
      return new URL(`${global.location.protocol}//${host}:4173/`);
    }

    return new URL(`${global.location.protocol}//${global.location.hostname}/`);
  }

  function openRedeemPage() {
    const target = resolveHomeUrl();
    target.searchParams.set('redeem', '1');
    global.location.assign(target.href);
  }

  const compatibilityApi = {
    init() {},
    async checkCredit() {
      try {
        const home = resolveHomeUrl();
        const response = await fetch(new URL('/api/auth/me', home), {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.authenticated || !payload.user) {
          const loginUrl = new URL(home.href);
          loginUrl.searchParams.set('login', '1');
          global.location.assign(loginUrl.href);
          return false;
        }
        if (Number(payload.user.points) < 1) {
          const redeemUrl = new URL(home.href);
          redeemUrl.searchParams.set('redeem', '1');
          global.location.assign(redeemUrl.href);
          return false;
        }
        return true;
      } catch (_error) {
        return false;
      }
    },
    getUsageToken() {
      return '';
    },
    normalizeReadableText(value) {
      return value;
    },
    normalizeRenderedResults() {},
    _showRedeemModal: openRedeemPage,
  };

  Object.defineProperty(global, 'HZQ', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze(compatibilityApi),
  });
})(window);

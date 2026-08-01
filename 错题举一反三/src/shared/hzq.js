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
      // 子站实际额度由各自后端校验；兼容层只保持旧页面调用链可用。
      return true;
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

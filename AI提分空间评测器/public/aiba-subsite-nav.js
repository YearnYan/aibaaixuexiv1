(function installAibaSubsiteNav(global) {
  if (!global || !global.document) return;

  const document = global.document;
  const navStyleVersion = '20260801-nav5';
  const scriptElement = document.currentScript || document.querySelector('script[data-aiba-subsite-nav]');
  const scriptUrl = scriptElement && scriptElement.src
    ? new URL(scriptElement.src, global.location.href)
    : new URL('./aiba-subsite-nav.js', global.location.href);

  function resolveHomeUrl() {
    const configured = document.documentElement.dataset.aibaHomeUrl;
    if (configured) {
      try {
        return new URL(configured, global.location.href);
      } catch (_error) {
        // 配置地址无效时继续使用本地开发环境的自动推断结果。
      }
    }

    const localHost = ['localhost', '127.0.0.1', '::1'].includes(global.location.hostname);
    if (localHost && !['4173', '80', '443', ''].includes(global.location.port)) {
      const host = global.location.hostname === '::1' ? '[::1]' : global.location.hostname;
      return new URL(`${global.location.protocol}//${host}:4173/`);
    }

    return new URL(`${global.location.protocol}//${global.location.hostname}/`);
  }

  function addQuery(url, key) {
    const next = new URL(url.href);
    next.searchParams.set(key, '1');
    return next.href;
  }

  function installStylesheet() {
    if (document.querySelector('link[data-aiba-subsite-nav-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    const stylesheetUrl = new URL('./aiba-subsite-nav.css', scriptUrl);
    stylesheetUrl.searchParams.set('v', navStyleVersion);
    link.href = stylesheetUrl.href;
    link.dataset.aibaSubsiteNavStyle = 'true';
    document.head.appendChild(link);
  }

  function install() {
    if (!document.body) return;

    installStylesheet();
    if (document.querySelector('nav.aiba-subsite-nav')) return;

    const homeUrl = resolveHomeUrl();
    const nav = document.createElement('nav');
    nav.className = 'site-nav aiba-subsite-nav';
    nav.dataset.aibaSubsiteNav = 'true';
    nav.setAttribute('aria-label', '主导航');
    nav.innerHTML = `
      <a class="brand" href="${homeUrl.href}" aria-label="艾爸AI学习首页">
        <img src="${new URL('./aiba-logo.jpg', scriptUrl).href}" alt="艾爸AI学习" />
        <span><strong>艾爸AI学习</strong><small>K12 智能学习工具</small></span>
      </a>
      <div class="nav-actions">
        <a class="nav-button nav-button-light" href="${addQuery(homeUrl, 'login')}">注册 / 登录</a>
        <a class="nav-button nav-button-solid" href="${addQuery(homeUrl, 'redeem')}">积分兑换</a>
      </div>`;

    document.body.prepend(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(window);

(function installAibaSubsiteNav(global) {
  if (!global || !global.document) return;

  const document = global.document;
  const navStyleVersion = '20260805-nav9';
  const accountStateKey = 'aiba-account-state-v1';
  const accountChangedEvent = 'aiba:account-changed';
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
    if (localHost) {
      const host = global.location.hostname === '::1' ? '[::1]' : global.location.hostname;
      const port = ['80', '443', ''].includes(global.location.port) ? '' : global.location.port;
      const targetPort = port && port !== '4173' ? '4173' : port;
      return new URL(`${global.location.protocol}//${host}${targetPort ? `:${targetPort}` : ''}/`);
    }

    return new URL(`${global.location.protocol}//${global.location.hostname}/`);
  }

  function addQuery(url, key) {
    const next = new URL(url.href);
    next.searchParams.set(key, '1');
    return next.href;
  }

  function renderAccountButton(target, user) {
    if (!target) return;
    if (!user) {
      target.textContent = '注册 / 登录';
      target.dataset.state = 'signed-out';
      return;
    }
    const points = Number.isFinite(Number(user.points)) ? Number(user.points) : 0;
    target.textContent = `${user.username} · ${points} 积分`;
    target.dataset.state = 'signed-in';
  }

  function readStoredProfile() {
    try {
      const raw = global.localStorage.getItem(accountStateKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed.user || null : null;
    } catch (_error) {
      return null;
    }
  }

  function readProfileCookie() {
    const cookie = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('aiba_profile='));
    if (!cookie) return null;
    try {
      return JSON.parse(decodeURIComponent(cookie.slice('aiba_profile='.length)));
    } catch (_error) {
      return null;
    }
  }

  async function refreshAccountStatus(homeUrl, target) {
    const profile = readProfileCookie() || readStoredProfile();
    renderAccountButton(target, profile);

    const accountPath = ['', 'api', 'auth', 'me'].join('/');
    // 账号接口始终走主页入口，兼容独立子站端口、反向代理和同域路径部署。
    const accountUrl = new URL(accountPath, homeUrl);
    try {
      const response = await fetch(accountUrl, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`账号状态请求失败：${response.status}`);
      const data = await response.json().catch(() => ({}));
      const user = data.authenticated ? data.user : null;
      renderAccountButton(target, user);
      publishAccountState(user);
    } catch (_error) {
      // 网络短暂异常时保留已知状态，避免把“正在登录”的用户误显示为未登录。
      renderAccountButton(target, profile);
    }
  }

  function publishAccountState(user) {
    try {
      global.localStorage.setItem(accountStateKey, JSON.stringify({
        user: user || null,
        updatedAt: Date.now(),
      }));
    } catch (_error) {
      // 隐私模式可能禁用 localStorage，Cookie 和 API 仍可正常工作。
    }
  }

  function subscribeAccountState(homeUrl, target) {
    const refresh = () => refreshAccountStatus(homeUrl, target);
    global.addEventListener(accountChangedEvent, refresh);
    global.addEventListener('storage', (event) => {
      if (event.key === accountStateKey) refresh();
    });
    global.addEventListener('pageshow', refresh);
    global.addEventListener('focus', refresh);
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
        <a class="nav-button nav-button-light nav-account-button" href="${addQuery(homeUrl, 'login')}" data-aiba-account-action>注册 / 登录</a>
        <a class="nav-button nav-button-solid" href="${addQuery(homeUrl, 'redeem')}">积分兑换</a>
        <a class="nav-button nav-button-light nav-button-purchase" href="https://catfk.com/shop/RJUNDGF1" target="_blank" rel="noopener">积分购买</a>
      </div>`;

    document.body.prepend(nav);
    const accountTarget = nav.querySelector('[data-aiba-account-action]');
    subscribeAccountState(homeUrl, accountTarget);
    refreshAccountStatus(homeUrl, accountTarget);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(window);

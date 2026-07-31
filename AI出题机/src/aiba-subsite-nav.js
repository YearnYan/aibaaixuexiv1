(function installAibaSubsiteNav(global) {
  if (!global || !global.document || global.document.querySelector('.aiba-subsite-nav')) return;

  function resolveHomeUrl() {
    const configured = global.document.documentElement.dataset.aibaHomeUrl;
    if (configured) return new URL(configured, global.location.href);
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(global.location.hostname);
    if (localHost && !['4173', '80', '443', ''].includes(global.location.port)) {
      return new URL(`${global.location.protocol}//${global.location.hostname}:4173/`);
    }
    return new URL('/', global.location.href);
  }

  function addQuery(url, key) {
    const next = new URL(url.href);
    next.searchParams.set(key, '1');
    return next.href;
  }

  const homeUrl = resolveHomeUrl();
  const nav = global.document.createElement('nav');
  nav.className = 'site-nav aiba-subsite-nav';
  nav.dataset.aibaSubsiteNav = 'true';
  nav.setAttribute('aria-label', '主导航');
  nav.innerHTML = `
    <a class="brand" href="${homeUrl.href}" aria-label="艾爸AI学习首页">
      <img src="${new URL('assets/logo.jpg', homeUrl).href}" alt="艾爸AI学习" />
      <span><strong>艾爸AI学习</strong><small>K12 智能学习工具</small></span>
    </a>
    <div class="nav-actions">
      <a class="nav-button nav-button-light" href="${addQuery(homeUrl, 'login')}">注册 / 登录</a>
      <a class="nav-button nav-button-solid" href="${addQuery(homeUrl, 'redeem')}">积分兑换</a>
    </div>`;

  const style = global.document.createElement('style');
  style.dataset.aibaSubsiteNavStyle = 'true';
  style.textContent = `
    .aiba-subsite-nav.site-nav { position: relative; z-index: 30; display: flex; align-items: center; justify-content: space-between; width: min(1380px, calc(100% - 64px)); min-height: 88px; margin: 0 auto; border-bottom: 1px solid rgba(83, 52, 32, .18); color: #2b211d; background: transparent; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
    .aiba-subsite-nav .brand { display: inline-flex; align-items: center; gap: 12px; min-width: 0; color: #2b211d; text-decoration: none; }
    .aiba-subsite-nav .brand img { width: 52px; height: 52px; border: 2px solid rgba(255,255,255,.9); border-radius: 8px; object-fit: cover; box-shadow: 0 8px 24px rgba(70,42,26,.18); }
    .aiba-subsite-nav .brand span { display: grid; gap: 2px; }
    .aiba-subsite-nav .brand strong { color: #2b211d; font-size: 18px; font-weight: 900; line-height: 1.2; }
    .aiba-subsite-nav .brand small { color: #5f4c40; font-size: 11px; font-weight: 700; line-height: 1.2; }
    .aiba-subsite-nav .nav-actions { display: flex; align-items: center; gap: 10px; }
    .aiba-subsite-nav .nav-button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border: 1px solid transparent; border-radius: 8px; color: #2b211d; font-size: 14px; font-weight: 800; line-height: 1; text-decoration: none; transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease; }
    .aiba-subsite-nav .nav-button:hover { transform: translateY(-2px); }
    .aiba-subsite-nav .nav-button-light { border-color: rgba(91,57,34,.28); background: rgba(255,255,255,.82); }
    .aiba-subsite-nav .nav-button-solid { color: #fff; background: #742113; box-shadow: 0 12px 26px rgba(116,33,19,.22); }
    .aiba-subsite-nav .nav-button-solid:hover { color: #fff; background: #5f190e; }
    @media (max-width: 720px) {
      .aiba-subsite-nav.site-nav { width: calc(100% - 32px); min-height: 74px; }
      .aiba-subsite-nav .brand img { width: 44px; height: 44px; }
      .aiba-subsite-nav .brand small { display: none; }
      .aiba-subsite-nav .brand strong { font-size: 15px; }
      .aiba-subsite-nav .nav-actions { gap: 6px; }
      .aiba-subsite-nav .nav-button { min-height: 38px; padding: 0 10px; font-size: 12px; }
    }
  `;
  global.document.head.appendChild(style);
  global.document.body.prepend(nav);
})(window);

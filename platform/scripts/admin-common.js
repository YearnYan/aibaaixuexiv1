export function createAdminSession({ onAuthorized, onUnauthorized }) {
  const elements = {
    authPanel: document.querySelector('#adminAuthPanel'),
    workspace: document.querySelector('#adminWorkspace'),
    username: document.querySelector('#adminUsername'),
    password: document.querySelector('#adminPassword'),
    login: document.querySelector('#adminLoginButton'),
    register: document.querySelector('#adminRegisterButton'),
    logout: document.querySelector('#adminLogoutButton'),
    badge: document.querySelector('#adminUserBadge'),
    status: document.querySelector('#adminStatus'),
  };

  const state = { user: null, setupRequired: false };

  elements.login.addEventListener('click', () => submit('login'));
  elements.register.addEventListener('click', () => submit('register'));
  elements.logout.addEventListener('click', logout);
  elements.password.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit('login');
  });

  refresh();

  async function refresh() {
    setAdminStatus('正在检查管理员身份');
    try {
      const data = await requestJson('/api/auth/me');
      state.setupRequired = Boolean(data.setupRequired);
      elements.register.textContent = state.setupRequired ? '注册首个管理员' : '注册账号';
      applyUser(data.authenticated ? data.user : null);
    } catch (error) {
      applyUser(null);
      setAdminStatus(error.message || '管理员身份检查失败', 'error');
    }
  }

  async function submit(mode) {
    const username = elements.username.value.trim();
    const password = elements.password.value;
    if (!username || !password) {
      setAdminStatus('请填写账号和密码', 'error');
      return;
    }

    const button = mode === 'register' ? elements.register : elements.login;
    button.disabled = true;
    setAdminStatus(mode === 'register' ? '正在创建管理员账号' : '正在登录');
    try {
      const data = await requestJson(`/api/auth/${mode}`, {
        method: 'POST',
        body: { username, password },
      });
      elements.password.value = '';
      applyUser(data.user);
      showAdminToast(mode === 'register' ? '账号注册成功' : '管理员登录成功');
    } catch (error) {
      setAdminStatus(error.message || '登录失败', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    elements.logout.disabled = true;
    try {
      await requestJson('/api/auth/logout', { method: 'POST' });
    } catch {
      // 本地退出优先，接口异常不锁住后台登录入口。
    }
    elements.logout.disabled = false;
    applyUser(null);
    setAdminStatus('已退出，请使用管理员账号登录');
  }

  function applyUser(user) {
    state.user = user;
    const isAdmin = user?.role === 'admin';
    elements.authPanel.hidden = isAdmin;
    elements.workspace.hidden = !isAdmin;
    elements.logout.hidden = !user;
    elements.badge.textContent = user
      ? `${user.username} · ${user.role === 'admin' ? '管理员' : '普通用户'}`
      : '未登录';

    if (isAdmin) {
      setAdminStatus('管理员身份已验证', 'success');
      onAuthorized?.(user);
      return;
    }

    if (user) {
      setAdminStatus('当前账号不是管理员，无法访问此页面', 'error');
    } else {
      setAdminStatus(state.setupRequired ? '请注册首个管理员账号' : '请使用管理员账号登录');
    }
    onUnauthorized?.(user);
  }

  return { state, refresh };
}

export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `请求失败（${response.status}）`);
  }
  return data;
}

export function setAdminStatus(message, type = '') {
  const status = document.querySelector('#adminStatus');
  status.textContent = message;
  status.classList.toggle('is-error', type === 'error');
  status.classList.toggle('is-success', type === 'success');
}

let toastTimer = null;
export function showAdminToast(message) {
  const toast = document.querySelector('#adminToast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function renderTable(target, headers, rows) {
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="empty-cell" colspan="${headers.length}">暂无数据</td></tr>`;
  target.innerHTML = `<table class="admin-table"><thead><tr>${headers.map((item) => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

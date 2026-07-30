const state = {
  user: null,
  setupRequired: false,
  authMode: 'login',
};

const authButton = document.querySelector('#authButton');
const heroAccountButton = document.querySelector('#heroAccountButton');
const redeemButton = document.querySelector('#redeemButton');
const authModal = document.querySelector('#authModal');
const redeemModal = document.querySelector('#redeemModal');
const authFormArea = document.querySelector('#authFormArea');
const authForm = document.querySelector('#authForm');
const authTitle = document.querySelector('#authTitle');
const usernameInput = document.querySelector('#usernameInput');
const passwordInput = document.querySelector('#passwordInput');
const authSubmitButton = document.querySelector('#authSubmitButton');
const accountSummary = document.querySelector('#accountSummary');
const logoutButton = document.querySelector('#logoutButton');
const authMessage = document.querySelector('#authMessage');
const redeemForm = document.querySelector('#redeemForm');
const redeemCodeInput = document.querySelector('#redeemCodeInput');
const redeemSubmitButton = document.querySelector('#redeemSubmitButton');
const redeemMessage = document.querySelector('#redeemMessage');
const toast = document.querySelector('#toast');

authButton.addEventListener('click', openAccountModal);
heroAccountButton.addEventListener('click', openAccountModal);
redeemButton.addEventListener('click', openRedeemModal);
authForm.addEventListener('submit', submitAuth);
redeemForm.addEventListener('submit', redeemPoints);
logoutButton.addEventListener('click', logout);

document.querySelectorAll('[data-auth-mode]').forEach((button) => {
  button.addEventListener('click', () => setAuthMode(button.dataset.authMode));
});

document.querySelectorAll('[data-close-modal]').forEach((button) => {
  button.addEventListener('click', () => closeModal(authModal));
});

document.querySelectorAll('[data-close-redeem]').forEach((button) => {
  button.addEventListener('click', () => closeModal(redeemModal));
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeModal(authModal);
  closeModal(redeemModal);
});

refreshSession();

async function refreshSession() {
  try {
    const data = await requestJson('/api/auth/me');
    state.user = data.authenticated ? data.user : null;
    state.setupRequired = Boolean(data.setupRequired);
    if (state.setupRequired) setAuthMode('register');
    renderAccount();
  } catch {
    state.user = null;
    renderAccount();
  }
}

function renderAccount() {
  if (state.user) {
    const label = `${state.user.username} · ${state.user.points} 积分`;
    authButton.textContent = label;
    heroAccountButton.textContent = '查看我的账号';
    accountSummary.hidden = false;
    accountSummary.innerHTML = `<strong>${escapeHtml(state.user.username)}</strong><span>${escapeHtml(formatRole(state.user.role))} · 当前 ${state.user.points} 积分</span>`;
    authFormArea.hidden = true;
    logoutButton.hidden = false;
    authTitle.textContent = '你的学习账号';
    return;
  }

  authButton.textContent = '注册 / 登录';
  heroAccountButton.textContent = state.setupRequired ? '创建首个账号' : '登录后开始';
  accountSummary.hidden = true;
  authFormArea.hidden = false;
  logoutButton.hidden = true;
  authTitle.textContent = state.authMode === 'register' ? '创建学习账号' : '继续你的学习旅程';
}

function openAccountModal() {
  clearMessage(authMessage);
  renderAccount();
  openModal(authModal);
  window.setTimeout(() => (state.user ? logoutButton : usernameInput).focus(), 30);
}

function openRedeemModal() {
  if (!state.user) {
    showToast('请先登录，再兑换积分');
    openAccountModal();
    return;
  }
  clearMessage(redeemMessage);
  redeemCodeInput.value = '';
  openModal(redeemModal);
  window.setTimeout(() => redeemCodeInput.focus(), 30);
}

function openModal(modal) {
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeModal(modal) {
  if (!modal.classList.contains('is-open')) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal.is-open')) document.body.classList.remove('modal-open');
}

function setAuthMode(mode) {
  state.authMode = mode === 'register' ? 'register' : 'login';
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    const active = button.dataset.authMode === state.authMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  authSubmitButton.textContent = state.authMode === 'register' ? '注册并登录' : '登录';
  passwordInput.autocomplete = state.authMode === 'register' ? 'new-password' : 'current-password';
  clearMessage(authMessage);
  renderAccount();
}

async function submitAuth(event) {
  event.preventDefault();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  authSubmitButton.disabled = true;
  setMessage(authMessage, state.authMode === 'register' ? '正在创建账号…' : '正在登录…');

  try {
    const data = await requestJson(`/api/auth/${state.authMode}`, {
      method: 'POST',
      body: { username, password },
    });
    state.user = data.user;
    state.setupRequired = false;
    passwordInput.value = '';
    renderAccount();
    setMessage(authMessage, state.authMode === 'register' ? '账号创建成功' : '登录成功');
    showToast(`${state.user.username}，欢迎回来`);
  } catch (error) {
    setMessage(authMessage, error.message || '账号操作失败', true);
  } finally {
    authSubmitButton.disabled = false;
  }
}

async function logout() {
  logoutButton.disabled = true;
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } catch {
    // 本地状态仍然退出，避免接口短暂异常锁住用户。
  }
  state.user = null;
  logoutButton.disabled = false;
  renderAccount();
  closeModal(authModal);
  showToast('已退出当前账号');
}

async function redeemPoints(event) {
  event.preventDefault();
  const code = redeemCodeInput.value.trim();
  if (!code) return;
  redeemSubmitButton.disabled = true;
  setMessage(redeemMessage, '正在兑换…');

  try {
    const data = await requestJson('/api/points/redeem', {
      method: 'POST',
      body: { code },
    });
    state.user = data.user;
    renderAccount();
    setMessage(redeemMessage, `兑换成功，已增加 ${data.redeemedPoints} 积分`);
    showToast(`兑换成功，当前余额 ${data.points} 积分`);
  } catch (error) {
    setMessage(redeemMessage, error.message || '兑换失败', true);
  } finally {
    redeemSubmitButton.disabled = false;
  }
}

async function requestJson(url, options = {}) {
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

function setMessage(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle('is-error', isError);
}

function clearMessage(target) {
  setMessage(target, '');
}

function formatRole(role) {
  return role === 'admin' ? '管理员' : '学习用户';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

let toastTimer = null;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

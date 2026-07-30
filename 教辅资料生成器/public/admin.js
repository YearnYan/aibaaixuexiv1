const state = {
  config: {
    rule: { entries: [] },
    image: { resolution: '4k', entries: [] },
  },
  currentUser: null,
  isSaving: false,
  pointsOverview: null,
};

const adminStatus = document.querySelector('#adminStatus');
const adminAuthPanel = document.querySelector('#adminAuthPanel');
const adminUsernameInput = document.querySelector('#adminUsernameInput');
const adminPasswordInput = document.querySelector('#adminPasswordInput');
const adminLoginButton = document.querySelector('#adminLoginButton');
const adminRegisterButton = document.querySelector('#adminRegisterButton');
const adminLogoutButton = document.querySelector('#adminLogoutButton');
const adminUserBadge = document.querySelector('#adminUserBadge');
const saveButton = document.querySelector('#saveConfigButton');
const protectedSections = [...document.querySelectorAll('.admin-protected')];
const ruleProviderList = document.querySelector('#ruleProviderList');
const imageProviderList = document.querySelector('#imageProviderList');
const ruleConfigHint = document.querySelector('#ruleConfigHint');
const imageConfigHint = document.querySelector('#imageConfigHint');
const imageResolutionInput = document.querySelector('#imageResolution');
const refreshPointsButton = document.querySelector('#refreshPointsButton');
const pointsSummary = document.querySelector('#pointsSummary');
const codePointsInput = document.querySelector('#codePointsInput');
const codeCountInput = document.querySelector('#codeCountInput');
const createCodesButton = document.querySelector('#createCodesButton');
const createdCodesOutput = document.querySelector('#createdCodesOutput');
const adjustUsernameInput = document.querySelector('#adjustUsernameInput');
const adjustModeInput = document.querySelector('#adjustModeInput');
const adjustPointsInput = document.querySelector('#adjustPointsInput');
const adjustNoteInput = document.querySelector('#adjustNoteInput');
const adjustPointsButton = document.querySelector('#adjustPointsButton');
const usersTable = document.querySelector('#usersTable');
const batchesTable = document.querySelector('#batchesTable');
const pointLogsTable = document.querySelector('#pointLogsTable');
const redeemCodesTable = document.querySelector('#redeemCodesTable');
const toast = document.querySelector('#toast');

document.querySelectorAll('[data-add-entry]').forEach((button) => {
  button.addEventListener('click', () => {
    const channel = button.dataset.addEntry;
    state.config[channel].entries.push(createBlankEntry());
    renderConfig();
  });
});

adminLoginButton.addEventListener('click', () => submitAdminAuth('login'));
adminRegisterButton.addEventListener('click', () => submitAdminAuth('register'));
adminLogoutButton.addEventListener('click', logoutAdmin);
saveButton.addEventListener('click', saveConfig);
refreshPointsButton.addEventListener('click', loadPointsOverview);
createCodesButton.addEventListener('click', createRedeemCodes);
adjustPointsButton.addEventListener('click', adjustUserPoints);

[adminUsernameInput, adminPasswordInput].forEach((input) => {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submitAdminAuth('login');
  });
});

imageResolutionInput.addEventListener('change', () => {
  state.config.image.resolution = imageResolutionInput.value;
});

setAuthorizedUi(false);
refreshAdminSession();

async function refreshAdminSession() {
  setStatus('正在检查管理员身份');
  try {
    const data = await requestJson('/api/auth/me');
    state.currentUser = data.authenticated ? data.user : null;
    adminRegisterButton.textContent = data.setupRequired ? '注册首个管理员' : '注册账号';
    const isAdmin = state.currentUser?.role === 'admin';
    setAuthorizedUi(isAdmin);
    if (!isAdmin) {
      setStatus(data.setupRequired ? '请注册首个管理员账号' : '请使用管理员账号登录');
      return;
    }

    await Promise.all([loadConfig(), loadPointsOverview()]);
  } catch (error) {
    setAuthorizedUi(false);
    setStatus('管理员身份检查失败');
    showToast(error instanceof Error ? error.message : '管理员身份检查失败');
  }
}

function setAuthorizedUi(isAdmin) {
  adminAuthPanel.hidden = isAdmin;
  protectedSections.forEach((section) => {
    section.hidden = !isAdmin;
  });
  saveButton.disabled = !isAdmin;
  adminLogoutButton.hidden = !state.currentUser;
  adminUserBadge.textContent = state.currentUser
    ? `${state.currentUser.username}｜${state.currentUser.role === 'admin' ? '管理员' : '普通用户'}`
    : '未登录';
}

async function submitAdminAuth(mode) {
  const username = adminUsernameInput.value.trim();
  const password = adminPasswordInput.value;
  if (!username || !password) {
    showToast('请填写账号和密码');
    return;
  }

  const button = mode === 'register' ? adminRegisterButton : adminLoginButton;
  button.disabled = true;
  try {
    const data = await requestJson(`/api/auth/${mode}`, {
      method: 'POST',
      body: { username, password },
    });
    state.currentUser = data.user;
    adminPasswordInput.value = '';
    const isAdmin = state.currentUser?.role === 'admin';
    setAuthorizedUi(isAdmin);
    if (!isAdmin) {
      setStatus('当前账号不是管理员，无法查看后台');
      showToast('只有管理员可以查看后台');
      return;
    }
    showToast(mode === 'register' ? '管理员注册成功' : '管理员登录成功');
    await Promise.all([loadConfig(), loadPointsOverview()]);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '登录失败');
  } finally {
    button.disabled = false;
  }
}

async function logoutAdmin() {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } catch {
    // 本地退出优先，服务端失败不阻塞界面状态。
  }
  state.currentUser = null;
  setAuthorizedUi(false);
  setStatus('已退出，请使用管理员账号登录');
}

async function loadConfig() {
  setStatus('正在读取 AI 配置');

  try {
    const data = await requestJson('/api/admin/ai-config');
    state.config = normalizeConfigForClient(data.config);
    renderConfig();
    setStatus('AI 配置已读取');
  } catch (error) {
    handleAdminRequestError(error, 'AI 配置读取失败');
  }
}

async function saveConfig() {
  if (state.isSaving) return;
  state.isSaving = true;
  saveButton.disabled = true;
  setStatus('正在保存 AI 配置');

  try {
    const payload = collectConfig();
    const data = await requestJson('/api/admin/ai-config', {
      method: 'PUT',
      body: payload,
    });
    state.config = normalizeConfigForClient(data.config);
    renderConfig();
    setStatus('AI 配置已保存');
    showToast('AI 配置已保存，前端会立即使用新接口');
  } catch (error) {
    handleAdminRequestError(error, 'AI 配置保存失败');
  } finally {
    state.isSaving = false;
    saveButton.disabled = state.currentUser?.role !== 'admin';
  }
}

async function loadPointsOverview() {
  try {
    const data = await requestJson('/api/admin/points/overview');
    state.pointsOverview = data;
    renderPointsOverview();
  } catch (error) {
    handleAdminRequestError(error, '积分数据读取失败');
  }
}

async function createRedeemCodes() {
  const points = Number(codePointsInput.value);
  const count = Number(codeCountInput.value);
  createCodesButton.disabled = true;
  try {
    const data = await requestJson('/api/admin/points/redeem-codes', {
      method: 'POST',
      body: { points, count },
    });
    createdCodesOutput.innerHTML = data.codes
      .map((item) => `<div>${escapeHtml(item.code)}｜${item.points} 积分</div>`)
      .join('');
    showToast(`已生成 ${data.codes.length} 张卡密`);
    await loadPointsOverview();
  } catch (error) {
    handleAdminRequestError(error, '卡密生成失败');
  } finally {
    createCodesButton.disabled = false;
  }
}

async function adjustUserPoints() {
  const username = adjustUsernameInput.value.trim();
  const mode = adjustModeInput.value;
  const points = Number(adjustPointsInput.value);
  const note = adjustNoteInput.value.trim();
  if (!username) {
    showToast('请填写用户账号');
    return;
  }

  adjustPointsButton.disabled = true;
  try {
    const data = await requestJson('/api/admin/points/adjust', {
      method: 'POST',
      body: { username, mode, points, note },
    });
    showToast(`${data.user.username} 当前积分：${data.user.points}`);
    await loadPointsOverview();
  } catch (error) {
    handleAdminRequestError(error, '积分调整失败');
  } finally {
    adjustPointsButton.disabled = false;
  }
}

function renderPointsOverview() {
  const data = state.pointsOverview;
  if (!data) return;

  pointsSummary.innerHTML = [
    ['用户数', data.summary.userCount],
    ['用户总积分', data.summary.totalPoints],
    ['成功出图', data.summary.successfulImages],
    ['已退积分', data.summary.refundedPoints],
  ]
    .map(([label, value]) => `
      <article class="admin-metric">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `)
    .join('');

  renderTable(usersTable, ['账号', '角色', '积分', '创建时间', '更新时间'], data.users.map((user) => [
    user.username,
    user.role === 'admin' ? '管理员' : '用户',
    user.points,
    formatTime(user.createdAt),
    formatTime(user.updatedAt),
  ]));

  renderTable(batchesTable, ['账号', '状态', '预扣', '成功', '退款'], data.batches.map((batch) => [
    batch.username,
    batch.status,
    batch.reservedPoints,
    batch.successCount,
    batch.refundedPoints,
  ]));

  renderTable(pointLogsTable, ['账号', '类型', '积分变化', '余额', '备注'], data.logs.map((log) => [
    log.username,
    formatPointType(log.type),
    log.points > 0 ? `+${log.points}` : log.points,
    log.balanceAfter,
    log.note || '-',
  ]));

  renderTable(redeemCodesTable, ['卡密', '积分', '状态', '使用账号', '创建时间'], data.redeemCodes.map((code) => [
    code.code,
    code.points,
    formatCodeStatus(code.status),
    code.usedByUsername || '-',
    formatTime(code.createdAt),
  ]));
}

function renderTable(target, headers, rows) {
  target.innerHTML = [
    `<div class="admin-row header">${headers.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`,
    ...rows.map((row) => `
      <div class="admin-row">
        ${row.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
    `),
  ].join('');
}

function normalizeConfigForClient(config) {
  const normalized = {
    rule: {
      entries: normalizeEntries(config?.rule?.entries),
    },
    image: {
      resolution: config?.image?.resolution === 'standard' ? 'standard' : '4k',
      entries: normalizeEntries(config?.image?.entries),
    },
  };

  if (normalized.rule.entries.length === 0) normalized.rule.entries.push(createBlankEntry());
  if (normalized.image.entries.length === 0) normalized.image.entries.push(createBlankEntry());
  return normalized;
}

function normalizeEntries(entries) {
  return Array.isArray(entries)
    ? entries.map((entry) => ({
        baseUrl: String(entry?.baseUrl || ''),
        model: String(entry?.model || ''),
        apiKeys: Array.isArray(entry?.apiKeys) ? entry.apiKeys.map(String) : [],
      }))
    : [];
}

function collectConfig() {
  return {
    rule: {
      entries: collectEntries(state.config.rule.entries),
    },
    image: {
      resolution: imageResolutionInput.value,
      entries: collectEntries(state.config.image.entries),
    },
  };
}

function collectEntries(entries) {
  return entries.map((entry) => ({
    baseUrl: entry.baseUrl.trim(),
    model: entry.model.trim(),
    apiKeys: entry.apiKeys.map((key) => key.trim()).filter(Boolean),
  }));
}

function renderConfig() {
  imageResolutionInput.value = state.config.image.resolution;
  renderConfigHint(ruleConfigHint, state.config.rule.entries);
  renderConfigHint(imageConfigHint, state.config.image.entries);
  renderProviderList(ruleProviderList, 'rule');
  renderProviderList(imageProviderList, 'image');
}

function renderConfigHint(target, entries) {
  const configuredCount = entries.filter((entry) =>
    entry.baseUrl.trim() && entry.model.trim() && entry.apiKeys.some((key) => key.trim()),
  ).length;
  target.textContent = configuredCount > 0
    ? `配置来源：后台配置，已填写 ${configuredCount} 个接口`
    : '配置来源：后台配置；未填写时该功能不可用';
}

function renderProviderList(target, channel) {
  target.innerHTML = '';
  state.config[channel].entries.forEach((entry, index) => {
    target.appendChild(createProviderCard(channel, entry, index));
  });
}

function createProviderCard(channel, entry, index) {
  const card = document.createElement('article');
  card.className = 'provider-card';

  const head = document.createElement('header');
  head.className = 'provider-head';
  const title = document.createElement('strong');
  title.textContent = `接口 ${index + 1}`;
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'ghost-button compact';
  removeButton.textContent = '移除';
  removeButton.addEventListener('click', () => {
    state.config[channel].entries.splice(index, 1);
    if (state.config[channel].entries.length === 0) {
      state.config[channel].entries.push(createBlankEntry());
    }
    renderConfig();
  });
  head.append(title, removeButton);

  const grid = document.createElement('div');
  grid.className = 'provider-grid';
  grid.append(
    createTextField('URL', entry.baseUrl, 'https://api.example.com/v1', (value) => {
      entry.baseUrl = value;
    }),
    createTextField('MODEL', entry.model, channel === 'image' ? 'gpt-image-2' : 'gpt-4.1-mini', (value) => {
      entry.model = value;
    }),
  );

  const keyField = document.createElement('label');
  keyField.className = 'field provider-keys';
  const keyLabel = document.createElement('span');
  keyLabel.textContent = 'APIKEY';
  const textarea = document.createElement('textarea');
  textarea.rows = 4;
  textarea.spellcheck = false;
  textarea.placeholder = '每行一个 KEY';
  textarea.value = entry.apiKeys.join('\n');
  textarea.addEventListener('input', () => {
    entry.apiKeys = textarea.value.split(/\r?\n/u);
  });
  keyField.append(keyLabel, textarea);

  card.append(head, grid, keyField);
  return card;
}

function createTextField(labelText, value, placeholder, onInput) {
  const label = document.createElement('label');
  label.className = 'field';
  const span = document.createElement('span');
  span.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => onInput(input.value));
  label.append(span, input);
  return label;
}

function createBlankEntry() {
  return {
    baseUrl: '',
    model: '',
    apiKeys: [],
  };
}

function handleAdminRequestError(error, fallbackMessage) {
  if (error?.status === 401 || error?.status === 403) {
    state.currentUser = null;
    setAuthorizedUi(false);
    setStatus('请使用管理员账号登录');
  } else {
    setStatus(fallbackMessage);
  }
  showToast(error instanceof Error ? error.message : fallbackMessage);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || '请求失败');
    error.status = response.status;
    throw error;
  }
  return data;
}

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatPointType(type) {
  const labels = {
    generation_reserve: '生成预扣',
    generation_refund: '失败退款',
    redeem: '卡密兑换',
    admin_adjust: '管理员调整',
  };
  return labels[type] || type;
}

function formatCodeStatus(status) {
  if (status === 'used') return '已使用';
  if (status === 'void') return '已作废';
  return '未使用';
}

function setStatus(message) {
  adminStatus.textContent = message;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove('show');
  }, 2800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

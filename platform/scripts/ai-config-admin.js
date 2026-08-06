import {
  createAdminSession,
  requestJson,
  setAdminStatus,
  showAdminToast,
} from './admin-common.js';

const SITE_DEFINITIONS = [
  'AI丢分诊断器', 'AI提分空间评测器', 'AI错因判断器', 'AI得分点拆解器',
  'AI审题器', '卷后提分试卷分析', '错题归因追分器', '知识查缺补漏器',
  'AI解题步骤器', 'AI题型提分卡', '提分行动计划器', '考前抢分清单器',
  '题感训练提分器', '错题举一反三', '学习资料生成器', 'AI出题机',
  '试卷变式机', 'AI备课器', '教辅资料生成器', '试卷讲评PPT', '题卷重排WORD',
];
const SITE_MODES = new Set(['global', 'custom', 'disabled']);

const state = {
  config: createEmptyConfig(),
  saving: false,
};

const saveButton = document.querySelector('#saveConfigButton');
const reloadButton = document.querySelector('#reloadConfigButton');
const imageResolution = document.querySelector('#imageResolution');
const providerLists = {
  global: document.querySelector('#globalProviderList'),
  rule: document.querySelector('#ruleProviderList'),
  image: document.querySelector('#imageProviderList'),
};
const siteConfigList = document.querySelector('#siteConfigList');

saveButton.addEventListener('click', saveConfig);
reloadButton.addEventListener('click', loadConfig);
imageResolution.addEventListener('change', () => {
  state.config.image.resolution = imageResolution.value;
});

document.querySelectorAll('[data-add-entry]').forEach((button) => {
  button.addEventListener('click', () => {
    const channel = button.dataset.addEntry;
    state.config[channel].entries.push(createBlankEntry());
    renderConfig();
  });
});

createAdminSession({
  onAuthorized: () => {
    saveButton.disabled = false;
    loadConfig();
  },
  onUnauthorized: () => {
    saveButton.disabled = true;
    clearConfigLists();
  },
});

async function loadConfig() {
  reloadButton.disabled = true;
  setAdminStatus('正在读取 AI 配置');
  try {
    const data = await requestJson('/api/admin/ai-config');
    state.config = normalizeConfig(data.config);
    renderConfig();
    setAdminStatus('AI 配置已读取', 'success');
  } catch (error) {
    setAdminStatus(error.message || 'AI 配置读取失败', 'error');
  } finally {
    reloadButton.disabled = false;
  }
}

async function saveConfig() {
  if (state.saving) return;
  state.saving = true;
  saveButton.disabled = true;
  setAdminStatus('正在保存 AI 配置');
  try {
    const data = await requestJson('/api/admin/ai-config', {
      method: 'PUT',
      body: collectConfig(),
    });
    state.config = normalizeConfig(data.config);
    renderConfig();
    setAdminStatus('AI 配置已保存并立即生效', 'success');
    showAdminToast('AI 配置已保存');
  } catch (error) {
    setAdminStatus(error.message || 'AI 配置保存失败', 'error');
  } finally {
    state.saving = false;
    saveButton.disabled = false;
  }
}

function renderConfig() {
  imageResolution.value = state.config.image.resolution;
  renderChannel('global');
  renderChannel('rule');
  renderChannel('image');
  renderSites();
}

function renderChannel(channel) {
  const target = providerLists[channel];
  target.innerHTML = '';
  state.config[channel].entries.forEach((entry, index) => {
    target.appendChild(createProviderCard(entry, index, {
      onRemove: () => {
        state.config[channel].entries.splice(index, 1);
        if (state.config[channel].entries.length === 0) {
          state.config[channel].entries.push(createBlankEntry());
        }
        renderConfig();
      },
    }));
  });
}

function renderSites() {
  siteConfigList.innerHTML = '';
  state.config.sites.forEach((site) => {
    const card = document.createElement('article');
    card.className = 'site-config-card';

    const head = document.createElement('div');
    head.className = 'site-config-head';
    const title = document.createElement('strong');
    title.textContent = site.id;

    const modeField = document.createElement('label');
    modeField.className = 'compact-select';
    const modeTitle = document.createElement('span');
    modeTitle.textContent = 'AI 来源';
    const mode = document.createElement('select');
    mode.innerHTML = '<option value="global">跟随全局 AI</option><option value="custom">独立配置</option><option value="disabled">停用 AI</option>';
    mode.value = site.mode;
    mode.addEventListener('change', () => {
      site.mode = SITE_MODES.has(mode.value) ? mode.value : 'global';
      if (site.mode !== 'custom') site.entries = [];
      renderSites();
    });
    modeField.append(modeTitle, mode);
    head.append(title, modeField);
    card.append(head);

    const costField = document.createElement('label');
    costField.className = 'admin-field site-cost-field';
    const costTitle = document.createElement('span');
    costTitle.textContent = '每次使用扣除积分';
    const costInput = document.createElement('input');
    costInput.type = 'number';
    costInput.min = '1';
    costInput.max = '100000';
    costInput.step = '1';
    costInput.value = String(site.pointsPerUse || 1);
    costInput.addEventListener('input', () => {
      const value = Math.floor(Number(costInput.value));
      site.pointsPerUse = Number.isFinite(value) && value >= 1 ? Math.min(100000, value) : 1;
    });
    costField.append(costTitle, costInput);
    card.append(costField);

    const description = document.createElement('p');
    description.className = 'site-config-description';
    description.textContent = site.mode === 'global'
      ? '当前使用全局 AI 配置。'
      : site.mode === 'custom'
        ? '当前使用该子站自己的接口池。'
        : '该子站不会注入平台 AI 配置。';
    card.append(description);

    if (site.mode === 'custom') {
      const list = document.createElement('div');
      list.className = 'provider-list site-provider-list';
      site.entries.forEach((entry, index) => {
        list.appendChild(createProviderCard(entry, index, {
          onRemove: () => {
            site.entries.splice(index, 1);
            renderSites();
          },
        }));
      });
      const addButton = document.createElement('button');
      addButton.className = 'admin-button admin-button-light site-add-button';
      addButton.type = 'button';
      addButton.textContent = site.entries.length ? '新增独立 URL' : '填写独立 AI';
      addButton.addEventListener('click', () => {
        site.entries.push(createBlankEntry());
        renderSites();
      });
      card.append(list, addButton);
    }

    siteConfigList.appendChild(card);
  });
}

function createProviderCard(entry, index, { onRemove } = {}) {
  const card = document.createElement('article');
  card.className = 'provider-card';

  const indexLabel = document.createElement('span');
  indexLabel.className = 'provider-index';
  indexLabel.textContent = String(index + 1).padStart(2, '0');

  const body = document.createElement('div');
  body.className = 'provider-body';
  const head = document.createElement('div');
  head.className = 'provider-head';
  const title = document.createElement('strong');
  title.textContent = `接口 ${index + 1}`;
  const removeButton = document.createElement('button');
  removeButton.className = 'mini-button';
  removeButton.type = 'button';
  removeButton.textContent = '移除';
  removeButton.addEventListener('click', onRemove);
  head.append(title, removeButton);

  const fields = document.createElement('div');
  fields.className = 'provider-fields';
  fields.append(
    createTextField('URL', entry.baseUrl, 'https://api.example.com/v1', (value) => { entry.baseUrl = value; }),
    createTextField('MODEL', entry.model, '模型名称', (value) => { entry.model = value; }),
    createSecretField(entry.apiKeys, (keys) => { entry.apiKeys = keys; }),
  );
  body.append(head, fields);
  card.append(indexLabel, body);
  return card;
}

function createTextField(labelText, value, placeholder, onInput) {
  const label = document.createElement('label');
  label.className = 'admin-field';
  const title = document.createElement('span');
  title.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener('input', () => onInput(input.value));
  label.append(title, input);
  return label;
}

function createSecretField(keys, onInput) {
  const wrapper = document.createElement('div');
  const label = document.createElement('label');
  label.className = 'admin-field';
  const title = document.createElement('span');
  title.textContent = 'KEY（每行一个）';
  const textarea = document.createElement('textarea');
  textarea.className = 'is-secret';
  textarea.value = keys.join('\n');
  textarea.spellcheck = false;
  textarea.autocomplete = 'off';
  textarea.addEventListener('input', () => onInput(normalizeKeys(textarea.value)));
  label.append(title, textarea);

  const actions = document.createElement('div');
  actions.className = 'secret-actions';
  const toggle = document.createElement('button');
  toggle.className = 'mini-button';
  toggle.type = 'button';
  toggle.textContent = '显示密钥';
  toggle.addEventListener('click', () => {
    const isSecret = textarea.classList.toggle('is-secret');
    toggle.textContent = isSecret ? '显示密钥' : '隐藏密钥';
  });
  actions.append(toggle);
  wrapper.append(label, actions);
  return wrapper;
}

function collectConfig() {
  return {
    global: { entries: normalizeEntriesForSave(state.config.global.entries) },
    sites: state.config.sites.map((site) => ({
      id: site.id,
      mode: site.mode,
      entries: site.mode === 'custom' ? normalizeEntriesForSave(site.entries) : [],
      pointsPerUse: normalizeUsageCost(site.pointsPerUse),
    })),
    // 保留旧版字段，确保教辅资料生成器继续使用原有文本接口。
    rule: { entries: normalizeEntriesForSave(state.config.rule.entries) },
    image: {
      resolution: imageResolution.value === 'standard' ? 'standard' : '4k',
      entries: normalizeEntriesForSave(state.config.image.entries),
    },
  };
}

function normalizeEntriesForSave(entries) {
  return entries.map((entry) => ({
    baseUrl: entry.baseUrl.trim(),
    model: entry.model.trim(),
    apiKeys: entry.apiKeys.map((key) => key.trim()).filter(Boolean),
  }));
}

function normalizeConfig(config) {
  const normalized = createEmptyConfig();
  const globalEntries = config?.global?.entries ?? config?.rule?.entries;
  normalized.global.entries = normalizeEntries(globalEntries);
  normalized.rule.entries = normalizeEntries(config?.rule?.entries ?? globalEntries);
  normalized.image.resolution = config?.image?.resolution === 'standard' ? 'standard' : '4k';
  normalized.image.entries = normalizeEntries(config?.image?.entries);
  normalized.sites = normalizeSites(config?.sites);
  if (normalized.global.entries.length === 0) normalized.global.entries.push(createBlankEntry());
  if (normalized.rule.entries.length === 0) normalized.rule.entries.push(createBlankEntry());
  if (normalized.image.entries.length === 0) normalized.image.entries.push(createBlankEntry());
  return normalized;
}

function normalizeSites(sites) {
  const byId = new Map();
  if (Array.isArray(sites)) {
    sites.forEach((site) => byId.set(String(site?.id || ''), site));
  } else if (sites && typeof sites === 'object') {
    Object.entries(sites).forEach(([id, site]) => byId.set(id, site));
  }
  return SITE_DEFINITIONS.map((id) => {
    const raw = byId.get(id);
    const mode = SITE_MODES.has(raw?.mode) ? raw.mode : 'global';
    return {
      id,
      mode,
      entries: mode === 'custom' ? normalizeEntries(raw?.entries) : [],
      pointsPerUse: normalizeUsageCost(raw?.pointsPerUse),
    };
  });
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    baseUrl: String(entry?.baseUrl || ''),
    model: String(entry?.model || ''),
    apiKeys: Array.isArray(entry?.apiKeys) ? entry.apiKeys.map(String) : [],
  }));
}

function normalizeKeys(value) {
  return [...new Set(value.split(/\r?\n/).map((key) => key.trim()).filter(Boolean))];
}

function normalizeUsageCost(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(100000, Math.floor(parsed)) : 1;
}

function createEmptyConfig() {
  return {
    global: { entries: [createBlankEntry()] },
    sites: SITE_DEFINITIONS.map((id) => ({ id, mode: 'global', entries: [], pointsPerUse: 1 })),
    rule: { entries: [createBlankEntry()] },
    image: { resolution: '4k', entries: [createBlankEntry()] },
  };
}

function createBlankEntry() {
  return { baseUrl: '', model: '', apiKeys: [] };
}

function clearConfigLists() {
  Object.values(providerLists).forEach((target) => { target.innerHTML = ''; });
  siteConfigList.innerHTML = '';
}

import {
  createAdminSession,
  requestJson,
  setAdminStatus,
  showAdminToast,
} from './admin-common.js';

const state = {
  config: createEmptyConfig(),
  saving: false,
};

const saveButton = document.querySelector('#saveConfigButton');
const reloadButton = document.querySelector('#reloadConfigButton');
const imageResolution = document.querySelector('#imageResolution');
const providerLists = {
  rule: document.querySelector('#ruleProviderList'),
  image: document.querySelector('#imageProviderList'),
};

saveButton.addEventListener('click', saveConfig);
reloadButton.addEventListener('click', loadConfig);
imageResolution.addEventListener('change', () => {
  state.config.image.resolution = imageResolution.value;
});

document.querySelectorAll('[data-add-entry]').forEach((button) => {
  button.addEventListener('click', () => {
    state.config[button.dataset.addEntry].entries.push(createBlankEntry());
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
    clearProviderLists();
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
    const payload = collectConfig();
    const data = await requestJson('/api/admin/ai-config', {
      method: 'PUT',
      body: payload,
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
  renderChannel('rule');
  renderChannel('image');
}

function renderChannel(channel) {
  const target = providerLists[channel];
  target.innerHTML = '';
  state.config[channel].entries.forEach((entry, index) => {
    target.appendChild(createProviderCard(channel, entry, index));
  });
}

function createProviderCard(channel, entry, index) {
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
  removeButton.addEventListener('click', () => {
    state.config[channel].entries.splice(index, 1);
    if (state.config[channel].entries.length === 0) state.config[channel].entries.push(createBlankEntry());
    renderConfig();
  });
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
  normalized.rule.entries = normalizeEntries(config?.rule?.entries);
  normalized.image.resolution = config?.image?.resolution === 'standard' ? 'standard' : '4k';
  normalized.image.entries = normalizeEntries(config?.image?.entries);
  if (normalized.rule.entries.length === 0) normalized.rule.entries.push(createBlankEntry());
  if (normalized.image.entries.length === 0) normalized.image.entries.push(createBlankEntry());
  return normalized;
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

function createEmptyConfig() {
  return {
    rule: { entries: [createBlankEntry()] },
    image: { resolution: '4k', entries: [createBlankEntry()] },
  };
}

function createBlankEntry() {
  return { baseUrl: '', model: '', apiKeys: [] };
}

function clearProviderLists() {
  Object.values(providerLists).forEach((target) => { target.innerHTML = ''; });
}

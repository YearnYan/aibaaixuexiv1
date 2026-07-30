(function () {
  'use strict';

  const presets = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
    kimi: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k-vision-preview' },
    ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5vl:7b' },
    custom: { baseUrl: '', model: '' },
  };

  const elements = {
    form: document.querySelector('#settings-form'),
    provider: document.querySelector('#provider'),
    baseUrl: document.querySelector('#base-url'),
    model: document.querySelector('#model'),
    apiKey: document.querySelector('#api-key'),
    clearApiKey: document.querySelector('#clear-api-key'),
    temperature: document.querySelector('#temperature'),
    temperatureOutput: document.querySelector('#temperature-output'),
    timeout: document.querySelector('#timeout'),
    adminField: document.querySelector('#admin-password-field'),
    adminPassword: document.querySelector('#admin-password'),
    saveButton: document.querySelector('#save-button'),
    testButton: document.querySelector('#test-button'),
    saveMessage: document.querySelector('#save-message'),
    keyStatus: document.querySelector('#key-status'),
    configState: document.querySelector('#config-state'),
    endpointPreview: document.querySelector('#endpoint-preview'),
  };

  function initIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 2 } });
  }

  function setMessage(message, type = '') {
    elements.saveMessage.textContent = message;
    elements.saveMessage.className = `save-message${type ? ` is-${type}` : ''}`;
  }

  function setBusy(isBusy, testing = false) {
    elements.saveButton.disabled = isBusy;
    elements.testButton.disabled = isBusy;
    if (isBusy) {
      const target = testing ? elements.testButton : elements.saveButton;
      target.querySelector('span').textContent = testing ? '正在连接' : '正在保存';
    } else {
      elements.testButton.querySelector('span').textContent = '保存并测试';
      elements.saveButton.querySelector('span').textContent = '保存配置';
    }
  }

  function adminHeaders() {
    const password = elements.adminPassword.value || sessionStorage.getItem('ai-admin-password') || '';
    if (password) sessionStorage.setItem('ai-admin-password', password);
    return password ? { 'X-Admin-Password': password } : {};
  }

  function updateEndpointPreview() {
    const base = elements.baseUrl.value.trim().replace(/\/+$/, '');
    elements.endpointPreview.textContent = /\/chat\/completions$/i.test(base)
      ? base
      : `${base || '接口根地址'}/chat/completions`;
  }

  function updateKeyState(hasApiKey) {
    elements.keyStatus.textContent = hasApiKey ? '已安全配置' : '尚未配置';
    elements.configState.classList.toggle('is-unconfigured', !hasApiKey);
  }

  async function readConfig() {
    try {
      const response = await fetch('/api/config');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || '读取配置失败');
      const config = payload.config;
      elements.provider.value = config.provider;
      elements.baseUrl.value = config.baseUrl;
      elements.model.value = config.model;
      elements.temperature.value = config.temperature;
      elements.temperatureOutput.value = config.temperature.toFixed(1);
      elements.timeout.value = Math.round(config.timeoutMs / 1000);
      elements.adminField.hidden = !config.requiresAdminPassword;
      if (config.requiresAdminPassword) {
        elements.adminPassword.value = sessionStorage.getItem('ai-admin-password') || '';
      }
      updateKeyState(config.hasApiKey);
      updateEndpointPreview();
    } catch (error) {
      setMessage(error.message, 'error');
      elements.keyStatus.textContent = '读取失败';
    }
  }

  function getPayload() {
    return {
      provider: elements.provider.value,
      baseUrl: elements.baseUrl.value.trim(),
      apiKey: elements.apiKey.value.trim(),
      clearApiKey: elements.clearApiKey.checked,
      model: elements.model.value.trim(),
      temperature: Number(elements.temperature.value),
      timeoutMs: Number(elements.timeout.value) * 1000,
    };
  }

  async function saveConfig() {
    if (!elements.form.reportValidity()) return null;
    const response = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(getPayload()),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || '保存配置失败');
    elements.apiKey.value = '';
    elements.clearApiKey.checked = false;
    updateKeyState(payload.config.hasApiKey);
    return payload;
  }

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const payload = await saveConfig();
      if (payload) setMessage('配置已保存，可以返回主页面开始分析。', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    } finally {
      setBusy(false);
    }
  });

  elements.testButton.addEventListener('click', async () => {
    setBusy(true, true);
    setMessage('正在保存配置并连接模型...');
    try {
      const saved = await saveConfig();
      if (!saved) return;
      const response = await fetch('/api/config/test', {
        method: 'POST',
        headers: adminHeaders(),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.details ? `：${payload.details}` : '';
        throw new Error(`${payload?.message || '连接测试失败'}${detail}`);
      }
      setMessage(`${payload.message} · ${payload.model} · ${payload.latencyMs}ms`, 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    } finally {
      setBusy(false);
    }
  });

  elements.provider.addEventListener('change', () => {
    const preset = presets[elements.provider.value];
    if (preset && elements.provider.value !== 'custom') {
      elements.baseUrl.value = preset.baseUrl;
      elements.model.value = preset.model;
      updateEndpointPreview();
    }
  });
  elements.baseUrl.addEventListener('input', updateEndpointPreview);
  elements.temperature.addEventListener('input', () => {
    elements.temperatureOutput.value = Number(elements.temperature.value).toFixed(1);
  });
  elements.clearApiKey.addEventListener('change', () => {
    elements.apiKey.disabled = elements.clearApiKey.checked;
    if (elements.clearApiKey.checked) elements.apiKey.value = '';
  });

  function bindPasswordToggle(buttonSelector, input) {
    document.querySelector(buttonSelector).addEventListener('click', (event) => {
      input.type = input.type === 'password' ? 'text' : 'password';
      event.currentTarget.setAttribute('aria-label', input.type === 'password' ? '显示密码' : '隐藏密码');
      event.currentTarget.innerHTML = `<i data-lucide="${input.type === 'password' ? 'eye' : 'eye-off'}" aria-hidden="true"></i>`;
      initIcons();
    });
  }

  bindPasswordToggle('#toggle-key', elements.apiKey);
  bindPasswordToggle('#toggle-admin', elements.adminPassword);
  initIcons();
  readConfig();
}());

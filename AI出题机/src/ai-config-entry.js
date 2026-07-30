import './ai-config.css';

const API_ENDPOINT = '/api/admin/ai-config';

const form = document.getElementById('aiConfigForm');
const apiURLInput = document.getElementById('apiURL');
const modelInput = document.getElementById('model');
const apiKeysInput = document.getElementById('apiKeys');
const maxTokensInput = document.getElementById('maxTokens');
const temperatureInput = document.getElementById('temperature');
const temperatureOutput = document.getElementById('temperatureOutput');
const revealKeyButton = document.getElementById('revealKeyButton');
const saveButton = document.getElementById('saveButton');
const testButton = document.getElementById('testButton');
const feedback = document.getElementById('feedback');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const keySummary = document.getElementById('keySummary');
const keyHint = document.getElementById('keyHint');

function setFeedback(message, tone = 'neutral') {
  feedback.textContent = message;
  feedback.dataset.tone = tone;
}

function setButtonLoading(button, loading, loadingText) {
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
  button.disabled = loading;
  button.textContent = loading ? loadingText : button.dataset.defaultText;
}

function renderStatus(config) {
  const configured = Boolean(config?.configured);
  statusDot.classList.toggle('is-ready', configured);
  statusDot.classList.toggle('is-empty', !configured);
  statusText.textContent = configured ? '已配置，可调用' : '待配置 API Key';
  keySummary.textContent = `${Number(config?.keyCount || 0)} 个密钥`;
  keyHint.textContent = configured
    ? `当前：${(config.maskedKeys || []).join('、')}。留空则保留已有密钥。`
    : '多个密钥请用英文逗号分隔。';
}

function fillForm(config) {
  apiURLInput.value = config.apiURL || '';
  modelInput.value = config.model || '';
  maxTokensInput.value = config.maxTokens || 8000;
  temperatureInput.value = config.temperature ?? 0.7;
  temperatureOutput.value = temperatureInput.value;
  renderStatus(config);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
  return data;
}

async function loadConfig() {
  try {
    const config = await request(API_ENDPOINT);
    fillForm(config);
    setFeedback(config.configured
      ? '配置已载入。修改后保存即可立即生效。'
      : '尚未配置密钥，请填写连接信息后保存。', config.configured ? 'success' : 'warning');
  } catch (error) {
    statusDot.classList.add('is-error');
    statusText.textContent = '配置服务不可用';
    setFeedback(error.message, 'error');
    form.querySelectorAll('input, button').forEach((element) => { element.disabled = true; });
  }
}

temperatureInput.addEventListener('input', () => {
  temperatureOutput.value = temperatureInput.value;
});

revealKeyButton.addEventListener('click', () => {
  const reveal = apiKeysInput.type === 'password';
  apiKeysInput.type = reveal ? 'text' : 'password';
  revealKeyButton.textContent = reveal ? '隐藏' : '显示';
  revealKeyButton.setAttribute('aria-pressed', String(reveal));
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  setButtonLoading(saveButton, true, '正在保存…');
  setFeedback('正在校验并保存配置…');
  try {
    const payload = {
      apiURL: apiURLInput.value.trim(),
      model: modelInput.value.trim(),
      apiKeys: apiKeysInput.value.trim(),
      maxTokens: Number(maxTokensInput.value),
      temperature: Number(temperatureInput.value)
    };
    const result = await request(API_ENDPOINT, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    apiKeysInput.value = '';
    renderStatus(result.config);
    setFeedback(result.message, 'success');
  } catch (error) {
    setFeedback(error.message, 'error');
  } finally {
    setButtonLoading(saveButton, false);
  }
});

testButton.addEventListener('click', async () => {
  setButtonLoading(testButton, true, '正在测试…');
  setFeedback('正在向当前模型发送最小测试请求…');
  try {
    const result = await request(`${API_ENDPOINT}/test`, {
      method: 'POST',
      body: '{}'
    });
    const preview = result.responsePreview ? `，响应“${result.responsePreview}”` : '';
    setFeedback(`${result.message}，耗时 ${result.latencyMs} ms${preview}`, 'success');
  } catch (error) {
    setFeedback(error.message, 'error');
  } finally {
    setButtonLoading(testButton, false);
  }
});

loadConfig();

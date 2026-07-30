const configForm = document.getElementById('configForm');
const baseURLInput = document.getElementById('baseURL');
const modelInput = document.getElementById('model');
const apiKeyInput = document.getElementById('apiKey');
const clearApiKeyInput = document.getElementById('clearApiKey');
const timeoutSecondsInput = document.getElementById('timeoutSeconds');
const maxTokensInput = document.getElementById('maxTokens');
const temperatureInput = document.getElementById('temperature');
const temperatureValue = document.getElementById('temperatureValue');
const revealKeyButton = document.getElementById('revealKey');
const saveButton = document.getElementById('saveButton');
const testButton = document.getElementById('testButton');
const resetButton = document.getElementById('resetButton');
const statusMessage = document.getElementById('statusMessage');
const keyBadge = document.getElementById('keyBadge');
const keyHint = document.getElementById('keyHint');
const inputState = document.getElementById('inputState');
const outputState = document.getElementById('outputState');
const runtimeAddress = document.getElementById('runtimeAddress');

let currentConfig = null;
let isBusy = false;

document.addEventListener('DOMContentLoaded', () => {
    runtimeAddress.textContent = window.location.host || '127.0.0.1';
    bindInteractions();
    updateTemperatureValue();
    loadConfig();
});

function bindInteractions() {
    configForm.addEventListener('submit', handleSave);
    testButton.addEventListener('click', handleConnectionTest);
    resetButton.addEventListener('click', handleReset);
    revealKeyButton.addEventListener('click', toggleKeyVisibility);
    temperatureInput.addEventListener('input', updateTemperatureValue);
    clearApiKeyInput.addEventListener('change', syncClearKeyState);
}

async function loadConfig() {
    setBusy(true);
    showStatus('正在读取当前运行实例…', 'neutral');

    try {
        const config = await requestJSON('/api/config');
        applyConfig(config);
        hideStatus();
    } catch (error) {
        markConfigUnavailable();
        showStatus(error.message || '无法读取本地 AI 配置。', 'error');
    } finally {
        setBusy(false);
    }
}

async function handleSave(event) {
    event.preventDefault();
    if (isBusy) return;

    let payload;
    try {
        payload = buildPayload();
    } catch (error) {
        showStatus(error.message, 'error');
        return;
    }

    setBusy(true);
    showStatus('正在保存到当前 Node.js 进程…', 'neutral');

    try {
        const config = await requestJSON('/api/config', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        applyConfig(config);
        inputState.textContent = '已保存';
        showStatus('运行配置已生效。下一次试卷识别将使用这组参数。', 'success');
    } catch (error) {
        showStatus(error.message || '运行配置保存失败。', 'error');
    } finally {
        setBusy(false);
    }
}

async function handleConnectionTest() {
    if (isBusy) return;

    if (apiKeyInput.value.trim()) {
        showStatus('输入框中的 API Key 尚未保存，请先保存配置再测试连接。', 'error');
        return;
    }
    if (!currentConfig?.hasApiKey) {
        showStatus('当前实例还没有 API Key，请先填写并保存。', 'error');
        return;
    }

    setBusy(true);
    showStatus('正在向上游发送最小连接检查…', 'neutral');

    try {
        const result = await requestJSON('/api/config/test', { method: 'POST' });
        const reply = String(result.reply || '上游已响应').slice(0, 120);
        showStatus(`连接正常 · ${result.model} · ${result.latencyMs}ms · ${reply}`, 'success');
    } catch (error) {
        showStatus(error.message || '连接测试失败。', 'error');
    } finally {
        setBusy(false);
    }
}

async function handleReset() {
    if (isBusy) return;

    const confirmed = window.confirm('恢复服务启动时读取的环境变量配置？当前进程中的修改将被覆盖。');
    if (!confirmed) return;

    setBusy(true);
    showStatus('正在恢复环境变量配置…', 'neutral');

    try {
        const config = await requestJSON('/api/config/reset', { method: 'POST' });
        applyConfig(config);
        inputState.textContent = '已恢复';
        showStatus('已恢复服务启动时的环境变量配置。', 'success');
    } catch (error) {
        showStatus(error.message || '恢复环境变量失败。', 'error');
    } finally {
        setBusy(false);
    }
}

function buildPayload() {
    const baseURL = baseURLInput.value.trim();
    const model = modelInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const timeoutSeconds = Number(timeoutSecondsInput.value);
    const maxTokens = Number(maxTokensInput.value);
    const temperature = Number(temperatureInput.value);
    const clearApiKey = clearApiKeyInput.checked;

    if (!baseURL) throw new Error('请填写 API 网关地址。');
    if (!/^https?:\/\//i.test(baseURL)) throw new Error('API 网关地址必须以 http:// 或 https:// 开头。');
    if (!model) throw new Error('请填写模型名称。');
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 600) {
        throw new Error('请求超时必须是 5–600 秒之间的整数。');
    }
    if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 65536) {
        throw new Error('最大输出 Token 必须是 256–65536 之间的整数。');
    }
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        throw new Error('Temperature 必须在 0–2 之间。');
    }
    if (clearApiKey && apiKey) {
        throw new Error('不能同时设置并清除 API Key。');
    }

    const payload = {
        baseURL,
        model,
        timeoutMs: timeoutSeconds * 1000,
        maxTokens,
        temperature,
        clearApiKey
    };

    if (apiKey) {
        payload.apiKey = apiKey;
    }

    return payload;
}

function applyConfig(config) {
    currentConfig = config;
    baseURLInput.value = config.baseURL || '';
    modelInput.value = config.model || '';
    timeoutSecondsInput.value = Math.round(Number(config.timeoutMs || 180000) / 1000);
    maxTokensInput.value = Number(config.maxTokens || 8192);
    temperatureInput.value = Number(config.temperature ?? 0.2);
    apiKeyInput.value = '';
    apiKeyInput.type = 'password';
    revealKeyButton.setAttribute('aria-pressed', 'false');
    revealKeyButton.setAttribute('aria-label', '显示 API Key');
    clearApiKeyInput.checked = false;
    syncClearKeyState();
    updateTemperatureValue();
    updateRuntimeState(config);
}

function updateRuntimeState(config) {
    const hasApiKey = Boolean(config.hasApiKey);
    const sourceLabels = {
        environment: '环境变量',
        runtime: '当前进程',
        missing: '未配置'
    };

    keyBadge.dataset.state = hasApiKey ? 'ready' : 'missing';
    keyBadge.querySelector('strong').textContent = hasApiKey ? 'Key 已配置' : 'Key 未配置';
    keyHint.textContent = hasApiKey
        ? `当前来源：${sourceLabels[config.apiKeySource] || '当前进程'}。留空即可保留，密钥不会回显。`
        : '尚未配置密钥。保存后输入框会立即清空，密钥不会回显。';
    apiKeyInput.placeholder = hasApiKey ? '留空即保留当前密钥' : '粘贴 API Key';
    inputState.textContent = '已读取';
    inputState.className = 'node-state is-ready';
    outputState.textContent = hasApiKey ? '可调用' : '缺 Key';
    outputState.className = hasApiKey ? 'node-state is-ready' : 'node-state is-missing';
}

function markConfigUnavailable() {
    keyBadge.dataset.state = 'missing';
    keyBadge.querySelector('strong').textContent = '读取失败';
    inputState.textContent = '不可用';
    inputState.className = 'node-state is-missing';
    outputState.textContent = '未接通';
    outputState.className = 'node-state is-missing';
}

function syncClearKeyState() {
    const shouldClear = clearApiKeyInput.checked;
    apiKeyInput.disabled = shouldClear;
    revealKeyButton.disabled = shouldClear;
    if (shouldClear) {
        apiKeyInput.value = '';
        apiKeyInput.type = 'password';
        revealKeyButton.setAttribute('aria-pressed', 'false');
    }
}

function toggleKeyVisibility() {
    const isVisible = revealKeyButton.getAttribute('aria-pressed') === 'true';
    const nextVisible = !isVisible;
    apiKeyInput.type = nextVisible ? 'text' : 'password';
    revealKeyButton.setAttribute('aria-pressed', String(nextVisible));
    revealKeyButton.setAttribute('aria-label', nextVisible ? '隐藏 API Key' : '显示 API Key');
    apiKeyInput.focus();
}

function updateTemperatureValue() {
    temperatureValue.value = Number(temperatureInput.value).toFixed(1);
}

function setBusy(busy) {
    isBusy = busy;
    saveButton.disabled = busy;
    testButton.disabled = busy;
    resetButton.disabled = busy;
}

function showStatus(message, state) {
    statusMessage.hidden = false;
    statusMessage.dataset.state = state;
    statusMessage.textContent = message;
}

function hideStatus() {
    statusMessage.hidden = true;
    statusMessage.textContent = '';
    delete statusMessage.dataset.state;
}

async function requestJSON(url, options = {}) {
    const response = await fetch(url, {
        cache: 'no-store',
        ...options,
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        }
    });
    const rawText = await response.text();
    let data = null;

    try {
        data = rawText ? JSON.parse(rawText) : null;
    } catch (_error) {
        data = null;
    }

    if (!response.ok) {
        throw new Error(data?.error?.message || `请求失败（HTTP ${response.status}）。`);
    }
    if (!data) {
        throw new Error('服务端返回了空响应或非法 JSON。');
    }

    return data;
}

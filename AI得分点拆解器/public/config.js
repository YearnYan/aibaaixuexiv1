const form = document.querySelector("#configForm");
const protocol = document.querySelector("#protocol");
const baseUrl = document.querySelector("#baseUrl");
const model = document.querySelector("#model");
const timeoutMs = document.querySelector("#timeoutMs");
const apiKey = document.querySelector("#apiKey");
const keyHint = document.querySelector("#keyHint");
const protocolHint = document.querySelector("#protocolHint");
const connectionState = document.querySelector("#connectionState");
const testButton = document.querySelector("#testButton");
const saveButton = document.querySelector("#saveButton");
const secretToggle = document.querySelector("#secretToggle");
const adminDialog = document.querySelector("#adminDialog");
const adminForm = document.querySelector("#adminForm");
const adminPasswordInput = document.querySelector("#adminPassword");
const adminError = document.querySelector("#adminError");
const toast = document.querySelector("#toast");

let adminPassword = "";
let toastTimer;

function showToast(message, type = "info") {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", type === "error");
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
}

function setConnectionState(state, text) {
  connectionState.classList.remove("configured", "error");
  if (state) connectionState.classList.add(state);
  connectionState.querySelector("span").textContent = text;
}

async function apiRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (adminPassword) headers.set("x-admin-password", adminPassword);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || "请求失败，请稍后重试");
    error.code = data?.error?.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

function showAdminDialog(message = "") {
  adminError.textContent = message;
  if (!adminDialog.open) adminDialog.showModal();
  window.setTimeout(() => adminPasswordInput.focus(), 50);
}

function applyConfig(config) {
  protocol.value = config.protocol;
  baseUrl.value = config.baseUrl;
  model.value = config.model;
  timeoutMs.value = config.timeoutMs;
  apiKey.value = "";
  if (config.apiKeyConfigured) {
    apiKey.placeholder = `${config.apiKeyMasked} · 留空保留现有密钥`;
    keyHint.textContent = "密钥已配置。留空保存或测试会继续使用现有密钥。";
    setConnectionState("configured", "密钥已配置");
  } else {
    apiKey.placeholder = "首次配置时填写 API 密钥";
    keyHint.textContent = "密钥只发送到本服务端，加密保存在本机，不会回显到浏览器。";
    setConnectionState("error", "尚未配置密钥");
  }
  updateProtocolHint();
}

async function loadConfig() {
  try {
    const config = await apiRequest("/api/config");
    applyConfig(config);
    if (adminDialog.open) adminDialog.close();
    adminError.textContent = "";
    return true;
  } catch (error) {
    if (["ADMIN_UNAUTHORIZED", "ADMIN_PASSWORD_REQUIRED"].includes(error.code)) {
      showAdminDialog(adminPassword ? "管理密码不正确" : "");
      return false;
    }
    setConnectionState("error", "配置读取失败");
    showToast(error.message, "error");
    return false;
  }
}

function collectConfig() {
  const timeout = Number(timeoutMs.value);
  if (!baseUrl.value.trim() || !model.value.trim()) throw new Error("请完整填写 API 地址和模型");
  if (!Number.isInteger(timeout) || timeout < 10000 || timeout > 180000) {
    throw new Error("超时时间必须在 10000 到 180000 毫秒之间");
  }
  return {
    protocol: protocol.value,
    baseUrl: baseUrl.value.trim(),
    model: model.value.trim(),
    timeoutMs: timeout,
    apiKey: apiKey.value.trim(),
  };
}

function setBusy(isBusy, activeButton) {
  testButton.disabled = isBusy;
  saveButton.disabled = isBusy;
  if (activeButton) activeButton.setAttribute("aria-busy", String(isBusy));
}

function updateProtocolHint() {
  protocolHint.textContent = protocol.value === "responses"
    ? "支持直接读取 PDF、Word 和图片，并使用严格结构化输出。"
    : "兼容常见对话接口；PDF/DOCX 会先提取文字，扫描 PDF 请改用图片。";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true, saveButton);
  try {
    const config = collectConfig();
    const saved = await apiRequest("/api/config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
    applyConfig(saved);
    showToast("AI 配置已保存");
  } catch (error) {
    showToast(error.message, "error");
    if (["ADMIN_UNAUTHORIZED", "ADMIN_PASSWORD_REQUIRED"].includes(error.code)) showAdminDialog();
  } finally {
    setBusy(false, saveButton);
  }
});

testButton.addEventListener("click", async () => {
  setBusy(true, testButton);
  setConnectionState("", "正在测试连接");
  try {
    const config = collectConfig();
    const result = await apiRequest("/api/config/test", {
      method: "POST",
      body: JSON.stringify(config),
    });
    setConnectionState("configured", "连接正常");
    showToast(result.message);
  } catch (error) {
    setConnectionState("error", "连接失败");
    showToast(error.message, "error");
    if (["ADMIN_UNAUTHORIZED", "ADMIN_PASSWORD_REQUIRED"].includes(error.code)) showAdminDialog();
  } finally {
    setBusy(false, testButton);
  }
});

secretToggle.addEventListener("click", () => {
  const show = apiKey.type === "password";
  apiKey.type = show ? "text" : "password";
  const icon = secretToggle.querySelector(".lucide-icon");
  icon.classList.toggle("icon-eye", !show);
  icon.classList.toggle("icon-eye-off", show);
  secretToggle.setAttribute("aria-label", show ? "隐藏密钥" : "显示密钥");
});

protocol.addEventListener("change", updateProtocolHint);

adminDialog.addEventListener("cancel", (event) => event.preventDefault());

adminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminPassword = adminPasswordInput.value;
  adminError.textContent = "正在验证...";
  await loadConfig();
});

loadConfig();

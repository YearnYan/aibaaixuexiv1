const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { ConfigStore, maskKey, normalizeBaseUrl } = require("../src/config-store");

test("AI 密钥加密落盘且能被同一配置存储读取", async () => {
  const dataDir = path.join(os.tmpdir(), `ai-score-point-${crypto.randomUUID()}`);
  const store = new ConfigStore({ dataDir, env: {} });
  const secret = "sk-test-not-a-real-secret-1234";

  await store.save({
    protocol: "responses",
    baseUrl: "https://api.openai.com/v1/",
    apiKey: secret,
    model: "gpt-test",
    timeoutMs: 30000,
  });

  const diskContent = await fs.readFile(path.join(dataDir, "ai-config.json"), "utf8");
  const resolved = await store.getResolvedConfig();
  assert.equal(diskContent.includes(secret), false);
  assert.equal(resolved.apiKey, secret);
  assert.equal(resolved.baseUrl, "https://api.openai.com/v1");
});

test("配置工具限制非本机 HTTP 并正确掩码", () => {
  assert.equal(maskKey("sk-abcdefgh1234"), "sk-••••••••1234");
  assert.equal(normalizeBaseUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1");
  assert.throws(() => normalizeBaseUrl("http://example.com/v1"), /HTTPS/);
});

test("平台模式使用统一 Chat Completions 协议和内部配置", async () => {
  const store = new ConfigStore({
    dataDir: path.join(os.tmpdir(), `ai-score-point-platform-${crypto.randomUUID()}`),
    env: {
      PLATFORM_MODE: "1",
      AI_PROTOCOL: "chat-completions",
      PLATFORM_AI_BASE_URL: "http://127.0.0.1:5500/internal/ai/v1",
      PLATFORM_AI_API_KEY: "platform-token",
      PLATFORM_AI_MODEL: "platform-managed",
    },
  });

  const resolved = await store.getResolvedConfig();
  assert.equal(resolved.protocol, "chat-completions");
  assert.equal(resolved.baseUrl, "http://127.0.0.1:5500/internal/ai/v1");
  assert.equal(resolved.apiKey, "platform-token");
  assert.equal(resolved.model, "platform-managed");
});

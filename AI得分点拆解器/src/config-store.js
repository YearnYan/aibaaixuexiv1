const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { z } = require("zod");
const { AppError } = require("./errors");

const protocolSchema = z.enum(["responses", "chat-completions"]);

const configInputSchema = z.object({
  protocol: protocolSchema,
  baseUrl: z.string().trim().min(1).max(500),
  apiKey: z.string().max(500).optional().default(""),
  model: z.string().trim().min(1).max(100),
  timeoutMs: z.coerce.number().int().min(10000).max(180000),
});

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("CONFIG_INVALID", "API 地址格式不正确");
  }
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new AppError("CONFIG_INVALID", "API 地址必须使用 HTTPS，本机地址除外");
  }
  return url.toString().replace(/\/$/, "");
}

function maskKey(apiKey) {
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "••••••••";
  return `${apiKey.slice(0, 3)}••••••••${apiKey.slice(-4)}`;
}

class ConfigStore {
  constructor({ dataDir, env = process.env }) {
    this.dataDir = dataDir;
    this.env = env;
    this.configPath = path.join(dataDir, "ai-config.json");
    this.keyPath = path.join(dataDir, ".config-key");
  }

  getDefaults() {
    const timeout = Number.parseInt(this.env.AI_TIMEOUT_MS || "120000", 10);
    return {
      protocol: this.env.AI_PROTOCOL === "chat-completions" ? "chat-completions" : "responses",
      baseUrl: this.env.AI_BASE_URL || "https://api.openai.com/v1",
      model: this.env.AI_MODEL || "gpt-5.6",
      timeoutMs: Number.isInteger(timeout) ? timeout : 120000,
    };
  }

  async readStored() {
    try {
      const content = await fs.readFile(this.configPath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new AppError("CONFIG_READ_FAILED", "读取 AI 配置失败", 500);
    }
  }

  async getEncryptionKey() {
    if (this.env.CONFIG_ENCRYPTION_KEY) {
      return crypto.createHash("sha256").update(this.env.CONFIG_ENCRYPTION_KEY).digest();
    }

    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const encoded = await fs.readFile(this.keyPath, "utf8");
      const key = Buffer.from(encoded.trim(), "base64");
      if (key.length !== 32) throw new Error("invalid key length");
      return key;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new AppError("CONFIG_KEY_INVALID", "配置加密密钥无效", 500);
      }
      const key = crypto.randomBytes(32);
      await fs.writeFile(this.keyPath, key.toString("base64"), { mode: 0o600, flag: "wx" });
      return key;
    }
  }

  async encryptSecret(value) {
    const key = await this.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      value: encrypted.toString("base64"),
    };
  }

  async decryptSecret(secret) {
    if (!secret) return "";
    try {
      const key = await this.getEncryptionKey();
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(secret.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(secret.value, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new AppError("CONFIG_DECRYPT_FAILED", "AI 密钥解密失败，请重新配置", 500);
    }
  }

  async getResolvedConfig() {
    const defaults = this.getDefaults();
    if (this.env.PLATFORM_MODE === "1") {
      return {
        ...defaults,
        baseUrl: this.env.PLATFORM_AI_BASE_URL || this.env.AI_BASE_URL || defaults.baseUrl,
        model: this.env.PLATFORM_AI_MODEL || this.env.AI_MODEL || defaults.model,
        apiKey: this.env.PLATFORM_AI_API_KEY || this.env.AI_API_KEY || "",
      };
    }
    const stored = await this.readStored();
    const apiKey = stored?.encryptedApiKey
      ? await this.decryptSecret(stored.encryptedApiKey)
      : (this.env.AI_API_KEY || "");
    return {
      protocol: stored?.protocol || defaults.protocol,
      baseUrl: stored?.baseUrl || defaults.baseUrl,
      model: stored?.model || defaults.model,
      timeoutMs: stored?.timeoutMs || defaults.timeoutMs,
      apiKey,
    };
  }

  async getPublicConfig() {
    const config = await this.getResolvedConfig();
    return {
      protocol: config.protocol,
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: config.timeoutMs,
      apiKeyConfigured: Boolean(config.apiKey),
      apiKeyMasked: maskKey(config.apiKey),
    };
  }

  async save(input) {
    const parsed = configInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError("CONFIG_INVALID", "AI 配置字段不完整或超出允许范围");
    }

    const current = await this.getResolvedConfig();
    const apiKey = parsed.data.apiKey.trim() || current.apiKey;
    if (!apiKey) {
      throw new AppError("CONFIG_KEY_REQUIRED", "首次保存时必须填写 API 密钥");
    }

    const stored = {
      version: 1,
      protocol: parsed.data.protocol,
      baseUrl: normalizeBaseUrl(parsed.data.baseUrl),
      model: parsed.data.model,
      timeoutMs: parsed.data.timeoutMs,
      encryptedApiKey: await this.encryptSecret(apiKey),
      updatedAt: new Date().toISOString(),
    };

    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.configPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return this.getPublicConfig();
  }

  validateInput(input) {
    const parsed = configInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError("CONFIG_INVALID", "AI 配置字段不完整或超出允许范围");
    }
    return {
      ...parsed.data,
      baseUrl: normalizeBaseUrl(parsed.data.baseUrl),
    };
  }
}

module.exports = { ConfigStore, maskKey, normalizeBaseUrl };

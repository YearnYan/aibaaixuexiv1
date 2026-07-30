import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors.js';

const DEFAULT_CONFIG = Object.freeze({
  providerName: 'OpenAI 兼容服务',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
  temperature: 0.2,
  timeoutMs: 60000,
});

function encryptionKeyFrom(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function maskApiKey(apiKey) {
  if (!apiKey) return '';
  if (apiKey.length < 9) return '••••••••';
  return `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}`;
}

export class ConfigStore {
  constructor({ dataDir = path.resolve(process.cwd(), '.data'), env = process.env } = {}) {
    this.dataDir = dataDir;
    this.env = env;
    this.configPath = path.join(dataDir, 'ai-config.json');
    this.keyPath = path.join(dataDir, '.config-key');
  }

  ensureDataDir() {
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  getEncryptionKey() {
    if (this.env.CONFIG_ENCRYPTION_KEY) {
      return encryptionKeyFrom(this.env.CONFIG_ENCRYPTION_KEY);
    }

    this.ensureDataDir();
    if (!fs.existsSync(this.keyPath)) {
      fs.writeFileSync(this.keyPath, crypto.randomBytes(32).toString('hex'), {
        encoding: 'utf8',
        mode: 0o600,
      });
    }
    return encryptionKeyFrom(fs.readFileSync(this.keyPath, 'utf8'));
  }

  encrypt(secret) {
    if (!secret) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    };
  }

  decrypt(payload) {
    if (!payload) return '';
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.getEncryptionKey(),
        Buffer.from(payload.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(payload.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      throw new AppError(500, 'CONFIG_DECRYPT_FAILED', 'AI 配置无法解密，请重新保存配置。', error);
    }
  }

  readStoredConfig() {
    if (!fs.existsSync(this.configPath)) return null;
    try {
      const stored = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return {
        providerName: stored.providerName,
        baseUrl: stored.baseUrl,
        apiKey: this.decrypt(stored.apiKey),
        model: stored.model,
        temperature: stored.temperature,
        timeoutMs: stored.timeoutMs,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'CONFIG_READ_FAILED', 'AI 配置文件损坏，请重新保存配置。', error);
    }
  }

  getConfig() {
    const stored = this.readStoredConfig() ?? DEFAULT_CONFIG;
    return {
      providerName: this.env.AI_PROVIDER_NAME || stored.providerName,
      baseUrl: this.env.AI_BASE_URL || stored.baseUrl,
      apiKey: this.env.AI_API_KEY || stored.apiKey,
      model: this.env.AI_MODEL || stored.model,
      temperature: this.env.AI_TEMPERATURE
        ? Number(this.env.AI_TEMPERATURE)
        : stored.temperature,
      timeoutMs: this.env.AI_TIMEOUT_MS ? Number(this.env.AI_TIMEOUT_MS) : stored.timeoutMs,
    };
  }

  getPublicConfig() {
    const config = this.getConfig();
    return {
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: config.temperature,
      timeoutMs: config.timeoutMs,
      configured: Boolean(config.apiKey),
      apiKeyPreview: maskApiKey(config.apiKey),
      managedByEnvironment: Boolean(this.env.AI_API_KEY),
    };
  }

  saveConfig(input) {
    const currentStored = this.readStoredConfig();
    const apiKey = input.apiKey || currentStored?.apiKey || '';

    this.ensureDataDir();
    const payload = {
      version: 1,
      providerName: input.providerName,
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      apiKey: this.encrypt(apiKey),
      model: input.model,
      temperature: input.temperature,
      timeoutMs: input.timeoutMs,
      updatedAt: new Date().toISOString(),
    };
    const tempPath = `${this.configPath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tempPath, this.configPath);
    return this.getPublicConfig();
  }
}

export { DEFAULT_CONFIG };

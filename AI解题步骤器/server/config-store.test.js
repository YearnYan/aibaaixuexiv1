import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore } from './config-store.js';

describe('ConfigStore', () => {
  it('加密保存 API 密钥并可重新读取', () => {
    const dataDir = path.join(os.tmpdir(), 'ai-solution-stepper-config-test');
    const store = new ConfigStore({ dataDir, env: {} });
    store.saveConfig({
      providerName: '测试服务',
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test-secret-value',
      model: 'vision-model',
      temperature: 0.2,
      timeoutMs: 60000,
    });

    const raw = fs.readFileSync(path.join(dataDir, 'ai-config.json'), 'utf8');
    expect(raw).not.toContain('sk-test-secret-value');
    expect(new ConfigStore({ dataDir, env: {} }).getConfig().apiKey).toBe('sk-test-secret-value');
  });

  it('保存空密钥时保留已有密钥', () => {
    const dataDir = path.join(os.tmpdir(), 'ai-solution-stepper-config-test');
    const store = new ConfigStore({ dataDir, env: {} });
    store.saveConfig({
      providerName: '更新后的服务',
      baseUrl: 'https://example.com/v1',
      apiKey: '',
      model: 'new-model',
      temperature: 0.1,
      timeoutMs: 30000,
    });

    const config = store.getConfig();
    expect(config.apiKey).toBe('sk-test-secret-value');
    expect(config.model).toBe('new-model');
  });
});

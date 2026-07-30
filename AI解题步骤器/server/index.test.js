import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './index.js';

describe('HTTP API', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const configStore = {
      getPublicConfig: () => ({ configured: false, providerName: '测试', model: 'test' }),
      getConfig: () => ({ apiKey: '' }),
    };
    server = await new Promise((resolve) => {
      const listener = createApp({ configStore, env: {} }).listen(0, '127.0.0.1', () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('返回健康状态', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, configured: false, contentSchemaVersion: 3 });
  });

  it('把畸形 multipart 请求识别为客户端错误', async () => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data' },
      body: 'invalid body',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'UPLOAD_INVALID' });
  });
});

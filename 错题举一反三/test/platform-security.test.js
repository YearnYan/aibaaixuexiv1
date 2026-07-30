const assert = require('node:assert/strict');
const test = require('node:test');
const {
  issueSecurityBootstrap,
  verifyProtectedRequest
} = require('../server/middleware/security');

const originalPlatformMode = process.env.PLATFORM_MODE;
const originalInternalToken = process.env.PLATFORM_INTERNAL_TOKEN;

test.after(() => {
  setEnvironment(originalPlatformMode, originalInternalToken);
});

test('平台代理请求只在可信回环链路上绕过子站 Cookie 会话', () => {
  setEnvironment('1', 'platform-test-token-1234567890');
  const valid = runProtectedRequest({
    remoteAddress: '::1',
    headers: {
      'x-platform-internal-token': 'platform-test-token-1234567890',
      'x-platform-user-id': 'user-3'
    }
  });
  assert.equal(valid.nextCalled, true);
  assert.equal(valid.request.securitySession.platformManaged, true);

  for (const candidate of [
    { remoteAddress: '127.0.0.1', headers: { 'x-platform-user-id': 'user-3' } },
    { remoteAddress: '127.0.0.1', headers: { 'x-platform-internal-token': 'wrong', 'x-platform-user-id': 'user-3' } },
    { remoteAddress: '172.16.0.10', headers: { 'x-platform-internal-token': 'platform-test-token-1234567890', 'x-platform-user-id': 'user-3' } },
    { remoteAddress: '127.0.0.1', headers: { 'x-platform-internal-token': 'platform-test-token-1234567890' } }
  ]) {
    const result = runProtectedRequest(candidate);
    assert.equal(result.nextCalled, false);
    assert.equal(result.response.statusCode, 403);
    assert.equal(result.response.payload.code, 'SECURITY_TOKEN_INVALID');
  }
});

test('独立运行模式继续要求原有 Cookie 与请求令牌', () => {
  setEnvironment('0', 'platform-test-token-1234567890');
  assert.equal(runProtectedRequest({ remoteAddress: '127.0.0.1', headers: {} }).response.statusCode, 403);

  const bootstrapRequest = createRequest({ method: 'GET', remoteAddress: '127.0.0.1', headers: {} });
  const bootstrapResponse = createResponse();
  issueSecurityBootstrap(bootstrapRequest, bootstrapResponse);
  const authenticated = runProtectedRequest({
    remoteAddress: '127.0.0.1',
    headers: {
      cookie: bootstrapResponse.appendedHeaders['Set-Cookie'].split(';')[0],
      'x-cx-request-token': bootstrapResponse.payload.requestToken
    }
  });
  assert.equal(authenticated.nextCalled, true);
});

function setEnvironment(platformMode, internalToken) {
  if (platformMode === undefined) delete process.env.PLATFORM_MODE;
  else process.env.PLATFORM_MODE = platformMode;
  if (internalToken === undefined) delete process.env.PLATFORM_INTERNAL_TOKEN;
  else process.env.PLATFORM_INTERNAL_TOKEN = internalToken;
}

function createRequest({ method = 'POST', remoteAddress, headers }) {
  return { method, headers: { ...headers }, ip: remoteAddress, socket: { remoteAddress } };
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    appendedHeaders: {},
    setHeader(name, value) { this.headers[name] = value; },
    append(name, value) { this.appendedHeaders[name] = value; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function runProtectedRequest({ remoteAddress, headers }) {
  const request = createRequest({ remoteAddress, headers });
  const response = createResponse();
  let nextCalled = false;
  verifyProtectedRequest(request, response, () => { nextCalled = true; });
  return { request, response, nextCalled };
}

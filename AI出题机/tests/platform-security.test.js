const assert = require('node:assert/strict');
const test = require('node:test');
const {
  issueSecurityBootstrap,
  verifyProtectedRequest,
  consumeTrialCredit
} = require('../server/middleware/security');

const originalPlatformMode = process.env.PLATFORM_MODE;
const originalInternalToken = process.env.PLATFORM_INTERNAL_TOKEN;

test.after(() => {
  setEnvironment(originalPlatformMode, originalInternalToken);
});

test('平台代理请求必须同时满足回环地址、内部令牌和用户身份', () => {
  setEnvironment('1', 'platform-test-token-1234567890');

  const valid = runProtectedRequest({
    remoteAddress: '127.0.0.1',
    headers: {
      'x-platform-internal-token': 'platform-test-token-1234567890',
      'x-platform-user-id': 'user-1',
      'x-platform-user-points': '19'
    }
  });
  assert.equal(valid.nextCalled, true);
  assert.equal(valid.request.securitySession.platformManaged, true);
  assert.deepEqual(consumeTrialCredit(valid.request.securitySession), { allowed: true, remaining: 19 });

  for (const candidate of [
    { remoteAddress: '127.0.0.1', headers: { 'x-platform-user-id': 'user-1' } },
    { remoteAddress: '127.0.0.1', headers: { 'x-platform-internal-token': 'wrong', 'x-platform-user-id': 'user-1' } },
    { remoteAddress: '10.0.0.8', headers: { 'x-platform-internal-token': 'platform-test-token-1234567890', 'x-platform-user-id': 'user-1' } },
    { remoteAddress: '127.0.0.1', headers: { 'x-platform-internal-token': 'platform-test-token-1234567890' } }
  ]) {
    const result = runProtectedRequest(candidate);
    assert.equal(result.nextCalled, false);
    assert.equal(result.response.statusCode, 403);
    assert.equal(result.response.payload.code, 'SECURITY_TOKEN_INVALID');
  }
});

test('独立运行模式仍要求 cx_sid 与一次性请求令牌', () => {
  setEnvironment('0', 'platform-test-token-1234567890');
  const unauthenticated = runProtectedRequest({ remoteAddress: '127.0.0.1', headers: {} });
  assert.equal(unauthenticated.response.statusCode, 403);

  const bootstrapRequest = createRequest({ method: 'GET', remoteAddress: '127.0.0.1', headers: {} });
  const bootstrapResponse = createResponse();
  issueSecurityBootstrap(bootstrapRequest, bootstrapResponse);
  const cookie = bootstrapResponse.appendedHeaders['Set-Cookie'].split(';')[0];
  const authenticated = runProtectedRequest({
    remoteAddress: '127.0.0.1',
    headers: {
      cookie,
      'x-cx-request-token': bootstrapResponse.payload.requestToken
    }
  });
  assert.equal(authenticated.nextCalled, true);
  assert.equal(authenticated.request.securitySession.platformManaged, undefined);
});

function setEnvironment(platformMode, internalToken) {
  if (platformMode === undefined) delete process.env.PLATFORM_MODE;
  else process.env.PLATFORM_MODE = platformMode;
  if (internalToken === undefined) delete process.env.PLATFORM_INTERNAL_TOKEN;
  else process.env.PLATFORM_INTERNAL_TOKEN = internalToken;
}

function createRequest({ method = 'POST', remoteAddress, headers }) {
  return {
    method,
    headers: { ...headers },
    ip: remoteAddress,
    socket: { remoteAddress }
  };
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    appendedHeaders: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    append(name, value) {
      this.appendedHeaders[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function runProtectedRequest({ remoteAddress, headers }) {
  const request = createRequest({ remoteAddress, headers });
  const response = createResponse();
  let nextCalled = false;
  verifyProtectedRequest(request, response, () => {
    nextCalled = true;
  });
  return { request, response, nextCalled };
}

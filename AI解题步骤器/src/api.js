export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('服务返回的数据格式异常，请稍后重试。', 'INVALID_RESPONSE', response.status);
  }
  if (!response.ok) {
    throw new ApiError(
      payload.error || '请求失败，请稍后重试。',
      payload.code || 'REQUEST_FAILED',
      response.status,
    );
  }
  return payload;
}

function adminHeaders(password) {
  return {
    'content-type': 'application/json',
    ...(password ? { 'x-admin-password': password } : {}),
  };
}

export const api = {
  getConfigStatus: () => request('/api/config/status'),
  getConfig: (password) => request('/api/config', { headers: adminHeaders(password) }),
  saveConfig: (password, config) => request('/api/config', {
    method: 'PUT',
    headers: adminHeaders(password),
    body: JSON.stringify(config),
  }),
  testConfig: (password, config) => request('/api/config/test', {
    method: 'POST',
    headers: adminHeaders(password),
    body: JSON.stringify(config),
  }),
  analyze: ({ subject, grade, file }) => {
    const formData = new FormData();
    formData.append('subject', subject);
    formData.append('grade', grade);
    formData.append('file', file);
    return request('/api/analyze', { method: 'POST', body: formData });
  },
  getSession: (sessionId) => request(`/api/sessions/${sessionId}`),
};

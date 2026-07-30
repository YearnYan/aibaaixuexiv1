import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import mammoth from 'mammoth';

const APP_STATE_KEY = 'app-state';
const AI_CONFIG_KEY = 'ai-config';
const GENERATED_PREFIX = 'generated:';
const GENERATION_CANCEL_PREFIX = 'generation-cancel:';
const SESSION_COOKIE_NAME = 'k12_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;
const MAX_GENERATION_COUNT = 120;
const BATCH_ITEM_MAX_CHARS = 600;
const RULE_CONTENT_INVENTORY_MAX_ITEMS = 120;
const RULE_COVERAGE_CHECKLIST_MAX_ITEMS = 80;
const RULE_RISK_NOTES_MAX_ITEMS = 30;
const KNOWLEDGE_BLUEPRINT_MAX_ANCHORS = 120;
const KNOWLEDGE_BLUEPRINT_MAX_SOURCE_SUMMARIES = 40;
const KNOWLEDGE_BLUEPRINT_MAX_UNCERTAINTY_NOTES = 40;
const KNOWLEDGE_ANCHOR_TEXT_MAX_CHARS = 420;
const KNOWLEDGE_ANCHOR_MUST_INCLUDE_MAX_CHARS = 180;
const KNOWLEDGE_FILE_TEXT_MAX_CHARS = 4200;
const KNOWLEDGE_TOTAL_TEXT_MAX_CHARS = 18000;
const RULE_KNOWLEDGE_FILE_TEXT_MAX_CHARS = 12000;
const RULE_KNOWLEDGE_TOTAL_TEXT_MAX_CHARS = 60000;
const DEFAULT_CONTENT_UNITS_PER_TEXT_CHARS = 700;
const DEFAULT_IMAGE_QUALITY = 'high';
const IMAGE_CONCURRENCY = 2;
const FIXED_LAYOUT_IMAGE_CONCURRENCY = 3;
const IMAGE_MAX_ATTEMPTS = 1;
const IMAGE_REFERENCE_MAX_ATTEMPTS = 1;
const IMAGE_RETRY_DELAY_MS = 1200;
const IMAGE_TIMEOUT_MS = 900000;
const IMAGE_REFERENCE_TIMEOUT_MS = 900000;
const IMAGE_SSE_EVENT_MAX_CHARS = 32 * 1024 * 1024;
const GENERATED_IMAGE_FETCH_TIMEOUT_MS = 60000;
const TEXT_MAX_ATTEMPTS = 2;
const TEXT_RETRY_DELAY_MS = 1000;
const STREAM_HEARTBEAT_MS = 15000;
const GENERATION_CANCEL_TTL_SECONDS = 3600;
const ORPHAN_GENERATION_BATCH_MS = 60 * 60 * 1000;
const DIRECT_REFERENCE_IMAGE_EDIT_ENABLED = false;
const AI_CONFIG_VERSION = 1;
const APP_STATE_VERSION = 1;
const REDEEM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const IMAGE_RESOLUTION_MODES = new Set(['standard', '4k']);
const GPT_IMAGE_2_MAX_EDGE = 3840;
const GPT_IMAGE_2_MIN_PIXELS = 655360;
const GPT_IMAGE_2_MAX_PIXELS = 8294400;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_FILE_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);
const WORD_DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ALLOWED_KNOWLEDGE_MIME_TYPES = new Set([
  ...ALLOWED_IMAGE_MIME_TYPES,
  'application/pdf',
  'application/msword',
  WORD_DOCX_MIME_TYPE,
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
]);
const KNOWLEDGE_MIME_BY_EXTENSION = new Map([
  ['.pdf', 'application/pdf'],
  ['.doc', 'application/msword'],
  ['.docx', WORD_DOCX_MIME_TYPE],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.csv', 'text/csv'],
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.json', 'application/json'],
]);
const ASPECT_RATIO_SIZES = new Map([
  ['16:9', '3840x2160'],
  ['9:16', '2160x3840'],
  ['4:3', '3264x2448'],
  ['3:4', '2448x3264'],
  ['1:1', '2880x2880'],
  ['1:1.4142', '2240x3168'],
]);

let envRef = null;
let appState = createEmptyAppState();
let aiConfig = createEmptyAiConfig();
let appStateOperationTail = Promise.resolve();
const activeGenerationBatchIds = new Set();
const canceledGenerationBatchIds = new Set();
const aiRouteState = {
  rule: { providerCursor: 0, keyCursors: new Map() },
  image: { providerCursor: 0, keyCursors: new Map() },
};

export default {
  async fetch(request, env, executionContext) {
    const requestReceivedAt = Date.now();
    envRef = env;
    const url = new URL(request.url);
    const canUseLoadedStateForCancellation =
      request.method.toUpperCase() === 'POST' &&
      url.pathname === '/api/generate/cancel' &&
      Boolean(getRequestUser(request));
    if (!canUseLoadedStateForCancellation) {
      await loadRuntimeState(env);
    }

    try {
      if (url.pathname.startsWith('/api/')) {
        return await routeApi(request, url, executionContext, { requestReceivedAt });
      }
      if (url.pathname.startsWith('/generated/')) {
        return await serveGeneratedImage(url);
      }
      return await env.ASSETS.fetch(request);
    } catch (error) {
      return jsonResponse(500, {
        ok: false,
        message: formatErrorMessage(error) || '服务端处理失败，请稍后重试',
      });
    }
  },
};

async function routeApi(request, url, executionContext, requestContext = {}) {
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (pathname === '/api/health' && method === 'GET') {
    const status = getAiConfigStatus();
    return jsonResponse(200, {
      ok: true,
      configured: status.imageConfigured,
      ruleConfigured: status.ruleConfigured,
      imageResolution: status.imageResolution,
    });
  }

  if (pathname === '/api/auth/me' && method === 'GET') return handleMe(request);
  if (pathname === '/api/auth/register' && method === 'POST') return handleRegister(request);
  if (pathname === '/api/auth/login' && method === 'POST') return handleLogin(request);
  if (pathname === '/api/auth/logout' && method === 'POST') return handleLogout(request);
  if (pathname === '/api/points/redeem' && method === 'POST') return handleRedeemPoints(request);
  if (pathname === '/api/points/logs' && method === 'GET') return handleUserPointLogs(request);
  if (pathname === '/api/admin/points/overview' && method === 'GET') return handleAdminPointsOverview(request);
  if (pathname === '/api/admin/points/adjust' && method === 'POST') return handleAdminAdjustPoints(request);
  if (pathname === '/api/admin/points/redeem-codes' && method === 'POST') {
    return handleAdminCreateRedeemCodes(request);
  }
  if (pathname === '/api/admin/ai-config' && method === 'GET') return handleGetAiConfig(request);
  if (pathname === '/api/admin/ai-config' && method === 'PUT') return handleSaveAiConfig(request);
  if (pathname === '/api/generation-rule' && method === 'POST') return handleGenerationRule(request);
  if (pathname === '/api/generate' && method === 'POST') return handleGenerate(request);
  if (pathname === '/api/generate/cancel' && method === 'POST') return handleCancelGeneration(request);
  if (pathname === '/api/generate/stream' && method === 'POST') {
    return handleGenerateStream(request, executionContext, requestContext);
  }

  return jsonResponse(404, { ok: false, message: '接口不存在' });
}

async function loadRuntimeState(env) {
  const storedConfigPromise = getKvJson(env, AI_CONFIG_KEY);
  await runAppStateOperation(async () => {
    await reloadAppStateWithinOperation(env);
    await recoverOrphanedGenerationBatches(Date.now(), env);
  });
  const storedConfig = await storedConfigPromise;
  const normalizedConfig = normalizeAiConfigForStorage(storedConfig, { tolerateInvalid: true });
  aiConfig = normalizedConfig.ok ? normalizedConfig.config : createEmptyAiConfig();
}

function runAppStateOperation(operation) {
  const scheduled = appStateOperationTail.then(operation, operation);
  appStateOperationTail = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

async function reloadAppStateWithinOperation(env) {
  appState = normalizeAppState(await getKvJson(env, APP_STATE_KEY));
}

function runFreshAppStateOperation(operation) {
  const env = envRef;
  return runAppStateOperation(async () => {
    await reloadAppStateWithinOperation(env);
    return operation(env);
  });
}

async function getKvJson(env, key) {
  const raw = await env.TLSJF_KV.get(key, 'text');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function persistAppStateWithinOperation(env) {
  trimOperationalHistory();
  const snapshot = JSON.stringify(appState);
  await env.TLSJF_KV.put(APP_STATE_KEY, snapshot);
}

async function saveAiConfig() {
  await envRef.TLSJF_KV.put(AI_CONFIG_KEY, JSON.stringify(aiConfig));
}

function createEmptyAppState() {
  return {
    version: APP_STATE_VERSION,
    users: [],
    sessions: [],
    redeemCodes: [],
    pointLogs: [],
    generationBatches: [],
  };
}

function normalizeAppState(raw) {
  const state = createEmptyAppState();
  if (!raw || typeof raw !== 'object') return state;
  state.users = Array.isArray(raw.users) ? raw.users.map(normalizeStoredUser).filter(Boolean) : [];
  state.sessions = Array.isArray(raw.sessions) ? raw.sessions.map(normalizeStoredSession).filter(Boolean) : [];
  state.redeemCodes = Array.isArray(raw.redeemCodes)
    ? raw.redeemCodes.map(normalizeStoredRedeemCode).filter(Boolean)
    : [];
  state.pointLogs = Array.isArray(raw.pointLogs) ? raw.pointLogs.map(normalizeStoredPointLog).filter(Boolean) : [];
  state.generationBatches = Array.isArray(raw.generationBatches)
    ? raw.generationBatches.map(normalizeStoredGenerationBatch).filter(Boolean)
    : [];
  return state;
}

function normalizeStoredUser(user) {
  if (!user || typeof user !== 'object') return null;
  const username = cleanUsername(user.username);
  if (!username || !user.passwordHash || !user.salt) return null;
  return {
    id: cleanText(user.id, 80) || randomUUID(),
    username,
    passwordHash: cleanText(user.passwordHash, 256),
    salt: cleanText(user.salt, 128),
    role: user.role === 'admin' ? 'admin' : 'user',
    points: Math.max(0, Math.floor(Number(user.points) || 0)),
    createdAt: cleanText(user.createdAt, 40) || new Date().toISOString(),
    updatedAt: cleanText(user.updatedAt, 40) || '',
  };
}

function normalizeStoredSession(session) {
  if (!session || typeof session !== 'object') return null;
  const token = cleanText(session.token, 160);
  const userId = cleanText(session.userId, 80);
  if (!token || !userId) return null;
  return {
    token,
    userId,
    expiresAt: cleanText(session.expiresAt, 40) || new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
}

function normalizeStoredRedeemCode(code) {
  if (!code || typeof code !== 'object') return null;
  const normalizedCode = formatRedeemCode(code.code);
  const points = Math.max(1, Math.floor(Number(code.points) || 0));
  if (!normalizedCode || !points) return null;
  return {
    id: cleanText(code.id, 80) || randomUUID(),
    code: normalizedCode,
    points,
    status: code.status === 'used' ? 'used' : 'unused',
    createdAt: cleanText(code.createdAt, 40) || new Date().toISOString(),
    usedAt: cleanText(code.usedAt, 40),
    usedBy: cleanText(code.usedBy, 80),
    createdBy: cleanText(code.createdBy, 80),
  };
}

function normalizeStoredPointLog(log) {
  if (!log || typeof log !== 'object') return null;
  const points = Math.trunc(Number(log.points) || 0);
  if (!points) return null;
  return {
    id: cleanText(log.id, 80) || randomUUID(),
    userId: cleanText(log.userId, 80),
    type: cleanText(log.type, 60),
    points,
    balanceAfter: Math.max(0, Math.floor(Number(log.balanceAfter) || 0)),
    batchId: cleanText(log.batchId, 80),
    imageIndex: Number.isInteger(Number(log.imageIndex)) ? Number(log.imageIndex) : null,
    status: cleanText(log.status, 40) || 'success',
    note: cleanText(log.note, 300),
    createdAt: cleanText(log.createdAt, 40) || new Date().toISOString(),
  };
}

function normalizeStoredGenerationBatch(batch) {
  if (!batch || typeof batch !== 'object') return null;
  const reservedPoints = Math.max(1, Math.floor(Number(batch.reservedPoints) || 0));
  const userId = cleanText(batch.userId, 80);
  if (!userId || !reservedPoints) return null;
  return {
    id: cleanText(batch.id, 80) || randomUUID(),
    userId,
    reservedPoints,
    successCount: Math.max(0, Math.floor(Number(batch.successCount) || 0)),
    failedCount: Math.max(0, Math.floor(Number(batch.failedCount) || 0)),
    refundedPoints: Math.max(0, Math.floor(Number(batch.refundedPoints) || 0)),
    imageIndexes: normalizeGenerationIndexList(batch.imageIndexes),
    successIndexes: normalizeGenerationIndexList(batch.successIndexes),
    failedIndexes: normalizeGenerationIndexList(batch.failedIndexes),
    refundedIndexes: normalizeGenerationIndexList(batch.refundedIndexes),
    status: cleanText(batch.status, 40) || 'running',
    type: cleanText(batch.type, 40) || 'batch',
    createdAt: cleanText(batch.createdAt, 40) || new Date().toISOString(),
    lastActivityAt: cleanText(batch.lastActivityAt, 40) || cleanText(batch.createdAt, 40) || new Date().toISOString(),
    finishedAt: cleanText(batch.finishedAt, 40),
    note: cleanText(batch.note, 300),
    lastError: cleanText(batch.lastError, 500),
  };
}

function normalizeGenerationIndexList(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item < MAX_GENERATION_COUNT)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

async function handleRegister(request) {
  const payload = await readJsonBody(request);
  const username = cleanUsername(payload.username);
  const password = String(payload.password || '');
  if (!isValidUsername(username)) {
    return jsonResponse(400, { ok: false, message: '账号需为 3-40 位，可使用中文、字母、数字、下划线、邮箱符号、点或横线' });
  }
  if (!isValidPassword(password)) {
    return jsonResponse(400, { ok: false, message: '密码需为 6-72 位' });
  }
  const { salt, passwordHash } = hashPassword(password);
  const registration = await runFreshAppStateOperation(async (env) => {
    if (findUserByUsername(username)) return null;
    const now = new Date().toISOString();
    const user = {
      id: randomUUID(),
      username,
      passwordHash,
      salt,
      role: appState.users.length === 0 ? 'admin' : 'user',
      points: 0,
      createdAt: now,
      updatedAt: now,
    };
    appState.users.push(user);
    const session = createSessionForUser(user);
    await persistAppStateWithinOperation(env);
    return {
      user: createPublicUser(user),
      setupAdminCreated: user.role === 'admin',
      sessionToken: session.token,
    };
  });
  if (!registration) {
    return jsonResponse(409, { ok: false, message: '该账号已存在，请直接登录' });
  }
  return jsonResponse(200, {
    ok: true,
    user: registration.user,
    setupAdminCreated: registration.setupAdminCreated,
  }, {
    'Set-Cookie': createSessionCookie(registration.sessionToken),
  });
}

async function handleLogin(request) {
  const payload = await readJsonBody(request);
  const username = cleanUsername(payload.username);
  const password = String(payload.password || '');
  const login = await runFreshAppStateOperation(async (env) => {
    const user = findUserByUsername(username);
    if (!user || !verifyPassword(password, user)) return null;
    const session = createSessionForUser(user);
    await persistAppStateWithinOperation(env);
    return { user: createPublicUser(user), sessionToken: session.token };
  });
  if (!login) {
    return jsonResponse(401, { ok: false, message: '账号或密码不正确' });
  }
  return jsonResponse(200, { ok: true, user: login.user }, {
    'Set-Cookie': createSessionCookie(login.sessionToken),
  });
}

async function handleLogout(request) {
  const token = parseCookies(request)[SESSION_COOKIE_NAME];
  if (token) {
    await runFreshAppStateOperation(async (env) => {
      const nextSessions = appState.sessions.filter((session) => session.token !== token);
      if (nextSessions.length === appState.sessions.length) return;
      appState.sessions = nextSessions;
      await persistAppStateWithinOperation(env);
    });
  }
  return jsonResponse(200, { ok: true }, {
    'Set-Cookie': createExpiredSessionCookie(),
  });
}

function handleMe(request) {
  const user = getRequestUser(request);
  return jsonResponse(200, {
    ok: true,
    authenticated: Boolean(user),
    setupRequired: appState.users.length === 0,
    user: createPublicUser(user),
  });
}

async function handleRedeemPoints(request) {
  const payload = await readJsonBody(request);
  const redemption = await runFreshAppStateOperation(async (env) => {
    const user = requireAuth(request);
    if (user.response) return { response: user.response };
    const code = findRedeemCode(payload.code);
    if (!code || code.status !== 'unused') return null;
    const now = new Date().toISOString();
    code.status = 'used';
    code.usedAt = now;
    code.usedBy = user.id;
    user.points += code.points;
    user.updatedAt = now;
    addPointLog({ user, type: 'redeem', points: code.points, note: `兑换卡密 ${code.code}` });
    await persistAppStateWithinOperation(env);
    return {
      points: user.points,
      redeemedPoints: code.points,
      user: createPublicUser(user),
    };
  });
  if (redemption?.response) return redemption.response;
  if (!redemption) {
    return jsonResponse(400, { ok: false, message: '卡密不存在或已被使用' });
  }
  return jsonResponse(200, {
    ok: true,
    ...redemption,
  });
}

function handleUserPointLogs(request) {
  const user = requireAuth(request);
  if (user.response) return user.response;
  const logs = appState.pointLogs.filter((log) => log.userId === user.id).slice(-120).reverse();
  return jsonResponse(200, { ok: true, logs });
}

function handleAdminPointsOverview(request) {
  const admin = requireAdmin(request);
  if (admin.response) return admin.response;
  const users = appState.users.map((user) => ({
    id: user.id,
    username: user.username,
    role: user.role,
    points: user.points,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }));
  const logs = appState.pointLogs.slice(-300).reverse().map((log) => ({
    ...log,
    username: appState.users.find((user) => user.id === log.userId)?.username || '未知用户',
  }));
  const batches = appState.generationBatches.slice(-200).reverse().map((batch) => ({
    ...batch,
    username: appState.users.find((user) => user.id === batch.userId)?.username || '未知用户',
  }));
  const redeemCodes = appState.redeemCodes.slice(-300).reverse().map((code) => ({
    ...code,
    usedByUsername: appState.users.find((user) => user.id === code.usedBy)?.username || '',
  }));
  return jsonResponse(200, {
    ok: true,
    admin: createPublicUser(admin),
    summary: {
      userCount: users.length,
      totalPoints: users.reduce((sum, user) => sum + user.points, 0),
      successfulImages: appState.generationBatches.reduce((sum, batch) => sum + batch.successCount, 0),
      refundedPoints: appState.generationBatches.reduce((sum, batch) => sum + batch.refundedPoints, 0),
      unusedRedeemCodes: appState.redeemCodes.filter((code) => code.status === 'unused').length,
    },
    users,
    logs,
    batches,
    redeemCodes,
  });
}

async function handleAdminAdjustPoints(request) {
  const payload = await readJsonBody(request);
  const mode = payload.mode === 'set' ? 'set' : 'add';
  const points = Math.trunc(Number(payload.points));
  if (!Number.isFinite(points)) return jsonResponse(400, { ok: false, message: '请填写有效积分数量' });
  const adjustment = await runFreshAppStateOperation(async (env) => {
    const admin = requireAdmin(request);
    if (admin.response) return { response: admin.response };
    const target = appState.users.find((user) => user.id === cleanText(payload.userId, 80)) || findUserByUsername(payload.username);
    if (!target) return { status: 404, message: '未找到用户账号' };
    const before = target.points;
    if (mode === 'set') {
      if (points < 0 || points > 1000000) {
        return { status: 400, message: '设置后的积分必须在 0 到 1000000 之间' };
      }
      target.points = points;
    } else {
      if (points === 0 || Math.abs(points) > 1000000 || before + points < 0) {
        return { status: 400, message: '增减积分无效，不能让用户积分小于 0' };
      }
      target.points += points;
    }
    target.updatedAt = new Date().toISOString();
    addPointLog({
      user: target,
      type: 'admin_adjust',
      points: target.points - before,
      note: cleanText(payload.note, 200) || `管理员 ${admin.username} 调整积分`,
    });
    await persistAppStateWithinOperation(env);
    return { user: createPublicUser(target) };
  });
  if (adjustment.response) return adjustment.response;
  if (adjustment.status) return jsonResponse(adjustment.status, { ok: false, message: adjustment.message });
  return jsonResponse(200, { ok: true, user: adjustment.user });
}

async function handleAdminCreateRedeemCodes(request) {
  const payload = await readJsonBody(request);
  const count = Math.trunc(Number(payload.count) || 1);
  const points = Math.trunc(Number(payload.points));
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    return jsonResponse(400, { ok: false, message: '单次生成卡密数量必须是 1 到 200' });
  }
  if (!Number.isInteger(points) || points < 1 || points > 100000) {
    return jsonResponse(400, { ok: false, message: '每张卡密积分必须是 1 到 100000' });
  }
  const creation = await runFreshAppStateOperation(async (env) => {
    const admin = requireAdmin(request);
    if (admin.response) return { response: admin.response };
    const now = new Date().toISOString();
    const created = [];
    for (let index = 0; index < count; index += 1) {
      let code = createRedeemCodeValue();
      while (findRedeemCode(code)) code = createRedeemCodeValue();
      const item = {
        id: randomUUID(),
        code,
        points,
        status: 'unused',
        createdAt: now,
        usedAt: '',
        usedBy: '',
        createdBy: admin.id,
      };
      appState.redeemCodes.push(item);
      created.push(item);
    }
    await persistAppStateWithinOperation(env);
    return { codes: created };
  });
  if (creation.response) return creation.response;
  return jsonResponse(200, { ok: true, codes: creation.codes });
}

function handleGetAiConfig(request) {
  const admin = requireAdmin(request);
  if (admin.response) return admin.response;
  return jsonResponse(200, { ok: true, config: createAdminConfigResponse() });
}

async function handleSaveAiConfig(request) {
  const admin = requireAdmin(request);
  if (admin.response) return admin.response;
  const payload = await readJsonBody(request);
  const normalized = normalizeAiConfigForStorage(payload);
  if (!normalized.ok) return jsonResponse(400, { ok: false, message: normalized.message });
  aiConfig = normalized.config;
  resetAiRouteState();
  await saveAiConfig();
  return jsonResponse(200, { ok: true, config: createAdminConfigResponse() });
}

async function handleGenerationRule(request) {
  const user = requireAuth(request);
  if (user.response) return user.response;
  const payload = await readJsonBody(request);
  const validated = validateGenerationRulePayload(payload);
  if (!validated.ok) return jsonResponse(400, { ok: false, message: validated.message });
  if (!isAiChannelConfigured('rule')) {
    return jsonResponse(500, { ok: false, message: '未配置生成规则确认接口，请联系管理员填写 URL、MODEL 和 APIKEY。' });
  }
  await attachKnowledgeContext(validated.data, {
    fileTextMaxChars: RULE_KNOWLEDGE_FILE_TEXT_MAX_CHARS,
    totalTextMaxChars: RULE_KNOWLEDGE_TOTAL_TEXT_MAX_CHARS,
  });
  await ensureKnowledgeBlueprint(validated.data);
  try {
    const rule = await generateGenerationRule(validated.data);
    return jsonResponse(200, {
      ok: true,
      rule,
      count: rule.count,
      batchItems: rule.batchItems,
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, message: formatErrorMessage(error) });
  }
}

async function handleGenerate(request) {
  const payload = await readJsonBody(request);
  const response = await runGenerationRequest(request, payload, null);
  return jsonResponse(response.status, response.body);
}

async function handleCancelGeneration(request) {
  let user = requireAuth(request);
  if (user.response) return user.response;

  const payload = await readJsonBody(request);
  const batchId = normalizeGenerationBatchId(payload.batchId);
  if (!batchId) {
    return jsonResponse(400, { ok: false, message: '生成批次标识无效' });
  }
  let batch = findGenerationBatch(batchId);
  const isCancelableBatch = (candidate) => Boolean(
    candidate &&
    candidate.userId === user.id &&
    (candidate.status === 'running' || activeGenerationBatchIds.has(candidate.id))
  );
  if (!isCancelableBatch(batch)) {
    await loadRuntimeState(envRef);
    user = requireAuth(request);
    if (user.response) return user.response;
    batch = findGenerationBatch(batchId);
  }
  if (!batch) {
    await markGenerationBatchCanceled(batchId);
    return jsonResponse(202, {
      ok: true,
      pending: true,
      points: null,
      summary: null,
    });
  }
  if (!isCancelableBatch(batch)) {
    return jsonResponse(404, { ok: false, message: '未找到可取消的生成任务' });
  }

  await markGenerationBatchCanceled(batch.id);
  const cancellation = await cancelGenerationBatch(user.id, batchId);
  if (!cancellation.found) {
    return jsonResponse(404, { ok: false, message: '未找到可取消的生成任务' });
  }

  const points = cancellation.points;
  return jsonResponse(200, {
    ok: true,
    points,
    summary: points
      ? {
          success: points.success,
          failed: points.failed,
          points,
        }
      : null,
  });
}

async function cancelGenerationBatch(userId, batchId) {
  const env = envRef;
  return runAppStateOperation(async () => {
    await reloadAppStateWithinOperation(env);
    const activeUser = appState.users.find((item) => item.id === userId);
    const batch = findGenerationBatch(batchId);
    if (!activeUser || !batch || batch.userId !== activeUser.id) {
      return { found: false, points: null };
    }

    const points = await settleGenerationPointsWithinOperation(batch.id, [], {
      status: 'canceled',
      note: '用户关闭或刷新页面，未成功生成的图片已按单张退回积分',
    }, env);
    return { found: true, points };
  });
}

async function handleGenerateStream(request, executionContext, requestContext = {}) {
  const payload = await readJsonBody(request);
  const bodyParsedAt = Date.now();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let writeQueue = Promise.resolve();
  const writeEvent = async (event, shouldWrite = null) => {
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        if (typeof shouldWrite === 'function' && !(await shouldWrite())) return false;
        await writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
        return true;
      });
    return writeQueue;
  };

  const task = (async () => {
    let terminalBatchId = normalizeGenerationBatchId(payload.clientBatchId);
    const heartbeat = setInterval(() => {
      void writeEvent({ type: 'heartbeat', at: new Date().toISOString() }).catch(() => {});
    }, STREAM_HEARTBEAT_MS);

    try {
      const response = await runGenerationRequest(request, payload, writeEvent, {
        ...requestContext,
        bodyParsedAt,
      });
      const responseBatchId = cleanText(response.body.summary?.points?.batchId, 80);
      terminalBatchId = responseBatchId;
      const canceled = responseBatchId
        ? await isGenerationBatchCanceled(responseBatchId)
        : false;
      if (response.status >= 400 || canceled) {
        await writeEvent({
          type: 'error',
          message: canceled
            ? '生成任务已取消，未完成图片已退回积分'
            : response.body.message || '生成失败',
          points: response.body.points || response.body.summary?.points || null,
          summary: response.body.summary || undefined,
        });
      } else {
        const doneWritten = await writeEvent(
          { type: 'done', summary: response.body.summary },
          async () => !(await isGenerationBatchCanceled(responseBatchId)),
        );
        if (doneWritten === false) {
          await writeEvent({
            type: 'error',
            message: '生成任务已取消，未完成图片已退回积分',
            points: response.body.summary?.points || null,
            summary: response.body.summary || undefined,
          });
        }
      }
    } catch (error) {
      await writeEvent({ type: 'error', message: formatErrorMessage(error) });
    } finally {
      clearInterval(heartbeat);
      await writeQueue.catch(() => {});
      await writer.close().catch(() => {});
      if (terminalBatchId) canceledGenerationBatchIds.delete(terminalBatchId);
    }
  })();
  executionContext?.waitUntil(task.catch(() => {}));

  return new Response(stream.readable, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function runGenerationRequest(request, payload, onEvent, requestContext = {}) {
  const user = requireAuth(request);
  if (user.response) return { status: user.response.status, body: await user.response.json() };
  const validated = validateGeneratePayload(payload);
  if (!validated.ok) return { status: 400, body: { ok: false, message: validated.message } };
  if (!isAiChannelConfigured('image')) {
    return { status: 500, body: { ok: false, message: '未配置 AI 生图接口，请联系管理员填写 URL、MODEL 和 APIKEY。' } };
  }

  validated.data.batchId = validated.data.clientBatchId || randomUUID();
  const chargeCount = getGenerationChargeCount(validated.data);
  try {
    await assertGenerationBatchActive(validated.data);
    ensureSufficientPoints(user, chargeCount);
  } catch (error) {
    return { status: error.statusCode || 500, body: { ok: false, message: formatErrorMessage(error) } };
  }
  try {
    await attachKnowledgeContext(validated.data);
    attachRuleKnowledgeBlueprint(validated.data);
    await ensureGroundedGenerationRule(validated.data);
  } catch (error) {
    return { status: error.statusCode || 500, body: { ok: false, message: formatErrorMessage(error) } };
  }

  let batch = null;
  const streamedResults = [];
  try {
    const reservation = await reserveGenerationPoints(user.id, validated.data);
    batch = reservation.batch;
    activeGenerationBatchIds.add(batch.id);
    prepareReferenceStylePrompt(validated.data);
    const modelDispatchReadyAt = Date.now();
    if (onEvent) {
      await onEvent({
        type: 'start',
        count: validated.data.count,
        points: {
          batchId: batch.id,
          reserved: batch.reservedPoints,
          balance: reservation.balance,
        },
        timing: {
          requestReceivedAt: new Date(requestContext.requestReceivedAt || modelDispatchReadyAt).toISOString(),
          bodyParsedAt: new Date(requestContext.bodyParsedAt || modelDispatchReadyAt).toISOString(),
          modelDispatchReadyAt: new Date(modelDispatchReadyAt).toISOString(),
          preflightMs: Math.max(0, modelDispatchReadyAt - Number(requestContext.requestReceivedAt || modelDispatchReadyAt)),
        },
      });
    }
    const handleGenerationEvent = async (event) => {
      const canEmitGenerationEvent = () => {
        if (canceledGenerationBatchIds.has(batch.id)) return false;
        const activeBatch = findGenerationBatch(batch.id);
        return Boolean(activeBatch && activeBatch.status === 'running');
      };
      if (!canEmitGenerationEvent()) return false;
      if (event?.type === 'result' && event.result) {
        const points = await recordGenerationImageResult(batch, event.result);
        if (await isGenerationBatchCanceled(batch.id)) {
          return false;
        }
        const activeBatch = findGenerationBatch(batch.id);
        if (!activeBatch || activeBatch.status !== 'running') return false;
        streamedResults[event.result.index] = event.result;
        if (points) event.points = points;
      }
      if (!onEvent) return false;
      try {
        const delivered = await onEvent(event, canEmitGenerationEvent);
        return delivered !== false;
      } catch {
        return false;
      }
    };
    const results =
      validated.data.targetIndex === null
        ? await generateBatch(validated.data, handleGenerationEvent)
        : [await generateSingleResult(validated.data, handleGenerationEvent)];
    const success = results.filter((item) => item.status === 'ok').length;
    const points = await settleGenerationPoints(batch, results, { status: 'done' });
    return {
      status: 200,
      body: {
        ok: true,
        results,
        summary: {
          success: points?.success ?? success,
          failed: points?.failed ?? results.length - success,
          points,
        },
      },
    };
  } catch (error) {
    let points = null;
    if (batch) {
      points = await settleGenerationPoints(batch, streamedResults, {
        status: 'failed',
        note: formatErrorMessage(error),
      });
    }
    return {
      status: error.statusCode || 500,
      body: {
        ok: false,
        message: formatErrorMessage(error),
        points,
        summary: points
          ? {
              success: points.success,
              failed: points.failed,
              points,
            }
          : undefined,
      },
    };
  } finally {
    if (batch) activeGenerationBatchIds.delete(batch.id);
  }
}

async function generateBatch(data, onEvent = null) {
  const jobs = Array.from({ length: data.count }, (_, index) => index);
  const concurrency = data.options.layoutFixed ? FIXED_LAYOUT_IMAGE_CONCURRENCY : IMAGE_CONCURRENCY;
  const results = new Array(jobs.length);
  const completionTasks = [];
  const completionSlots = createConcurrencySemaphore(concurrency);
  const persistenceSlots = createConcurrencySemaphore(concurrency);
  let schedulingError = null;

  try {
    await mapWithConcurrency(jobs, concurrency, async (index) => {
      await assertGenerationBatchActive(data);
      const artifact = await acquireSingleImageArtifact(data, index);

      // 完成槽限制慢客户端、积分写等下游积压，避免无限堆积已生成但未保存的图片。
      const releaseCompletionSlot = await completionSlots.acquire();
      try {
        await assertGenerationBatchActive(data);
      } catch (error) {
        releaseCompletionSlot();
        throw error;
      }

      let releasePersistenceSlot = null;
      if (!artifact.error) {
        // 每个模型槽最多额外积压一份产物，持久化槽只覆盖图片保存本身。
        releasePersistenceSlot = await persistenceSlots.acquire();
        try {
          await assertGenerationBatchActive(data);
        } catch (error) {
          releasePersistenceSlot();
          releaseCompletionSlot();
          throw error;
        }
      }
      const completionTask = Promise.resolve()
        .then(async () => {
          const result = await finalizeSingleImageArtifact(artifact, data, {
            releasePersistenceSlot,
          });
          results[index] = result;
          if (onEvent) await onEvent({ type: 'result', result });
          return result;
        })
        .finally(releaseCompletionSlot);
      completionTasks.push(completionTask);
      void completionTask.catch(() => {});
    });
  } catch (error) {
    schedulingError = error;
  }

  const completionOutcomes = await Promise.allSettled(completionTasks);
  if (schedulingError) throw schedulingError;
  const completionFailure = completionOutcomes.find((outcome) => outcome.status === 'rejected');
  if (completionFailure) throw completionFailure.reason;
  return results;
}

async function recoverOrphanedGenerationBatches(now = Date.now(), env = envRef) {
  let changed = false;
  for (const batch of appState.generationBatches) {
    if (batch.status !== 'running') continue;
    const lastActivityAt = Date.parse(batch.lastActivityAt || batch.createdAt);
    if (!Number.isFinite(lastActivityAt) || now - lastActivityAt < ORPHAN_GENERATION_BATCH_MS) continue;

    ensureGenerationBatchIndexState(batch);
    const user = appState.users.find((item) => item.id === batch.userId);
    const finishedAt = new Date(now).toISOString();
    if (user) {
      for (const imageIndex of batch.imageIndexes) {
        if (!batch.successIndexes.includes(imageIndex)) {
          addGenerationIndex(batch.failedIndexes, imageIndex);
          refundGenerationImageIndex(user, batch, imageIndex, finishedAt);
        }
      }
    }
    batch.successCount = batch.successIndexes.length;
    batch.failedCount = batch.imageIndexes.length - batch.successCount;
    batch.refundedPoints = batch.refundedIndexes.length;
    batch.status = 'failed';
    batch.finishedAt = finishedAt;
    batch.note = '生成任务超过 60 分钟未完成，系统已自动结束并退回未成功图片积分';
    batch.lastError = batch.note;
    changed = true;
  }
  if (changed) await persistAppStateWithinOperation(env);
}

async function generateSingleResult(data, onEvent = null) {
  const index = data.targetIndex;
  await assertGenerationBatchActive(data);
  const result = await generateSingleIndex(data, index, onEvent);
  if (onEvent) await onEvent({ type: 'result', result });
  return result;
}

async function generateSingleIndex(data, index, onEvent = null) {
  const artifact = await acquireSingleImageArtifact(data, index);
  await assertGenerationBatchActive(data);
  return finalizeSingleImageArtifact(artifact, data);
}

async function acquireSingleImageArtifact(data, index) {
  const id = randomUUID();
  const startedAt = Date.now();
  try {
    const imageSource = await generateOneImage(data, index);
    const modelCompletedAt = Date.now();
    return {
      id,
      index,
      item: data.batchItems[index] || '',
      imageSource,
      startedAt,
      modelCompletedAt,
    };
  } catch (error) {
    return {
      id,
      index,
      item: data.batchItems[index] || '',
      error,
      startedAt,
      modelCompletedAt: Date.now(),
    };
  }
}

async function finalizeSingleImageArtifact(artifact, data, options = {}) {
  const modelTiming = {
    modelStartedAt: new Date(artifact.startedAt).toISOString(),
    modelCompletedAt: new Date(artifact.modelCompletedAt).toISOString(),
    modelDurationMs: Math.max(0, artifact.modelCompletedAt - artifact.startedAt),
  };
  if (artifact.error) {
    return {
      id: artifact.id,
      index: artifact.index,
      status: 'error',
      item: artifact.item,
      error: formatImageFailure(artifact.error, artifact.modelCompletedAt - artifact.startedAt),
      timing: modelTiming,
    };
  }

  const persistenceStartedAt = Date.now();
  let persistenceOutcome;
  try {
    const image = await saveGeneratedImage(artifact.imageSource, data, artifact.index);
    persistenceOutcome = {
      status: 'fulfilled',
      value: { image, persistedAt: Date.now() },
    };
  } catch (reason) {
    persistenceOutcome = { status: 'rejected', reason };
  } finally {
    options.releasePersistenceSlot?.();
  }
  if (persistenceOutcome.status === 'fulfilled') {
    const { image, persistedAt } = persistenceOutcome.value;
    return {
      id: artifact.id,
      index: artifact.index,
      status: 'ok',
      item: artifact.item,
      image,
      storedImage: image,
      saving: false,
      timing: {
        ...modelTiming,
        persistenceStartedAt: new Date(persistenceStartedAt).toISOString(),
        persistedAt: new Date(persistedAt).toISOString(),
        persistenceDurationMs: Math.max(0, persistedAt - persistenceStartedAt),
        totalDurationMs: Math.max(0, persistedAt - artifact.startedAt),
      },
    };
  }

  const failedAt = Date.now();
  return {
    id: artifact.id,
    index: artifact.index,
    status: 'error',
    item: artifact.item,
    error: formatImagePersistenceFailure(persistenceOutcome.reason, failedAt - artifact.startedAt),
    persistenceFailed: true,
    failureStage: 'image_persistence',
    timing: {
      ...modelTiming,
      persistenceStartedAt: new Date(persistenceStartedAt).toISOString(),
      persistenceFailedAt: new Date(failedAt).toISOString(),
      persistenceDurationMs: Math.max(0, failedAt - persistenceStartedAt),
      totalDurationMs: Math.max(0, failedAt - artifact.startedAt),
    },
  };
}

async function generateOneImage(data, index) {
  const prompt = composeTeachingAidPrompt(data, index);
  const referenceImages = selectGenerationReferenceImages(data);
  if (!hasStyleReference(data)) {
    return requestImageGeneration(prompt, data);
  }

  if (!DIRECT_REFERENCE_IMAGE_EDIT_ENABLED || referenceImages.length === 0) {
    const fallbackPrompt = composeReferenceStylePrompt(prompt, data.referenceStyleDescription);
    return requestImageGeneration(fallbackPrompt, data);
  }

  return requestImageWithReferences(prompt, data, referenceImages);
}

function selectGenerationReferenceImages(data) {
  return data.styleReferenceImages || [];
}

function hasStyleReference(data) {
  return Boolean(data?.styleReferenceProvided || data?.styleReferenceImages?.length);
}

function prepareReferenceStylePrompt(data) {
  const referenceImages = data.styleReferenceImages || [];
  if (!hasStyleReference(data) || data.referenceStyleDescription) return;
  const rule = data.generationRule || {};
  data.referenceStyleDescription = cleanText(
    [
      rule.layoutLogic ? `版式组织：${rule.layoutLogic}` : '',
      rule.styleLogic ? `参考图复刻：${rule.styleLogic}` : '',
      rule.styleAdvice ? `视觉建议：${rule.styleAdvice}` : '',
    ].filter(Boolean).join('\n'),
    1800,
  ) || '严格按照当次参考图复刻页面比例、栏目结构、配色、标题层级、边框、留白密度和整体视觉气质。';
}

function composeReferenceStylePrompt(originalPrompt, styleDescription) {
  return [
    originalPrompt,
    styleDescription
      ? [
          '参考图视觉描述：',
          styleDescription,
          '必须依据以上参考图视觉描述复刻版式、配色、标题层级、栏目关系、边框样式、留白密度和整体视觉气质；不要生成与参考图无关的新模板。',
        ].join('\n')
      : '必须尽量保持上传参考图的教辅版式气质：清晰、规整、适合打印，栏目层级明确，文字可读。',
  ].filter(Boolean).join('\n\n');
}

async function requestImageGeneration(prompt, data) {
  const size = resolveImageRequestSize(data);
  return requestImageGenerationWithSize(prompt, data, size);
}

async function requestImageGenerationWithSize(prompt, data, size) {
  return requestImageApiWithTimeout(
    '/images/generations',
    (route) => ({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: route.model,
        prompt,
        size,
        quality: data.quality,
        n: 1,
        output_format: 'png',
        stream: true,
        partial_images: 1,
      }),
    }),
    {
      maxAttempts: IMAGE_MAX_ATTEMPTS,
    },
  );
}

async function requestImageWithReferences(prompt, data, referenceImages = []) {
  return requestImageApiWithTimeout(
    '/images/edits',
    (route) => {
      const fields = [
        ['model', route.model],
        ['prompt', prompt],
        ['size', resolveReferenceImageRequestSize(data)],
        ['quality', data.quality],
        ['n', '1'],
        ['output_format', 'png'],
      ];
      const files = referenceImages.map((image, index) => {
        const { buffer, mimeType } = dataUrlToBuffer(image.dataUrl, image.mimeType);
        return {
          name: 'image',
          filename: createReferenceUploadFileName(`reference-${String(index + 1).padStart(2, '0')}`, mimeType),
          mimeType,
          data: new Uint8Array(buffer),
        };
      });
      const multipart = createMultipartBody(fields, files);
      return {
        body: multipart.body,
        headers: {
          'Content-Type': multipart.contentType,
        },
      };
    },
    {
      maxAttempts: IMAGE_REFERENCE_MAX_ATTEMPTS,
    },
  );
}

function resolveReferenceImageRequestSize(data) {
  if (getEffectiveImageResolutionMode() !== '4k') return data.size || '1024x1536';
  return 'auto';
}

function createMultipartBody(fields, files) {
  const boundary = `----tlsjf-${randomUUID().replace(/-/gu, '')}`;
  const encoder = new TextEncoder();
  const chunks = [];
  const pushText = (value) => {
    chunks.push(encoder.encode(value));
  };

  for (const [name, value] of fields) {
    pushText(`--${boundary}\r\n`);
    pushText(`Content-Disposition: form-data; name="${escapeMultipartHeaderValue(name)}"\r\n\r\n`);
    pushText(`${String(value ?? '')}\r\n`);
  }

  for (const file of files) {
    pushText(`--${boundary}\r\n`);
    pushText(
      [
        `Content-Disposition: form-data; name="${escapeMultipartHeaderValue(file.name)}"; filename="${escapeMultipartHeaderValue(file.filename)}"`,
        `Content-Type: ${file.mimeType}`,
      ].join('\r\n'),
    );
    pushText('\r\n\r\n');
    chunks.push(file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data));
    pushText('\r\n');
  }

  pushText(`--${boundary}--\r\n`);
  return {
    body: concatUint8Arrays(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function escapeMultipartHeaderValue(value) {
  return String(value || '')
    .replace(/\\/gu, '\\\\')
    .replace(/"/gu, '\\"')
    .replace(/[\r\n]/gu, '_');
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function requestImageApiWithTimeout(endpoint, createRequest, options = {}) {
  const maxAttempts = resolveAiAttemptLimit('image', options.maxAttempts || 1);
  const timeoutMs = options.timeoutMs || (endpoint === '/images/edits' ? IMAGE_REFERENCE_TIMEOUT_MS : IMAGE_TIMEOUT_MS);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const route = nextAiRoute('image');
    const originalRequest = createRequest(route);
    const request = options.streamingDisabled ? disableImageStreamingRequest(originalRequest) : originalRequest;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let payload;

    try {
      response = await fetch(`${route.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${route.apiKey}`,
          ...request.headers,
        },
        body: request.body,
        signal: controller.signal,
      });
      payload = response.ok && isEventStreamResponse(response)
        ? await parseImageEventStream(response)
        : await parseApiResponse(response);
      if (response.ok) return extractRetryableImage(payload);
    } catch (error) {
      lastError = withImageRequestDiagnostics(normalizeImageRequestError(error, endpoint), {
        endpoint,
        attempt,
        maxAttempts,
        routeLabel: route.label,
        statusCode: response?.status,
      });
      if (!isRetryableFetchError(error) || attempt === maxAttempts) throw lastError;
      await delay(IMAGE_RETRY_DELAY_MS * attempt * attempt);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (
      endpoint === '/images/generations' &&
      !options.streamingDisabled &&
      isUnsupportedImageStreamingResponse(response, payload)
    ) {
      return requestImageApiWithTimeout(endpoint, createRequest, {
        ...options,
        streamingDisabled: true,
      });
    }

    lastError = withImageRequestDiagnostics(
      createApiError(response, payload, `图片生成接口（${route.label}）`),
      {
        endpoint,
        attempt,
        maxAttempts,
        routeLabel: route.label,
        statusCode: response.status,
      },
    );
    if (!isRetryableStatus(response.status) || attempt === maxAttempts) throw lastError;
    await delay(IMAGE_RETRY_DELAY_MS * attempt * attempt);
  }

  throw lastError || new Error('AI 生图接口请求失败');
}

function isEventStreamResponse(response) {
  return (response.headers.get('content-type') || '').toLowerCase().includes('text/event-stream');
}

async function parseImageEventStream(response) {
  if (!response.body) throw new Error('上游流式生图响应缺少消息体');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineParts = [];
  let lineChars = 0;
  let eventName = '';
  let dataLines = [];
  let eventChars = 0;
  let latestFallbackPayload = null;

  const consumeEvent = async () => {
    const data = (dataLines.length === 1 ? dataLines[0] : dataLines.join('\n')).trim();
    const currentEventName = eventName;
    eventName = '';
    dataLines = [];
    eventChars = 0;
    if (!data) return null;
    if (data === '[DONE]') return latestFallbackPayload;

    const payload = JSON.parse(data);
    const eventType = payload?.type || currentEventName;
    if (payload?.error || eventType === 'error') {
      const message = payload?.error?.message || payload?.message || '上游流式生图失败';
      const streamError = new Error(message);
      streamError.retryable = true;
      streamError.imageStreamingUnsupported = isUnsupportedImageStreamingMessage(message);
      throw streamError;
    }
    if (eventType === 'image_generation.partial_image') {
      extractRetryableImage(payload);
      latestFallbackPayload = payload;
      return null;
    }
    if (eventType === 'image_generation.completed') {
      extractRetryableImage(payload);
      return payload;
    }

    const genericImage = findImageInPayload(payload);
    if (!genericImage) return null;
    const isUntypedImageEvent = !payload?.type && (!currentEventName || currentEventName === 'message');
    if (isUntypedImageEvent) {
      latestFallbackPayload = payload;
      return null;
    }
    if (/partial|progress/i.test(String(eventType || ''))) {
      latestFallbackPayload = payload;
      return null;
    }
    return payload;
  };

  const consumeLine = async (line) => {
    const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!normalizedLine) return consumeEvent();
    if (normalizedLine.startsWith('event:')) {
      eventName = normalizedLine.slice(6).trim();
      return null;
    }
    if (!normalizedLine.startsWith('data:')) return null;
    const data = normalizedLine.slice(5).trimStart();
    eventChars += data.length;
    if (eventChars > IMAGE_SSE_EVENT_MAX_CHARS) {
      const error = new Error('上游流式生图事件过大，已停止读取以保护服务内存');
      error.retryable = true;
      throw error;
    }
    dataLines.push(data);
    return null;
  };

  const appendLinePart = (part) => {
    if (!part) return;
    lineParts.push(part);
    lineChars += part.length;
    if (lineChars > IMAGE_SSE_EVENT_MAX_CHARS) {
      const error = new Error('上游流式生图事件行过大，已停止读取以保护服务内存');
      error.retryable = true;
      throw error;
    }
  };

  const consumeChunk = async (chunk) => {
    let offset = 0;
    while (offset < chunk.length) {
      const newlineIndex = chunk.indexOf('\n', offset);
      if (newlineIndex < 0) {
        appendLinePart(chunk.slice(offset));
        return null;
      }

      appendLinePart(chunk.slice(offset, newlineIndex));
      const line = lineParts.length === 1 ? lineParts[0] : lineParts.join('');
      lineParts = [];
      lineChars = 0;
      offset = newlineIndex + 1;
      const finalPayload = await consumeLine(line);
      if (finalPayload) return finalPayload;
    }
    return null;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const finalPayload = await consumeChunk(decoder.decode(value, { stream: true }));
      if (finalPayload) return finalPayload;
    }
    const decodedTail = decoder.decode();
    if (decodedTail) {
      const finalPayload = await consumeChunk(decodedTail);
      if (finalPayload) return finalPayload;
    }
    if (lineParts.length > 0) {
      const line = lineParts.length === 1 ? lineParts[0] : lineParts.join('');
      lineParts = [];
      lineChars = 0;
      const finalPayload = await consumeLine(line);
      if (finalPayload) return finalPayload;
    }
    if (eventName || dataLines.length) {
      const finalPayload = await consumeEvent();
      if (finalPayload) return finalPayload;
    }
    if (latestFallbackPayload) return latestFallbackPayload;

    const error = new Error('上游流式生图已结束，但没有返回最终图片');
    error.retryable = true;
    throw error;
  } catch (error) {
    if (latestFallbackPayload) return latestFallbackPayload;
    throw error;
  } finally {
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
}

function isUnsupportedImageStreamingResponse(response, payload) {
  if (![400, 422].includes(Number(response.status))) return false;
  const message = String(payload?.error?.message || payload?.message || payload?.text || '').toLowerCase();
  return isUnsupportedImageStreamingMessage(message);
}

function isUnsupportedImageStreamingMessage(message) {
  const normalized = String(message || '').toLowerCase();
  return (
    /(?:unknown|unsupported|unrecognized|invalid|extra).{0,40}(?:stream|partial_images)/u.test(normalized) ||
    /(?:stream|partial_images).{0,40}(?:unknown|unsupported|unrecognized|invalid|not permitted|not allowed)/u.test(normalized)
  );
}

function extractRetryableImage(payload) {
  try {
    return extractImage(payload);
  } catch (error) {
    error.retryable = true;
    throw error;
  }
}

function disableImageStreamingRequest(request) {
  const contentType = request.headers?.['Content-Type'] || request.headers?.['content-type'] || '';
  if (!String(contentType).includes('application/json')) return request;
  const body = JSON.parse(String(request.body || '{}'));
  delete body.stream;
  delete body.partial_images;
  return { ...request, body: JSON.stringify(body) };
}

function withImageRequestDiagnostics(error, details = {}) {
  const normalized = error instanceof Error ? error : new Error(String(error || 'AI 生图接口请求失败'));
  normalized.imageDiagnostics = {
    stage: details.endpoint === '/images/edits' ? 'reference_image_request' : 'image_generation_request',
    attempt: details.attempt || 1,
    maxAttempts: details.maxAttempts || 1,
    routeLabel: cleanText(details.routeLabel, 120),
    statusCode: Number(details.statusCode || normalized.statusCode) || 0,
  };
  return normalized;
}

function formatImageFailure(error, durationMs) {
  const diagnostics = error?.imageDiagnostics || {};
  const attempt = Number(diagnostics.attempt) || 1;
  const maxAttempts = Number(diagnostics.maxAttempts) || attempt;
  const status = Number(diagnostics.statusCode) || 0;
  const elapsedSeconds = Math.max(1, Math.round(Number(durationMs || 0) / 1000));
  return [
    formatErrorMessage(error),
    `失败阶段：${diagnostics.stage || 'image_generation'}`,
    status ? `HTTP 状态：${status}` : '',
    `尝试次数：${attempt}/${maxAttempts}`,
    `总耗时：${elapsedSeconds} 秒`,
  ].filter(Boolean).join('；');
}

function formatImagePersistenceFailure(error, durationMs) {
  const elapsedSeconds = Math.max(1, Math.round(Number(durationMs || 0) / 1000));
  return [
    formatErrorMessage(error),
    '失败阶段：image_persistence',
    '模型已返回图片，未再次请求模型',
    `总耗时：${elapsedSeconds} 秒`,
  ].filter(Boolean).join('；');
}

function normalizeImageRequestError(error, endpoint) {
  if (error?.name === 'AbortError') {
    return new Error(
      endpoint === '/images/edits'
        ? '参考图生图接口响应超时，本张图片未成功生成，已按单张退回积分。'
        : '图片生成接口响应超时，本张图片未成功生成，已按单张退回积分。',
    );
  }
  return error instanceof Error ? error : new Error(String(error || 'AI 生图接口请求失败'));
}

function isRetryableStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504, 524].includes(status);
}

function isRetryableFetchError(error) {
  return Boolean(error?.retryable) || error?.name === 'AbortError' || error instanceof TypeError || error instanceof SyntaxError;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workerOutcomes = await Promise.allSettled(Array.from({ length: workerCount }, worker));
  const workerFailure = workerOutcomes.find((outcome) => outcome.status === 'rejected');
  if (workerFailure) throw workerFailure.reason;
  return results;
}

function createConcurrencySemaphore(limit) {
  const maxActive = Math.max(1, Number(limit) || 1);
  const waiters = [];
  let active = 0;

  const grant = (resolve) => {
    active += 1;
    let released = false;
    resolve(() => {
      if (released) return;
      released = true;
      active -= 1;
      const next = waiters.shift();
      if (next) grant(next);
    });
  };

  return {
    acquire() {
      return new Promise((resolve) => {
        if (active < maxActive) {
          grant(resolve);
          return;
        }
        waiters.push(resolve);
      });
    },
  };
}

async function generateGenerationRule(data) {
  await ensureKnowledgeBlueprint(data);
  const prompt = composeGenerationRuleAnalysisPrompt(data);
  const content = createGenerationRuleMessageContent(data, prompt);
  const rawText = await requestTextApiWithRetry('/chat/completions', (route) => ({
    model: route.model,
    messages: [
      {
        role: 'system',
        content:
          '你是资深 K12 教辅内容总编审和视觉排版规划师。你必须从第一性原理理解用户意图、知识库整体内容、主题层级和内容覆盖边界，再决定批量图片生成规则。只输出 JSON，不要输出 Markdown、图片链接、base64 或解释文字。',
      },
      { role: 'user', content },
    ],
    temperature: 0.2,
    max_tokens: resolveGenerationRuleMaxTokens(data),
  }));
  return parseGenerationRuleText(rawText, data);
}

function resolveGenerationRuleMaxTokens(data) {
  const count = estimateGenerationCount(data);
  return clampInteger(3200 + count * 160, 4096, 12000);
}

async function requestTextApiWithRetry(endpoint, createBody) {
  let lastError;

  for (let attempt = 1; attempt <= TEXT_MAX_ATTEMPTS; attempt += 1) {
    const route = nextAiRoute('rule');
    let response;
    try {
      response = await fetch(`${route.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${route.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createBody(route)),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || '生成规则接口请求失败'));
      if (!isRetryableFetchError(error) || attempt === TEXT_MAX_ATTEMPTS) throw lastError;
      await delay(TEXT_RETRY_DELAY_MS * attempt * attempt);
      continue;
    }

    const payload = await parseApiResponse(response);
    if (response.ok) return extractText(payload);

    lastError = createApiError(response, payload, `生成规则接口（${route.label}）`);
    if (!isRetryableStatus(response.status) || attempt === TEXT_MAX_ATTEMPTS) throw lastError;
    await delay(TEXT_RETRY_DELAY_MS * attempt * attempt);
  }

  throw lastError || new Error('生成规则接口请求失败');
}

async function saveGeneratedImage(source, data, index) {
  const { buffer, mimeType } = await generatedImageToBuffer(source);
  const batchId = safeFileName(data.batchId || randomUUID());
  const pageNumber = String(index + 1).padStart(2, '0');
  const extension = IMAGE_FILE_EXTENSIONS.get(mimeType) || 'png';
  const filename = `${pageNumber}-${randomUUID()}.${extension}`;
  const path = `/generated/${batchId}/${filename}`;
  await envRef.TLSJF_KV.put(`${GENERATED_PREFIX}${path}`, buffer, {
    metadata: {
      contentType: mimeType,
      createdAt: new Date().toISOString(),
    },
  });
  return path;
}

async function serveGeneratedImage(url) {
  const key = `${GENERATED_PREFIX}${url.pathname}`;
  const result = await envRef.TLSJF_KV.getWithMetadata(key, 'arrayBuffer');
  if (!result.value) return jsonResponse(404, { ok: false, message: '资源不存在' });
  return new Response(result.value, {
    headers: {
      'Content-Type': result.metadata?.contentType || 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

async function generatedImageToBuffer(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('图片生成接口返回为空，无法保存图片');
  const imageSource = source.trim();
  if (imageSource.startsWith('data:image/')) return dataUrlImageToBuffer(imageSource);
  if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
    const response = await fetchGeneratedImageUrl(imageSource);
    if (!response.ok) throw new Error(`图片已生成但自动保存失败：读取图片 HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const mimeType = normalizeImageMimeType(response.headers.get('content-type')) || sniffImageMimeType(buffer) || 'image/png';
    return { buffer, mimeType };
  }
  if (looksLikeBase64Image(imageSource)) {
    const buffer = Buffer.from(imageSource.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return { buffer, mimeType: sniffImageMimeType(buffer) || 'image/png' };
  }
  throw new Error('图片生成接口返回了无法保存的图片格式');
}

async function fetchGeneratedImageUrl(imageSource) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATED_IMAGE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(imageSource, { signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('图片已生成，但下载保存超时，本张图片未能展示，已按单张退回积分。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function dataUrlImageToBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl);
  if (!match) throw new Error('图片生成接口返回的 data URL 格式无效，无法保存图片');
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) throw new Error('图片生成接口返回的图片类型不受支持，无法保存图片');
  return { buffer: Buffer.from(match[2], 'base64'), mimeType };
}

async function attachKnowledgeContext(data, options = {}) {
  data.knowledgeContext = await buildKnowledgeContext(data.knowledgeFiles || [], options);
}

async function buildKnowledgeContext(files, options = {}) {
  if (!files.length) return createEmptyKnowledgeContext();

  const fileTextMaxChars = options.fileTextMaxChars || KNOWLEDGE_FILE_TEXT_MAX_CHARS;
  const totalTextMaxChars = options.totalTextMaxChars || KNOWLEDGE_TOTAL_TEXT_MAX_CHARS;
  const textEntries = [];
  const imageReferences = [];
  const skippedFiles = [];
  const fileSummaries = [];
  let knowledgeImageCount = 0;
  let pdfPageImageCount = 0;

  for (const file of files) {
    if (file.mimeType.startsWith('image/')) {
      const pdfEvidence = parsePdfPageEvidenceImage(file.name);
      const summary = {
        name: file.name,
        mimeType: file.mimeType,
        pageCount: 0,
        textChars: 0,
        headingCount: 0,
        estimatedUnits: 0,
        note: pdfEvidence
          ? `PDF 第 ${pdfEvidence.pageNumber} 页内容截图，仅作为视觉内容证据，不按截图数量估算生成数量`
          : '知识库图片，仅作为多模态内容证据交给 AI 分析，不按图片张数估算生成数量',
        headings: [],
        renderedPageCount: pdfEvidence ? 1 : 0,
        sampledPages: pdfEvidence ? [pdfEvidence.pageNumber] : [],
      };
      imageReferences.push({
        name: file.name,
        mimeType: file.mimeType,
        dataUrl: file.dataUrl,
        source: pdfEvidence ? 'pdf-page' : 'knowledge-image',
        pageNumber: pdfEvidence?.pageNumber || 0,
      });
      if (pdfEvidence) {
        pdfPageImageCount += 1;
      } else {
        knowledgeImageCount += 1;
      }
      fileSummaries.push(summary);
      continue;
    }

    try {
      const { buffer, mimeType } = dataUrlToBuffer(file.dataUrl, file.mimeType);
      const content = await extractKnowledgeContent(Buffer.from(buffer), mimeType, file.name);
      const text = content.text.slice(0, fileTextMaxChars);
      const summary = {
        name: file.name,
        mimeType,
        pageCount: content.pageCount,
        textChars: content.textChars,
        headingCount: content.headings.length,
        estimatedUnits: content.estimatedUnits,
        note: content.note,
        headings: content.headings.slice(0, 24),
        renderedPageCount: 0,
        sampledPages: [],
      };

      if (text) {
        textEntries.push({ name: file.name, text });
      } else {
        const pdfHint = mimeType === 'application/pdf'
          ? '；PDF 正文在 Worker 端不做强解析，必须依赖前端上传的 PDF 页面截图等视觉证据识别真实内容'
          : '';
        skippedFiles.push(`${file.name}：未提取到可用文本，页数仅作来源定位${pdfHint}，禁止只按文件名或页数猜测`);
      }
      fileSummaries.push(summary);
    } catch (error) {
      skippedFiles.push(`${file.name}：${formatKnowledgeExtractionError(error)}`);
      fileSummaries.push({
        name: file.name,
        mimeType: file.mimeType,
        pageCount: 0,
        textChars: 0,
        headingCount: 0,
        estimatedUnits: 0,
        note: `读取失败：${formatKnowledgeExtractionError(error)}`,
        headings: [],
        renderedPageCount: 0,
        sampledPages: [],
      });
    }
  }

  const totalPages = fileSummaries.reduce((sum, file) => sum + file.pageCount, 0);
  const totalTextChars = fileSummaries.reduce((sum, file) => sum + file.textChars, 0);
  const estimatedContentUnits = clampInteger(fileSummaries.reduce((sum, file) => sum + file.estimatedUnits, 0), files.length > 0 ? 1 : 0, MAX_GENERATION_COUNT);
  return {
    promptText: composeKnowledgePromptText(textEntries, imageReferences, skippedFiles, {
      totalTextMaxChars,
      fileSummaries,
      totalPages,
      totalTextChars,
      estimatedContentUnits,
    }),
    textEntries: truncateKnowledgeTextEntries(textEntries, totalTextMaxChars),
    imageReferences,
    fileNames: files.map((file) => file.name),
    fileSummaries,
    totalPages,
    totalTextChars,
    estimatedContentUnits,
    knowledgeImageCount,
    pdfPageImageCount,
    pdfPageImageLimit: pdfPageImageCount,
  };
}

function validateGeneratePayload(payload) {
  const base = validateGenerationBasePayload(payload, true);
  if (!base.ok) return base;
  const count = Number(payload.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATION_COUNT) {
    return { ok: false, message: `单次生成数量必须是 1 到 ${MAX_GENERATION_COUNT} 的整数` };
  }
  const providedBatchItems = Array.isArray(payload.batchItems)
    ? payload.batchItems.slice(0, count).map((item) => cleanText(stringifyBatchItemInput(item), BATCH_ITEM_MAX_CHARS))
    : [];
  const targetIndex = payload.targetIndex === undefined ? null : Number(payload.targetIndex);
  if (targetIndex !== null && (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= count)) {
    return { ok: false, message: '单张重新生成的位置无效' };
  }
  const clientBatchId = payload.clientBatchId === undefined
    ? ''
    : normalizeGenerationBatchId(payload.clientBatchId);
  if (payload.clientBatchId !== undefined && !clientBatchId) {
    return { ok: false, message: '生成批次标识无效' };
  }
  return {
    ok: true,
    data: {
      ...base.data,
      count,
      targetIndex,
      clientBatchId,
      batchItems: providedBatchItems.length === count && providedBatchItems.every(Boolean)
        ? providedBatchItems
        : createAutoBatchItems(base.data.prompt, count),
      generationRule: normalizeGenerationRulePayload(payload.generationRule, count),
      layoutReferenceImage: cleanText(payload.layoutReferenceImage, 260),
    },
  };
}

function normalizeGenerationBatchId(value) {
  const normalized = cleanText(value, 80);
  return /^[a-z0-9][a-z0-9_-]{15,79}$/iu.test(normalized) ? normalized : '';
}

function validateGenerationRulePayload(payload) {
  const base = validateGenerationBasePayload(payload, false);
  if (!base.ok) return base;
  const countValidation = parseOptionalGenerationCount(payload.count);
  if (!countValidation.ok) return { ok: false, message: countValidation.message };
  return {
    ok: true,
    data: {
      ...base.data,
      count: countValidation.count,
      countWasUserProvided: Boolean(countValidation.count),
      targetIndex: null,
      batchItems: countValidation.count ? createAutoBatchItems(base.data.prompt, countValidation.count) : [],
      generationRule: null,
      layoutReferenceImage: '',
    },
  };
}

function validateGenerationBasePayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, message: '请求体必须是 JSON 对象' };
  const prompt = cleanText(payload.prompt, 2000);
  if (!prompt) return { ok: false, message: '请填写提示词' };
  const imageRatio = resolveImageRatio(payload.aspectRatio, payload.customAspectRatio);
  const rawStyleReferenceImages = Array.isArray(payload.styleReferenceImages)
    ? payload.styleReferenceImages
    : Array.isArray(payload.referenceImages)
      ? payload.referenceImages
      : [];
  return {
    ok: true,
    data: {
      prompt,
      grade: cleanText(payload.grade, 40),
      subject: cleanText(payload.subject, 40),
      materialType: cleanText(payload.materialType, 40),
      scenario: cleanText(payload.scenario, 40),
      aspectRatio: imageRatio.label,
      size: imageRatio.size,
      quality: DEFAULT_IMAGE_QUALITY,
      options: {
        printFriendly: Boolean(payload.options?.printFriendly),
        answerSpace: Boolean(payload.options?.answerSpace),
        lowInk: Boolean(payload.options?.lowInk),
        layoutFixed: Boolean(payload.options?.layoutFixed),
      },
      styleReferenceImages: rawStyleReferenceImages.slice(0, 4).map(normalizeReferenceImage).filter(Boolean),
      styleReferenceProvided: Boolean(payload.styleReferenceProvided || rawStyleReferenceImages.length > 0),
      styleReferenceCount: clampInteger(
        Number(payload.styleReferenceCount) || rawStyleReferenceImages.length,
        0,
        4,
      ),
      knowledgeFiles: Array.isArray(payload.knowledgeFiles) ? payload.knowledgeFiles.map(normalizeKnowledgeFile).filter(Boolean) : [],
      knowledgeContext: createEmptyKnowledgeContext(),
    },
  };
}

function parseGenerationRuleText(rawText, data) {
  const parsed = parseJsonObjectFromText(rawText);
  return normalizeGenerationRule(parsed || {}, data);
}

async function ensureKnowledgeBlueprint(data) {
  const context = data.knowledgeContext || createEmptyKnowledgeContext();
  if (!context.promptText && !context.imageReferences.length) return context.knowledgeBlueprint;
  if (context.knowledgeBlueprint?.anchors?.length > 0) return context.knowledgeBlueprint;

  const blueprint = isKnowledgeContentPreservationRequired(data.prompt) && context.textEntries?.length > 0
    ? createVerbatimKnowledgeBlueprint(data)
    : await generateKnowledgeBlueprint(data).catch(() => createFallbackKnowledgeBlueprint(data));
  context.knowledgeBlueprint = normalizeKnowledgeBlueprint(blueprint, data);
  context.promptText = [
    context.promptText,
    composeKnowledgeBlueprintPromptText(context.knowledgeBlueprint),
  ].filter(Boolean).join('\n\n');
  return context.knowledgeBlueprint;
}

function attachRuleKnowledgeBlueprint(data) {
  const blueprint = normalizeKnowledgeBlueprintPayload(data.generationRule?.knowledgeBlueprint);
  if (blueprint.anchors.length === 0) return;
  data.knowledgeContext.knowledgeBlueprint = blueprint;
  const blueprintText = composeKnowledgeBlueprintPromptText(blueprint);
  if (blueprintText && !data.knowledgeContext.promptText.includes('知识库蓝图锚点')) {
    data.knowledgeContext.promptText = [data.knowledgeContext.promptText, blueprintText].filter(Boolean).join('\n\n');
  }
}

async function ensureGroundedGenerationRule(data) {
  if (!data.knowledgeContext) data.knowledgeContext = createEmptyKnowledgeContext();
  await ensureKnowledgeBlueprint(data);

  const baseRule = data.generationRule && typeof data.generationRule === 'object'
    ? data.generationRule
    : {
        recommendedCount: data.count,
        count: data.count,
        pages: data.batchItems.map((item, index) => ({
          title: `第 ${index + 1} 张`,
          focus: item,
          sourceLogic: '正式生成前由服务端根据知识库蓝图重新接地',
          mustInclude: [],
          avoid: [],
        })),
      };

  data.generationRule = normalizeGenerationRule(
    {
      ...baseRule,
      recommendedCount: data.count,
      count: data.count,
    },
    data,
  );

  if (Array.isArray(data.generationRule.batchItems) && data.generationRule.batchItems.length === data.count) {
    data.batchItems = data.generationRule.batchItems;
  }
}

async function generateKnowledgeBlueprint(data) {
  const prompt = composeKnowledgeBlueprintAnalysisPrompt(data);
  const content = createGenerationRuleMessageContent(data, prompt);
  const rawText = await requestTextApiWithRetry('/chat/completions', (route) => ({
    model: route.model,
    messages: [
      {
        role: 'system',
        content:
          '你是严谨的 K12 教辅知识库内容抽取员。你的唯一任务是把用户上传的知识库文件内容转写成结构化、可验证、可用于生图的内容锚点。只能依据知识库证据和用户提示词，不得编造。只输出 JSON。',
      },
      { role: 'user', content },
    ],
    temperature: 0.05,
    max_tokens: 12000,
  }));
  return parseJsonObjectFromText(rawText) || {};
}

function composeKnowledgeBlueprintAnalysisPrompt(data) {
  const preservationInstruction = isKnowledgeContentPreservationRequired(data.prompt)
    ? [
        '原文保真模式（最高优先级）：',
        '- 用户明确要求知识库/资料文字保持不变。anchors.title、anchors.content 和 mustInclude 只能逐字摘录可见原文，不得概括、改写、润色、纠错、补写或删减。',
        '- 必须保留原文中的标题、正文、题干、选项、答案、数字、单位、公式、标点和先后顺序；即使原文存在错别字或表达不顺，也不得擅自修正。',
        '- 你的任务仅是识别内容边界和来源，不是重新创作文字。无法逐字确认的内容只能写入 uncertaintyNotes。',
      ].join('\n')
    : '';
  return [
    '请先从用户上传的知识库文件中抽取“知识库蓝图”，供后续生成规则确认和单张图片生成使用。',
    `用户核心提示词：${data.prompt}`,
    preservationInstruction,
    data.knowledgeContext.promptText,
    [
      '抽取要求：',
      '- 只抽取知识库证据里真实出现或能从截图清晰读出的内容，不要补充外部常识，不要编造题目、概念、例子或知识点。',
      '- 对文本型文件，逐项抽取主题、章节、知识点、题型、任务、表格、流程、案例和显性要求。',
      '- 对 PDF 页面截图或知识库图片，必须把可见标题、题干、题型、数字、图示含义、栏目标题和练习任务转写成文字锚点。',
      '- 如果某些页面只有截图但无法可靠读清具体内容，只能写入 uncertaintyNotes，不要把不确定内容写进 anchors。',
      '- anchors 必须是后续“可以生成成品图片”的内容单元，不是源文件页码列表；同一知识簇可以合并，独立题型/知识点要拆开。',
      '- 每个 anchor 必须写清 title、content、mustInclude、source、confidence；mustInclude 必须是后续图片必须出现的具体词、题型、步骤、数字或内容项。',
      '- source 可以包含文件名/页码/截图位置，但 source 只是证据定位，不是数量或排序依据。',
    ].join('\n'),
    [
      '请输出严格 JSON：',
      '{',
      '  "intent": "你基于提示词理解到的用户想生成什么",',
      '  "sourceSummaries": ["文件/页面/图片证据摘要"],',
      '  "anchors": [',
      '    {',
      '      "title": "内容锚点标题",',
      '      "content": "该锚点的真实知识库内容，必须具体",',
      '      "mustInclude": ["后续图片必须包含的具体内容"],',
      '      "source": "证据来源定位",',
      '      "confidence": "high|medium|low"',
      '    }',
      '  ],',
      '  "uncertaintyNotes": ["无法确认或不能可靠读取的内容说明"]',
      '}',
      '禁止输出 Markdown、图片链接、data URL、base64 或任何非 JSON 内容。',
    ].join('\n'),
  ].filter(Boolean).join('\n\n');
}

function normalizeKnowledgeBlueprint(rawBlueprint, data, options = {}) {
  const useFallback = options.fallback !== false;
  const fallback = useFallback ? createFallbackKnowledgeBlueprint(data) : createEmptyKnowledgeBlueprint();
  const source = rawBlueprint && typeof rawBlueprint === 'object' ? rawBlueprint : {};
  const anchors = Array.isArray(source.anchors)
    ? source.anchors.map((anchor) => normalizeKnowledgeAnchor(anchor)).filter(Boolean)
    : [];
  const normalized = {
    intent: sanitizeRuleText(source.intent, 800) || fallback.intent,
    sourceSummaries: normalizeStringList(source.sourceSummaries, KNOWLEDGE_BLUEPRINT_MAX_SOURCE_SUMMARIES, 260),
    anchors: anchors.slice(0, KNOWLEDGE_BLUEPRINT_MAX_ANCHORS),
    uncertaintyNotes: normalizeStringList(source.uncertaintyNotes, KNOWLEDGE_BLUEPRINT_MAX_UNCERTAINTY_NOTES, 260),
  };
  if (useFallback && normalized.anchors.length === 0) {
    normalized.anchors = fallback.anchors;
    normalized.uncertaintyNotes = [
      ...normalized.uncertaintyNotes,
      ...fallback.uncertaintyNotes,
    ].slice(0, KNOWLEDGE_BLUEPRINT_MAX_UNCERTAINTY_NOTES);
  }
  if (useFallback && normalized.sourceSummaries.length === 0) normalized.sourceSummaries = fallback.sourceSummaries;
  return normalized;
}

function normalizeKnowledgeBlueprintPayload(rawBlueprint) {
  return normalizeKnowledgeBlueprint(rawBlueprint, { prompt: '', knowledgeContext: createEmptyKnowledgeContext() }, { fallback: false });
}

function createEmptyKnowledgeBlueprint() {
  return {
    intent: '',
    sourceSummaries: [],
    anchors: [],
    uncertaintyNotes: [],
  };
}

function normalizeKnowledgeAnchor(anchor) {
  const title = sanitizeRuleText(anchor?.title, 120);
  const content = sanitizeRuleText(anchor?.content || anchor?.focus || anchor?.summary, KNOWLEDGE_ANCHOR_TEXT_MAX_CHARS);
  const mustInclude = normalizeStringList(anchor?.mustInclude, 16, KNOWLEDGE_ANCHOR_MUST_INCLUDE_MAX_CHARS);
  const source = sanitizeRuleText(anchor?.source || anchor?.sourceLogic, 220);
  const confidence = ['high', 'medium', 'low'].includes(String(anchor?.confidence || '').toLowerCase())
    ? String(anchor.confidence).toLowerCase()
    : 'medium';
  if (!title && !content && mustInclude.length === 0) return null;
  return {
    title: title || content.slice(0, 80) || '知识库内容锚点',
    content: content || title,
    mustInclude,
    source,
    confidence,
  };
}

function createFallbackKnowledgeBlueprint(data) {
  const context = data.knowledgeContext || createEmptyKnowledgeContext();
  const anchors = [];
  for (const entry of splitKnowledgeTextEntries(context.promptText)) {
    anchors.push({
      title: entry.title,
      content: entry.content,
      mustInclude: extractMustIncludeTerms(entry.content),
      source: entry.source,
      confidence: 'medium',
    });
    if (anchors.length >= KNOWLEDGE_BLUEPRINT_MAX_ANCHORS) break;
  }
  if (anchors.length === 0) {
    for (const file of context.fileSummaries || []) {
      const note = sanitizeRuleText(file.note, 220);
      anchors.push({
        title: file.name,
        content: note || `来自 ${file.name} 的知识库内容证据`,
        mustInclude: [],
        source: file.name,
        confidence: file.textChars > 0 || file.renderedPageCount > 0 ? 'medium' : 'low',
      });
      if (anchors.length >= KNOWLEDGE_BLUEPRINT_MAX_ANCHORS) break;
    }
  }
  return {
    intent: `根据用户提示词和知识库证据生成教辅图片：${data.prompt}`,
    sourceSummaries: (context.fileSummaries || []).map((file) => `${file.name}：${file.note || '知识库证据'}`).slice(0, KNOWLEDGE_BLUEPRINT_MAX_SOURCE_SUMMARIES),
    anchors,
    uncertaintyNotes: anchors.length > 0
      ? ['部分知识库内容只能由原始文本/截图证据确认，后续不得编造未出现在锚点中的具体内容。']
      : ['未形成可靠知识库锚点，后续只能围绕用户提示词和可见证据生成，不能编造具体知识库内容。'],
  };
}

function createVerbatimKnowledgeBlueprint(data) {
  const context = data.knowledgeContext || createEmptyKnowledgeContext();
  const anchors = [];
  for (const entry of context.textEntries || []) {
    const chunks = splitVerbatimKnowledgeText(entry.text, KNOWLEDGE_ANCHOR_TEXT_MAX_CHARS);
    chunks.forEach((content, index) => {
      if (anchors.length >= KNOWLEDGE_BLUEPRINT_MAX_ANCHORS) return;
      anchors.push({
        title: inferKnowledgeAnchorTitle(content, entry.name, index),
        content,
        mustInclude: extractMustIncludeTerms(content),
        source: entry.name,
        confidence: 'high',
      });
    });
    if (anchors.length >= KNOWLEDGE_BLUEPRINT_MAX_ANCHORS) break;
  }

  return {
    intent: `只调整视觉呈现，知识库文字必须逐字保持不变：${data.prompt}`,
    sourceSummaries: (context.textEntries || [])
      .map((entry) => `${entry.name}：已直接锁定可提取原文，不经过模型改写`)
      .slice(0, KNOWLEDGE_BLUEPRINT_MAX_SOURCE_SUMMARIES),
    anchors,
    uncertaintyNotes: anchors.length > 0
      ? ['原文锚点由服务端直接从可提取文本构建；图片或扫描件中无法可靠提取的文字不得猜测或改写。']
      : ['未提取到可逐字锁定的文本；图片或扫描件中的内容只能按可见证据识别，不得猜测或改写。'],
  };
}

function splitVerbatimKnowledgeText(value, maxLength) {
  const text = normalizeKnowledgeText(value);
  const chunks = [];
  let start = 0;

  while (start < text.length && chunks.length < KNOWLEDGE_BLUEPRINT_MAX_ANCHORS) {
    let end = Math.min(text.length, start + maxLength);
    if (end < text.length) {
      const minimumBreak = start + Math.floor(maxLength * 0.55);
      const window = text.slice(start, end);
      const breakCandidates = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n')];
      for (const punctuation of ['。', '！', '？', '；']) {
        const position = window.lastIndexOf(punctuation);
        if (position >= 0) breakCandidates.push(position + punctuation.length);
      }
      const preferredBreak = Math.max(...breakCandidates);
      if (start + preferredBreak >= minimumBreak) end = start + preferredBreak;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
    while (/\s/u.test(text[start] || '')) start += 1;
  }

  return chunks;
}

function isKnowledgeContentPreservationRequired(prompt) {
  const text = String(prompt || '').replace(/\s+/gu, '');
  if (!text) return false;

  return [
    /(?:不要|不得|禁止|不能|不可|不允许|请勿|不)(?:对)?(?:做)?(?:修改|改动|改变|改写|重写|润色|优化|删减|增删|调整|纠正|纠错)(?:知识库(?:文件)?|资料|文件|原文|文本|文字|内容)/u,
    /(?:知识库(?:文件)?|资料|文件|原文|文本|文字)(?:里|内|中|里的|内的|中的)?(?:的)?(?:文字|文本)?内容(?:不要|不得|不能|不可|不允许|请勿|保持|不)?(?:做)?(?:修改|改动|改变|改写|重写|润色|优化|删减|增删|调整|纠正|纠错|不变)/u,
    /(?:保持|保留)(?:知识库(?:文件)?|资料|文件|原文|文本|文字)(?:里|内|中|里的|内的|中的)?(?:的)?(?:文字|文本|内容)?(?:原样|原文|不变|不动|一致)/u,
    /(?:原文|文字内容|文本内容|资料内容)(?:必须|需要|要)?(?:原封不动|逐字(?:逐句)?保留|一字不改|完全不变|保持不变)/u,
    /(?:原封不动|逐字(?:逐句)?保留|一字不改|照搬原文|照抄原文)/u,
  ].some((pattern) => pattern.test(text));
}

function splitKnowledgeTextEntries(promptText) {
  const text = String(promptText || '');
  const entries = [];
  const blocks = text.split(/【([^】]+)】\n/u);
  for (let index = 1; index < blocks.length; index += 2) {
    const source = cleanText(blocks[index], 120);
    const body = String(blocks[index + 1] || '').trim();
    if (!body) continue;
    const chunks = body.split(/\n{2,}|(?=第\s*\d+\s*页[:：])/u)
      .map((chunk) => normalizeKnowledgeText(chunk).slice(0, KNOWLEDGE_ANCHOR_TEXT_MAX_CHARS))
      .filter((chunk) => chunk.length >= 8);
    chunks.forEach((chunk, chunkIndex) => {
      entries.push({
        title: inferKnowledgeAnchorTitle(chunk, source, chunkIndex),
        content: chunk,
        source,
      });
    });
  }
  return entries;
}

function inferKnowledgeAnchorTitle(text, source, index) {
  const firstLine = String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
  const title = cleanText(firstLine.replace(/^第\s*\d+\s*页[:：]\s*/u, ''), 80);
  return title || `${source || '知识库'} 内容锚点 ${index + 1}`;
}

function extractMustIncludeTerms(text) {
  const normalized = normalizeKnowledgeText(text);
  const terms = new Set();
  normalized
    .split(/[，。；：、\n\s]+/u)
    .map((part) => cleanText(part, 40))
    .filter((part) => part.length >= 2 && part.length <= 24)
    .slice(0, 12)
    .forEach((part) => terms.add(part));
  return [...terms].slice(0, 8);
}

function composeKnowledgeBlueprintPromptText(blueprint) {
  if (!blueprint?.anchors?.length) return '';
  const lines = [
    '知识库蓝图锚点（后续规则确认和单图生成必须优先服从）：',
    blueprint.intent ? `- 用户意图锚定：${blueprint.intent}` : '',
  ].filter(Boolean);
  if (blueprint.sourceSummaries?.length > 0) {
    lines.push(`- 来源摘要：${blueprint.sourceSummaries.slice(0, 12).join('；')}`);
  }
  blueprint.anchors.slice(0, KNOWLEDGE_BLUEPRINT_MAX_ANCHORS).forEach((anchor, index) => {
    lines.push(
      `- 锚点 ${index + 1}：${anchor.title} | 内容：${anchor.content}` +
        `${anchor.mustInclude.length > 0 ? ` | 必含：${anchor.mustInclude.join('、')}` : ''}` +
        `${anchor.source ? ` | 来源：${anchor.source}` : ''}` +
        ` | 置信度：${anchor.confidence}`,
    );
  });
  if (blueprint.uncertaintyNotes?.length > 0) {
    lines.push(`- 不确定内容：${blueprint.uncertaintyNotes.slice(0, 12).join('；')}`);
  }
  lines.push('规则和最终图片不得生成超出以上蓝图锚点、用户提示词和可见证据的具体知识点、题目或内容。');
  return lines.join('\n');
}

function groundRulePagesToKnowledgeBlueprint(pages, data, blueprint) {
  const anchors = Array.isArray(blueprint?.anchors) ? blueprint.anchors : [];
  if (anchors.length === 0) return pages;
  return pages.map((page, index) => {
    const anchor = selectKnowledgeAnchorForPage(index, pages.length, anchors);
    if (!anchor) return page;
    const pageText = [page.title, page.focus, page.sourceLogic, ...(page.mustInclude || [])].join(' ');
    const isWeak = isWeakKnowledgeGroundedPage(pageText, data);
    const title = isWeak ? anchor.title : page.title || anchor.title;
    const focus = isWeak
      ? `${anchor.title}：${anchor.content}`
      : appendAnchorToRuleText(page.focus, anchor.content, BATCH_ITEM_MAX_CHARS);
    const sourceLogic = appendAnchorToRuleText(
      page.sourceLogic,
      anchor.source ? `知识库锚点来源：${anchor.source}` : '来自知识库蓝图锚点',
      260,
    );
    const mustInclude = mergeUniqueStrings([
      ...(Array.isArray(page.mustInclude) ? page.mustInclude : []),
      ...anchor.mustInclude,
      anchor.title,
    ], 12, 200);
    return {
      ...page,
      title,
      focus,
      sourceLogic,
      mustInclude,
      knowledgeAnchorIndex: anchors.indexOf(anchor),
      knowledgeAnchor: anchor,
    };
  });
}

function lockRulePagesToVerbatimAnchors(pages) {
  return pages.map((page) => {
    const anchor = normalizeKnowledgeAnchor(page?.knowledgeAnchor);
    if (!anchor) return page;
    return {
      ...page,
      title: anchor.title,
      focus: anchor.content,
      sourceLogic: anchor.source ? `逐字原文来源：${anchor.source}` : '来自逐字锁定的知识库原文锚点',
      mustInclude: mergeUniqueStrings([...anchor.mustInclude, anchor.title], 12, 200),
      knowledgeAnchor: anchor,
    };
  });
}

function selectKnowledgeAnchorForPage(index, pageCount, anchors) {
  if (!anchors.length) return null;
  if (pageCount <= anchors.length) return anchors[index] || anchors.at(-1);
  const anchorIndex = Math.floor((index * anchors.length) / Math.max(1, pageCount));
  return anchors[Math.min(anchorIndex, anchors.length - 1)];
}

function isWeakKnowledgeGroundedPage(text, data) {
  const normalized = cleanText(text, 260);
  if (!normalized) return true;
  if (isBadRuleFocus(normalized)) return true;
  const genericPatterns = [
    /根据知识库/u,
    /整理知识库/u,
    /核心内容单元/u,
    /独立教辅页面/u,
    /页面规划/u,
    /生成所有图片/u,
    /用户需求/u,
  ];
  const hasGeneric = genericPatterns.some((pattern) => pattern.test(normalized));
  const hasSpecificTerm = extractMustIncludeTerms(normalized).some((term) => term.length >= 3 && !data.prompt.includes(term));
  return hasGeneric && !hasSpecificTerm;
}

function appendAnchorToRuleText(original, anchorText, maxLength) {
  const base = sanitizeRuleText(original, maxLength);
  const addition = sanitizeRuleText(anchorText, maxLength);
  if (!addition) return base;
  if (!base) return addition;
  if (base.includes(addition.slice(0, Math.min(40, addition.length)))) return base;
  return cleanText(`${base}；知识库锚点：${addition}`, maxLength);
}

function mergeUniqueStrings(values, limit, maxLength) {
  const seen = new Set();
  const merged = [];
  for (const value of values) {
    const item = sanitizeRuleText(value, maxLength);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return merged;
}

function normalizeGenerationRule(rule, data) {
  const preserveKnowledgeContent = isKnowledgeContentPreservationRequired(data.prompt);
  const rawPages = Array.isArray(rule?.pages) ? rule.pages : [];
  const rawBatchItems = Array.isArray(rule?.batchItems) ? rule.batchItems : [];
  const rawContentUnits = Array.isArray(rule?.contentUnits) ? rule.contentUnits : [];
  const finalCount = resolveGenerationRuleCount(rule, data, rawPages, rawBatchItems, rawContentUnits);
  const rawCount = resolveRawGenerationRuleCount(rule, rawPages, rawBatchItems);
  const countWasRaisedByContentEvidence =
    !data.count && Number.isInteger(rawCount) && rawCount > 0 && rawCount < finalCount;
  let pages = rawPages.length > 0
    ? rawPages.map((page, index) => normalizeRulePage(page, index, data))
    : createRulePagesFromBatchItems(rawBatchItems, data, finalCount);
  if (pages.length < finalCount) {
    const fallbackPages = createRulePagesFromBatchItems(data.batchItems, data, finalCount);
    pages = [...pages, ...fallbackPages.slice(pages.length)];
  }
  const knowledgeBlueprint = normalizeKnowledgeBlueprint(data.knowledgeContext?.knowledgeBlueprint, data);
  pages = groundRulePagesToKnowledgeBlueprint(
    pages.slice(0, finalCount).map((page, index) => ({ ...page, index })),
    data,
    knowledgeBlueprint,
  );
  if (preserveKnowledgeContent) pages = lockRulePagesToVerbatimAnchors(pages);
  const batchItems = pages.map(formatRulePageBatchItem);
  return {
    count: finalCount,
    recommendedCount: finalCount,
    countReason: countWasRaisedByContentEvidence
      ? createRaisedCountReason(data, rawCount, finalCount)
      : sanitizeRuleText(rule?.countReason, 500) || createCountReason(data, finalCount),
    evidence: createRuleEvidence(data),
    knowledgeBlueprint,
    intentAnalysis: preserveKnowledgeContent
      ? '用户要求只调整视觉呈现，知识库和资料中的文字内容必须逐字保持不变。'
      : sanitizeRuleText(rule?.intentAnalysis, 1000),
    countStrategy: preserveKnowledgeContent
      ? '按逐字锁定的原文锚点顺序分页；数量只服务于完整容纳原文，不通过删改或压缩文字减少页面。'
      : sanitizeRuleText(rule?.countStrategy, 1200),
    summary: preserveKnowledgeContent
      ? '只改变视觉排版、配色和装饰，所有可见资料文字逐字照录原文。'
      : sanitizeRuleText(rule?.summary, 800) || '已根据提示词、知识库和参考风格整理批量生成规则。',
    contentLogic: preserveKnowledgeContent
      ? '原文块按原始顺序分页，不拆句、不合并、不去重、不取舍、不重排。'
      : sanitizeRuleText(rule?.contentLogic, 1200) || createFallbackContentLogic(data),
    contentProductionStrategy: preserveKnowledgeContent
      ? '逐字照录知识库原文，只调整分页和视觉排版，不做摘要、改写、润色、纠错、补写或删减。'
      : sanitizeRuleText(rule?.contentProductionStrategy, 1200),
    layoutLogic: sanitizeRuleText(rule?.layoutLogic, 1200) || createFallbackLayoutLogic(data),
    styleLogic: sanitizeRuleText(rule?.styleLogic, 1200) || createFallbackStyleLogic(data),
    styleAdvice: sanitizeRuleText(rule?.styleAdvice, 1000),
    contentInventory: normalizeStringList(rule?.contentInventory, RULE_CONTENT_INVENTORY_MAX_ITEMS, 280),
    contentUnits: normalizeStringList(rule?.contentUnits, MAX_GENERATION_COUNT, 180),
    contentHierarchy: normalizeStringList(rule?.contentHierarchy, MAX_GENERATION_COUNT, 260),
    coverageMap: normalizeStringList(rule?.coverageMap, MAX_GENERATION_COUNT, 260),
    coverageChecklist: normalizeStringList(rule?.coverageChecklist, RULE_COVERAGE_CHECKLIST_MAX_ITEMS, 260),
    coverageAudit: normalizeStringList(rule?.coverageAudit, RULE_COVERAGE_CHECKLIST_MAX_ITEMS, 280),
    riskNotes: normalizeStringList(rule?.riskNotes, RULE_RISK_NOTES_MAX_ITEMS, 260),
    pages,
    batchItems,
  };
}

function composeGenerationRuleAnalysisPrompt(data) {
  const labels = [];
  if (data.materialType) labels.push(`资料类型：${data.materialType}`);
  if (data.scenario) labels.push(`使用场景：${data.scenario}`);
  if (data.aspectRatio) labels.push(`图片比例：${data.aspectRatio}`);
  if (data.options.layoutFixed) labels.push('排版设计固定：是');
  const preserveKnowledgeContent = isKnowledgeContentPreservationRequired(data.prompt);
  return [
    '请先生成“生成规则逻辑”，用于后续批量生成教辅图片。',
    '第一性原理：最终图片是一组可直接交付给用户使用的内容成品，不是源文件分页截图，也不是把资料页逐页改写。生成数量必须是你理解用户目标和知识库内容后，为了完整、清晰、不过度冗余地覆盖目标内容而得出的规划结果。',
    data.count
      ? `用户指定生成 ${data.count} 张，必须输出正好 ${data.count} 个页面规划。`
      : `用户未指定数量。你必须真正阅读和理解知识库整体内容，先完成内容规划，再判断最适合生成多少张，范围 1-${MAX_GENERATION_COUNT}。`,
    labels.length > 0 ? labels.join('；') : '',
    `用户核心提示词：${data.prompt}`,
    preserveKnowledgeContent
      ? '原文保真模式（最高优先级）：用户明确要求知识库/资料文字内容不变。你只能规划原文块如何分页和排版，不得摘要、改写、润色、纠错、补写、删减、去重或改变原文顺序；pages 中的可见文字必须来自知识库蓝图原文锚点。'
      : '',
    data.knowledgeContext.promptText,
    hasStyleReference(data)
      ? `已提供 ${data.styleReferenceCount || data.styleReferenceImages.length || 1} 张参考风格图。它们是唯一视觉样式来源，请只从当次参考图提取版式、配色、字体层级、栏目组织和视觉节奏，不要套用任何非参考图来源的默认模板、应用示例、历史生成图或知识库截图样式。`
      : '',
    [
      '规划要求：',
      '- 第一步必须判断用户当次任务意图：用户到底想生成什么类型的图片、服务什么教学目标、面向谁、需要覆盖知识库里的全部内容还是按提示词筛选重点。',
      '- 第二步必须做“全量内容盘点”：逐项识别知识库里的一级主题、二级主题、章节、知识点、题型、图表、案例、活动、说明性内容、显性/隐性任务和用户明确要求生成的内容；这些盘点结果必须写入 contentInventory，不能只写少量概括。',
      '- 第三步必须形成主题层级：用“一级主题 > 二级主题 > 具体内容单元”的方式组织 contentUnits 和 contentHierarchy，不能把源文件页码当成主题层级。',
      '- 第四步必须评估内容密度和单张可读性：一张图只能承载一个清晰知识簇，或少量自然合并的小知识点；如果一个源页里有多个独立知识簇，必须拆成多张；如果多个源页属于同一知识簇，可以合并。',
      '- 第五步才决定图片数量：数量必须服务内容覆盖、用户意图和单张图片可读性，最高权重是内容本身的规划结果，而不是源文件页数。',
      '- 数量决策公式只能来自内容规划：生成数量 = 为完成用户目标而需要独立呈现的内容成品数。不要使用源文件页数、PDF 页数、截图数量、上传图片数量、文件数量或抽样页码作为数量依据。',
      data.count
        ? '- 用户已填写数量，必须按用户填写数量组织内容；不要按上传文件页数机械对应图片数量。'
        : '- 用户未填写数量，必须由内容规划决定推荐数量；不要按上传文件页数机械对应图片数量。',
      '- 推荐数量的最高权重是内容规划：每张图应该承载一个清晰教学目标、一个知识簇、一个题型组、一个流程步骤或一组可自然合并的知识点；源文件页数没有决策权，只有 sourceLogic 需要定位来源时才提及页码。',
      preserveKnowledgeContent
        ? '- 页面只能按原文先后顺序分配锁定原文块；允许分页，但不得重排原文块内部或跨原文块的文字顺序。'
        : '- 输出顺序必须按教学/知识逻辑重排：先基础概念、总览、前置知识或第一学习任务，再进入后续练习、拓展、复盘；严禁把“原文件第几页”当成“生成第几张”的排序依据。',
      '- contentUnits 必须是你重新梳理后的主题层级和逻辑内容单元列表，不是原文件页码列表；pages 必须按 contentUnits 的逻辑顺序分配内容。',
      '- countStrategy 必须像产品经理一样说明数量为什么这么定：先说明内容簇数量、单张承载密度、哪些拆分、哪些合并，再得出推荐数量。',
      preserveKnowledgeContent
        ? '- contentProductionStrategy 只能说明如何在不改变任何文字的前提下分配原文块和排版；禁止提出改写、摘要、润色、纠错、去重、删减或补写。'
        : '- contentProductionStrategy 必须说明内容生产方法：每张图如何保留原资料里的关键条目、如何改写成可读图卡、如何处理高密度清单/表格/流程/题组。',
      '- summary 必须写清你理解到的用户真实目标和生成边界；contentLogic 必须写清主题层级、哪些内容合并、哪些内容拆分、哪些内容因不符合用户意图而不生成。',
      '- coverageChecklist 和 coverageAudit 必须覆盖用户想生成的全部内容点；如果某个知识库内容不生成，riskNotes 要说明它为什么不属于本次意图或如何被合并。',
      '- 对高密度资料，不能因为原页排得下就让一张生成图塞满所有内容；生成图必须可读、可背、可查。',
      '- 对清单型、速记型、知识库型资料，优先拆成“知识簇速查卡”；对步骤型资料，优先拆成“流程/方法卡”；对题目型资料，按题型组、能力点或练习任务拆分。',
      '- 不允许因为文件页数多就简单判定同页数图片；也不允许因为提示词简短就把大量章节/知识点压缩成固定 4 张。',
      '- 当知识库页数很多但内容连续、重复或同属一个小知识点时，可以合并；当同一页里包含多个章节点、题型或知识点时，必须拆开。',
      '- 不要默认把页面规划成固定模板或答题类页面；只有用户提示词、资料内容或资料类型明确要求相关模块时，才规划这些元素。',
      '- “不要遗漏”“参考风格一样”“根据知识库内容”“原文不变”等是执行要求，不是页面主题；禁止围绕这些短语生成独立页面。',
      preserveKnowledgeContent
        ? '- 不得执行去重、补齐缺失承接或文字优化；即使发现重复、错字、缺句或排序问题，也只能保持原文并在 riskNotes 记录，不能擅自修复。'
        : '',
      '- 每张图都要有清晰的独立目标、内容范围、必须包含的信息和避免重复的边界。',
      '- styleAdvice 必须给出适配本次资料类型的视觉建议：例如速查卡、知识图谱、流程图、题组卡、时间轴、对照表等；不要只写“简洁美观”。',
      '- sourceLogic 可以说明内容来自哪些文件、章节、页码或截图，但必须先说明“为什么这个内容逻辑上属于当前第几张”，不要只写第几页。',
      '- 输出必须能直接指导图片生成，不能只写泛泛建议。',
    ].join('\n'),
    [
      '请输出严格 JSON，对象字段如下：',
      '{',
      '  "recommendedCount": 生成数量数字,',
      '  "intentAnalysis": "你对本次任务意图、用户目标、目标读者、成品类型和覆盖边界的理解",',
      '  "countReason": "为什么生成这个数量，必须基于内容规划和用户意图，不得基于源文件页数",',
      '  "countStrategy": "从内容簇数量、单张可读性、拆分合并和用户目标推导推荐数量的完整逻辑",',
      '  "summary": "整体生成意图理解：用户想要什么、目标是什么、覆盖边界是什么",',
      preserveKnowledgeContent
        ? '  "contentLogic": "原文块按原始顺序分页的逻辑；只描述排版分配，不做拆句、合并、去重、取舍或重排",'
        : '  "contentLogic": "主题层级、内容拆分、合并、去重、取舍和排序逻辑",',
      preserveKnowledgeContent
        ? '  "contentProductionStrategy": "后续图片如何逐字照录知识库原文，只调整分页和视觉排版，不做任何文字改写",'
        : '  "contentProductionStrategy": "后续图片内容如何生产：如何保留知识库条目、如何改写成可读图卡、如何处理高密度清单/表格/流程/题组",',
      '  "layoutLogic": "整批图片的版式组织规则",',
      '  "styleLogic": "参考风格和视觉表达规则",',
      '  "styleAdvice": "针对本次资料类型的视觉建议和信息架构建议",',
      '  "contentInventory": ["全量内容盘点：一级主题 > 二级主题 > 具体内容项/作品/人物/术语/题型/图表/流程"],',
      '  "contentUnits": ["一级主题 > 二级主题 > 具体章节/知识点/内容模块/活动/案例/任务单元"],',
      '  "contentHierarchy": ["一级主题 > 二级主题 > 具体内容单元 | 重要性 | 生成/合并/舍弃决策"],',
      '  "coverageMap": ["用户目标/知识库内容点 -> 对应第几张图 -> 覆盖方式"],',
      '  "coverageChecklist": ["确保用户想生成的内容点都被覆盖的检查项"],',
      '  "coverageAudit": ["内容盘点项 -> 是否进入 pages -> 对应第几张/合并到哪里/为什么"],',
      '  "riskNotes": ["可能遗漏或需注意的点"],',
      '  "pages": [',
      '    {',
      '      "title": "第1张标题",',
      '      "focus": "本张核心内容",',
      '      "sourceLogic": "为什么这个内容逻辑上属于本张，以及对应资料来源；页码只能作证据位置，不能作排序依据",',
      '      "mustInclude": ["必须包含的信息"],',
      '      "avoid": ["本张不要混入的内容"]',
      '    }',
      '  ]',
      '}',
      data.count
        ? `recommendedCount 必须等于 ${data.count}，pages 数组长度必须正好是 ${data.count}。`
        : `recommendedCount 必须是 1 到 ${MAX_GENERATION_COUNT} 的整数，pages 数组长度必须等于 recommendedCount。`,
      '禁止输出 Markdown、图片链接、data URL、base64 或任何非 JSON 内容。',
    ].join('\n'),
  ].filter(Boolean).join('\n\n');
}

function createGenerationRuleMessageContent(data, prompt) {
  const content = [{ type: 'text', text: prompt }];
  data.styleReferenceImages.forEach((image, index) => {
    content.push({ type: 'text', text: `参考风格图 ${index + 1}：${image.name}。规则确认阶段只记录风格图存在；实际生图阶段会把参考图原图传给图像模型。` });
  });
  data.knowledgeContext.imageReferences.forEach((image, index) => {
    content.push({ type: 'text', text: `知识库图片 ${index + 1}：${image.name}` });
    content.push({ type: 'image_url', image_url: { url: image.dataUrl } });
  });
  return content;
}

function composeCurrentPageKnowledgeAnchor(data, index) {
  const rule = data.generationRule || null;
  const page = rule?.pages?.[index] || null;
  const anchor = normalizeKnowledgeAnchor(page?.knowledgeAnchor);
  const assignedItem = data.batchItems[index] || '';
  const lines = [
    '当前单张图片内容硬锚点（最高优先级）：',
    `- 当前是第 ${index + 1}/${data.count || 1} 张，只能生成本张规划范围内的内容。`,
  ];

  if (page?.title) lines.push(`- 本张标题方向：${page.title}`);
  if (page?.focus) lines.push(`- 本张核心内容：${page.focus}`);
  if (page?.sourceLogic) lines.push(`- 本张资料依据：${page.sourceLogic}`);
  if (Array.isArray(page?.mustInclude) && page.mustInclude.length > 0) {
    lines.push(`- 本张必须包含：${page.mustInclude.join('；')}`);
  }
  if (Array.isArray(page?.avoid) && page.avoid.length > 0) {
    lines.push(`- 本张禁止混入：${page.avoid.join('；')}`);
  }
  if (anchor) {
    lines.push(
      '- 本张知识库蓝图锚点：',
      `  - 标题：${anchor.title}`,
      `  - 真实内容：${anchor.content}`,
      anchor.mustInclude.length > 0 ? `  - 必须出现在图中：${anchor.mustInclude.join('；')}` : '',
      anchor.source ? `  - 证据来源：${anchor.source}` : '',
      `  - 置信度：${anchor.confidence}`,
    );
  }
  if (assignedItem) {
    lines.push(`- 本张专属内容摘要：${assignedItem}`);
  }

  lines.push(
    '- 本张图片必须围绕“本张知识库蓝图锚点”和“本张规则”生成；如果二者冲突，以知识库蓝图锚点中的真实内容为准。',
    '- 主标题、知识点、题目、示例、表格、图示和正文只能围绕以上锚点展开。',
    '- 不得把其他页面规划、其他知识簇或知识库里不属于本张的内容混入当前图。',
    '- 不得编造知识库未出现、当前页规则未要求的题目、知识点、事实、文本段落或教学模块。',
    '- 如果知识库证据不足以确认某个细节，不要把它写成确定事实；应围绕已确认锚点做清晰呈现。',
  );

  return lines.join('\n');
}

function composeSingleImageKnowledgeContext(data, index) {
  if (!data.generationRule) return data.knowledgeContext.promptText;

  const rule = data.generationRule;
  const page = rule.pages?.[index] || null;
  const anchor = normalizeKnowledgeAnchor(page?.knowledgeAnchor);
  const sourceSummaries = Array.isArray(rule.knowledgeBlueprint?.sourceSummaries)
    ? rule.knowledgeBlueprint.sourceSummaries
    : [];
  const uncertaintyNotes = Array.isArray(rule.knowledgeBlueprint?.uncertaintyNotes)
    ? rule.knowledgeBlueprint.uncertaintyNotes
    : [];
  const lines = [
    '单张生图知识库接地上下文（只允许使用当前张内容）：',
    rule.knowledgeBlueprint?.intent ? `- 知识库整体意图：${sanitizeRuleText(rule.knowledgeBlueprint.intent, 220)}` : '',
    sourceSummaries.length > 0 ? `- 来源摘要：${sourceSummaries.slice(0, 3).map((item) => sanitizeRuleText(item, 160)).filter(Boolean).join('；')}` : '',
    page?.title ? `- 当前张标题：${page.title}` : '',
    page?.focus ? `- 当前张内容边界：${page.focus}` : '',
    page?.sourceLogic ? `- 当前张资料依据：${page.sourceLogic}` : '',
    anchor ? `- 当前张真实知识库内容：${anchor.title}；${anchor.content}` : '',
    anchor?.mustInclude?.length > 0 ? `- 当前张必须出现的词/数值/事实：${anchor.mustInclude.join('；')}` : '',
    anchor?.source ? `- 当前张证据来源：${anchor.source}` : '',
    uncertaintyNotes.length > 0 ? `- 不确定信息提醒：${uncertaintyNotes.slice(0, 3).map((item) => sanitizeRuleText(item, 160)).filter(Boolean).join('；')}` : '',
    '- 注意：规则确认阶段已经读完整份知识库；正式生图阶段不得再从整份知识库全文、其他锚点或其他页面规划中另取内容。',
    '- 当前图片的主标题、知识点、题目、示例、图示和正文只能来自本段列出的当前张内容边界。',
  ].filter(Boolean);

  return lines.join('\n');
}

function composeTeachingAidPrompt(data, index) {
  const assignedItem = data.batchItems[index] || '';
  const imageSpec = [
    data.aspectRatio ? `图片比例必须为 ${data.aspectRatio}` : '',
    getEffectiveImageResolutionMode() === '4k' ? '输出目标为 4K 高清清晰度，画面细节和文字边缘必须清晰。' : '',
  ].filter(Boolean).join('；');
  return [
    hasStyleReference(data)
      ? '请生成一张内容为简体中文的教辅资料图片；视觉设计必须以当次上传的参考风格图为唯一模板。'
      : '请根据用户核心需求生成一张内容为简体中文的图片；图片类型、内容结构和视觉风格都必须由用户提示词和知识库内容决定。',
    imageSpec,
    `用户核心需求：${data.prompt}`,
    composeKnowledgeContentPreservationInstruction(data, index),
    composeCurrentPageKnowledgeAnchor(data, index),
    data.generationRule ? composeConfirmedGenerationRulePrompt(data, index) : '',
    composeSingleImageKnowledgeContext(data, index),
    assignedItem ? `本张专属内容：${assignedItem}` : '',
    data.count > 1 ? `这是批量生成中的第 ${index + 1}/${data.count} 张，请保持整批视觉风格一致，当前页内容不要混入其他页。` : '',
    data.options.layoutFixed ? '排版设计固定：所有页面保持同一版式骨架，只替换当前页专属内容。' : '',
    hasStyleReference(data) ? '参考风格图是唯一设计母版，必须复刻其结构、配色、字体层级、留白和装饰关系。' : '',
    '输出要求：成品是一张完整图片，不要出现网页界面、按钮、水印、品牌标识、乱码或无关装饰；文字清晰可读。',
  ].filter(Boolean).join('\n\n');
}

function composeKnowledgeContentPreservationInstruction(data, index) {
  if (!isKnowledgeContentPreservationRequired(data.prompt)) return '';
  const page = data.generationRule?.pages?.[index] || null;
  const anchor = normalizeKnowledgeAnchor(page?.knowledgeAnchor);

  return [
    '知识库原文逐字保真锁（本次任务最高优先级，不得被版式、风格、规则摘要或模型习惯覆盖）：',
    '- 用户明确要求知识库/资料文字内容不变。本次只允许改变视觉排版、配色和装饰，不允许改变任何原文内容。',
    '- 当前页知识库锚点中的“真实内容”是锁定原文。标题、正文、题干、选项、答案、数字、单位、公式、标点及先后顺序必须逐字照录。',
    '- 禁止摘要、改写、同义替换、润色、纠错、补写、删减、合并句子、改题目、改选项或改答案；即使原文存在错别字或表达不顺，也必须保留。',
    '- 页面规划里的标题方向、核心内容、资料依据和摘要只用于定位，不是可新增到图片里的文案。除非用户在核心需求中明确要求额外文字，图片中的可见文字只能来自锁定原文。',
    '- 如果版面空间不足，优先减少装饰、调整字号和留白；绝不能通过删改、压缩或重写原文解决。',
    '- 输出前逐字核对，任何无法确认的文字都不要猜测。',
    anchor ? `本张锁定原文：\n<<<原文开始>>>\n${anchor.content}\n<<<原文结束>>>` : '',
  ].filter(Boolean).join('\n');
}

function composeConfirmedGenerationRulePrompt(data, index) {
  const rule = data.generationRule;
  if (!rule) return '';
  const page = rule.pages?.[index] || null;
  const hasStyleReferenceImage = hasStyleReference(data);
  const pageAnchor = normalizeKnowledgeAnchor(page?.knowledgeAnchor);
  return [
    '已确认的生成规则逻辑：',
    '规则确认阶段已经完成全量知识库盘点、数量决策和覆盖检查；正式生图阶段只允许使用当前页规则与当前页知识库锚点，不得把全量盘点当成当前图取材池。',
    rule.intentAnalysis ? `意图分析：${rule.intentAnalysis}` : '',
    rule.countStrategy ? `数量决策策略：${rule.countStrategy}` : '',
    rule.summary ? `整体意图：${rule.summary}` : '',
    rule.contentLogic ? `内容逻辑：${rule.contentLogic}` : '',
    rule.contentProductionStrategy ? `内容生产策略：${rule.contentProductionStrategy}` : '',
    hasStyleReferenceImage && (rule.layoutLogic || rule.styleLogic)
      ? '规则中的排版/风格文字只用于理解内容组织；如与当次上传参考风格图有任何冲突，必须忽略规则文字并以参考图为准。'
      : '',
    rule.layoutLogic ? `${hasStyleReferenceImage ? '内容承载逻辑' : '排版逻辑'}：${rule.layoutLogic}` : '',
    rule.styleLogic ? `${hasStyleReferenceImage ? '参考图复刻摘要' : '风格逻辑'}：${rule.styleLogic}` : '',
    rule.styleAdvice ? `风格建议：${rule.styleAdvice}` : '',
    '内容顺序约束：当前第几张由已确认的教学逻辑顺序决定，不由原文件页码决定；如果资料依据里出现页码，页码只表示来源位置，不能把对应源页内容自动搬到同序号生成图里。',
    page
      ? [
          `当前页规则：第 ${index + 1}/${data.count} 张`,
          page.title ? `标题方向：${page.title}` : '',
          page.focus ? `核心内容：${page.focus}` : '',
          page.sourceLogic ? `资料依据：${page.sourceLogic}` : '',
          page.mustInclude?.length > 0 ? `必须包含：${page.mustInclude.join('；')}` : '',
          page.avoid?.length > 0 ? `不要混入：${page.avoid.join('；')}` : '',
          pageAnchor ? [
            '当前页知识库锚点：',
            `标题：${pageAnchor.title}`,
            `真实内容：${pageAnchor.content}`,
            pageAnchor.mustInclude.length > 0 ? `必含内容：${pageAnchor.mustInclude.join('；')}` : '',
            pageAnchor.source ? `来源：${pageAnchor.source}` : '',
          ].filter(Boolean).join('\n') : '',
        ].filter(Boolean).join('\n')
      : '',
    '必须优先服从这份已确认规则；不得遗漏当前页规则列出的核心内容，也不得把其他页内容混入当前页。',
  ].filter(Boolean).join('\n');
}

function createRuleEvidence(data) {
  const context = data.knowledgeContext || createEmptyKnowledgeContext();
  return {
    totalPages: context.totalPages || 0,
    totalTextChars: context.totalTextChars || 0,
    estimatedContentUnits: context.estimatedContentUnits || 0,
    knowledgeImageCount: context.knowledgeImageCount || 0,
    pdfPageImageCount: context.pdfPageImageCount || 0,
    pdfPageImageLimit: context.pdfPageImageLimit || 0,
    files: (context.fileSummaries || []).map((file) => ({
      name: file.name,
      pageCount: file.pageCount || 0,
      textChars: file.textChars || 0,
      headingCount: file.headingCount || 0,
      estimatedUnits: file.estimatedUnits || 0,
      renderedPageCount: file.renderedPageCount || 0,
      sampledPages: Array.isArray(file.sampledPages) ? file.sampledPages.slice(0, 24) : [],
      note: sanitizeRuleText(file.note, 220),
    })),
  };
}

function resolveGenerationRuleCount(rule, data, rawPages = [], rawBatchItems = [], rawContentUnits = []) {
  if (data.count) return data.count;

  const fallbackCount = estimateGenerationCount(data);
  const fallbackFloor = estimateContentPlanningFloor(data);
  const contentEvidenceFloor = estimateRuleContentEvidenceFloor(data, rawContentUnits);
  const recommendedCount = Number(rule?.recommendedCount);
  const explicitCount = Number(rule?.count);
  const validRecommendedCounts = [recommendedCount, explicitCount]
    .filter((candidate) => Number.isInteger(candidate) && candidate >= 1 && candidate <= MAX_GENERATION_COUNT);
  const plannedCounts = [rawPages.length, rawBatchItems.length]
    .filter((candidate) => Number.isInteger(candidate) && candidate >= 1 && candidate <= MAX_GENERATION_COUNT);
  if (validRecommendedCounts.length > 0) {
    return clampInteger(Math.max(...validRecommendedCounts, ...plannedCounts, contentEvidenceFloor), 1, MAX_GENERATION_COUNT);
  }
  if (plannedCounts.length > 0) {
    return clampInteger(Math.max(...plannedCounts, contentEvidenceFloor), 1, MAX_GENERATION_COUNT);
  }

  const contentUnitFallback =
    rawPages.length === 0 && rawBatchItems.length === 0
      ? rawContentUnits.length
      : 0;
  const candidates = [contentUnitFallback, contentEvidenceFloor]
    .filter((candidate) => Number.isInteger(candidate) && candidate >= 1 && candidate <= MAX_GENERATION_COUNT);

  if (candidates.length > 0) {
    return clampInteger(Math.max(...candidates, fallbackFloor), 1, MAX_GENERATION_COUNT);
  }

  return clampInteger(Math.max(fallbackCount, fallbackFloor), 1, MAX_GENERATION_COUNT);
}

function estimateRuleContentEvidenceFloor(data, rawContentUnits = []) {
  if (data.count) return data.count;

  const contentUnitCount = Array.isArray(rawContentUnits) ? rawContentUnits.length : 0;
  const blueprintAnchorCount = countReliableKnowledgeBlueprintAnchors(data);
  const planningFloor = estimateContentPlanningFloor(data);
  return clampInteger(Math.max(contentUnitCount, blueprintAnchorCount, planningFloor, 1), 1, MAX_GENERATION_COUNT);
}

function countReliableKnowledgeBlueprintAnchors(data) {
  const anchors = Array.isArray(data.knowledgeContext?.knowledgeBlueprint?.anchors)
    ? data.knowledgeContext.knowledgeBlueprint.anchors
    : [];
  return anchors
    .map((anchor) => normalizeKnowledgeAnchor(anchor))
    .filter((anchor) => {
      if (!anchor) return false;
      if (anchor.confidence === 'low' && anchor.mustInclude.length === 0 && anchor.content.length < 20) return false;
      return true;
    }).length;
}

function resolveRawGenerationRuleCount(rule, rawPages = [], rawBatchItems = []) {
  const candidates = [
    Number(rule?.recommendedCount),
    Number(rule?.count),
    rawPages.length,
    rawBatchItems.length,
  ].filter((candidate) => Number.isInteger(candidate) && candidate >= 1 && candidate <= MAX_GENERATION_COUNT);

  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

function estimateGenerationCount(data) {
  if (data.count) return data.count;

  const context = data.knowledgeContext || createEmptyKnowledgeContext();
  const explicitCount = estimateExplicitListCount(data.prompt);
  if (explicitCount >= 2) return clampInteger(explicitCount, 1, MAX_GENERATION_COUNT);

  const contextUnitCount = Number(context.estimatedContentUnits) || 0;
  if (contextUnitCount > 0) return clampInteger(contextUnitCount, 1, MAX_GENERATION_COUNT);

  const headingCount = (context.fileSummaries || [])
    .reduce((sum, file) => sum + (Array.isArray(file.headings) ? file.headings.length : 0), 0);
  if (headingCount >= 2) return clampInteger(headingCount, 1, MAX_GENERATION_COUNT);

  return 4;
}

function estimateContentPlanningFloor(data) {
  if (data.count) return data.count;

  const context = data.knowledgeContext || createEmptyKnowledgeContext();
  const unitCount = Number(context.estimatedContentUnits) || 0;
  if (unitCount >= 8 && hasNumberedContentUnitEvidence(context)) {
    return clampInteger(unitCount, 1, MAX_GENERATION_COUNT);
  }
  if (unitCount >= 8) return clampInteger(Math.ceil(unitCount * 0.65), 1, MAX_GENERATION_COUNT);
  if (unitCount > 0) return clampInteger(unitCount, 1, MAX_GENERATION_COUNT);

  return 1;
}

function hasNumberedContentUnitEvidence(context) {
  const headingCount = (context.fileSummaries || [])
    .reduce((sum, file) => sum + (Number(file.headingCount) || 0), 0);
  return headingCount >= 8;
}

function estimateExplicitListCount(prompt) {
  const lines = String(prompt || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const numberedLines = lines.filter((line) => /^(?:[-*•]|\d+[.、．)]|[（(]?\d+[）)])\s*\S/u.test(line));
  if (numberedLines.length >= 2) return numberedLines.length;

  const markerMatch = /(?:分别(?:是|为|生成|对应)?|每张(?:图|图片|页面|卡片)?(?:分别)?(?:是|为)?|知识点(?:分别)?(?:是|为)?|内容(?:分别)?(?:是|为)?|主题(?:分别)?(?:是|为)?)[^：:，。,.\n]{0,24}[：:]\s*([^\n]+)/u.exec(prompt);
  if (!markerMatch?.[1]) return 0;
  return markerMatch[1]
    .replace(/[。；;].*$/u, '')
    .split(/[、，,\/|]+/u)
    .map((item) => cleanText(item, 80))
    .filter(Boolean).length;
}

function createRaisedCountReason(data, rawCount, finalCount) {
  return `${createCountReason(data, finalCount)} AI 返回的数量与页面规划不一致或缺少可用数量，已按可用页面规划和内容线索兜底为 ${finalCount} 张；源文件页数没有作为数量下限。`;
}

function createCountReason(data, count) {
  if (data.countWasUserProvided) return `用户指定生成 ${count} 张。`;

  const context = data.knowledgeContext || createEmptyKnowledgeContext();
  const parts = [];
  if (context.totalTextChars > 0) parts.push(`提取约 ${context.totalTextChars} 个文本字符`);
  const blueprintAnchorCount = countReliableKnowledgeBlueprintAnchors(data);
  if (blueprintAnchorCount > 0) parts.push(`知识库蓝图识别到 ${blueprintAnchorCount} 个可生成内容锚点`);
  if (context.estimatedContentUnits > 0) parts.push('已识别到标题、知识点或文本密度线索');
  if (context.totalPages > 0) parts.push('源文件页数仅作来源定位，不参与数量下限');
  return `${parts.join('，') || '根据知识库内容量、知识点结构、用户意图和页面承载密度'}，建议生成 ${count} 张。`;
}

function createFallbackContentLogic(data) {
  return data.knowledgeContext.promptText
    ? '按知识库中的主题层级、章节、知识点、内容模块和用户目标进行拆分；合并重复内容，保留核心信息，确保用户想生成的重点不遗漏；不默认加入用户未要求的答题类模块。'
    : '按用户提示词中的教学目标拆分为若干独立内容单元，每张图承担一个清晰的学习目标。';
}

function createFallbackLayoutLogic(data) {
  if (hasStyleReference(data)) {
    return '以当次上传参考风格图的真实版式为唯一模板，复刻其结构、栏目、边距、装饰和视觉密度；不要套用任何非参考图来源的默认版式。';
  }
  return data.options.layoutFixed
    ? '整批图片沿用同一用户指定或规则确认后的版式骨架，只替换当前页专属内容；不默认设置用户未要求的功能区。'
    : '整批图片的视觉组织由用户提示词、知识库内容类型和规则确认结果决定；不套用固定模板或默认栏目结构。';
}

function createFallbackStyleLogic(data) {
  return hasStyleReference(data)
    ? '当次上传参考风格图是唯一视觉风格来源；严格复刻其配色、字体层级、边框样式、图标/插画位置、栏目形状、页眉页脚和留白比例。'
    : '视觉风格由用户提示词决定；如果用户未指定风格，则保持清晰、简洁、无水印和无关装饰，不默认套用任何固定模板。';
}

function createRulePagesFromBatchItems(items, data, count = data.count || estimateGenerationCount(data)) {
  const normalizedItems = Array.isArray(items)
    ? items.map((item) => stringifyBatchItemInput(item)).filter(Boolean)
    : [];

  return Array.from({ length: count }, (_, index) =>
    normalizeRulePage(normalizedItems[index] || createFallbackBatchItem(index, data), index, data),
  );
}

function createEmptyKnowledgeContext() {
  return {
    promptText: '',
    textEntries: [],
    imageReferences: [],
    fileNames: [],
    fileSummaries: [],
    totalPages: 0,
    totalTextChars: 0,
    estimatedContentUnits: 0,
    knowledgeImageCount: 0,
    pdfPageImageCount: 0,
    pdfPageImageLimit: 0,
    knowledgeBlueprint: createEmptyKnowledgeBlueprint(),
  };
}

function normalizeAiConfigForStorage(payload, options = {}) {
  const source = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
  if (!source || typeof source !== 'object') return { ok: true, config: createEmptyAiConfig() };
  const rule = normalizeAiChannelConfig(source.rule, '生成规则确认', options);
  if (!rule.ok) return rule;
  const image = normalizeAiChannelConfig(source.image, 'AI 生图', options);
  if (!image.ok) return image;
  return {
    ok: true,
    config: {
      version: AI_CONFIG_VERSION,
      rule: { entries: rule.entries },
      image: {
        resolution: normalizeImageResolutionMode(source.image?.resolution || '4k'),
        entries: image.entries,
      },
    },
  };
}

function createEmptyAiConfig() {
  return { version: AI_CONFIG_VERSION, rule: { entries: [] }, image: { resolution: '4k', entries: [] } };
}

function normalizeAiChannelConfig(channelConfig, label, options = {}) {
  const entries = Array.isArray(channelConfig?.entries)
    ? channelConfig.entries
    : Array.isArray(channelConfig?.providers)
      ? channelConfig.providers
      : [];
  const normalized = [];
  for (const [index, entry] of entries.entries()) {
    const item = normalizeAiProviderEntry(entry, label, index, options);
    if (!item.ok) return item;
    if (item.entry) normalized.push(item.entry);
  }
  return { ok: true, entries: normalized.slice(0, 24) };
}

function normalizeAiProviderEntry(entry, label, index, options = {}) {
  if (!entry || typeof entry !== 'object') return { ok: true, entry: null };
  const baseUrl = normalizeBaseUrl(cleanText(entry.baseUrl || entry.url, 300));
  const model = cleanText(entry.model, 120);
  const apiKeys = normalizeApiKeyList(entry.apiKeys || entry.keys || entry.apiKey);
  const isBlank = !baseUrl && !model && apiKeys.length === 0;
  if (isBlank) return { ok: true, entry: null };
  if (!isValidHttpBaseUrl(baseUrl)) {
    if (options.tolerateInvalid) return { ok: true, entry: null };
    return { ok: false, message: `${label}第 ${index + 1} 个接口 URL 无效，请填写 http(s) 地址` };
  }
  if (!model) {
    if (options.tolerateInvalid) return { ok: true, entry: null };
    return { ok: false, message: `${label}第 ${index + 1} 个接口缺少 MODEL` };
  }
  if (apiKeys.length === 0) {
    if (options.tolerateInvalid) return { ok: true, entry: null };
    return { ok: false, message: `${label}第 ${index + 1} 个接口至少需要 1 个 APIKEY` };
  }
  return { ok: true, entry: { baseUrl, model, apiKeys: apiKeys.slice(0, 60) } };
}

function createAdminConfigResponse() {
  return {
    version: AI_CONFIG_VERSION,
    rule: { entries: cloneAiEntries(aiConfig.rule?.entries) },
    image: {
      resolution: normalizeImageResolutionMode(aiConfig.image?.resolution || '4k'),
      entries: cloneAiEntries(aiConfig.image?.entries),
    },
  };
}

function cloneAiEntries(entries) {
  return Array.isArray(entries)
    ? entries.map((entry) => ({ baseUrl: entry.baseUrl, model: entry.model, apiKeys: [...entry.apiKeys] }))
    : [];
}

function getAiConfigStatus() {
  const ruleEntries = getEffectiveAiEntries('rule');
  const imageEntries = getEffectiveAiEntries('image');
  return {
    ruleConfigured: ruleEntries.length > 0,
    imageConfigured: imageEntries.length > 0,
    imageResolution: getEffectiveImageResolutionMode(),
  };
}

function getEffectiveAiEntries(channel) {
  const savedEntries = channel === 'rule' ? aiConfig.rule?.entries : aiConfig.image?.entries;
  return Array.isArray(savedEntries) ? savedEntries : [];
}

function getEffectiveImageResolutionMode() {
  return normalizeImageResolutionMode(aiConfig.image?.resolution || '4k');
}

function isAiChannelConfigured(channel) {
  return getEffectiveAiEntries(channel).length > 0;
}

function nextAiRoute(channel) {
  const entries = getEffectiveAiEntries(channel);
  if (entries.length === 0) throw new Error(channel === 'rule' ? '未配置生成规则确认接口' : '未配置 AI 生图接口');
  const state = aiRouteState[channel];
  const providerIndex = state.providerCursor % entries.length;
  state.providerCursor += 1;
  const provider = entries[providerIndex];
  const providerKey = `${providerIndex}:${provider.baseUrl}:${provider.model}`;
  const keyCursor = state.keyCursors.get(providerKey) || 0;
  const apiKey = provider.apiKeys[keyCursor % provider.apiKeys.length];
  state.keyCursors.set(providerKey, keyCursor + 1);
  return {
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey,
    label: `${provider.baseUrl} / ${provider.model}`,
  };
}

function resolveAiAttemptLimit(channel, configuredMaxAttempts) {
  const configured = Number(configuredMaxAttempts) || 1;
  return Math.max(1, Math.min(configured, channel === 'image' ? 1 : 3));
}

function resetAiRouteState() {
  for (const state of Object.values(aiRouteState)) {
    state.providerCursor = 0;
    state.keyCursors.clear();
  }
}

function hashPassword(password, salt = randomBytes(PASSWORD_SALT_BYTES).toString('hex')) {
  return { salt, passwordHash: scryptSync(password, salt, PASSWORD_KEY_BYTES).toString('hex') };
}

function verifyPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = scryptSync(password, user.salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createSessionForUser(user) {
  const token = randomBytes(32).toString('hex');
  const session = { token, userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
  appState.sessions.push(session);
  return session;
}

function getRequestUser(request) {
  const token = parseCookies(request)[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = appState.sessions.find((item) => item.token === token);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    appState.sessions = appState.sessions.filter((item) => item.token !== token);
    return null;
  }
  return appState.users.find((user) => user.id === session.userId) || null;
}

function requireAuth(request) {
  const user = getRequestUser(request);
  return user || Object.assign(new Error('unauthorized'), {
    response: jsonResponse(401, { ok: false, message: '请先登录后再使用该功能' }),
  });
}

function requireAdmin(request) {
  const user = getRequestUser(request);
  if (user?.role === 'admin') return user;
  return Object.assign(new Error('forbidden'), {
    response: jsonResponse(user ? 403 : 401, {
      ok: false,
      message: user ? '只有管理员可以访问该后台' : '请先使用管理员账号登录',
    }),
  });
}

function createPublicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, role: user.role, points: user.points, createdAt: user.createdAt };
}

function findUserByUsername(username) {
  const normalized = cleanUsername(username).toLowerCase();
  return appState.users.find((user) => user.username.toLowerCase() === normalized) || null;
}

function ensureSufficientPoints(user, points) {
  if (user.points >= points) return;
  const error = new Error(`积分不足，本次需要 ${points} 积分，当前剩余 ${user.points} 积分`);
  error.statusCode = 402;
  throw error;
}

async function reserveGenerationPoints(userId, data) {
  const env = envRef;
  return runAppStateOperation(async () => {
    await reloadAppStateWithinOperation(env);
    const user = appState.users.find((item) => item.id === userId);
    if (!user) {
      const error = new Error('用户不存在，无法预扣生成积分');
      error.statusCode = 401;
      throw error;
    }
    if (findGenerationBatch(data.batchId)) {
      const error = new Error('该生成批次已经存在，请重新发起生成');
      error.statusCode = 409;
      throw error;
    }

    const reservedPoints = getGenerationChargeCount(data);
    ensureSufficientPoints(user, reservedPoints);
    const now = new Date().toISOString();
    user.points -= reservedPoints;
    user.updatedAt = now;
    const batch = {
      id: data.batchId,
      userId: user.id,
      reservedPoints,
      successCount: 0,
      failedCount: 0,
      refundedPoints: 0,
      imageIndexes: createGenerationImageIndexes(data),
      successIndexes: [],
      failedIndexes: [],
      refundedIndexes: [],
      status: 'running',
      type: data.targetIndex === null ? 'batch' : 'retry',
      createdAt: now,
      lastActivityAt: now,
      finishedAt: '',
      note: data.targetIndex === null ? '' : `重新生成第 ${data.targetIndex + 1} 张`,
    };
    appState.generationBatches.push(batch);
    addPointLog({
      user,
      type: 'generation_reserve',
      points: -reservedPoints,
      batchId: batch.id,
      note: data.targetIndex === null ? `预扣 ${reservedPoints} 张图片生成积分` : `预扣单张重试积分：第 ${data.targetIndex + 1} 张`,
    });
    await persistAppStateWithinOperation(env);
    return {
      batch: {
        ...batch,
        imageIndexes: [...batch.imageIndexes],
        successIndexes: [...batch.successIndexes],
        failedIndexes: [...batch.failedIndexes],
        refundedIndexes: [...batch.refundedIndexes],
      },
      balance: user.points,
    };
  });
}

async function settleGenerationPoints(batch, results, options = {}) {
  if (!batch) return createPointSettlementResponse(batch);
  const env = envRef;
  return runAppStateOperation(async () => {
    await reloadAppStateWithinOperation(env);
    if (options.status !== 'canceled' && (await isGenerationBatchCanceled(batch.id, env))) {
      return createPointSettlementResponse(findGenerationBatch(batch.id));
    }
    const points = await settleGenerationPointsWithinOperation(batch.id, results, options, env);
    if (options.status !== 'canceled' && (await isGenerationBatchCanceled(batch.id, env))) {
      return settleGenerationPointsWithinOperation(batch.id, [], {
        status: 'canceled',
        note: '生成任务已取消，未成功图片已按单张退回积分',
      }, env);
    }
    return points;
  });
}

async function settleGenerationPointsWithinOperation(batchId, results, options, env) {
  const settlementBatch = findGenerationBatch(batchId);
  if (!settlementBatch) return null;
  const cancellationOverride = options.status === 'canceled' && settlementBatch.status !== 'canceled';
  if (settlementBatch.status !== 'running' && !cancellationOverride) {
    return createPointSettlementResponse(settlementBatch);
  }

  ensureGenerationBatchIndexState(settlementBatch);

  const user = appState.users.find((item) => item.id === settlementBatch.userId);
  if (!user) {
    settlementBatch.status = 'failed';
    settlementBatch.finishedAt = new Date().toISOString();
    settlementBatch.note = '用户不存在，无法结算积分';
    await persistAppStateWithinOperation(env);
    return createPointSettlementResponse(settlementBatch);
  }
  const normalizedResults = Array.isArray(results) ? results.filter(Boolean) : [];
  for (const result of normalizedResults) {
    mergeGenerationImageResult(settlementBatch, result);
  }

  const successSet = new Set(settlementBatch.successIndexes);
  const missingIndexes = settlementBatch.imageIndexes.filter((imageIndex) => !successSet.has(imageIndex));
  const now = new Date().toISOString();
  for (const imageIndex of missingIndexes) {
    addGenerationIndex(settlementBatch.failedIndexes, imageIndex);
    refundGenerationImageIndex(user, settlementBatch, imageIndex, now);
  }
  settlementBatch.successCount = settlementBatch.successIndexes.length;
  settlementBatch.failedCount = missingIndexes.length;
  settlementBatch.refundedPoints = settlementBatch.refundedIndexes.length;
  settlementBatch.status = options.status || 'done';
  settlementBatch.lastActivityAt = now;
  settlementBatch.finishedAt = now;
  settlementBatch.note = cleanText(options.note, 300);
  settlementBatch.lastError = cleanText(
    normalizedResults.find((result) => result?.status !== 'ok')?.error || options.note,
    500,
  );
  await persistAppStateWithinOperation(env);
  return createPointSettlementResponse(settlementBatch);
}

async function recordGenerationImageResult(batch, result) {
  if (!batch || !result) return createPointSettlementResponse(batch);
  const env = envRef;
  return runAppStateOperation(async () => {
    await reloadAppStateWithinOperation(env);
    if (await isGenerationBatchCanceled(batch.id, env)) {
      return createPointSettlementResponse(findGenerationBatch(batch.id));
    }

    const settlementBatch = findGenerationBatch(batch.id);
    if (!settlementBatch) return null;
    if (settlementBatch.status !== 'running') return createPointSettlementResponse(settlementBatch);
    ensureGenerationBatchIndexState(settlementBatch);

    const user = appState.users.find((item) => item.id === settlementBatch.userId);
    if (!user) return createPointSettlementResponse(settlementBatch);

    const changed = mergeGenerationImageResult(settlementBatch, result);
    const imageIndex = Number(result.index);
    const now = new Date().toISOString();
    settlementBatch.lastActivityAt = now;
    if (result.status !== 'ok' && settlementBatch.imageIndexes.includes(imageIndex)) {
      refundGenerationImageIndex(user, settlementBatch, imageIndex, now);
      settlementBatch.lastError = cleanText(result.error, 500);
    }

    settlementBatch.successCount = settlementBatch.successIndexes.length;
    settlementBatch.failedCount = settlementBatch.failedIndexes.length;
    settlementBatch.refundedPoints = settlementBatch.refundedIndexes.length;
    if (changed) {
      await persistAppStateWithinOperation(env);
    }
    return createPointSettlementResponse(settlementBatch);
  });
}

function mergeGenerationImageResult(batch, result) {
  const imageIndex = Number(result?.index);
  if (!Number.isInteger(imageIndex) || !batch.imageIndexes.includes(imageIndex)) return false;
  if (result.status === 'ok') {
    if (batch.refundedIndexes.includes(imageIndex)) return false;
    return addGenerationIndex(batch.successIndexes, imageIndex);
  }
  return addGenerationIndex(batch.failedIndexes, imageIndex);
}

function refundGenerationImageIndex(user, batch, imageIndex, now = new Date().toISOString()) {
  if (batch.successIndexes.includes(imageIndex) || batch.refundedIndexes.includes(imageIndex)) return false;
  addGenerationIndex(batch.refundedIndexes, imageIndex);
  user.points += 1;
  user.updatedAt = now;
  addPointLog({
    user,
    type: 'generation_refund',
    points: 1,
    batchId: batch.id,
    imageIndex,
    note: `第 ${imageIndex + 1} 张未成功，退回 1 积分`,
  });
  return true;
}

function ensureGenerationBatchIndexState(batch) {
  batch.imageIndexes = normalizeGenerationIndexList(batch.imageIndexes);
  if (batch.imageIndexes.length === 0) {
    batch.imageIndexes = Array.from({ length: batch.reservedPoints }, (_, index) => index);
  }
  batch.successIndexes = normalizeGenerationIndexList(batch.successIndexes).filter((index) =>
    batch.imageIndexes.includes(index),
  );
  batch.failedIndexes = normalizeGenerationIndexList(batch.failedIndexes).filter((index) =>
    batch.imageIndexes.includes(index),
  );
  batch.refundedIndexes = normalizeGenerationIndexList(batch.refundedIndexes).filter((index) =>
    batch.imageIndexes.includes(index),
  );
}

function createGenerationImageIndexes(data) {
  if (data.targetIndex !== null && Number.isInteger(Number(data.targetIndex))) {
    return [Number(data.targetIndex)];
  }
  return Array.from({ length: getGenerationChargeCount(data) }, (_, index) => index);
}

function addGenerationIndex(list, imageIndex) {
  if (!Number.isInteger(imageIndex) || list.includes(imageIndex)) return false;
  list.push(imageIndex);
  list.sort((a, b) => a - b);
  return true;
}

function findGenerationBatch(batchId) {
  return appState.generationBatches.find((item) => item.id === cleanText(batchId, 80)) || null;
}

async function markGenerationBatchCanceled(batchId, env = envRef) {
  const normalized = normalizeGenerationBatchId(batchId);
  if (!normalized) return;
  canceledGenerationBatchIds.add(normalized);
  await env.TLSJF_KV.put(`${GENERATION_CANCEL_PREFIX}${normalized}`, '1', {
    expirationTtl: GENERATION_CANCEL_TTL_SECONDS,
  });
}

async function isGenerationBatchCanceled(batchId, env = envRef) {
  const normalized = cleanText(batchId, 80);
  if (!normalized) return false;
  if (canceledGenerationBatchIds.has(normalized)) return true;
  const storedMarker = await env.TLSJF_KV.get(`${GENERATION_CANCEL_PREFIX}${normalized}`, 'text');
  return canceledGenerationBatchIds.has(normalized) || Boolean(storedMarker);
}

async function assertGenerationBatchActive(data) {
  if (await isGenerationBatchCanceled(data.batchId)) {
    const error = new Error('生成任务已取消，未完成图片已退回积分');
    error.statusCode = 409;
    throw error;
  }
}

function createPointSettlementResponse(batch) {
  if (!batch) return null;
  const user = appState.users.find((item) => item.id === batch.userId);
  return {
    batchId: batch.id,
    reserved: batch.reservedPoints,
    success: batch.successCount,
    failed: batch.failedCount,
    refunded: batch.refundedPoints,
    balance: user?.points ?? 0,
  };
}

function addPointLog({ user, type, points, batchId = '', imageIndex = null, note = '', status = 'success' }) {
  const log = {
    id: randomUUID(),
    userId: user.id,
    type,
    points,
    balanceAfter: user.points,
    batchId,
    imageIndex,
    status,
    note: cleanText(note, 300),
    createdAt: new Date().toISOString(),
  };
  appState.pointLogs.push(log);
  trimOperationalHistory();
  return log;
}

function trimOperationalHistory() {
  appState.pointLogs = appState.pointLogs.slice(-2000);
  const runningBatches = appState.generationBatches.filter((batch) => batch.status === 'running');
  const terminalBatches = appState.generationBatches.filter((batch) => batch.status !== 'running').slice(-1000);
  appState.generationBatches = [...runningBatches, ...terminalBatches]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  appState.sessions = appState.sessions.filter((session) => Date.parse(session.expiresAt) > Date.now());
}

function getGenerationChargeCount(data) {
  return data.targetIndex === null ? data.count : 1;
}

function createRedeemCodeValue() {
  let raw = '';
  while (raw.length < 16) raw += REDEEM_CODE_ALPHABET[randomBytes(1)[0] % REDEEM_CODE_ALPHABET.length];
  return formatRedeemCode(raw);
}

function findRedeemCode(value) {
  const normalized = normalizeRedeemCode(value);
  return appState.redeemCodes.find((item) => normalizeRedeemCode(item.code) === normalized) || null;
}

function normalizeRedeemCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
}

function formatRedeemCode(value) {
  const normalized = normalizeRedeemCode(value);
  return normalized.match(/.{1,4}/g)?.join('-') || normalized;
}

function parseOptionalGenerationCount(value) {
  if (value === undefined || value === null || value === '') return { ok: true, count: 0 };
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATION_COUNT) {
    return { ok: false, message: `单次生成数量必须是 1 到 ${MAX_GENERATION_COUNT} 的整数，或留空由 AI 判断` };
  }
  return { ok: true, count };
}

function normalizeReferenceImage(image) {
  if (!image || typeof image !== 'object') return null;
  const name = cleanText(image.name, 120) || 'reference.png';
  const mimeType = cleanText(image.mimeType, 40);
  const dataUrl = typeof image.dataUrl === 'string' ? image.dataUrl : '';
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) return null;
  if (!dataUrl.startsWith(`data:${mimeType};base64,`)) return null;
  return { name, mimeType, dataUrl };
}

function normalizeKnowledgeFile(file) {
  if (!file || typeof file !== 'object') return null;
  const name = cleanText(file.name, 160) || 'knowledge-file';
  const dataUrl = typeof file.dataUrl === 'string' ? file.dataUrl : '';
  const dataUrlMimeType = readDataUrlMimeType(dataUrl);
  const declaredMimeType = cleanText(file.mimeType, 80);
  const mimeType = resolveKnowledgeMimeType(name, dataUrlMimeType) || resolveKnowledgeMimeType(name, declaredMimeType);
  if (!mimeType || !ALLOWED_KNOWLEDGE_MIME_TYPES.has(mimeType)) return null;
  if (!dataUrlMimeType || !dataUrl.startsWith('data:')) return null;
  return {
    name,
    mimeType,
    dataUrl,
    size: Number.isFinite(Number(file.size)) ? Number(file.size) : 0,
  };
}

function normalizeGenerationRulePayload(rule, count) {
  if (!rule || typeof rule !== 'object') return null;
  const pages = Array.isArray(rule.pages)
    ? rule.pages.slice(0, count).map((page, index) => normalizeRulePage(page, index, { count, prompt: '', batchItems: [] }))
    : [];
  return {
    intentAnalysis: sanitizeRuleText(rule.intentAnalysis, 1000),
    countStrategy: sanitizeRuleText(rule.countStrategy, 1200),
    summary: sanitizeRuleText(rule.summary, 800),
    contentLogic: sanitizeRuleText(rule.contentLogic, 1200),
    contentProductionStrategy: sanitizeRuleText(rule.contentProductionStrategy, 1200),
    layoutLogic: sanitizeRuleText(rule.layoutLogic, 1200),
    styleLogic: sanitizeRuleText(rule.styleLogic, 1200),
    styleAdvice: sanitizeRuleText(rule.styleAdvice, 1000),
    contentInventory: normalizeStringList(rule.contentInventory, RULE_CONTENT_INVENTORY_MAX_ITEMS, 280),
    contentUnits: normalizeStringList(rule.contentUnits, MAX_GENERATION_COUNT, 180),
    contentHierarchy: normalizeStringList(rule.contentHierarchy, MAX_GENERATION_COUNT, 260),
    coverageMap: normalizeStringList(rule.coverageMap, MAX_GENERATION_COUNT, 260),
    coverageChecklist: normalizeStringList(rule.coverageChecklist, RULE_COVERAGE_CHECKLIST_MAX_ITEMS, 260),
    coverageAudit: normalizeStringList(rule.coverageAudit, RULE_COVERAGE_CHECKLIST_MAX_ITEMS, 280),
    riskNotes: normalizeStringList(rule.riskNotes, RULE_RISK_NOTES_MAX_ITEMS, 260),
    knowledgeBlueprint: normalizeKnowledgeBlueprintPayload(rule.knowledgeBlueprint),
    pages,
    batchItems: Array.isArray(rule.batchItems)
      ? rule.batchItems.slice(0, count).map((item) => cleanText(stringifyBatchItemInput(item), BATCH_ITEM_MAX_CHARS)).filter(Boolean)
      : [],
  };
}

function normalizeRulePage(page, index, data) {
  if (typeof page === 'string') {
    const focus = sanitizeRuleText(page, BATCH_ITEM_MAX_CHARS);
    return {
      index,
      title: `第 ${index + 1} 张`,
      focus: isBadRuleFocus(focus) ? createFallbackBatchItem(index, data) : focus || createFallbackBatchItem(index, data),
      sourceLogic: '',
      mustInclude: [],
      avoid: [],
      knowledgeAnchorIndex: -1,
      knowledgeAnchor: null,
    };
  }

  const title = sanitizeRuleText(page?.title, 120);
  const focus = sanitizeRuleText(page?.focus, BATCH_ITEM_MAX_CHARS);
  const anchorIndex = Number(page?.knowledgeAnchorIndex);
  return {
    index,
    title: isBadRuleFocus(title) ? `第 ${index + 1} 张` : title || `第 ${index + 1} 张`,
    focus: isBadRuleFocus(focus) ? createFallbackBatchItem(index, data) : focus || createFallbackBatchItem(index, data),
    sourceLogic: sanitizeRuleText(page?.sourceLogic, 260),
    mustInclude: normalizeStringList(page?.mustInclude, 12, 200),
    avoid: normalizeStringList(page?.avoid, 6, 140),
    knowledgeAnchorIndex: Number.isInteger(anchorIndex) ? anchorIndex : -1,
    knowledgeAnchor: normalizeKnowledgeAnchor(page?.knowledgeAnchor),
  };
}

function formatRulePageBatchItem(page) {
  return cleanText([
    page.title,
    page.focus,
    page.sourceLogic ? `资料依据：${page.sourceLogic}` : '',
    page.mustInclude.length > 0 ? `必须包含：${page.mustInclude.join('；')}` : '',
    page.avoid.length > 0 ? `避免混入：${page.avoid.join('；')}` : '',
    page.knowledgeAnchor ? `知识库锚点：${page.knowledgeAnchor.title}；${page.knowledgeAnchor.content}` : '',
  ].filter(Boolean).join('。'), BATCH_ITEM_MAX_CHARS);
}

function createFallbackBatchItem(index, data) {
  if (data.batchItems?.[index]) return data.batchItems[index];

  const unit = resolveKnowledgeContentUnitForIndex(index, data);
  if (unit) {
    if (unit.heading) {
      return `第 ${index + 1} 张：围绕逻辑内容单元「${unit.heading}」生成教辅页面；按知识结构和教学顺序组织内容，不按原文件页码顺序分配。`;
    }
    return `第 ${index + 1} 张：覆盖《${unit.file.name}》中第 ${unit.unitNumber} 个逻辑内容板块，按用户提示词和资料本身提炼该板块需要呈现的标题、知识点、图文信息、案例或任务；源页码只作证据，不决定本张顺序。`;
  }

  return `第 ${index + 1} 张：整理知识库中按教学逻辑排序后的第 ${index + 1} 个核心内容单元，不按原文件页码机械对应。`;
}

function stringifyBatchItemInput(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return [value.title, value.focus, value.sourceLogic ? `资料依据：${value.sourceLogic}` : ''].filter(Boolean).join('。');
}

function resolveKnowledgeContentUnitForIndex(index, data) {
  const files = data.knowledgeContext?.fileSummaries || [];
  if (files.length === 0) return null;

  let cursor = 0;
  for (const file of files) {
    const headings = Array.isArray(file.headings) ? file.headings.filter(Boolean) : [];
    const units = Math.max(Number(file.estimatedUnits) || 0, headings.length, 1);
    if (index < cursor + units) {
      const localIndex = index - cursor;
      return {
        file,
        unitNumber: localIndex + 1,
        heading: headings[localIndex] || '',
      };
    }
    cursor += units;
  }

  const lastFile = files[files.length - 1];
  const headings = Array.isArray(lastFile.headings) ? lastFile.headings.filter(Boolean) : [];
  return {
    file: lastFile,
    unitNumber: Math.max(1, Number(lastFile.estimatedUnits) || 1),
    heading: headings.at(-1) || '',
  };
}

function sanitizeRuleText(value, maxLength) {
  return cleanText(stripNonDisplayRuleNoise(stringifyRuleTextValue(value)), maxLength);
}

function stringifyRuleTextValue(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyRuleTextValue).filter(Boolean).join('；');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value || '');
}

function stripNonDisplayRuleNoise(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/giu, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, ' ')
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gu, ' ')
    .replace(/[A-Za-z0-9+/=_-]{180,}/gu, ' ')
    .replace(/\[image_\d+\]/giu, ' ')
    .replace(/<img[^>]*>/giu, ' ');
}

function isBadRuleFocus(value) {
  const text = cleanText(value, 80).replace(/[“”"'\s，。；:：、]/gu, '');
  if (!text) return true;
  return (
    /^(不要遗漏|别遗漏|确保不要遗漏|参考风格一样|风格一样|根据知识库内容|知识库内容|生成图片|独立页面|页面规划)$/u.test(text) ||
    /^(?:原文|原文件|资料|PDF)?第?\d+页(?:内容|核心内容|知识点|页面|资料)?$/iu.test(text)
  );
}

function createAutoBatchItems(prompt, count) {
  return Array.from({ length: count }, (_, index) => cleanText(`第 ${index + 1} 张：${prompt}`, BATCH_ITEM_MAX_CHARS));
}

function resolveImageRatio(aspectRatio, customAspectRatio) {
  const ratio = cleanText(aspectRatio, 40);
  if (ratio === 'custom') {
    const custom = cleanText(customAspectRatio, 40);
    return { label: custom || '自定义比例', size: ASPECT_RATIO_SIZES.get('9:16') };
  }
  const size = ASPECT_RATIO_SIZES.get(ratio) || ASPECT_RATIO_SIZES.get('9:16');
  return { label: ratio || '9:16', size };
}

function resolveImageRequestSize(data) {
  if (getEffectiveImageResolutionMode() !== '4k') return data.size || '1024x1536';
  return resolveGptImage2FourKSize(data.aspectRatio);
}

function resolveGptImage2FourKSize(aspectRatio) {
  const ratio = clampRatioForGptImage2(parseAspectRatioNumber(aspectRatio) || (9 / 16));
  const isLandscapeOrSquare = ratio >= 1;
  const longToShortRatio = isLandscapeOrSquare ? ratio : 1 / ratio;
  const shortLimitByEdge = GPT_IMAGE_2_MAX_EDGE / longToShortRatio;
  const shortLimitByPixels = Math.sqrt(GPT_IMAGE_2_MAX_PIXELS / longToShortRatio);
  let shortSide = floorToMultipleOf16(Math.min(GPT_IMAGE_2_MAX_EDGE, shortLimitByEdge, shortLimitByPixels));
  let longSide = floorToMultipleOf16(shortSide * longToShortRatio);

  while (
    shortSide * longSide > GPT_IMAGE_2_MAX_PIXELS ||
    longSide > GPT_IMAGE_2_MAX_EDGE ||
    longSide / shortSide > 3
  ) {
    shortSide = floorToMultipleOf16(shortSide - 16);
    longSide = floorToMultipleOf16(shortSide * longToShortRatio);
  }

  while (shortSide * longSide < GPT_IMAGE_2_MIN_PIXELS) {
    shortSide += 16;
    longSide = floorToMultipleOf16(shortSide * longToShortRatio);
  }

  const width = isLandscapeOrSquare ? longSide : shortSide;
  const height = isLandscapeOrSquare ? shortSide : longSide;
  return `${width}x${height}`;
}

function parseAspectRatioNumber(value) {
  const text = cleanText(value, 24);
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/u.exec(text);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
}

function clampRatioForGptImage2(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 9 / 16;
  return Math.min(3, Math.max(1 / 3, ratio));
}

function floorToMultipleOf16(value) {
  return Math.max(16, Math.floor(value / 16) * 16);
}

function resolveKnowledgeMimeType(name, mimeType) {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  if (ALLOWED_KNOWLEDGE_MIME_TYPES.has(normalizedMimeType)) return normalizedMimeType;
  const inferred = KNOWLEDGE_MIME_BY_EXTENSION.get(getExtension(name).toLowerCase());
  return inferred || '';
}

function readDataUrlMimeType(dataUrl) {
  const match = /^data:([^;,]+)[;,]/u.exec(String(dataUrl || ''));
  return match ? match[1].toLowerCase() : '';
}

function dataUrlToBuffer(dataUrl, declaredMimeType) {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(String(dataUrl || ''));
  if (!match) throw new Error('data URL 格式无效');
  const mimeType = cleanText(declaredMimeType, 80) || match[1].toLowerCase();
  return { buffer: Buffer.from(match[2], 'base64'), mimeType };
}

function parsePdfPageEvidenceImage(name) {
  const match = /第\s*(\d+)\s*页内容截图/u.exec(String(name || ''));
  if (!match) return null;
  const pageNumber = Number(match[1]);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
  return { pageNumber };
}

function normalizeKnowledgeText(value) {
  return String(value || '').replace(/\u0000/g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function truncateKnowledgeTextEntries(textEntries, totalTextMaxChars) {
  const entries = [];
  let remaining = totalTextMaxChars;
  for (const entry of textEntries) {
    if (remaining <= 0) break;
    const text = String(entry.text || '').slice(0, remaining);
    if (text) entries.push({ name: entry.name, text });
    remaining -= text.length;
  }
  return entries;
}

function composeKnowledgePromptText(textEntries, imageReferences, skippedFiles, options = {}) {
  const hasFileSummaries = Array.isArray(options.fileSummaries) && options.fileSummaries.length > 0;
  if (textEntries.length === 0 && imageReferences.length === 0 && skippedFiles.length === 0 && !hasFileSummaries) {
    return '';
  }

  const lines = [
    '知识库要求：',
    '- 生成图片中的标题、知识点、图示说明、事实表述和具体内容结构必须优先结合知识库内容。',
    '- 只有当知识库或用户提示词明确包含特定内容模块时，才把这些元素纳入生成内容；不得默认添加用户未要求的模块。',
    '- 如果知识库与全局提示词存在冲突，由全局提示词决定筛选角度和呈现方式，但不要编造与知识库相冲突的事实。',
    '- 如果知识库文本摘录出现乱码、断字、无意义字符或明显缺漏，必须优先依据页面截图、知识库图片和可读标题线索识别真实内容，不要把乱码当成内容本身。',
  ];

  if (hasFileSummaries) {
    lines.push('知识库结构清单：');
    lines.push(
      `- 已提取文本量：${options.totalTextChars || 0} 字符。注意：请直接阅读文本、标题线索和图片证据来规划内容；源文件页数、截图数量和上传图片数量都不能作为生成图片数量依据。`,
    );
    for (const file of options.fileSummaries) {
      lines.push(
        `- ${file.name}：${file.note || '已作为知识库内容证据读取'}`,
      );
      if (Array.isArray(file.headings) && file.headings.length > 0) {
        lines.push(`  标题线索：${file.headings.slice(0, 12).join('；')}`);
      }
    }
  }

  if (imageReferences.length > 0) {
    lines.push(
      `- 已提供 ${imageReferences.length} 张知识库图片，它们只用于读取教材截图、题目、图表或知识内容；不要把知识库图片当成参考风格。`,
      '- 规则确认阶段必须先从这些视觉证据中提取可见标题、题干、题型、知识点、步骤、表格和图示含义，并把提取结果写入 contentInventory、contentUnits、coverageAudit 和每张 pages 的 mustInclude；后续生图阶段只会执行这些文字化锚点。',
    );
    const renderedPdfPageCount = hasFileSummaries
      ? options.fileSummaries.reduce((sum, file) => sum + (file.renderedPageCount || 0), 0)
      : 0;
    if (renderedPdfPageCount > 0) {
      lines.push(
        `- 其中 ${renderedPdfPageCount} 张为规则确认阶段渲染的 PDF 页面截图；请优先从截图和文本识别主题层级和内容单元，未渲染页面只作为可能仍有内容的提醒，不作为数量依据。`,
      );
    }
  }

  if (textEntries.length > 0) {
    lines.push('知识库文本摘录：');
    let remaining = options.totalTextMaxChars || 18000;
    for (const entry of textEntries) {
      if (remaining <= 0) break;
      const text = entry.text.slice(0, remaining);
      remaining -= text.length;
      lines.push(`【${entry.name}】\n${text}`);
    }
  }

  if (skippedFiles.length > 0) {
    lines.push(`知识库读取备注：${skippedFiles.slice(0, 8).join('；')}`);
  }

  return lines.join('\n');
}

function formatKnowledgeExtractionError(error) {
  const message = formatErrorMessage(error);
  return message || '读取失败';
}

function extractKnowledgeHeadings(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 2 && line.length <= 80)
    .filter((line) => /^(?:第[一二三四五六七八九十百\d]+[章节课讲单元]|[一二三四五六七八九十\d]+[、.．)]|专题|模块|知识点|考点|训练|练习)/u.test(line))
    .slice(0, MAX_GENERATION_COUNT);
}

function estimateContentUnitsFromEvidence({ mimeType, pageCount, text, headings }) {
  const textChars = String(text || '').length;
  const headingCount = Array.isArray(headings) ? headings.length : 0;
  const textDensityUnits = Math.ceil(textChars / DEFAULT_CONTENT_UNITS_PER_TEXT_CHARS);
  return clampInteger(Math.max(headingCount, textDensityUnits, 1), 1, MAX_GENERATION_COUNT);
}

function createKnowledgeContentNote(mimeType, pageCount, textChars, headingCount, estimatedUnits) {
  const parts = [];
  if (pageCount > 0) parts.push('PDF 页码仅作来源定位');
  if (textChars > 0) parts.push(`${textChars} 字符`);
  if (headingCount > 0) parts.push(`${headingCount} 个标题/编号线索`);
  if (estimatedUnits > 0) parts.push('已提取文本/标题线索供 AI 规划内容单元');
  if (mimeType === 'application/pdf' && textChars < 80 && pageCount > 0) {
    parts.push('疑似扫描或图片型 PDF，需结合页面截图识别真实章节和题型，不按页数决定生成数量');
  }
  return parts.join('，');
}

async function extractKnowledgeContent(buffer, mimeType, name) {
  const rawText = await extractKnowledgeText(buffer, mimeType, name);
  const text = normalizeKnowledgeText(rawText);
  const headings = extractKnowledgeHeadings(text);
  const pageCount = mimeType === 'application/pdf' ? estimatePdfPageCountFromBuffer(buffer) : 0;
  const estimatedUnits = estimateContentUnitsFromEvidence({
    mimeType,
    pageCount,
    text,
    headings,
  });

  return {
    text,
    pageCount,
    textChars: text.length,
    headings,
    estimatedUnits,
    note: createKnowledgeContentNote(mimeType, pageCount, text.length, headings.length, estimatedUnits),
  };
}

async function extractKnowledgeText(buffer, mimeType, name) {
  if (mimeType === 'application/pdf') return '';
  if (mimeType === WORD_DOCX_MIME_TYPE) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }
  if (mimeType === 'application/msword') return extractLegacyWordText(buffer);
  if (mimeType === 'text/html') return stripHtml(buffer.toString('utf8'));
  if (mimeType === 'application/json') return stringifyJsonKnowledge(buffer.toString('utf8'), name);
  return buffer.toString('utf8');
}

function estimatePdfPageCountFromBuffer(buffer) {
  const text = buffer.toString('latin1');
  return (text.match(/\/Type\s*\/Page\b/g) || []).length;
}

function extractLegacyWordText(buffer) {
  const utf8Text = buffer.toString('utf8');
  const utf16Text = buffer.toString('utf16le');
  return [utf8Text, utf16Text]
    .map(extractReadableTextRuns)
    .filter(Boolean)
    .join('\n');
}

function extractReadableTextRuns(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/gu, ' ')
    .split(/[^\p{Script=Han}A-Za-z0-9，。！？、；：“”‘’（）《》【】+\-*/=<>%.\s]+/u)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter((part) => part.length >= 2)
    .join('\n');
}

function stringifyJsonKnowledge(value, name) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return `${name}\n${value}`;
  }
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ');
}

async function parseApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return { text: await response.text() };
}

function extractText(payload) {
  return payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || payload?.text || '';
}

function extractImage(payload) {
  const image = findImageInPayload(payload);
  if (!image) {
    throw new Error('图片生成接口未返回可识别的图片数据');
  }
  return image;
}

function findImageInPayload(value, depth = 0) {
  if (!value || depth > 6) return null;

  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return value;

    const dataUrlMatch = value.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/u);
    if (dataUrlMatch) return dataUrlMatch[0];

    const markdownUrlMatch = value.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/u);
    if (markdownUrlMatch) return markdownUrlMatch[1];

    const directUrlMatch = value.match(/https?:\/\/[^\s)"']+/u);
    if (directUrlMatch && looksLikeImageUrl(directUrlMatch[0])) return directUrlMatch[0];

    if (looksLikeBase64Image(value)) return `data:image/png;base64,${value}`;
    return null;
  }

  if (typeof value === 'object') {
    const directBase64 = value.b64_json || value.base64 || value.image_base64 || value.data;
    if (typeof directBase64 === 'string' && looksLikeBase64Image(directBase64)) {
      const mimeType = normalizeImageMimeType(value.mime_type || value.mimeType) || 'image/png';
      return `data:${mimeType};base64,${directBase64}`;
    }

    const directUrl = value.url || value.image_url;
    if (typeof directUrl === 'string' && looksLikeImageUrl(directUrl)) return directUrl;

    if (value.image_url && typeof value.image_url === 'object') {
      const nestedUrl = value.image_url.url;
      if (typeof nestedUrl === 'string' && looksLikeImageUrl(nestedUrl)) return nestedUrl;
    }

    const values = Array.isArray(value) ? value : Object.values(value);
    for (const item of values) {
      const found = findImageInPayload(item, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function createApiError(response, payload, label) {
  const rawMessage = payload?.error?.message || payload?.message || payload?.text || `${label} HTTP ${response.status}`;
  const message = normalizeAiApiErrorMessage(response.status, rawMessage);
  const error = new Error(message);
  error.statusCode = response.status;
  return error;
}

function normalizeAiApiErrorMessage(status, message) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (Number(status) === 524 || /\b524\b/u.test(text)) {
    return 'AI 生图接口响应超时，系统已自动重试但本张图片仍未返回，请稍后点击本张图片重试。';
  }
  if (Number(status) === 429) {
    return 'AI 生图接口当前繁忙或额度受限，系统已自动轮询重试但仍未成功，请稍后重试。';
  }
  return text || 'AI 生图接口请求失败';
}

function parseJsonObjectFromText(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [text, fenced?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function normalizeApiKeyList(value) {
  const rawItems = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  const keys = [];
  const seen = new Set();
  for (const rawItem of rawItems) {
    const key = String(rawItem || '').trim().slice(0, 2048);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/g, '');
}

function isValidHttpBaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeImageResolutionMode(value) {
  const mode = String(value || '').toLowerCase();
  return IMAGE_RESOLUTION_MODES.has(mode) ? mode : '4k';
}

function cleanUsername(value) {
  return String(value || '').replace(/\s+/g, '').trim().slice(0, 40);
}

function isValidUsername(value) {
  return /^[\p{L}\p{N}_@.-]{3,40}$/u.test(value);
}

function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 6 && value.length <= 72;
}

function parseCookies(request) {
  const header = String(request.headers.get('cookie') || '');
  return Object.fromEntries(header.split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex === -1) return [item, ''];
    return [decodeURIComponent(item.slice(0, separatorIndex)), decodeURIComponent(item.slice(separatorIndex + 1))];
  }));
}

function createSessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function createExpiredSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

async function readJsonBody(request) {
  return request.json().catch(() => ({}));
}

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function cleanText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeStringList(value, maxItems, maxLength) {
  return Array.isArray(value) ? value.map((item) => sanitizeRuleText(item, maxLength)).filter(Boolean).slice(0, maxItems) : [];
}

function clampInteger(value, min, max) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function safeFileName(value) {
  return String(value || 'file').replace(/[^\p{Script=Han}A-Za-z0-9._-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'file';
}

function createReferenceUploadFileName(name, mimeType) {
  const extension = IMAGE_FILE_EXTENSIONS.get(mimeType) || 'png';
  const baseName = safeFileName(name).replace(/\.[^.]+$/u, '') || 'reference';
  return `${baseName}.${extension}`;
}

function getExtension(name) {
  const match = /\.[^.\\/]+$/u.exec(String(name || ''));
  return match ? match[0] : '';
}

function normalizeImageMimeType(value) {
  const mimeType = String(value || '').split(';')[0].trim().toLowerCase();
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : '';
}

function sniffImageMimeType(bufferLike) {
  const buffer = Buffer.from(bufferLike);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

function looksLikeBase64Image(value) {
  const text = String(value || '').trim();
  if (text.length < 40 || !/^[A-Za-z0-9+/_=-]+$/u.test(text)) return false;
  try {
    const normalized = text.replace(/-/gu, '+').replace(/_/gu, '/');
    return Boolean(sniffImageMimeType(Buffer.from(normalized.slice(0, 64), 'base64')));
  } catch {
    return false;
  }
}

function looksLikeImageUrl(value) {
  return (
    typeof value === 'string' &&
    (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:image/'))
  );
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

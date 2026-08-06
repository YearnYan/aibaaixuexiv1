import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const GENERATED_DIR = path.join(PUBLIC_DIR, 'generated');
const DATA_DIR = path.join(__dirname, 'data');
const AI_CONFIG_PATH = path.join(DATA_DIR, 'ai-config.json');
const APP_STATE_PATH = path.join(DATA_DIR, 'app-state.json');
const GENERATED_URL_PREFIX = '/generated';
const MAX_BODY_BYTES = 96 * 1024 * 1024;
const MAX_GENERATION_COUNT = 120;
const APP_STATE_VERSION = 1;
const SESSION_COOKIE_NAME = 'k12_session';
const PROFILE_COOKIE_NAME = 'aiba_profile';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;
const REDEEM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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
const RULE_PDF_PAGE_IMAGE_MAX_COUNT = 60;
const RULE_PDF_PAGE_IMAGE_WIDTH = 720;
const RULE_GENERATION_MAX_TOKENS = 16000;
const AI_CONFIG_VERSION = 2;
const IMAGE_RESOLUTION_MODES = new Set(['standard', '4k']);
const PLATFORM_AI_SITE_DEFINITIONS = Object.freeze([
  { id: 'AI丢分诊断器', label: 'AI丢分诊断器' },
  { id: 'AI提分空间评测器', label: 'AI提分空间评测器' },
  { id: 'AI错因判断器', label: 'AI错因判断器' },
  { id: 'AI得分点拆解器', label: 'AI得分点拆解器' },
  { id: 'AI审题器', label: 'AI审题器' },
  { id: '卷后提分试卷分析', label: '卷后提分试卷分析' },
  { id: '错题归因追分器', label: '错题归因追分器' },
  { id: '知识查缺补漏器', label: '知识查缺补漏器' },
  { id: 'AI解题步骤器', label: 'AI解题步骤器' },
  { id: 'AI题型提分卡', label: 'AI题型提分卡' },
  { id: '提分行动计划器', label: '提分行动计划器' },
  { id: '考前抢分清单器', label: '考前抢分清单器' },
  { id: '题感训练提分器', label: '题感训练提分器' },
  { id: '错题举一反三', label: '错题举一反三' },
  { id: '学习资料生成器', label: '学习资料生成器' },
  { id: 'AI出题机', label: 'AI出题机' },
  { id: '试卷变式机', label: '试卷变式机' },
  { id: 'AI备课器', label: 'AI备课器' },
  { id: '教辅资料生成器', label: '教辅资料生成器' },
  { id: '试卷讲评PPT', label: '试卷讲评PPT' },
  { id: '题卷重排WORD', label: '题卷重排WORD' },
]);
const POST_EXAM_ANALYSIS_COST = 1;
const POST_EXAM_CONFIG = Object.freeze({
  grades: ['小学低年级', '小学高年级', '初一', '初二', '初三', '高一', '高二', '高三'],
  examTypes: ['单元测验', '月考', '期中考试', '期末考试', '模拟考试', '其他考试'],
  subjects: [
    { label: '语文', icon: 'menu_book' },
    { label: '数学', icon: 'calculate' },
    { label: '英语', icon: 'translate' },
    { label: '物理', icon: 'science' },
    { label: '化学', icon: 'experiment' },
    { label: '生物', icon: 'genetics' },
    { label: '历史', icon: 'history_edu' },
    { label: '地理', icon: 'public' },
    { label: '政治', icon: 'gavel' },
  ],
  limits: {
    maxImageCount: 10,
    maxImageEdge: 1280,
    imageQuality: 0.72,
    requestTimeout: 245000,
  },
});

loadDotEnv();

const PORT = toPort(process.env.PORT, 5173);
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CONFIGURED_COOKIE_DOMAIN = String(process.env.AIBA_COOKIE_DOMAIN || '').trim();
const PLATFORM_MODE = process.env.PLATFORM_MODE === '1';
const PLATFORM_INTERNAL_TOKEN = String(process.env.PLATFORM_INTERNAL_TOKEN || '');
const IMAGE_CONCURRENCY = clampNumber(process.env.MAT_IMAGE_CONCURRENCY, 1, 4, 2);
const IMAGE_MAX_ATTEMPTS = clampNumber(process.env.MAT_IMAGE_MAX_ATTEMPTS, 1, 1, 1);
const IMAGE_TIMEOUT_MS = clampNumber(
  process.env.MAT_IMAGE_TIMEOUT_MS,
  120000,
  1180000,
  960000,
);
const IMAGE_REFERENCE_TIMEOUT_MS = clampNumber(
  process.env.MAT_IMAGE_REFERENCE_TIMEOUT_MS,
  120000,
  1180000,
  IMAGE_TIMEOUT_MS,
);
const IMAGE_REFERENCE_MAX_ATTEMPTS = clampNumber(
  process.env.MAT_IMAGE_REFERENCE_MAX_ATTEMPTS,
  1,
  1,
  1,
);
const RULE_TIMEOUT_MS = clampNumber(
  process.env.RULE_TIMEOUT_MS,
  120000,
  1180000,
  IMAGE_REFERENCE_TIMEOUT_MS,
);
const RULE_MAX_ATTEMPTS = clampNumber(
  process.env.RULE_MAX_ATTEMPTS,
  1,
  3,
  2,
);
const FIXED_LAYOUT_FOLLOWUP_CONCURRENCY = clampNumber(
  process.env.MAT_FIXED_LAYOUT_CONCURRENCY,
  1,
  4,
  3,
);

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
]);

const DEFAULT_IMAGE_QUALITY = 'high';
const GPT_IMAGE_2_MAX_EDGE = 3840;
const GPT_IMAGE_2_MIN_PIXELS = 655360;
const GPT_IMAGE_2_MAX_PIXELS = 8294400;
const IMAGE_SSE_EVENT_MAX_CHARS = MAX_BODY_BYTES;
const ASPECT_RATIO_SIZES = new Map([
  ['16:9', '2048x1152'],
  ['9:16', '2160x3840'],
  ['4:3', '1536x1024'],
  ['3:4', '1024x1536'],
  ['1:1', '2048x2048'],
  ['1:1.4142', '2240x3168'],
]);
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

let aiConfig = loadAiConfig();
let appState = loadAppState();
let appStateWriteQueue = Promise.resolve();
const canceledGenerationBatchIds = new Set();
const platformGenerationBatches = new Map();
const aiRouteState = {
  rule: { providerCursor: 0, keyCursors: new Map() },
  image: { providerCursor: 0, keyCursors: new Map() },
};

function createEmptyAiConfig() {
  return {
    version: AI_CONFIG_VERSION,
    global: {
      entries: [],
    },
    sites: createDefaultAiSiteConfigs(),
    rule: {
      entries: [],
    },
    image: {
      resolution: '4k',
      entries: [],
    },
  };
}

function createDefaultAiSiteConfigs() {
  return PLATFORM_AI_SITE_DEFINITIONS.map(({ id }) => ({
    id,
    mode: 'global',
    entries: [],
    pointsPerUse: 1,
  }));
}

function loadAiConfig() {
  if (!existsSync(AI_CONFIG_PATH)) return createEmptyAiConfig();

  try {
    const raw = JSON.parse(readFileSync(AI_CONFIG_PATH, 'utf8'));
    const normalized = normalizeAiConfigForStorage(raw, { tolerateInvalid: true });
    return normalized.ok ? normalized.config : createEmptyAiConfig();
  } catch (error) {
    console.warn(`AI 配置读取失败，请在后台重新保存配置：${formatErrorMessage(error)}`);
    return createEmptyAiConfig();
  }
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

function loadAppState() {
  if (!existsSync(APP_STATE_PATH)) return createEmptyAppState();

  try {
    const raw = JSON.parse(readFileSync(APP_STATE_PATH, 'utf8'));
    return normalizeAppState(raw);
  } catch (error) {
    console.warn(`应用状态读取失败，已使用空状态启动：${formatErrorMessage(error)}`);
    return createEmptyAppState();
  }
}

function normalizeAppState(raw) {
  const state = createEmptyAppState();
  if (!raw || typeof raw !== 'object') return state;

  state.users = Array.isArray(raw.users)
    ? raw.users.map(normalizeStoredUser).filter(Boolean)
    : [];
  state.sessions = Array.isArray(raw.sessions)
    ? raw.sessions.map(normalizeStoredSession).filter(Boolean)
    : [];
  state.redeemCodes = Array.isArray(raw.redeemCodes)
    ? raw.redeemCodes.map(normalizeStoredRedeemCode).filter(Boolean)
    : [];
  state.pointLogs = Array.isArray(raw.pointLogs)
    ? raw.pointLogs.map(normalizeStoredPointLog).filter(Boolean)
    : [];
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
    passwordHash: String(user.passwordHash),
    salt: String(user.salt),
    role: user.role === 'admin' ? 'admin' : 'user',
    points: Math.max(0, Math.floor(Number(user.points) || 0)),
    createdAt: cleanText(user.createdAt, 40) || new Date().toISOString(),
    updatedAt: cleanText(user.updatedAt, 40) || new Date().toISOString(),
  };
}

function normalizeStoredSession(session) {
  if (!session || typeof session !== 'object') return null;
  const token = cleanText(session.token, 200);
  const userId = cleanText(session.userId, 80);
  const expiresAt = cleanText(session.expiresAt, 40);
  if (!token || !userId || !expiresAt) return null;

  return { token, userId, expiresAt };
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
    status: code.status === 'used' || code.status === 'void' ? code.status : 'unused',
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
    type: cleanText(log.type, 40) || 'unknown',
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
    finishedAt: cleanText(batch.finishedAt, 40),
    note: cleanText(batch.note, 300),
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

function saveAppState() {
  const snapshot = JSON.stringify(appState, null, 2);
  appStateWriteQueue = appStateWriteQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(APP_STATE_PATH, `${snapshot}\n`, 'utf8');
    });
  return appStateWriteQueue;
}

function cleanUsername(value) {
  return String(value || '').replace(/\s+/gu, '').trim().slice(0, 40);
}

function isValidUsername(value) {
  return /^[\p{L}\p{N}_@.-]{3,40}$/u.test(value);
}

function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 6 && value.length <= 72;
}

function findUserByUsername(username) {
  const normalized = cleanUsername(username).toLowerCase();
  return appState.users.find((user) => user.username.toLowerCase() === normalized) || null;
}

function hashPassword(password, salt = randomBytes(PASSWORD_SALT_BYTES).toString('hex')) {
  return {
    salt,
    passwordHash: scryptSync(password, salt, PASSWORD_KEY_BYTES).toString('hex'),
  };
}

function verifyPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = scryptSync(password, user.salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createSessionForUser(user) {
  const token = randomBytes(32).toString('hex');
  const session = {
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  appState.sessions.push(session);
  return session;
}

function isLoopbackAddress(value) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(value || ''));
}

function safeEqualText(actualValue, expectedValue) {
  const actual = Buffer.from(String(actualValue || ''));
  const expected = Buffer.from(String(expectedValue || ''));
  return actual.length > 0
    && actual.length === expected.length
    && timingSafeEqual(actual, expected);
}

function getPlatformRequestUser(req) {
  if (
    !PLATFORM_MODE
    || !PLATFORM_INTERNAL_TOKEN
    || !isLoopbackAddress(req.socket.remoteAddress)
    || !safeEqualText(req.headers['x-platform-internal-token'], PLATFORM_INTERNAL_TOKEN)
  ) {
    return null;
  }

  const id = cleanText(req.headers['x-platform-user-id'], 80);
  let username = '';
  try {
    username = cleanUsername(decodeURIComponent(String(req.headers['x-platform-username'] || '')));
  } catch {
    return null;
  }
  if (!id || !username) return null;

  return {
    id,
    username,
    role: req.headers['x-platform-user-role'] === 'admin' ? 'admin' : 'user',
    points: Math.max(0, Math.floor(Number(req.headers['x-platform-user-points']) || 0)),
    platformCost: Math.max(0, Math.floor(Number(req.headers['x-platform-points-per-use']) || 0)),
    platformManaged: true,
    createdAt: '',
    updatedAt: '',
  };
}

function getRequestUser(req) {
  if (PLATFORM_MODE) return getPlatformRequestUser(req);
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token) return null;

  const session = appState.sessions.find((item) => item.token === token);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    appState.sessions = appState.sessions.filter((item) => item.token !== token);
    void saveAppState();
    return null;
  }

  return appState.users.find((user) => user.id === session.userId) || null;
}

function requireAuth(req, res) {
  const user = getRequestUser(req);
  if (user) return user;

  sendJson(res, 401, {
    ok: false,
    message: '请先登录后再使用该功能',
  });
  return null;
}

function requireAdmin(req, res) {
  const user = getRequestUser(req);
  if (user?.role === 'admin') return user;

  sendJson(res, user ? 403 : 401, {
    ok: false,
    message: user ? '只有管理员可以访问该后台' : '请先使用管理员账号登录',
  });
  return null;
}

function createPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    points: user.points,
    createdAt: user.createdAt,
  };
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  return Object.fromEntries(
    header
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separatorIndex = item.indexOf('=');
        if (separatorIndex === -1) return [item, ''];
        return [
          decodeURIComponent(item.slice(0, separatorIndex)),
          decodeURIComponent(item.slice(separatorIndex + 1)),
        ];
      }),
  );
}

function getAuthCookieDomain(req) {
  const configured = CONFIGURED_COOKIE_DOMAIN.replace(/^\.+/u, '');
  if (configured) return `.${configured}`;

  const forwardedHost = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const host = (forwardedHost || String(req?.headers?.host || '')).split(':')[0].toLowerCase();
  if (host === 'xiaoaijia.cn' || host === 'www.xiaoaijia.cn' || host.endsWith('.xiaoaijia.cn')) {
    return '.xiaoaijia.cn';
  }
  return '';
}

function cookieDomainAttribute(req) {
  const domain = getAuthCookieDomain(req);
  return domain ? `; Domain=${domain}` : '';
}

function createSessionCookie(token, req) {
  const secureAttribute = IS_PRODUCTION ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax${secureAttribute}${cookieDomainAttribute(req)}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function createProfileCookie(user, req) {
  const profile = encodeURIComponent(JSON.stringify(createPublicUser(user)));
  const secureAttribute = IS_PRODUCTION ? '; Secure' : '';
  return `${PROFILE_COOKIE_NAME}=${profile}; SameSite=Lax${secureAttribute}${cookieDomainAttribute(req)}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function createExpiredSessionCookie(req) {
  const secureAttribute = IS_PRODUCTION ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax${secureAttribute}${cookieDomainAttribute(req)}; Path=/; Max-Age=0`;
}

function createExpiredProfileCookie(req) {
  const secureAttribute = IS_PRODUCTION ? '; Secure' : '';
  return `${PROFILE_COOKIE_NAME}=; SameSite=Lax${secureAttribute}${cookieDomainAttribute(req)}; Path=/; Max-Age=0`;
}

function createSessionHeaders(user, token, req) {
  return {
    'Set-Cookie': [createSessionCookie(token, req), createProfileCookie(user, req)],
  };
}

function normalizeRedeemCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/gu, '').slice(0, 24);
}

function formatRedeemCode(value) {
  const normalized = normalizeRedeemCode(value);
  if (!normalized) return '';
  return normalized.match(/.{1,4}/gu)?.join('-') || normalized;
}

function createRedeemCodeValue() {
  let raw = '';
  while (raw.length < 16) {
    raw += REDEEM_CODE_ALPHABET[randomBytes(1)[0] % REDEEM_CODE_ALPHABET.length];
  }
  return formatRedeemCode(raw);
}

function findRedeemCode(value) {
  const normalized = normalizeRedeemCode(value);
  return appState.redeemCodes.find((item) => normalizeRedeemCode(item.code) === normalized) || null;
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
  appState.generationBatches = appState.generationBatches.slice(-1000);
  appState.sessions = appState.sessions.filter((session) => Date.parse(session.expiresAt) > Date.now());
}

function ensureSufficientPoints(user, points) {
  if (PLATFORM_MODE && user?.platformManaged) return;
  if (user.points >= points) return;
  const error = new Error(`积分不足，本次需要 ${points} 积分，当前剩余 ${user.points} 积分`);
  error.statusCode = 402;
  throw error;
}

async function reserveGenerationPoints(user, data) {
  const batchId = normalizeGenerationBatchId(data.batchId) || randomUUID();
  if (findGenerationBatch(batchId)) {
    const error = new Error('该生成批次已经存在，请重新发起生成');
    error.statusCode = 409;
    throw error;
  }
  if (PLATFORM_MODE && user?.platformManaged) {
    const now = new Date().toISOString();
    const batch = {
      id: batchId,
      userId: user.id,
      reservedPoints: user.platformCost,
      platformBalance: user.points,
      platformManaged: true,
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
      finishedAt: '',
      note: '',
    };
    platformGenerationBatches.set(batch.id, batch);
    return batch;
  }

  const reservedPoints = getGenerationChargeCount(data);
  ensureSufficientPoints(user, reservedPoints);

  const now = new Date().toISOString();
  user.points -= reservedPoints;
  user.updatedAt = now;

  const batch = {
    id: batchId,
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
    finishedAt: '',
    note: data.targetIndex === null ? '' : `重新生成第 ${data.targetIndex + 1} 张`,
  };
  appState.generationBatches.push(batch);
  addPointLog({
    user,
    type: 'generation_reserve',
    points: -reservedPoints,
    batchId: batch.id,
    note: data.targetIndex === null
      ? `预扣 ${reservedPoints} 张图片生成积分`
      : `预扣单张重试积分：第 ${data.targetIndex + 1} 张`,
  });
  await saveAppState();
  return batch;
}

async function settleGenerationPoints(batch, results, options = {}) {
  if (!batch) return createPointSettlementResponse(batch);
  if (batch.platformManaged) {
    const settlementBatch = findGenerationBatch(batch.id) || batch;
    if (settlementBatch.status !== 'running') return createPointSettlementResponse(settlementBatch);
    ensureGenerationBatchIndexState(settlementBatch);
    for (const result of Array.isArray(results) ? results.filter(Boolean) : []) {
      mergeGenerationImageResult(settlementBatch, result);
    }
    const successSet = new Set(settlementBatch.successIndexes);
    settlementBatch.failedIndexes = settlementBatch.imageIndexes.filter((index) => !successSet.has(index));
    settlementBatch.successCount = settlementBatch.successIndexes.length;
    settlementBatch.failedCount = settlementBatch.failedIndexes.length;
    settlementBatch.refundedPoints = 0;
    settlementBatch.status = options.status || 'done';
    settlementBatch.finishedAt = new Date().toISOString();
    settlementBatch.note = cleanText(options.note || '', 300);
    platformGenerationBatches.delete(settlementBatch.id);
    return createPointSettlementResponse(settlementBatch);
  }
  const settlementBatch = findGenerationBatch(batch.id) || batch;
  if (!appState.generationBatches.some((item) => item.id === settlementBatch.id)) {
    appState.generationBatches.push(settlementBatch);
  }
  if (settlementBatch.status !== 'running') return createPointSettlementResponse(settlementBatch);

  ensureGenerationBatchIndexState(settlementBatch);

  const user = appState.users.find((item) => item.id === settlementBatch.userId);
  if (!user) {
    settlementBatch.status = 'failed';
    settlementBatch.finishedAt = new Date().toISOString();
    settlementBatch.note = '用户不存在，无法结算积分';
    await saveAppState();
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
  settlementBatch.finishedAt = now;
  settlementBatch.note = cleanText(options.note || '', 300);

  await saveAppState();
  return createPointSettlementResponse(settlementBatch);
}

async function recordGenerationImageResult(batch, result) {
  if (!batch || !result) return createPointSettlementResponse(batch);
  if (isGenerationBatchCanceled(batch.id)) return createPointSettlementResponse(findGenerationBatch(batch.id) || batch);

  const settlementBatch = findGenerationBatch(batch.id) || batch;
  if (settlementBatch.status !== 'running') return createPointSettlementResponse(settlementBatch);
  ensureGenerationBatchIndexState(settlementBatch);

  if (settlementBatch.platformManaged) {
    mergeGenerationImageResult(settlementBatch, result);
    settlementBatch.successCount = settlementBatch.successIndexes.length;
    settlementBatch.failedCount = settlementBatch.failedIndexes.length;
    return createPointSettlementResponse(settlementBatch);
  }

  const user = appState.users.find((item) => item.id === settlementBatch.userId);
  if (!user) return createPointSettlementResponse(settlementBatch);

  const changed = mergeGenerationImageResult(settlementBatch, result);
  const imageIndex = Number(result.index);
  const now = new Date().toISOString();
  if (result.status !== 'ok' && settlementBatch.imageIndexes.includes(imageIndex)) {
    refundGenerationImageIndex(user, settlementBatch, imageIndex, now);
  }

  settlementBatch.successCount = settlementBatch.successIndexes.length;
  settlementBatch.failedCount = settlementBatch.failedIndexes.length;
  settlementBatch.refundedPoints = settlementBatch.refundedIndexes.length;
  if (changed || result.status !== 'ok') await saveAppState();
  return createPointSettlementResponse(settlementBatch);
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
  const normalized = cleanText(batchId, 80);
  return platformGenerationBatches.get(normalized)
    || appState.generationBatches.find((item) => item.id === normalized)
    || null;
}

function markGenerationBatchCanceled(batchId) {
  const normalized = normalizeGenerationBatchId(batchId);
  if (!normalized) return;
  canceledGenerationBatchIds.add(normalized);
  const cleanupTimer = setTimeout(() => canceledGenerationBatchIds.delete(normalized), 60 * 60 * 1000);
  cleanupTimer.unref?.();
}

function isGenerationBatchCanceled(batchId) {
  return canceledGenerationBatchIds.has(cleanText(batchId, 80));
}

function createPointSettlementResponse(batch) {
  if (!batch) return null;
  if (batch.platformManaged) {
    return {
      batchId: batch.id,
      reserved: batch.reservedPoints,
      success: batch.successCount,
      failed: batch.failedCount,
      refunded: 0,
      balance: batch.platformBalance,
    };
  }
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

function getGenerationChargeCount(data) {
  return data.targetIndex === null ? data.count : 1;
}

async function handleRegister(req, res) {
  const payload = await readJsonBody(req);
  const username = cleanUsername(payload.username);
  const password = String(payload.password || '');

  if (!isValidUsername(username)) {
    sendJson(res, 400, {
      ok: false,
      message: '账号需为 3-40 位，可使用中文、字母、数字、下划线、邮箱符号、点或横线',
    });
    return;
  }

  if (!isValidPassword(password)) {
    sendJson(res, 400, {
      ok: false,
      message: '密码需为 6-72 位',
    });
    return;
  }

  if (findUserByUsername(username)) {
    sendJson(res, 409, {
      ok: false,
      message: '该账号已存在，请直接登录',
    });
    return;
  }

  const now = new Date().toISOString();
  const { salt, passwordHash } = hashPassword(password);
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
  await saveAppState();

  sendJson(res, 200, {
    ok: true,
    user: createPublicUser(user),
    setupAdminCreated: user.role === 'admin',
  }, createSessionHeaders(user, session.token, req));
}

async function handleLogin(req, res) {
  const payload = await readJsonBody(req);
  const username = cleanUsername(payload.username);
  const password = String(payload.password || '');
  const user = findUserByUsername(username);

  if (!user || !verifyPassword(password, user)) {
    sendJson(res, 401, {
      ok: false,
      message: '账号或密码不正确',
    });
    return;
  }

  const session = createSessionForUser(user);
  await saveAppState();
  sendJson(res, 200, {
    ok: true,
    user: createPublicUser(user),
  }, createSessionHeaders(user, session.token, req));
}

async function handleLogout(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (token) {
    appState.sessions = appState.sessions.filter((session) => session.token !== token);
    await saveAppState();
  }

  sendJson(res, 200, {
    ok: true,
  }, {
    'Set-Cookie': [createExpiredSessionCookie(req), createExpiredProfileCookie(req)],
  });
}

function handleMe(req, res) {
  const user = getRequestUser(req);
  sendJson(res, 200, {
    ok: true,
    authenticated: Boolean(user),
    setupRequired: appState.users.length === 0,
    user: createPublicUser(user),
  }, user ? { 'Set-Cookie': createProfileCookie(user, req) } : {});
}

function requirePlatformInternal(req, res) {
  const token = String(req.headers['x-platform-internal-token'] || '');
  if (
    !PLATFORM_INTERNAL_TOKEN
    || !safeEqualText(token, PLATFORM_INTERNAL_TOKEN)
    || !isLoopbackAddress(req.socket.remoteAddress)
  ) {
    sendJson(res, 404, { ok: false, message: '接口不存在' });
    return false;
  }
  return true;
}

async function handlePlatformConsume(req, res) {
  if (!requirePlatformInternal(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;
  const payload = await readJsonBody(req);
  const siteId = cleanText(payload.siteId, 80);
  const cost = getSitePointsPerUse(siteId);
  if (user.points < cost) {
    sendJson(res, 402, {
      ok: false,
      code: 'INSUFFICIENT_POINTS',
      message: `积分不足，本次需要 ${cost} 积分，当前剩余 ${user.points} 积分`,
      points: user.points,
      cost,
    });
    return;
  }

  user.points -= cost;
  user.updatedAt = new Date().toISOString();
  addPointLog({
    user,
    type: 'platform_use',
    points: -cost,
    note: `${siteId || '子站'} 使用一次`,
  });
  await saveAppState();
  sendJson(res, 200, {
    ok: true,
    siteId,
    cost,
    user: createPublicUser(user),
    points: user.points,
  });
}

async function handlePlatformRefund(req, res) {
  if (!requirePlatformInternal(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;
  const payload = await readJsonBody(req);
  const siteId = cleanText(payload.siteId, 80);
  const cost = getSitePointsPerUse(siteId);
  user.points += cost;
  user.updatedAt = new Date().toISOString();
  addPointLog({
    user,
    type: 'platform_refund',
    points: cost,
    note: `${siteId || '子站'} 请求失败，退回积分`,
    status: 'refunded',
  });
  await saveAppState();
  sendJson(res, 200, {
    ok: true,
    siteId,
    refunded: cost,
    user: createPublicUser(user),
    points: user.points,
  });
}

async function handleRedeemPoints(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const payload = await readJsonBody(req);
  const code = findRedeemCode(payload.code);
  if (!code || code.status !== 'unused') {
    sendJson(res, 400, {
      ok: false,
      message: '卡密不存在或已被使用',
    });
    return;
  }

  const now = new Date().toISOString();
  code.status = 'used';
  code.usedAt = now;
  code.usedBy = user.id;
  user.points += code.points;
  user.updatedAt = now;
  addPointLog({
    user,
    type: 'redeem',
    points: code.points,
    note: `兑换卡密 ${code.code}`,
  });
  await saveAppState();

  sendJson(res, 200, {
    ok: true,
    points: user.points,
    redeemedPoints: code.points,
    user: createPublicUser(user),
  }, { 'Set-Cookie': createProfileCookie(user, req) });
}

function handleUserPointLogs(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const logs = appState.pointLogs
    .filter((log) => log.userId === user.id)
    .slice(-120)
    .reverse();
  sendJson(res, 200, {
    ok: true,
    logs,
  });
}

function handleAdminPointsOverview(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

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
  const totalPoints = users.reduce((sum, user) => sum + user.points, 0);
  const successfulImages = appState.generationBatches.reduce((sum, batch) => sum + batch.successCount, 0);
  const refundedPoints = appState.generationBatches.reduce((sum, batch) => sum + batch.refundedPoints, 0);

  sendJson(res, 200, {
    ok: true,
    admin: createPublicUser(admin),
    summary: {
      userCount: users.length,
      totalPoints,
      successfulImages,
      refundedPoints,
      unusedRedeemCodes: appState.redeemCodes.filter((code) => code.status === 'unused').length,
    },
    users,
    logs,
    batches,
    redeemCodes,
  });
}

async function handleAdminAdjustPoints(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const payload = await readJsonBody(req);
  const target =
    appState.users.find((user) => user.id === cleanText(payload.userId, 80)) ||
    findUserByUsername(payload.username);
  if (!target) {
    sendJson(res, 404, {
      ok: false,
      message: '未找到用户账号',
    });
    return;
  }

  const mode = payload.mode === 'set' ? 'set' : 'add';
  const points = Math.trunc(Number(payload.points));
  if (!Number.isFinite(points)) {
    sendJson(res, 400, {
      ok: false,
      message: '请填写有效积分数量',
    });
    return;
  }

  const before = target.points;
  if (mode === 'set') {
    if (points < 0 || points > 1000000) {
      sendJson(res, 400, {
        ok: false,
        message: '设置后的积分必须在 0 到 1000000 之间',
      });
      return;
    }
    target.points = points;
  } else {
    if (points === 0 || Math.abs(points) > 1000000 || before + points < 0) {
      sendJson(res, 400, {
        ok: false,
        message: '增减积分无效，不能让用户积分小于 0',
      });
      return;
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
  await saveAppState();

  sendJson(res, 200, {
    ok: true,
    user: createPublicUser(target),
  });
}

async function handleAdminCreateRedeemCodes(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const payload = await readJsonBody(req);
  const count = Math.trunc(Number(payload.count) || 1);
  const points = Math.trunc(Number(payload.points));
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    sendJson(res, 400, {
      ok: false,
      message: '单次生成卡密数量必须是 1 到 200',
    });
    return;
  }
  if (!Number.isInteger(points) || points < 1 || points > 100000) {
    sendJson(res, 400, {
      ok: false,
      message: '每张卡密积分必须是 1 到 100000',
    });
    return;
  }

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
  await saveAppState();

  sendJson(res, 200, {
    ok: true,
    codes: created,
  });
}

async function handleSaveAiConfig(req, res) {
  const payload = await readJsonBody(req);
  const normalized = normalizeAiConfigForStorage(payload);
  if (!normalized.ok) {
    sendJson(res, 400, { ok: false, message: normalized.message });
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(AI_CONFIG_PATH, `${JSON.stringify(normalized.config, null, 2)}\n`, 'utf8');
  aiConfig = normalized.config;
  resetAiRouteState();

  sendJson(res, 200, {
    ok: true,
    config: createAdminConfigResponse(),
  });
}

function normalizeAiConfigForStorage(payload, options = {}) {
  const source = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
  if (!source || typeof source !== 'object') {
    return { ok: false, message: 'AI 配置必须是 JSON 对象' };
  }

  // v1 只有 rule/image；升级时把旧 rule 作为全局文本 AI 的初始配置。
  const globalSource = Object.prototype.hasOwnProperty.call(source, 'global')
    ? source.global
    : source.rule;
  const global = normalizeAiChannelConfig(globalSource, '全局 AI', options);
  if (!global.ok) return global;

  // rule 仍保留给教辅资料生成器使用，兼容旧版 API 和已有配置文件。
  const ruleSource = Object.prototype.hasOwnProperty.call(source, 'rule')
    ? source.rule
    : { entries: global.entries };
  const rule = normalizeAiChannelConfig(ruleSource, '生成规则确认', options);
  if (!rule.ok) return rule;

  const image = normalizeAiChannelConfig(source.image, 'AI 生图', options);
  if (!image.ok) return image;

  const sites = normalizeAiSiteConfigs(source.sites, options);
  if (!sites.ok) return sites;

  return {
    ok: true,
    config: {
      version: AI_CONFIG_VERSION,
      global: {
        entries: global.entries,
      },
      sites: sites.sites,
      rule: {
        entries: rule.entries,
      },
      image: {
        resolution: normalizeImageResolutionMode(source.image?.resolution || '4k'),
        entries: image.entries,
      },
    },
  };
}

function normalizeAiSiteConfigs(source, options = {}) {
  const input = new Map();
  if (Array.isArray(source)) {
    source.forEach((item) => {
      const id = cleanText(item?.id, 80);
      if (id) input.set(id, item);
    });
  } else if (source && typeof source === 'object') {
    Object.entries(source).forEach(([id, item]) => input.set(cleanText(id, 80), item));
  }

  const sites = [];
  for (const { id } of PLATFORM_AI_SITE_DEFINITIONS) {
    const item = input.get(id);
    const requestedMode = cleanText(item?.mode, 20).toLowerCase();
    const mode = new Set(['global', 'custom', 'disabled']).has(requestedMode)
      ? requestedMode
      : 'global';
    const custom = normalizeAiChannelConfig(item, `子站 ${id}`, options);
    if (!custom.ok) return custom;
    if (mode === 'custom' && custom.entries.length === 0 && !options.tolerateInvalid) {
      return { ok: false, message: `子站 ${id} 选择独立配置时至少需要 1 个接口` };
    }
    sites.push({
      id,
      mode,
      entries: mode === 'custom' ? custom.entries : [],
      pointsPerUse: normalizeUsageCost(item?.pointsPerUse),
    });
  }

  return { ok: true, sites };
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

  return {
    ok: true,
    entries: normalized.slice(0, 24),
  };
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

  return {
    ok: true,
    entry: {
      baseUrl,
      model,
      apiKeys: apiKeys.slice(0, 60),
    },
  };
}

function normalizeUsageCost(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.min(100000, Math.floor(parsed))
    : 1;
}

function normalizeApiKeyList(value) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || '').split(/\r?\n/u);
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

function createAdminConfigResponse() {
  return {
    version: AI_CONFIG_VERSION,
    global: {
      entries: cloneAiEntries(aiConfig.global?.entries),
    },
    sites: PLATFORM_AI_SITE_DEFINITIONS.map(({ id, label }) => {
      const site = aiConfig.sites?.find((item) => item.id === id);
      return {
        id,
        label,
        mode: site?.mode || 'global',
        entries: cloneAiEntries(site?.entries),
        pointsPerUse: normalizeUsageCost(site?.pointsPerUse),
      };
    }),
    rule: {
      entries: cloneAiEntries(aiConfig.rule?.entries),
    },
    image: {
      resolution: normalizeImageResolutionMode(aiConfig.image?.resolution || '4k'),
      entries: cloneAiEntries(aiConfig.image?.entries),
    },
  };
}

function getSitePointsPerUse(siteId) {
  const site = aiConfig.sites?.find((item) => item.id === cleanText(siteId, 80));
  return normalizeUsageCost(site?.pointsPerUse);
}

function cloneAiEntries(entries) {
  return Array.isArray(entries)
    ? entries.map((entry) => ({
        baseUrl: entry.baseUrl,
        model: entry.model,
        apiKeys: [...entry.apiKeys],
      }))
    : [];
}

function getAiConfigStatus() {
  const ruleEntries = getEffectiveAiEntries('rule');
  const imageEntries = getEffectiveAiEntries('image');
  return {
    ruleConfigured: ruleEntries.length > 0,
    ruleModel: ruleEntries[0]?.model || '',
    imageConfigured: imageEntries.length > 0,
    imageModel: imageEntries[0]?.model || '',
    imageResolution: getEffectiveImageResolutionMode(),
  };
}

function getEffectiveAiEntries(channel) {
  if (process.env.PLATFORM_AI_PROXY === '1') {
    const baseUrl = String(process.env.PLATFORM_AI_BASE_URL || '').trim().replace(/\/+$/u, '');
    const model = String(process.env.PLATFORM_AI_MODEL || 'platform-managed').trim();
    const apiKey = String(process.env.PLATFORM_AI_API_KEY || '').trim();
    return baseUrl && apiKey ? [{ baseUrl, model, apiKeys: [apiKey] }] : [];
  }
  const savedEntries = channel === 'rule' ? aiConfig.rule?.entries : aiConfig.image?.entries;
  return Array.isArray(savedEntries) ? savedEntries : [];
}

function getEffectiveImageResolutionMode() {
  return normalizeImageResolutionMode(aiConfig.image?.resolution || '4k');
}

function isAiChannelConfigured(channel) {
  return getEffectiveAiEntries(channel).length > 0;
}

function resetAiRouteState() {
  for (const state of Object.values(aiRouteState)) {
    state.providerCursor = 0;
    state.keyCursors.clear();
  }
}

function nextAiRoute(channel) {
  const entries = getEffectiveAiEntries(channel);
  if (entries.length === 0) {
    throw new Error(channel === 'rule'
      ? '未配置生成规则确认接口，请联系管理员填写 URL、MODEL 和 APIKEY'
      : '未配置 AI 生图接口，请联系管理员填写 URL、MODEL 和 APIKEY');
  }

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

function authorizeAdminRequest(req, res) {
  return Boolean(requireAdmin(req, res));
}

function normalizeImageResolutionMode(value) {
  const mode = cleanText(value, 20).toLowerCase();
  return IMAGE_RESOLUTION_MODES.has(mode) ? mode : '4k';
}

function isValidHttpBaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/api/auth/me' && req.method === 'GET') {
      handleMe(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/internal/platform/consume' && req.method === 'POST') {
      await handlePlatformConsume(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/internal/platform/refund' && req.method === 'POST') {
      await handlePlatformRefund(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/auth/register' && req.method === 'POST') {
      await handleRegister(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/auth/login' && req.method === 'POST') {
      await handleLogin(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/auth/logout' && req.method === 'POST') {
      await handleLogout(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/points/redeem' && req.method === 'POST') {
      await handleRedeemPoints(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/points/logs' && req.method === 'GET') {
      handleUserPointLogs(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/admin/points/overview' && req.method === 'GET') {
      handleAdminPointsOverview(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/admin/points/adjust' && req.method === 'POST') {
      await handleAdminAdjustPoints(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/admin/points/redeem-codes' && req.method === 'POST') {
      await handleAdminCreateRedeemCodes(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/health' && req.method === 'GET') {
      const status = getAiConfigStatus();
      sendJson(res, 200, {
        ok: true,
        configured: status.imageConfigured,
        model: status.imageModel,
        ruleConfigured: status.ruleConfigured,
        ruleModel: status.ruleModel,
        imageResolution: status.imageResolution,
      });
      return;
    }

    if (requestUrl.pathname === '/api/admin/ai-config' && req.method === 'GET') {
      if (!authorizeAdminRequest(req, res, requestUrl)) return;
      sendJson(res, 200, {
        ok: true,
        config: createAdminConfigResponse(),
      });
      return;
    }

    if (requestUrl.pathname === '/api/admin/ai-config' && req.method === 'PUT') {
      if (!authorizeAdminRequest(req, res, requestUrl)) return;
      await handleSaveAiConfig(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/site/post-exam-boost/config' && req.method === 'GET') {
      sendJson(res, 200, POST_EXAM_CONFIG);
      return;
    }

    if (requestUrl.pathname === '/api/site/post-exam-boost/analyze' && req.method === 'POST') {
      await handlePostExamAnalysis(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/site/post-exam-boost/export-text' && req.method === 'POST') {
      await handlePostExamTextExport(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/generation-rule' && req.method === 'POST') {
      await handleGenerationRule(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/generate' && req.method === 'POST') {
      await handleGenerate(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/generate/cancel' && req.method === 'POST') {
      await handleCancelGeneration(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/generate/stream' && req.method === 'POST') {
      await handleGenerateStream(req, res);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, message: '接口不存在' });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, requestUrl);
      return;
    }

    sendJson(res, 405, { ok: false, message: '不支持的请求方法' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, message: '服务端处理失败，请稍后重试' });
  }
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`K12 教辅资料生成器已启动：http://${BIND_HOST}:${PORT}`);
});

async function handlePostExamAnalysis(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const payload = await readJsonBody(req);
  const validated = validatePostExamPayload(payload);
  if (!validated.ok) {
    sendJson(res, 400, { ok: false, error: validated.message, message: validated.message });
    return;
  }

  if (!isAiChannelConfigured('rule')) {
    const message = 'AI 文本分析接口尚未配置，请联系管理员在 AI 配置后台完成设置。';
    sendJson(res, 503, { ok: false, error: message, message });
    return;
  }

  try {
    ensureSufficientPoints(user, POST_EXAM_ANALYSIS_COST);
  } catch (error) {
    const message = formatErrorMessage(error);
    sendJson(res, error.statusCode || 402, { ok: false, error: message, message });
    return;
  }

  const abortController = createRequestAbortController(req, res);
  try {
    const report = await generatePostExamReport(validated.data, abortController.signal);
    await chargePostExamAnalysis(user);
    sendJson(res, 200, {
      ok: true,
      report,
      points: {
        charged: POST_EXAM_ANALYSIS_COST,
        balance: user.points,
      },
    });
  } catch (error) {
    const message = formatErrorMessage(error);
    sendJson(res, error.statusCode || 500, { ok: false, error: message, message });
  }
}

async function handlePostExamTextExport(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const payload = await readJsonBody(req);
  if (!payload?.report || typeof payload.report !== 'object' || Array.isArray(payload.report)) {
    sendJson(res, 400, { ok: false, error: '报告内容无效', message: '报告内容无效' });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    text: formatPostExamReportText(normalizePostExamReport(payload.report, {})),
  });
}

function validatePostExamPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: '请求内容无效' };
  }

  const subject = cleanText(payload.subject, 30);
  const actualScore = Number(payload.actualScore);
  const totalScore = Number(payload.totalScore);
  const targetScore = payload.targetScore === null || payload.targetScore === ''
    ? null
    : Number(payload.targetScore);
  const rawImages = Array.isArray(payload.images) ? payload.images : [];

  if (!subject) return { ok: false, message: '请选择学科' };
  if (!Number.isFinite(actualScore) || !Number.isFinite(totalScore) || totalScore <= 0) {
    return { ok: false, message: '本次得分和卷面总分格式不正确' };
  }
  if (actualScore < 0 || actualScore > totalScore) {
    return { ok: false, message: '本次得分不能大于卷面总分' };
  }
  if (targetScore !== null && (!Number.isFinite(targetScore) || targetScore <= 0)) {
    return { ok: false, message: '目标分格式不正确' };
  }
  if (rawImages.length === 0 || rawImages.length > POST_EXAM_CONFIG.limits.maxImageCount) {
    return { ok: false, message: `请上传 1 到 ${POST_EXAM_CONFIG.limits.maxImageCount} 张卷面图片` };
  }

  const images = [];
  for (const [index, image] of rawImages.entries()) {
    const dataUrl = String(image?.dataUrl || '');
    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=_-]+$/u.test(dataUrl)) {
      return { ok: false, message: `第 ${index + 1} 张卷面图片格式无效` };
    }
    images.push({
      name: cleanText(image?.name, 120) || `卷面图片${index + 1}`,
      type: cleanText(image?.type, 40) || readDataUrlMimeType(dataUrl),
      dataUrl,
    });
  }

  return {
    ok: true,
    data: {
      role: cleanText(payload.role, 20) || '学生',
      grade: cleanText(payload.grade, 30),
      subject,
      examType: cleanText(payload.examType, 40),
      actualScore,
      totalScore,
      targetScore,
      images,
    },
  };
}

async function generatePostExamReport(data, signal) {
  const prompt = createPostExamPrompt(data);
  const content = [{ type: 'text', text: prompt }];
  data.images.forEach((image, index) => {
    content.push({ type: 'text', text: `卷面图片 ${index + 1}：${image.name}` });
    content.push({ type: 'image_url', image_url: { url: image.dataUrl } });
  });

  const rawText = await requestTextApiWithRetry(
    '/chat/completions',
    (route) => ({
      model: route.model,
      messages: [
        {
          role: 'system',
          content: '你是严谨的 K12 卷后诊断专家。只依据用户填写的分数和可见卷面证据判断，不得编造题号、知识点、错误原因或分数。信息不足时必须明确写“卷面证据不足”。',
        },
        { role: 'user', content },
      ],
      temperature: 0.2,
      max_tokens: 12000,
    }),
    {
      signal,
      timeoutMs: 240000,
      maxAttempts: 2,
    },
  );

  const parsed = parseJsonObjectFromText(rawText);
  if (!parsed) throw new Error('AI 未返回有效的卷后分析 JSON，请重试');
  return normalizePostExamReport(parsed.report || parsed, data);
}

function createPostExamPrompt(data) {
  return [
    '请分析上传的真实卷面，输出一份可直接执行的卷后提分报告。',
    `学生信息：${data.role}；${data.grade || '年级未填写'}；${data.subject}；${data.examType || '考试类型未填写'}。`,
    `分数信息：本次 ${data.actualScore}/${data.totalScore} 分；目标分 ${data.targetScore ?? '未填写'}。`,
    '必须逐张读取卷面；只写可见证据。看不清的题目不要猜，使用“卷面证据不足”。',
    '输出严格 JSON 对象，不要 Markdown、代码围栏或额外说明。结构必须为：',
    JSON.stringify({
      meta: {
        scoreRate: '得分率',
        scoreGapText: '当前分差说明',
        recoverableScore: '基于卷面证据的可追回分数或范围',
        recoverableReason: '可追回原因',
        firstAction: '第一优先动作',
        firstActionReason: '为什么先做',
      },
      overallSummary: '总诊断，明确证据边界',
      paperInsights: {
        paperOverview: '卷面概览',
        bottleneckChain: '证据 -> 根因 -> 动作',
        keyObservation: '最关键卷面证据',
        coreLossPattern: '核心失分模式',
      },
      dataIntegrity: {
        sourceScope: '实际读取到的图片和题目范围',
        confidenceLevel: '高/中/低',
        confidenceNote: '不能确认的内容',
      },
      abilityProfile: [{ dimension: '能力维度', score: 0, diagnosis: '诊断' }],
      errorPatternClusters: [{ pattern: '错误类型', frequency: 1, questions: '可见题号', rootCause: '根因', correction: '矫正策略' }],
      knowledgeGaps: [{ topic: '知识点', mastery: '掌握度', relatedQuestions: '可见题号', suggestion: '建议' }],
      difficultyDistribution: [{ level: '基础/中档/综合', totalPoints: 0, earnedPoints: 0, scoreRate: '得分率', analysis: '分析' }],
      examStrategyReview: [{ dimension: '策略维度', rating: '评价', observation: '卷面观察', suggestion: '建议' }],
      coreCompetencyEval: [{ competency: '核心素养', rating: '评价', evidence: '证据', improvePath: '提升路径' }],
      questionCoverage: { summary: '本次重点覆盖范围' },
      scoreBreakdown: [{ dimension: '维度', questionTag: '真实题号', isWrong: true, currentState: '当前状态', lossReason: '失分原因', fixStep: '改进动作', example: '同类训练示例' }],
      priorities: [{ priorityLevel: 'P0/P1/P2', expectedGain: '预期追回分', title: '优先项', whyNow: '原因', steps: '动作', example: '例子', source: '卷面证据' }],
      scoreForecast: { stableRange: '稳定分区间', improveRange: '执行后区间', targetChance: '目标分把握', keyCondition: '成立条件', warning: '预测边界' },
      risks: [{ title: '复发风险', probability: '高/中/低', owner: '学生/家长', scenario: '触发场景', earlySignal: '预警信号', impact: '影响', prevention: '防控动作', reviewCycle: '复盘频率', checkPoint: '验收标准' }],
      sevenDayPlan: [{ dayLabel: 'D1', duration: '时长', focus: '重点', goal: '目标', task: '任务', checkpoint: '检查点', example: '例子' }],
      nextExamActions: [{ stage: '考前/考中', target: '目标', steps: '动作', fallback: '卡壳应对', selfCheck: '自检句', example: '例子' }],
      rolePlans: [{ role: '学生/家长', focus: '重点', steps: '动作', checkpoint: '检查点', example: '例子' }],
    }),
    'sevenDayPlan 必须覆盖 D1 到 D7；所有建议必须具体、可检查，不得使用空泛鼓励。',
  ].join('\n\n');
}

function normalizePostExamReport(value, data) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const scoreRate = Number.isFinite(data.actualScore) && Number.isFinite(data.totalScore) && data.totalScore > 0
    ? `${Math.round((data.actualScore / data.totalScore) * 1000) / 10}%`
    : postExamText(source.meta?.scoreRate, '--');
  const scoreGap = Number.isFinite(data.actualScore) && Number.isFinite(data.totalScore)
    ? Math.max(0, Math.round((data.totalScore - data.actualScore) * 10) / 10)
    : null;

  return {
    meta: {
      scoreRate,
      scoreGapText: scoreGap === null ? postExamText(source.meta?.scoreGapText, '--') : `距满分还差 ${scoreGap} 分`,
      recoverableScore: postExamText(source.meta?.recoverableScore, '需结合清晰卷面确认'),
      recoverableReason: postExamText(source.meta?.recoverableReason, '卷面证据不足'),
      firstAction: postExamText(source.meta?.firstAction, '先复核卷面证据'),
      firstActionReason: postExamText(source.meta?.firstActionReason, '避免在信息不足时误判'),
    },
    overallSummary: postExamText(source.overallSummary, '卷面证据不足，暂不能形成可靠诊断。'),
    paperInsights: {
      paperOverview: postExamText(source.paperInsights?.paperOverview, '卷面证据不足'),
      bottleneckChain: postExamText(source.paperInsights?.bottleneckChain, '卷面证据不足'),
      keyObservation: postExamText(source.paperInsights?.keyObservation, '卷面证据不足'),
      coreLossPattern: postExamText(source.paperInsights?.coreLossPattern, '卷面证据不足'),
    },
    dataIntegrity: {
      sourceScope: postExamText(source.dataIntegrity?.sourceScope, `${data.images?.length || 0} 张卷面图片`),
      confidenceLevel: postExamText(source.dataIntegrity?.confidenceLevel, '低'),
      confidenceNote: postExamText(source.dataIntegrity?.confidenceNote, '仅对清晰可见的卷面内容下结论'),
    },
    abilityProfile: normalizePostExamList(source.abilityProfile, 8, (item) => ({
      dimension: postExamText(item.dimension, '能力维度'),
      score: clampNumber(item.score, 0, 100, 0),
      diagnosis: postExamText(item.diagnosis, '卷面证据不足'),
    })),
    errorPatternClusters: normalizePostExamList(source.errorPatternClusters, 10, (item) => ({
      pattern: postExamText(item.pattern, '待确认错误类型'),
      frequency: clampNumber(item.frequency, 1, 100, 1),
      questions: postExamText(item.questions, '题号未确认'),
      rootCause: postExamText(item.rootCause, '卷面证据不足'),
      correction: postExamText(item.correction, '先核对原题与作答过程'),
    })),
    knowledgeGaps: normalizePostExamList(source.knowledgeGaps, 12, (item) => ({
      topic: postExamText(item.topic, '知识点待确认'),
      mastery: postExamText(item.mastery, '待评估'),
      relatedQuestions: postExamText(item.relatedQuestions, '题号未确认'),
      suggestion: postExamText(item.suggestion, '先补充清晰卷面证据'),
    })),
    difficultyDistribution: normalizePostExamList(source.difficultyDistribution, 6, (item) => ({
      level: postExamText(item.level, '难度待确认'),
      totalPoints: clampNumber(item.totalPoints, 0, 1000, 0),
      earnedPoints: clampNumber(item.earnedPoints, 0, 1000, 0),
      scoreRate: postExamText(item.scoreRate, '--'),
      analysis: postExamText(item.analysis, '卷面证据不足'),
    })),
    examStrategyReview: normalizePostExamList(source.examStrategyReview, 8, (item) => ({
      dimension: postExamText(item.dimension, '策略维度'),
      rating: postExamText(item.rating, '待评估'),
      observation: postExamText(item.observation, '卷面证据不足'),
      suggestion: postExamText(item.suggestion, '先记录真实答题过程'),
    })),
    coreCompetencyEval: normalizePostExamList(source.coreCompetencyEval, 8, (item) => ({
      competency: postExamText(item.competency, '核心素养'),
      rating: postExamText(item.rating, '待评估'),
      evidence: postExamText(item.evidence, '卷面证据不足'),
      improvePath: postExamText(item.improvePath, '补充证据后再制定路径'),
    })),
    questionCoverage: {
      summary: postExamText(source.questionCoverage?.summary, '仅覆盖清晰可见的重点错题'),
    },
    scoreBreakdown: normalizePostExamList(source.scoreBreakdown, 16, (item) => ({
      dimension: postExamText(item.dimension, '失分维度'),
      questionTag: postExamText(item.questionTag, '题号未确认'),
      isWrong: Boolean(item.isWrong),
      currentState: postExamText(item.currentState, '状态待确认'),
      lossReason: postExamText(item.lossReason, '卷面证据不足'),
      fixStep: postExamText(item.fixStep, '先复核原题与作答过程'),
      example: postExamText(item.example, '按同知识点补做一道同类题'),
    })),
    priorities: normalizePostExamList(source.priorities, 8, (item) => ({
      priorityLevel: postExamText(item.priorityLevel, 'P1'),
      expectedGain: postExamText(item.expectedGain, '待验证'),
      title: postExamText(item.title, '优先项'),
      whyNow: postExamText(item.whyNow, '根据当前可见证据排序'),
      steps: postExamText(item.steps, '复核错题并完成同类训练'),
      example: postExamText(item.example, '完成后用同类题自测'),
      source: postExamText(item.source, '卷面证据'),
    })),
    scoreForecast: {
      stableRange: postExamText(source.scoreForecast?.stableRange, '证据不足，暂不预测'),
      improveRange: postExamText(source.scoreForecast?.improveRange, '证据不足，暂不预测'),
      targetChance: postExamText(source.scoreForecast?.targetChance, '待验证'),
      keyCondition: postExamText(source.scoreForecast?.keyCondition, '完成训练并通过同类题复测'),
      warning: postExamText(source.scoreForecast?.warning, '预测仅供制定学习计划，不是分数承诺'),
    },
    risks: normalizePostExamList(source.risks, 8, (item) => ({
      title: postExamText(item.title, '复发风险'),
      probability: postExamText(item.probability, '中'),
      owner: postExamText(item.owner, '学生'),
      scenario: postExamText(item.scenario || item.trigger, '同类题再次出现时'),
      earlySignal: postExamText(item.earlySignal, '作答步骤再次缺失'),
      impact: postExamText(item.impact, '同类失分重复出现'),
      prevention: postExamText(item.prevention, '建立错题复测记录'),
      reviewCycle: postExamText(item.reviewCycle, '每周复盘 2 次'),
      checkPoint: postExamText(item.checkPoint, '同类题连续两次正确'),
    })),
    sevenDayPlan: normalizePostExamList(source.sevenDayPlan, 7, (item, index) => ({
      dayLabel: postExamText(item.dayLabel, `D${index + 1}`),
      duration: postExamText(item.duration, '30 分钟'),
      focus: postExamText(item.focus, '当天重点'),
      goal: postExamText(item.goal, '完成可检查的学习任务'),
      task: postExamText(item.task, '复盘并完成同类训练'),
      checkpoint: postExamText(item.checkpoint, '训练结果可复核'),
      example: postExamText(item.example, '记录错因和正确步骤'),
    })),
    nextExamActions: normalizePostExamList(source.nextExamActions, 8, (item) => ({
      stage: postExamText(item.stage, '考中'),
      target: postExamText(item.target, '减少同类失分'),
      steps: postExamText(item.steps, '按检查清单执行'),
      fallback: postExamText(item.fallback, '先跳过卡题并在完成全卷后回访'),
      selfCheck: postExamText(item.selfCheck, '题目条件是否全部用到'),
      example: postExamText(item.example, '提交前复核单位、符号和答题步骤'),
    })),
    rolePlans: normalizePostExamList(source.rolePlans, 6, (item) => ({
      role: postExamText(item.role, '学生'),
      focus: postExamText(item.focus, '完成本周重点任务'),
      steps: postExamText(item.steps, '按计划训练并记录结果'),
      checkpoint: postExamText(item.checkpoint, '任务有记录、结果可复查'),
      example: postExamText(item.example, '每晚核对当天训练清单'),
    })),
  };
}

function normalizePostExamList(value, limit, mapper) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .slice(0, limit)
    .map(mapper);
}

function postExamText(value, fallback = '') {
  return cleanText(value, 1200) || fallback;
}

async function chargePostExamAnalysis(user) {
  if (PLATFORM_MODE && user?.platformManaged) return;
  ensureSufficientPoints(user, POST_EXAM_ANALYSIS_COST);
  user.points -= POST_EXAM_ANALYSIS_COST;
  user.updatedAt = new Date().toISOString();
  addPointLog({
    user,
    type: 'post_exam_analysis',
    points: -POST_EXAM_ANALYSIS_COST,
    note: '卷后提分试卷分析',
  });
  await saveAppState();
}

function formatPostExamReportText(report) {
  const lines = [
    '卷后提分报告',
    '',
    `得分率：${report.meta.scoreRate}`,
    `分差：${report.meta.scoreGapText}`,
    `可追回分：${report.meta.recoverableScore}`,
    `第一优先动作：${report.meta.firstAction}`,
    '',
    '一、总体结论',
    report.overallSummary,
    '',
    '二、关键卷面证据',
    report.paperInsights.keyObservation,
    '',
    '三、追分优先队列',
    ...report.priorities.map((item, index) => `${index + 1}. ${item.title}：${item.steps}（${item.expectedGain}）`),
    '',
    '四、7 天行动计划',
    ...report.sevenDayPlan.map((item) => `${item.dayLabel} ${item.focus}：${item.task}；检查点：${item.checkpoint}`),
    '',
    '五、下次考试动作',
    ...report.nextExamActions.map((item) => `${item.stage}｜${item.target}：${item.steps}`),
    '',
    `证据边界：${report.dataIntegrity.confidenceNote}`,
  ];
  return lines.join('\n');
}

async function handleGenerationRule(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const payload = await readJsonBody(req);
  const validated = validateGenerationRulePayload(payload);
  if (!validated.ok) {
    sendJson(res, 400, { ok: false, message: validated.message });
    return;
  }

  if (!isAiChannelConfigured('rule')) {
    sendJson(res, 500, {
      ok: false,
      message: '未配置生成规则确认接口，请联系管理员填写 URL、MODEL 和 APIKEY。',
    });
    return;
  }

  const abortController = createRequestAbortController(req, res);
  validated.data.abortSignal = abortController.signal;
  await attachKnowledgeContext(validated.data, {
    fileTextMaxChars: RULE_KNOWLEDGE_FILE_TEXT_MAX_CHARS,
    totalTextMaxChars: RULE_KNOWLEDGE_TOTAL_TEXT_MAX_CHARS,
    includePdfPageImages: true,
    pdfPageImageMaxCount: RULE_PDF_PAGE_IMAGE_MAX_COUNT,
    pdfPageImageWidth: RULE_PDF_PAGE_IMAGE_WIDTH,
  });
  await ensureKnowledgeBlueprint(validated.data);

  try {
    const rule = await generateGenerationRule(validated.data);
    sendJson(res, 200, {
      ok: true,
      rule,
      count: rule.count,
      batchItems: rule.batchItems,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: formatErrorMessage(error),
    });
  }
}

async function handleGenerate(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const payload = await readJsonBody(req);
  const validated = validateGeneratePayload(payload);
  if (!validated.ok) {
    sendJson(res, 400, { ok: false, message: validated.message });
    return;
  }

  if (!isAiChannelConfigured('image')) {
    sendJson(res, 500, {
      ok: false,
      message: '未配置 AI 生图接口，请联系管理员填写 URL、MODEL 和 APIKEY。',
    });
    return;
  }

  const abortController = createRequestAbortController(req, res);
  validated.data.batchId = validated.data.clientBatchId || randomUUID();
  validated.data.abortSignal = abortController.signal;
  const chargeCount = getGenerationChargeCount(validated.data);

  try {
    assertGenerationBatchActive(validated.data);
    ensureSufficientPoints(user, chargeCount);
    await attachKnowledgeContext(validated.data);
    attachRuleKnowledgeBlueprint(validated.data);
    await ensureGroundedGenerationRule(validated.data);
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      ok: false,
      message: formatErrorMessage(error),
    });
    return;
  }

  let batch = null;
  let results = [];
  try {
    batch = await reserveGenerationPoints(user, validated.data);
    validated.data.batchId = batch.id;
    results =
      validated.data.targetIndex === null
        ? validated.data.options.layoutFixed && validated.data.count > 1
          ? await generateFixedLayoutBatch(validated.data)
          : await generateIndependentBatch(validated.data)
        : [await generateSingleResult(validated.data)];

    assertGenerationBatchActive(validated.data);
    const success = results.filter((item) => item.status === 'ok').length;
    const points = await settleGenerationPoints(batch, results, { status: 'done' });
    assertGenerationBatchActive(validated.data);
    sendJson(res, 200, {
      ok: true,
      results,
      summary: {
        success: points?.success ?? success,
        failed: points?.failed ?? results.length - success,
        points,
      },
    });
  } catch (error) {
    let points = null;
    if (batch) {
      points = await settleGenerationPoints(batch, results, {
        status: abortController.signal.aborted ? 'canceled' : 'failed',
        note: formatErrorMessage(error),
      });
    }
    sendJson(res, error.statusCode || 500, {
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
    });
  }
}

async function handleCancelGeneration(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const payload = await readJsonBody(req);
  const batchId = normalizeGenerationBatchId(payload.batchId);
  if (!batchId) {
    sendJson(res, 400, { ok: false, message: '生成批次标识无效' });
    return;
  }
  const batch = findGenerationBatch(batchId);
  if (batch && batch.userId !== user.id) {
    sendJson(res, 404, { ok: false, message: '未找到可取消的生成任务' });
    return;
  }

  markGenerationBatchCanceled(batchId);
  if (!batch) {
    sendJson(res, 202, {
      ok: true,
      pending: true,
      points: null,
      summary: null,
    });
    return;
  }

  const points = await settleGenerationPoints(batch, [], {
    status: 'canceled',
    note: '用户关闭或刷新页面，未成功生成的图片已按单张退回积分',
  });
  sendJson(res, 200, {
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

async function handleGenerateStream(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const payload = await readJsonBody(req);
  const validated = validateGeneratePayload(payload);
  if (!validated.ok) {
    sendJson(res, 400, { ok: false, message: validated.message });
    return;
  }

  if (!isAiChannelConfigured('image')) {
    sendJson(res, 500, {
      ok: false,
      message: '未配置 AI 生图接口，请联系管理员填写 URL、MODEL 和 APIKEY。',
    });
    return;
  }

  const abortController = createRequestAbortController(req, res);
  validated.data.batchId = validated.data.clientBatchId || randomUUID();
  validated.data.abortSignal = abortController.signal;
  const chargeCount = getGenerationChargeCount(validated.data);

  try {
    assertGenerationBatchActive(validated.data);
    ensureSufficientPoints(user, chargeCount);
    await attachKnowledgeContext(validated.data);
    attachRuleKnowledgeBlueprint(validated.data);
    await ensureGroundedGenerationRule(validated.data);
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      ok: false,
      message: formatErrorMessage(error),
    });
    return;
  }

  let batch;
  try {
    batch = await reserveGenerationPoints(user, validated.data);
    validated.data.batchId = batch.id;
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      ok: false,
      message: formatErrorMessage(error),
    });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const responseWriter = createNdjsonResponseWriter(res, abortController.signal);
  const writeEvent = responseWriter.write;

  const heartbeat = setInterval(() => {
    void writeEvent({
      type: 'heartbeat',
      at: new Date().toISOString(),
    }).catch(() => {});
  }, 15000);

  const streamedResults = [];
  const canWriteGenerationEvent = () => {
    const currentBatch = findGenerationBatch(batch.id) || batch;
    return !isGenerationBatchCanceled(batch.id) && currentBatch.status === 'running';
  };
  const writeGenerationEvent = async (event) => {
    if (!canWriteGenerationEvent()) return false;
    if (event?.type === 'result' && event.result) {
      const points = await recordGenerationImageResult(batch, event.result);
      if (!canWriteGenerationEvent()) return false;
      streamedResults[event.result.index] = event.result;
      if (points) event.points = points;
    }
    return writeEvent(event, canWriteGenerationEvent);
  };

  try {
    await writeEvent({
      type: 'start',
      count: validated.data.count,
      points: {
        batchId: batch.id,
        reserved: batch.reservedPoints,
        balance: user.points,
      },
    });

    const results =
      validated.data.targetIndex === null
        ? validated.data.options.layoutFixed && validated.data.count > 1
          ? await generateFixedLayoutBatch(validated.data, writeGenerationEvent)
          : await generateIndependentBatch(validated.data, writeGenerationEvent)
        : [await generateSingleResult(validated.data, writeGenerationEvent)];

    assertGenerationBatchActive(validated.data);
    const success = results.filter((item) => item.status === 'ok').length;
    const points = await settleGenerationPoints(batch, results, { status: 'done' });
    assertGenerationBatchActive(validated.data);
    if (abortController.signal.aborted || res.writableEnded) return;

    const doneWritten = await writeEvent(
      {
        type: 'done',
        summary: {
          success: points?.success ?? success,
          failed: points?.failed ?? results.length - success,
          points,
        },
      },
      () => !isGenerationBatchCanceled(batch.id),
    );
    if (doneWritten === false) {
      const canceledPoints = createPointSettlementResponse(findGenerationBatch(batch.id) || batch);
      await writeEvent({
        type: 'error',
        message: '生成任务已取消，未完成图片已退回积分',
        points: canceledPoints,
        summary: canceledPoints
          ? {
              success: canceledPoints.success,
              failed: canceledPoints.failed,
              points: canceledPoints,
            }
          : undefined,
      });
    }
    await responseWriter.end();
  } catch (error) {
    const points = await settleGenerationPoints(batch, streamedResults, {
      status: abortController.signal.aborted ? 'canceled' : 'failed',
      note: formatErrorMessage(error),
    });
    if (abortController.signal.aborted || res.writableEnded) return;
    await writeEvent({
      type: 'error',
      message: formatErrorMessage(error),
      points,
      summary: points
        ? {
            success: points.success,
            failed: points.failed,
            points,
          }
        : undefined,
    });
    await responseWriter.end();
  } finally {
    clearInterval(heartbeat);
    await responseWriter.flush();
  }
}

function createNdjsonResponseWriter(res, signal) {
  let writeQueue = Promise.resolve();

  const write = (event, shouldWrite = null) => {
    const operation = writeQueue.then(async () => {
      if (res.writableEnded || res.destroyed || signal?.aborted) return false;
      if (typeof shouldWrite === 'function' && !shouldWrite()) return false;
      const accepted = res.write(`${JSON.stringify(event)}\n`);
      if (!accepted) await waitForResponseDrain(res, signal);
      return true;
    });
    writeQueue = operation.catch(() => {});
    return operation;
  };

  const flush = () => writeQueue;
  const end = async () => {
    await flush();
    if (!res.writableEnded && !res.destroyed && !signal?.aborted) res.end();
  };

  return { write, flush, end };
}

function waitForResponseDrain(res, signal) {
  return new Promise((resolve, reject) => {
    if (res.writableEnded || res.destroyed || signal?.aborted) {
      reject(new Error('前端请求已取消，已停止发送生成结果'));
      return;
    }

    const cleanup = () => {
      res.removeListener('drain', handleDrain);
      res.removeListener('close', handleClose);
      res.removeListener('error', handleError);
      signal?.removeEventListener('abort', handleAbort);
    };
    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new Error('前端连接已关闭，已停止发送生成结果'));
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    const handleAbort = () => {
      cleanup();
      reject(new Error('前端请求已取消，已停止发送生成结果'));
    };

    res.once('drain', handleDrain);
    res.once('close', handleClose);
    res.once('error', handleError);
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

function hasGenerationReferenceImages(data) {
  return data.styleReferenceImages.length > 0;
}

function hasStyleReference(data) {
  return Boolean(data?.styleReferenceProvided || data?.styleReferenceImages?.length);
}

async function generateIndependentBatch(data, onResult = null) {
  const jobs = Array.from({ length: data.count }, (_, index) => index);
  const concurrency = hasGenerationReferenceImages(data) ? 1 : IMAGE_CONCURRENCY;
  const results = new Array(jobs.length);
  await generateConcurrentImageResults(data, jobs, concurrency, results, onResult);
  return results;
}

async function generateConcurrentImageResults(
  data,
  indexes,
  concurrency,
  results,
  onResult = null,
  createContext = null,
) {
  const completionTasks = [];
  const completionSlots = createConcurrencySemaphore(concurrency);
  const persistenceSlots = createConcurrencySemaphore(concurrency);
  let pipelineError = null;

  const scheduleCompletion = async (index, resultId, imageSource, modelError) => {
    assertGenerationBatchActive(data);

    // 完成槽限制持久化与积分写积压；图片只物化一次，不再并行传输第二份预览副本。
    const releaseCompletionSlot = await completionSlots.acquire();
    try {
      assertGenerationBatchActive(data);
    } catch (error) {
      releaseCompletionSlot();
      throw error;
    }

    let persistenceTask = null;
    if (!modelError) {
      const releasePersistenceSlot = await persistenceSlots.acquire();
      try {
        assertGenerationBatchActive(data);
      } catch (error) {
        releasePersistenceSlot();
        releaseCompletionSlot();
        throw error;
      }
      persistenceTask = settleGeneratedImagePersistence(imageSource, data, index)
        .finally(releasePersistenceSlot);
    }

    const completionTask = Promise.resolve(persistenceTask)
      .then((persistence) => modelError
        ? createErrorResult(index, modelError, data, resultId)
        : createGeneratedImagePersistenceResult(index, resultId, data, persistence))
      .then((result) => {
        results[index] = result;
        return emitBatchResult(onResult, result);
      })
      .finally(releaseCompletionSlot);
    completionTasks.push(completionTask);
    void completionTask.catch(() => {});
  };

  try {
    await mapWithConcurrency(indexes, concurrency, async (index) => {
      assertGenerationBatchActive(data);
      const resultId = randomUUID();
      let imageSource;
      let modelError;
      try {
        const context = typeof createContext === 'function' ? await createContext(index) : {};
        imageSource = await generateImageSource(data, index, context);
      } catch (error) {
        modelError = error;
      }

      await scheduleCompletion(index, resultId, imageSource, modelError);
    });
  } catch (error) {
    pipelineError = error;
  } finally {
    const completionOutcomes = await Promise.allSettled(completionTasks);
    if (!pipelineError) {
      const completionFailure = completionOutcomes.find((outcome) => outcome.status === 'rejected');
      if (completionFailure) pipelineError = completionFailure.reason;
    }
  }

  if (pipelineError) throw pipelineError;
  assertGenerationBatchActive(data);
}

async function completeGeneratedImageResult({
  data,
  index,
  resultId,
  imageSource,
  modelError,
}) {
  if (modelError) return createErrorResult(index, modelError, data, resultId);
  const persistence = await settleGeneratedImagePersistence(imageSource, data, index);
  return createGeneratedImagePersistenceResult(index, resultId, data, persistence);
}

async function settleGeneratedImagePersistence(imageSource, data, index) {
  try {
    return {
      status: 'fulfilled',
      value: await saveGeneratedImage(imageSource, data, index),
    };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

function createGeneratedImagePersistenceResult(index, resultId, data, persistence) {
  if (persistence.status === 'rejected') {
    return createErrorResult(index, persistence.reason, data, resultId, {
      failureStage: 'image_persistence',
      persistenceFailed: true,
    });
  }
  return createImageResult(index, persistence.value, data, resultId);
}

async function generateSingleResult(data, onResult = null) {
  const index = data.targetIndex;
  assertGenerationBatchActive(data);
  const resultId = randomUUID();

  let layoutReference = null;
  if (data.options.layoutFixed && index > 0) {
    if (!data.layoutReferenceImage) {
      const result = createErrorResult(
        index,
        '固定排版模式下，重新生成后续页需要第 1 张已成功生成的母版图。',
        data,
      );
      await emitBatchResult(onResult, result);
      return result;
    }
    layoutReference = await imageSourceToReference(data.layoutReferenceImage, 'fixed-layout-template-page-1.png');
  }

  let imageSource;
  let modelError;
  try {
    imageSource = await generateImageSource(data, index, { layoutReference });
  } catch (error) {
    modelError = error;
  }

  assertGenerationBatchActive(data);
  const result = await completeGeneratedImageResult({
    data,
    index,
    resultId,
    imageSource,
    modelError,
  });
  assertGenerationBatchActive(data);
  await emitBatchResult(onResult, result);
  return result;
}

async function generateFixedLayoutBatch(data, onResult = null) {
  const results = new Array(data.count);
  let layoutReference = null;
  const firstResultId = randomUUID();
  let firstImageSource;
  let firstModelError;
  try {
    assertGenerationBatchActive(data);
    firstImageSource = await generateImageSource(data, 0, { layoutReference });
  } catch (error) {
    firstModelError = error;
  }

  assertGenerationBatchActive(data);
  let firstResult = await completeGeneratedImageResult({
    data,
    index: 0,
    resultId: firstResultId,
    imageSource: firstImageSource,
    modelError: firstModelError,
  });
  assertGenerationBatchActive(data);
  results[0] = firstResult;
  await emitBatchResult(onResult, firstResult);
  if (firstResult.status !== 'ok') {
    await appendStoppedFixedLayoutResults(results, data, firstResult.error, onResult);
    return results;
  }

  // 第一张保存成功后立即返回给浏览器；后续页所需母版在返回之后再从本地文件读取。
  try {
    layoutReference = await imageSourceToReference(firstResult.image, 'fixed-layout-template-page-1.png');
  } catch (error) {
    await appendStoppedFixedLayoutResults(results, data, error, onResult);
    return results;
  }

  const followupIndexes = Array.from({ length: data.count - 1 }, (_, index) => index + 1);
  await generateConcurrentImageResults(
    data,
    followupIndexes,
    FIXED_LAYOUT_FOLLOWUP_CONCURRENCY,
    results,
    onResult,
    () => ({ layoutReference }),
  );

  return results;
}

async function appendStoppedFixedLayoutResults(results, data, error, onResult = null) {
  const reason = formatErrorMessage(error);
  for (let index = 1; index < data.count; index += 1) {
    if (results[index]) continue;
    const result = createErrorResult(
      index,
      `固定排版模式需要先成功生成第 1 张模板页。第 1 张失败原因：${reason}`,
      data,
    );
    results[index] = result;
    await emitBatchResult(onResult, result);
  }
}

async function emitBatchResult(onResult, result) {
  if (typeof onResult !== 'function') return;
  await onResult({ type: 'result', result });
}

function createImageResult(index, image, data, resultId = randomUUID()) {
  return {
    id: resultId,
    index,
    status: 'ok',
    item: data?.batchItems?.[index] || '',
    image,
    storedImage: image,
    saving: false,
  };
}

function createErrorResult(index, error, data, resultId = randomUUID(), options = {}) {
  return {
    id: resultId,
    index,
    status: 'error',
    item: data?.batchItems?.[index] || '',
    error: formatErrorMessage(error),
    failureStage: options.failureStage || '',
    persistenceFailed: Boolean(options.persistenceFailed),
  };
}

async function saveGeneratedImage(source, data, index) {
  assertNotAborted(data.abortSignal);
  const { buffer, mimeType } = await generatedImageToBuffer(source, data.abortSignal);
  const batchId = safeFileName(data.batchId || randomUUID());
  const pageNumber = String(index + 1).padStart(2, '0');
  const extension = IMAGE_FILE_EXTENSIONS.get(mimeType) || 'png';
  const filename = `${pageNumber}-${randomUUID()}.${extension}`;
  const dir = path.join(GENERATED_DIR, batchId);
  const filePath = path.join(dir, filename);

  await mkdir(dir, { recursive: true });
  await writeFile(filePath, buffer);
  await verifySavedGeneratedImage(filePath, mimeType);

  return `${GENERATED_URL_PREFIX}/${batchId}/${filename}`;
}

async function verifySavedGeneratedImage(filePath, expectedMimeType) {
  const savedBuffer = await readFile(filePath);
  if (savedBuffer.length === 0) {
    throw new Error('图片已生成但自动保存失败：保存文件为空');
  }

  const savedMimeType = sniffImageMimeType(savedBuffer);
  if (!savedMimeType || savedMimeType !== expectedMimeType) {
    throw new Error('图片已生成但自动保存失败：保存后的图片格式不可识别');
  }
}

async function generatedImageToBuffer(source, signal) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('图片生成接口返回为空，无法保存图片');
  }

  const imageSource = source.trim();
  if (imageSource.startsWith('data:image/')) {
    return dataUrlImageToBuffer(imageSource);
  }

  if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
    return fetchRemoteImageBuffer(imageSource, signal);
  }

  if (looksLikeBase64Image(imageSource)) {
    const normalized = imageSource.replace(/-/gu, '+').replace(/_/gu, '/');
    const buffer = Buffer.from(normalized, 'base64');
    return {
      buffer,
      mimeType: sniffImageMimeType(buffer) || 'image/png',
    };
  }

  throw new Error('图片生成接口返回了无法保存的图片格式');
}

async function fetchRemoteImageBuffer(source, signal) {
  assertNotAborted(signal);
  const response = await fetch(source, { signal });
  if (!response.ok) {
    throw new Error(`图片已生成但自动保存失败：读取图片 HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const responseMimeType = normalizeImageMimeType(response.headers.get('content-type'));
  const mimeType =
    responseMimeType ||
    inferImageMimeTypeFromUrl(source) ||
    sniffImageMimeType(buffer);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error('图片已生成但自动保存失败：返回的图片类型不受支持');
  }

  return { buffer, mimeType };
}

function dataUrlImageToBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl);
  if (!match) {
    throw new Error('图片生成接口返回的 data URL 格式无效，无法保存图片');
  }

  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error('图片生成接口返回的图片类型不受支持，无法保存图片');
  }

  return {
    buffer: Buffer.from(match[2], 'base64'),
    mimeType,
  };
}

function normalizeImageMimeType(value) {
  const mimeType = String(value || '').split(';')[0].trim().toLowerCase();
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : '';
}

function inferImageMimeTypeFromUrl(value) {
  try {
    const extension = path.extname(new URL(value).pathname).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.webp') return 'image/webp';
  } catch {
    return '';
  }
  return '';
}

function sniffImageMimeType(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return '';
}

async function generateImageSource(data, index, context = {}) {
  assertNotAborted(data.abortSignal);
  const prompt = composeTeachingAidPrompt(data, index, context);
  const referenceImages = selectGenerationReferenceImages(data, context);

  let image;
  if (referenceImages.length > 0) {
    image = await requestImageWithReferences(prompt, data, referenceImages);
  } else {
    image = await requestImageGeneration(prompt, data);
  }

  return image;
}

function selectGenerationReferenceImages(data, context = {}) {
  const styleReferences = data.styleReferenceImages || [];
  const layoutReference = context.layoutReference ? [context.layoutReference] : [];

  if (styleReferences.length > 0) {
    return [
      ...styleReferences,
      ...layoutReference,
    ];
  }

  return layoutReference;
}

async function requestImageGeneration(prompt, data) {
  const size = resolveImageRequestSize(data);
  return requestImageGenerationWithSize(prompt, data, size);
}

function requestImageGenerationWithSize(prompt, data, size) {
  return requestJsonImageApiWithRetry(
    '/images/generations',
    (route) => ({
      model: route.model,
      prompt,
      size,
      quality: data.quality,
      n: 1,
      output_format: 'png',
      stream: true,
      partial_images: 1,
    }),
    {
      signal: data.abortSignal,
    },
  );
}

async function requestImageWithReferences(prompt, data, referenceImages = []) {
  return requestMultipartImageApiWithRetry(
    '/images/edits',
    (route) => {
      const formData = new FormData();
      formData.append('model', route.model);
      formData.append('prompt', prompt);
      formData.append('size', resolveImageRequestSize(data));
      formData.append('quality', data.quality);
      formData.append('n', '1');
      formData.append('output_format', 'png');

      for (const [index, image] of referenceImages.entries()) {
        const { buffer, mimeType } = dataUrlToBuffer(image.dataUrl, image.mimeType);
        const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
        formData.append(
          'image',
          blob,
          createReferenceUploadFileName(`reference-${String(index + 1).padStart(2, '0')}`, mimeType),
        );
      }

      return formData;
    },
    {
      signal: data.abortSignal,
    },
  );
}

function requestJsonImageApiWithRetry(endpoint, createBody, options = {}) {
  return requestImageApiWithRetry(
    endpoint,
    (route) => ({
      body: JSON.stringify(createBody(route)),
      headers: {
        'Content-Type': 'application/json',
      },
    }),
    {
      maxAttempts: IMAGE_MAX_ATTEMPTS,
      timeoutMs: IMAGE_TIMEOUT_MS,
      signal: options.signal,
    },
  );
}

function requestMultipartImageApiWithRetry(endpoint, createFormData, options = {}) {
  return requestImageApiWithRetry(
    endpoint,
    (route) => ({
      body: createFormData(route),
      headers: {},
    }),
    {
      timeoutMs: IMAGE_REFERENCE_TIMEOUT_MS,
      maxAttempts: IMAGE_REFERENCE_MAX_ATTEMPTS,
      signal: options.signal,
    },
  );
}

async function requestImageApiWithRetry(endpoint, createRequest, options = {}) {
  const maxAttempts = resolveAiAttemptLimit('image', options.maxAttempts || 3);
  const timeoutMs = options.timeoutMs || 120000;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assertNotAborted(options.signal);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortUpstream = () => controller.abort();
    options.signal?.addEventListener('abort', abortUpstream, { once: true });

    try {
      const route = nextAiRoute('image');
      const originalRequest = createRequest(route);
      const request = options.streamingDisabled
        ? disableImageStreamingRequest(originalRequest)
        : originalRequest;
      const response = await fetch(`${route.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${route.apiKey}`,
          ...request.headers,
        },
        body: request.body,
        signal: controller.signal,
      });

      const payload =
        endpoint === '/images/generations' && response.ok && isEventStreamResponse(response)
          ? await parseImageEventStream(response)
          : await parseApiResponse(response);
      assertNotAborted(options.signal);
      if (response.ok) {
        return extractImage(payload);
      }

      if (
        endpoint === '/images/generations' &&
        !options.streamingDisabled &&
        isUnsupportedImageStreamingResponse(response, payload)
      ) {
        return requestImageApiWithRetry(endpoint, createRequest, {
          ...options,
          streamingDisabled: true,
        });
      }

      lastError = createApiError(response, payload, `图片生成接口（${route.label}）`);
      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        throw lastError;
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw new Error('前端请求已取消，已停止继续生成图片');
      }
      lastError = normalizeFetchError(error, endpoint);
      if (!isRetryableFetchError(error) || attempt === maxAttempts) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortUpstream);
    }

    await delay(1200 * attempt * attempt, options.signal);
  }

  throw lastError || new Error('图片生成接口请求失败');
}

function isEventStreamResponse(response) {
  return (response.headers.get('content-type') || '').toLowerCase().includes('text/event-stream');
}

async function parseImageEventStream(response) {
  if (!response.body) {
    const error = new Error('上游流式生图响应缺少消息体');
    error.retryable = true;
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let eventName = '';
  let dataLines = [];
  let eventChars = 0;
  let lineParts = [];
  let lineChars = 0;
  let lastPartialPayload = null;

  const resetEvent = () => {
    eventName = '';
    dataLines = [];
    eventChars = 0;
  };

  const consumeEvent = async () => {
    const rawData = dataLines.length === 1 ? dataLines[0] : dataLines.join('\n');
    const data = rawData.trim();
    const currentEventName = eventName;
    resetEvent();
    if (!data) return null;
    if (data === '[DONE]') return lastPartialPayload;

    let payload;
    try {
      payload = JSON.parse(data);
    } catch (error) {
      error.retryable = true;
      throw error;
    }

    const eventType = payload?.type || currentEventName;
    if (payload?.error || eventType === 'error') {
      const streamError = new Error(payload?.error?.message || payload?.message || '上游流式生图失败');
      streamError.retryable = true;
      throw streamError;
    }

    if (eventType === 'image_generation.partial_image') {
      const partialImage = findImageInPayload(payload);
      if (partialImage) {
        lastPartialPayload = payload;
      }
      return null;
    }

    if (eventType === 'image_generation.completed') {
      try {
        extractImage(payload);
      } catch (error) {
        if (lastPartialPayload) return lastPartialPayload;
        error.retryable = true;
        throw error;
      }
      return payload;
    }

    const genericImage = findImageInPayload(payload);
    if (!genericImage) return null;
    const isUntypedImageEvent = !payload?.type && (!currentEventName || currentEventName === 'message');
    if (isUntypedImageEvent) {
      lastPartialPayload = payload;
      return null;
    }
    if (/partial|progress/i.test(String(eventType || ''))) {
      lastPartialPayload = payload;
      return null;
    }
    return payload;
  };

  const consumeLine = async (line) => {
    const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!normalizedLine) return consumeEvent();
    if (normalizedLine.startsWith(':')) return null;
    if (normalizedLine.startsWith('event:')) {
      eventName = normalizedLine.slice(6).trim();
      return null;
    }
    if (!normalizedLine.startsWith('data:')) return null;

    const data = normalizedLine.slice(5).replace(/^ /u, '');
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
    lineChars += part.length;
    if (lineChars > IMAGE_SSE_EVENT_MAX_CHARS) {
      const error = new Error('上游流式生图事件行过大，已停止读取以保护服务内存');
      error.retryable = true;
      throw error;
    }
    lineParts.push(part);
  };

  const takeLine = () => {
    const line = lineParts.length === 0 ? '' : lineParts.length === 1 ? lineParts[0] : lineParts.join('');
    lineParts = [];
    lineChars = 0;
    return line;
  };

  const consumeChunk = async (chunk) => {
    let start = 0;
    while (start < chunk.length) {
      const newlineIndex = chunk.indexOf('\n', start);
      if (newlineIndex === -1) {
        appendLinePart(chunk.slice(start));
        return null;
      }

      appendLinePart(chunk.slice(start, newlineIndex));
      const payload = await consumeLine(takeLine());
      if (payload) return payload;
      start = newlineIndex + 1;
    }
    return null;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const payload = await consumeChunk(decoder.decode(value, { stream: true }));
      if (payload) return payload;
    }

    const decodedTail = decoder.decode();
    if (decodedTail) {
      const payload = await consumeChunk(decodedTail);
      if (payload) return payload;
    }
    if (lineChars > 0) {
      const payload = await consumeLine(takeLine());
      if (payload) return payload;
    }
    if (eventName || dataLines.length > 0) {
      const payload = await consumeEvent();
      if (payload) return payload;
    }
    if (lastPartialPayload) return lastPartialPayload;

    const error = new Error('上游流式生图已结束，但没有返回可识别的图片');
    error.retryable = true;
    throw error;
  } catch (error) {
    if (lastPartialPayload) return lastPartialPayload;
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
  const message = String(
    typeof payload === 'string'
      ? payload
      : payload?.error?.message || payload?.message || payload?.text || '',
  ).toLowerCase();
  return (
    /(?:unknown|unsupported|unrecognized|invalid|extra).{0,40}(?:stream|partial_images)/u.test(message) ||
    /(?:stream|partial_images).{0,40}(?:unknown|unsupported|unrecognized|invalid|not permitted|not allowed)/u.test(message)
  );
}

function disableImageStreamingRequest(request) {
  const contentType = request.headers?.['Content-Type'] || request.headers?.['content-type'] || '';
  if (!String(contentType).includes('application/json')) return request;
  const body = JSON.parse(String(request.body || '{}'));
  delete body.stream;
  delete body.partial_images;
  return {
    ...request,
    body: JSON.stringify(body),
  };
}

async function generateGenerationRule(data) {
  await ensureKnowledgeBlueprint(data);
  const prompt = composeGenerationRuleAnalysisPrompt(data);
  const content = createGenerationRuleMessageContent(data, prompt);
  const rawText = await requestTextApiWithRetry(
    '/chat/completions',
    (route) => ({
      model: route.model,
      messages: [
        {
          role: 'system',
          content:
            '你是资深 K12 教辅内容总编审和视觉排版规划师。你必须从第一性原理理解用户意图、知识库整体内容、主题层级和内容覆盖边界，再决定批量图片生成规则。只输出 JSON，不要输出 Markdown、图片链接、base64 或解释文字。',
        },
        {
          role: 'user',
          content,
        },
      ],
      temperature: 0.2,
      max_tokens: resolveGenerationRuleMaxTokens(data),
    }),
    {
      signal: data.abortSignal,
      timeoutMs: RULE_TIMEOUT_MS,
      maxAttempts: RULE_MAX_ATTEMPTS,
    },
  );

  return parseGenerationRuleText(rawText, data);
}

function composeGenerationRuleAnalysisPrompt(data) {
  const labels = [];
  if (data.materialType) labels.push(`资料类型：${data.materialType}`);
  if (data.scenario) labels.push(`使用场景：${data.scenario}`);
  if (data.aspectRatio) labels.push(`图片比例：${data.aspectRatio}`);
  if (data.options.layoutFixed) labels.push('排版设计固定：是');
  const inventory = data.knowledgeContext || createEmptyKnowledgeContext();
  const pdfImageEvidence = createPdfImageEvidencePrompt(inventory);
  const preserveKnowledgeContent = isKnowledgeContentPreservationRequired(data.prompt);

  return [
    '请先生成“生成规则逻辑”，用于后续批量生成教辅图片。',
    '第一性原理：最终图片是一组可直接交付给用户使用的内容成品，不是源文件分页截图，也不是把资料页逐页改写。生成数量必须是你理解用户目标和知识库内容后，为了完整、清晰、不过度冗余地覆盖目标内容而得出的规划结果。',
    data.count
      ? `用户填写的生成数量：${data.count} 张。必须输出正好 ${data.count} 个页面规划，不多不少。`
      : `用户没有填写生成数量。你必须真正阅读和理解知识库整体内容，先完成内容规划，再判断最适合生成多少张，范围 1-${MAX_GENERATION_COUNT}。`,
    pdfImageEvidence,
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
      '- 如果用户没有填写数量，先全盘分析知识库内容本身：列出主要章节、知识点、内容模块、图表、案例、活动、说明性内容和用户明确要求的题目/练习，再根据这些内容单元规划推荐数量。',
      '- 推荐数量的最高权重是内容规划：每张图应该承载一个清晰教学目标、一个知识簇、一个题型组、一个流程步骤或一组可自然合并的知识点；源文件页数没有决策权，只有 sourceLogic 需要定位来源时才提及页码。',
      preserveKnowledgeContent
        ? '- 页面只能按原文先后顺序分配锁定原文块；允许分页，但不得重排原文块内部或跨原文块的文字顺序。'
        : '- 输出顺序必须按教学/知识逻辑重排：先基础概念、总览、前置知识或第一学习任务，再进入后续练习、拓展、复盘；严禁把“原文件第几页”当成“生成第几张”的排序依据。',
      '- 如果某个应放在第 1 张的核心内容出现在原文件第 2 页或更后面，仍必须把它放进第 1 张；源页码只能写入 sourceLogic 作为证据位置，不能决定页面顺序。',
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
      '- 如果提供了 PDF 页面截图，请结合截图识别真实教材页、题目页、章节线索和视觉结构；未截图页面只能作为规模背景，不能替代内容规划判断。',
      '- 当知识库页数很多但内容连续、重复或同属一个小知识点时，可以合并；当同一页里包含多个章节点、题型或知识点时，必须拆开。',
      '- 如果同一页资料里包含多个章节、知识点或题型，可以拆成多张图。',
      '- 如果多个资料页属于同一章节点，可以合并成一张图。',
      '- 不要默认把页面规划成固定模板或答题类页面；只有用户提示词、资料内容或资料类型明确要求相关模块时，才规划这些元素。',
      preserveKnowledgeContent
        ? '- 不得执行去重、补齐缺失承接或文字优化；即使发现重复、错字、缺句或排序问题，也只能保持原文并在 riskNotes 记录，不能擅自修复。'
        : '- 需要去重、补齐缺失承接、排序混乱内容，并覆盖用户真正想生成的重点。',
      '- “不要遗漏”“参考风格一样”“根据知识库内容”“原文不变”等是执行要求，不是页面主题；禁止围绕这些短语生成独立页面。',
      '- 每张图都要有清晰的独立目标、内容范围、必须包含的信息和避免重复的边界。',
      '- 固定排版模式下，还要给出整批统一的页面结构、栏目顺序和样式规则。',
      '- styleAdvice 必须给出适配本次资料类型的视觉建议：例如速查卡、知识图谱、流程图、题组卡、时间轴、对照表等；不要只写“简洁美观”。',
      '- 有参考风格图时，参考风格图是唯一设计模板：layoutLogic 和 styleLogic 必须描述当次参考图真实存在的页面结构、栏目框、标题区、装饰元素、字体层级、配色、留白和插画/图标位置；如果无法确定，写“以参考风格图为准”，不要编造泛化模板。',
      '- 有参考风格图时，禁止在 layoutLogic/styleLogic 中写入任何不来自当次参考图的默认模板、通用装饰、通用页眉页脚或历史样式。',
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
  ]
    .filter(Boolean)
    .join('\n\n');
}

function createPdfImageEvidencePrompt(context) {
  const files = Array.isArray(context?.fileSummaries) ? context.fileSummaries : [];
  const renderedFiles = files.filter((file) => file.renderedPageCount > 0);
  if (renderedFiles.length === 0) return '';

  const details = renderedFiles
    .map((file) => {
      const sampledPages = Array.isArray(file.sampledPages) && file.sampledPages.length > 0
        ? formatPageNumbersForPrompt(file.sampledPages, 18)
        : '若干来源页截图';
      return `${file.name}：已附规则确认截图样本，来源页码 ${sampledPages}`;
    })
    .join('；');

  return `PDF 页面截图证据：${details}。截图只用于读取扫描型/图片型 PDF 的真实章节、题型、图表、主题层级和内容单元；截图数量、抽样页码和 PDF 总页数都不能作为生成数量依据。`;
}

function createGenerationRuleMessageContent(data, prompt) {
  const content = [{ type: 'text', text: prompt }];

  data.styleReferenceImages.forEach((image, index) => {
    content.push({
      type: 'text',
      text: `参考风格图 ${index + 1}：${image.name}`,
    });
    content.push({
      type: 'image_url',
      image_url: { url: image.dataUrl },
    });
  });

  data.knowledgeContext.imageReferences.forEach((image, index) => {
    content.push({
      type: 'text',
      text: `知识库图片 ${index + 1}：${image.name}`,
    });
    content.push({
      type: 'image_url',
      image_url: { url: image.dataUrl },
    });
  });

  return content;
}

function resolveGenerationRuleMaxTokens(data) {
  const count = estimateGenerationCount(data);
  return clampInteger(3200 + count * 160, 4096, RULE_GENERATION_MAX_TOKENS);
}

async function requestTextApiWithRetry(endpoint, createBody, options = {}) {
  const maxAttempts = resolveAiAttemptLimit('rule', options.maxAttempts || 3);
  const timeoutMs = options.timeoutMs || 120000;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assertNotAborted(options.signal);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortUpstream = () => controller.abort();
    options.signal?.addEventListener('abort', abortUpstream, { once: true });

    try {
      const route = nextAiRoute('rule');
      const response = await fetch(`${route.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${route.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createBody(route)),
        signal: controller.signal,
      });

      const payload = await parseApiResponse(response);
      assertNotAborted(options.signal);
      if (response.ok) {
        return extractText(payload);
      }

      lastError = createApiError(response, payload, `生成规则接口（${route.label}）`);
      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        throw lastError;
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw new Error('前端请求已取消，已停止继续生成规则');
      }
      lastError = normalizeFetchError(error, endpoint);
      if (!isRetryableFetchError(error) || attempt === maxAttempts) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortUpstream);
    }

    await delay(1200 * attempt * attempt, options.signal);
  }

  throw lastError || new Error('生成规则接口请求失败');
}

function parseGenerationRuleText(rawText, data) {
  const parsed = parseJsonObjectFromText(rawText);
  if (!parsed) {
    return normalizeGenerationRule(
      {
        recommendedCount: data.count || estimateGenerationCount(data),
        summary: '已按提示词和知识库内容生成兜底规则。',
        contentLogic: createFallbackContentLogic(data),
        layoutLogic: createFallbackLayoutLogic(data),
        styleLogic: createFallbackStyleLogic(data),
        pages: [],
      },
      data,
    );
  }

  return normalizeGenerationRule(parsed, data);
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
  const rawText = await requestTextApiWithRetry(
    '/chat/completions',
    (route) => ({
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
    }),
    {
      signal: data.abortSignal,
      timeoutMs: RULE_TIMEOUT_MS,
      maxAttempts: RULE_MAX_ATTEMPTS,
    },
  );
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
  let pages =
    rawPages.length > 0
      ? rawPages.map((page, index) => normalizeRulePage(page, index, data))
      : createRulePagesFromBatchItems(rawBatchItems, data, finalCount);

  if (pages.length < finalCount) {
    const fallbackPages = createRulePagesFromBatchItems(data.batchItems, data, finalCount);
    pages = [...pages, ...fallbackPages.slice(pages.length)];
  }

  const knowledgeBlueprint = normalizeKnowledgeBlueprint(data.knowledgeContext?.knowledgeBlueprint, data);
  pages = groundRulePagesToKnowledgeBlueprint(
    pages.slice(0, finalCount).map((page, index) => ({
      ...page,
      index,
    })),
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

function createRuleEvidence(data) {
  const context = data.knowledgeContext || createEmptyKnowledgeContext();
  return {
    totalPages: context.totalPages || 0,
    totalTextChars: context.totalTextChars || 0,
    estimatedContentUnits: context.estimatedContentUnits || 0,
    knowledgeImageCount: context.knowledgeImageCount || 0,
    pdfPageImageCount: context.pdfPageImageCount || 0,
    pdfPageImageLimit: context.pdfPageImageLimit || RULE_PDF_PAGE_IMAGE_MAX_COUNT,
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

function createRulePagesFromBatchItems(items, data, count = data.count || estimateGenerationCount(data)) {
  const normalizedItems = Array.isArray(items)
    ? items.map((item) => stringifyBatchItemInput(item)).filter(Boolean)
    : [];

  return Array.from({ length: count }, (_, index) =>
    normalizeRulePage(normalizedItems[index] || createFallbackBatchItem(index, data), index, data),
  );
}

function createFallbackBatchItem(index, data) {
  if (data.batchItems[index]) return data.batchItems[index];

  const unit = resolveKnowledgeContentUnitForIndex(index, data);
  if (unit) {
    if (unit.heading) {
      return `第 ${index + 1} 张：围绕逻辑内容单元「${unit.heading}」生成教辅页面；按知识结构和教学顺序组织内容，不按原文件页码顺序分配。`;
    }
    return `第 ${index + 1} 张：覆盖《${unit.file.name}》中第 ${unit.unitNumber} 个逻辑内容板块，按用户提示词和资料本身提炼该板块需要呈现的标题、知识点、图文信息、案例或任务；源页码只作证据，不决定本张顺序。`;
  }

  return `第 ${index + 1} 张：整理知识库中按教学逻辑排序后的第 ${index + 1} 个核心内容单元，不按原文件页码机械对应。`;
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

function formatRulePageBatchItem(page) {
  const parts = [
    page.title,
    page.focus,
    page.sourceLogic ? `资料依据：${page.sourceLogic}` : '',
    page.mustInclude.length > 0 ? `必须包含：${page.mustInclude.join('；')}` : '',
    page.avoid.length > 0 ? `避免混入：${page.avoid.join('；')}` : '',
    page.knowledgeAnchor ? `知识库锚点：${page.knowledgeAnchor.title}；${page.knowledgeAnchor.content}` : '',
  ].filter(Boolean);

  return cleanText(parts.join('。'), BATCH_ITEM_MAX_CHARS);
}

function parseJsonObjectFromText(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const candidates = [
    text,
    text.replace(/^```(?:json)?/iu, '').replace(/```$/u, '').trim(),
  ];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // 继续尝试其他候选片段。
    }
  }

  return null;
}

function normalizeStringList(value, limit, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeRuleText(item, maxLength))
    .filter(Boolean)
    .slice(0, limit);
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
  ];

  const validCandidates = candidates.filter(
    (candidate) => Number.isInteger(candidate) && candidate >= 1 && candidate <= MAX_GENERATION_COUNT,
  );
  return validCandidates.length > 0 ? Math.max(...validCandidates) : 0;
}

function estimateGenerationCount(data) {
  if (data.count) return data.count;

  const context = data.knowledgeContext || createEmptyKnowledgeContext();
  const text = data.knowledgeContext.promptText || data.prompt;
  const explicitItems = extractListSegmentsAfterMarkers(text)
    .flatMap((segment) => splitBatchItems(segment, MAX_GENERATION_COUNT));
  if (explicitItems.length >= 2) {
    return clampInteger(explicitItems.length, 1, MAX_GENERATION_COUNT);
  }

  const contextUnitCount = Number(context.estimatedContentUnits) || 0;
  if (contextUnitCount > 0) {
    return clampInteger(contextUnitCount, 1, MAX_GENERATION_COUNT);
  }

  const headings = String(text || '').match(/(?:^|\n)\s*(?:第[一二三四五六七八九十百\d]+[章节课单元]|[一二三四五六七八九十\d]+[、.．)]|[（(][一二三四五六七八九十\d]+[）)])/gu) || [];
  if (headings.length >= 2) {
    return clampInteger(headings.length, 1, MAX_GENERATION_COUNT);
  }

  return 4;
}

function estimateContentPlanningFloor(data) {
  if (data.count) return data.count;

  const context = data.knowledgeContext || createEmptyKnowledgeContext();
  const unitCount = Number(context.estimatedContentUnits) || 0;
  if (unitCount >= 8 && hasNumberedContentUnitEvidence(context)) {
    return clampInteger(unitCount, 1, MAX_GENERATION_COUNT);
  }
  if (unitCount >= 8) {
    return clampInteger(Math.ceil(unitCount * 0.65), 1, MAX_GENERATION_COUNT);
  }
  if (unitCount > 0) {
    return clampInteger(unitCount, 1, MAX_GENERATION_COUNT);
  }

  return 1;
}

function hasNumberedContentUnitEvidence(context) {
  const headingCount = (context.fileSummaries || [])
    .reduce((sum, file) => sum + (Number(file.headingCount) || 0), 0);
  return headingCount >= 8;
}

function createRaisedCountReason(data, rawCount, finalCount) {
  return `${createCountReason(data, finalCount)} AI 返回的数量与页面规划不一致或缺少可用数量，已按可用页面规划和内容线索兜底为 ${finalCount} 张；源文件页数没有作为数量下限。`;
}

function createCountReason(data, count) {
  if (data.countWasUserProvided) {
    return `用户指定生成 ${count} 张。`;
  }

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
    ? '按知识库中的章节、知识点、内容模块和用户目标进行拆分；合并重复内容，保留核心信息，确保重点内容不遗漏；不默认加入用户未要求的答题类模块。'
    : '按用户提示词中的教学目标拆分为若干独立内容单元，每张图承担一个清晰的学习目标。';
}

function createFallbackLayoutLogic(data) {
    return hasStyleReference(data)
    ? '以当次上传参考风格图的真实版式为唯一模板，逐像素复刻其结构、栏目、边距、装饰和视觉密度；不要套用任何非参考图来源的默认版式。'
    : data.options.layoutFixed
      ? '整批图片沿用同一用户指定或规则确认后的版式骨架，只替换当前页专属内容；不默认设置用户未要求的功能区。'
    : '整批图片的视觉组织由用户提示词、知识库内容类型和规则确认结果决定；不套用固定模板或默认栏目结构。';
}

function createFallbackStyleLogic(data) {
    return hasStyleReference(data)
    ? '当次上传参考风格图是唯一视觉风格来源；严格复刻其配色、字体层级、边框样式、图标/插画位置、栏目形状、页眉页脚和留白比例。'
    : '视觉风格由用户提示词决定；如果用户未指定风格，则保持清晰、简洁、无水印和无关装饰，不默认套用任何固定模板。';
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

function composeTeachingAidPrompt(data, index, context = {}) {
  const hasStyleReferenceImage = hasStyleReference(data);
  const preserveKnowledgeContent = isKnowledgeContentPreservationRequired(data.prompt);
  const labels = [];
  if (data.grade) labels.push(`年级/学段：${data.grade}`);
  if (data.subject) labels.push(`学科：${data.subject}`);
  if (data.materialType) labels.push(`资料类型：${data.materialType}`);
  if (data.scenario) labels.push(`使用场景：${data.scenario}`);
  if (data.aspectRatio) labels.push(`图片比例：${data.aspectRatio}`);

  const options = [];
  if (data.options.layoutFixed) options.push('同一批次排版设计固定，所有页面只替换当前页专属内容');
  if (hasStyleReferenceImage) options.push('当次上传参考风格图是唯一视觉模板，所有版式样式以参考图为准');

  const assignedItem = data.batchItems[index] || '';
  const assignmentInstruction = assignedItem
    ? [
        `本张专属内容：${assignedItem}`,
        `当前第 ${index + 1} 张只能围绕「${assignedItem}」生成。`,
        '本张的内容结构、信息密度和视觉表达必须由用户提示词、知识库内容和已确认生成规则决定。',
        '不要默认加入用户未要求的答题、示例、记录或复盘模块；只有当前专属内容或用户提示词明确需要时才加入。',
        '禁止把其他批量项目作为主标题、核心词、核心知识点或主要内容；禁止重复使用其他页的专属内容。',
        data.batchItems.length === data.count
          ? '本批次每一页都有独立内容边界；当前页只写“本张专属内容”，不得写成全册总览，不得混入其他页面内容。'
          : '',
      ].join('\n')
    : '';

  const batchInstruction =
    data.count > 1
      ? data.options.layoutFixed
        ? composeFixedLayoutInstruction(data, index, context)
        : assignedItem
          ? `这是批量生成中的第 ${index + 1}/${data.count} 张。请保持整批视觉风格和内容类型一致，但严格按“本张专属内容”生成当前页。`
          : `这是批量生成中的第 ${index + 1}/${data.count} 张，请保持主题一致，但内容结构和视觉组织要根据用户提示词自然变化。`
      : data.options.layoutFixed
        ? '请先建立一个可复用的页面版式，保持清晰稳定的视觉结构；版式类型必须服从用户提示词，不默认做成固定模板。'
        : '';

  return [
    hasStyleReferenceImage
      ? '请生成一张内容为简体中文的教辅资料图片；视觉设计必须以当次上传的参考风格图为唯一模板。'
      : '请根据用户核心需求生成一张内容为简体中文的图片；图片类型、内容结构和视觉风格都必须由用户提示词和知识库内容决定。',
    labels.length > 0 ? labels.join('；') : '',
    `用户核心需求：${data.prompt}`,
    composeKnowledgeContentPreservationInstruction(data, index),
    composeCurrentPageKnowledgeAnchor(data, index),
    hasStyleReferenceImage
      ? preserveKnowledgeContent
        ? '优先级硬规则：知识库原文逐字保真锁决定所有可见文字；当次上传参考风格图只决定视觉样式。任何版式、规则摘要或模型习惯都不能修改锁定原文。'
        : '优先级硬规则：当次上传参考风格图 > 已确认生成规则里的内容规划 > 知识库内容 > 全局提示词。任何非参考图来源的默认模板、应用示例样式、历史生成样式或规则文本中的泛化版式，都不能覆盖当次参考图。'
      : '全局提示词同时约束知识库内容取舍和最终图片生成；知识库负责内容依据。',
    composeSingleImageKnowledgeContext(data, index),
    composeConfirmedGenerationRulePrompt(data, index),
    assignmentInstruction,
    batchInstruction,
    options.length > 0 ? `偏好：${options.join('；')}。` : '',
    hasStyleReferenceImage
      ? [
          '参考风格图复刻要求：',
          '- 参考风格图不是灵感图，而是唯一设计母版。必须尽可能一比一复刻其页面结构、页眉、标题区、栏目数量、栏目顺序、栏目框样式、边框粗细、圆角、分割线、题号样式、插画/图标位置、页脚、配色、字体层级、留白比例和整体视觉密度。',
          '- 只替换为知识库和当前页规则要求的教学内容；不要改变版式骨架，不要重新发明新的卡片布局、颜色体系或装饰元素。',
          '- 不要复制参考图中的水印、二维码、真实姓名、联系方式、页码编号或与当前知识点无关的原文。',
          '- 如果参考风格图包含具体标题样式，例如大标题、专题编号、星标、书本/铅笔/人物插画等，应保留同类位置和视觉关系。',
          '- 禁止套用本应用结果区示例、默认模板、通用装饰元素或历史生成图片的样式。',
          '- 知识库只提供内容依据；参考风格图决定外观。若知识库截图、规则文本或用户提示词中的泛化版式与参考风格图冲突，必须忽略它们的视觉样式。',
        ].join('\n')
      : '',
    context.layoutReference
      ? [
          '固定模板参考图要求：',
          '- 已提供第 1 张作为本套图的母版参考图。',
          '- 必须像编辑同一个版式文件一样生成当前页：沿用母版中真实存在的版式骨架、边距、标题区、内容模块、页脚、配色、字体层级和装饰元素。',
          '- 只复用母版排版，不要照抄母版中的具体文字；也不要额外添加母版或用户需求里不存在的内容模块。',
          '- 必须把母版中的所有具体文字当成占位符，按当前页专属内容全量替换。',
          '- 只替换当前页需要变化的文字、图示、内容模块和页码等元素。',
          '- 不要重新设计封面、标题样式、栏目位置或页面结构。',
        ].join('\n')
      : '',
    [
      '输出要求：',
      '- 成品是一张完整图片，不要出现网页界面、按钮、边框外壳或软件截图感。',
      '- 文字清晰可读，标题、正文、图示、模块或其他信息层级应匹配用户要求。',
      hasStyleReferenceImage
        ? '- 在不破坏参考图版式的前提下保证文字清晰；不要为了通用可读性要求重新设计参考图。'
        : '- 不要默认套用任何固定模板，也不要默认添加用户未要求的页面模块；风格由用户提示词决定。',
      preserveKnowledgeContent
        ? '- 不得纠正或改写锁定原文；仅避免生成原文之外的错字、乱码、水印、品牌标识和无关装饰。'
        : '- 避免事实性错误、错别字、乱码、水印、品牌标识和无关装饰。',
      '- 只有当用户提示词、知识库内容或已确认规则明确需要特定内容模块时，才生成这些元素。',
      hasStyleReferenceImage
        ? '- 有参考风格图时，最终图片必须看起来像直接在参考图源文件上替换了内容，而不是同主题的新设计。'
        : '',
      data.options.layoutFixed
        ? '- 排版固定模式下，所有页面必须保持模板一致，不能为了内容差异而重新设计页面。'
        : '',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
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
  if (!data.generationRule) return '';

  const rule = data.generationRule;
  const page = rule.pages[index] || null;
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
          page.mustInclude.length > 0 ? `必须包含：${page.mustInclude.join('；')}` : '',
          page.avoid.length > 0 ? `不要混入：${page.avoid.join('；')}` : '',
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
  ]
    .filter(Boolean)
    .join('\n');
}

function composeFixedLayoutInstruction(data, index, context) {
  const hasStyleReferenceImage = hasStyleReference(data);
  if (index === 0) {
    const assignedItem = data.batchItems[index] || '';
    if (hasStyleReferenceImage) {
      return [
        `这是批量套图中的第 1/${data.count} 张，也是后续页面的母版页面。`,
        '第 1 张母版不得自建新模板，必须先一比一复刻当次上传参考风格图的真实版式、栏目、色彩、装饰、字体层级和留白比例。',
        '后续页面会沿用第 1 张，因此第 1 张必须把参考风格图复刻准确；只替换为当前页知识内容。',
        assignedItem ? `第 1 张母版页的专属内容是「${assignedItem}」，不要在第 1 张中混入其他页的专属内容。` : '',
        '母版页的文字内容只是第 1 个内容单元，不代表后续页内容；后续页必须全量替换为各自专属内容。',
        '第 1 张也必须是完整可用的教辅页面，不要输出空白模板。',
      ].filter(Boolean).join('\n');
    }

    return [
      `这是批量套图中的第 1/${data.count} 张，也是本套图的母版页面。`,
      '请先确定一套稳定、可复用的页面版式，版式类型必须服从用户提示词和当前内容类型。',
      '这个模板之后会被作为参考图用于生成后续页面，所以必须有明确固定的视觉骨架、页边距、标题区域、内容模块、页脚/页码位置、配色、字体层级和装饰元素；不要默认加入用户未要求的功能区。',
      assignedItem ? `第 1 张母版页的专属内容是「${assignedItem}」，不要在第 1 张中混入其他页的专属内容。` : '',
      '母版页的文字内容只是第 1 个内容单元，不代表后续页内容；后续页必须全量替换为各自专属内容。',
      '第 1 张也必须是完整可用的教辅页面，不要输出空白模板。',
    ].filter(Boolean).join('\n');
  }

  if (context.layoutReference) {
    const assignedItem = data.batchItems[index] || '';
    return [
      `这是批量套图中的第 ${index + 1}/${data.count} 张。`,
      hasStyleReferenceImage
        ? '必须沿用第 1 张母版页面中已经复刻参考风格图的排版；如果第 1 张母版与当次上传参考风格图有偏差，应优先回到当次参考风格图。'
        : '必须严格沿用第 1 张母版页面的排版设计，生成同一套图片的连续页面；不要把套图固定理解成某一种默认模板。',
      '排版样式必须 100% 一致：页面网格、页边距、标题区域、内容模块、页脚/页码位置、配色、字体层级和装饰元素都不能改变；只有母版真实存在的功能区才沿用这些元素。',
      '第 1 张母版中的具体文字全部视为占位符：不要照抄母版中的章节标题、知识点文本或其他具体内容。',
      assignedItem ? `当前页必须替换为专属内容「${assignedItem}」，不要继续使用第 1 张母版页的专属内容。` : '',
      `必须全量变化当前第 ${index + 1} 页需要变化的文字、图示、内容模块和页码等元素；不要默认添加用户未要求的内容模块。`,
    ].filter(Boolean).join('\n');
  }

  return [
    `这是批量套图中的第 ${index + 1}/${data.count} 张。`,
    hasStyleReferenceImage
      ? '本批次必须像同一张参考风格图模板延展出的连续页面：每张图片都要复刻当次参考图的排版样式。'
      : '本批次必须像同一套用户指定类型的连续图片：每张图片的排版样式保持一致，但不要默认做成某一种固定模板。',
    '必须固定相同的页面网格、页边距、标题区域、内容模块、页脚/页码位置、配色、字体层级和装饰元素；不要默认加入用户未要求的功能区。',
    '只允许变化当前页专属内容和页码；不要改变版面结构、视觉组织、模块数量或模块位置。',
  ].join('\n');
}

function validateGeneratePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '请求体必须是 JSON 对象' };
  }

  const prompt = cleanText(payload.prompt, 2000);
  if (!prompt) {
    return { ok: false, message: '请填写提示词' };
  }

  const count = Number(payload.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATION_COUNT) {
    return { ok: false, message: `单次生成数量必须是 1 到 ${MAX_GENERATION_COUNT} 的整数` };
  }

  const imageRatio = resolveImageRatio(payload.aspectRatio, payload.customAspectRatio);
  const providedBatchItems = Array.isArray(payload.batchItems)
    ? payload.batchItems
        .slice(0, count)
        .map((item) => cleanText(stringifyBatchItemInput(item), BATCH_ITEM_MAX_CHARS))
    : [];
  const batchItems =
    providedBatchItems.length === count && providedBatchItems.every(Boolean)
      ? providedBatchItems
      : extractBatchItems(prompt, count) || createAutoBatchItems(prompt, count);
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

  const rawStyleReferenceImages = Array.isArray(payload.styleReferenceImages)
    ? payload.styleReferenceImages
    : Array.isArray(payload.referenceImages)
      ? payload.referenceImages
      : [];
  const styleReferenceImages = rawStyleReferenceImages
    .slice(0, 4)
    .map(normalizeReferenceImage)
    .filter(Boolean);
  const knowledgeFiles = Array.isArray(payload.knowledgeFiles)
    ? payload.knowledgeFiles.map(normalizeKnowledgeFile).filter(Boolean)
    : [];

  return {
    ok: true,
    data: {
      prompt,
      count,
      targetIndex,
      clientBatchId,
      batchItems,
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
      generationRule: normalizeGenerationRulePayload(payload.generationRule, count),
      styleReferenceImages,
      styleReferenceProvided: Boolean(payload.styleReferenceProvided || rawStyleReferenceImages.length > 0),
      styleReferenceCount: clampInteger(
        Number(payload.styleReferenceCount) || rawStyleReferenceImages.length,
        0,
        4,
      ),
      knowledgeFiles,
      knowledgeContext: createEmptyKnowledgeContext(),
      layoutReferenceImage: normalizeGeneratedImagePath(payload.layoutReferenceImage),
    },
  };
}

function normalizeGenerationBatchId(value) {
  const normalized = cleanText(value, 80);
  return /^[a-z0-9][a-z0-9_-]{15,79}$/iu.test(normalized) ? normalized : '';
}

function validateGenerationRulePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '请求体必须是 JSON 对象' };
  }

  const prompt = cleanText(payload.prompt, 2000);
  if (!prompt) {
    return { ok: false, message: '请填写提示词' };
  }

  const countValidation = parseOptionalGenerationCount(payload.count);
  if (!countValidation.ok) {
    return { ok: false, message: countValidation.message };
  }

  const count = countValidation.count;
  const imageRatio = resolveImageRatio(payload.aspectRatio, payload.customAspectRatio);
  const rawStyleReferenceImages = Array.isArray(payload.styleReferenceImages)
    ? payload.styleReferenceImages
    : Array.isArray(payload.referenceImages)
      ? payload.referenceImages
      : [];
  const styleReferenceImages = rawStyleReferenceImages
    .slice(0, 4)
    .map(normalizeReferenceImage)
    .filter(Boolean);
  const knowledgeFiles = Array.isArray(payload.knowledgeFiles)
    ? payload.knowledgeFiles.map(normalizeKnowledgeFile).filter(Boolean)
    : [];
  const batchItems = count
    ? extractBatchItems(prompt, count) || createAutoBatchItems(prompt, count)
    : [];

  return {
    ok: true,
    data: {
      prompt,
      count,
      countWasUserProvided: Boolean(count),
      targetIndex: null,
      batchItems,
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
      generationRule: null,
      styleReferenceImages,
      styleReferenceProvided: Boolean(payload.styleReferenceProvided || rawStyleReferenceImages.length > 0),
      styleReferenceCount: clampInteger(
        Number(payload.styleReferenceCount) || rawStyleReferenceImages.length,
        0,
        4,
      ),
      knowledgeFiles,
      knowledgeContext: createEmptyKnowledgeContext(),
      layoutReferenceImage: '',
    },
  };
}

function parseOptionalGenerationCount(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, count: 0 };
  }

  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATION_COUNT) {
    return { ok: false, message: `单次生成数量必须是 1 到 ${MAX_GENERATION_COUNT} 的整数，或留空由 AI 判断` };
  }

  return { ok: true, count };
}

function normalizeGeneratedImagePath(value) {
  const source = cleanText(value, 260);
  if (!source) return '';
  return source.startsWith(`${GENERATED_URL_PREFIX}/`) ? source : '';
}

function normalizeGenerationRulePayload(rule, count) {
  if (!rule || typeof rule !== 'object') return null;

  const pages = Array.isArray(rule.pages)
    ? rule.pages.slice(0, count).map((page, index) => normalizeRulePage(page, index, {
        count,
        prompt: '',
        batchItems: [],
      }))
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
      ? rule.batchItems
          .slice(0, count)
          .map((item) => cleanText(stringifyBatchItemInput(item), BATCH_ITEM_MAX_CHARS))
          .filter(Boolean)
      : [],
  };
}

function stringifyBatchItemInput(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';

  const parts = [
    value.title,
    value.focus,
    value.sourceLogic ? `资料依据：${value.sourceLogic}` : '',
    Array.isArray(value.mustInclude) ? `必须包含：${value.mustInclude.join('；')}` : '',
    Array.isArray(value.avoid) ? `避免混入：${value.avoid.join('；')}` : '',
    value.knowledgeAnchor ? `知识库锚点：${value.knowledgeAnchor.title || ''}；${value.knowledgeAnchor.content || ''}` : '',
  ].filter(Boolean);

  return parts.join('。');
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
  const mimeType =
    resolveKnowledgeMimeType(name, dataUrlMimeType) ||
    resolveKnowledgeMimeType(name, declaredMimeType);

  if (!mimeType || !ALLOWED_KNOWLEDGE_MIME_TYPES.has(mimeType)) return null;
  if (!dataUrlMimeType || !dataUrl.startsWith('data:')) return null;

  return {
    name,
    mimeType,
    dataUrl,
    size: Number.isFinite(Number(file.size)) ? Number(file.size) : 0,
  };
}

function resolveKnowledgeMimeType(name, mimeType) {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  if (ALLOWED_KNOWLEDGE_MIME_TYPES.has(normalizedMimeType)) return normalizedMimeType;
  const inferred = KNOWLEDGE_MIME_BY_EXTENSION.get(path.extname(name).toLowerCase());
  return inferred || '';
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
    pdfPageImageLimit: RULE_PDF_PAGE_IMAGE_MAX_COUNT,
    knowledgeBlueprint: createEmptyKnowledgeBlueprint(),
  };
}

async function attachKnowledgeContext(data, options = {}) {
  data.knowledgeContext = await buildKnowledgeContext(data.knowledgeFiles, data.abortSignal, options);
}

async function buildKnowledgeContext(files, signal, options = {}) {
  if (!files.length) return createEmptyKnowledgeContext();

  const fileTextMaxChars = options.fileTextMaxChars || KNOWLEDGE_FILE_TEXT_MAX_CHARS;
  const totalTextMaxChars = options.totalTextMaxChars || KNOWLEDGE_TOTAL_TEXT_MAX_CHARS;
  const includePdfPageImages = Boolean(options.includePdfPageImages);
  const pdfPageImageMaxCount = clampInteger(
    Number(options.pdfPageImageMaxCount) || RULE_PDF_PAGE_IMAGE_MAX_COUNT,
    1,
    RULE_PDF_PAGE_IMAGE_MAX_COUNT,
  );
  const pdfPageImageWidth = clampInteger(
    Number(options.pdfPageImageWidth) || RULE_PDF_PAGE_IMAGE_WIDTH,
    360,
    RULE_PDF_PAGE_IMAGE_WIDTH,
  );
  const textEntries = [];
  const imageReferences = [];
  const skippedFiles = [];
  const fileSummaries = [];
  let knowledgeImageCount = 0;
  let pdfPageImageCount = 0;

  for (const file of files) {
    assertNotAborted(signal);

    if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
      knowledgeImageCount += 1;
      imageReferences.push({
        name: `knowledge-${file.name}`,
        mimeType: file.mimeType,
        dataUrl: file.dataUrl,
      });
      fileSummaries.push({
        name: file.name,
        mimeType: file.mimeType,
        pageCount: 0,
        textChars: 0,
        headingCount: 0,
        estimatedUnits: 0,
        note: '图片知识库文件，仅作为多模态内容证据交给 AI 分析，不按图片张数估算生成数量。',
      });
      continue;
    }

    try {
      const { buffer, mimeType } = dataUrlFileToBuffer(file.dataUrl, file.mimeType);
      const content = await extractKnowledgeContent(buffer, mimeType, file.name);
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

      if (includePdfPageImages && mimeType === 'application/pdf' && content.pageCount > 0) {
        try {
          const pdfPageReferences = await renderPdfPageReferences(buffer, file.name, content.pageCount, {
            maxCount: pdfPageImageMaxCount,
            desiredWidth: pdfPageImageWidth,
          });
          assertNotAborted(signal);
          imageReferences.push(...pdfPageReferences.references);
          pdfPageImageCount += pdfPageReferences.references.length;
          summary.renderedPageCount = pdfPageReferences.references.length;
          summary.sampledPages = pdfPageReferences.pageNumbers;
          summary.note = appendKnowledgeNote(
            summary.note,
            createPdfPageImageNote(pdfPageReferences.pageNumbers, content.pageCount),
          );
        } catch (error) {
          summary.note = appendKnowledgeNote(
            summary.note,
            `PDF 页面截图渲染失败，页数仅作来源定位，不参与数量决策：${formatKnowledgeExtractionError(error)}`,
          );
        }
      }

      fileSummaries.push(summary);
      if (text) {
        textEntries.push({ name: file.name, text });
      } else {
        skippedFiles.push(`${file.name}：未提取到可用文本，页数仅作来源定位；需由规则模型结合截图和上下文判断真实内容单元`);
      }
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
      });
    }
  }

  const totalPages = fileSummaries.reduce((sum, file) => sum + file.pageCount, 0);
  const totalTextChars = fileSummaries.reduce((sum, file) => sum + file.textChars, 0);
  const estimatedContentUnits = clampInteger(
    fileSummaries.reduce((sum, file) => sum + file.estimatedUnits, 0),
    files.length > 0 ? 1 : 0,
    MAX_GENERATION_COUNT,
  );

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
    pdfPageImageLimit: pdfPageImageMaxCount,
  };
}

async function renderPdfPageReferences(buffer, fileName, pageCount, options = {}) {
  const maxCount = clampInteger(Number(options.maxCount) || RULE_PDF_PAGE_IMAGE_MAX_COUNT, 1, RULE_PDF_PAGE_IMAGE_MAX_COUNT);
  const desiredWidth = clampInteger(Number(options.desiredWidth) || RULE_PDF_PAGE_IMAGE_WIDTH, 360, RULE_PDF_PAGE_IMAGE_WIDTH);
  const pageNumbers = selectPdfPageNumbers(pageCount, maxCount);
  if (pageNumbers.length === 0) {
    return {
      references: [],
      pageNumbers: [],
    };
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getScreenshot({
      partial: pageNumbers,
      desiredWidth,
      imageBuffer: false,
      imageDataUrl: true,
    });

    const references = (result.pages || [])
      .filter((page) => page?.dataUrl)
      .map((page) => ({
        name: `knowledge-${cleanReferenceFileName(fileName)}-page-${page.pageNumber}.png`,
        mimeType: 'image/png',
        dataUrl: page.dataUrl,
        source: 'pdf-page',
        pageNumber: page.pageNumber,
      }));

    return {
      references,
      pageNumbers: references.map((reference) => reference.pageNumber),
    };
  } finally {
    await parser.destroy();
  }
}

function selectPdfPageNumbers(pageCount, maxCount) {
  const total = Math.max(0, Number(pageCount) || 0);
  const limit = clampInteger(Number(maxCount) || RULE_PDF_PAGE_IMAGE_MAX_COUNT, 1, RULE_PDF_PAGE_IMAGE_MAX_COUNT);
  if (total <= 0) return [];
  if (total <= limit) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = new Set();
  const edgeCount = Math.min(3, Math.floor(limit / 3));
  for (let page = 1; page <= edgeCount; page += 1) {
    pages.add(page);
    pages.add(total - page + 1);
  }

  const remaining = limit - pages.size;
  if (remaining > 0) {
    for (let index = 0; index < remaining; index += 1) {
      const denominator = Math.max(1, remaining - 1);
      pages.add(Math.round(1 + (index * (total - 1)) / denominator));
    }
  }

  for (let page = 1; pages.size < limit && page <= total; page += 1) {
    pages.add(page);
  }

  return [...pages]
    .filter((page) => page >= 1 && page <= total)
    .sort((left, right) => left - right)
    .slice(0, limit);
}

function createPdfPageImageNote(pageNumbers, totalPages) {
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
    return '';
  }

  const sampleLabel = formatPageNumbersForPrompt(pageNumbers, 18);
  return `已附 PDF 来源页截图样本供规则确认识别内容，来源页码：${sampleLabel}；截图数量和 PDF 总页数不参与生成数量决策`;
}

function formatPageNumbersForPrompt(pageNumbers, limit = 12) {
  const normalized = [...new Set(
    (Array.isArray(pageNumbers) ? pageNumbers : [])
      .map((page) => Number(page))
      .filter((page) => Number.isInteger(page) && page > 0),
  )].sort((left, right) => left - right);

  if (normalized.length <= limit) {
    return normalized.join('、');
  }

  return `${normalized.slice(0, limit).join('、')} 等 ${normalized.length} 页`;
}

function appendKnowledgeNote(note, addition) {
  return [note, addition].filter(Boolean).join('，');
}

function cleanReferenceFileName(fileName) {
  return String(fileName || 'pdf')
    .replace(/\.[^.]+$/u, '')
    .replace(/[^\p{Script=Han}A-Za-z0-9._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80) || 'pdf';
}

async function extractKnowledgeContent(buffer, mimeType, name) {
  const rawText = await extractKnowledgeText(buffer, mimeType, name);
  const text = normalizeKnowledgeText(rawText);
  const headings = extractKnowledgeHeadings(text);
  const pageCount = mimeType === 'application/pdf'
    ? await extractPdfPageCount(buffer)
    : 0;
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
  if (mimeType === 'application/pdf') {
    return extractPdfText(buffer);
  }

  if (mimeType === WORD_DOCX_MIME_TYPE) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (mimeType === 'application/msword') {
    return extractLegacyWordText(buffer);
  }

  if (mimeType === 'text/html') {
    return stripHtml(buffer.toString('utf8'));
  }

  if (mimeType === 'application/json') {
    return stringifyJsonKnowledge(buffer.toString('utf8'), name);
  }

  return buffer.toString('utf8');
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

async function extractPdfPageCount(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getInfo();
    const total = Number(result?.total);
    if (Number.isInteger(total) && total > 0) return total;
  } catch {
    // PDF 元信息读取失败时使用二进制特征兜底。
  } finally {
    await parser.destroy();
  }

  return estimatePdfPageCountFromBuffer(buffer);
}

function estimatePdfPageCountFromBuffer(buffer) {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page\b/g) || [];
  return matches.length;
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

function normalizeKnowledgeText(value) {
  return String(value || '')
    .replace(/\u0000/gu, ' ')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t\f\v]+/gu, ' ')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
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

function extractKnowledgeHeadings(text) {
  return String(text || '')
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line.length >= 2 && line.length <= 80)
    .filter((line) =>
      /^(?:第[一二三四五六七八九十百\d]+[章节课讲单元]|[一二三四五六七八九十\d]+[、.．)]|[（(][一二三四五六七八九十\d]+[）)]|[A-Z]\.|[IVX]+\.|专题|模块|知识点|考点|训练|练习|阅读|写作|文学常识)/u.test(line),
    )
    .slice(0, MAX_GENERATION_COUNT);
}

function estimateContentUnitsFromEvidence({ mimeType, pageCount, text, headings }) {
  const textChars = String(text || '').length;
  const headingCount = Array.isArray(headings) ? headings.length : 0;
  const textDensityUnits = Math.ceil(textChars / DEFAULT_CONTENT_UNITS_PER_TEXT_CHARS);
  const estimated = Math.max(headingCount, textDensityUnits, 1);
  return clampInteger(estimated, 1, MAX_GENERATION_COUNT);
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
    let remaining = options.totalTextMaxChars || KNOWLEDGE_TOTAL_TEXT_MAX_CHARS;
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

function extractBatchItems(prompt, count) {
  if (count <= 1) return [];

  const candidates = [
    ...extractListSegmentsAfterMarkers(prompt),
    ...extractLineListSegments(prompt),
  ];

  for (const candidate of candidates) {
    const items = splitBatchItems(candidate, count);
    if (items.length === count && hasDistinctItems(items)) {
      return items;
    }
  }

  return null;
}

function createAutoBatchItems(prompt, count) {
  if (count <= 1 || !shouldAutoPlanChapters(prompt)) return [];

  const topic = extractTeachingTopic(prompt);
  const topicPlan = createTopicChapterPlan(topic, count);
  if (topicPlan.length === count && hasDistinctItems(topicPlan)) {
    return topicPlan;
  }

  return Array.from({ length: count }, (_, index) =>
    normalizeBatchItem(`第 ${index + 1} 小节：${topic} - ${createGenericChapterFocus(index, count)}`),
  );
}

function shouldAutoPlanChapters(prompt) {
  return /每\s*[张页个].*(小节|章节|知识|内容|不一样|不同)|每张图|每页|小节|章节|完整(教材|教辅|学习册|课程)|构成完整|合起来|连续页面|一套教材|一套教辅/iu.test(
    prompt,
  );
}

function extractTeachingTopic(prompt) {
  if (isKnowledgeDrivenGenericPrompt(prompt)) {
    return '知识库核心内容';
  }

  const patterns = [
    /主题(?:是|为)?\s*([^，。；;\n]+)/u,
    /关于\s*([^，。；;\n]+)/u,
    /围绕\s*([^，。；;\n]+)/u,
    /内容(?:是|为|围绕)\s*([^，。；;\n]+)/u,
    /生成\s*\d*\s*张[^，。；;\n]*?(?:教材|教辅|图片|图)\s*，?\s*([^，。；;\n]+)/u,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(prompt);
    if (match?.[1]) {
      return normalizeTopic(match[1]);
    }
  }

  return normalizeTopic(prompt);
}

function normalizeTopic(value) {
  const topic = cleanText(value, 80)
    .replace(/^(?:是|为|关于|围绕|生成|制作|设计|一套|完整的?)+/u, '')
    .replace(/(?:根据|结合)?知识库(?:的)?(?:文件|内容|资料)?/gu, '知识库核心内容')
    .replace(/参考风格(?:一样|一致)?/gu, '')
    .replace(/(?:确保|保证)?(?:不要|不)遗漏(?:知识库)?(?:文件)?(?:内容)?/gu, '')
    .replace(/(?:每张|每页|每个).+$/u, '')
    .replace(/(?:，|。|；|;).*$/u, '')
    .trim();

  if (isBadRuleFocus(topic)) return '知识库核心内容';
  return topic || '知识库核心内容';
}

function isKnowledgeDrivenGenericPrompt(prompt) {
  const text = cleanText(prompt, 200);
  return /知识库/u.test(text) && /(参考风格|不要遗漏|不遗漏|生成.*图片|根据.*内容)/u.test(text);
}

function createTopicChapterPlan(topic, count) {
  const normalized = topic.toLocaleLowerCase('zh-CN');
  const compactTopic = topic.replace(/\s+/gu, '');

  if (/句子成分|sentence\s*components?/iu.test(normalized)) {
    return [
      `第 1 小节：${compactTopic} - 主语 Subject，识别句子说明的人或事物`,
      `第 2 小节：${compactTopic} - 谓语 Predicate，理解动作、状态和谓语动词结构`,
      `第 3 小节：${compactTopic} - 宾语 Object，区分直接宾语和间接宾语`,
      `第 4 小节：${compactTopic} - 表语 Predicative，掌握系表结构和主语状态说明`,
      `第 5 小节：${compactTopic} - 定语 Attributive，学习修饰名词或代词的成分`,
      `第 6 小节：${compactTopic} - 状语 Adverbial，学习时间、地点、原因、方式等修饰成分`,
      `第 7 小节：${compactTopic} - 补语 Complement，理解宾补和主补的作用`,
      `第 8 小节：${compactTopic} - 同位语 Appositive，学习补充说明名词的结构`,
    ].slice(0, count);
  }

  if (/英语语法|english\s*grammar/iu.test(normalized)) {
    return [
      `第 1 小节：${compactTopic} - 核心概念总览与学习目标`,
      `第 2 小节：${compactTopic} - 基础规则与结构判断`,
      `第 3 小节：${compactTopic} - 典型例句拆解与标注`,
      `第 4 小节：${compactTopic} - 易错点、混淆点和辨析`,
      `第 5 小节：${compactTopic} - 应用场景与课堂任务`,
      `第 6 小节：${compactTopic} - 综合运用与表达整理`,
      `第 7 小节：${compactTopic} - 拓展表达与真实语境`,
      `第 8 小节：${compactTopic} - 单元回顾与迁移应用`,
    ].slice(0, count);
  }

  return [];
}

function createGenericChapterFocus(index, count) {
  const focuses = [
    '核心概念与学习目标',
    '基础规则与关键知识点',
    '关键示例与步骤拆解',
    '易错点辨析与对比说明',
    '应用场景与实践任务',
    '综合运用与阶段总结',
    '拓展迁移与真实情境',
    '单元回顾与成果评价',
  ];

  if (index < focuses.length) return focuses[index];
  return `拓展小节 ${index + 1}/${count}`;
}

function extractListSegmentsAfterMarkers(prompt) {
  const segments = [];
  const markerPattern =
    /(分别(?:是|为|生成|对应)?|每张(?:图|图片|页面|卡片)?(?:分别)?(?:是|为)?|知识点(?:分别)?(?:是|为)?|内容(?:分别)?(?:是|为)?|单词(?:分别)?(?:是|为)?|主题(?:分别)?(?:是|为)?)[^：:，。,.\n]{0,24}[：:]/giu;
  let match;

  while ((match = markerPattern.exec(prompt)) !== null) {
    const tail = prompt.slice(match.index + match[0].length);
    const firstLine = tail.split(/\r?\n/u)[0] || '';
    if (firstLine.trim()) {
      segments.push(firstLine);
    }
  }

  const colonIndex = Math.max(prompt.lastIndexOf('：'), prompt.lastIndexOf(':'));
  if (colonIndex !== -1) {
    const afterLastColon = prompt.slice(colonIndex + 1).split(/\r?\n/u)[0] || '';
    if (afterLastColon.trim()) {
      segments.push(afterLastColon);
    }
  }

  return segments;
}

function extractLineListSegments(prompt) {
  const lines = prompt
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const numberedItems = [];
  for (const line of lines) {
    const match = /^(?:[-*•]|\d+[.、)]|[（(]?\d+[）)])\s*(.+)$/u.exec(line);
    if (match) {
      numberedItems.push(match[1]);
    }
  }

  return numberedItems.length > 0 ? [numberedItems.join('、')] : [];
}

function splitBatchItems(segment, count) {
  return segment
    .replace(/[。；;].*$/u, '')
    .split(/[、，,\/|]+/u)
    .map(normalizeBatchItem)
    .filter(Boolean)
    .slice(0, count);
}

function normalizeBatchItem(value) {
  return cleanText(value, BATCH_ITEM_MAX_CHARS)
    .replace(/^["'“”‘’「」『』\s]+|["'“”‘’「」『』\s]+$/gu, '')
    .replace(/^(?:and|or|以及|和|与)\s+/iu, '')
    .replace(/\s+(?:and|or|以及|和|与)$/iu, '')
    .trim();
}

function hasDistinctItems(items) {
  const normalized = items.map((item) => item.toLocaleLowerCase('zh-CN'));
  return new Set(normalized).size === items.length;
}

function resolveImageRatio(aspectRatio, customAspectRatio) {
  const preset = cleanText(aspectRatio, 16);
  if (ASPECT_RATIO_SIZES.has(preset)) {
    return {
      label: preset,
      size: ASPECT_RATIO_SIZES.get(preset),
    };
  }

  if (preset === 'custom') {
    const parsedCustom = parseCustomAspectRatio(customAspectRatio);
    if (parsedCustom) {
      return {
        label: parsedCustom,
        size: 'auto',
      };
    }
  }

  return {
    label: '9:16',
    size: ASPECT_RATIO_SIZES.get('9:16'),
  };
}

function resolveImageRequestSize(data) {
  if (getEffectiveImageResolutionMode() !== '4k') {
    return data.size || ASPECT_RATIO_SIZES.get('9:16');
  }

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
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return width / height;
}

function clampRatioForGptImage2(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 9 / 16;
  return Math.min(3, Math.max(1 / 3, ratio));
}

function floorToMultipleOf16(value) {
  return Math.max(16, Math.floor(value / 16) * 16);
}

function parseCustomAspectRatio(value) {
  const text = cleanText(value, 16);
  if (!text) return null;

  if (/^\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?$/u.test(text)) {
    const parts = text.split(':').map((item) => Number(item.trim()));
    if (parts.length === 2 && parts.every((item) => Number.isFinite(item) && item > 0)) {
      return `${formatRatioNumber(parts[0])}:${formatRatioNumber(parts[1])}`;
    }
  }

  if (/^\d+(?:\.\d+)?$/u.test(text)) {
    const ratio = Number(text);
    if (Number.isFinite(ratio) && ratio > 0) {
      return `${formatRatioNumber(ratio)}:1`;
    }
  }

  return null;
}

function formatRatioNumber(value) {
  return Number(value.toFixed(3)).toString();
}

async function imageSourceToReference(source, name) {
  const dataUrl = source.startsWith('data:image/')
    ? source
    : await fetchImageAsDataUrl(source);
  const mimeType = extractDataUrlMimeType(dataUrl);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error('第 1 张模板页图片类型不受支持，无法作为固定排版参考图');
  }

  return {
    name,
    mimeType,
    dataUrl,
  };
}

async function fetchImageAsDataUrl(source) {
  if (source.startsWith('/')) {
    return localPublicImageToDataUrl(source);
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`无法读取第 1 张模板页作为参考图：HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  const mimeType = contentType.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error('第 1 张模板页返回的图片类型不受支持，无法作为固定排版参考图');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function localPublicImageToDataUrl(source) {
  const pathname = decodeURIComponent(source.split('?')[0]);
  const relativePath = pathname.replace(/^\/+/u, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    throw new Error('第 1 张模板页路径无效，无法作为固定排版参考图');
  }

  const extension = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES.get(extension)?.split(';')[0] || '';
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error('第 1 张模板页图片类型不受支持，无法作为固定排版参考图');
  }

  const buffer = await readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function extractDataUrlMimeType(dataUrl) {
  const match = /^data:([^;]+);base64,/u.exec(dataUrl);
  if (!match) {
    throw new Error('第 1 张模板页图片格式无效，无法作为固定排版参考图');
  }
  return match[1].toLowerCase();
}

function dataUrlToBuffer(dataUrl, declaredMimeType) {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl);
  if (!match) {
    throw new Error('参考图片格式无效');
  }

  const mimeType = match[1];
  if (mimeType !== declaredMimeType || !ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error('参考图片类型不受支持');
  }

  return {
    mimeType,
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function dataUrlFileToBuffer(dataUrl, declaredMimeType) {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl);
  if (!match) {
    throw new Error('知识库文件格式无效');
  }

  const dataUrlMimeType = match[1].toLowerCase();
  const declared = String(declaredMimeType || '').toLowerCase();
  if (
    declared &&
    dataUrlMimeType !== declared &&
    dataUrlMimeType !== 'application/octet-stream'
  ) {
    throw new Error('知识库文件类型与内容不一致');
  }

  if (!ALLOWED_KNOWLEDGE_MIME_TYPES.has(declared)) {
    throw new Error('知识库文件类型不受支持');
  }

  return {
    mimeType: declared,
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function readDataUrlMimeType(dataUrl) {
  const match = /^data:([^;]+);base64,/u.exec(dataUrl);
  return match ? match[1].toLowerCase() : '';
}

async function parseApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function createApiError(response, payload, apiLabel = '图片生成接口') {
  const apiMessage =
    typeof payload === 'object' && payload
      ? payload.error?.message || payload.message || JSON.stringify(payload)
      : String(payload || '');
  const readableMessage = normalizeAiApiErrorMessage(response.status, normalizeApiErrorMessage(apiMessage));
  const error = new Error(
    readableMessage
      ? `${apiLabel}返回 ${response.status}：${readableMessage}`
      : `${apiLabel}返回 ${response.status}`,
  );
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
  return text;
}

function extractText(payload) {
  const text = findTextInPayload(payload);
  if (!text) {
    throw new Error('生成规则接口未返回可识别的文本内容');
  }
  return text;
}

function findTextInPayload(value, depth = 0) {
  if (!value || depth > 6) return '';

  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => findTextInPayload(item, depth + 1))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (typeof value === 'object') {
    const messageContent = value.choices?.[0]?.message?.content;
    if (messageContent) {
      return findTextInPayload(messageContent, depth + 1);
    }

    const outputText = value.output_text || value.text || value.content;
    if (outputText) {
      return findTextInPayload(outputText, depth + 1);
    }

    if (value.type === 'text' && typeof value.text === 'string') {
      return value.text.trim();
    }

    if (value.type === 'output_text' && typeof value.text === 'string') {
      return value.text.trim();
    }

    const choiceText = value.choices?.[0]?.text;
    if (choiceText) {
      return String(choiceText).trim();
    }
  }

  return '';
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
    if (value.startsWith('data:image/')) {
      return value;
    }

    const dataUrlMatch = value.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/u);
    if (dataUrlMatch) {
      return dataUrlMatch[0];
    }

    const markdownUrlMatch = value.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/u);
    if (markdownUrlMatch) {
      return markdownUrlMatch[1];
    }

    const directUrlMatch = value.match(/https?:\/\/[^\s)"']+/u);
    if (directUrlMatch && looksLikeImageUrl(directUrlMatch[0])) {
      return directUrlMatch[0];
    }

    if (looksLikeBase64Image(value)) {
      return `data:image/png;base64,${value}`;
    }

    return null;
  }

  if (typeof value === 'object') {
    const directBase64 =
      value.b64_json ||
      value.base64 ||
      value.image_base64 ||
      value.data;
    if (typeof directBase64 === 'string' && looksLikeBase64Image(directBase64)) {
      const mimeType = value.mime_type || value.mimeType || 'image/png';
      return `data:${mimeType};base64,${directBase64}`;
    }

    const directUrl = value.url || value.image_url;
    if (typeof directUrl === 'string' && looksLikeImageUrl(directUrl)) {
      return directUrl;
    }

    if (value.image_url && typeof value.image_url === 'object') {
      const nestedUrl = value.image_url.url;
      if (typeof nestedUrl === 'string' && looksLikeImageUrl(nestedUrl)) {
        return nestedUrl;
      }
    }

    const values = Array.isArray(value) ? value : Object.values(value);
    for (const item of values) {
      const found = findImageInPayload(item, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function looksLikeBase64Image(value) {
  if (typeof value !== 'string' || value.length < 40) return false;
  if (!/^[A-Za-z0-9+/=_-]+$/u.test(value)) return false;

  try {
    const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
    return Boolean(sniffImageMimeType(Buffer.from(normalized.slice(0, 64), 'base64')));
  } catch {
    return false;
  }
}

function looksLikeImageUrl(value) {
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:image/')
  );
}

function isRetryableStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504, 524].includes(status);
}

function isRetryableFetchError(error) {
  return Boolean(error?.retryable) || error?.name === 'AbortError' || error instanceof TypeError;
}

function normalizeFetchError(error, endpoint) {
  if (error?.name === 'AbortError') {
    if (endpoint === '/chat/completions') {
      return new Error('生成规则确认超过本地等待上限，请减少知识库文件或稍后重试。');
    }

    return new Error(
      endpoint === '/images/edits'
        ? '参考图生成超过本地等待上限，请减少参考图数量或稍后重试。'
        : '图片生成超过本地等待上限，请稍后重试。',
    );
  }

  if (error instanceof Error) {
    if (endpoint === '/chat/completions' && error instanceof TypeError) {
      return new Error('生成规则接口连接失败，已自动重试仍未成功；请稍后再试或联系管理员检查规则接口 URL。');
    }
    return error;
  }

  return new Error(String(error || '图片生成接口请求失败'));
}

function delay(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('前端请求已取消，已停止继续生成图片'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abortDelay);
      resolve();
    }, ms);

    const abortDelay = () => {
      clearTimeout(timer);
      reject(new Error('前端请求已取消，已停止继续生成图片'));
    };
    signal?.addEventListener('abort', abortDelay, { once: true });
  });
}

function createRequestAbortController(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded && !controller.signal.aborted) {
      controller.abort();
    }
  };

  req.on('aborted', abort);
  res.on('close', abort);
  return controller;
}

function assertNotAborted(signal) {
  if (signal?.aborted) {
    throw new Error('前端请求已取消，已停止继续生成图片');
  }
}

function assertGenerationBatchActive(data) {
  assertNotAborted(data.abortSignal);
  if (isGenerationBatchCanceled(data.batchId)) {
    const error = new Error('生成任务已取消，未完成图片已退回积分');
    error.statusCode = 409;
    throw error;
  }
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

  const workerCount = Math.min(limit, items.length);
  const workerOutcomes = await Promise.allSettled(Array.from({ length: workerCount }, worker));
  const failedWorker = workerOutcomes.find((outcome) => outcome.status === 'rejected');
  if (failedWorker) throw failedWorker.reason;
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

async function serveStatic(req, res, requestUrl) {
  const pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname.startsWith('/vendor/pdfjs/')) {
    await servePdfJsAsset(req, res, pathname);
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/u, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { ok: false, message: '禁止访问该路径' });
    return;
  }

  const finalPath = existsSync(filePath) ? filePath : path.join(PUBLIC_DIR, 'index.html');
  const fileStat = await stat(finalPath);
  if (!fileStat.isFile()) {
    sendJson(res, 404, { ok: false, message: '资源不存在' });
    return;
  }

  const extension = path.extname(finalPath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES.get(extension) || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(finalPath).pipe(res);
}

async function servePdfJsAsset(req, res, pathname) {
  const assetName = pathname.split('/').pop();
  const allowedAssets = new Set(['pdf.mjs', 'pdf.worker.mjs']);
  if (!allowedAssets.has(assetName)) {
    sendJson(res, 404, { ok: false, message: '资源不存在' });
    return;
  }

  const filePath = path.resolve(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build', assetName);
  if (!filePath.startsWith(path.resolve(__dirname, 'node_modules', 'pdfjs-dist') + path.sep) || !existsSync(filePath)) {
    sendJson(res, 404, { ok: false, message: 'PDF 解析资源不存在' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('请求体过大，请减少知识库文件或参考风格图的总体积'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('请求体不是有效 JSON'));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = stripEnvQuotes(rawValue);
  }
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}

function safeFileName(value) {
  return value.replace(/[^\w.\-\u4e00-\u9fa5]/gu, '_').slice(0, 120) || 'reference.png';
}

function createReferenceUploadFileName(name, mimeType) {
  const extension = IMAGE_FILE_EXTENSIONS.get(mimeType) || 'png';
  const baseName = safeFileName(name).replace(/\.[^.]+$/u, '') || 'reference';
  return `${baseName}.${extension}`;
}

function normalizeApiErrorMessage(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 260);
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/u, '');
}

function toPort(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampInteger(value, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function formatErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message || '生成失败';
}

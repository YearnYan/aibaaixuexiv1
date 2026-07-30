import worker from '../src/worker.js';

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const DATA_URL_PNG = `data:image/png;base64,${ONE_PIXEL_PNG}`;
const WORD_DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const smokeWatchdog = setTimeout(() => {
  console.error('Worker smoke tests exceeded the 55-second safety limit.');
  process.exit(1);
}, 55_000);
smokeWatchdog.unref();

globalThis.fetch = async (url) => {
  throw new Error(`Smoke test attempted an unmocked network request: ${String(url)}`);
};

class MemoryKv {
  constructor(seed = {}) {
    this.map = new Map(Object.entries(seed));
    this.meta = new Map();
  }

  async get(key, type = 'text') {
    const value = this.map.get(key);
    if (value === undefined) return null;
    if (type === 'arrayBuffer') return value instanceof Uint8Array ? value.buffer : value;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  async getWithMetadata(key, type = 'text') {
    return {
      value: await this.get(key, type),
      metadata: this.meta.get(key) || null,
    };
  }

  async put(key, value, options = {}) {
    this.map.set(key, value);
    if (options.metadata) this.meta.set(key, options.metadata);
  }
}

function createEnv({ points = 3, ruleConfigured = true } = {}) {
  const appState = {
    version: 1,
    users: [
      {
        id: 'user-1',
        username: 'test@example.com',
        passwordHash: 'x',
        salt: 'x',
        role: 'user',
        points,
        createdAt: new Date().toISOString(),
      },
    ],
    sessions: [
      {
        token: 'session-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    ],
    redeemCodes: [],
    pointLogs: [],
    generationBatches: [],
  };
  const aiConfig = {
    version: 1,
    rule: {
      entries: ruleConfigured
        ? [{ baseUrl: 'https://mock.local/v1', model: 'mock-text', apiKeys: ['key'] }]
        : [],
    },
    image: {
      resolution: '4k',
      entries: [{ baseUrl: 'https://mock.local/v1', model: 'mock-image', apiKeys: ['key'] }],
    },
  };
  const kv = new MemoryKv({
    'app-state': JSON.stringify(appState),
    'ai-config': JSON.stringify(aiConfig),
  });
  return {
    kv,
    env: {
      TLSJF_KV: kv,
      ASSETS: {
        fetch: async () => new Response('asset'),
      },
    },
  };
}

function createBlankEnv() {
  const kv = new MemoryKv({
    'app-state': JSON.stringify({
      version: 1,
      users: [],
      sessions: [],
      redeemCodes: [],
      pointLogs: [],
      generationBatches: [],
    }),
    'ai-config': JSON.stringify({
      version: 1,
      rule: { entries: [] },
      image: { resolution: '4k', entries: [] },
    }),
  });
  return {
    kv,
    env: {
      TLSJF_KV: kv,
      ASSETS: {
        fetch: async () => new Response('asset'),
      },
    },
  };
}

function createGenerateRequest(payload) {
  return new Request('https://example.com/api/generate/stream', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'k12_session=session-1',
    },
    body: JSON.stringify(payload),
  });
}

function createJsonRequest(pathname, body, cookie = '') {
  return new Request(`https://example.com${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function createPutJsonRequest(pathname, body, cookie = '') {
  return new Request(`https://example.com${pathname}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function createGetRequest(pathname, cookie = '') {
  return new Request(`https://example.com${pathname}`, {
    method: 'GET',
    headers: cookie ? { cookie } : {},
  });
}

function getCookieHeader(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

async function readJson(response) {
  return response.json();
}

async function readStreamEvents(response) {
  const text = await response.text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const streamReaderStates = new WeakMap();

async function readNextStreamEvent(reader) {
  let state = streamReaderStates.get(reader);
  if (!state) {
    state = { decoder: new TextDecoder(), buffer: '' };
    streamReaderStates.set(reader, state);
  }

  while (true) {
    const separatorIndex = state.buffer.indexOf('\n');
    if (separatorIndex !== -1) {
      const line = state.buffer.slice(0, separatorIndex);
      state.buffer = state.buffer.slice(separatorIndex + 1);
      if (!line.trim()) continue;
      return JSON.parse(line);
    }

    const { value, done } = await reader.read();
    if (done) {
      const trailing = state.buffer.trim();
      state.buffer = '';
      return trailing ? JSON.parse(trailing) : null;
    }
    state.buffer += state.decoder.decode(value, { stream: true });
  }
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createBasePayload(overrides = {}) {
  return {
    prompt: 'Create one teaching aid image',
    count: 1,
    aspectRatio: '3:4',
    options: { layoutFixed: false },
    styleReferenceImages: [],
    knowledgeFiles: [],
    batchItems: ['Page one: smoke test'],
    ...overrides,
  };
}

function getSavedImageCount(kv) {
  return [...kv.map.keys()].filter((key) => key.startsWith('generated:/')).length;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getDoneSummary(events) {
  return events.find((event) => event.type === 'done')?.summary || null;
}

function getResultEvents(events) {
  return events
    .filter((event) => event.type === 'result')
    .map((event) => event.result)
    .sort((a, b) => Number(a?.index) - Number(b?.index));
}

async function getStoredState(kv) {
  return JSON.parse(await kv.get('app-state'));
}

function createTextKnowledgeFile(name, text, mimeType = 'text/plain') {
  return {
    name,
    mimeType,
    size: Buffer.byteLength(text, 'utf8'),
    dataUrl: `data:${mimeType};base64,${Buffer.from(text, 'utf8').toString('base64')}`,
  };
}

function createNumberedSceneTemplateText(count = 50) {
  const lines = [
    '小学一年级数学生图场景与提示词模板',
    `${count} 个场景与提示词模板`,
  ];
  for (let index = 1; index <= count; index += 1) {
    const number = String(index).padStart(3, '0');
    lines.push(
      `${number}. 场景 ${number} 数学教具图`,
      '教材锚点：小学一年级数学。',
      `场景：第 ${number} 个独立课堂出图任务。`,
      `提示词模板：生成一张“场景 ${number}”教学图，必须包含场景编号 ${number} 和独立数学任务。`,
    );
  }
  return lines.join('\n');
}

function createNumberedSceneAnchors(count = 50) {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, '0');
    return {
      title: `场景 ${number} 数学教具图`,
      content: `场景 ${number} 是独立课堂出图任务，必须围绕编号 ${number} 的一年级数学教学图生成。`,
      mustInclude: [`场景 ${number}`, `编号 ${number}`],
      source: '测试.pdf-可读文本摘录.txt',
      confidence: 'high',
    };
  });
}

async function runGenerationRuleKnowledgeEvidenceSmoke() {
  const uniqueKnowledge = '唯一知识点：十位和个位，先读十位，再读个位。';
  let ruleRequestBody = '';
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/chat/completions')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    ruleRequestBody = String(options.body || '');
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                recommendedCount: 1,
                intentAnalysis: '围绕数位读写生成一张练习图。',
                countReason: '知识库只有一个核心知识簇，生成一张即可。',
                countStrategy: '按内容簇而不是页数决策。',
                summary: '生成数位读写练习图。',
                contentLogic: '数的组成 > 十位和个位 > 读写训练。',
                contentProductionStrategy: '保留知识库中的数位顺序和训练重点。',
                layoutLogic: '单页练习卡。',
                styleLogic: '清晰可读。',
                styleAdvice: '适合数学练习卡。',
                contentInventory: ['数学 > 数的认识 > 十位和个位'],
                contentUnits: ['数学 > 数的认识 > 十位和个位读写'],
                contentHierarchy: ['数的认识 > 十位和个位 | 生成'],
                coverageMap: ['十位和个位 -> 第1张 -> 练习卡'],
                coverageChecklist: ['覆盖十位和个位读写'],
                coverageAudit: ['十位和个位 -> 已进入第1张'],
                riskNotes: [],
                pages: [
                  {
                    title: '十位和个位读写',
                    focus: '先读十位，再读个位',
                    sourceLogic: '来自唯一知识库文本',
                    mustInclude: ['十位', '个位'],
                    avoid: ['加减法'],
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const { env } = createEnv();
  const response = await worker.fetch(
    createJsonRequest('/api/generation-rule', {
      prompt: '图',
      count: 1,
      aspectRatio: '3:4',
      options: { layoutFixed: false },
      styleReferenceImages: [],
      knowledgeFiles: [
        createTextKnowledgeFile('math-knowledge.txt', uniqueKnowledge),
      ],
    }, 'k12_session=session-1'),
    env,
    { waitUntil: () => {} },
  );
  const payload = await readJson(response);

  assert(response.status === 200, 'Knowledge evidence rule smoke should be HTTP 200.');
  assert(payload.ok === true, 'Knowledge evidence rule smoke should return ok.');
  assert(ruleRequestBody.includes(uniqueKnowledge), 'Rule prompt must include extracted knowledge text.');
  assert(ruleRequestBody.includes('知识库文本摘录'), 'Rule prompt must label knowledge excerpts.');
  assert(payload.rule?.evidence?.totalTextChars >= uniqueKnowledge.length, 'Rule evidence should count extracted text.');

  const emptyPromptResponse = await worker.fetch(
    createJsonRequest('/api/generation-rule', {
      prompt: '   ',
      count: 1,
      aspectRatio: '3:4',
      options: { layoutFixed: false },
      styleReferenceImages: [],
      knowledgeFiles: [],
    }, 'k12_session=session-1'),
    env,
    { waitUntil: () => {} },
  );
  const emptyPromptPayload = await readJson(emptyPromptResponse);

  assert(emptyPromptResponse.status === 400, 'Whitespace-only prompt should be rejected.');
  assert(emptyPromptPayload.message === '请填写提示词', 'Empty prompt should return the fill-prompt reminder.');
}

async function runKnowledgeExtractionFailureSmoke() {
  const requestBodies = [];
  const mockAiContent = {
    intent: '根据现有提示词生成一张教辅图片。',
    sourceSummaries: ['损坏的 Word 文件无法读取，规则规划应继续执行。'],
    anchors: [],
    uncertaintyNotes: ['知识库文件损坏，无法提取正文。'],
    recommendedCount: 1,
    countReason: '当前只有一个生成任务。',
    countStrategy: '按用户提示词规划一张图片。',
    summary: '生成一张教辅图片。',
    contentLogic: '使用可用提示词继续规划。',
    contentProductionStrategy: '不使用无法读取的知识库正文。',
    layoutLogic: '单页布局。',
    styleLogic: '清晰可读。',
    styleAdvice: '保持教学信息明确。',
    contentInventory: ['用户提示词中的单一任务'],
    contentUnits: ['单一教辅图片任务'],
    contentHierarchy: ['教辅图片任务 | 生成'],
    coverageMap: ['教辅图片任务 -> 第1张'],
    coverageChecklist: ['覆盖用户提示词'],
    coverageAudit: ['用户提示词 -> 已进入第1张'],
    riskNotes: ['知识库文件无法读取。'],
    pages: [
      {
        title: '教辅图片',
        focus: '根据用户提示词生成内容',
        sourceLogic: '知识库损坏时使用现有提示词',
        mustInclude: [],
        avoid: ['编造损坏文件中的内容'],
      },
    ],
  };

  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/chat/completions')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    requestBodies.push(String(options.body || ''));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockAiContent) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const { env } = createEnv();
  const response = await worker.fetch(
    createJsonRequest('/api/generation-rule', {
      prompt: '根据可用内容生成一张教辅图片',
      count: 1,
      aspectRatio: '3:4',
      options: { layoutFixed: false },
      styleReferenceImages: [],
      knowledgeFiles: [
        createTextKnowledgeFile('broken.docx', 'not-a-valid-docx', WORD_DOCX_MIME_TYPE),
      ],
    }, 'k12_session=session-1'),
    env,
    { waitUntil: () => {} },
  );
  const payload = await readJson(response);
  const combinedRequests = requestBodies.join('\n');

  assert(response.status === 200, 'Broken knowledge file should not abort generation-rule planning.');
  assert(payload.ok === true, 'Broken knowledge file should still return a generation rule.');
  assert(combinedRequests.includes('broken.docx'), 'Rule prompt should retain the failed knowledge filename.');
  assert(combinedRequests.includes('知识库读取备注'), 'Rule prompt should explain the knowledge extraction failure.');
  assert(!combinedRequests.includes('formatKnowledgeExtractionError is not defined'), 'Rule prompt must not contain a formatter ReferenceError.');
}

async function runGenerationRulePdfImageEvidenceSmoke() {
  let ruleRequestPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/chat/completions')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    ruleRequestPayload = JSON.parse(String(options.body || '{}'));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                recommendedCount: 1,
                intentAnalysis: '读取 PDF 页面截图中的数学题目，生成一张数认识读写练习图。',
                countReason: '依据一个核心练习任务决定一张，不依据 PDF 页数或截图数量。',
                countStrategy: 'PDF 截图只作内容证据，数量由题型组和可读性决定。',
                summary: '生成数认识读写练习卡。',
                contentLogic: '数学 > 数的认识 > 读写练习。',
                contentProductionStrategy: '把截图中可见题型转写为可执行练习卡内容。',
                layoutLogic: '单张练习卡。',
                styleLogic: '清晰可读。',
                styleAdvice: '题组卡。',
                contentInventory: ['数学 > 数的认识 > 读数写数'],
                contentUnits: ['数学 > 数的认识 > 读数写数练习'],
                contentHierarchy: ['数的认识 > 读数写数 | 生成'],
                coverageMap: ['读数写数 -> 第1张 -> 练习卡'],
                coverageChecklist: ['覆盖 PDF 截图里的读数写数任务'],
                coverageAudit: ['PDF 截图可见题型 -> 已进入第1张'],
                riskNotes: [],
                pages: [
                  {
                    title: '数认识读写练习',
                    focus: '根据 PDF 截图中的读数写数题型生成练习',
                    sourceLogic: '来自 PDF 第1页内容截图，页码只作证据定位',
                    mustInclude: ['读数', '写数'],
                    avoid: ['脱离截图编造新知识点'],
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const { env } = createEnv();
  const response = await worker.fetch(
    createJsonRequest('/api/generation-rule', {
      prompt: '根据知识库生成数学练习图',
      count: '',
      aspectRatio: '3:4',
      options: { layoutFixed: false },
      styleReferenceImages: [],
      knowledgeFiles: [
        {
          name: '数学练习题-数认识读写.pdf-第1页内容截图.jpg',
          mimeType: 'image/jpeg',
          size: 68,
          dataUrl: DATA_URL_PNG.replace('image/png', 'image/jpeg'),
        },
      ],
    }, 'k12_session=session-1'),
    env,
    { waitUntil: () => {} },
  );
  const payload = await readJson(response);
  const userContent = ruleRequestPayload?.messages?.[1]?.content || [];
  const imageItems = userContent.filter((item) => item?.type === 'image_url');
  const textContent = JSON.stringify(userContent);

  assert(response.status === 200, 'PDF image evidence rule smoke should be HTTP 200.');
  assert(payload.ok === true, 'PDF image evidence rule smoke should return ok.');
  assert(imageItems.length === 1, 'PDF page image evidence should be sent to the rule model as image_url content.');
  assert(textContent.includes('PDF 第 1 页内容截图'), 'Rule prompt should label PDF page screenshots as content evidence.');
  assert(textContent.includes('规则确认阶段必须先从这些视觉证据中提取可见标题'), 'Rule prompt should require visual evidence transcription.');
  assert(payload.rule?.evidence?.pdfPageImageCount === 1, 'Rule evidence should count PDF page screenshots separately.');
  assert(payload.rule?.evidence?.knowledgeImageCount === 0, 'PDF page screenshots should not be counted as ordinary knowledge images.');
}

async function runKnowledgeBlueprintGroundingSmoke() {
  const uniqueKnowledge = '百以内数的读写：先看十位，再看个位；58 读作五十八。';
  const unrelatedKnowledge = '认识钟表：分针指向12，时针指向7，表示7时。';
  let imagePrompt = '';
  let blueprintCalls = 0;
  let ruleCalls = 0;

  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (textUrl.endsWith('/chat/completions')) {
      const body = JSON.parse(String(options.body || '{}'));
      const systemPrompt = String(body.messages?.[0]?.content || '');
      if (systemPrompt.includes('知识库内容抽取员')) {
        blueprintCalls += 1;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intent: '根据知识库生成数认识读写练习图。',
                    sourceSummaries: ['math-knowledge.txt 中包含百以内数读写方法。'],
                    anchors: [
                      {
                        title: '百以内数的读写',
                        content: uniqueKnowledge,
                        mustInclude: ['十位', '个位', '58', '五十八'],
                        source: 'math-knowledge.txt',
                        confidence: 'high',
                      },
                      {
                        title: '认识钟表整时',
                        content: unrelatedKnowledge,
                        mustInclude: ['分针', '12', '时针', '7时'],
                        source: 'math-knowledge.txt',
                        confidence: 'high',
                      },
                    ],
                    uncertaintyNotes: [],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      ruleCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  recommendedCount: 1,
                  intentAnalysis: '根据知识库生成一张图。',
                  countReason: '一张即可。',
                  countStrategy: '按内容规划。',
                  summary: '生成知识库练习图。',
                  contentLogic: '泛泛整理知识库内容。',
                  contentProductionStrategy: '按知识库生成。',
                  layoutLogic: '单页。',
                  styleLogic: '清晰。',
                  styleAdvice: '练习卡。',
                  contentInventory: ['第1张：百以内数的读写', `第2张不应混入当前页：${unrelatedKnowledge}`],
                  contentUnits: ['核心内容单元', `非当前页单元：${unrelatedKnowledge}`],
                  contentHierarchy: ['核心内容单元 | 生成', `非当前页层级 | ${unrelatedKnowledge}`],
                  coverageMap: ['核心内容 -> 第1张', `钟表整时 -> 第2张：${unrelatedKnowledge}`],
                  coverageChecklist: ['覆盖核心内容'],
                  coverageAudit: ['核心内容 -> 已进入第1张', `非当前页审计：${unrelatedKnowledge}`],
                  riskNotes: [],
                  pages: [
                    {
                      title: '知识库练习图',
                      focus: '整理知识库中的第 1 个核心内容单元',
                      sourceLogic: '根据知识库内容生成',
                      mustInclude: [],
                      avoid: [],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (textUrl.endsWith('/images/generations')) {
      const body = JSON.parse(String(options.body || '{}'));
      imagePrompt = body.prompt || '';
      return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected mock fetch: ${textUrl}`);
  };

  const { env, kv } = createEnv({ points: 2 });
  const ruleResponse = await worker.fetch(
    createJsonRequest('/api/generation-rule', {
      prompt: '根据知识库生成数学练习图',
      count: '',
      aspectRatio: '3:4',
      options: { layoutFixed: false },
      styleReferenceImages: [],
      knowledgeFiles: [
        createTextKnowledgeFile('math-knowledge.txt', `资料片段1：${uniqueKnowledge}\n资料片段2：${unrelatedKnowledge}`),
      ],
    }, 'k12_session=session-1'),
    env,
    { waitUntil: () => {} },
  );
  const rulePayload = await readJson(ruleResponse);

  assert(ruleResponse.status === 200, 'Knowledge blueprint rule smoke should be HTTP 200.');
  assert(rulePayload.ok === true, 'Knowledge blueprint rule smoke should return ok.');
  assert(blueprintCalls === 1, 'Knowledge blueprint rule smoke should call the blueprint extractor once.');
  assert(ruleCalls === 1, 'Knowledge blueprint rule smoke should call the rule planner once.');
  assert(rulePayload.rule?.knowledgeBlueprint?.anchors?.[0]?.content?.includes(uniqueKnowledge), 'Rule payload should keep the extracted knowledge blueprint anchor.');
  assert(rulePayload.rule?.pages?.[0]?.knowledgeAnchor?.content?.includes(uniqueKnowledge), 'Rule page should be grounded to the knowledge blueprint anchor.');

  const generateResponse = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        prompt: '根据知识库生成数学练习图',
        count: rulePayload.count,
        targetIndex: 0,
        batchItems: rulePayload.batchItems,
        generationRule: rulePayload.rule,
        knowledgeFiles: [
          createTextKnowledgeFile('math-knowledge.txt', `资料片段1：${uniqueKnowledge}\n资料片段2：${unrelatedKnowledge}`),
        ],
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const events = await readStreamEvents(generateResponse);
  const result = getResultEvents(events)[0];

  assert(generateResponse.status === 200, 'Knowledge blueprint generation smoke should be HTTP 200.');
  assert(result?.status === 'ok', 'Knowledge blueprint generation smoke should generate one image.');
  assert(imagePrompt.includes('本张知识库蓝图锚点'), 'Final image prompt should include the current-page knowledge blueprint anchor section.');
  assert(imagePrompt.includes(uniqueKnowledge), 'Final image prompt must include the concrete knowledge anchor content.');
  assert(imagePrompt.includes('58') && imagePrompt.includes('五十八'), 'Final image prompt must include anchor must-include terms.');
  assert(!imagePrompt.includes(unrelatedKnowledge), 'Final image prompt must not include non-current-page knowledge content.');
  assert(!imagePrompt.includes('7时'), 'Final image prompt must not leak non-current-page must-include terms.');
  assert(getSavedImageCount(kv) === 1, 'Knowledge blueprint generation smoke should save one image.');

  imagePrompt = '';
  const staleRuleWithoutBlueprint = {
    ...rulePayload.rule,
    knowledgeBlueprint: undefined,
    pages: rulePayload.rule.pages.map((page) => ({
      ...page,
      focus: '整理知识库中的第 1 个核心内容单元',
      mustInclude: [],
      knowledgeAnchorIndex: undefined,
      knowledgeAnchor: undefined,
    })),
    batchItems: ['整理知识库中的第 1 个核心内容单元'],
  };
  const staleGenerateResponse = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        prompt: '根据知识库生成数学练习图',
        count: rulePayload.count,
        targetIndex: 0,
        batchItems: staleRuleWithoutBlueprint.batchItems,
        generationRule: staleRuleWithoutBlueprint,
        knowledgeFiles: [
          createTextKnowledgeFile('math-knowledge.txt', `资料片段1：${uniqueKnowledge}\n资料片段2：${unrelatedKnowledge}`),
        ],
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const staleEvents = await readStreamEvents(staleGenerateResponse);
  const staleResult = getResultEvents(staleEvents)[0];

  assert(staleGenerateResponse.status === 200, 'Stale rule grounding smoke should be HTTP 200.');
  assert(staleResult?.status === 'ok', 'Stale rule grounding smoke should still generate one image.');
  assert(blueprintCalls === 2, 'Stale rule grounding smoke should rebuild the missing knowledge blueprint once.');
  assert(ruleCalls === 1, 'Stale rule grounding smoke should not rerun the whole rule planner.');
  assert(imagePrompt.includes('本张知识库蓝图锚点'), 'Stale rule final prompt should restore the current-page knowledge blueprint anchor.');
  assert(imagePrompt.includes(uniqueKnowledge), 'Stale rule final prompt must restore concrete knowledge content.');
  assert(imagePrompt.includes('58') && imagePrompt.includes('五十八'), 'Stale rule final prompt must restore anchor must-include terms.');
  assert(!imagePrompt.includes(unrelatedKnowledge), 'Stale rule final prompt must not leak non-current-page knowledge content.');
  assert(!imagePrompt.includes('7时'), 'Stale rule final prompt must not leak non-current-page must-include terms.');
  assert(getSavedImageCount(kv) === 2, 'Stale rule grounding smoke should save a second image.');
}

async function runVerbatimKnowledgeContentPreservationSmoke() {
  const lockedText = '原题：小明有3支铅笔，又买来2支。问：现在共有几支？答案：3+2=5（支）。';
  const preservationPrompts = [
    '只调整视觉排版，不要修改知识库文件里的内容（文字内容）。',
    '只更换样式，资料里的内容不改变。',
    '保持资料里的内容不变，原文一字不改。',
  ];
  let blueprintCalls = 0;
  let ruleCalls = 0;
  let imagePrompt = '';
  const rulePrompts = [];

  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (textUrl.endsWith('/chat/completions')) {
      const body = JSON.parse(String(options.body || '{}'));
      const systemPrompt = String(body.messages?.[0]?.content || '');
      if (systemPrompt.includes('知识库内容抽取员')) {
        blueprintCalls += 1;
        throw new Error('Text preservation mode must not ask a model to rewrite extractable source text.');
      }

      ruleCalls += 1;
      rulePrompts.push(JSON.stringify(body.messages?.[1]?.content || ''));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  recommendedCount: 1,
                  intentAnalysis: '把原资料润色成更简洁的练习。',
                  countReason: '一张即可。',
                  countStrategy: '压缩内容后放入一张。',
                  summary: '改写原题。',
                  contentLogic: '纠正原文并重写答案。',
                  contentProductionStrategy: '删减并润色文字。',
                  layoutLogic: '单页排版。',
                  styleLogic: '清晰。',
                  styleAdvice: '练习卡。',
                  contentInventory: ['原题'],
                  contentUnits: ['原题'],
                  contentHierarchy: ['原题 | 生成'],
                  coverageMap: ['原题 -> 第1张'],
                  coverageChecklist: ['覆盖原题'],
                  coverageAudit: ['原题 -> 第1张'],
                  riskNotes: [],
                  pages: [
                    {
                      title: '润色后的应用题',
                      focus: '把3支改成三支，并简化答案。',
                      sourceLogic: '根据知识库改写',
                      mustInclude: ['三支'],
                      avoid: [],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (textUrl.endsWith('/images/generations')) {
      const body = JSON.parse(String(options.body || '{}'));
      imagePrompt = body.prompt || '';
      return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected mock fetch: ${textUrl}`);
  };

  const { env, kv } = createEnv({ points: 2 });
  let rulePayload = null;
  for (const prompt of preservationPrompts) {
    const response = await worker.fetch(
      createJsonRequest('/api/generation-rule', {
        prompt,
        count: 1,
        aspectRatio: '3:4',
        options: { layoutFixed: false },
        styleReferenceImages: [],
        knowledgeFiles: [createTextKnowledgeFile('locked-content.txt', lockedText)],
      }, 'k12_session=session-1'),
      env,
      { waitUntil: () => {} },
    );
    rulePayload = await readJson(response);

    assert(response.status === 200, 'Verbatim preservation rule smoke should be HTTP 200.');
    assert(rulePayload.ok === true, 'Verbatim preservation rule smoke should return ok.');
    assert(rulePayload.rule?.knowledgeBlueprint?.anchors?.[0]?.content === lockedText, 'Verbatim blueprint must keep source text exactly.');
    assert(rulePayload.rule?.pages?.[0]?.focus === lockedText, 'Opposing planner rewrite must be replaced by the locked source text.');
    assert(rulePayload.rule?.contentProductionStrategy?.includes('逐字照录'), 'Normalized rule must enforce verbatim production.');
  }

  assert(blueprintCalls === 0, 'Extractable text in preservation mode must bypass model-based blueprint rewriting.');
  assert(ruleCalls === preservationPrompts.length, 'Each preservation phrase should reach the rule planner once.');
  assert(rulePrompts.every((prompt) => prompt.includes('原文保真模式（最高优先级）')), 'All preservation phrases must activate the highest-priority rule lock.');
  assert(rulePrompts.every((prompt) => !prompt.includes('如何改写成可读图卡')), 'Preservation rule prompts must not retain positive rewrite instructions.');

  const generateResponse = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        prompt: preservationPrompts.at(-1),
        count: rulePayload.count,
        targetIndex: 0,
        batchItems: rulePayload.batchItems,
        generationRule: rulePayload.rule,
        knowledgeFiles: [],
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const events = await readStreamEvents(generateResponse);
  const result = getResultEvents(events)[0];

  assert(generateResponse.status === 200, 'Verbatim preservation generation smoke should be HTTP 200.');
  assert(result?.status === 'ok', 'Verbatim preservation generation smoke should generate one image.');
  assert(imagePrompt.includes('知识库原文逐字保真锁'), 'Final image prompt must contain the highest-priority verbatim lock.');
  assert(imagePrompt.includes(`<<<原文开始>>>\n${lockedText}\n<<<原文结束>>>`), 'Final image prompt must delimit and include the exact locked text.');
  assert(!imagePrompt.includes('把3支改成三支'), 'Final image prompt must discard the planner rewrite instruction.');
  assert(!imagePrompt.includes('删减并润色文字'), 'Final image prompt must discard the planner content rewrite strategy.');
  assert(getSavedImageCount(kv) === 1, 'Verbatim preservation generation smoke should save one image.');
}

async function runNumberedSceneCountFloorSmoke() {
  const sceneText = createNumberedSceneTemplateText(50);
  const sceneAnchors = createNumberedSceneAnchors(50);
  let blueprintCalls = 0;
  let ruleCalls = 0;
  let imagePrompt = '';

  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (textUrl.endsWith('/chat/completions')) {
      const body = JSON.parse(String(options.body || '{}'));
      const systemPrompt = String(body.messages?.[0]?.content || '');
      if (systemPrompt.includes('知识库内容抽取员')) {
        blueprintCalls += 1;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intent: '根据测试 PDF 中的 50 个一年级数学场景生成完整教具图。',
                    sourceSummaries: ['测试.pdf-可读文本摘录.txt 包含 50 个独立场景与提示词模板。'],
                    anchors: sceneAnchors,
                    uncertaintyNotes: [],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      ruleCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  recommendedCount: 7,
                  intentAnalysis: '错误地把 PDF 页数当成了生成数量。',
                  countReason: '按 7 页 PDF 规划 7 张。',
                  countStrategy: '错误页数策略。',
                  summary: '需要生成一年级数学场景图。',
                  contentLogic: '应按场景模板拆分。',
                  contentProductionStrategy: '每张图围绕一个场景生成。',
                  layoutLogic: '统一教具图样式。',
                  styleLogic: '清晰低龄。',
                  styleAdvice: '一年级数学教具卡。',
                  contentInventory: sceneAnchors.slice(0, 7).map((anchor) => anchor.title),
                  contentUnits: sceneAnchors.slice(0, 7).map((anchor) => anchor.title),
                  contentHierarchy: sceneAnchors.slice(0, 7).map((anchor) => `${anchor.title} | 生成`),
                  coverageMap: ['错误覆盖：只覆盖 7 个场景'],
                  coverageChecklist: ['不得遗漏 50 个场景'],
                  coverageAudit: ['错误审计：被页数误导'],
                  riskNotes: ['模型可能按 PDF 页数误判数量'],
                  pages: sceneAnchors.slice(0, 7).map((anchor, index) => ({
                    title: `PDF 第 ${index + 1} 页规划`,
                    focus: '整理知识库中的核心内容单元',
                    sourceLogic: '错误地按 PDF 页数规划',
                    mustInclude: [anchor.title],
                    avoid: [],
                  })),
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (textUrl.endsWith('/images/generations')) {
      const body = JSON.parse(String(options.body || '{}'));
      imagePrompt = body.prompt || '';
      return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected mock fetch: ${textUrl}`);
  };

  const { env, kv } = createEnv({ points: 1 });
  const knowledgeFiles = [createTextKnowledgeFile('测试.pdf-可读文本摘录.txt', sceneText)];
  const ruleResponse = await worker.fetch(
    createJsonRequest('/api/generation-rule', {
      prompt: '根据知识库生成完整一年级数学场景图',
      count: '',
      aspectRatio: '3:4',
      options: { layoutFixed: false },
      styleReferenceImages: [],
      knowledgeFiles,
    }, 'k12_session=session-1'),
    env,
    { waitUntil: () => {} },
  );
  const rulePayload = await readJson(ruleResponse);

  assert(ruleResponse.status === 200, 'Numbered scene rule smoke should be HTTP 200.');
  assert(rulePayload.ok === true, 'Numbered scene rule smoke should return ok.');
  assert(blueprintCalls === 1, 'Numbered scene rule smoke should extract one blueprint.');
  assert(ruleCalls === 1, 'Numbered scene rule smoke should call the rule planner once.');
  assert(rulePayload.count === 50, 'Rule count must be raised from the wrong page count to all 50 content anchors.');
  assert(rulePayload.batchItems.length === 50, 'Rule batch items must cover all 50 scene anchors.');
  assert(rulePayload.rule?.pages?.length === 50, 'Rule pages must cover all 50 scene anchors.');
  assert(rulePayload.rule?.pages?.[0]?.knowledgeAnchor?.title?.includes('场景 001'), 'First page should ground to scene 001.');
  assert(rulePayload.rule?.pages?.[49]?.knowledgeAnchor?.title?.includes('场景 050'), 'Last page should ground to scene 050.');

  const generateResponse = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        prompt: '根据知识库生成完整一年级数学场景图',
        count: rulePayload.count,
        targetIndex: 49,
        batchItems: rulePayload.batchItems,
        generationRule: rulePayload.rule,
        knowledgeFiles,
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const events = await readStreamEvents(generateResponse);
  const result = getResultEvents(events)[0];

  assert(generateResponse.status === 200, 'Numbered scene target generation should be HTTP 200.');
  assert(result?.status === 'ok', 'Numbered scene target generation should succeed.');
  assert(imagePrompt.includes('场景 050'), 'Target prompt must include the current scene 050 anchor.');
  assert(imagePrompt.includes('编号 050'), 'Target prompt must include scene 050 must-include terms.');
  assert(!imagePrompt.includes('场景 001'), 'Target prompt must not leak scene 001 into scene 050 generation.');
  assert(getSavedImageCount(kv) === 1, 'Numbered scene target generation should save one image.');
}

async function runKnowledgeImageDoesNotBecomeStyleSmoke() {
  const calls = [];
  let imagePrompt = '';
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    calls.push({ url: textUrl, body: options.body ? String(options.body) : '' });
    if (textUrl.endsWith('/chat/completions')) {
      throw new Error('Knowledge-only image smoke must not analyze knowledge images as style references.');
    }
    if (textUrl.endsWith('/images/edits')) {
      throw new Error('Knowledge-only image smoke must not send knowledge images to /images/edits.');
    }
    if (textUrl.endsWith('/images/generations')) {
      const body = JSON.parse(options.body);
      imagePrompt = body.prompt || '';
      return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected mock fetch: ${textUrl}`);
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        knowledgeFiles: [
          {
            name: 'worksheet-page.png',
            mimeType: 'image/png',
            size: 68,
            dataUrl: DATA_URL_PNG,
          },
        ],
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];

  assert(response.status === 200, 'Knowledge image style isolation smoke response should be HTTP 200.');
  assert(result?.status === 'ok', 'Knowledge image style isolation smoke result should be ok.');
  assert(calls.every((call) => !call.url.endsWith('/chat/completions')), 'Knowledge images should not trigger style analysis.');
  assert(calls.every((call) => !call.url.endsWith('/images/edits')), 'Knowledge images should not be sent as edit references.');
  assert(calls.some((call) => call.url.endsWith('/images/generations')), 'Knowledge image smoke should use normal image generation.');
  assert(imagePrompt.includes('当前单张图片内容硬锚点'), 'Image prompt should include the current-page hard anchor.');
  assert(imagePrompt.includes('知识库图片'), 'Image prompt should still describe knowledge images as content evidence.');
  assert(getSavedImageCount(kv) === 1, 'Knowledge image style isolation smoke should save one image.');
}

async function runReferenceStyleSmoke() {
  const calls = [];
  let imageInFlight = 0;
  let maxImageInFlight = 0;
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    calls.push({ url: textUrl, body: options.body ? String(options.body) : '' });
    if (textUrl.endsWith('/chat/completions')) throw new Error('Formal image generation must not rerun reference style analysis.');
    if (textUrl.endsWith('/images/generations')) {
      imageInFlight += 1;
      maxImageInFlight = Math.max(maxImageInFlight, imageInFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      imageInFlight -= 1;
      return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (textUrl.endsWith('/images/edits')) {
      throw new Error('The reference-image smoke path must not call /images/edits.');
    }
    throw new Error(`Unexpected mock fetch: ${textUrl}`);
  };

  const { env, kv } = createEnv();
  const response = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        count: 2,
        batchItems: ['Page one follows reference style', 'Page two follows reference style'],
        generationRule: {
          layoutLogic: 'Large top title, rounded content panels, and generous spacing.',
          styleLogic: 'Fresh green teaching-aid layout with a pale background.',
          styleAdvice: 'Keep the hierarchy compact and readable.',
          pages: [
            { title: 'Page one', focus: 'Page one follows reference style' },
            { title: 'Page two', focus: 'Page two follows reference style' },
          ],
          batchItems: ['Page one follows reference style', 'Page two follows reference style'],
        },
        styleReferenceImages: [
          {
            name: 'reference.png',
            mimeType: 'image/png',
            dataUrl: DATA_URL_PNG,
          },
        ],
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const events = await readStreamEvents(response);
  const results = getResultEvents(events);
  const storedState = JSON.parse(await kv.get('app-state'));
  const imagePrompts = calls
    .filter((call) => call.url.endsWith('/images/generations'))
    .map((call) => JSON.parse(call.body).prompt);

  assert(response.status === 200, 'Reference smoke response should be HTTP 200.');
  assert(!calls.some((call) => call.url.endsWith('/chat/completions')), 'Formal generation should reuse the confirmed style rule without another model call.');
  assert(calls.some((call) => call.url.endsWith('/images/generations')), 'Reference smoke should generate an image.');
  assert(!calls.some((call) => call.url.endsWith('/images/edits')), 'Reference smoke should avoid /images/edits.');
  assert(imagePrompts.every((prompt) => prompt.includes('Fresh green teaching-aid layout')), 'Reference image prompts should reuse the confirmed style description.');
  assert(results.length === 2 && results.every((result) => result.status === 'ok'), 'Reference smoke results should be ok.');
  assert(maxImageInFlight === 2, 'Normal image generation must keep the configured concurrency window at two.');
  assert(getSavedImageCount(kv) === 2, 'Reference smoke should save two generated images.');
  assert(storedState.users[0].points === 1, 'Reference smoke should charge two points on success.');
}

async function runTruncatedImageResponseDoesNotRepeatSmoke() {
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    return new Response('{"data":[', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];

  assert(response.status === 200, 'Truncated image response smoke should be HTTP 200.');
  assert(imageCalls === 1, 'An ambiguous truncated response must not repeat the model request.');
  assert(result?.status === 'error', 'A truncated response should return one diagnosable image error.');
  assert(getSavedImageCount(kv) === 0, 'A truncated response must not persist an invalid image.');
}

async function runStreamingImageGenerationSmoke() {
  let requestBody = null;
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    requestBody = JSON.parse(options.body);
    const streamBody = [
      'event: image_generation.partial_image',
      `data: ${JSON.stringify({ type: 'image_generation.partial_image', b64_json: ONE_PIXEL_PNG, partial_image_index: 0 })}`,
      '',
      'event: image_generation.completed',
      `data: ${JSON.stringify({ type: 'image_generation.completed', b64_json: ONE_PIXEL_PNG })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(streamBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const start = events.find((event) => event.type === 'start');
  const result = getResultEvents(events)[0];

  assert(response.status === 200, 'Streaming image generation smoke should be HTTP 200.');
  assert(requestBody?.stream === true, 'Streaming image generation should enable stream mode.');
  assert(requestBody?.partial_images === 1, 'Streaming image generation should request one partial image heartbeat.');
  assert(!Object.prototype.hasOwnProperty.call(start || {}, 'batchItems'), 'Start events must not repeat the potentially large batch item list.');
  assert(!events.some((event) => String(event.type || '').startsWith('preview')), 'The browser stream must contain no preview transport events.');
  assert(result?.status === 'ok', 'Streaming image generation should use the completed event image.');
  assert(result?.image?.startsWith('/generated/'), 'Streaming image generation should return the saved same-origin URL directly.');
  assert(Number(start?.timing?.preflightMs) >= 0, 'Start events should expose a non-negative preflight duration.');
  assert(Number(result?.timing?.modelDurationMs) >= 0, 'Results should expose a non-negative model duration.');
  assert(Number(result?.timing?.persistenceDurationMs) >= 0, 'Results should expose a non-negative persistence duration.');
  assert(getSavedImageCount(kv) === 1, 'Streaming image generation should save the completed image.');
}

async function runChunkedBase64PreviewSmoke() {
  const largePng = `${ONE_PIXEL_PNG}${'A'.repeat(1_600_000)}`;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    return new Response(JSON.stringify({ data: [{ b64_json: largePng }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const raw = await response.text();
  const lines = raw.trim().split('\n').filter(Boolean);
  const events = lines.map((line) => JSON.parse(line));
  const previewStart = events.find((event) => event.type === 'preview_start');
  const previewChunks = events
    .filter((event) => event.type === 'preview_chunk')
    .sort((left, right) => left.sequence - right.sequence);
  const previewEnd = events.find((event) => event.type === 'preview_end');
  const result = getResultEvents(events)[0];

  assert(response.status === 200, 'Large base64 transport smoke should be HTTP 200.');
  assert(previewStart?.result?.totalChunks === previewChunks.length, 'Chunked preview should announce its exact chunk count.');
  assert(previewChunks.map((event) => event.data).join('') === largePng, 'Chunked preview should transmit the generated image exactly once.');
  assert(previewEnd?.id === previewStart?.result?.id, 'Chunked preview should close the matching image stream.');
  assert(events.indexOf(previewEnd) < events.findIndex((event) => event.type === 'result'), 'Chunked preview should complete before the persisted result event.');
  assert(!raw.includes('data:image/'), 'NDJSON must not carry a giant data URL.');
  assert(lines.every((line) => Buffer.byteLength(line, 'utf8') < 64 * 1024), 'Each NDJSON event must stay below 64 KiB.');
  assert(result?.status === 'ok' && result.image?.startsWith('/generated/'), 'Large Base64 output should return the stored URL.');
  assert(getSavedImageCount(kv) === 1, 'Large Base64 output should still persist exactly one image.');
}

async function runStreamingCompletedEventNameSmoke() {
  let streamCancelled = false;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode([
          'event: image_generation.completed',
          `data: ${JSON.stringify({ b64_json: ONE_PIXEL_PNG })}`,
          '',
          '',
        ].join('\n')));
      },
      cancel() {
        streamCancelled = true;
      },
    }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];

  assert(response.status === 200, 'Event-name-only streaming response should be HTTP 200.');
  assert(result?.status === 'ok', 'Completed event name should work without a type field in JSON data.');
  assert(streamCancelled, 'Completed streaming event should cancel an upstream connection that stays open.');
  assert(getSavedImageCount(kv) === 1, 'Event-name-only streaming response should save one image.');
}

async function runUntypedSseImageSmoke() {
  let imageCalls = 0;
  const finalPng = Buffer.concat([
    Buffer.from(ONE_PIXEL_PNG, 'base64'),
    Buffer.from([0, 0, 0]),
  ]).toString('base64');
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    return new Response([
      `data: ${JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG }] })}`,
      '',
      `data: ${JSON.stringify({ data: [{ b64_json: finalPng }] })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const savedKey = [...kv.map.keys()].find((key) => key.startsWith('generated:/'));
  const savedValue = kv.map.get(savedKey);

  assert(imageCalls === 1, 'An untyped SSE image payload should complete in one model request.');
  assert(getResultEvents(events)[0]?.status === 'ok', 'An untyped SSE image payload should be persisted.');
  assert(!events.some((event) => String(event.type || '').startsWith('preview')), 'An untyped SSE stream must not emit preview transport events.');
  assert(savedValue?.byteLength === Buffer.from(finalPng, 'base64').byteLength, 'The persisted untyped SSE image should be the final payload.');
  assert(getSavedImageCount(kv) === 1, 'An untyped SSE image payload should save exactly one image.');
}

async function runPartialOnlyStreamFallbackSmoke() {
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    const streamBody = [
      'event: image_generation.partial_image',
      `data: ${JSON.stringify({ b64_json: ONE_PIXEL_PNG })}`,
      '',
      '',
    ].join('\n');
    return new Response(streamBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const preview = events.find((event) => event.type === 'preview')?.result;
  const result = getResultEvents(events)[0];

  assert(imageCalls === 1, 'A clean partial-only stream with a usable image must not repeat the full model request.');
  assert(!preview, 'A Base64 partial fallback must not be copied into NDJSON.');
  assert(result?.status === 'ok', 'A clean partial-only stream should use its last usable image as the result.');
  assert(getSavedImageCount(kv) === 1, 'Partial-only stream fallback should save exactly one image.');
}

async function runCompletedWithoutImageDoesNotRepeatSmoke() {
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    const payload = { type: 'image_generation.completed' };
    return new Response([
      'event: image_generation.completed',
      `data: ${JSON.stringify(payload)}`,
      '',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];

  assert(imageCalls === 1, 'A malformed completed event must not repeat an ambiguous model operation.');
  assert(result?.status === 'error', 'A malformed completed event should return an image error.');
  assert(getSavedImageCount(kv) === 0, 'A malformed completed event must not save an image.');
}

async function runUsablePartialSurvivesStreamErrorSmoke() {
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    return new Response([
      'event: image_generation.partial_image',
      `data: ${JSON.stringify({ type: 'image_generation.partial_image', b64_json: ONE_PIXEL_PNG })}`,
      '',
      'event: error',
      `data: ${JSON.stringify({ error: { message: 'upstream stream closed after artifact' } })}`,
      '',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];

  assert(imageCalls === 1, 'A usable partial image must prevent a second model request after stream failure.');
  assert(!events.some((event) => event.type === 'preview'), 'The Base64 partial fallback must not enter NDJSON.');
  assert(result?.status === 'ok', 'The last usable partial should become the final persisted result.');
  assert(getSavedImageCount(kv) === 1, 'The partial fallback should persist exactly one image.');
}

async function runStreamingErrorDoesNotFallbackSmoke() {
  const bodies = [];
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    const body = JSON.parse(options.body);
    bodies.push(body);
    return new Response([
      'event: error',
      `data: ${JSON.stringify({ error: { message: 'Unsupported parameter: partial_images' } })}`,
      '',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];

  assert(bodies.length === 1, 'An HTTP 200 SSE error is an unknown outcome and must not repeat the model request.');
  assert(bodies[0].stream === true, 'The single HTTP 200 SSE request should use streaming.');
  assert(result?.status === 'error', 'An HTTP 200 SSE error should return one diagnosable failure.');
  assert(getSavedImageCount(kv) === 0, 'An HTTP 200 SSE error must not save an invalid image.');
}

async function runUnsupportedStreamingFallbackSmoke() {
  const bodies = [];
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (bodies.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'Unsupported parameter: stream' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];

  assert(response.status === 200, 'Unsupported streaming fallback smoke should be HTTP 200.');
  assert(bodies.length === 2, 'Unsupported streaming fallback should retry once without streaming fields.');
  assert(bodies[0].stream === true && bodies[0].partial_images === 1, 'First fallback request should use streaming fields.');
  assert(!('stream' in bodies[1]) && !('partial_images' in bodies[1]), 'Fallback request should remove only streaming fields.');
  assert(bodies[0].model === bodies[1].model, 'Streaming fallback must keep the configured image model.');
  assert(bodies[0].size === bodies[1].size, 'Streaming fallback must keep the strict image size.');
  assert(result?.status === 'ok', 'Unsupported streaming fallback should still generate an image.');
  assert(getSavedImageCount(kv) === 1, 'Unsupported streaming fallback should save one image.');
}

async function runUnprocessableStreamingFallbackSmoke() {
  const bodies = [];
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (bodies.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'partial_images is not allowed' } }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);

  assert(bodies.length === 2, 'An explicit HTTP 422 protocol rejection should allow one safe fallback.');
  assert(!('stream' in bodies[1]) && !('partial_images' in bodies[1]), 'HTTP 422 fallback should remove only streaming fields.');
  assert(getResultEvents(events)[0]?.status === 'ok', 'HTTP 422 protocol fallback should preserve the generated result.');
  assert(getSavedImageCount(kv) === 1, 'HTTP 422 protocol fallback should save exactly one image.');
}

async function runUncertainHttpErrorDoesNotFallbackSmoke() {
  for (const status of [400, 500, 524]) {
    let imageCalls = 0;
    globalThis.fetch = async (url) => {
      const textUrl = String(url);
      if (!textUrl.endsWith('/images/generations')) {
        throw new Error(`Unexpected mock fetch: ${textUrl}`);
      }
      imageCalls += 1;
      const message = status === 400 ? 'Invalid prompt payload' : 'Unsupported parameter: stream';
      return new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    };

    const { env } = createEnv({ ruleConfigured: false });
    const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
    const events = await readStreamEvents(response);

    assert(imageCalls === 1, `HTTP ${status} without a safe protocol rejection must not repeat the model request.`);
    assert(getResultEvents(events)[0]?.status === 'error', `HTTP ${status} should return one image failure.`);
  }
}

async function runOrphanBatchRecoverySmoke() {
  const { env, kv } = createEnv({ points: 1, ruleConfigured: false });
  const staleState = JSON.parse(await kv.get('app-state'));
  staleState.generationBatches.push({
    id: 'stale-batch-1',
    userId: 'user-1',
    reservedPoints: 2,
    successCount: 1,
    failedCount: 0,
    refundedPoints: 0,
    imageIndexes: [0, 1],
    successIndexes: [0],
    failedIndexes: [],
    refundedIndexes: [],
    status: 'running',
    type: 'batch',
    createdAt: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
    finishedAt: '',
    note: '',
  });
  await kv.put('app-state', JSON.stringify(staleState));

  const response = await worker.fetch(createGetRequest('/api/health'), env, { waitUntil: () => {} });
  const recoveredState = await getStoredState(kv);
  const recoveredBatch = recoveredState.generationBatches.find((batch) => batch.id === 'stale-batch-1');
  const refundLogs = recoveredState.pointLogs.filter((log) => log.batchId === 'stale-batch-1' && log.type === 'generation_refund');

  assert(response.status === 200, 'Orphan batch recovery smoke health request should be HTTP 200.');
  assert(recoveredState.users[0].points === 2, 'Orphan recovery should refund only the unfinished image point.');
  assert(recoveredBatch?.status === 'failed', 'Orphan recovery should mark the stale batch failed.');
  assert(recoveredBatch?.successCount === 1, 'Orphan recovery should preserve the successful image count.');
  assert(recoveredBatch?.failedCount === 1, 'Orphan recovery should count one unfinished image as failed.');
  assert(recoveredBatch?.refundedPoints === 1, 'Orphan recovery should refund exactly one image point.');
  assert(refundLogs.length === 1 && refundLogs[0].imageIndex === 1, 'Orphan recovery should log the unfinished image refund.');
}

async function runFourKUnknownOutcomeDoesNotRepeatSmoke() {
  const sizes = [];
  const streamingModes = [];
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    const body = JSON.parse(options.body);
    sizes.push(body.size);
    streamingModes.push(body.stream);
    return new Response(JSON.stringify({ error: { message: 'error code: 524' } }), {
      status: 524,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = events.find((event) => event.type === 'result')?.result;

  assert(response.status === 200, '4K unknown-outcome smoke response should be HTTP 200.');
  assert(sizes.length === 1, 'A 524 with unknown outcome must not repeat the expensive image operation.');
  assert(sizes[0] !== 'auto', 'The single 4K request should keep its strict size.');
  assert(streamingModes[0] === true, 'The single 4K request should keep streaming enabled.');
  assert(result?.status === 'error', 'A 524 with no usable artifact should return an immediate image error.');
  assert(getSavedImageCount(kv) === 0, 'A 524 with no artifact must not save an image.');
}

async function runStandardSizeUnknownOutcomeDoesNotRepeatSmoke() {
  const sizes = [];
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    sizes.push(JSON.parse(options.body).size);
    return new Response(JSON.stringify({ error: { message: 'error code: 524' } }), {
      status: 524,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const config = JSON.parse(await kv.get('ai-config'));
  config.image.resolution = 'standard';
  await kv.put('ai-config', JSON.stringify(config));
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);

  assert(sizes.length === 1, 'A standard-size 524 must not trigger a second size:auto model operation.');
  assert(sizes[0] !== 'auto', 'The single standard request should keep its original explicit size.');
  assert(getResultEvents(events)[0]?.status === 'error', 'A standard-size unknown outcome should return one failure.');
}

async function runImageKeyCountDoesNotExpandAttemptBudgetSmoke() {
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    return new Response(JSON.stringify({ error: { message: 'error code: 524' } }), {
      status: 524,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const config = JSON.parse(await kv.get('ai-config'));
  config.image.entries[0].apiKeys = ['key-1', 'key-2', 'key-3', 'key-4', 'key-5', 'key-6'];
  await kv.put('ai-config', JSON.stringify(config));
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);

  assert(imageCalls === 1, 'Adding API keys must not turn one image operation into serial model retries.');
  assert(getResultEvents(events)[0]?.status === 'error', 'The unknown outcome should stay a single diagnosable failure.');
}

async function runImageFailureDiagnosticsSmoke() {
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    return new Response(JSON.stringify({ error: { message: 'error code: 524' } }), {
      status: 524,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];
  const storedState = await getStoredState(kv);

  assert(response.status === 200, 'Image failure diagnostics smoke should be HTTP 200.');
  assert(result?.status === 'error', 'Image failure diagnostics smoke should return an error result.');
  assert(result.error.includes('HTTP 状态：524'), 'Image failure diagnostics should expose the upstream HTTP status.');
  assert(result.error.includes('尝试次数：1/1'), 'Image failure diagnostics should expose the single model attempt.');
  assert(result.error.includes('失败阶段：image_generation_request'), 'Image failure diagnostics should expose the failure stage.');
  assert(storedState.generationBatches[0]?.lastError?.includes('HTTP 状态：524'), 'Batch state should retain the real image failure.');
}

async function runNestedImagePayloadSmoke() {
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: 'image_url',
                image_url: { url: DATA_URL_PNG },
              },
            ],
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = events.find((event) => event.type === 'result')?.result;

  assert(response.status === 200, 'Nested image payload smoke response should be HTTP 200.');
  assert(result?.status === 'ok', 'Nested image payload smoke result should be ok.');
  assert(getSavedImageCount(kv) === 1, 'Nested image payload smoke should save one generated image.');
}

async function runGeneratedImageUrlDownloadSmoke() {
  let generationCalls = 0;
  let imageDownloadCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.endsWith('/images/generations')) {
      generationCalls += 1;
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.mock/generated-image' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (textUrl === 'https://cdn.mock/generated-image') {
      imageDownloadCalls += 1;
      return new Response(Buffer.from(ONE_PIXEL_PNG, 'base64'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    throw new Error(`Unexpected mock fetch: ${textUrl}`);
  };

  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = events.find((event) => event.type === 'result')?.result;

  assert(response.status === 200, 'Generated URL smoke response should be HTTP 200.');
  assert(generationCalls === 1, 'Each image must trigger exactly one model generation request.');
  assert(imageDownloadCalls === 1, 'The generated remote image must be downloaded exactly once by the server.');
  assert(events.map((event) => event.type).join(',') === 'start,result,done', 'The browser stream should be start, result, done only.');
  assert(result?.status === 'ok', 'Generated URL smoke result should be ok.');
  assert(result?.image?.startsWith('/generated/'), 'Generated URL smoke should return a saved image path.');
  assert(getSavedImageCount(kv) === 1, 'Generated URL smoke should save one generated image.');
}

async function runPreviewStreamsBeforeImagePersistSmoke() {
  const imageDownload = createDeferred();
  let imageDownloadStarted = false;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.endsWith('/images/generations')) {
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.mock/slow-generated-image' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (textUrl === 'https://cdn.mock/slow-generated-image') {
      imageDownloadStarted = true;
      await imageDownload.promise;
      return new Response(Buffer.from(ONE_PIXEL_PNG, 'base64'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    throw new Error(`Unexpected mock fetch: ${textUrl}`);
  };

  const waitUntilTasks = [];
  const { env, kv } = createEnv({ ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, {
    waitUntil: (task) => waitUntilTasks.push(task),
  });
  const reader = response.body.getReader();
  const startEvent = await readNextStreamEvent(reader);
  const previewEvent = await readNextStreamEvent(reader);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert(response.status === 200, 'Preview stream smoke response should be HTTP 200.');
  assert(startEvent?.type === 'start', 'Preview stream should emit start before image work.');
  assert(previewEvent?.type === 'preview', 'Preview stream should emit preview before saved result.');
  assert(previewEvent?.result?.image === 'https://cdn.mock/slow-generated-image', 'Preview stream should expose the immediate model image URL.');
  assert(previewEvent?.result?.saving === true, 'Preview stream should mark the image as still saving.');
  assert(imageDownloadStarted, 'Preview stream should start persisting the generated image after preview.');
  assert(getSavedImageCount(kv) === 0, 'Preview stream should not persist the image before the slow download is released.');

  imageDownload.resolve();
  const resultEvent = await readNextStreamEvent(reader);
  const doneEvent = await readNextStreamEvent(reader);
  await reader.cancel().catch(() => {});
  await Promise.allSettled(waitUntilTasks);

  assert(resultEvent?.type === 'result', 'Preview stream should emit final result after persistence.');
  assert(resultEvent?.result?.status === 'ok', 'Preview stream final result should succeed.');
  assert(resultEvent?.result?.image?.startsWith('/generated/'), 'Preview stream final result should use saved image path.');
  assert(doneEvent?.type === 'done', 'Preview stream should finish with done.');
  assert(getSavedImageCount(kv) === 1, 'Preview stream should persist one generated image.');
}

async function runBase64PreviewStreamsBeforeKvPersistSmoke() {
  const persistenceGate = createDeferred();
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const waitUntilTasks = [];
  const { env, kv } = createEnv({ ruleConfigured: false });
  const originalPut = kv.put.bind(kv);
  kv.put = async (key, value, options = {}) => {
    if (key.startsWith('generated:')) await persistenceGate.promise;
    return originalPut(key, value, options);
  };

  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, {
    waitUntil: (task) => waitUntilTasks.push(task),
  });
  const reader = response.body.getReader();
  const previewEvents = [];
  let resultEvent = null;
  let doneEvent = null;

  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const event = await readNextStreamEvent(reader);
      if (!event) break;
      previewEvents.push(event);
      if (event.type === 'preview_end') break;
    }
    const savedBeforeRelease = getSavedImageCount(kv);
    persistenceGate.resolve();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const event = await readNextStreamEvent(reader);
      if (!event) break;
      if (event.type === 'result') resultEvent = event;
      if (event.type === 'done') {
        doneEvent = event;
        break;
      }
    }

    assert(previewEvents.some((event) => event.type === 'preview_start'), 'Base64 preview should start before KV persistence completes.');
    assert(previewEvents.some((event) => event.type === 'preview_chunk'), 'Base64 preview should stream image bytes before KV persistence completes.');
    assert(previewEvents.at(-1)?.type === 'preview_end', 'Base64 preview should finish before KV persistence is released.');
    assert(savedBeforeRelease === 0, 'Base64 preview must not wait for the generated KV value to exist.');
    assert(resultEvent?.result?.status === 'ok', 'Base64 preview should still finish with a saved result.');
    assert(doneEvent?.type === 'done', 'Base64 preview stream should finish normally.');
  } finally {
    persistenceGate.resolve();
    await reader.cancel().catch(() => {});
    await Promise.allSettled(waitUntilTasks);
  }
}

async function runConcurrentBatchGenerationSmoke() {
  let inFlight = 0;
  let maxInFlight = 0;
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 30));
    inFlight -= 1;
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ points: 4, ruleConfigured: false });
  const response = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        count: 4,
        options: { layoutFixed: true },
        batchItems: ['Page one', 'Page two', 'Page three', 'Page four'],
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const events = await readStreamEvents(response);
  const results = getResultEvents(events);
  const summary = getDoneSummary(events);

  assert(response.status === 200, 'Concurrent batch smoke response should be HTTP 200.');
  assert(imageCalls === 4, 'Concurrent batch smoke should request all four images.');
  assert(maxInFlight === 3, 'Fixed-layout generation must keep the configured concurrency window at three.');
  assert(results.length === 4, 'Concurrent batch smoke should stream four result events.');
  assert(results.every((result) => result.status === 'ok'), 'Concurrent batch smoke results should all be ok.');
  assert(summary?.success === 4, 'Concurrent batch smoke summary should count four successes.');
  assert(getSavedImageCount(kv) === 4, 'Concurrent batch smoke should save four generated images.');
}

async function runSlowKvDoesNotOccupyModelSlotSmoke() {
  const persistenceGate = createDeferred();
  const boundedBacklogReached = createDeferred();
  let imageCalls = 0;
  let persistenceInFlight = 0;
  let maxPersistenceInFlight = 0;

  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    if (imageCalls === 4) boundedBacklogReached.resolve();
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ points: 8, ruleConfigured: false });
  const originalPut = kv.put.bind(kv);
  kv.put = async (key, value, options = {}) => {
    if (key.startsWith('generated:')) {
      persistenceInFlight += 1;
      maxPersistenceInFlight = Math.max(maxPersistenceInFlight, persistenceInFlight);
      await persistenceGate.promise;
      persistenceInFlight -= 1;
    }
    return originalPut(key, value, options);
  };

  const response = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        count: 8,
        batchItems: Array.from({ length: 8 }, (_, index) => `Page ${index + 1}`),
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const reader = response.body.getReader();
  const eventsBeforeRelease = [];
  const previewedIndexes = new Set();
  for (let attempt = 0; attempt < 40 && previewedIndexes.size < 4; attempt += 1) {
    const event = await readNextStreamEvent(reader);
    if (!event) break;
    eventsBeforeRelease.push(event);
    if (event.type === 'preview_end') previewedIndexes.add(Number(event.index));
  }
  const backlogReached = await Promise.race([
    boundedBacklogReached.promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 300)),
  ]);
  const modelCallsBeforeRelease = imageCalls;
  const persistencePeakBeforeRelease = maxPersistenceInFlight;
  persistenceGate.resolve();
  const events = [...eventsBeforeRelease];
  while (true) {
    const event = await readNextStreamEvent(reader);
    if (!event) break;
    events.push(event);
  }

  assert(backlogReached, 'Slow persistence should still allow the next two model operations to start.');
  assert(modelCallsBeforeRelease === 4, 'A blocked persistence pool must bound buffered model artifacts at four.');
  assert(persistencePeakBeforeRelease === 2, 'Normal generation must cap concurrent persistence at two.');
  assert(previewedIndexes.size === 4, 'All four completed model artifacts should finish preview streaming before KV is released.');
  assert(!eventsBeforeRelease.some((event) => event.type === 'result'), 'Blocked image persistence must not emit a final result before KV is released.');
  assert(imageCalls === 8, 'All model operations should finish after persistence backpressure is released.');
  assert(getResultEvents(events).every((result) => result.status === 'ok'), 'All decoupled persistence results should succeed.');
  assert(getSavedImageCount(kv) === 8, 'Bounded persistence should save all generated images.');
}

async function runSlowResultStateWriteDoesNotBlockModelOrPreviewSmoke() {
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const releaseStateWrite = createDeferred();
  let blockedResultWrite = false;
  const { env, kv } = createEnv({ points: 6, ruleConfigured: false });
  const originalPut = kv.put.bind(kv);
  kv.put = async (key, value, options = {}) => {
    if (key === 'app-state' && !blockedResultWrite) {
      const snapshot = JSON.parse(String(value));
      const batch = snapshot.generationBatches[0];
      if (batch?.status === 'running' && batch.successCount === 1) {
        blockedResultWrite = true;
        await releaseStateWrite.promise;
      }
    }
    return originalPut(key, value, options);
  };

  const response = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        count: 6,
        batchItems: Array.from({ length: 6 }, (_, index) => `State write page ${index + 1}`),
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const reader = response.body.getReader();
  const events = [];
  const previewedIndexes = new Set();
  const boundedPreviewsReached = createDeferred();
  const eventCollector = (async () => {
    while (true) {
      const event = await readNextStreamEvent(reader);
      if (!event) break;
      events.push(event);
      if (event.type === 'preview_end') {
        previewedIndexes.add(Number(event.index));
        if (previewedIndexes.size === 4) boundedPreviewsReached.resolve();
      }
    }
  })();

  const boundedPreviewsCompletedBeforeRelease = await Promise.race([
    boundedPreviewsReached.promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 300)),
  ]);
  const imageCallsBeforeRelease = imageCalls;
  const resultsBeforeRelease = events.filter((event) => event.type === 'result').length;
  releaseStateWrite.resolve();
  await eventCollector;

  assert(blockedResultWrite, 'The first successful app-state result write should be blocked.');
  assert(boundedPreviewsCompletedBeforeRelease, 'A blocked result-state write should still allow one bounded model backlog to finish previewing.');
  assert(previewedIndexes.size === 6, 'All model previews should finish after the state-write gate is released.');
  assert(imageCallsBeforeRelease === 4, 'A blocked result-state write must allow four model calls while bounding buffered artifacts at four.');
  assert(resultsBeforeRelease === 0, 'Final result delivery should wait for its serialized accounting write.');
  assert(getResultEvents(events).length === 6, 'All six results should settle after the state-write gate is released.');
}

async function runSlowClientBackpressureBoundsArtifactSmoke() {
  const boundedCallsReached = createDeferred();
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    if (imageCalls === 4) boundedCallsReached.resolve();
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env } = createEnv({ points: 8, ruleConfigured: false });
  const response = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        count: 8,
        batchItems: Array.from({ length: 8 }, (_, index) => `Slow client page ${index + 1}`),
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const reader = response.body.getReader();
  const events = [];
  events.push(await readNextStreamEvent(reader));

  const boundedBacklogReached = await Promise.race([
    boundedCallsReached.promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 300)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const callsWhileClientPaused = imageCalls;

  while (true) {
    const event = await readNextStreamEvent(reader);
    if (!event) break;
    events.push(event);
  }

  assert(boundedBacklogReached, 'A paused client should still allow one bounded model backlog to start.');
  assert(callsWhileClientPaused === 4, 'A paused client must bound active and buffered model artifacts at four.');
  assert(imageCalls === 8, 'All model operations should finish after the client resumes reading.');
  assert(getResultEvents(events).length === 8, 'All results should arrive after client backpressure is released.');
}

async function runPersistenceFailureDoesNotRepeatModelSmoke() {
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ points: 1, ruleConfigured: false });
  const originalPut = kv.put.bind(kv);
  kv.put = async (key, value, options = {}) => {
    if (key.startsWith('generated:')) throw new Error('mock persistence failure');
    return originalPut(key, value, options);
  };

  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];
  const storedState = await getStoredState(kv);

  assert(imageCalls === 1, 'A persistence failure must not repeat the completed model operation.');
  assert(result?.status === 'error' && result.error.includes('image_persistence'), 'A persistence failure should identify its stage.');
  assert(result?.persistenceFailed === true, 'A persistence failure should expose a structured persistence marker.');
  assert(result?.failureStage === 'image_persistence', 'A persistence failure should expose its structured failure stage.');
  assert(!Object.prototype.hasOwnProperty.call(result || {}, 'preserveLocalPreview'), 'A persistence failure must not expose a temporary preview state.');
  assert(getSavedImageCount(kv) === 0, 'A failed persistence operation must not expose a saved image.');
  assert(storedState.users[0].points === 1, 'A persistence failure should refund the reserved image point.');
}

async function runNetworkFailureDoesNotRepeatModelSmoke() {
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    throw new TypeError('mock upstream connection reset');
  };

  const { env, kv } = createEnv({ points: 1, ruleConfigured: false });
  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);

  assert(imageCalls === 1, 'A network failure with unknown outcome must not repeat the model request.');
  assert(getResultEvents(events)[0]?.status === 'error', 'A network failure should return one diagnosable image error.');
  assert(getSavedImageCount(kv) === 0, 'A network failure must not persist an image.');
}

async function runSuccessResultPersistsBeforeFinalSettlementSmoke() {
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ points: 2, ruleConfigured: false });
  let appStateWrites = 0;
  const originalPut = kv.put.bind(kv);
  kv.put = async (key, value, options = {}) => {
    if (key === 'app-state') appStateWrites += 1;
    return originalPut(key, value, options);
  };

  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, { waitUntil: () => {} });
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];

  assert(response.status === 200, 'Success stream persist smoke response should be HTTP 200.');
  assert(result?.status === 'ok', 'Success stream persist smoke result should be ok.');
  assert(appStateWrites === 3, 'Success stream persist smoke should persist reserve, streamed success, and final settlement.');
}

async function runPartialFailureRefundSmoke() {
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    if (imageCalls === 1) {
      return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: { message: 'mock image failure' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ points: 3, ruleConfigured: false });
  const response = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        count: 2,
        batchItems: ['Page one succeeds', 'Page two fails'],
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const events = await readStreamEvents(response);
  const results = getResultEvents(events);
  const summary = getDoneSummary(events);
  const storedState = await getStoredState(kv);
  const refundLogs = storedState.pointLogs.filter((log) => log.type === 'generation_refund');

  assert(response.status === 200, 'Partial refund smoke response should be HTTP 200.');
  assert(results.length === 2, 'Partial refund smoke should return two result events.');
  assert(results[0]?.status === 'ok', 'Partial refund first image should succeed.');
  assert(results[1]?.status === 'error', 'Partial refund second image should fail.');
  assert(summary?.success === 1, 'Partial refund summary should count one success.');
  assert(summary?.failed === 1, 'Partial refund summary should count one failure.');
  assert(summary?.points?.reserved === 2, 'Partial refund should reserve two points.');
  assert(summary?.points?.success === 1, 'Partial refund point summary should count one success.');
  assert(summary?.points?.failed === 1, 'Partial refund point summary should count one failed image.');
  assert(summary?.points?.refunded === 1, 'Partial refund should refund one point.');
  assert(summary?.points?.balance === 2, 'Partial refund balance should be two points.');
  assert(storedState.users[0].points === 2, 'Partial refund stored balance should be two points.');
  assert(storedState.generationBatches[0].successCount === 1, 'Partial refund batch should store one success.');
  assert(storedState.generationBatches[0].failedCount === 1, 'Partial refund batch should store one failure.');
  assert(storedState.generationBatches[0].refundedPoints === 1, 'Partial refund batch should store one refunded point.');
  assert(storedState.pointLogs.some((log) => log.type === 'generation_reserve' && log.points === -2), 'Partial refund should record reserve log.');
  assert(refundLogs.length === 1, 'Partial refund should record one refund log.');
  assert(refundLogs[0].points === 1, 'Partial refund log should refund one point.');
  assert(refundLogs[0].imageIndex === 1, 'Partial refund log should identify the failed image index.');
}

async function runRetryFailureRefundSmoke() {
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    return new Response(JSON.stringify({ error: { message: 'mock retry failure' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  };

  const { env, kv } = createEnv({ points: 3, ruleConfigured: false });
  const response = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        count: 2,
        targetIndex: 0,
        batchItems: ['Retry page fails', 'Existing page stays untouched'],
      }),
    ),
    env,
    { waitUntil: () => {} },
  );
  const events = await readStreamEvents(response);
  const result = getResultEvents(events)[0];
  const summary = getDoneSummary(events);
  const storedState = await getStoredState(kv);
  const refundLogs = storedState.pointLogs.filter((log) => log.type === 'generation_refund');

  assert(response.status === 200, 'Retry refund smoke response should be HTTP 200.');
  assert(result?.status === 'error', 'Retry refund result should fail.');
  assert(summary?.success === 0, 'Retry refund summary should count zero success.');
  assert(summary?.failed === 1, 'Retry refund summary should count one failure.');
  assert(summary?.points?.reserved === 1, 'Retry refund should reserve one point.');
  assert(summary?.points?.refunded === 1, 'Retry refund should refund one point.');
  assert(summary?.points?.balance === 3, 'Retry refund balance should stay unchanged.');
  assert(storedState.users[0].points === 3, 'Retry refund stored balance should stay unchanged.');
  assert(storedState.pointLogs.some((log) => log.type === 'generation_reserve' && log.points === -1), 'Retry refund should record one-point reserve log.');
  assert(refundLogs.length === 1, 'Retry refund should record one refund log.');
  assert(refundLogs[0].points === 1, 'Retry refund log should refund one point.');
  assert(refundLogs[0].imageIndex === 0, 'Retry refund log should identify the retried image index.');
}

async function runCancelRefundSmoke() {
  const firstImage = createDeferred();
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    await firstImage.promise;
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const waitUntilTasks = [];
  const { env, kv } = createEnv({ points: 4, ruleConfigured: false });
  const response = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        count: 3,
        batchItems: ['Cancel page one', 'Cancel page two', 'Cancel page three'],
      }),
    ),
    env,
    { waitUntil: (task) => waitUntilTasks.push(task) },
  );
  const reader = response.body.getReader();
  const startEvent = await readNextStreamEvent(reader);
  const batchId = startEvent?.points?.batchId;

  assert(response.status === 200, 'Cancel refund stream should start with HTTP 200.');
  assert(startEvent?.type === 'start', 'Cancel refund stream should emit start event.');
  assert(batchId, 'Cancel refund start event should include batch id.');
  const reservedState = await getStoredState(kv);
  assert(reservedState.generationBatches[0]?.id === batchId, 'Generation queue and cancellation API must share one batch id.');

  const cancelResponse = await worker.fetch(
    createJsonRequest('/api/generate/cancel', { batchId }, 'k12_session=session-1'),
    env,
    { waitUntil: () => {} },
  );
  const cancelPayload = await readJson(cancelResponse);
  let storedState = await getStoredState(kv);
  const canceledBatch = storedState.generationBatches.find((batch) => batch.id === batchId);

  assert(cancelResponse.status === 200, 'Cancel refund request should be HTTP 200.');
  assert(cancelPayload.points?.reserved === 3, 'Cancel refund should keep three reserved points in summary.');
  assert(cancelPayload.points?.success === 0, 'Cancel refund should count zero success before any image returns.');
  assert(cancelPayload.points?.failed === 3, 'Cancel refund should count three unfinished images.');
  assert(cancelPayload.points?.refunded === 3, 'Cancel refund should refund all unfinished image points.');
  assert(cancelPayload.points?.balance === 4, 'Cancel refund balance should return to original points.');
  assert(storedState.users[0].points === 4, 'Cancel refund stored balance should return to original points.');
  assert(canceledBatch?.status === 'canceled', 'Cancel refund batch should be marked canceled.');
  assert(canceledBatch?.refundedPoints === 3, 'Cancel refund batch should store three refunded points.');

  firstImage.resolve();
  await reader.cancel().catch(() => {});
  await Promise.allSettled(waitUntilTasks);
  storedState = await getStoredState(kv);
  const refundLogs = storedState.pointLogs.filter((log) => log.type === 'generation_refund' && log.batchId === batchId);

  assert(imageCalls <= 2, 'Cancel refund should not start more than the active concurrency window.');
  assert(storedState.users[0].points === 4, 'Canceled stream must not overwrite refunded balance later.');
  assert(refundLogs.length === 3, 'Cancel refund should record one refund log per unfinished image.');
  assert(refundLogs.every((log) => log.points === 1), 'Cancel refund logs should each refund one point.');
}

async function runCancelWhilePersistenceBlockedSmoke() {
  const persistenceGate = createDeferred();
  const persistenceStarted = createDeferred();
  let generatedPuts = 0;
  let cancellationSettled = false;
  let appStateWritesAfterCancellation = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const waitUntilTasks = [];
  const { env, kv } = createEnv({ points: 2, ruleConfigured: false });
  const originalPut = kv.put.bind(kv);
  kv.put = async (key, value, options = {}) => {
    if (key === 'app-state' && cancellationSettled) appStateWritesAfterCancellation += 1;
    if (key.startsWith('generated:')) {
      generatedPuts += 1;
      if (generatedPuts === 2) persistenceStarted.resolve();
      await persistenceGate.promise;
    }
    return originalPut(key, value, options);
  };

  const response = await worker.fetch(
    createGenerateRequest(createBasePayload({ count: 2, batchItems: ['Page one', 'Page two'] })),
    env,
    { waitUntil: (task) => waitUntilTasks.push(task) },
  );
  const reader = response.body.getReader();
  let batchId = '';
  const trailingEvents = [];

  try {
    const startEvent = await readNextStreamEvent(reader);
    batchId = startEvent?.points?.batchId || '';
    const previewedIndexes = new Set();
    for (let attempt = 0; attempt < 20 && previewedIndexes.size < 2; attempt += 1) {
      const event = await readNextStreamEvent(reader);
      if (!event) break;
      if (event.type === 'preview_end') previewedIndexes.add(Number(event.index));
    }
    const bothPersistenceTasksStarted = await Promise.race([
      persistenceStarted.promise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 300)),
    ]);

    const cancelResponse = await worker.fetch(
      createJsonRequest('/api/generate/cancel', { batchId }, 'k12_session=session-1'),
      env,
      { waitUntil: () => {} },
    );
    const cancelPayload = await readJson(cancelResponse);
    cancellationSettled = true;
    persistenceGate.resolve();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const event = await readNextStreamEvent(reader);
      if (!event) break;
      trailingEvents.push(event);
      if (event.type === 'done' || event.type === 'error') break;
    }
    await Promise.allSettled(waitUntilTasks);

    const storedState = await getStoredState(kv);
    const batch = storedState.generationBatches.find((item) => item.id === batchId);
    assert(previewedIndexes.size === 2, 'Cancellation smoke should receive both previews before blocked persistence completes.');
    assert(bothPersistenceTasksStarted, 'Both bounded persistence tasks should be active before cancellation.');
    assert(cancelPayload.points?.refunded === 2, 'Cancellation should refund both not-yet-finalized images.');
    assert(!trailingEvents.some((event) => event.type === 'result'), 'A canceled batch must suppress late success result events.');
    assert(appStateWritesAfterCancellation === 0, 'Late results must not enqueue another app-state write after the cancel marker exists.');
    assert(batch?.status === 'canceled', 'Late persistence completion must not overwrite the canceled batch state.');
    assert(batch?.successCount === 0 && batch.refundedPoints === 2, 'Late persistence completion must not change canceled accounting.');
    assert(storedState.users[0].points === 2, 'Late persistence completion must not consume refunded points again.');
  } finally {
    persistenceGate.resolve();
    await reader.cancel().catch(() => {});
    await Promise.allSettled(waitUntilTasks);
  }
}

async function runCancelDuringBlockedResultStateWriteSmoke() {
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const resultStateWriteStarted = createDeferred();
  const releaseResultStateWrite = createDeferred();
  const cancelMarkerWritten = createDeferred();
  const writeOrder = [];
  const waitUntilTasks = [];
  const { env, kv } = createEnv({ points: 1, ruleConfigured: false });
  const originalPut = kv.put.bind(kv);
  kv.put = async (key, value, options = {}) => {
    if (key.startsWith('generation-cancel:')) {
      writeOrder.push('marker');
      await originalPut(key, value, options);
      cancelMarkerWritten.resolve();
      return;
    }
    if (key === 'app-state') {
      const snapshot = JSON.parse(String(value));
      const stateBatch = snapshot.generationBatches[0];
      if (stateBatch?.status === 'running' && stateBatch.successCount === 1) {
        resultStateWriteStarted.resolve();
        await releaseResultStateWrite.promise;
        writeOrder.push('result');
      } else if (stateBatch?.status === 'canceled') {
        writeOrder.push('cancel');
      }
    }
    await originalPut(key, value, options);
  };

  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, {
    waitUntil: (task) => waitUntilTasks.push(task),
  });
  const reader = response.body.getReader();
  const events = [];
  let batchId = '';

  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const event = await readNextStreamEvent(reader);
      if (!event) break;
      events.push(event);
      if (event.type === 'start') batchId = event.points?.batchId || '';
      if (event.type === 'preview_end') break;
    }
    const stateWriteBlocked = await Promise.race([
      resultStateWriteStarted.promise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    assert(stateWriteBlocked, 'The streamed single-image success state write should be blocked before cancellation.');

    let cancelSettled = false;
    const cancelResponsePromise = worker.fetch(
      createJsonRequest('/api/generate/cancel', { batchId }, 'k12_session=session-1'),
      env,
      { waitUntil: () => {} },
    ).then((cancelResponse) => {
      cancelSettled = true;
      return cancelResponse;
    });
    const markerArrived = await Promise.race([
      cancelMarkerWritten.promise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    assert(markerArrived, 'Cancellation must publish its marker while the older app-state write is blocked.');
    assert(!cancelSettled, 'Cancellation settlement should wait for the older serialized app-state write.');

    releaseResultStateWrite.resolve();
    const cancelResponse = await cancelResponsePromise;
    const cancelPayload = await readJson(cancelResponse);
    while (true) {
      const event = await readNextStreamEvent(reader);
      if (!event) break;
      events.push(event);
    }
    await Promise.allSettled(waitUntilTasks);

    const storedState = await getStoredState(kv);
    const storedBatch = storedState.generationBatches.find((item) => item.id === batchId);
    const refundLogs = storedState.pointLogs.filter(
      (log) => log.type === 'generation_refund' && log.batchId === batchId,
    );
    assert(cancelResponse.status === 200, 'Blocked state-write cancellation should return HTTP 200.');
    assert(writeOrder.join(',') === 'marker,result,cancel', 'Cancellation state must land after the older result snapshot, with the marker published first.');
    assert(!events.some((event) => event.type === 'result'), 'A marker published before result delivery must suppress the late result event.');
    assert(!events.some((event) => event.type === 'done'), 'A canceled batch must never emit a successful done terminal event.');
    assert(
      events.some((event) => event.type === 'error' && String(event.message || '').includes('已取消')),
      'A canceled batch should terminate the stream with an explicit cancellation error event.',
    );
    assert(storedBatch?.status === 'canceled', 'The final stored batch must remain canceled after the blocked result write resumes.');
    assert(storedBatch?.successCount === 1 && storedBatch.refundedPoints === 0, 'The already persisted image should remain successful without a duplicate refund.');
    assert(storedState.users[0].points === 0, 'The successful single image should consume exactly one point.');
    assert(cancelPayload.points?.success === 1 && cancelPayload.points?.refunded === 0, 'Cancellation response should report the serialized success accounting.');
    assert(refundLogs.length === 0, 'The completed image must not receive a cancellation refund.');
  } finally {
    releaseResultStateWrite.resolve();
    await reader.cancel().catch(() => {});
    await Promise.allSettled(waitUntilTasks);
  }
}

async function runCancelWhileMarkerWriteBlockedSmoke() {
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const resultStateWriteStarted = createDeferred();
  const releaseResultStateWrite = createDeferred();
  const markerWriteStarted = createDeferred();
  const releaseMarkerWrite = createDeferred();
  const waitUntilTasks = [];
  const { env, kv } = createEnv({ points: 1, ruleConfigured: false });
  const originalPut = kv.put.bind(kv);
  let resultWriteBlocked = false;
  kv.put = async (key, value, options = {}) => {
    if (key.startsWith('generation-cancel:')) {
      markerWriteStarted.resolve();
      await releaseMarkerWrite.promise;
      return originalPut(key, value, options);
    }
    if (key === 'app-state' && !resultWriteBlocked) {
      const snapshot = JSON.parse(String(value));
      const stateBatch = snapshot.generationBatches[0];
      if (stateBatch?.status === 'running' && stateBatch.successCount === 1) {
        resultWriteBlocked = true;
        resultStateWriteStarted.resolve();
        await releaseResultStateWrite.promise;
      }
    }
    return originalPut(key, value, options);
  };

  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, {
    waitUntil: (task) => waitUntilTasks.push(task),
  });
  const reader = response.body.getReader();
  const events = [];
  let batchId = '';

  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const event = await readNextStreamEvent(reader);
      if (!event) break;
      events.push(event);
      if (event.type === 'start') batchId = event.points?.batchId || '';
      if (event.type === 'preview_end') break;
    }
    const resultWriteArrived = await Promise.race([
      resultStateWriteStarted.promise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    assert(resultWriteArrived, 'Result state write should block before the cancellation marker race.');

    const cancelResponsePromise = worker.fetch(
      createJsonRequest('/api/generate/cancel', { batchId }, 'k12_session=session-1'),
      env,
      { waitUntil: () => {} },
    );
    const markerWriteArrived = await Promise.race([
      markerWriteStarted.promise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    assert(markerWriteArrived, 'Cancellation should publish its local signal before the marker write completes.');

    releaseResultStateWrite.resolve();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const event = await readNextStreamEvent(reader);
      if (!event) break;
      events.push(event);
      if (event.type === 'done' || event.type === 'error') break;
    }

    assert(!events.some((event) => event.type === 'result'), 'A local cancellation signal must suppress the late result event.');
    assert(!events.some((event) => event.type === 'done'), 'A blocked cancellation marker must still suppress the done event.');
    assert(
      events.some((event) => event.type === 'error' && String(event.message || '').includes('已取消')),
      'A blocked cancellation marker should terminate the stream with a cancellation error.',
    );

    releaseMarkerWrite.resolve();
    const cancelResponse = await cancelResponsePromise;
    const cancelPayload = await readJson(cancelResponse);
    await Promise.allSettled(waitUntilTasks);
    const storedState = await getStoredState(kv);
    const storedBatch = storedState.generationBatches.find((item) => item.id === batchId);
    assert(cancelResponse.status === 200, 'Blocked marker cancellation should return HTTP 200.');
    assert(storedBatch?.status === 'canceled', 'Blocked marker cancellation must persist the canceled terminal state.');
    assert(cancelPayload.points?.success === 1, 'The already persisted image should remain successful after cancellation.');
  } finally {
    releaseResultStateWrite.resolve();
    releaseMarkerWrite.resolve();
    await reader.cancel().catch(() => {});
    await Promise.allSettled(waitUntilTasks);
  }
}

async function runDoneWritePredicateCancellationSmoke() {
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const waitUntilTasks = [];
  const { env, kv } = createEnv({ points: 1, ruleConfigured: false });
  const originalGet = kv.get.bind(kv);
  let postDoneCancellationReads = 0;
  kv.get = async (key, type = 'text') => {
    if (key.startsWith('generation-cancel:')) {
      const storedState = JSON.parse(String(kv.map.get('app-state')));
      const batch = storedState.generationBatches[0];
      if (batch?.status === 'done') {
        postDoneCancellationReads += 1;
        if (postDoneCancellationReads >= 3) return '1';
      }
    }
    return originalGet(key, type);
  };

  const response = await worker.fetch(createGenerateRequest(createBasePayload()), env, {
    waitUntil: (task) => waitUntilTasks.push(task),
  });
  const events = await readStreamEvents(response);
  await Promise.allSettled(waitUntilTasks);

  assert(postDoneCancellationReads >= 3, 'Cancellation visibility should change while the done event waits in the write queue.');
  assert(!events.some((event) => event.type === 'done'), 'The execution-time predicate must suppress an already queued done event.');
  assert(
    events.some((event) => event.type === 'error' && String(event.message || '').includes('已取消')),
    'A suppressed done event must be replaced with an explicit cancellation error.',
  );
}

async function runCancelAfterOneSuccessRefundsOnlyUnfinishedSmoke() {
  const secondImage = createDeferred();
  let imageCalls = 0;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (!textUrl.endsWith('/images/generations')) {
      throw new Error(`Unexpected mock fetch: ${textUrl}`);
    }
    imageCalls += 1;
    if (imageCalls === 1) {
      return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    await secondImage.promise;
    return new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const waitUntilTasks = [];
  const { env, kv } = createEnv({ points: 3, ruleConfigured: false });
  const response = await worker.fetch(
    createGenerateRequest(
      createBasePayload({
        count: 2,
        batchItems: ['Cancel after success page one', 'Cancel after success page two'],
      }),
    ),
    env,
    { waitUntil: (task) => waitUntilTasks.push(task) },
  );
  const reader = response.body.getReader();
  const startEvent = await readNextStreamEvent(reader);
  const batchId = startEvent?.points?.batchId;
  let firstResult = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const event = await readNextStreamEvent(reader);
    if (event?.type === 'result' && event.result?.index === 0) {
      firstResult = event.result;
      break;
    }
  }

  assert(response.status === 200, 'Cancel after success stream should start with HTTP 200.');
  assert(batchId, 'Cancel after success start event should include batch id.');
  assert(firstResult?.status === 'ok', 'Cancel after success should stream the first successful image before canceling.');

  const cancelResponse = await worker.fetch(
    createJsonRequest('/api/generate/cancel', { batchId }, 'k12_session=session-1'),
    env,
    { waitUntil: () => {} },
  );
  const cancelPayload = await readJson(cancelResponse);
  let storedState = await getStoredState(kv);
  let canceledBatch = storedState.generationBatches.find((batch) => batch.id === batchId);
  let refundLogs = storedState.pointLogs.filter((log) => log.type === 'generation_refund' && log.batchId === batchId);

  assert(cancelResponse.status === 200, 'Cancel after success request should be HTTP 200.');
  assert(cancelPayload.points?.reserved === 2, 'Cancel after success should keep two reserved points in summary.');
  assert(cancelPayload.points?.success === 1, 'Cancel after success should keep the already successful image.');
  assert(cancelPayload.points?.failed === 1, 'Cancel after success should count only one unfinished image.');
  assert(cancelPayload.points?.refunded === 1, 'Cancel after success should refund only the unfinished image.');
  assert(cancelPayload.points?.balance === 2, 'Cancel after success balance should charge one successful image.');
  assert(storedState.users[0].points === 2, 'Cancel after success stored balance should charge one successful image.');
  assert(canceledBatch?.successCount === 1, 'Cancel after success batch should store one success.');
  assert(canceledBatch?.refundedPoints === 1, 'Cancel after success batch should store one refund.');
  assert(refundLogs.length === 1, 'Cancel after success should record one refund log.');
  assert(refundLogs[0].imageIndex === 1, 'Cancel after success refund should target only the unfinished image.');

  secondImage.resolve();
  await reader.cancel().catch(() => {});
  await Promise.allSettled(waitUntilTasks);
  storedState = await getStoredState(kv);
  canceledBatch = storedState.generationBatches.find((batch) => batch.id === batchId);
  refundLogs = storedState.pointLogs.filter((log) => log.type === 'generation_refund' && log.batchId === batchId);

  assert(imageCalls <= 2, 'Cancel after success should not start more than the active concurrency window.');
  assert(storedState.users[0].points === 2, 'Canceled stream must not overwrite the one-success balance later.');
  assert(canceledBatch?.successCount === 1, 'Canceled stream must keep the persisted success later.');
  assert(canceledBatch?.refundedPoints === 1, 'Canceled stream must keep only one refund later.');
  assert(refundLogs.length === 1, 'Canceled stream must not add extra refund logs later.');
}

async function runCancelBeforeReservationSmoke() {
  const clientBatchId = '11111111-1111-4111-8111-111111111111';
  const { env, kv } = createEnv({ points: 3, ruleConfigured: false });

  const cancelResponse = await worker.fetch(
    createJsonRequest('/api/generate/cancel', { batchId: clientBatchId }, 'k12_session=session-1'),
    env,
    { waitUntil: () => {} },
  );
  const cancelPayload = await readJson(cancelResponse);
  assert(cancelResponse.status === 202, '批次预扣前的取消请求应被接受。');
  assert(cancelPayload.pending === true, '预取消请求应为尚未到达的同批次生成保留取消标记。');

  const response = await worker.fetch(
    createGenerateRequest(createBasePayload({ clientBatchId })),
    env,
    { waitUntil: () => {} },
  );
  const events = await readStreamEvents(response);
  const storedState = await getStoredState(kv);

  assert(events.some((event) => event.type === 'error' && String(event.message || '').includes('已取消')), '预取消批次必须在生成开始前终止。');
  assert(storedState.users[0].points === 3, '预取消批次不得扣除任何积分。');
  assert(storedState.generationBatches.length === 0, '预取消批次不得创建生成预扣记录。');
  assert(storedState.pointLogs.length === 0, '预取消批次不得创建积分流水。');
}

async function runAuthAndPointsSmoke() {
  const { env, kv } = createBlankEnv();

  let response = await worker.fetch(
    createJsonRequest('/api/auth/register', { username: 'admin@example.com', password: 'password123' }),
    env,
    { waitUntil: () => {} },
  );
  let payload = await readJson(response);
  const adminCookie = getCookieHeader(response);
  assert(response.status === 200, 'Admin registration should be HTTP 200.');
  assert(payload.user?.role === 'admin', 'First registered account should be admin.');
  assert(adminCookie.startsWith('k12_session='), 'Admin registration should set session cookie.');

  response = await worker.fetch(
    createJsonRequest('/api/admin/points/redeem-codes', { points: 7, count: 1 }, adminCookie),
    env,
    { waitUntil: () => {} },
  );
  payload = await readJson(response);
  assert(response.status === 200, 'Admin should create redeem code.');
  const redeemCode = payload.codes?.[0]?.code;
  assert(redeemCode, 'Redeem code should be returned.');

  response = await worker.fetch(
    createJsonRequest('/api/auth/register', { username: 'teacher@example.com', password: 'password123' }),
    env,
    { waitUntil: () => {} },
  );
  payload = await readJson(response);
  const userCookie = getCookieHeader(response);
  assert(response.status === 200, 'User registration should be HTTP 200.');
  assert(payload.user?.role === 'user', 'Second registered account should be normal user.');

  response = await worker.fetch(createJsonRequest('/api/points/redeem', { code: redeemCode }, userCookie), env, {
    waitUntil: () => {},
  });
  payload = await readJson(response);
  assert(response.status === 200, 'User should redeem points.');
  assert(payload.points === 7, 'User balance should include redeemed points.');

  response = await worker.fetch(createGetRequest('/api/points/logs', userCookie), env, { waitUntil: () => {} });
  payload = await readJson(response);
  assert(response.status === 200, 'User point logs should be readable.');
  assert(payload.logs?.some((log) => log.type === 'redeem' && log.points === 7), 'Redeem log should be recorded.');

  response = await worker.fetch(createGetRequest('/api/admin/points/overview', userCookie), env, { waitUntil: () => {} });
  assert(response.status === 403, 'Normal user must not read admin points overview.');

  response = await worker.fetch(createGetRequest('/api/admin/points/overview', adminCookie), env, { waitUntil: () => {} });
  payload = await readJson(response);
  assert(response.status === 200, 'Admin should read points overview.');
  assert(payload.summary?.userCount === 2, 'Admin overview should include both users.');

  const storedState = JSON.parse(await kv.get('app-state'));
  assert(storedState.redeemCodes[0].status === 'used', 'Redeem code should be marked used.');
}

async function runAiConfigSmoke() {
  const { env, kv } = createBlankEnv();

  let response = await worker.fetch(
    createJsonRequest('/api/auth/register', { username: 'admin@example.com', password: 'password123' }),
    env,
    { waitUntil: () => {} },
  );
  let payload = await readJson(response);
  const adminCookie = getCookieHeader(response);
  assert(response.status === 200, 'AI config admin registration should be HTTP 200.');
  assert(payload.user?.role === 'admin', 'AI config first account should be admin.');

  response = await worker.fetch(
    createJsonRequest('/api/auth/register', { username: 'teacher@example.com', password: 'password123' }),
    env,
    { waitUntil: () => {} },
  );
  const userCookie = getCookieHeader(response);
  assert(response.status === 200, 'AI config normal user registration should be HTTP 200.');

  response = await worker.fetch(createGetRequest('/api/admin/ai-config', userCookie), env, { waitUntil: () => {} });
  assert(response.status === 403, 'Normal user must not read AI config.');

  response = await worker.fetch(createGetRequest('/api/admin/ai-config', adminCookie), env, { waitUntil: () => {} });
  payload = await readJson(response);
  assert(response.status === 200, 'Admin should read AI config.');
  assert(payload.config?.image?.resolution === '4k', 'AI config should default to 4k.');

  const configPayload = {
    rule: {
      entries: [
        {
          baseUrl: 'https://rule.example.com/v1/',
          model: 'rule-model',
          apiKeys: ['r1', 'r1', 'r2'],
        },
      ],
    },
    image: {
      resolution: '4k',
      entries: [
        {
          baseUrl: 'https://image.example.com/v1/',
          model: 'image-model',
          apiKeys: ['i1'],
        },
      ],
    },
  };

  response = await worker.fetch(createPutJsonRequest('/api/admin/ai-config', configPayload, adminCookie), env, {
    waitUntil: () => {},
  });
  payload = await readJson(response);
  assert(response.status === 200, 'Admin should save AI config.');
  assert(payload.config.rule.entries[0].baseUrl === 'https://rule.example.com/v1', 'Rule baseUrl should trim slash.');
  assert(payload.config.rule.entries[0].apiKeys.length === 2, 'Rule API keys should be deduplicated.');
  assert(payload.config.image.entries[0].baseUrl === 'https://image.example.com/v1', 'Image baseUrl should trim slash.');
  assert(payload.config.image.resolution === '4k', 'Image resolution should stay 4k.');

  response = await worker.fetch(createGetRequest('/api/health'), env, { waitUntil: () => {} });
  payload = await readJson(response);
  assert(response.status === 200, 'Health should be readable.');
  assert(payload.configured === true, 'Health should report image configured.');
  assert(payload.ruleConfigured === true, 'Health should report rule configured.');
  assert(payload.imageResolution === '4k', 'Health should report 4k image resolution.');

  response = await worker.fetch(
    createPutJsonRequest('/api/admin/ai-config', {
      rule: { entries: [{ baseUrl: 'notaurl', model: 'rule-model', apiKeys: ['r1'] }] },
      image: configPayload.image,
    }, adminCookie),
    env,
    { waitUntil: () => {} },
  );
  assert(response.status === 400, 'Admin should not save invalid AI config URL.');

  const storedConfig = JSON.parse(await kv.get('ai-config'));
  assert(storedConfig.rule.entries[0].apiKeys.length === 2, 'Stored AI config should keep deduped keys.');
}

await runAiConfigSmoke();
await runAuthAndPointsSmoke();
await runKnowledgeExtractionFailureSmoke();
await runGenerationRuleKnowledgeEvidenceSmoke();
await runGenerationRulePdfImageEvidenceSmoke();
await runKnowledgeBlueprintGroundingSmoke();
await runVerbatimKnowledgeContentPreservationSmoke();
await runNumberedSceneCountFloorSmoke();
await runKnowledgeImageDoesNotBecomeStyleSmoke();
await runReferenceStyleSmoke();
await runTruncatedImageResponseDoesNotRepeatSmoke();
await runStreamingImageGenerationSmoke();
await runStreamingCompletedEventNameSmoke();
await runUntypedSseImageSmoke();
await runPartialOnlyStreamFallbackSmoke();
await runCompletedWithoutImageDoesNotRepeatSmoke();
await runUsablePartialSurvivesStreamErrorSmoke();
await runStreamingErrorDoesNotFallbackSmoke();
await runUnsupportedStreamingFallbackSmoke();
await runUnprocessableStreamingFallbackSmoke();
await runUncertainHttpErrorDoesNotFallbackSmoke();
await runOrphanBatchRecoverySmoke();
await runFourKUnknownOutcomeDoesNotRepeatSmoke();
await runStandardSizeUnknownOutcomeDoesNotRepeatSmoke();
await runImageKeyCountDoesNotExpandAttemptBudgetSmoke();
await runImageFailureDiagnosticsSmoke();
await runNestedImagePayloadSmoke();
await runGeneratedImageUrlDownloadSmoke();
await runConcurrentBatchGenerationSmoke();
await runSlowClientBackpressureBoundsArtifactSmoke();
await runPersistenceFailureDoesNotRepeatModelSmoke();
await runNetworkFailureDoesNotRepeatModelSmoke();
await runSuccessResultPersistsBeforeFinalSettlementSmoke();
await runPartialFailureRefundSmoke();
await runRetryFailureRefundSmoke();
await runCancelRefundSmoke();
await runDoneWritePredicateCancellationSmoke();
await runCancelAfterOneSuccessRefundsOnlyUnfinishedSmoke();
await runCancelBeforeReservationSmoke();

clearTimeout(smokeWatchdog);
console.log('Worker smoke tests passed.');

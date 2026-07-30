const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
process.env.CONTINUATION_GRANT_SECRET = 'test-continuation-secret-at-least-32-bytes';
const { computeAtomicPageSlices } = require('../shared/pdf-pagination');
const { renderItemsByKey } = require('../shared/export-rendering');
const { buildContinuationAppendPlan } = require('../shared/exam-continuation');
const { normalizeContinuationRequest } = require('../shared/exam-paper-config');
const {
  issuePaperContinuationGrant,
  verifyPaperContinuationGrant
} = require('../server/middleware/security');

test('PDF 分页在题目或答案原子块前整体换页且切片连续', () => {
  const atomicRanges = [
    { top: 300, bottom: 520, label: '题组标题与首题' },
    { top: 350, bottom: 520, label: '题目' },
    { top: 720, bottom: 860, label: '答案解析' }
  ];
  const slices = computeAtomicPageSlices({
    canvasHeight: 1000,
    contentHeight: 1000,
    pagePixelHeight: 400,
    atomicRanges
  });
  assert.deepEqual(slices, [[0, 300], [300, 700], [700, 1000]]);
  assert.equal(slices[0][0], 0);
  assert.equal(slices.at(-1)[1], 1000);
  slices.slice(0, -1).forEach((slice, index) => assert.equal(slice[1], slices[index + 1][0]));
  for (const [, boundary] of slices.slice(0, -1)) {
    assert.equal(atomicRanges.some((range) => range.top < boundary && boundary < range.bottom), false);
  }
});

test('PDF 拒绝切割超过一整页的单个内容块', () => {
  assert.throws(
    () => computeAtomicPageSlices({
      canvasHeight: 1200,
      contentHeight: 1200,
      pagePixelHeight: 400,
      atomicRanges: [{ top: 100, bottom: 520, label: '超长题目' }]
    }),
    (error) => error.code === 'PDF_ATOMIC_BLOCK_TOO_TALL' && /无法在不切割内容/.test(error.message)
  );
});

test('PDF 允许超长父题按题干、选项和题图等语义子块安全分页', () => {
  const semanticRanges = [
    { top: 100, bottom: 250, label: '题干' },
    { top: 260, bottom: 390, label: '选项' },
    { top: 400, bottom: 550, label: '独立公式' },
    { top: 560, bottom: 690, label: '题图' },
    { top: 760, bottom: 890, label: '答案解析步骤' }
  ];
  const slices = computeAtomicPageSlices({
    canvasHeight: 900,
    contentHeight: 900,
    pagePixelHeight: 400,
    atomicRanges: semanticRanges
  });
  assert.deepEqual(slices, [[0, 400], [400, 760], [760, 900]]);
  for (const [, boundary] of slices.slice(0, -1)) {
    assert.equal(semanticRanges.some((range) => range.top < boundary && boundary < range.bottom), false);
  }
});

test('PDF 分页只覆盖有效正文，物理画布尾部留白不得生成空白页', () => {
  assert.deepEqual(
    computeAtomicPageSlices({
      canvasHeight: 2246,
      contentHeight: 1200,
      pagePixelHeight: 2095,
      atomicRanges: [{ top: 80, bottom: 1180, label: '短卷正文' }]
    }),
    [[0, 1200]]
  );
  assert.deepEqual(
    computeAtomicPageSlices({
      canvasHeight: 4200,
      contentHeight: 4170,
      pagePixelHeight: 2095,
      atomicRanges: []
    }),
    [[0, 2095], [2095, 4170]]
  );
});

test('PDF 有效正文位于分页边界前后时不得吞页或追加结构性空白页', () => {
  const slicesAt = (contentHeight) => computeAtomicPageSlices({
    canvasHeight: 4200,
    contentHeight,
    pagePixelHeight: 2095,
    atomicRanges: []
  });
  assert.deepEqual(slicesAt(2094), [[0, 2094]]);
  assert.deepEqual(slicesAt(2095), [[0, 2095]]);
  assert.deepEqual(slicesAt(2096), [[0, 2095], [2095, 2096]]);
  assert.throws(
    () => computeAtomicPageSlices({
      canvasHeight: 1000,
      contentHeight: 1002,
      pagePixelHeight: 400,
      atomicRanges: []
    }),
    /有效内容高度超过画布范围/
  );
});

test('Word 高清渲染按内容去重、限制并发并复用缓存', async () => {
  const items = [
    { id: 1, formula: 'x' },
    { id: 2, formula: 'y' },
    { id: 3, formula: 'x' },
    { id: 4, formula: 'z' }
  ];
  const cache = new Map();
  let renderCount = 0;
  let active = 0;
  let maxActive = 0;
  const render = async (item) => {
    renderCount += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { dataUrl: `data:image/png;base64,${item.formula}`, widthPx: 20, heightPx: 10 };
  };
  const options = { keyOf: (item) => item.formula, render, cache, concurrency: 2 };
  const first = await renderItemsByKey(items, options);
  assert.equal(first.size, 4);
  assert.equal(renderCount, 3);
  assert.ok(maxActive <= 2);
  assert.equal(first.get(items[0]), first.get(items[2]));

  const second = await renderItemsByKey(items, options);
  assert.equal(second.size, 4);
  assert.equal(renderCount, 3, '第二次导出必须全部命中已经过质量检查的缓存');
});

test('单次 Word 导出结果超过全局 LRU 容量时仍完整保留', async () => {
  const items = Array.from({ length: 205 }, (_, index) => ({ key: `formula-${index}` }));
  const cache = new Map();
  const result = await renderItemsByKey(items, {
    keyOf: (item) => item.key,
    render: async (item) => ({ dataUrl: `data:image/png;base64,${item.key}`, widthPx: 20, heightPx: 10 }),
    cache,
    concurrency: 3,
    maxCacheEntries: 16
  });
  assert.equal(result.size, 205);
  assert.equal(cache.size, 16, '跨导出缓存仍应遵守容量上限');
  items.forEach((item) => assert.equal(result.get(item).dataUrl.endsWith(item.key), true));
});

test('继续生成请求只接受单知识点、单考点、单题型与固定3题', () => {
  const request = {
    grade: '小学六年级',
    subject: '数学',
    topic: '负数',
    examPoint: '负数的意义',
    questionType: 'choice',
    difficulty: 5,
    count: 3,
    continuationToken: 'a'.repeat(43)
  };
  const valid = normalizeContinuationRequest(request);
  assert.deepEqual(valid.job, {
    topic: '负数',
    examPoint: '负数的意义',
    questionType: 'choice',
    difficulty: 5,
    questionCount: 3
  });
  assert.throws(() => normalizeContinuationRequest({ ...request, count: 2 }), /必须固定为 3 题/);
  assert.throws(() => normalizeContinuationRequest({ ...request, grade: '六年级', examPoint: '意义', count: '3' }), /必须固定为 3 题/);
  assert.throws(() => normalizeContinuationRequest({
    grade: '六年级', subject: '数学', topic: '负数', examPoint: '意义', questionType: 'choice', difficulty: 5, count: 3,
    topicConfigs: [{ topic: '负数' }, { topic: '比例' }]
  }), /一次只能指定一个知识点/);
  assert.throws(() => normalizeContinuationRequest({ ...request, topicConfigs: {} }), /一次只能指定一个知识点/);
  assert.throws(() => normalizeContinuationRequest({ ...request, continuationToken: '' }), /组卷会话凭证不能为空/);
  assert.throws(() => normalizeContinuationRequest({ ...request, continuationToken: 'too-short' }), /凭证格式无效/);
});

test('签名续题凭证支持连续追加、跨进程会话恢复且拒绝篡改', () => {
  const session = { id: 'session-a', lastSeenAt: Date.now(), trialCredits: 0 };
  const token = issuePaperContinuationGrant(session);
  assert.equal(verifyPaperContinuationGrant(session, token), true);
  assert.equal(verifyPaperContinuationGrant(session, token), true, '第二次追加不得重复消耗体验额度或凭证');
  assert.equal(verifyPaperContinuationGrant(session, `${token.slice(0, -1)}x`), false);
  assert.equal(
    verifyPaperContinuationGrant({ id: 'session-after-restart' }, token),
    true,
    '服务重启后的新内存会话必须仍能验证原试卷签名凭证'
  );
  assert.equal(session.trialCredits, 0);
});

test('续题凭证不依赖模块内存且过期后必须失效', () => {
  const securityPath = require.resolve('../server/middleware/security');
  const originalNow = Date.now;
  const originalModule = require.cache[securityPath];
  let now = 2_000_000_000_000;
  Date.now = () => now;
  try {
    const token = issuePaperContinuationGrant({ id: 'before-restart', lastSeenAt: now });
    delete require.cache[securityPath];
    const restartedSecurity = require(securityPath);
    assert.equal(
      restartedSecurity.verifyPaperContinuationGrant({ id: 'after-restart' }, token),
      true,
      '清空模块缓存模拟进程重启后仍必须通过'
    );
    now += 2 * 60 * 60 * 1000 + 1;
    assert.equal(restartedSecurity.verifyPaperContinuationGrant({ id: 'after-restart' }, token), false);
  } finally {
    Date.now = originalNow;
    if (originalModule) require.cache[securityPath] = originalModule;
    else delete require.cache[securityPath];
  }
});

test('同一时刻签发的多个续题凭证互不失效以支持并发题组', () => {
  const session = { id: 'parallel-session', lastSeenAt: Date.now() };
  const first = issuePaperContinuationGrant(session);
  const second = issuePaperContinuationGrant(session);
  assert.notEqual(first, second);
  assert.equal(verifyPaperContinuationGrant(session, first), true);
  assert.equal(verifyPaperContinuationGrant(session, second), true);
});

test('续题凭证拒绝密钥轮换后的旧签名和所有畸形结构', () => {
  const originalSecret = process.env.CONTINUATION_GRANT_SECRET;
  const session = { id: 'secret-rotation-session', lastSeenAt: Date.now() };
  const token = issuePaperContinuationGrant(session);
  try {
    process.env.CONTINUATION_GRANT_SECRET = 'rotated-continuation-secret-at-least-32-bytes';
    assert.equal(verifyPaperContinuationGrant(session, token), false);
    for (const malformed of [
      '',
      'x'.repeat(31),
      'cg1.invalid.nonce.signature',
      token.replace(/^cg1\./, 'cg2.'),
      `${token}.extra`
    ]) {
      assert.equal(verifyPaperContinuationGrant(session, malformed), false, malformed);
    }
  } finally {
    process.env.CONTINUATION_GRANT_SECRET = originalSecret;
  }
});

test('真实 Node 路由初始组卷后可连续追加两次且只扣一次体验额度', async (t) => {
  const servicesPath = require.resolve('../server/services/ai');
  const routePath = require.resolve('../server/routes/exam');
  const originalServices = require(servicesPath);
  require.cache[servicesPath].exports = {
    ...originalServices,
    generateExam: async ({ questionCount }) => ({
      questions: [{
        items: Array.from({ length: questionCount }, (_, index) => ({
          stem: `概括材料所反映的历史特征（${index + 1}）。`,
          options: null,
          answer: `特征${index + 1}`,
          explanation: `依据材料第${index + 1}层信息归纳。`,
          figure: null
        }))
      }]
    })
  };
  delete require.cache[routePath];

  const session = { id: 'integration-session', lastSeenAt: Date.now(), trialCredits: 3, tokens: new Map() };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.securitySession = session;
    next();
  });
  app.use('/api/exam', require(routePath));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    require.cache[servicesPath].exports = originalServices;
    delete require.cache[routePath];
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/exam`;
  const generateResponse = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grade: '高中一年级',
      subject: '历史',
      topicConfigs: [{
        topic: '近代中国',
        examPoints: [{
          name: '社会转型',
          questionCount: 1,
          difficulty: 5,
          questionTypeCounts: { calculation: 1 }
        }]
      }]
    })
  });
  assert.equal(generateResponse.status, 200);
  const generated = await generateResponse.json();
  assert.equal(generated.trialCreditsRemaining, 2);
  assert.match(generated.continuationToken, /^cg1\.[0-9a-z]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);

  const continuationBody = {
    grade: '高中一年级',
    subject: '历史',
    topic: '近代中国',
    examPoint: '社会转型',
    questionType: 'calculation',
    difficulty: 5,
    count: 3,
    continuationToken: generated.continuationToken
  };
  let activeContinuationToken = generated.continuationToken;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetch(`${baseUrl}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...continuationBody, continuationToken: activeContinuationToken })
    });
    assert.equal(response.status, 200, `第 ${attempt} 次追加必须成功`);
    const payload = await response.json();
    assert.equal(payload.questions[0].items.length, 3);
    assert.equal(payload.trialCreditsRemaining, 2);
    assert.match(payload.continuationToken, /^[A-Za-z0-9_.-]{32,128}$/);
    assert.notEqual(payload.continuationToken, activeContinuationToken, '每次成功追加后必须续签有效期');
    activeContinuationToken = payload.continuationToken;
  }

  const forgedResponse = await fetch(`${baseUrl}/continue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...continuationBody, continuationToken: 'z'.repeat(43) })
  });
  assert.equal(forgedResponse.status, 403);
  assert.equal((await forgedResponse.json()).code, 'CONTINUATION_GRANT_INVALID');
  assert.equal(session.trialCredits, 2);
});

test('真实 Node 路由在安全模块和会话完全重建后仍可继续追加', async () => {
  const servicesPath = require.resolve('../server/services/ai');
  const securityPath = require.resolve('../server/middleware/security');
  const routePath = require.resolve('../server/routes/exam');
  const originalServices = require.cache[servicesPath];
  const originalSecurity = require.cache[securityPath];
  const originalRoute = require.cache[routePath];
  const originalServiceExports = require(servicesPath);
  require.cache[servicesPath].exports = {
    ...originalServiceExports,
    generateExam: async ({ questionCount }) => ({
      questions: [{
        items: Array.from({ length: questionCount }, (_, index) => ({
          stem: `重启恢复题${index + 1}。`,
          options: null,
          answer: `答案${index + 1}`,
          explanation: `重启恢复解析${index + 1}。`,
          figure: null
        }))
      }]
    })
  };

  const activeServers = [];
  const startServer = async (session) => {
    delete require.cache[securityPath];
    delete require.cache[routePath];
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.securitySession = session;
      next();
    });
    app.use('/api/exam', require(routePath));
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    activeServers.push(server);
    return server;
  };
  const closeServer = async (server) => {
    if (!server?.listening) return;
    await new Promise((resolve) => server.close(resolve));
  };

  try {
    const firstSession = { id: 'process-before-restart', lastSeenAt: Date.now(), trialCredits: 3, tokens: new Map() };
    const firstServer = await startServer(firstSession);
    const firstBaseUrl = `http://127.0.0.1:${firstServer.address().port}/api/exam`;
    const generatedResponse = await fetch(`${firstBaseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '初中一年级',
        subject: '数学',
        topicConfigs: [{
          topic: '相交线与平行线',
          examPoints: [{
            name: '几何图形基本概念',
            questionCount: 1,
            difficulty: 5,
            questionTypeCounts: { calculation: 1 }
          }]
        }]
      })
    });
    assert.equal(generatedResponse.status, 200);
    const generated = await generatedResponse.json();
    assert.equal(firstSession.trialCredits, 2);
    await closeServer(firstServer);

    const restartedSession = { id: 'process-after-restart', lastSeenAt: Date.now(), trialCredits: 3, tokens: new Map() };
    const restartedServer = await startServer(restartedSession);
    const restartedBaseUrl = `http://127.0.0.1:${restartedServer.address().port}/api/exam`;
    const continuationBody = {
      grade: '初中一年级',
      subject: '数学',
      topic: '相交线与平行线',
      examPoint: '几何图形基本概念',
      questionType: 'calculation',
      difficulty: 5,
      count: 3,
      continuationToken: generated.continuationToken
    };
    const continuedResponse = await fetch(`${restartedBaseUrl}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(continuationBody)
    });
    assert.equal(continuedResponse.status, 200, '服务进程与内存会话全部重建后追加仍必须成功');
    const continued = await continuedResponse.json();
    assert.equal(continued.questions[0].items.length, 3);
    assert.match(continued.continuationToken, /^cg1\./);
    assert.notEqual(continued.continuationToken, generated.continuationToken);
    assert.equal(restartedSession.trialCredits, 3, '续题不得在新进程中误扣体验次数');

    const tamperedResponse = await fetch(`${restartedBaseUrl}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...continuationBody,
        continuationToken: `${generated.continuationToken.slice(0, -1)}x`
      })
    });
    assert.equal(tamperedResponse.status, 403);
    assert.equal((await tamperedResponse.json()).code, 'CONTINUATION_GRANT_INVALID');
  } finally {
    await Promise.all(activeServers.map(closeServer));
    require.cache[servicesPath].exports = originalServiceExports;
    if (originalSecurity) require.cache[securityPath] = originalSecurity;
    else delete require.cache[securityPath];
    if (originalRoute) require.cache[routePath] = originalRoute;
    else delete require.cache[routePath];
    if (originalServices) require.cache[servicesPath] = originalServices;
  }
});

test('继续生成响应在写入前完成来源、数量、答案与编号校验', () => {
  const source = { topic: '函数', examPoint: '单调性', difficulty: 6, questionType: 'fill' };
  const response = {
    questions: [{
      type: 'fill',
      source,
      items: [1, 2, 3].map((index) => ({ stem: `题${index}`, source }))
    }],
    answers: ['1. 答案甲', '2. 答案乙', '3. 答案丙']
  };
  const plan = buildContinuationAppendPlan(response, source, 8);
  assert.deepEqual(plan.items.map((item) => item.index), [9, 10, 11]);
  assert.deepEqual(plan.answers, ['9. 答案甲', '10. 答案乙', '11. 答案丙']);

  const adversarial = structuredClone(response);
  adversarial.questions[0].items[1].source = { ...source, examPoint: '被替换的考点' };
  assert.throws(() => buildContinuationAppendPlan(adversarial, source, 8), /题目与当前题组来源不一致/);
  assert.throws(
    () => buildContinuationAppendPlan({ ...response, answers: response.answers.slice(0, 2) }, source, 8),
    /完整返回 3 条答案解析/
  );
});

test('两个题组按相反完成顺序提交时题号仍连续且不重复', () => {
  const sourceA = { topic: '函数', examPoint: '单调性', difficulty: 6, questionType: 'fill' };
  const sourceB = { topic: '立体几何', examPoint: '体积', difficulty: 5, questionType: 'calculation' };
  const responseOf = (source, prefix) => ({
    questions: [{ type: source.questionType, source, items: [1, 2, 3].map((index) => ({
      stem: `${prefix}${index}`,
      answer: `${index}`,
      explanation: `解析${index}`,
      source
    })) }],
    answers: [1, 2, 3].map((index) => `${index}. 答案${index}`)
  });
  let total = 5;
  const laterStartedButFirstFinished = buildContinuationAppendPlan(responseOf(sourceB, 'B'), sourceB, total);
  total += laterStartedButFirstFinished.items.length;
  const firstStartedButLaterFinished = buildContinuationAppendPlan(responseOf(sourceA, 'A'), sourceA, total);
  const indexes = [...laterStartedButFirstFinished.items, ...firstStartedButLaterFinished.items].map((item) => item.index);
  assert.deepEqual(indexes, [6, 7, 8, 9, 10, 11]);
  assert.equal(new Set(indexes).size, indexes.length);
});

test('Node、Worker、前端与样式保持继续生成、PDF 和 Word 契约对称', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
  const appEntry = fs.readFileSync(path.join(root, 'src/app-entry.js'), 'utf8');
  const wordBuilder = fs.readFileSync(path.join(root, 'src/word-docx-export.js'), 'utf8');
  const nodeRoute = fs.readFileSync(path.join(root, 'server/routes/exam.js'), 'utf8');
  const workerRoute = fs.readFileSync(path.join(root, 'worker/routes/exam.js'), 'utf8');
  const nodeSecurity = fs.readFileSync(path.join(root, 'server/middleware/security.js'), 'utf8');
  const workerSecurity = fs.readFileSync(path.join(root, 'worker/middleware/security.js'), 'utf8');

  assert.match(nodeRoute, /router\.post\('\/continue'/);
  assert.match(workerRoute, /app\.post\('\/continue'/);
  assert.match(nodeRoute, /normalizeContinuationRequest/);
  assert.match(workerRoute, /normalizeContinuationRequest/);
  assert.match(main, /\/exam\/continue/);
  assert.match(main, /continue-generate-btn/);

  assert.match(main, /paper\.style\.boxSizing = 'border-box'/);
  assert.match(main, /paper\.style\.padding = '10mm 16mm'/);
  assert.match(main, /const pageVerticalMargin = 10/);
  assert.match(main, /const contentPixelHeight = Math\.max/);
  assert.match(main, /computeAtomicPageSlices\(\{[\s\S]*?contentHeight: contentPixelHeight/);
  assert.match(main, /stripeStart < regionEnd[\s\S]*?sourceContext\.getImageData/);
  assert.match(main, /loadingTitle\.textContent = '正在导出 PDF'/);
  assert.match(main, /progressWrap\.style\.display = 'none'/);
  assert.match(css, /\.a4-paper \.answer-step[\s\S]*?break-inside: avoid-page/);
  assert.doesNotMatch(css, /\.a4-paper \.answer-item\s*(?:,|\{)/);
  assert.match(main, /\.question-item > \*/);
  assert.match(main, /\.answer-item > \*/);
  assert.match(main, /rect\.height \* scale \+ safetyGap \* 2 <= pagePixelHeight \+ 1/);
  assert.match(main, /addEntry\(question, '完整题目'\)/);
  assert.match(main, /addEntry\(answer, '完整答案解析'\)/);
  const pdfSaver = main.match(/function saveCanvasAsPaginatedPdf[\s\S]*?\n}\n/)?.[0] || '';
  assert.match(pdfSaver, /await buildLosslessPdfImageRecord\(canvas\)/);
  assert.match(pdfSaver, /saveGraphicsState\(\)[\s\S]*?\.rect\([^\n]+, null\)\.clip\(\)\.discardPath\(\)[\s\S]*?restoreGraphicsState\(\)/);
  assert.match(pdfSaver, /CYBEREXAMRGB/);
  assert.doesNotMatch(pdfSaver, /toDataURL|slice = document\.createElement/);
  assert.match(main, /Promise\.all\(figureSvgs\.map/);
  assert.match(main, /querySelectorAll\('\.katex-mathml'\)/);

  assert.match(main, /buildEditableWordDocx/);
  assert.match(main, /assertWordDocxParts/);
  assert.match(main, /renderItemsByKey\(figureContainers/);
  assert.match(wordBuilder, /mml2omml\(mathml\)/);
  assert.match(wordBuilder, /assertWordFormulaOmmlSourceFree\(omml\)/);
  assert.doesNotMatch(main, /renderWordFormula|application\/msword|\.doc`/);
  assert.match(appEntry, /import html2canvas from 'html2canvas'/);
  assert.match(appEntry, /import \{ jsPDF \} from 'jspdf'/);
  assert.doesNotMatch(main, /cdnjs\.cloudflare\.com|loadScript\(/);
  const appendFunction = main.match(/async function appendContinuationResult[\s\S]*?\n}\n\nasync function continueGenerateForGroup/)?.[0] || '';
  assert.ok(appendFunction.indexOf('buildContinuationAppendPlan') < appendFunction.indexOf('itemContainer.appendChild'));
  assert.ok(appendFunction.indexOf('await renderContinuationFigures') < appendFunction.indexOf('const firstIndex = state.generatedQuestions.length'));
  assert.ok(appendFunction.indexOf('const firstIndex = state.generatedQuestions.length') < appendFunction.indexOf('state.generatedQuestions.push'));
  assert.doesNotMatch(appendFunction, /activeFigureLoadToken|loadFiguresAsync|pendingFigures/);
  assert.match(main, /state\.continuingGroupIds\.has\(button\.dataset\.groupId\)/);
  assert.match(main, /state\.continuingGroupIds\.has\(groupId\)/);
  assert.doesNotMatch(main, /continuationInProgress/);
  const continueFunction = main.match(/async function continueGenerateForGroup[\s\S]*?function buildFigureRequestPayload/)?.[0] || '';
  assert.match(continueFunction, /continuationToken: state\.continuationToken/);
  assert.match(continueFunction, /state\.continuationToken = data\.continuationToken/);
  assert.doesNotMatch(continueFunction, /consumeUnifiedCredit/);
  assert.match(nodeRoute, /merged\.continuationToken = issuePaperContinuationGrant\(session\)/);
  assert.match(workerRoute, /merged\.continuationToken = await issuePaperContinuationGrant\(session, c\.env\)/);
  assert.match(workerRoute, /await verifyPaperContinuationGrant\(session, request\.continuationToken, c\.env\)/);
  assert.match(nodeSecurity, /function issuePaperContinuationGrant/);
  assert.match(workerSecurity, /export async function issuePaperContinuationGrant/);
  const workerRequestVerifier = workerSecurity.match(/async function verifySignedToken[\s\S]*?\n}\n/)?.[0] || '';
  const workerContinuationVerifier = workerSecurity.match(/export async function verifyPaperContinuationGrant[\s\S]*?\n}\n/)?.[0] || '';
  assert.match(workerRequestVerifier, /getSigningKey\(env\)/);
  assert.doesNotMatch(workerRequestVerifier, /getContinuationSigningKey\(env\)/);
  assert.match(workerContinuationVerifier, /getContinuationSigningKey\(env\)/);
});

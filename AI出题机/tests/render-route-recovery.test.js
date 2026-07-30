const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const aiModulePath = path.join(projectRoot, 'server', 'services', 'ai.js');
const renderRoutePath = path.join(projectRoot, 'server', 'routes', 'render.js');
const aiModule = require(aiModulePath);

const validSvg = (label = 'A') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><line x1="30" y1="250" x2="370" y2="30"/><text x="200" y="140">${label}</text></svg>`;

function createServer(generateContent) {
  const originalGenerateContent = aiModule.generateContent;
  aiModule.generateContent = generateContent;
  delete require.cache[require.resolve(renderRoutePath)];
  const router = require(renderRoutePath);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/render', router);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: async () => {
          await new Promise((done) => server.close(done));
          aiModule.generateContent = originalGenerateContent;
          delete require.cache[require.resolve(renderRoutePath)];
        }
      });
    });
  });
}

async function post(baseUrl, endpoint, body) {
  const response = await fetch(`${baseUrl}/api/render/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

test('首轮 XML 实体非法时只重试生成，不缓存坏 SVG', async () => {
  let calls = 0;
  const fixture = await createServer(async (_system, _user, options) => {
    calls += 1;
    assert.equal(options.includeMetadata, true);
    if (calls === 1) {
      return {
        content: '<svg><rect width="100" height="100"/><text>&nbsp;</text></svg>',
        finishReason: 'stop'
      };
    }
    return { content: validSvg('恢复成功'), finishReason: 'stop' };
  });

  try {
    const result = await post(fixture.baseUrl, 'figure', {
      subject: '数学',
      figureType: 'coordinate',
      stem: '绘制坐标关系',
      description: '绘制坐标轴和一条直线'
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.attempts, 2);
    assert.equal(calls, 2);
    assert.match(result.data.svg, /恢复成功/);
  } finally {
    await fixture.close();
  }
});

test('forceRegenerate 绕过已验证缓存并用新合格 SVG 覆盖', async () => {
  let calls = 0;
  const fixture = await createServer(async () => {
    calls += 1;
    return { content: validSvg(`版本${calls}`), finishReason: 'stop' };
  });
  const payload = {
    subject: '物理',
    figureType: 'force',
    stem: '绘制受力关系',
    description: '绘制物体和受力箭头'
  };

  try {
    const first = await post(fixture.baseUrl, 'figure', payload);
    const cached = await post(fixture.baseUrl, 'figure', payload);
    const regenerated = await post(fixture.baseUrl, 'figure', { ...payload, forceRegenerate: true });
    assert.equal(first.data.cached, false);
    assert.equal(cached.data.cached, true);
    assert.equal(regenerated.data.cached, false);
    assert.equal(calls, 2);
    assert.match(regenerated.data.svg, /版本2/);
  } finally {
    await fixture.close();
  }
});

test('批量图形逐题串行调用模型并保留每题结果', async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const fixture = await createServer(async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return { content: validSvg(`题${calls}`), finishReason: 'stop' };
  });

  try {
    const figures = [1, 2, 3].map((id) => ({
      id: `figure-${id}`,
      subject: '地理',
      figureType: 'diagram',
      stem: `题${id}`,
      description: `绘制第${id}幅关系图`
    }));
    const result = await post(fixture.baseUrl, 'figures-batch', { figures });
    assert.equal(result.status, 200);
    assert.equal(result.data.results.length, 3);
    assert.equal(result.data.results.every((item) => item.svg && !item.error), true);
    assert.equal(calls, 3);
    assert.equal(maxActive, 1);
  } finally {
    await fixture.close();
  }
});

test('连续质量失败返回机器可读失败码且绝不返回占位 SVG', async () => {
  const fixture = await createServer(async () => ({
    content: '<svg><rect width="100" height="100"/><text>&deg;</text></svg>',
    finishReason: 'stop'
  }));

  try {
    const result = await post(fixture.baseUrl, 'figures-batch', {
      figures: [{
        id: 'bad-figure',
        subject: '化学',
        figureType: 'diagram',
        stem: '实验装置',
        description: '绘制实验装置和温度标注'
      }]
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.results[0].svg, null);
    assert.equal(result.data.results[0].code, 'XML_INVALID_ENTITY');
    assert.equal(result.data.results[0].retryable, true);
    assert.equal(result.data.results[0].attempts, 3);
  } finally {
    await fixture.close();
  }
});

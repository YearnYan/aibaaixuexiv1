import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // 服务子进程尚未完成监听，继续轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('测试服务启动超时');
}

test('AI 优化接口允许全局重构模块、排版和图示', { timeout: 15000 }, async (context) => {
  const optimizedPlan = {
    optimizationSummary: '已删除固定模块，新增实验记录与结论模块，并改为蓝色双栏排版。',
    documentVersion: 3,
    title: '浮力实验探究教案',
    cover: {
      kicker: '八年级物理实验课',
      title: '浮力实验探究教案',
      subtitle: '观察 · 测量 · 解释',
      meta: [{ label: '课时', value: '第1课时 · 45分钟' }]
    },
    appearance: { theme: 'blue', density: 'compact', pageLayout: 'two-column' },
    sections: [
      {
        id: 'experiment-record',
        title: '实验探究记录',
        layout: 'two-column',
        blocks: [
          { type: 'paragraph', text: '比较物体浸入前后的测力计示数。', variant: 'lead', align: 'left' },
          { type: 'table', headers: ['状态', '示数'], rows: [['空气中', '5 N'], ['水中', '3 N']] }
        ]
      },
      {
        id: 'evidence-conclusion',
        title: '证据与结论',
        layout: 'blackboard',
        blocks: [
          { type: 'paragraph', text: '\\(F_{\\text{浮}}=G-F_{\\text{示}}\\)', align: 'center' },
          { type: 'svg', content: '<svg viewBox="0 0 120 60"><title>浮力方向图</title><line x1="60" y1="50" x2="60" y2="10" stroke="#173f34"/><text x="65" y="18">F浮</text></svg>', caption: '浮力方向竖直向上' }
        ]
      }
    ],
    footer: { brand: '物理实验教研组', note: '请结合器材量程调整数据。' }
  };
  let modelPrompt = '';
  const mockModel = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body);
      modelPrompt = payload.messages?.[1]?.content || '';
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(optimizedPlan) } }] }));
    });
  });
  const mockPort = await listen(mockModel);
  context.after(() => close(mockModel));

  const probe = http.createServer();
  const appPort = await listen(probe);
  await close(probe);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(appPort), HOST: '127.0.0.1' },
    stdio: 'ignore'
  });
  context.after(() => child.kill());
  await waitForServer(`http://127.0.0.1:${appPort}`);

  const response = await fetch(`http://127.0.0.1:${appPort}/api/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form: { grade: '八年级', subject: '物理', lesson: '浮力', duration: 45 },
      plan: { title: '原教案', flow: [{ name: '原教学环节', time: 45 }] },
      messages: [{ role: 'user', content: '删除原来的所有固定模块，只保留实验记录和证据结论，改成蓝色双栏，并增加浮力方向图。' }],
      config: { baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: 'test-key', model: 'mock-model' }
    })
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.source, 'ai');
  assert.equal(result.message, optimizedPlan.optimizationSummary);
  assert.equal(result.plan.documentVersion, 3);
  assert.equal(result.plan.title, optimizedPlan.title);
  assert.equal(result.plan.appearance.theme, 'blue');
  assert.equal(result.plan.appearance.pageLayout, 'two-column');
  assert.deepEqual(result.plan.sections.map((section) => section.title), ['实验探究记录', '证据与结论']);
  assert.equal(result.plan.sections[1].blocks[1].type, 'svg');
  assert.equal('flow' in result.plan, false);
  assert.match(modelPrompt, /13 个模块只是初始模板，不是固定结构/);
  assert.match(modelPrompt, /当前完整动态教案/);
  assert.match(modelPrompt, /原教学环节/);
  assert.match(modelPrompt, /图、图片、图示、示意图、结构图、流程图、关系图、概念图、思维导图、板书图、配图/);
  assert.match(modelPrompt, /一律理解为安全自包含 SVG/);
  assert.match(modelPrompt, /明确要求照片、真实图片、插画、PNG、JPG、JPEG、位图、网络图片或图片地址/);
  assert.match(modelPrompt, /SVG 的 text\/tspan 中只能写浏览器可直接显示的教材规范普通文本或 Unicode 符号/);
  assert.match(modelPrompt, /严禁在 SVG 文字节点中写/);
  assert.match(modelPrompt, /外层已经提供完整黑板背景和边框/);
  assert.match(modelPrompt, /禁止绘制覆盖整画布的背景矩形、整幅外边框、重复黑板、灰色底框/);
});

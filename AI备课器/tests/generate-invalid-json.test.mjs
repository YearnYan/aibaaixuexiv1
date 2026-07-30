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
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 服务子进程尚未完成监听，继续轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('测试服务启动超时');
}

test('生成接口可以修复模型返回的非法转义 JSON', { timeout: 15000 }, async (context) => {
  const invalidPlan = String.raw`{
    "title":"非法转义修复测试",
    "learningAnalysis":"学生已经具备基础知识。",
    "goals":["能完成测试任务"],
    "focus":"重点：验证结构化输出。\n难点：修复非法转义。",
    "flow":[{
      "name":"测试环节",
      "taskGoal":"完成结构化任务",
      "context":"用\(x+y\)表示关系",
      "teacherAction":"发布任务",
      "studentAction":"完成任务",
      "learningProduct":"一份答案",
      "scaffold":"提供示例",
      "design":"验证修复能力",
      "evaluation":"检查答案",
      "time":45,
      "tone":"blue",
    }],
  }`;

  const mockModel = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ choices: [{ message: { content: invalidPlan } }] }));
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

  const response = await fetch(`http://127.0.0.1:${appPort}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form: { lesson: '测试课', duration: 45 },
      files: [],
      config: { baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: 'test-key', model: 'mock-model' }
    })
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.source, 'ai');
  assert.equal(result.plan.title, '非法转义修复测试');
  assert.equal(result.plan.flow[0].context, String.raw`用\(x+y\)表示关系`);
  assert.equal(result.plan.flow.reduce((sum, row) => sum + row.time, 0), 45);
});

test('生成接口会读取模型 plan 包装中的真实教案', { timeout: 15000 }, async (context) => {
  const wrappedPlan = {
    plan: {
      title: '《一次函数》第1课时备课方案',
      learningAnalysis: '学生已掌握正比例函数，需要辨析斜率与截距。',
      goals: ['能识别一次函数解析式并说明各参数意义。'],
      flow: [{
        name: '函数辨析',
        taskGoal: '辨析一次函数与正比例函数。',
        context: '比较两组真实数据的变化规律。',
        teacherAction: '组织学生比较解析式。',
        studentAction: '分类并说明判断依据。',
        learningProduct: '一份函数分类表。',
        scaffold: '提供参数对照表。',
        design: '建立新旧知识联系。',
        evaluation: '依据分类结果即时反馈。',
        time: 45,
        tone: 'blue'
      }]
    }
  };

  const mockModel = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(wrappedPlan) } }] }));
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

  const response = await fetch(`http://127.0.0.1:${appPort}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form: { grade: '八年级', subject: '数学', lesson: '一次函数', duration: 45 },
      files: [],
      config: { baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: 'test-key', model: 'mock-model' }
    })
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.source, 'ai');
  assert.equal(result.plan.title, wrappedPlan.plan.title);
  assert.equal(result.plan.learningAnalysis, wrappedPlan.plan.learningAnalysis);
  assert.equal(result.plan.flow[0].name, '函数辨析');
});

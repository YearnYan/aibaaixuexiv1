const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function question(index, batch) {
  return {
    question: `第${index}题：请判断本题的核心知识。`,
    difficulty: 3,
    kp_choices: ['知识点一', '知识点二', '知识点三', '知识点四'],
    kp_answer: 0,
    method_choices: ['方法一', '方法二', '方法三', '方法四'],
    method_answer: 1,
    trap_choices: ['陷阱一', '陷阱二', '陷阱三', '陷阱四'],
    trap_answer: 2,
    explanation: `第${index}题解析：按照题干条件判断即可（批次${batch}）。`,
  };
}

test('首次题源冷启动失败时，同一次生成请求仍返回十题，并阻止批次内重复生成', async (t) => {
  let sourceCalls = 0;
  const source = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      sourceCalls += 1;
      if (sourceCalls === 1) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '题源正在冷启动' }));
        return;
      }
      const payload = JSON.parse(body || '{}');
      const count = Number(payload.count || 0);
      const data = Array.from({ length: count }, (_item, index) => question(index + 1, sourceCalls));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  const sourceAddress = source.address();
  process.env.QUESTION_SOURCE_URL = `http://127.0.0.1:${sourceAddress.port}/questions`;
  process.env.SESSION_TTL_MS = '60000';

  const serverModule = require('../server');
  const listener = await new Promise((resolve) => {
    const instance = serverModule.app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => {
    listener.close();
    source.close();
    serverModule.sessions.clear();
  });

  const base = `http://127.0.0.1:${listener.address().port}`;
  const sessionResponse = await fetch(`${base}/api/training/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gradeId: 'j2', gradeLabel: '初二', subject: '语文', knowledgePoint: '阅读理解' }),
  });
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();

  const generate = () => fetch(`${base}/api/training/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.sessionId,
      gradeId: 'j2',
      gradeLabel: '初二',
      subject: '语文',
      knowledgePoint: '阅读理解',
      count: 1,
    }),
  });
  const firstResponse = await generate();
  assert.equal(firstResponse.status, 200);
  const firstBatch = await firstResponse.json();
  assert.equal(firstBatch.batchSize, 10);
  assert.equal(firstBatch.questions.length, 10);
  assert.equal(sourceCalls, 2);

  const blockedResponse = await generate();
  assert.equal(blockedResponse.status, 409);
  assert.equal(sourceCalls, 2);

  for (const item of firstBatch.questions) {
    const submitResponse = await fetch(`${base}/api/training/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.sessionId, questionId: item.questionId, selected: { kp: 0, method: 0, trap: 0 } }),
    });
    assert.equal(submitResponse.status, 200);
  }

  const secondResponse = await generate();
  assert.equal(secondResponse.status, 200);
  const secondBatch = await secondResponse.json();
  assert.equal(secondBatch.questions.length, 10);
  assert.equal(sourceCalls, 3);
});

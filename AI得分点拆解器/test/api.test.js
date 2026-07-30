const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/create-app");
const { makeRawReport } = require("./fixtures");

function makeConfigStore() {
  const resolved = {
    protocol: "responses",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-test",
    timeoutMs: 10000,
    apiKey: "sk-test",
  };
  return {
    getResolvedConfig: async () => resolved,
    getPublicConfig: async () => ({
      ...resolved,
      apiKey: undefined,
      apiKeyConfigured: true,
      apiKeyMasked: "sk-••••••••test",
    }),
    validateInput: (value) => value,
    save: async () => ({ apiKeyConfigured: true, apiKeyMasked: "sk-••••••••test" }),
  };
}

function makeApp() {
  return createApp({
    configStore: makeConfigStore(),
    env: { NODE_ENV: "test", ADMIN_PASSWORD: "admin-secret" },
    analyze: async ({ totalScore, answerFile }) => ({
      ...makeRawReport({ totalScore, hasStudentAnswer: Boolean(answerFile) }),
      totalScore,
      hasStudentAnswer: Boolean(answerFile),
    }),
    testAi: async () => ({ ok: true, message: "AI 连接成功" }),
    disableRateLimit: true,
  });
}

test("健康检查不暴露密钥", async () => {
  const response = await request(makeApp()).get("/api/health").expect(200);
  assert.deepEqual(response.body, { ok: true, configured: true });
  assert.equal(JSON.stringify(response.body).includes("sk-test"), false);
});

test("页面入口禁用 HTML 缓存并引用带版本号的静态资源", async () => {
  const response = await request(makeApp()).get("/").expect(200);
  assert.match(response.headers["cache-control"], /no-store/);
  assert.match(response.text, /styles\.css\?v=20260718-9/);
  assert.match(response.text, /academic-rendering\.js\?v=20260718-9/);
  assert.match(response.text, /report-export\.js\?v=20260718-9/);
  assert.match(response.text, /app\.js\?v=20260718-9/);
  assert.match(response.text, /vendor\/katex\/katex\.min\.css/);
});

test("本地公式与文档导出资源可以访问", async () => {
  const app = makeApp();
  const resources = [
    "/vendor/katex/katex.min.js",
    "/vendor/katex/contrib/mhchem.min.js",
    "/vendor/html2pdf.bundle.min.js",
    "/vendor/html2canvas.min.js",
    "/vendor/docx.iife.js",
  ];

  for (const resource of resources) {
    const response = await request(app).get(resource);
    assert.equal(response.status, 200, resource);
    assert.ok(Number(response.headers["content-length"]) > 1000, resource);
  }
});

test("配置接口要求正确的管理密码", async () => {
  await request(makeApp()).get("/api/config").expect(401);
  const response = await request(makeApp())
    .get("/api/config")
    .set("x-admin-password", "admin-secret")
    .expect(200);
  assert.equal(response.body.apiKeyConfigured, true);
  assert.equal(response.body.apiKey, undefined);
});

test("分析接口校验题目文件并跑通上传流程", async () => {
  await request(makeApp())
    .post("/api/analyze")
    .field("subject", "高中语文")
    .field("totalScore", "12")
    .expect(400);

  const response = await request(makeApp())
    .post("/api/analyze")
    .field("subject", "高中语文")
    .field("totalScore", "12")
    .attach("questionFile", Buffer.from("题目与评分标准"), {
      filename: "question.txt",
      contentType: "text/plain",
    })
    .attach("answerFile", Buffer.from("学生答案"), {
      filename: "answer.txt",
      contentType: "text/plain",
    })
    .expect(200);

  assert.equal(response.body.hasStudentAnswer, true);
  assert.equal(response.body.totalScore, 12);
  assert.equal(response.body.scorePoints.length, 6);
});

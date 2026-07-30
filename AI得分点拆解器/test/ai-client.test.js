const test = require("node:test");
const assert = require("node:assert/strict");
const {
  endpointFor,
  extractResponseText,
  parseJsonText,
  requestAnalysis,
} = require("../src/ai-client");
const { makeRawReport } = require("./fixtures");

test("接口地址会按协议补齐且不重复路径", () => {
  assert.equal(endpointFor("https://api.openai.com/v1", "responses"), "https://api.openai.com/v1/responses");
  assert.equal(endpointFor("https://host/v1/responses", "responses"), "https://host/v1/responses");
  assert.equal(endpointFor("https://host/v1", "chat-completions"), "https://host/v1/chat/completions");
});

test("Responses API 请求会发送文件并解析结构化报告", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ output_text: JSON.stringify(makeRawReport()) }),
    };
  };

  const report = await requestAnalysis({
    config: {
      protocol: "responses",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-test",
      timeoutMs: 10000,
    },
    subject: "高中语文",
    totalScore: 12,
    questionFile: {
      originalname: "题目.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("题目内容与评分标准"),
    },
    answerFile: {
      originalname: "答案.png",
      mimetype: "image/png",
      buffer: Buffer.from("fake-image"),
    },
    fetchImpl,
  });

  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.options.headers.Authorization, "Bearer sk-test");
  assert.equal(captured.body.text.format.type, "json_schema");
  assert.ok(captured.body.text.format.schema.required.includes("hasStudentWork"));
  assert.ok(captured.body.text.format.schema.properties.scorePoints.items.required.includes("analysis"));
  assert.ok(captured.body.input[0].content.some((item) => item.type === "input_file"));
  assert.ok(captured.body.input[0].content.some((item) => item.type === "input_image"));
  assert.match(captured.body.instructions, /规范 LaTeX/);
  assert.ok(captured.body.instructions.includes("\\ce"));
  assert.equal(report.totalScore, 12);
  assert.equal(report.contentFormat, "latex-v1");
  assert.equal(report.scorePoints.length, 6);
});

test("兼容接口的对象内容、数组 JSON 和双重编码 JSON 均可解析", () => {
  const objectText = extractResponseText({
    output: [{ content: [{ type: "output_json", json: { score_points: [] } }] }],
  }, "responses");
  assert.deepEqual(parseJsonText(objectText), { score_points: [] });
  assert.deepEqual(parseJsonText("```json\n[{\"score\":1}]\n```"), [{ score: 1 }]);

  const doubleEncoded = JSON.stringify(JSON.stringify({ question_preview: "题目" }));
  assert.deepEqual(parseJsonText(doubleEncoded), { question_preview: "题目" });
  assert.deepEqual(
    parseJsonText(String.raw`{"analysis":"使用 \frac{1}{2} 计算"}`),
    { analysis: String.raw`使用 \frac{1}{2} 计算` },
  );
});

test("严格结构化输出无得分点时只降级重试一次并成功生成", async () => {
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    const output = bodies.length === 1 ? { message: "分析完成" } : makeRawReport();
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ output_text: JSON.stringify(output) }),
    };
  };

  const report = await requestAnalysis({
    config: {
      protocol: "responses",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-test",
      timeoutMs: 10000,
    },
    subject: "高中物理",
    totalScore: 12,
    questionFile: {
      originalname: "题目.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("物理题目与评分标准"),
    },
    fetchImpl,
  });

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].text.format.type, "json_schema");
  assert.equal(bodies[0].max_output_tokens, 8192);
  assert.match(JSON.stringify(bodies[0].input), /检查随后的全部文件/);
  assert.equal(bodies[1].text, undefined);
  assert.match(bodies[1].instructions, /兼容输出要求/);
  assert.equal(report.scorePoints.length, 6);
  assert.equal(report.studentWorkSource, "question_file");
});

test("连续两次输出无效时停止重试并返回明确错误", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ output_text: JSON.stringify({ message: "没有得分点" }) }),
    };
  };

  await assert.rejects(
    requestAnalysis({
      config: {
        protocol: "responses",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        model: "gpt-test",
        timeoutMs: 10000,
      },
      subject: "高中物理",
      totalScore: 12,
      questionFile: {
        originalname: "题目.txt",
        mimetype: "text/plain",
        buffer: Buffer.from("物理题目"),
      },
      fetchImpl,
    }),
    (error) => error.code === "AI_RESPONSE_INVALID",
  );
  assert.equal(callCount, 2);
});

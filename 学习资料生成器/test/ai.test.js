import assert from "node:assert/strict";
import test from "node:test";
import { auditGeneratedMaterial, auditKnowledgeCoverage, generateTeachingFigureSvg, generateWithAI } from "../src/ai.js";
import { createMaterialTemplate } from "../src/material.js";

test("覆盖审计会拦截分类过少、成员过少和其他兜底分类", () => {
  const issues = auditKnowledgeCoverage({
    knowledgeMap: {
      scopeType: "open",
      scope: "覆盖初中常用英语介词。",
      coverageSummary: "覆盖主要分类。",
      coverageDimensions: ["分类", "规则", "成员", "应用"],
      nodes: [
        { label: "时间介词", members: ["at", "on", "in"] },
        { label: "地点介词", members: ["in", "on", "under"] },
        { label: "方向介词", members: ["to", "into"] },
        { label: "方式介词", members: ["by", "with"] },
        { label: "原因介词", members: ["for"] },
        { label: "其他关系介词", members: ["of", "about"] }
      ]
    },
    knowledgeDiagrams: [{ title: "分类图" }]
  });

  assert.ok(issues.some((item) => /至少 8 个主流分类/u.test(item)));
  assert.ok(issues.some((item) => /常用成员/u.test(item)));
  assert.ok(issues.some((item) => /兜底分类/u.test(item)));
  assert.ok(issues.some((item) => /两张互补 SVG 图解描述/u.test(item)));
});

test("图形 AI 未配置时明确失败，不返回本地替代 SVG", { concurrency: false }, async () => {
  const originalApiKey = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try {
    await assert.rejects(
      () => generateTeachingFigureSvg({
        subject: "数学",
        figureType: "function",
        stem: "二次函数图像",
        description: "在坐标系中绘制抛物线并标出顶点"
      }),
      (error) => error.code === "FIGURE_AI_NOT_CONFIGURED" && !/<svg/iu.test(error.message)
    );
  } finally {
    if (originalApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalApiKey;
  }
});

test("图形任务看门狗的外部中止信号会传递到原模型请求", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AI_API_KEY;
  const originalBaseUrl = process.env.AI_BASE_URL;
  const controller = new AbortController();
  let receivedSignal;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://example.test/v1";
  globalThis.fetch = async (url, init) => {
    receivedSignal = init.signal;
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  };

  try {
    const generation = generateTeachingFigureSvg({
      subject: "数学",
      figureType: "function",
      stem: "二次函数图像",
      description: "在坐标系中绘制抛物线并标出顶点"
    }, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("任务看门狗中止")), 20);
    await assert.rejects(generation, (error) => error.code === "FIGURE_GENERATION_EXHAUSTED");
    assert.equal(receivedSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalBaseUrl;
  }
});

test("覆盖审计接受分类清楚且成员充分的开放体系", () => {
  const nodes = Array.from({ length: 10 }, (_, index) => ({
    label: `明确分类 ${index + 1}`,
    members: Array.from({ length: 4 }, (__, memberIndex) => `member-${index + 1}-${memberIndex + 1}`)
  }));
  const issues = auditKnowledgeCoverage({
    knowledgeMap: {
      scopeType: "open",
      scope: "覆盖当前学习阶段全部主流分类，冷僻条目不逐项展开。",
      coverageSummary: "覆盖 10 个主流分类和 40 个常用成员。",
      coverageDimensions: ["定义", "分类", "成员", "规则", "例外", "应用"],
      nodes
    },
    knowledgeDiagrams: [{ title: "全景图" }, { title: "判断图" }]
  });

  assert.deepEqual(issues, []);
});

test("完整正文会在图形审计前补齐缺失 placement，不要求模型重写整份讲义", () => {
  const sources = [{ name: "函数.txt", kind: "text", text: "二次函数图像、顶点和交点" }];
  const options = { subject: "数学", grade: "初中", goal: "understand", depth: "detailed" };
  const material = createMaterialTemplate({ sources, options });
  material.teachingFigures = [];
  assert.deepEqual(auditGeneratedMaterial(material, "数学"), []);
});

test("内容质量复核不会把待绘示意 SVG 误判为整份讲义失败", () => {
  const sources = [{ name: "电路.txt", kind: "text", text: "物理电路图：电源、开关、灯泡与电流方向" }];
  const options = { subject: "物理", grade: "初中", goal: "understand", depth: "detailed" };
  const material = createMaterialTemplate({ sources, options });
  const repeatedTemporarySvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300"/><rect x="40" y="80" width="100" height="60"/><rect x="260" y="80" width="100" height="60"/><line x1="140" y1="110" x2="260" y2="110"/><text x="60" y="110">临时</text><text x="280" y="110">示意</text></svg>';
  material.teachingFigures = material.teachingFigures.map((figure) => ({
    ...figure,
    renderStatus: "fallback",
    svg: repeatedTemporarySvg
  }));

  assert.deepEqual(auditGeneratedMaterial(material, "物理"), []);
});

test("AI 非法 JSON 会自动修复且冲突学科会再次校正", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AI_API_KEY;
  const originalBaseUrl = process.env.AI_BASE_URL;
  const requests = [];
  const sources = [{ name: "手动输入的知识点", kind: "text", text: "语文作文" }];
  const options = { subject: "自动识别", grade: "初中", goal: "understand", depth: "detailed" };
  const defaults = createMaterialTemplate({ sources, options });
  const wrongSubject = structuredClone(defaults);
  wrongSubject.meta = { ...wrongSubject.meta, title: "初中英语：语文作文", subject: "英语" };
  const responses = [
    "{\"meta\":{\"title\":\"语文作文\" \"subject\":\"英语\"}}",
    JSON.stringify(wrongSubject),
    JSON.stringify(defaults)
  ];

  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://example.test/v1";
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    const content = responses[requests.length - 1];
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const material = await generateWithAI({ sources, options, defaults });

    assert.equal(requests.length, 3);
    assert.match(requests[1].messages[0].content, /JSON 格式修复器/u);
    assert.match(requests[2].messages[1].content[0].text, /权威学科：语文/u);
    assert.equal(material.meta.subject, "语文");
    assert.equal(material.meta.title, "语文作文");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalBaseUrl;
  }
});

test("AI 格式修复仍失败时返回简明错误而不暴露解析位置", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AI_API_KEY;
  const originalBaseUrl = process.env.AI_BASE_URL;
  let requestCount = 0;
  const sources = [{ name: "手动输入的知识点", kind: "text", text: "语文作文" }];
  const options = { subject: "自动识别", grade: "初中", goal: "understand", depth: "detailed" };
  const defaults = createMaterialTemplate({ sources, options });

  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://example.test/v1";
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: "{\"meta\":{\"title\":\"语文作文\" \"subject\":\"语文\"}}" } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await assert.rejects(
      () => generateWithAI({ sources, options, defaults }),
      (error) => {
        assert.match(error.message, /系统已自动修复一次仍未成功/u);
        assert.doesNotMatch(error.message, /position|column|JSON at/iu);
        return true;
      }
    );
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalBaseUrl;
  }
});

test("AI 网关瞬时 502 会自动重试且仍返回完整讲义", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AI_API_KEY;
  const originalBaseUrl = process.env.AI_BASE_URL;
  const sources = [{ name: "手动输入的知识点", kind: "text", text: "英语时态" }];
  const options = { subject: "英语", grade: "初中", goal: "understand", depth: "detailed" };
  const defaults = createMaterialTemplate({ sources, options });
  let requestCount = 0;

  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://example.test/v1";
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(JSON.stringify({ error: { message: "upstream 502" } }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(defaults) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const material = await generateWithAI({ sources, options, defaults });
    assert.equal(requestCount, 2);
    assert.equal(material.meta.subject, "英语");
    assert.equal(material.practice.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalBaseUrl;
  }
});

test("化学选择题含 A-D 选项时不触发错误的化学式质量复核", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AI_API_KEY;
  const originalBaseUrl = process.env.AI_BASE_URL;
  const sources = [{ name: "手动输入的知识点", kind: "text", text: "化学氧化还原反应" }];
  const options = { subject: "化学", grade: "初中", goal: "understand", depth: "detailed" };
  const defaults = createMaterialTemplate({ sources, options });
  const generated = structuredClone(defaults);
  generated.practice[0].options = ["A", "B", "C", "D"];
  generated.practice[0].answer = "B";
  generated.practice[0].question = "下列说法正确的是（ ）。";

  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://example.test/v1";
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(generated) } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const material = await generateWithAI({ sources, options, defaults });
    assert.equal(requestCount, 1);
    assert.deepEqual(material.practice[0].options, ["A", "B", "C", "D"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalBaseUrl;
  }
});

test("公式问题只修订出错字段，不再重写整份讲义", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AI_API_KEY;
  const originalBaseUrl = process.env.AI_BASE_URL;
  const sources = [{ name: "手动输入的知识点", kind: "text", text: "英语时态" }];
  const options = { subject: "英语", grade: "初中", goal: "understand", depth: "detailed" };
  const defaults = createMaterialTemplate({ sources, options });
  const generated = structuredClone(defaults);
  generated.keyPoints[0].diagnostic.prompt = "判断 f(x)=x^2 是否符合题意。";
  generated.concepts[2].term = "函数 f(x)=x^2";
  const requests = [];
  const responses = [
    generated,
    {
      repairs: [
        { path: "keyPoints[0].diagnostic.prompt", value: "判断 $f(x)=x^2$ 是否符合题意。" },
        { path: "concepts[2].term", value: "函数 $f(x)=x^2$" }
      ]
    }
  ];

  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://example.test/v1";
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    const content = JSON.stringify(responses[requests.length - 1]);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const material = await generateWithAI({ sources, options, defaults });
    assert.equal(requests.length, 2);
    assert.match(requests[1].messages[0].content, /只修复给定 JSON 字段/u);
    assert.doesNotMatch(requests[1].messages[1].content, /待修订 JSON/u);
    assert.equal(material.keyPoints[0].diagnostic.prompt, "判断 $f(x)=x^2$ 是否符合题意。");
    assert.equal(material.concepts[2].term, "函数 $f(x)=x^2$");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalBaseUrl;
  }
});

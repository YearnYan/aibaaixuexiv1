import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackSvg, createFigureVisualSignature } from "../src/figures.js";

process.env.NODE_ENV = "test";
delete process.env.AI_API_KEY;
const { createApp } = await import("../server.js");

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    const closing = new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    server.closeAllConnections?.();
    await closing;
  }
}

function createImageForm(filename = "语文课文.png") {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const form = new FormData();
  form.append("files", new Blob([onePixelPng], { type: "image/png" }), filename);
  form.append("grade", "八年级");
  form.append("subject", "语文");
  form.append("goal", "understand");
  form.append("depth", "detailed");
  return form;
}

function createManualForm(text = "勾股定理的概念、公式、常见题型和易错点", subject = "数学") {
  const form = new FormData();
  form.append("manualText", text);
  form.append("grade", "八年级");
  form.append("subject", subject);
  form.append("goal", "understand");
  form.append("depth", "detailed");
  return form;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function addUniqueFigureMarker(svg, index) {
  return svg.replace(
    "</svg>",
    `<circle cx="${20 + index * 13}" cy="20" r="${2 + (index % 3)}" fill="#315e74"/></svg>`
  );
}

function requestFigure(baseUrl, figure, renderId) {
  return fetch(`${baseUrl}/api/render/figure`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Render-Id": renderId
    },
    body: JSON.stringify(figure)
  });
}

async function waitForFigureStatus(baseUrl, figure, renderId, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    try {
      const response = await requestFigure(baseUrl, figure, renderId);
      const body = await response.json();
      latest = { response, body };
      if (predicate(body, response)) return latest;
    } catch (error) {
      latest = { error };
    }
    await delay(10);
  }
  const lastState = latest?.body?.renderStatus || latest?.error?.code || "unknown";
  assert.fail(`图形任务未在 ${timeoutMs}ms 内进入预期状态，最后状态：${lastState}`);
}

function waitForFigureReady(baseUrl, figure, renderId, timeoutMs = 10_000) {
  return waitForFigureStatus(
    baseUrl,
    figure,
    renderId,
    (body, response) => response.status === 200 && body.renderStatus === "ready",
    timeoutMs
  );
}

test("健康检查返回上传限制和 AI 状态", () => {
  const app = createApp({ aiConfigured: () => false });
  return withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.aiConfigured, false);
    assert.equal(body.maxFiles, 8);
  });
});

test("未配置 AI 时拒绝生成且不返回本地内容", () => {
  const app = createApp({ aiConfigured: () => false });
  return withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      body: createImageForm()
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, "AI_NOT_CONFIGURED");
    assert.equal(body.material, undefined);
  });
});

test("图片上传通过 AI 生成器返回完整讲义", () => {
  const app = createApp({
    aiConfigured: () => true,
    aiGenerator: async ({ defaults }) => defaults
  });
  return withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      body: createImageForm()
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.mode, undefined);
    assert.equal(body.material.meta.grade, "八年级");
    assert.equal(body.material.sourceFiles[0].name, "语文课文.png");
    assert.equal(body.material.practice.length, 4);
    assert.equal(body.material.strategyCards.length, 3);
    assert.equal(body.material.closeReading.length, 2);
    assert.ok(body.material.knowledgeMap.scope);
    assert.ok(body.material.knowledgeMap.coverageSummary);
    assert.ok(body.material.knowledgeMap.nodes.every((node) => Array.isArray(node.members)));
    assert.ok(body.material.knowledgeDiagrams.length >= 1);
    assert.equal(body.material.visuals.length, 2);
  });
});

test("手动输入知识点可以直接生成讲义", () => {
  const app = createApp({
    aiConfigured: () => true,
    aiGenerator: async ({ defaults }) => defaults
  });
  return withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      body: createManualForm()
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.material.meta.subject, "数学");
    assert.equal(body.material.sourceFiles[0].name, "手动输入的知识点");
    assert.equal(body.material.sourceFiles[0].kind, "text");
  });
});

test("手动输入明确学科时自动识别结果优先于模型推测", () => {
  let capturedSubject = "";
  const app = createApp({
    aiConfigured: () => true,
    aiGenerator: async ({ defaults }) => {
      capturedSubject = defaults.meta.subject;
      return defaults;
    }
  });
  return withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      body: createManualForm("语文作文", "自动识别")
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(capturedSubject, "语文");
    assert.equal(body.material.meta.subject, "语文");
  });
});

test("文件和手动内容均为空时拒绝生成", () => {
  const app = createApp({ aiConfigured: () => true });
  return withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      body: createManualForm(" ")
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, "INPUT_REQUIRED");
  });
});

test("AI 调用失败时返回错误而非本地回退", () => {
  const app = createApp({
    aiConfigured: () => true,
    aiGenerator: async () => {
      throw new Error("网关暂时不可用");
    }
  });
  return withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      body: createImageForm()
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.code, "AI_GENERATION_FAILED");
    assert.equal(body.material, undefined);
  });
});

test("单次生成请求会在服务端自动恢复首次 AI 失败", () => {
  let generationCount = 0;
  const app = createApp({
    aiConfigured: () => true,
    aiGenerator: async ({ defaults }) => {
      generationCount += 1;
      if (generationCount === 1) throw new Error("瞬时网关波动");
      return defaults;
    }
  });
  return withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "X-Generation-Id": "material-recovery-0001" },
      body: createManualForm()
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(generationCount, 2);
    assert.equal(body.material.meta.subject, "数学");
    assert.equal(body.generationId, "material-recovery-0001");
  });
});

test("相同任务键的并发重连只执行一次 AI 生成", () => {
  let generationCount = 0;
  const app = createApp({
    aiConfigured: () => true,
    aiGenerator: async ({ defaults }) => {
      generationCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return defaults;
    }
  });
  return withServer(app, async (baseUrl) => {
    const createRequest = () => fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "X-Generation-Id": "material-idempotent-0001" },
      body: createManualForm()
    });
    const [left, right] = await Promise.all([createRequest(), createRequest()]);
    assert.equal(left.status, 200);
    assert.equal(right.status, 200);
    assert.equal(generationCount, 1);
    assert.deepEqual((await left.json()).material.meta, (await right.json()).material.meta);
  });
});

test("不支持的扩展名返回明确错误", () => {
  const app = createApp({ aiConfigured: () => true });
  return withServer(app, async (baseUrl) => {
    const form = new FormData();
    form.append("files", new Blob(["危险内容"], { type: "application/octet-stream" }), "教材.exe");
    const response = await fetch(`${baseUrl}/api/generate`, { method: "POST", body: form });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_FILE");
    assert.match(body.error, /不支持文件/);
  });
});

test("图形渲染接口支持参考项目式单图、批量与缓存协议", async () => {
  let renderCount = 0;
  const app = createApp({
    figureRenderer: async (figure) => {
      renderCount += 1;
      return buildFallbackSvg(figure);
    }
  });
  const figure = {
    id: "F1",
    subject: "数学",
    figureType: "function",
    stem: "画出二次函数图像",
    description: "在直角坐标系中绘制抛物线并标出顶点"
  };

  await withServer(app, async (baseUrl) => {
    const renderId = "figures-cache-protocol";
    const first = await requestFigure(baseUrl, figure, renderId);
    const firstBody = await first.json();
    assert.equal(first.status, 202);
    assert.match(firstBody.renderStatus, /queued|running/u);
    assert.equal(firstBody.svg, undefined);

    const completed = await waitForFigureReady(baseUrl, figure, renderId);
    assert.equal(completed.body.cached, false);
    assert.match(completed.body.svg, /viewBox="0 0 400 300"/u);

    const cached = await requestFigure(baseUrl, figure, renderId);
    const cachedBody = await cached.json();
    assert.equal(cached.status, 200);
    assert.equal(cachedBody.svg, completed.body.svg);
    assert.equal(renderCount, 1);

    const batch = await fetch(`${baseUrl}/api/render/figures-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ figures: [
        figure,
        { ...figure, id: "F2", figureType: "geometry", description: "画三角形 ABC 并标出三个顶点" }
      ] })
    });
    const batchBody = await batch.json();
    assert.equal(batch.status, 200);
    assert.equal(batchBody.results.length, 2);
    assert.ok(batchBody.results.every((item) => item.svg));
    assert.equal(renderCount, 2);
  });
});

test("图形接口拒绝跨学科 SVG，重连后仍用同一渲染器生成权威学科图", async () => {
  const wrongCellSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#fff"/><ellipse cx="200" cy="150" rx="130" ry="85"/><ellipse cx="200" cy="150" rx="55" ry="40"/><circle cx="200" cy="150" r="10"/><path d="M80 60 L130 100 M280 220 L245 190"/><text>细胞膜</text><text>细胞核</text><text>细胞质</text></svg>';
  let renderCount = 0;
  const app = createApp({
    figureRenderRetryDelays: [80],
    figureRenderer: async (figure) => {
      renderCount += 1;
      return renderCount === 1 ? wrongCellSvg : buildFallbackSvg(figure);
    }
  });
  await withServer(app, async (baseUrl) => {
    const figure = {
      id: "geo-current",
      subject: "地理",
      figureType: "diagram",
      stem: "地理洋流的规律与影响",
      description: "寒暖流交汇形成渔场，营养盐上涌使浮游生物增多并形成鱼群聚集"
    };
    const renderId = "figures-geo-current-session";

    const rejected = await requestFigure(baseUrl, figure, renderId);
    const rejectedBody = await rejected.json();
    assert.equal(rejected.status, 202);
    assert.equal(rejectedBody.retryable, true);
    assert.equal(rejectedBody.svg, undefined);

    const reviewing = await waitForFigureStatus(
      baseUrl,
      figure,
      renderId,
      (body) => body.renderStatus === "retrying"
    );
    assert.equal(reviewing.body.code, "FIGURE_QUALITY_REVIEW_FAILED");
    assert.equal(reviewing.body.svg, undefined);

    const recovered = await waitForFigureReady(baseUrl, figure, renderId);
    const body = recovered.body;
    assert.match(body.svg, /寒流/u);
    assert.match(body.svg, /暖流/u);
    assert.doesNotMatch(body.svg, /细胞膜|细胞核|细胞质/u);
    assert.equal(body.source, "ai");
    assert.equal(renderCount, 2);
  });
});

test("批量图形对重复主体进行多轮重绘并保证最终结构不同", async () => {
  let renderCount = 0;
  const repeatedSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#fff"/><rect x="40" y="70" width="120" height="70"/><rect x="240" y="70" width="120" height="70"/><rect x="140" y="190" width="120" height="60"/><line x1="160" y1="105" x2="240" y2="105"/><text x="72" y="108">条件</text><text x="275" y="108">关系</text><text x="174" y="225">结果</text></svg>';
  const differentiatedSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#fff"/><circle cx="90" cy="150" r="48" fill="none" stroke="#315e74"/><circle cx="200" cy="80" r="42" fill="none" stroke="#315e74"/><circle cx="310" cy="150" r="48" fill="none" stroke="#315e74"/><path d="M130 125 L165 97 M235 97 L270 125 M138 150 H262" fill="none" stroke="#315e74"/><text x="64" y="155">条件</text><text x="174" y="85">关系</text><text x="284" y="155">结果</text></svg>';
  const app = createApp({
    figureRenderer: async (figure) => {
      renderCount += 1;
      return figure.params?.variationAttempt ? differentiatedSvg : repeatedSvg;
    }
  });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/render/figures-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        figures: [
          {
            id: "unique-K1",
            subject: "英语",
            figureType: "diagram",
            stem: "比较句子中的条件、关系和结果",
            description: "重点机制图展示条件、关系和结果",
            params: { teachingRole: "key-mechanism", placementRef: "keyPoints:K1" }
          },
          {
            id: "unique-V1",
            subject: "英语",
            figureType: "diagram",
            stem: "对照句子中的条件、关系和结果",
            description: "易混对照图比较条件、关系和结果",
            params: { teachingRole: "visual-contrast", placementRef: "visuals:V1" }
          }
        ]
      })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.results.length, 2);
    assert.notEqual(
      createFigureVisualSignature(body.results[0].svg),
      createFigureVisualSignature(body.results[1].svg)
    );
    assert.equal(body.results[1].redrawnForDifference, true);
    assert.ok(renderCount >= 3);
    assert.ok(body.results.every((item) => ["ai", "cache"].includes(item.source)));
  });
});

test("单张渲染器异常不会生成本地图，批量兼容接口返回逐项可恢复状态", async () => {
  const app = createApp({
    figureRenderer: async () => {
      throw new Error("上游绘图服务暂时断开");
    }
  });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/render/figures-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        figures: [
          {
            id: "F-knowledgeDiagrams-D1",
            subject: "数学",
            figureType: "function",
            stem: "二次函数图像",
            description: "在坐标系中绘制抛物线并标出顶点",
            params: { teachingRole: "knowledge-overview", placementRef: "knowledgeDiagrams:D1" }
          },
          {
            id: "F-keyPoints-K1",
            subject: "物理",
            figureType: "circuit",
            stem: "串联电路",
            description: "画出电源、开关、灯泡组成的闭合串联电路",
            params: { teachingRole: "key-mechanism", placementRef: "keyPoints:K1" }
          }
        ]
      })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.results.length, 2);
    assert.ok(body.results.every((item) => item.renderStatus === "retrying"));
    assert.ok(body.results.every((item) => item.source === "ai"));
    assert.ok(body.results.every((item) => item.svg === null));
  });
});

test("同会话中的快图完成不等待慢图，单图请求可渐进发布", async () => {
  let slowFinished = false;
  let releaseSlow;
  const slowGate = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  const slowFigure = { id: "slow", subject: "数学", figureType: "function", stem: "二次函数图像", description: "在坐标系中绘制抛物线并标出顶点" };
  const fastFigure = { id: "fast", subject: "物理", figureType: "circuit", stem: "串联电路", description: "绘制电源、开关和灯泡组成的闭合串联电路" };
  const slowSvg = buildFallbackSvg(slowFigure);
  const fastSvg = buildFallbackSvg(fastFigure);
  const app = createApp({
    figureRenderer: async (figure) => {
      if (figure.subject === "数学") {
        await slowGate;
        slowFinished = true;
        return slowSvg;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      return fastSvg;
    }
  });

  await withServer(app, async (baseUrl) => {
    const headers = { "Content-Type": "application/json", "X-Render-Id": "figures-progressive-session" };
    const [slow, fast] = await Promise.all([
      fetch(`${baseUrl}/api/render/figure`, { method: "POST", headers, body: JSON.stringify(slowFigure) }),
      fetch(`${baseUrl}/api/render/figure`, { method: "POST", headers, body: JSON.stringify(fastFigure) })
    ]);
    assert.equal(slow.status, 202);
    assert.equal(fast.status, 202);

    const fastResponse = await waitForFigureReady(baseUrl, fastFigure, "figures-progressive-session");
    assert.equal(fastResponse.response.status, 200);
    assert.equal(slowFinished, false);
    assert.equal(fastResponse.body.renderStatus, "ready");
    releaseSlow();
    assert.equal((await waitForFigureReady(baseUrl, slowFigure, "figures-progressive-session")).response.status, 200);
  });
});

test("同一会话同一图的并发重连复用进行中任务", async () => {
  let renderCount = 0;
  const app = createApp({
    figureRenderer: async (figure) => {
      renderCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return buildFallbackSvg(figure);
    }
  });

  await withServer(app, async (baseUrl) => {
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Render-Id": "figures-idempotent-session" },
      body: JSON.stringify({ id: "same", subject: "数学", figureType: "function", stem: "二次函数图像", description: "在坐标系中绘制抛物线并标出顶点" })
    };
    const [left, right] = await Promise.all([
      fetch(`${baseUrl}/api/render/figure`, options),
      fetch(`${baseUrl}/api/render/figure`, options)
    ]);
    assert.equal(left.status, 202);
    assert.equal(right.status, 202);
    const completed = await waitForFigureReady(
      baseUrl,
      JSON.parse(options.body),
      "figures-idempotent-session"
    );
    assert.equal(renderCount, 1);
    assert.match(completed.body.svg, /viewBox="0 0 400 300"/u);
  });
});

test("前五张首次失败时第六张仍可获得执行机会，失败任务随后全部恢复", async () => {
  const attemptCounts = new Map();
  const app = createApp({
    figureRenderConcurrency: 5,
    figureRenderRetryDelays: [120],
    figureRenderer: async (figure) => {
      const testId = figure.params.testId;
      const count = (attemptCounts.get(testId) || 0) + 1;
      attemptCounts.set(testId, count);
      if (testId !== "fair-6" && count === 1) {
        await delay(30);
        throw new Error("模拟上游瞬时失败");
      }
      return buildFallbackSvg(figure);
    }
  });

  await withServer(app, async (baseUrl) => {
    const renderId = "figures-fair-queue-session";
    const figures = Array.from({ length: 6 }, (_, index) => ({
      id: `fair-${index + 1}`,
      subject: "数学",
      figureType: "function",
      stem: `函数图像 ${index + 1}`,
      description: `在坐标系中绘制函数图像并标出关键点 ${index + 1}`,
      params: { a: index + 1, b: index - 2, c: index, testId: `fair-${index + 1}` }
    }));
    const created = await Promise.all(figures.map((figure) => requestFigure(baseUrl, figure, renderId)));
    assert.ok(created.every((response) => response.status === 202));
    await Promise.all(created.map((response) => response.body?.cancel()));

    const sixth = await waitForFigureReady(baseUrl, figures[5], renderId);
    assert.equal(sixth.body.renderStatus, "ready");
    const blockerAttemptsAtSixthReady = figures.slice(0, 5).map((figure) => attemptCounts.get(figure.id));
    assert.equal(attemptCounts.get("fair-6"), 1);
    assert.ok(blockerAttemptsAtSixthReady.some((count) => count === 1));
    assert.ok(blockerAttemptsAtSixthReady.every((count) => count <= 2));

    const recovered = await Promise.all(
      figures.slice(0, 5).map((figure) => waitForFigureReady(baseUrl, figure, renderId, 15_000))
    );
    assert.ok(recovered.every(({ body }) => body.renderStatus === "ready"));
    assert.ok(figures.slice(0, 5).every((figure) => attemptCounts.get(figure.id) === 2));
  });
});

test("首次 HTTP 短连接结束后后台图形任务继续执行，重连直接取得成品", async () => {
  let renderCount = 0;
  const figure = {
    id: "detached-http",
    subject: "物理",
    figureType: "circuit",
    stem: "串联电路",
    description: "绘制电源、开关和灯泡组成的闭合串联电路"
  };
  const validSvg = buildFallbackSvg(figure);
  const app = createApp({
    figureRenderer: async () => {
      renderCount += 1;
      await delay(40);
      return validSvg;
    }
  });

  await withServer(app, async (baseUrl) => {
    const renderId = "figures-detached-http-session";
    const created = await requestFigure(baseUrl, figure, renderId);
    assert.equal(created.status, 202);
    await created.body?.cancel();

    await delay(70);
    const completed = await waitForFigureReady(baseUrl, figure, renderId);
    assert.equal(completed.response.status, 200);
    assert.equal(renderCount, 1);
  });
});

test("同图高频并发轮询只读取一个后台任务，不重复调用模型", async () => {
  let renderCount = 0;
  const figure = {
    id: "poll-shared",
    subject: "数学",
    figureType: "function",
    stem: "二次函数图像",
    description: "在坐标系中绘制抛物线并标出顶点"
  };
  const validSvg = buildFallbackSvg(figure);
  const app = createApp({
    figureRenderer: async () => {
      renderCount += 1;
      await delay(60);
      return validSvg;
    }
  });

  await withServer(app, async (baseUrl) => {
    const renderId = "figures-concurrent-poll-session";
    assert.equal((await requestFigure(baseUrl, figure, renderId)).status, 202);
    const polls = await Promise.all(
      Array.from({ length: 12 }, () => requestFigure(baseUrl, figure, renderId))
    );
    assert.ok(polls.every((response) => response.status === 202));
    await Promise.all(polls.map((response) => response.body?.cancel()));

    const completed = await waitForFigureReady(baseUrl, figure, renderId);
    assert.equal(completed.response.status, 200);
    assert.equal(renderCount, 1);
  });
});

test("单次候选永久不返回时看门狗释放槽位，迟到结果不能覆盖后续成品", async () => {
  let renderCount = 0;
  const figure = {
    id: "watchdog-stale",
    subject: "数学",
    figureType: "function",
    stem: "二次函数图像",
    description: "在坐标系中绘制抛物线并标出顶点",
    params: { testId: "watchdog-stale" }
  };
  const lateSvg = addUniqueFigureMarker(buildFallbackSvg(figure), 1);
  const finalSvg = addUniqueFigureMarker(buildFallbackSvg({
    ...figure,
    params: { ...figure.params, a: 2, b: 1, c: -1 }
  }), 2);
  const app = createApp({
    figureRenderAttemptTimeoutMs: 50,
    figureRenderRetryDelays: [5],
    figureRenderer: async () => {
      renderCount += 1;
      if (renderCount === 1) {
        await delay(180);
        return lateSvg;
      }
      return finalSvg;
    }
  });

  await withServer(app, async (baseUrl) => {
    const renderId = "figures-watchdog-stale-session";
    const completed = await waitForFigureReady(baseUrl, figure, renderId);
    assert.equal(completed.body.svg, finalSvg);
    assert.equal(renderCount, 2);

    await delay(220);
    const stable = await requestFigure(baseUrl, figure, renderId);
    const stableBody = await stable.json();
    assert.equal(stable.status, 200);
    assert.equal(stableBody.svg, finalSvg);
    assert.equal(stableBody.renderVersion, completed.body.renderVersion);
    assert.equal(renderCount, 2);
  });
});

test("浏览器拒绝当前成品版本后服务端撤销旧图并生成可发布的新版本", async () => {
  let renderCount = 0;
  const figure = {
    id: "client-reject",
    subject: "数学",
    figureType: "function",
    stem: "一次函数图像",
    description: "在坐标系中绘制一次函数并标出截距",
    params: { testId: "client-reject" }
  };
  const firstSvg = addUniqueFigureMarker(buildFallbackSvg(figure), 3);
  const secondSvg = addUniqueFigureMarker(buildFallbackSvg({
    ...figure,
    params: { ...figure.params, a: 2, b: 3 }
  }), 4);
  const app = createApp({
    figureRenderRetryDelays: [5],
    figureRenderer: async () => {
      renderCount += 1;
      return renderCount === 1 ? firstSvg : secondSvg;
    }
  });

  await withServer(app, async (baseUrl) => {
    const renderId = "figures-client-reject-session";
    const first = await waitForFigureReady(baseUrl, figure, renderId);
    assert.ok(first.body.renderVersion);
    assert.equal(first.body.svg, firstSvg);

    const rejectedFigure = {
      ...figure,
      rejectedRenderVersion: first.body.renderVersion
    };
    const rejected = await requestFigure(baseUrl, rejectedFigure, renderId);
    const rejectedBody = await rejected.json();
    assert.equal(rejected.status, 202);
    assert.equal(rejectedBody.svg, undefined);

    const second = await waitForFigureReady(baseUrl, rejectedFigure, renderId);
    assert.equal(second.body.svg, secondSvg);
    assert.notEqual(second.body.renderVersion, first.body.renderVersion);
    assert.equal(renderCount, 2);
  });
});

test("重复图差异化每次只占一个原子配额，后续图不会被内部重绘循环阻塞", async () => {
  let releaseDifferentiated;
  const differentiatedGate = new Promise((resolve) => {
    releaseDifferentiated = resolve;
  });
  const attempts = new Map();
  const baseFigure = {
    subject: "英语",
    figureType: "diagram",
    stem: "条件、关系和结果",
    description: "用关系图展示条件、关系和结果"
  };
  const repeatedSvg = addUniqueFigureMarker(buildFallbackSvg(baseFigure), 5);
  const sixthSvg = addUniqueFigureMarker(buildFallbackSvg(baseFigure), 11);
  const app = createApp({
    figureRenderConcurrency: 5,
    figureRenderRetryDelays: [5],
    figureRenderer: async (figure) => {
      const testId = figure.params.testId;
      attempts.set(testId, (attempts.get(testId) || 0) + 1);
      if (testId === "atomic-6") return sixthSvg;
      if (!figure.params.variationAttempt) return repeatedSvg;
      await differentiatedGate;
      const index = Number(testId.replace("atomic-", ""));
      return addUniqueFigureMarker(buildFallbackSvg(baseFigure), 20 + index);
    }
  });

  await withServer(app, async (baseUrl) => {
    const renderId = "figures-atomic-quantum-session";
    const figures = Array.from({ length: 6 }, (_, index) => ({
      ...baseFigure,
      id: `atomic-${index + 1}`,
      params: { testId: `atomic-${index + 1}` }
    }));
    const created = await Promise.all(figures.map((figure) => requestFigure(baseUrl, figure, renderId)));
    assert.ok(created.every((response) => response.status === 202));
    await Promise.all(created.map((response) => response.body?.cancel()));

    const sixth = await waitForFigureReady(baseUrl, figures[5], renderId);
    assert.equal(sixth.body.svg, sixthSvg);
    assert.equal(attempts.get("atomic-6"), 1);
    assert.ok(figures.slice(1, 5).some((figure) => attempts.get(figure.id) >= 2));

    releaseDifferentiated();
    const completed = await Promise.all(
      figures.map((figure) => waitForFigureReady(baseUrl, figure, renderId, 15_000))
    );
    assert.ok(completed.every(({ body }) => body.renderStatus === "ready"));
  });
});

test("图形描述缺失时使用同一教学对象字段补齐请求而不返回替代图", async () => {
  let receivedDescription = "";
  const figure = {
    id: "description-normalized",
    subject: "数学",
    figureType: "function",
    title: "函数结构图",
    purpose: "看清函数图像的变化关系",
    stem: "绘制二次函数图像并标出顶点"
  };
  const validSvg = buildFallbackSvg({
    ...figure,
    description: `${figure.title}；${figure.purpose}；${figure.stem}`
  });
  const app = createApp({
    figureRenderer: async (normalizedFigure) => {
      receivedDescription = normalizedFigure.description;
      return validSvg;
    }
  });

  await withServer(app, async (baseUrl) => {
    const completed = await waitForFigureReady(
      baseUrl,
      figure,
      "figures-description-normalized-session"
    );
    assert.equal(completed.body.source, "ai");
    assert.match(receivedDescription, /函数结构图/u);
    assert.match(receivedDescription, /二次函数图像/u);
  });
});

test("PDF 与 Word 下载接口返回正确文件类型和附件头", async () => {
  const app = createApp({
    pdfExporter: async () => Buffer.from("%PDF-1.7\n测试"),
    docxExporter: async () => Buffer.from("PK\u0003\u0004测试")
  });
  const figure = {
    id: "export-ready",
    subject: "语文",
    type: "diagram",
    title: "背影内容关系图",
    description: "用关系图表示父亲为儿子买橘子以及深沉父爱",
    stem: "父亲为儿子买橘子，表现深沉的父爱",
    placement: { section: "knowledgeDiagrams", refId: "D1" },
    params: {},
    constraints: ["关系清晰"],
    renderStatus: "ready"
  };
  figure.svg = buildFallbackSvg({ ...figure, figureType: figure.type });
  const material = { meta: { title: "背影" }, teachingFigures: [figure] };

  await withServer(app, async (baseUrl) => {
    const pdfResponse = await fetch(`${baseUrl}/api/export/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material })
    });
    const pdf = Buffer.from(await pdfResponse.arrayBuffer());
    assert.equal(pdfResponse.status, 200);
    assert.match(pdfResponse.headers.get("content-type"), /application\/pdf/);
    assert.match(pdfResponse.headers.get("content-disposition"), /filename\*=UTF-8''/);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");

    const wordResponse = await fetch(`${baseUrl}/api/export/docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material })
    });
    const word = Buffer.from(await wordResponse.arrayBuffer());
    assert.equal(wordResponse.status, 200);
    assert.match(wordResponse.headers.get("content-type"), /officedocument/);
    assert.match(wordResponse.headers.get("content-disposition"), /filename\*=UTF-8''/);
    assert.equal(word.subarray(0, 2).toString(), "PK");
  });
});

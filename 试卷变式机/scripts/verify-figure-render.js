const assert = require('assert');
const express = require('express');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const aiModulePath = path.join(projectRoot, 'server', 'services', 'ai.js');
const renderRoutePath = path.join(projectRoot, 'server', 'routes', 'render.js');
const aiConfigPath = path.join(projectRoot, 'server', 'config', 'ai.js');

const aiModule = require(aiModulePath);
const { AI_CONFIG } = require(aiConfigPath);

function clearRenderRouteCache() {
  delete require.cache[require.resolve(renderRoutePath)];
}

function createServer() {
  clearRenderRouteCache();
  const router = require(renderRoutePath);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/render', router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

async function requestFigure(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/api/render/figure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.equal(response.status, 200, `图形接口返回非200状态码: ${response.status}`);
  const data = await response.json();
  assert.ok(data.svg, '图形接口未返回 svg');
  assertValidSvg(data.svg, payload.figureType || 'unknown');
  return data.svg;
}

function assertValidSvg(svg, label) {
  assert.ok(/<svg[\s\S]*<\/svg>/i.test(svg), `${label} 未返回完整 SVG`);
  assert.ok(/viewBox=/i.test(svg), `${label} 缺少 viewBox`);
  assert.ok(/xmlns=/i.test(svg), `${label} 缺少 xmlns`);
  assert.ok(/<(path|line|polyline|polygon|circle|ellipse|rect)\b/i.test(svg), `${label} 缺少可见图元`);
  assert.ok(!/<script\b|<foreignObject\b|on[a-z]+\s*=/i.test(svg), `${label} 含危险 SVG 内容`);
}

async function runFallbackSuite() {
  const originalGenerateContent = aiModule.generateContent;
  aiModule.generateContent = async () => '这不是 SVG';

  const { server, baseUrl } = await createServer();
  try {
    await requestFigure(baseUrl, {
      subject: '数学',
      figureType: 'geometry',
      stem: '在△ABC中，求角A。',
      description: '画一个三角形ABC，并标注角A。'
    });
    await requestFigure(baseUrl, {
      subject: '物理',
      figureType: 'circuit',
      stem: '电路如图所示，求电流表读数。',
      description: '画一个含电源、电阻和电流表的串联电路。'
    });
  } finally {
    server.close();
    aiModule.generateContent = originalGenerateContent;
    clearRenderRouteCache();
  }
}

async function runLiveSuite() {
  const { server, baseUrl } = await createServer();
  try {
    await requestFigure(baseUrl, {
      subject: '数学',
      figureType: 'function',
      stem: '在平面直角坐标系中画出函数 y=x²-2x+1 的图像，并标出顶点。',
      description: '画出抛物线 y=x²-2x+1，标出顶点和坐标轴。'
    });
  } finally {
    server.close();
    clearRenderRouteCache();
  }
}

async function main() {
  const runLive = process.argv.includes('--live');

  console.log('开始验证图形渲染：兜底路径');
  await runFallbackSuite();
  console.log('兜底路径验证通过');

  if (runLive) {
    if (!AI_CONFIG.apiKeys.length) {
      throw new Error('未配置 AI_API_KEY，无法执行真实 AI 冒烟验证');
    }
    console.log('开始验证图形渲染：真实 AI 冒烟');
    await runLiveSuite();
    console.log('真实 AI 冒烟验证通过');
  }
}

main().catch((error) => {
  console.error('图形渲染验证失败:', error.message);
  process.exit(1);
});

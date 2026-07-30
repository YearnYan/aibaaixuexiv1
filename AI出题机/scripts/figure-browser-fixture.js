const express = require('express');
const { randomUUID } = require('crypto');
const { analyzeFigureSvg } = require('../shared/figure-svg-quality');

const sourceUrl = String(process.env.FIGURE_SOURCE_URL || 'http://localhost:5100').replace(/\/$/, '');
const port = Number.parseInt(process.env.FIGURE_FIXTURE_PORT || '5111', 10);

const figure = {
  id: 'screenshot-circle',
  subject: '数学',
  figureType: 'coordinate',
  stem: '在平面直角坐标系中，已知圆 M 的圆心在第一象限，且与 x 轴相切于点 A(3,0)，与直线 y=√3x 相交于 B、C 两点。若弦 BC 的长为 2√3，求圆 M 的半径 R。',
  description: '绘制平面直角坐标系、第一象限内的圆 M，圆与 x 轴相切于 A(3,0)，直线 y=√3x 穿过圆并交于 B、C 两点，标出圆心 M、半径 R、弦 BC 及相切和交点关系。'
};

async function fetchCachedFigure() {
  const bootstrapResponse = await fetch(`${sourceUrl}/api/security/bootstrap`, {
    headers: { 'X-CX-Request-Id': randomUUID() }
  });
  if (!bootstrapResponse.ok) throw new Error(`安全令牌请求失败：${bootstrapResponse.status}`);
  const cookie = bootstrapResponse.headers.get('set-cookie')?.split(';')[0] || '';
  const bootstrap = await bootstrapResponse.json();

  const response = await fetch(`${sourceUrl}/api/render/figures-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'X-CX-Request-Id': randomUUID(),
      'X-CX-Request-Token': bootstrap.requestToken
    },
    body: JSON.stringify({ figures: [figure] })
  });
  if (!response.ok) throw new Error(`图形请求失败：${response.status}`);
  const body = await response.json();
  const result = body.results?.[0];
  if (!result?.svg) throw new Error(result?.error || '图形响应为空');
  const diagnosis = analyzeFigureSvg(result.svg);
  if (!diagnosis.ok) throw new Error(`图形未通过共享质量门：${diagnosis.code}`);
  return result.svg;
}

function renderPage(svg) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>真实题图浏览器验收</title>
  <style>
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: system-ui, sans-serif; }
    main { width: min(920px, calc(100% - 32px)); margin: 40px auto; background: #fff; padding: 28px; }
    .stem { font-size: 18px; line-height: 1.9; }
    .figure { width: 280px; height: 210px; margin: 18px auto 0; overflow: hidden; }
    .figure svg { width: 280px !important; height: 210px !important; max-width: 100% !important; display: block; margin: 0 !important; }
    @media (max-width: 360px) { .figure { width: 100%; aspect-ratio: 4 / 3; height: auto; } .figure svg { width: 100% !important; height: auto !important; aspect-ratio: 4 / 3; } }
  </style>
</head>
<body>
  <main>
    <div class="stem">${figure.stem}</div>
    <div class="figure" id="verifiedFigure">${svg}</div>
  </main>
</body>
</html>`;
}

async function main() {
  const svg = await fetchCachedFigure();
  const html = renderPage(svg);
  const app = express();
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('/', (_req, res) => res.type('html').send(html));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.listen(port, '127.0.0.1', () => {
    console.log(`图形浏览器验收页已启动：http://127.0.0.1:${port}`);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvgMarkup, splitRichContent, svgToAccessibleText } from '../src/scientificText.js';
import { normalizeEducationalSvgMarkup } from '../src/educationalSvg.js';

const safeSvg = '<svg viewBox="0 0 120 80"><title>受力示意图</title><line x1="10" y1="40" x2="110" y2="40" stroke="#173f34"/><text x="60" y="25" text-anchor="middle">F浮</text></svg>';

test('原始 SVG、代码围栏 SVG 和转义 SVG 都识别为图形段', () => {
  const inputs = [
    `图示：${safeSvg}`,
    `图示：\`\`\`svg\n${safeSvg}\n\`\`\``,
    `图示：${safeSvg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`
  ];

  for (const input of inputs) {
    const svg = splitRichContent(input).find((segment) => segment.type === 'svg');
    assert.ok(svg, input);
    assert.match(svg.value, /^<svg\b/);
    assert.match(svg.value, /<line\b/);
    assert.doesNotMatch(svg.value, /```|&lt;svg/);
  }
});

test('多行且缺少根闭合标签的 SVG 会安全补齐并渲染，不泄露源码', () => {
  const incomplete = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">
    <rect width="800" height="450" fill="#173f34" />
    <text x="40" y="50">二次函数板书</text>`;
  const segments = splitRichContent(incomplete);

  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, 'svg');
  assert.match(segments[0].value, /^<svg\b/);
  assert.match(segments[0].value, /<\/svg>$/);
  assert.match(segments[0].value, /二次函数板书/);
});

test('无法恢复的 SVG 只显示安全提示，不把标签源码呈现给用户', () => {
  const segments = splitRichContent('<svg viewBox="0 0 100 100"');

  assert.deepEqual(segments, [{ type: 'text', value: '（SVG 图形无法安全显示）' }]);
  assert.doesNotMatch(segments[0].value, /<svg|viewBox/i);
});

test('全角和二次转义的 SVG 根标签也能进入图形渲染管线', () => {
  const fullWidth = '＜svg viewBox="0 0 20 20"＞＜circle cx="10" cy="10" r="8" /＞＜/svg＞';
  const serialized = '\\u003csvg viewBox="0 0 20 20"\\u003e\\u003crect width="20" height="20" /\\u003e\\u003c/svg\\u003e';

  assert.equal(splitRichContent(fullWidth)[0].type, 'svg');
  assert.equal(splitRichContent(serialized)[0].type, 'svg');
});

test('SVG 白名单删除脚本、嵌入 HTML、事件和外链', () => {
  const dangerous = `<svg viewBox="0 0 100 100" onload="alert(1)">
    <script>alert(1)</script>
    <foreignObject><div onclick="alert(2)">危险</div></foreignObject>
    <image href="https://example.com/a.png" />
    <use href="https://example.com/a.svg#x" />
    <rect x="10" y="10" width="80" height="80" fill="url(https://example.com/a.svg#x)" onclick="alert(3)" />
    <text x="50" y="55">安全文字</text>
  </svg>`;
  const sanitized = sanitizeSvgMarkup(dangerous);

  assert.match(sanitized, /<rect\b/);
  assert.match(sanitized, /安全文字/);
  assert.doesNotMatch(sanitized, /script|foreignObject|onclick|onload|example\.com|<image/i);
  assert.doesNotMatch(sanitized, /<use\b[^>]*\bhref=/i);
});

test('无有效图形的 SVG 使用安全提示且不泄露源码', () => {
  const segments = splitRichContent('<svg><script>alert(1)</script></svg>');
  assert.deepEqual(segments, [{ type: 'text', value: '（SVG 图形无法安全显示）' }]);
});

test('SVG 可访问描述优先读取 title 或 desc', () => {
  assert.equal(svgToAccessibleText(safeSvg), '【图示：受力示意图】');
});

test('SVG 支持内部 marker 和 use 复用，但拒绝外部 use 地址', () => {
  const source = '<svg viewBox="0 0 100 40"><defs><symbol id="dot"><circle cx="5" cy="5" r="5"/></symbol><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"/></marker></defs><use href="#dot" x="10" y="10"/><use href="https://example.com/a.svg#dot"/><line x1="20" y1="20" x2="90" y2="20" marker-end="url(#arrow)"/></svg>';
  const sanitized = sanitizeSvgMarkup(source);

  assert.match(sanitized, /<symbol\b/);
  assert.match(sanitized, /<use href="#dot"/);
  assert.match(sanitized, /markerWidth="8"/);
  assert.doesNotMatch(sanitized, /example\.com/);
});

test('SVG 文字节点统一转换数学、物理、化学、生物和地理学科符号', () => {
  const source = String.raw`<svg viewBox="0 0 800 240">
    <text x="10" y="30">数学：\(\sqrt{x-5} \ge 0 \Rightarrow x \ge 5\)</text>
    <text x="10" y="70">物理：\(F_{\text{浮}}=\rho gV_{\text{排}}\)</text>
    <text x="10" y="110">化学：\(\ce{CaCO3 -> CaO + CO2}\)</text>
    <text x="10" y="150">生物：\(P_1=p^2+2pq\)</text>
    <text x="10" y="190">地理：\(30^{\circ}N,120^{\circ}E\)</text>
  </svg>`;
  const normalized = normalizeEducationalSvgMarkup(source);

  assert.match(normalized, /√\(x-5\) ≥ 0 ⇒ x ≥ 5/);
  assert.match(normalized, /F浮=ρ gV排/);
  assert.match(normalized, /CaCO₃ → CaO \+ CO₂/);
  assert.match(normalized, /P₁=p²\+2pq/);
  assert.match(normalized, /30°N,120°E/);
  assert.doesNotMatch(normalized, /\\(?:sqrt|ge|Rightarrow|text|rho|ce|circ)|\\[()[\]]/);
});

test('SVG 普通教学文字保持不变，并输出有效的 XML 转义文本', () => {
  const source = '<svg viewBox="0 0 200 80"><text x="10" y="30">定义域：x&lt;5；观察并归纳</text></svg>';
  const normalized = normalizeEducationalSvgMarkup(source);

  assert.match(normalized, /定义域：x&lt;5；观察并归纳/);
  assert.doesNotMatch(normalized, /x<5/);
});

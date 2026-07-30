const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeFigureSvg,
  analyzeGeneratedFigure,
  extractSvgCandidate,
  isRenderableFigureSvg
} = require('../shared/figure-svg-quality');
const { _internals } = require('../server/routes/render');

const validComplexSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs><marker id="arrow"><path d="M0 0 L8 4 L0 8 Z"/></marker></defs>
  <line x1="30" y1="250" x2="370" y2="250" marker-end="url(#arrow)"/>
  <line x1="50" y1="280" x2="50" y2="20" marker-end="url(#arrow)"/>
  <circle cx="210" cy="150" r="80" fill="none"/>
  <line x1="130" y1="190" x2="290" y2="110"/>
  <text x="205" y="145">M</text><text x="285" y="105">B</text>
</svg>`;

test('接受结构完整且包含真实几何关系的复杂 SVG', () => {
  const result = analyzeFigureSvg(validComplexSvg);
  assert.equal(result.ok, true);
  assert.equal(result.geometryCount, 4);
  assert.equal(isRenderableFigureSvg(validComplexSvg), true);
  assert.equal(_internals.isRenderableSvg(validComplexSvg), true);
});

test('可从 Markdown 包裹中提取完整 SVG，但仍执行完整质量门', () => {
  const result = analyzeGeneratedFigure(`\`\`\`svg\n${validComplexSvg}\n\`\`\``, { finishReason: 'stop' });
  assert.equal(result.ok, true);
  assert.equal(result.finishReason, 'stop');
  assert.ok(result.responseLength > result.svg.length);
});

test('明确识别缺失与截断 SVG', () => {
  assert.equal(extractSvgCandidate('普通说明文字').code, 'MISSING_SVG');
  const truncated = analyzeGeneratedFigure('<svg><path d="M0 0 L10 10"/>', { finishReason: 'length' });
  assert.equal(truncated.ok, false);
  assert.equal(truncated.code, 'TRUNCATED_SVG');
  assert.equal(truncated.completeSvg, false);
  assert.equal(truncated.finishReason, 'length');
});

test('拒绝浏览器 XML 解析器不支持的 HTML 命名实体', () => {
  const invalidEntities = ['&nbsp;', '&deg;', '&times;', '&radic;'];
  for (const entity of invalidEntities) {
    const svg = `<svg><rect width="100" height="100"/><text>${entity}</text></svg>`;
    assert.equal(analyzeFigureSvg(svg).code, 'XML_INVALID_ENTITY', entity);
  }

  const validEntities = '<svg><rect width="100" height="100"/><text>x≤0，角为 &#176;</text></svg>';
  assert.equal(analyzeFigureSvg(validEntities).ok, true);
  assert.equal(
    analyzeFigureSvg('<svg><rect width="100" height="100"/><text>x&lt;0</text></svg>').code,
    'XML_INVALID_ENTITY'
  );
});

test('拒绝标签错配、未加引号属性和无效字符引用', () => {
  const values = [
    '<svg><g><rect width="10" height="10"/></svg>',
    '<svg><rect width=10 height="10"/></svg>',
    '<svg><rect width="10" height="10"/><text>&#0;</text></svg>'
  ];
  for (const svg of values) assert.equal(analyzeFigureSvg(svg).ok, false, svg);
});

test('拒绝危险元素、事件属性、外部资源和动态样式', () => {
  const values = [
    '<svg><script>alert(1)</script><rect width="10" height="10"/></svg>',
    '<svg><rect width="10" height="10" onclick="alert(1)"/></svg>',
    '<svg><image href="https://example.com/a.png"/></svg>',
    '<svg><rect width="10" height="10" style="fill:url(https://example.com/a.svg)"/></svg>'
  ];
  for (const svg of values) assert.equal(analyzeFigureSvg(svg).ok, false, svg);
});

test('拒绝非法路径、无几何主体和无效 viewBox', () => {
  assert.equal(analyzeFigureSvg('<svg><path d="L10 10"/></svg>').code, 'INVALID_PATH_DATA');
  assert.equal(analyzeFigureSvg('<svg><path d="M10 10 X90 90"/></svg>').code, 'INVALID_PATH_DATA');
  assert.equal(analyzeFigureSvg('<svg><path d="M10 10 L"/></svg>').code, 'INVALID_PATH_DATA');
  assert.equal(analyzeFigureSvg('<svg><path d="M10 10 C20 20 30 30"/></svg>').code, 'INVALID_PATH_DATA');
  assert.equal(analyzeFigureSvg('<svg><path d="M10 10 A10 10 0 2 0 30 30"/></svg>').code, 'INVALID_PATH_DATA');
  assert.equal(analyzeFigureSvg('<svg><text>只有标题</text></svg>').code, 'NO_GEOMETRY');
  assert.equal(analyzeFigureSvg('<svg viewBox="0 0 0 300"><rect width="10" height="10"/></svg>').code, 'INVALID_VIEWBOX');
});

test('拒绝只有白色背景、隐藏图元或定义区路径的伪图形', () => {
  const values = [
    '<svg viewBox="0 0 400 300"><rect x="0" y="0" width="400" height="300" fill="#fff"/><text>只有文字</text></svg>',
    '<svg><path d="M0 0 L10 10" display="none"/></svg>',
    '<svg><g style="display:none"><circle cx="20" cy="20" r="10"/></g></svg>',
    '<svg><defs><path id="shape" d="M0 0 L10 10"/></defs><text>只有定义</text></svg>',
    '<svg><circle/></svg>',
    '<svg><line x1="1" y1="1" x2="1" y2="1"/></svg>',
    '<svg><rect width="0" height="100"/></svg>',
    '<svg><polyline points="1,1 1,1"/></svg>',
    '<svg><path d="M10 10 Z"/></svg>',
    '<svg><circle cx="10" cy="10" r="5" fill="none" stroke="none"/></svg>'
  ];
  for (const svg of values) assert.equal(analyzeFigureSvg(svg).code, 'NO_GEOMETRY', svg);
});

test('接受安全的内部 use 复用真实定义图元', () => {
  const svg = '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="shape" d="M0 0 L10 10"/></defs><use xlink:href="#shape" x="20" y="20"/></svg>';
  assert.equal(analyzeFigureSvg(svg).ok, true);
});

test('接受 moveto 后续坐标组形成的规范隐式 lineto', () => {
  assert.equal(analyzeFigureSvg('<svg><path d="M0 0 10 10 20 5"/></svg>').ok, true);
});

test('拒绝可见文字中的内部标记、裸 LaTeX 和美元公式', () => {
  const values = [
    'LATEXSLASHfrac{1}{2}',
    '@@BS@@frac{1}{2}',
    '[[LATEX]]x^2[[/LATEX]]',
    '\\frac{1}{2}',
    '\\(x^2\\)',
    '$x^2$'
  ];
  for (const value of values) {
    const svg = `<svg><rect width="100" height="100"/><text>${value}</text></svg>`;
    assert.equal(analyzeFigureSvg(svg).code, 'INVALID_VISIBLE_NOTATION', value);
  }
});

test('拒绝通过 XML 字符引用编码的裸 LaTeX 和非法命名空间前缀', () => {
  const encodedLatex = '<svg><rect width="100" height="100"/><text>&#92;frac{1}{2}</text></svg>';
  assert.equal(analyzeFigureSvg(encodedLatex).code, 'INVALID_VISIBLE_NOTATION');

  const prefixedElement = '<svg><evil:script/><rect width="100" height="100"/></svg>';
  assert.equal(analyzeFigureSvg(prefixedElement).code, 'INVALID_NAMESPACE');

  const prefixedAttribute = '<svg><rect width="100" height="100" evil:onload="run()"/></svg>';
  assert.equal(analyzeFigureSvg(prefixedAttribute).code, 'INVALID_NAMESPACE');

  const undeclaredXlink = '<svg><defs><path id="a" d="M0 0 L10 10"/></defs><use xlink:href="#a"/></svg>';
  assert.equal(analyzeFigureSvg(undeclaredXlink).code, 'INVALID_NAMESPACE');
});

test('九大学科常见符号使用真实 Unicode 或路径时均可通过同一质量门', () => {
  const subjectLabels = {
    '数学': '∠A=60°，x≤3，√3',
    '物理': 'F₁=10 N，v=5 m/s',
    '化学': 'H₂O，Cu²⁺，Δ',
    '生物': 'CO₂ → O₂',
    '地理': '30°N，120°E',
    '历史': '公元前221年 → 1911年',
    '语文': '“学而时习之”',
    '英语': 'A → B，/θ/',
    '政治': '权利 ⇄ 义务'
  };

  for (const [subject, label] of Object.entries(subjectLabels)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><line x1="20" y1="150" x2="380" y2="150"/><text x="50" y="120">${label}</text></svg>`;
    assert.equal(analyzeFigureSvg(svg).ok, true, subject);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBlackboard } from '../src/lessonText.js';

test('板书文本删除表格竖杠和分隔行，同时保留公式绝对值符号', () => {
  const result = sanitizeBlackboard('| 二次函数 |\n|---|---|\n| 图像 | \\(y=|x|\\) |');

  assert.equal(result, '二次函数\n图像 \\(y=|x|\\)');
});

test('板书容错公式不会把闭合符拆到下一行', () => {
  const result = sanitizeBlackboard(String.raw`若物体底部贴合，F_{\向上} = 0
  ⟹
  ⟹ 不受浮力！`);

  assert.equal(result, String.raw`若物体底部贴合，\(F_{\text{向上}} = 0 \Rightarrow\) 不受浮力！`);
  assert.doesNotMatch(result, /^\\Rightarrow\\\)/m);
});

test('板书 SVG 删除重复黑板背景和整幅外框但保留教学图形', () => {
  const source = String.raw`<svg viewBox="0 0 800 450">
    <rect width="800" height="450" fill="#173f34" />
    <rect x="10" y="10" width="780" height="430" fill="none" stroke="#999" stroke-width="6" />
    <rect x="40" y="100" width="220" height="280" fill="none" stroke="#4caf50" />
    <line x1="300" y1="360" x2="720" y2="360" stroke="#fff" />
    <text x="40" y="55">\(\sqrt{x-5} \ge 0\)</text>
  </svg>`;
  const result = sanitizeBlackboard(source);

  assert.doesNotMatch(result, /width="800" height="450"/);
  assert.doesNotMatch(result, /width="780" height="430"/);
  assert.match(result, /width="220" height="280"/);
  assert.match(result, /<line\b/);
  assert.match(result, /√\(x-5\) ≥ 0/);
  assert.doesNotMatch(result, /\\sqrt|\\ge|\\[()]/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { getCanvasScale, getCanvasVerticalOffset, normalizeCanvasColorValue, paginate } from '../src/exportPdf.js';

test('PDF 导出会把 html2canvas 不支持的 color(srgb) 转为 rgba', () => {
  assert.equal(normalizeCanvasColorValue('color(srgb 0.1 0.5 1)'), 'rgba(26, 128, 255, 1)');
  assert.equal(normalizeCanvasColorValue('1px solid color(srgb 20% 40% 60% / 50%)'), '1px solid rgba(51, 102, 153, 0.5)');
  assert.equal(normalizeCanvasColorValue('rgb(10, 20, 30)'), 'rgb(10, 20, 30)');
});

test('PDF 坐标换算使用稳定的横向缩放比', () => {
  const scale = getCanvasScale({ width: 1800, height: 9866 }, { width: 900, height: 5000 });

  assert.equal(scale, 2);
});

test('PDF 坐标换算会补偿 html2canvas 的垂直原点偏移', () => {
  const offset = getCanvasVerticalOffset({ width: 1800, height: 9866 }, { width: 900, height: 5000 });

  assert.equal(offset, 67);
});

test('PDF 分页会避开贴近页尾的模块切点', () => {
  const cuts = paginate(9866, 2557, [758, 1224, 1799, 2155, 2381, 2605, 4152, 4854, 6434, 7044, 8563, 8985, 9625, 9779]);

  assert.equal(cuts[0][1], 2155);
  assert.equal(cuts[1][0], 2155);
  assert.ok(cuts.every(([start, end]) => end > start));
  assert.equal(cuts.at(-1)[1], 9866);
});

test('PDF 分页优先选择足够靠后的章节起点', () => {
  const itemBreakpoints = [2160, 2387, 4172, 4875, 5940, 6193];
  const sectionBreakpoints = [744, 1210, 1784, 2590, 3038, 3322, 5538, 6418, 7029, 7600, 8100, 8549, 8970];
  const cuts = paginate(9866, 2557, itemBreakpoints, sectionBreakpoints);

  assert.equal(cuts[0][1], 1784);
  assert.equal(cuts[1][1], 3322);
  assert.equal(cuts[2][1], 5538);
});

test('PDF 分页不会把靠近页尾的章节标题留在上一页', () => {
  const cuts = paginate(3000, 1000, [], [920, 1900]);

  assert.equal(cuts[0][1], 920);
  assert.equal(cuts[1][0], 920);
});

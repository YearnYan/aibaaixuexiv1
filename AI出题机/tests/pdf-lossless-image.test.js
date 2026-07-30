const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
  buildSubFilteredRgbBytes,
  bytesToBinaryString,
  deflateBytes
} = require('../shared/pdf-lossless-image');

test('PDF 无损 RGB 转换按白底合成透明像素并逐行应用 Predictor 11', () => {
  const rgba = new Uint8ClampedArray([
    10, 20, 30, 255,
    0, 0, 0, 128,
    100, 110, 120, 255,
    200, 210, 220, 255
  ]);
  assert.deepEqual(
    Array.from(buildSubFilteredRgbBytes(rgba, 2, 2)),
    [
      1, 10, 20, 30, 117, 107, 97,
      1, 100, 110, 120, 100, 100, 100
    ]
  );
});

test('PDF 无损 RGB 转换拒绝尺寸和像素数量不一致', () => {
  assert.throws(() => buildSubFilteredRgbBytes(new Uint8Array(4), 0, 1), /正整数/);
  assert.throws(() => buildSubFilteredRgbBytes(new Uint8Array(4), 2, 1), /像素数量不一致/);
});

test('浏览器原生 Deflate 输出可被标准 zlib 完整还原', async () => {
  const source = new Uint8Array([1, 10, 20, 30, 40, 50, 60, 1, 3, 2, 1]);
  const compressed = await deflateBytes(source);
  assert.deepEqual(new Uint8Array(zlib.inflateSync(compressed)), source);
  const binary = bytesToBinaryString(compressed);
  assert.equal(binary.length, compressed.length);
  assert.deepEqual(Uint8Array.from(binary, (character) => character.charCodeAt(0)), compressed);
});

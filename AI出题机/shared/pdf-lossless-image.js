function normalizeDimension(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label}必须是正整数`);
  return number;
}

function compositeChannelOnWhite(channel, alpha) {
  if (alpha === 255) return channel;
  return Math.round((channel * alpha + 255 * (255 - alpha)) / 255);
}

function buildSubFilteredRgbBytes(rgbaPixels, width, height) {
  const imageWidth = normalizeDimension(width, 'PDF 图像宽度');
  const imageHeight = normalizeDimension(height, 'PDF 图像高度');
  const source = rgbaPixels instanceof Uint8ClampedArray || rgbaPixels instanceof Uint8Array
    ? rgbaPixels
    : new Uint8ClampedArray(rgbaPixels || []);
  const expectedLength = imageWidth * imageHeight * 4;
  if (source.length !== expectedLength) {
    throw new Error(`PDF 图像像素数量不一致：应为 ${expectedLength}，实际为 ${source.length}`);
  }

  const rowLength = imageWidth * 3;
  const filtered = new Uint8Array((rowLength + 1) * imageHeight);
  let sourceIndex = 0;
  let targetIndex = 0;
  for (let y = 0; y < imageHeight; y += 1) {
    filtered[targetIndex] = 1; // PDF Predictor 11：每行使用 PNG Sub 滤波。
    targetIndex += 1;
    let leftRed = 0;
    let leftGreen = 0;
    let leftBlue = 0;
    for (let x = 0; x < imageWidth; x += 1) {
      const alpha = source[sourceIndex + 3];
      const red = compositeChannelOnWhite(source[sourceIndex], alpha);
      const green = compositeChannelOnWhite(source[sourceIndex + 1], alpha);
      const blue = compositeChannelOnWhite(source[sourceIndex + 2], alpha);
      filtered[targetIndex] = (red - leftRed + 256) & 255;
      filtered[targetIndex + 1] = (green - leftGreen + 256) & 255;
      filtered[targetIndex + 2] = (blue - leftBlue + 256) & 255;
      leftRed = red;
      leftGreen = green;
      leftBlue = blue;
      sourceIndex += 4;
      targetIndex += 3;
    }
  }
  return filtered;
}

async function deflateBytes(bytes) {
  if (typeof CompressionStream !== 'function' || typeof Blob !== 'function' || typeof Response !== 'function') {
    throw new Error('当前浏览器不支持无损 PDF 原生压缩');
  }
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const stream = new Blob([source]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function bytesToBinaryString(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const chunks = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...source.subarray(offset, offset + chunkSize)));
  }
  return chunks.join('');
}

async function buildLosslessPdfImageRecord(canvas) {
  if (!canvas || !Number.isInteger(canvas.width) || !Number.isInteger(canvas.height)) {
    throw new Error('PDF 画布不可用');
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('PDF 画布无法读取像素');
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const filtered = buildSubFilteredRgbBytes(rgba, canvas.width, canvas.height);
  const compressed = await deflateBytes(filtered);
  if (compressed.length < 8) throw new Error('PDF 无损图像压缩结果无效');
  return {
    binaryData: bytesToBinaryString(compressed),
    width: canvas.width,
    height: canvas.height,
    compressedBytes: compressed.length
  };
}

module.exports = {
  buildLosslessPdfImageRecord,
  buildSubFilteredRgbBytes,
  bytesToBinaryString,
  deflateBytes,
  _internals: { compositeChannelOnWhite, normalizeDimension }
};

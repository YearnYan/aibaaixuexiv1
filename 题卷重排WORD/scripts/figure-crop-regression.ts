import assert from "node:assert/strict";
import { findTightFigureBounds } from "../src/lib/figureBounds.ts";

type Raster = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

function createRaster(width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

function fillRect(raster: Raster, x: number, y: number, width: number, height: number, color = [20, 20, 20]) {
  for (let row = Math.max(0, y); row < Math.min(raster.height, y + height); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(raster.width, x + width); column += 1) {
      const offset = (row * raster.width + column) * 4;
      raster.data[offset] = color[0];
      raster.data[offset + 1] = color[1];
      raster.data[offset + 2] = color[2];
    }
  }
}

function strokeRect(raster: Raster, x: number, y: number, width: number, height: number, thickness = 2) {
  fillRect(raster, x, y, width, thickness);
  fillRect(raster, x, y + height - thickness, width, thickness);
  fillRect(raster, x, y, thickness, height);
  fillRect(raster, x + width - thickness, y, thickness, height);
}

function drawTextLine(raster: Raster, x: number, y: number, characters: number) {
  for (let index = 0; index < characters; index += 1) {
    fillRect(raster, x + index * 10, y + (index % 2), 6, 11);
  }
}

function detect(raster: Raster) {
  const bounds = findTightFigureBounds(raster.data, raster.width, raster.height);
  assert.ok(bounds, "应检测到图形主体");
  return bounds;
}

{
  const raster = createRaster(360, 260);
  drawTextLine(raster, 30, 18, 30);
  drawTextLine(raster, 20, 226, 32);
  drawTextLine(raster, 8, 92, 5);
  strokeRect(raster, 110, 70, 141, 121, 3);
  fillRect(raster, 101, 122, 5, 8);

  const bounds = detect(raster);
  assert.ok(bounds.y >= 64, `上边缘不得包含题干文字，实际 y=${bounds.y}`);
  assert.ok(bounds.y + bounds.height <= 198, "下边缘不得包含题后文字");
  assert.ok(bounds.x >= 96, "左边缘不得包含无关文字");
  assert.ok(bounds.x <= 101, "应保留紧邻图形的内部标签");
  assert.ok(bounds.x + bounds.width >= 251, "不得切掉图形右边框");
}

{
  const raster = createRaster(420, 280);
  drawTextLine(raster, 36, 20, 34);
  drawTextLine(raster, 28, 245, 36);
  strokeRect(raster, 58, 62, 304, 154, 3);
  fillRect(raster, 158, 62, 3, 154);
  fillRect(raster, 260, 62, 3, 154);
  fillRect(raster, 58, 112, 304, 3);
  fillRect(raster, 58, 164, 304, 3);
  drawTextLine(raster, 84, 82, 7);

  const bounds = detect(raster);
  assert.ok(bounds.x <= 58 && bounds.x >= 50, "表格左外框应完整且留白有限");
  assert.ok(bounds.x + bounds.width >= 362 && bounds.x + bounds.width <= 370, "表格右外框应完整且留白有限");
  assert.ok(bounds.y >= 56, "表格上方题干不得进入裁切结果");
  assert.ok(bounds.y + bounds.height <= 222, "表格下方文字不得进入裁切结果");
}

{
  const raster = createRaster(300, 220);
  drawTextLine(raster, 25, 16, 24);
  strokeRect(raster, 76, 54, 150, 120, 3);
  fillRect(raster, 108, 88, 84, 8, [38, 132, 196]);

  const bounds = detect(raster);
  const sourceRatio = bounds.width / bounds.height;
  assert.ok(sourceRatio > 1.15 && sourceRatio < 1.35, "裁切坐标必须保留图形原始宽高比信息");
  assert.ok(bounds.y >= 48, "彩色图形上方文字不得进入裁切结果");
}

console.log("图形精准裁切回归测试通过");

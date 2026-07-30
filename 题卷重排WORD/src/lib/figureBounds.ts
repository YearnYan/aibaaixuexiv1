export type PixelBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type InkComponent = PixelBounds & {
  pixels: number;
};

const MIN_ALPHA = 24;
const COLOR_DISTANCE_THRESHOLD = 48;

/**
 * 从候选区域中找出图形主体。算法优先保留大跨度线条、表格边框和连续图像，
 * 再吸附主体内部及紧邻主体的小标签，从而排除候选框边缘的题干文字。
 */
export function findTightFigureBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): PixelBounds | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) return null;
  if (rgba.length < width * height * 4) return null;

  const background = estimateBackground(rgba, width, height);
  const mask = createInkMask(rgba, width, height, background);
  const components = collectInkComponents(mask, width, height);
  if (!components.length) return null;

  const imageArea = width * height;
  const minDimension = Math.min(width, height);
  const longSpan = Math.max(10, Math.round(minDimension * 0.1));
  const minMass = Math.max(12, Math.round(imageArea * 0.0012));
  const minBoxArea = Math.max(24, Math.round(imageArea * 0.006));
  const textHeight = Math.max(7, Math.round(minDimension * 0.065));
  const textWidth = Math.max(10, Math.round(minDimension * 0.09));

  const anchors = components.filter((component) => {
    const boxArea = component.width * component.height;
    const textLike = component.height <= textHeight
      && component.width <= textWidth
      && component.pixels < minMass;
    if (textLike) return false;
    return Math.max(component.width, component.height) >= longSpan
      || component.pixels >= minMass
      || boxArea >= minBoxArea;
  });

  if (!anchors.length) {
    return addSafetyPadding(unionBounds(components), width, height);
  }

  const primary = anchors.reduce((best, component) => (
    scoreAnchor(component, width, height) > scoreAnchor(best, width, height) ? component : best
  ));
  const selected = new Set<InkComponent>([primary]);
  const associationDistance = Math.max(4, Math.round(minDimension * 0.035));
  const panelDistance = Math.max(associationDistance, Math.round(minDimension * 0.12));

  let changed = true;
  while (changed) {
    changed = false;
    const core = unionBounds([...selected]);
    for (const component of anchors) {
      if (selected.has(component)) continue;
      const gap = boundsGap(core, component);
      const horizontalOverlap = overlapRatio(core.y, core.height, component.y, component.height);
      const verticalOverlap = overlapRatio(core.x, core.width, component.x, component.width);
      const isNear = gap.x <= associationDistance && gap.y <= associationDistance;
      const isSameVisualBand = (
        gap.x <= panelDistance && gap.y === 0 && horizontalOverlap >= 0.2
      ) || (
        gap.y <= panelDistance && gap.x === 0 && verticalOverlap >= 0.2
      );
      if (!isNear && !isSameVisualBand) continue;
      selected.add(component);
      changed = true;
    }
  }

  const anchorBounds = unionBounds([...selected]);
  const labelPadding = Math.max(3, Math.min(10, Math.round(minDimension * 0.025)));
  const labelRegion = expandBounds(anchorBounds, labelPadding, width, height);
  const retained = components.filter((component) => (
    selected.has(component)
    || containsPoint(
      labelRegion,
      component.x + component.width / 2,
      component.y + component.height / 2,
    )
  ));

  return addSafetyPadding(unionBounds(retained), width, height);
}

function estimateBackground(rgba: Uint8ClampedArray, width: number, height: number) {
  const histogram = new Uint32Array(256);
  const pixelCount = width * height;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (rgba[offset + 3] < MIN_ALPHA) continue;
    histogram[luminance(rgba[offset], rgba[offset + 1], rgba[offset + 2])] += 1;
  }

  const brightLuminance = percentile(histogram, 0.88);
  let red = 0;
  let green = 0;
  let blue = 0;
  let samples = 0;
  const brightFloor = Math.max(0, brightLuminance - 6);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (rgba[offset + 3] < MIN_ALPHA) continue;
    const value = luminance(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
    if (value < brightFloor) continue;
    red += rgba[offset];
    green += rgba[offset + 1];
    blue += rgba[offset + 2];
    samples += 1;
  }

  return {
    red: samples ? red / samples : 255,
    green: samples ? green / samples : 255,
    blue: samples ? blue / samples : 255,
    luminance: brightLuminance,
  };
}

function createInkMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  background: { red: number; green: number; blue: number; luminance: number },
) {
  const mask = new Uint8Array(width * height);
  const inkLuminance = Math.max(72, Math.min(232, background.luminance - 22));
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    if (rgba[offset + 3] < MIN_ALPHA) continue;
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    const value = luminance(red, green, blue);
    const colorDistance = Math.sqrt(
      (red - background.red) ** 2
      + (green - background.green) ** 2
      + (blue - background.blue) ** 2,
    );
    if (value <= inkLuminance || (colorDistance >= COLOR_DISTANCE_THRESHOLD && value < background.luminance + 10)) {
      mask[index] = 1;
    }
  }
  return mask;
}

function collectInkComponents(mask: Uint8Array, width: number, height: number) {
  const components: InkComponent[] = [];
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const minPixels = Math.max(2, Math.round(mask.length * 0.000004));

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    let left = start % width;
    let right = left;
    let top = Math.floor(start / width);
    let bottom = top;
    let pixels = 0;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      pixels += 1;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      }
    }

    if (pixels < minPixels) continue;
    components.push({
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
      pixels,
    });
  }

  return components;
}

function scoreAnchor(component: InkComponent, width: number, height: number) {
  const normalizedWidth = component.width / width;
  const normalizedHeight = component.height / height;
  const normalizedMass = component.pixels / (width * height);
  const boxArea = normalizedWidth * normalizedHeight;
  const twoDimensionality = Math.min(normalizedWidth, normalizedHeight);
  const span = Math.max(normalizedWidth, normalizedHeight);
  const centerX = (component.x + component.width / 2) / width;
  const centerY = (component.y + component.height / 2) / height;
  const centrality = 1 - Math.min(1, Math.hypot(centerX - 0.5, centerY - 0.5) / 0.71);
  return normalizedMass * 5
    + Math.sqrt(boxArea) * 2
    + twoDimensionality * 2
    + span * 0.8
    + centrality * 0.2;
}

function unionBounds(bounds: PixelBounds[]) {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const item of bounds) {
    left = Math.min(left, item.x);
    top = Math.min(top, item.y);
    right = Math.max(right, item.x + item.width);
    bottom = Math.max(bottom, item.y + item.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function boundsGap(left: PixelBounds, right: PixelBounds) {
  return {
    x: Math.max(0, Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width)),
    y: Math.max(0, Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height)),
  };
}

function overlapRatio(start: number, size: number, otherStart: number, otherSize: number) {
  const overlap = Math.max(0, Math.min(start + size, otherStart + otherSize) - Math.max(start, otherStart));
  return overlap / Math.max(1, Math.min(size, otherSize));
}

function expandBounds(bounds: PixelBounds, padding: number, width: number, height: number) {
  const left = Math.max(0, bounds.x - padding);
  const top = Math.max(0, bounds.y - padding);
  const right = Math.min(width, bounds.x + bounds.width + padding);
  const bottom = Math.min(height, bounds.y + bounds.height + padding);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function addSafetyPadding(bounds: PixelBounds, width: number, height: number) {
  const padding = Math.max(2, Math.min(7, Math.round(Math.min(bounds.width, bounds.height) * 0.012)));
  return expandBounds(bounds, padding, width, height);
}

function containsPoint(bounds: PixelBounds, x: number, y: number) {
  return x >= bounds.x
    && x <= bounds.x + bounds.width
    && y >= bounds.y
    && y <= bounds.y + bounds.height;
}

function percentile(histogram: Uint32Array, ratio: number) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (!total) return 255;
  const target = Math.max(1, Math.ceil(total * ratio));
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen >= target) return value;
  }
  return 255;
}

function luminance(red: number, green: number, blue: number) {
  return Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
}

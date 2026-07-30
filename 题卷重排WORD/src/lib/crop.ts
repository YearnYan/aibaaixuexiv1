import type { BBox, UploadedPage } from "../types";
import { findTightFigureBounds } from "./figureBounds";

type CropOptions = {
  preserveContext?: boolean;
  refineContent?: boolean;
  neighborBboxes?: BBox[];
};

const ANALYSIS_MAX_EDGE = 900;
const SEARCH_MARGIN_RATIO = 0.006;
const SEARCH_MARGIN_MIN_PX = 2;
const SEARCH_MARGIN_MAX_PX = 6;
const MAX_CACHED_PAGE_IMAGES = 12;
const pageImageCache = new Map<string, Promise<HTMLImageElement>>();

export async function cropFigureFromPage(page: UploadedPage, bbox: BBox, options: CropOptions = {}) {
  const image = await loadImage(page.imageDataUrl);
  const imageWidth = image.naturalWidth || page.width;
  const imageHeight = image.naturalHeight || page.height;
  const requested = bboxToPixels(bbox, imageWidth, imageHeight);
  const neighbors = (options.neighborBboxes || []).map((item) => bboxToPixels(item, imageWidth, imageHeight));
  const shouldRefine = options.refineContent ?? options.preserveContext !== false;
  const source = shouldRefine
    ? refineSourceBounds(image, requested, imageWidth, imageHeight, neighbors)
    : constrainToNeighbors(requested, neighbors, imageWidth, imageHeight);
  const safeSource = constrainToNeighbors(source, neighbors, imageWidth, imageHeight);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器无法创建裁切画布");
  }

  canvas.width = safeSource.width;
  canvas.height = safeSource.height;
  context.drawImage(
    image,
    safeSource.x,
    safeSource.y,
    safeSource.width,
    safeSource.height,
    0,
    0,
    safeSource.width,
    safeSource.height,
  );

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
    bbox: pixelsToBbox(safeSource, imageWidth, imageHeight),
  };
}

function bboxToPixels(bbox: BBox, pageWidth: number, pageHeight: number) {
  const x = clamp(Math.floor(bbox.x * pageWidth), 0, pageWidth - 1);
  const y = clamp(Math.floor(bbox.y * pageHeight), 0, pageHeight - 1);
  const right = clamp(Math.ceil((bbox.x + bbox.width) * pageWidth), x + 1, pageWidth);
  const bottom = clamp(Math.ceil((bbox.y + bbox.height) * pageHeight), y + 1, pageHeight);
  return { x, y, width: right - x, height: bottom - y };
}

function refineSourceBounds(
  image: HTMLImageElement,
  requested: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
  neighbors: Array<{ x: number; y: number; width: number; height: number }>,
) {
  const searchMargin = Math.round(clamp(
    Math.min(requested.width, requested.height) * SEARCH_MARGIN_RATIO,
    SEARCH_MARGIN_MIN_PX,
    SEARCH_MARGIN_MAX_PX,
  ));
  const candidate = constrainToNeighbors(
    expandPixelBounds(requested, searchMargin, imageWidth, imageHeight),
    neighbors,
    imageWidth,
    imageHeight,
  );
  const analysisScale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(candidate.width, candidate.height));
  const analysisWidth = Math.max(2, Math.round(candidate.width * analysisScale));
  const analysisHeight = Math.max(2, Math.round(candidate.height * analysisScale));
  const analysisCanvas = document.createElement("canvas");
  const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
  if (!analysisContext) return requested;

  analysisCanvas.width = analysisWidth;
  analysisCanvas.height = analysisHeight;
  analysisContext.fillStyle = "#ffffff";
  analysisContext.fillRect(0, 0, analysisWidth, analysisHeight);
  analysisContext.drawImage(
    image,
    candidate.x,
    candidate.y,
    candidate.width,
    candidate.height,
    0,
    0,
    analysisWidth,
    analysisHeight,
  );

  const imageData = analysisContext.getImageData(0, 0, analysisWidth, analysisHeight);
  const tight = findTightFigureBounds(imageData.data, analysisWidth, analysisHeight);
  if (!tight) return requested;

  const scaleX = candidate.width / analysisWidth;
  const scaleY = candidate.height / analysisHeight;
  const left = clamp(candidate.x + Math.floor(tight.x * scaleX), 0, imageWidth - 1);
  const top = clamp(candidate.y + Math.floor(tight.y * scaleY), 0, imageHeight - 1);
  const right = clamp(
    candidate.x + Math.ceil((tight.x + tight.width) * scaleX),
    left + 1,
    imageWidth,
  );
  const bottom = clamp(
    candidate.y + Math.ceil((tight.y + tight.height) * scaleY),
    top + 1,
    imageHeight,
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function constrainToNeighbors(
  bounds: { x: number; y: number; width: number; height: number },
  neighbors: Array<{ x: number; y: number; width: number; height: number }>,
  pageWidth: number,
  pageHeight: number,
) {
  let left = bounds.x;
  let top = bounds.y;
  let right = bounds.x + bounds.width;
  let bottom = bounds.y + bounds.height;
  for (const neighbor of neighbors) {
    const horizontalOverlap = Math.min(bottom, neighbor.y + neighbor.height) - Math.max(top, neighbor.y);
    const verticalOverlap = Math.min(right, neighbor.x + neighbor.width) - Math.max(left, neighbor.x);
    if (neighbor.x + neighbor.width <= left && horizontalOverlap > 0) {
      left = Math.max(left, neighbor.x + neighbor.width + 2);
    } else if (neighbor.x >= right && horizontalOverlap > 0) {
      right = Math.min(right, neighbor.x - 2);
    }
    if (neighbor.y + neighbor.height <= top && verticalOverlap > 0) {
      top = Math.max(top, neighbor.y + neighbor.height + 2);
    } else if (neighbor.y >= bottom && verticalOverlap > 0) {
      bottom = Math.min(bottom, neighbor.y - 2);
    }
  }
  left = clamp(left, 0, pageWidth - 1);
  top = clamp(top, 0, pageHeight - 1);
  right = clamp(right, left + 1, pageWidth);
  bottom = clamp(bottom, top + 1, pageHeight);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function expandPixelBounds(
  bounds: { x: number; y: number; width: number; height: number },
  padding: number,
  pageWidth: number,
  pageHeight: number,
) {
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const right = Math.min(pageWidth, bounds.x + bounds.width + padding);
  const bottom = Math.min(pageHeight, bounds.y + bounds.height + padding);
  return { x, y, width: right - x, height: bottom - y };
}

function pixelsToBbox(
  source: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
): BBox {
  return {
    x: source.x / pageWidth,
    y: source.y / pageHeight,
    width: source.width / pageWidth,
    height: source.height / pageHeight,
  };
}

function loadImage(src: string) {
  const cached = pageImageCache.get(src);
  if (cached) {
    // 刷新 LRU 顺序：同页多个图形裁切时复用已解码的源图。
    pageImageCache.delete(src);
    pageImageCache.set(src, cached);
    return cached;
  }

  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("裁切图加载失败"));
    image.src = src;
  });

  pageImageCache.set(src, pending);
  while (pageImageCache.size > MAX_CACHED_PAGE_IMAGES) {
    const oldest = pageImageCache.keys().next().value;
    if (!oldest) break;
    pageImageCache.delete(oldest);
  }
  void pending.catch(() => pageImageCache.delete(src));
  return pending;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

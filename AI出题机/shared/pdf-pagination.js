function computeAtomicPageSlices({
  canvasHeight,
  contentHeight,
  pagePixelHeight,
  atomicRanges = []
} = {}) {
  const physicalHeight = Number(canvasHeight);
  const meaningfulHeight = Number(contentHeight);
  const pageHeight = Number(pagePixelHeight);
  if (!Number.isFinite(physicalHeight) || physicalHeight <= 0) {
    throw new Error('PDF 画布高度无效');
  }
  if (!Number.isFinite(meaningfulHeight) || meaningfulHeight <= 0) {
    throw new Error('PDF 有效内容高度无效');
  }
  if (meaningfulHeight > physicalHeight + 1) {
    throw new Error('PDF 有效内容高度超过画布范围');
  }
  if (!Number.isFinite(pageHeight) || pageHeight <= 1) {
    throw new Error('PDF 页面高度无效');
  }
  const totalHeight = Math.min(Math.round(physicalHeight), Math.ceil(meaningfulHeight));

  const ranges = atomicRanges
    .map((range) => ({
      top: Math.max(0, Math.round(Number(range?.top))),
      bottom: Math.min(Math.round(totalHeight), Math.round(Number(range?.bottom))),
      label: String(range?.label || '内容块')
    }))
    .filter((range) => Number.isFinite(range.top)
      && Number.isFinite(range.bottom)
      && range.bottom > range.top)
    .sort((left, right) => left.top - right.top || right.bottom - left.bottom);

  const oversized = ranges.find((range) => range.bottom - range.top > pageHeight + 1);
  if (oversized) {
    const error = new Error(`${oversized.label}高度超过一整页，无法在不切割内容的前提下导出 PDF`);
    error.code = 'PDF_ATOMIC_BLOCK_TOO_TALL';
    throw error;
  }

  const slices = [];
  let start = 0;
  while (start < totalHeight) {
    const target = Math.min(Math.round(totalHeight), Math.round(start + pageHeight));
    if (target >= totalHeight) {
      slices.push([start, Math.round(totalHeight)]);
      break;
    }

    const crossingRanges = ranges.filter((range) => range.top < target && range.bottom > target);
    const breakBefore = crossingRanges
      .map((range) => range.top)
      .filter((top) => top > start + 1)
      .sort((left, right) => left - right)[0];

    if (breakBefore === undefined && crossingRanges.length > 0) {
      const error = new Error(`${crossingRanges[0].label}无法找到安全分页边界`);
      error.code = 'PDF_ATOMIC_BOUNDARY_UNRESOLVED';
      throw error;
    }

    const end = breakBefore === undefined ? target : breakBefore;
    if (end <= start) {
      const error = new Error('PDF 分页没有产生有效进度');
      error.code = 'PDF_PAGINATION_STALLED';
      throw error;
    }
    slices.push([start, end]);
    start = end;
  }

  return slices;
}

module.exports = { computeAtomicPageSlices };

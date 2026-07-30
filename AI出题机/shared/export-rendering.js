async function mapWithConcurrency(items, limit, worker) {
  const source = Array.from(items || []);
  if (source.length === 0) return [];
  const concurrency = Math.max(1, Math.min(source.length, Number.parseInt(limit, 10) || 1));
  const results = new Array(source.length);
  let cursor = 0;

  async function consume() {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(source[index], index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, consume));
  return results;
}

async function renderItemsByKey(items, options = {}) {
  const source = Array.from(items || []);
  const keyOf = options.keyOf;
  const render = options.render;
  if (typeof keyOf !== 'function' || typeof render !== 'function') {
    throw new TypeError('按内容渲染必须提供 keyOf 与 render 函数');
  }

  const cache = options.cache instanceof Map ? options.cache : new Map();
  const maxCacheEntries = Math.max(1, Number.parseInt(options.maxCacheEntries, 10) || 256);
  const uniqueItems = new Map();
  const exportRecords = new Map();
  const keys = source.map((item, index) => {
    const key = String(keyOf(item, index) || '');
    if (!key) throw new Error('渲染内容键不能为空');
    if (cache.has(key)) exportRecords.set(key, cache.get(key));
    if (!cache.has(key) && !uniqueItems.has(key)) uniqueItems.set(key, item);
    return key;
  });

  const misses = Array.from(uniqueItems.entries());
  const rendered = await mapWithConcurrency(misses, options.concurrency || 4, async ([key, item]) => ({
    key,
    value: await render(item, key)
  }));

  for (const { key, value } of rendered) {
    exportRecords.set(key, value);
    while (cache.size >= maxCacheEntries && !cache.has(key)) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, value);
  }

  const result = new Map();
  source.forEach((item, index) => {
    const value = exportRecords.get(keys[index]);
    if (!value) throw new Error('当前导出缺少已完成渲染结果');
    result.set(item, value);
  });
  return result;
}

module.exports = { mapWithConcurrency, renderItemsByKey };

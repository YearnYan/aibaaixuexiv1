const PLATFORM_SITE_KEY_PATTERN = /^[a-z0-9-]+$/u;
const RESERVED_ROOT_SEGMENTS = new Set([
  'api',
  'assets',
  'generated',
  'styles.css',
  'favicon.ico',
]);

export function getPlatformSiteKey(documentRef = globalThis.document) {
  const siteKey = documentRef
    ?.querySelector?.('meta[data-teacher-ai-platform-shell]')
    ?.getAttribute?.('data-teacher-ai-platform-shell');
  const normalized = String(siteKey || '').trim();
  return PLATFORM_SITE_KEY_PATTERN.test(normalized) ? normalized : '';
}

/**
 * 从当前页面地址推断主站代理前缀。
 *
 * 子站既可能部署在 /apps/<site-key>/ 下，也可能通过本地平台的中文目录
 * 直接访问。独立运行在生成器端口根路径时不返回前缀，避免改变原有地址。
 */
export function getPlatformRoutePrefix(locationRef = globalThis.location) {
  const pathname = String(locationRef?.pathname || '').trim();
  if (!pathname || pathname === '/') return '';

  const generatedIndex = pathname.indexOf('/generated/');
  const routePath = generatedIndex >= 0 ? pathname.slice(0, generatedIndex) : pathname;
  const segments = routePath.split('/').filter(Boolean);
  if (segments.length === 0) return '';

  if (segments[0] === 'apps') {
    return PLATFORM_SITE_KEY_PATTERN.test(segments[1] || '')
      ? `/apps/${segments[1]}`
      : '';
  }

  const firstSegment = segments[0];
  return RESERVED_ROOT_SEGMENTS.has(firstSegment) ? '' : `/${firstSegment}`;
}

export function resolveResultImageUrl(source, siteKey = '', locationRef = globalThis.location) {
  const value = String(source || '').trim();
  if (!value.startsWith('/generated/')) return value;

  const normalizedSiteKey = String(siteKey || '').trim();
  const routePrefix = PLATFORM_SITE_KEY_PATTERN.test(normalizedSiteKey)
    ? `/apps/${normalizedSiteKey}`
    : getPlatformRoutePrefix(locationRef);
  return routePrefix ? `${routePrefix}${value}` : value;
}

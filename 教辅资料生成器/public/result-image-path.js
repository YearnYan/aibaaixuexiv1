const PLATFORM_SITE_KEY_PATTERN = /^[a-z0-9-]+$/u;

export function getPlatformSiteKey(documentRef = globalThis.document) {
  const siteKey = documentRef
    ?.querySelector?.('meta[data-teacher-ai-platform-shell]')
    ?.getAttribute?.('data-teacher-ai-platform-shell');
  const normalized = String(siteKey || '').trim();
  return PLATFORM_SITE_KEY_PATTERN.test(normalized) ? normalized : '';
}

export function resolveResultImageUrl(source, siteKey = '') {
  const value = String(source || '').trim();
  const normalizedSiteKey = String(siteKey || '').trim();
  if (
    !value.startsWith('/generated/')
    || !PLATFORM_SITE_KEY_PATTERN.test(normalizedSiteKey)
  ) {
    return value;
  }
  return `/apps/${normalizedSiteKey}${value}`;
}

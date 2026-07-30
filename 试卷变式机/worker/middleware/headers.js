// Security headers and request ID middleware for Cloudflare Workers

export async function securityHeaders(c, next) {
  await next();
  const isProduction = (c.env.NODE_ENV || '').toLowerCase() === 'production';
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  if (isProduction) {
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
    );
  }
}

export async function attachRequestId(c, next) {
  const incomingId = c.req.header('x-cx-request-id');
  const requestId = (incomingId && incomingId.trim())
    ? incomingId.trim().slice(0, 128)
    : crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-CX-Request-Id', requestId);
  await next();
}

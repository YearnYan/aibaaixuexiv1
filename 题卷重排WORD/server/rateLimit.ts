import type { RequestHandler } from "express";

type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  message: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export function createRateLimit(options: RateLimitOptions): RequestHandler {
  const entries = new Map<string, RateLimitEntry>();
  let lastCleanupAt = 0;

  return (request, response, next) => {
    const now = Date.now();
    if (now - lastCleanupAt > options.windowMs) {
      lastCleanupAt = now;
      for (const [key, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(key);
      }
    }

    const key = `${request.path}:${request.ip || request.socket.remoteAddress || "unknown"}`;
    const entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entries.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (entry.count >= options.maxRequests) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1_000))));
      response.status(429).json({ message: options.message });
      return;
    }

    entry.count += 1;
    next();
  };
}

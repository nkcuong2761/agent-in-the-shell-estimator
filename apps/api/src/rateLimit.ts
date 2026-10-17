/** Fixed-window, in-memory rate limit per client IP. Good enough for one instance / a hackathon demo. */
import type { MiddlewareHandler } from 'hono';
import { errorBody } from './errors';

interface Bucket {
  count: number;
  resetAt: number;
}

export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || headers.get('cf-connecting-ip') || 'local';
}

export function rateLimit(opts: { limit: number; windowMs: number; name: string }): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  return async (c, next) => {
    const now = Date.now();
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    const key = clientIp(c.req.raw.headers);
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count++;
    c.header('RateLimit-Limit', String(opts.limit));
    c.header('RateLimit-Remaining', String(Math.max(0, opts.limit - b.count)));
    c.header('RateLimit-Reset', String(Math.ceil((b.resetAt - now) / 1000)));
    if (b.count > opts.limit) {
      c.header('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
      return c.json(errorBody('rate_limited', `Too many ${opts.name} requests. Limit is ${opts.limit} per minute; try again shortly.`), 429);
    }
    await next();
  };
}

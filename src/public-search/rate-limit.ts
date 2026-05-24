export type FixedWindowRateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

type RateLimitBucket = {
  count: number;
  windowStart: number;
};

export function createFixedWindowRateLimiter(options: { limit: number; windowMs: number; now?: () => number }) {
  if (!Number.isFinite(options.limit) || options.limit <= 0) {
    throw new Error('Rate limit must be a positive number');
  }

  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
    throw new Error('Rate limit windowMs must be a positive number');
  }

  const limit = Math.floor(options.limit);
  const windowMs = Math.floor(options.windowMs);
  const now = options.now ?? Date.now;
  const buckets = new Map<string, RateLimitBucket>();

  return {
    check(key: string): FixedWindowRateLimitResult {
      const currentTime = now();
      const existing = buckets.get(key);

      if (!existing || currentTime >= existing.windowStart + windowMs) {
        buckets.set(key, {
          count: 1,
          windowStart: currentTime
        });
        return { allowed: true };
      }

      if (existing.count >= limit) {
        return {
          allowed: false,
          retryAfterMs: existing.windowStart + windowMs - currentTime
        };
      }

      existing.count += 1;
      return { allowed: true };
    }
  };
}

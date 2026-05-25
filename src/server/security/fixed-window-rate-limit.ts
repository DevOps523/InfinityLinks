export type FixedWindowRateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

type RateLimitBucket = {
  count: number;
  windowStart: number;
};

export function createFixedWindowRateLimiter(options: { limit: number; windowMs: number; now?: () => number }) {
  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error('Rate limit must be a positive integer');
  }

  if (!Number.isInteger(options.windowMs) || options.windowMs <= 0) {
    throw new Error('Rate limit windowMs must be a positive integer');
  }

  const buckets = new Map<string, RateLimitBucket>();
  const now = options.now ?? Date.now;

  function pruneExpiredBuckets(currentTime: number) {
    for (const [key, bucket] of buckets) {
      if (currentTime >= bucket.windowStart + options.windowMs) {
        buckets.delete(key);
      }
    }
  }

  return {
    check(key: string): FixedWindowRateLimitResult {
      const currentTime = now();
      pruneExpiredBuckets(currentTime);

      const existing = buckets.get(key);
      if (!existing) {
        buckets.set(key, { count: 1, windowStart: currentTime });
        return { allowed: true };
      }

      if (existing.count >= options.limit) {
        return { allowed: false, retryAfterMs: existing.windowStart + options.windowMs - currentTime };
      }

      existing.count += 1;
      return { allowed: true };
    }
  };
}

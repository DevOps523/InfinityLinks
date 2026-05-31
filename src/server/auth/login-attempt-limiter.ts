type LoginAttemptBucket = {
  count: number;
  windowStart: number;
};

export type LoginAttemptLimiter = ReturnType<typeof createLoginAttemptLimiter>;

export function createLoginAttemptLimiter(options: { limit: number; windowMs: number; maxBuckets?: number; now?: () => number }) {
  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error('Login attempt limit must be a positive integer');
  }

  if (!Number.isInteger(options.windowMs) || options.windowMs <= 0) {
    throw new Error('Login attempt windowMs must be a positive integer');
  }

  const maxBuckets = options.maxBuckets ?? 5000;
  if (!Number.isInteger(maxBuckets) || maxBuckets <= 0) {
    throw new Error('Login attempt maxBuckets must be a positive integer');
  }

  const buckets = new Map<string, LoginAttemptBucket>();
  const now = options.now ?? Date.now;

  function pruneExpiredBuckets(currentTime: number) {
    for (const [key, bucket] of buckets) {
      if (currentTime >= bucket.windowStart + options.windowMs) {
        buckets.delete(key);
      }
    }
  }

  return {
    isBlocked(key: string) {
      const currentTime = now();
      pruneExpiredBuckets(currentTime);
      return (buckets.get(key)?.count ?? 0) >= options.limit;
    },

    recordFailure(key: string) {
      const currentTime = now();
      pruneExpiredBuckets(currentTime);

      const existing = buckets.get(key);
      if (!existing) {
        if (buckets.size >= maxBuckets) {
          const oldestKey = buckets.keys().next().value as string | undefined;
          if (oldestKey) {
            buckets.delete(oldestKey);
          }
        }

        buckets.set(key, { count: 1, windowStart: currentTime });
        return;
      }

      existing.count += 1;
    },

    clear(key: string) {
      buckets.delete(key);
    }
  };
}

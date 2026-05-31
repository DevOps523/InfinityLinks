import { describe, expect, it } from 'vitest';
import { createLoginAttemptLimiter } from '../../src/server/auth/login-attempt-limiter.js';

describe('login attempt limiter', () => {
  it('blocks a key after the configured failed-attempt limit', () => {
    let now = 1000;
    const limiter = createLoginAttemptLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    const key = '203.0.113.10:admin@example.com';

    expect(limiter.isBlocked(key)).toBe(false);
    limiter.recordFailure(key);
    limiter.recordFailure(key);
    expect(limiter.isBlocked(key)).toBe(false);

    limiter.recordFailure(key);

    expect(limiter.isBlocked(key)).toBe(true);
    expect(limiter.isBlocked('203.0.113.10:other@example.com')).toBe(false);
    expect(limiter.isBlocked('198.51.100.25:admin@example.com')).toBe(false);

    now += 60_000;

    expect(limiter.isBlocked(key)).toBe(false);
  });

  it('clears accumulated failures after a successful login', () => {
    const limiter = createLoginAttemptLimiter({ limit: 3, windowMs: 60_000 });
    const key = '203.0.113.10:admin@example.com';

    limiter.recordFailure(key);
    limiter.recordFailure(key);
    limiter.clear(key);
    limiter.recordFailure(key);

    expect(limiter.isBlocked(key)).toBe(false);
  });

  it('caps active buckets by evicting the oldest bucket', () => {
    const limiter = createLoginAttemptLimiter({ limit: 1, windowMs: 60_000, maxBuckets: 2 });

    limiter.recordFailure('203.0.113.10:admin@example.com');
    limiter.recordFailure('203.0.113.11:admin@example.com');
    limiter.recordFailure('203.0.113.12:admin@example.com');

    expect(limiter.isBlocked('203.0.113.10:admin@example.com')).toBe(false);
    expect(limiter.isBlocked('203.0.113.11:admin@example.com')).toBe(true);
    expect(limiter.isBlocked('203.0.113.12:admin@example.com')).toBe(true);
  });
});

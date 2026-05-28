import { createFixedWindowRateLimiter, type FixedWindowRateLimitResult } from '../rate-limit.js';
import type { PublicSearchAccessClass } from '../subscriptions/access.service.js';

export type PublicSearchRateLimitAction = 'message' | 'search' | 'season' | 'blocked-message';

export type PublicSearchRateLimitInput = {
  action: PublicSearchRateLimitAction;
  accessClass?: PublicSearchAccessClass | undefined;
  userId?: number | undefined;
};

export type PublicSearchInteractionRateLimiter = {
  check(input: PublicSearchRateLimitInput): FixedWindowRateLimitResult;
};

type RatePolicyOptions = {
  now?: () => number;
};

const WINDOW_MS = 60_000;

export function createPublicSearchInteractionRateLimiter(
  options: RatePolicyOptions = {}
): PublicSearchInteractionRateLimiter {
  const now = options.now;
  const messageLimiter = createFixedWindowRateLimiter({ limit: 5, windowMs: WINDOW_MS, now });
  const paidSearchLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: WINDOW_MS, now });
  const paidSeasonLimiter = createFixedWindowRateLimiter({ limit: 20, windowMs: WINDOW_MS, now });
  const trialSearchLimiter = createFixedWindowRateLimiter({ limit: 5, windowMs: WINDOW_MS, now });
  const trialSeasonLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: WINDOW_MS, now });
  const blockedMessageLimiter = createFixedWindowRateLimiter({ limit: 3, windowMs: WINDOW_MS, now });

  return {
    check(input) {
      const userKey = input.userId ?? 'unknown';

      if (input.action === 'message') {
        return messageLimiter.check(`message:${userKey}`);
      }

      if (input.action === 'blocked-message' || input.accessClass === 'blocked') {
        return blockedMessageLimiter.check(`blocked-message:${userKey}`);
      }

      if (input.action === 'search' && input.accessClass === 'paid') {
        return paidSearchLimiter.check(`paid:search:${userKey}`);
      }

      if (input.action === 'season' && input.accessClass === 'paid') {
        return paidSeasonLimiter.check(`paid:season:${userKey}`);
      }

      if (input.action === 'search' && input.accessClass === 'trial-active') {
        return trialSearchLimiter.check(`trial:search:${userKey}`);
      }

      if (input.action === 'season' && input.accessClass === 'trial-active') {
        return trialSeasonLimiter.check(`trial:season:${userKey}`);
      }

      return blockedMessageLimiter.check(`blocked-message:${userKey}`);
    }
  };
}

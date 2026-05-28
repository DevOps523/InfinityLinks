# Public Search Rate Limit Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give active subscribers smoother public-search-bot limits while keeping trial quota strict and blocking unpaid, kicked, and removed users from content access.

**Architecture:** Add a small access-classification helper that does not consume trial quota, then route bot interactions through a status/action-aware rate policy built on the existing fixed-window limiter. The handler will block exhausted trial, unpaid, kicked, and removed users before catalog lookup and use a separate throttle for repeated subscription/pricing messages.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Telegram bot handler tests, existing `createFixedWindowRateLimiter`.

---

## File Structure

- Modify `apps/public-search-bot/src/subscriptions/access.service.ts`: add `PublicSearchAccessClass`, classify users for rate limiting without consuming quota, and make non-consuming season access block exhausted trial users.
- Create `apps/public-search-bot/src/bot/rate-policy.ts`: centralize paid/trial/blocked interaction limits with separate fixed-window buckets.
- Modify `apps/public-search-bot/src/bot/handlers.ts`: use access class plus action type when checking rate limits; block unpaid/kicked/removed/exhausted users before searching or loading season details.
- Modify `apps/public-search-bot/src/index.ts`: replace the generic 5-per-minute limiter with the public-search policy limiter.
- Modify `apps/public-search-bot/tests/public-search.subscription-access.test.ts`: cover exhausted trial non-consuming access and classification.
- Create `apps/public-search-bot/tests/public-search.bot-rate-policy.test.ts`: unit-test the paid/trial/blocked bucket limits.
- Modify `apps/public-search-bot/tests/public-search.handlers.test.ts`: update rate-limit expectations and add end-to-end handler coverage for paid, trial, and blocked behavior.

---

### Task 1: Access Classification And Exhausted Trial Blocking

**Files:**
- Modify: `apps/public-search-bot/src/subscriptions/access.service.ts`
- Test: `apps/public-search-bot/tests/public-search.subscription-access.test.ts`

- [ ] **Step 1: Write failing access-service tests**

In `apps/public-search-bot/tests/public-search.subscription-access.test.ts`, update the imports:

```ts
import {
  classifyPublicSearchAccess,
  consumeSuccessfulSearchAccess,
  evaluateSearchAccess
} from '../src/subscriptions/access.service.js';
```

Replace the current test named `allows non-consuming callback access for a trial user at the search limit` with:

```ts
  it('blocks non-consuming access after the trial search quota is exhausted', () => {
    const db = createDb();
    try {
      for (let index = 0; index < 5; index += 1) {
        consumeSuccessfulSearchAccess(db, {
          user: { id: 42, username: 'trial_user' },
          now: new Date(`2026-05-26T00:0${index}:00.000Z`),
          trialSearchLimit: 5
        });
      }

      expect(
        evaluateSearchAccess(db, {
          user: { id: 42, username: 'trial_user' },
          now: new Date('2026-05-26T00:10:00.000Z'),
          trialSearchLimit: 5
        })
      ).toMatchObject({ allowed: false, reason: 'subscription-required', status: 'Trial' });
    } finally {
      db.close();
    }
  });
```

Add this test below it:

```ts
  it('classifies new, paid, exhausted trial, and removed users for rate limits without consuming quota', () => {
    const db = createDb();
    try {
      const now = new Date('2026-05-26T00:00:00.000Z');

      expect(
        classifyPublicSearchAccess(db, {
          user: { id: 42, username: 'new_user' },
          trialSearchLimit: 5
        })
      ).toBe('trial-active');

      expect(db.prepare('SELECT COUNT(*) AS count FROM subscription_users').get()).toEqual({ count: 0 });

      consumeSuccessfulSearchAccess(db, {
        user: { id: 43, username: 'paid_user' },
        now,
        trialSearchLimit: 5
      });
      applySubscriptionStartDate(db, 43, '2026-05-26', 1, now);

      expect(
        classifyPublicSearchAccess(db, {
          user: { id: 43, username: 'paid_user' },
          trialSearchLimit: 5
        })
      ).toBe('paid');

      for (let index = 0; index < 5; index += 1) {
        consumeSuccessfulSearchAccess(db, {
          user: { id: 44, username: 'trial_user' },
          now: new Date(`2026-05-26T00:1${index}:00.000Z`),
          trialSearchLimit: 5
        });
      }

      expect(
        classifyPublicSearchAccess(db, {
          user: { id: 44, username: 'trial_user' },
          trialSearchLimit: 5
        })
      ).toBe('blocked');

      db.prepare('UPDATE subscription_users SET removed_from_group = 1 WHERE telegram_user_id = 43').run();

      expect(
        classifyPublicSearchAccess(db, {
          user: { id: 43, username: 'paid_user' },
          trialSearchLimit: 5
        })
      ).toBe('blocked');
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 2: Run access tests to verify failure**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.subscription-access.test.ts
```

Expected: fail because `classifyPublicSearchAccess` is not exported and `evaluateSearchAccess` still allows trial users at the exact quota.

- [ ] **Step 3: Implement classification and exhausted-trial blocking**

In `apps/public-search-bot/src/subscriptions/access.service.ts`, add the exported type near `SearchAccessResult`:

```ts
export type PublicSearchAccessClass = 'paid' | 'trial-active' | 'blocked';
```

Add this exported function after `evaluateSearchAccess`:

```ts
export function classifyPublicSearchAccess(
  db: PublicSearchDatabase,
  input: {
    user: TelegramUserIdentity | undefined;
    trialSearchLimit: number;
  }
): PublicSearchAccessClass {
  if (!input.user) {
    return 'blocked';
  }

  validateTrialSearchLimit(input.trialSearchLimit);

  const user = getSubscriptionUser(db, input.user.id);
  if (!user) {
    return 'trial-active';
  }

  return classifyExistingUser(user, input.trialSearchLimit);
}
```

Change `evaluateSearchAccess` to call `evaluateExistingUser(user, input.trialSearchLimit)`:

```ts
  const user = getSubscriptionUser(db, input.user.id);

  return evaluateExistingUser(user, input.trialSearchLimit);
```

Replace `evaluateExistingUser` with:

```ts
function evaluateExistingUser(
  user: ReturnType<typeof getSubscriptionUser>,
  trialSearchLimit: number
): SearchAccessResult {
  if (!user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  if (user.status === 'Kicked' || user.removedFromGroup) {
    return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
  }

  if (user.status === 'Subscribe' || user.status === 'Needs Attention') {
    return { allowed: true, status: user.status, trialStarted: false };
  }

  if (user.status === 'Trial' && user.trialSearchesUsed < trialSearchLimit) {
    return {
      allowed: true,
      status: 'Trial',
      trialStarted: false,
      trialSearchesUsed: user.trialSearchesUsed
    };
  }

  return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
}
```

Add this helper below `evaluateExistingUser`:

```ts
function classifyExistingUser(
  user: ReturnType<typeof getSubscriptionUser>,
  trialSearchLimit: number
): PublicSearchAccessClass {
  if (!user || user.status === 'Kicked' || user.removedFromGroup || user.status === 'Unpaid') {
    return 'blocked';
  }

  if (user.status === 'Subscribe' || user.status === 'Needs Attention') {
    return 'paid';
  }

  if (user.status === 'Trial' && user.trialSearchesUsed < trialSearchLimit) {
    return 'trial-active';
  }

  return 'blocked';
}
```

- [ ] **Step 4: Run access tests to verify pass**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.subscription-access.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/public-search-bot/src/subscriptions/access.service.ts apps/public-search-bot/tests/public-search.subscription-access.test.ts
git commit -m "fix: block exhausted trial callback access"
```

---

### Task 2: Public Search Rate Policy Wrapper

**Files:**
- Create: `apps/public-search-bot/src/bot/rate-policy.ts`
- Test: `apps/public-search-bot/tests/public-search.bot-rate-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create `apps/public-search-bot/tests/public-search.bot-rate-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createPublicSearchInteractionRateLimiter } from '../src/bot/rate-policy.js';

describe('public search bot rate policy', () => {
  it('allows paid users 10 searches and 20 season callbacks per minute', () => {
    let now = 0;
    const limiter = createPublicSearchInteractionRateLimiter({ now: () => now });

    for (let index = 0; index < 10; index += 1) {
      expect(limiter.check({ action: 'search', accessClass: 'paid', userId: 42 })).toEqual({ allowed: true });
    }
    expect(limiter.check({ action: 'search', accessClass: 'paid', userId: 42 })).toEqual({
      allowed: false,
      retryAfterMs: 60_000
    });

    for (let index = 0; index < 20; index += 1) {
      expect(limiter.check({ action: 'season', accessClass: 'paid', userId: 42 })).toEqual({ allowed: true });
    }
    expect(limiter.check({ action: 'season', accessClass: 'paid', userId: 42 })).toEqual({
      allowed: false,
      retryAfterMs: 60_000
    });

    now = 60_000;
    expect(limiter.check({ action: 'search', accessClass: 'paid', userId: 42 })).toEqual({ allowed: true });
    expect(limiter.check({ action: 'season', accessClass: 'paid', userId: 42 })).toEqual({ allowed: true });
  });

  it('uses stricter trial and blocked-message buckets', () => {
    const limiter = createPublicSearchInteractionRateLimiter({ now: () => 0 });

    for (let index = 0; index < 5; index += 1) {
      expect(limiter.check({ action: 'search', accessClass: 'trial-active', userId: 42 })).toEqual({ allowed: true });
    }
    expect(limiter.check({ action: 'search', accessClass: 'trial-active', userId: 42 })).toEqual({
      allowed: false,
      retryAfterMs: 60_000
    });

    for (let index = 0; index < 10; index += 1) {
      expect(limiter.check({ action: 'season', accessClass: 'trial-active', userId: 42 })).toEqual({ allowed: true });
    }
    expect(limiter.check({ action: 'season', accessClass: 'trial-active', userId: 42 })).toEqual({
      allowed: false,
      retryAfterMs: 60_000
    });

    for (let index = 0; index < 3; index += 1) {
      expect(limiter.check({ action: 'blocked-message', accessClass: 'blocked', userId: 42 })).toEqual({ allowed: true });
    }
    expect(limiter.check({ action: 'blocked-message', accessClass: 'blocked', userId: 42 })).toEqual({
      allowed: false,
      retryAfterMs: 60_000
    });
  });

  it('keeps users and action buckets isolated', () => {
    const limiter = createPublicSearchInteractionRateLimiter({ now: () => 0 });

    for (let index = 0; index < 10; index += 1) {
      expect(limiter.check({ action: 'search', accessClass: 'paid', userId: 42 })).toEqual({ allowed: true });
    }

    expect(limiter.check({ action: 'search', accessClass: 'paid', userId: 43 })).toEqual({ allowed: true });
    expect(limiter.check({ action: 'season', accessClass: 'paid', userId: 42 })).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run policy tests to verify failure**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.bot-rate-policy.test.ts
```

Expected: fail because `apps/public-search-bot/src/bot/rate-policy.ts` does not exist.

- [ ] **Step 3: Create rate policy wrapper**

Create `apps/public-search-bot/src/bot/rate-policy.ts`:

```ts
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
```

- [ ] **Step 4: Run policy tests to verify pass**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.bot-rate-policy.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/public-search-bot/src/bot/rate-policy.ts apps/public-search-bot/tests/public-search.bot-rate-policy.test.ts
git commit -m "feat: add public search rate policy"
```

---

### Task 3: Wire Policy Into The Bot Handler

**Files:**
- Modify: `apps/public-search-bot/src/bot/handlers.ts`
- Modify: `apps/public-search-bot/src/index.ts`
- Test: `apps/public-search-bot/tests/public-search.handlers.test.ts`

- [ ] **Step 1: Write failing handler tests for policy behavior**

In `apps/public-search-bot/tests/public-search.handlers.test.ts`, import the real policy limiter:

```ts
import { createPublicSearchInteractionRateLimiter } from '../src/bot/rate-policy.js';
```

Update expectations that check the old string key. For the invalid callback rate-limit test, change:

```ts
expect(deps.rateLimiter.check).toHaveBeenCalledWith('callback:42');
```

to:

```ts
expect(deps.rateLimiter.check).toHaveBeenCalledWith({
  action: 'season',
  accessClass: 'trial-active',
  userId: 42
});
```

Add this test near the existing spam test:

```ts
  it('uses paid search and season rate limits for subscribed users', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const now = new Date('2026-05-26T00:00:00.000Z');
      startTrialIfEligible(db, { id: 42, username: 'paid_user' }, now);
      applySubscriptionStartDate(db, 42, '2026-05-26', 1, now);

      let nowMs = 0;
      const { deps, sentMessages, callbackAnswers } = createDeps(db, {
        subscription: {
          now: () => now,
          trialSearchLimit: 5,
          adminContact: '@seinen_illuminatiks',
          scheduleSheetRefresh: vi.fn()
        },
        rateLimiter: createPublicSearchInteractionRateLimiter({ now: () => nowMs })
      });

      for (let index = 0; index < 10; index += 1) {
        await handleTelegramUpdate(deps, messageUpdate('/search inception', { from: { id: 42, username: 'paid_user' } }));
      }

      sentMessages.length = 0;
      await handleTelegramUpdate(deps, messageUpdate('/search inception', { from: { id: 42, username: 'paid_user' } }));

      expect(sentMessages).toEqual([
        {
          chatId: 500,
          text: 'Please wait 60 seconds before trying again.'
        }
      ]);

      nowMs = 60_000;
      sentMessages.length = 0;

      for (let index = 0; index < 20; index += 1) {
        await handleTelegramUpdate(deps, callbackUpdate('season:30', { from: { id: 42, username: 'paid_user' } }));
      }

      callbackAnswers.length = 0;
      sentMessages.length = 0;
      await handleTelegramUpdate(deps, callbackUpdate('season:30', { from: { id: 42, username: 'paid_user' } }));

      expect(callbackAnswers).toEqual([
        {
          callbackQueryId: 'callback-1',
          text: 'Please wait 60 seconds before trying again.'
        }
      ]);
      expect(sentMessages).toEqual([]);
    } finally {
      db.close();
    }
  });
```

Add this test near the trial quota tests:

```ts
  it('blocks exhausted trial users from season details', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const now = new Date('2026-05-26T00:00:00.000Z');
      startTrialIfEligible(db, { id: 42, username: 'trial_user' }, now);
      for (let index = 0; index < 5; index += 1) {
        consumeTrialSearchIfAllowed(db, 42, now, 5);
      }
      const { deps, sentMessages, callbackAnswers } = createDeps(db);

      await handleTelegramUpdate(deps, callbackUpdate('season:30', { from: { id: 42, username: 'trial_user' } }));

      expect(callbackAnswers).toEqual([{ callbackQueryId: 'callback-1', text: 'Subscription required.' }]);
      expect(sentMessages).toEqual([
        {
          chatId: 500,
          text: subscriptionRequiredMessage,
          replyMarkup: undefined
        }
      ]);
      expect(JSON.stringify({ sentMessages, callbackAnswers })).not.toContain('providers.example');
    } finally {
      db.close();
    }
  });
```

Add this blocked-message throttle test near the blocked subscription tests:

```ts
  it('throttles repeated subscription messages for blocked users', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const now = new Date('2026-05-26T00:00:00.000Z');
      startTrialIfEligible(db, { id: 42, username: 'trial_user' }, now);
      for (let index = 0; index < 5; index += 1) {
        consumeTrialSearchIfAllowed(db, 42, now, 5);
      }

      const { deps, sentMessages } = createDeps(db, {
        rateLimiter: createPublicSearchInteractionRateLimiter({ now: () => 0 })
      });

      for (let index = 0; index < 3; index += 1) {
        await handleTelegramUpdate(deps, messageUpdate('/search inception', { from: { id: 42, username: 'trial_user' } }));
      }

      await handleTelegramUpdate(deps, messageUpdate('/search inception', { from: { id: 42, username: 'trial_user' } }));

      expect(sentMessages.map((message) => message.text)).toEqual([
        subscriptionRequiredMessage,
        subscriptionRequiredMessage,
        subscriptionRequiredMessage,
        'Please wait 60 seconds before trying again.'
      ]);
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 2: Run handler tests to verify failure**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.handlers.test.ts
```

Expected: fail because `HandlerDeps.rateLimiter.check` still receives string keys and exhausted trial callbacks still reach season details.

- [ ] **Step 3: Update handler imports and dependency type**

In `apps/public-search-bot/src/bot/handlers.ts`, change the access import to:

```ts
import {
  classifyPublicSearchAccess,
  consumeSuccessfulSearchAccess,
  evaluateSearchAccess,
  type PublicSearchAccessClass
} from '../subscriptions/access.service.js';
```

Add this import:

```ts
import type { PublicSearchInteractionRateLimiter, PublicSearchRateLimitAction } from './rate-policy.js';
```

Change the `HandlerDeps.rateLimiter` type to:

```ts
  rateLimiter: PublicSearchInteractionRateLimiter;
```

- [ ] **Step 4: Add blocked response helpers**

In `apps/public-search-bot/src/bot/handlers.ts`, replace `checkReplyRateLimit` and `replyIfAllowed` with:

```ts
function checkReplyRateLimit(
  deps: HandlerDeps,
  input: {
    userId: number | undefined;
    action: PublicSearchRateLimitAction;
    accessClass?: PublicSearchAccessClass | undefined;
  }
) {
  return deps.rateLimiter.check(input);
}

async function replyIfAllowed(
  deps: HandlerDeps,
  chatId: number,
  userId: number | undefined,
  action: PublicSearchRateLimitAction = 'message',
  accessClass?: PublicSearchAccessClass | undefined
) {
  const rateLimit = checkReplyRateLimit(deps, { userId, action, accessClass });
  if (rateLimit.allowed) {
    getReplyThrottleState(deps).clearWaitMessage(userId);
    return true;
  }

  await sendRateLimitMessage(deps, chatId, userId, rateLimit.retryAfterMs);
  return false;
}
```

Add these helpers below `replyIfAllowed`:

```ts
async function sendSubscriptionRequiredIfAllowed(
  deps: HandlerDeps,
  chatId: number,
  userId: number | undefined
) {
  if (!(await replyIfAllowed(deps, chatId, userId, 'blocked-message', 'blocked'))) {
    return;
  }

  await sendBotMessage(deps, chatId, formatSubscriptionRequiredMessage(deps.subscription.adminContact));
}

async function answerSubscriptionRequiredIfAllowed(
  deps: HandlerDeps,
  callbackQueryId: string,
  chatId: number | undefined,
  userId: number | undefined
) {
  const rateLimit = checkReplyRateLimit(deps, {
    userId,
    action: 'blocked-message',
    accessClass: 'blocked'
  });

  if (!rateLimit.allowed) {
    await deps.replies.enqueueAnswerCallbackQuery({
      callbackQueryId,
      text: formatWaitMessage(rateLimit.retryAfterMs)
    });
    return;
  }

  await deps.replies.enqueueAnswerCallbackQuery({
    callbackQueryId,
    text: 'Subscription required.'
  });

  if (chatId !== undefined) {
    await sendBotMessage(deps, chatId, formatSubscriptionRequiredMessage(deps.subscription.adminContact));
  }
}
```

- [ ] **Step 5: Classify and rate-limit searches before catalog lookup**

In the `/search` branch of `handleMessage`, replace the current query handling after `const user = getTelegramUser(message.from);` with:

```ts
    const accessClass = classifyPublicSearchAccess(deps.db, {
      user,
      trialSearchLimit: deps.subscription.trialSearchLimit
    });

    if (accessClass === 'blocked') {
      await sendSubscriptionRequiredIfAllowed(deps, message.chat.id, user?.id);
      return;
    }

    if (!(await replyIfAllowed(deps, message.chat.id, user?.id, 'search', accessClass))) {
      return;
    }

    await handleSearch(deps, message.chat, user, query);
    return;
```

In `handleSearch`, replace:

```ts
    await sendBotMessage(deps, chatId, formatSubscriptionRequiredMessage(deps.subscription.adminContact));
```

with:

```ts
    await sendSubscriptionRequiredIfAllowed(deps, chatId, user?.id);
```

- [ ] **Step 6: Classify and rate-limit season callbacks**

In `handleCallbackQuery`, replace the first rate-limit block with:

```ts
  const callbackUser = getTelegramUser(callbackQuery.from);
  const accessClass = classifyPublicSearchAccess(deps.db, {
    user: callbackUser,
    trialSearchLimit: deps.subscription.trialSearchLimit
  });

  if (accessClass === 'blocked') {
    const chatId = callbackQuery.message?.chat.id;
    await answerSubscriptionRequiredIfAllowed(deps, callbackQueryId, chatId, callbackUser?.id);
    return;
  }

  const rateLimit = checkReplyRateLimit(deps, {
    userId: callbackUser?.id,
    action: 'season',
    accessClass
  });
  if (!rateLimit.allowed) {
    await deps.replies.enqueueAnswerCallbackQuery({
      callbackQueryId,
      text: formatWaitMessage(rateLimit.retryAfterMs)
    });
    return;
  }
```

In the `evaluateSearchAccess` call, replace:

```ts
    user: getTelegramUser(callbackQuery.from),
```

with:

```ts
    user: callbackUser,
```

In the later `if (!access.allowed)` block, replace the whole block with:

```ts
  if (!access.allowed) {
    await answerSubscriptionRequiredIfAllowed(deps, callbackQueryId, chatId, callbackUser?.id);
    return;
  }
```

- [ ] **Step 7: Use the policy limiter in production**

In `apps/public-search-bot/src/index.ts`, replace:

```ts
import { createFixedWindowRateLimiter } from './rate-limit.js';
```

with:

```ts
import { createPublicSearchInteractionRateLimiter } from './bot/rate-policy.js';
```

Replace:

```ts
  const rateLimiter = createFixedWindowRateLimiter({
    limit: 5,
    windowMs: 60_000
  });
```

with:

```ts
  const rateLimiter = createPublicSearchInteractionRateLimiter();
```

- [ ] **Step 8: Run handler tests to verify pass**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.handlers.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit Task 3**

```bash
git add apps/public-search-bot/src/bot/handlers.ts apps/public-search-bot/src/index.ts apps/public-search-bot/tests/public-search.handlers.test.ts
git commit -m "feat: apply public search rate policy"
```

---

### Task 4: Full Bot Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run focused public-search bot tests**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.subscription-access.test.ts public-search.bot-rate-policy.test.ts public-search.handlers.test.ts public-search.rate-limit.test.ts
```

Expected: all selected test files pass.

- [ ] **Step 2: Run full public-search bot test suite**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test
```

Expected: all public-search-bot tests pass.

- [ ] **Step 3: Run public-search bot build**

Run:

```bash
npm.cmd --prefix apps/public-search-bot run build
```

Expected: TypeScript build succeeds and assets copy.

- [ ] **Step 4: Commit verification-only adjustments if needed**

If Step 1, Step 2, or Step 3 revealed a small compile or test expectation mismatch, commit only those focused fixes:

```bash
git add apps/public-search-bot/src apps/public-search-bot/tests
git commit -m "test: cover public search rate policy"
```

If no files changed after verification, skip this commit.

---

### Task 5: Repository Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run root TypeScript checks**

Run:

```bash
npx.cmd tsc --noEmit
npx.cmd tsc -p tsconfig.server.json --noEmit
```

Expected: both commands complete with exit code 0.

- [ ] **Step 2: Run root test suite**

Run:

```bash
npm.cmd test
```

Expected: all root tests pass.

- [ ] **Step 3: Check whitespace and status**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints nothing. `git status --short` shows no unstaged source changes after all implementation commits.

---

## Self-Review

- Spec coverage: paid 10/min search, paid 20/min season, trial quota, trial anti-spam limits, blocked user content denial, blocked-message throttling, and test coverage are each mapped to tasks.
- Scope check: the plan only changes public-search-bot access/rate limiting and does not touch plan pricing, Google Sheets duration sync, group membership collection, or catalog sync.
- Type consistency: `PublicSearchAccessClass`, `PublicSearchRateLimitAction`, and `PublicSearchInteractionRateLimiter.check(input)` are introduced before handler usage.

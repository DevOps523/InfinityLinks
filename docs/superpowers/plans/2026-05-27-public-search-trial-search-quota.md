# Public Search Trial Search Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone public search bot's one-day trial with a persistent five-successful-search trial quota.

**Architecture:** Keep subscription state in the existing SQLite `subscription_users` table and add a `trial_searches_used` counter. `/search` uses a new consuming access path that increments only after catalog results exist; TV season callbacks keep the existing non-consuming access check. Paid users stay unlimited, and blocked users still never receive provider links.

**Tech Stack:** TypeScript, Node.js, Express, better-sqlite3, Vitest, Telegram Bot API polling.

---

## File Structure

- `apps/public-search-bot/src/config.ts`: parse `SUBSCRIPTION_TRIAL_SEARCH_LIMIT` and expose `subscriptionTrialSearchLimit`.
- `apps/public-search-bot/src/index.ts`: pass the configured search limit into public bot handlers.
- `apps/public-search-bot/src/bot/formatter.ts`: update `/start` trial copy.
- `apps/public-search-bot/src/bot/handlers.ts`: use consuming access for successful `/search`; keep callbacks non-consuming.
- `apps/public-search-bot/src/db/schema.sql`: add `trial_searches_used` to `subscription_users`.
- `apps/public-search-bot/src/db/migrate.ts`: add the column to existing databases and include it in subscription table rebuilds.
- `apps/public-search-bot/src/subscriptions/repository.ts`: map and mutate trial search count.
- `apps/public-search-bot/src/subscriptions/access.service.ts`: split non-consuming callback access from consuming successful-search access.
- `apps/public-search-bot/tests/*.test.ts`: update tests for count-based trial behavior.
- `apps/public-search-bot/.env.example` and `apps/public-search-bot/README.md`: document the new quota config and behavior.

Existing unstaged root Public Search preview changes are unrelated. When committing implementation tasks, stage only files listed in each task.

---

### Task 1: Config And Start Message

**Files:**
- Modify: `apps/public-search-bot/tests/public-search.config.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.formatter.test.ts`
- Modify: `apps/public-search-bot/src/config.ts`
- Modify: `apps/public-search-bot/src/bot/formatter.ts`
- Modify: `apps/public-search-bot/src/bot/handlers.ts`
- Modify: `apps/public-search-bot/src/index.ts`

- [ ] **Step 1: Write failing config tests**

In `apps/public-search-bot/tests/public-search.config.test.ts`, replace expected `subscriptionTrialHours` fields with `subscriptionTrialSearchLimit`.

Use this expectation in `returns required secrets and default public search settings`:

```ts
subscriptionTrialSearchLimit: 5,
```

Use this expectation in `returns subscription defaults and explicit sheet settings`:

```ts
subscriptionTrialSearchLimit: 5,
```

In `accepts explicit subscription and Google Sheets optional values`, replace the `SUBSCRIPTION_TRIAL_HOURS` input and expected field with:

```ts
SUBSCRIPTION_TRIAL_SEARCH_LIMIT: '7',
```

```ts
subscriptionTrialSearchLimit: 7,
```

Add this test near the other config validation tests:

```ts
it.each(['0', '-1', '1.5', 'not-a-number'])(
  'rejects invalid SUBSCRIPTION_TRIAL_SEARCH_LIMIT %s',
  (limit) => {
    expect(() =>
      loadPublicSearchConfig({
        ...subscriptionEnv,
        PUBLIC_BOT_TOKEN: 'bot-token',
        PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
        PUBLIC_SEARCH_STATUS_TOKEN: 'status-token',
        SUBSCRIPTION_TRIAL_SEARCH_LIMIT: limit
      })
    ).toThrow();
  }
);
```

- [ ] **Step 2: Write failing formatter test**

In `apps/public-search-bot/tests/public-search.formatter.test.ts`, replace the two old trial lines in the `formatStartMessage` expected text with:

```ts
'You get 5 free movie or TV searches.',
'After that, subscription is required to keep going.'
```

- [ ] **Step 3: Run config and formatter tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.config.test.ts tests/public-search.formatter.test.ts
```

Expected: FAIL because `subscriptionTrialSearchLimit` is not implemented and the start message still says one-day trial.

- [ ] **Step 4: Implement config rename**

In `apps/public-search-bot/src/config.ts`, replace:

```ts
SUBSCRIPTION_TRIAL_HOURS: numberWithDefault(24),
```

with:

```ts
SUBSCRIPTION_TRIAL_SEARCH_LIMIT: numberWithDefault(5),
```

In `PublicSearchConfig`, replace:

```ts
subscriptionTrialHours: number;
```

with:

```ts
subscriptionTrialSearchLimit: number;
```

In `loadPublicSearchConfig`, replace:

```ts
subscriptionTrialHours: parsed.SUBSCRIPTION_TRIAL_HOURS,
```

with:

```ts
subscriptionTrialSearchLimit: parsed.SUBSCRIPTION_TRIAL_SEARCH_LIMIT,
```

- [ ] **Step 5: Update handler dependency names**

In `apps/public-search-bot/src/bot/handlers.ts`, replace the dependency shape:

```ts
trialHours: number;
```

with:

```ts
trialSearchLimit: number;
```

Temporarily replace both access-service call inputs from:

```ts
trialHours: deps.subscription.trialHours
```

to:

```ts
trialSearchLimit: deps.subscription.trialSearchLimit
```

Task 3 will update the access service signatures to match.

In `apps/public-search-bot/src/index.ts`, replace:

```ts
trialHours: config.subscriptionTrialHours,
```

with:

```ts
trialSearchLimit: config.subscriptionTrialSearchLimit,
```

- [ ] **Step 6: Update start message implementation**

In `apps/public-search-bot/src/bot/formatter.ts`, replace the old trial lines:

```ts
'You have 1 day free trial access when you search.',
'After the trial, subscription is required to view download links.'
```

with:

```ts
'You get 5 free movie or TV searches.',
'After that, subscription is required to keep going.'
```

- [ ] **Step 7: Run config and formatter tests**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.config.test.ts tests/public-search.formatter.test.ts
```

Expected: PASS for formatter and config. Type errors in unrelated tests are acceptable until later tasks update handler/access signatures.

- [ ] **Step 8: Commit config and message changes**

Run:

```powershell
git add apps/public-search-bot/src/config.ts apps/public-search-bot/src/index.ts apps/public-search-bot/src/bot/handlers.ts apps/public-search-bot/src/bot/formatter.ts apps/public-search-bot/tests/public-search.config.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts
git commit -m "feat: configure trial search quota"
```

---

### Task 2: Schema, Migration, And Repository Counter

**Files:**
- Modify: `apps/public-search-bot/src/db/schema.sql`
- Modify: `apps/public-search-bot/src/db/migrate.ts`
- Modify: `apps/public-search-bot/src/subscriptions/repository.ts`
- Modify: `apps/public-search-bot/tests/public-search.db.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.subscription-repository.test.ts`

- [ ] **Step 1: Write failing schema test**

In `apps/public-search-bot/tests/public-search.db.test.ts`, add this helper after `tableNames`:

```ts
function columnNames(db: ReturnType<typeof createPublicSearchDatabase>, tableName: string) {
  return (db.pragma(`table_info(${tableName})`) as Array<{ name: string }>).map((column) => column.name);
}
```

Add this test inside `describe('public search database', ...)`:

```ts
it('creates trial search quota state on subscription users', () => {
  const db = createMigratedDatabase();

  try {
    expect(columnNames(db, 'subscription_users')).toContain('trial_searches_used');
    const row = db
      .prepare(
        `INSERT INTO subscription_users (
           telegram_user_id,
           status,
           removed_from_group,
           created_at,
           updated_at
         )
         VALUES (42, 'Unpaid', 0, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z')
         RETURNING trial_searches_used AS trialSearchesUsed`
      )
      .get() as { trialSearchesUsed: number };

    expect(row.trialSearchesUsed).toBe(0);
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Write failing repository tests**

In `apps/public-search-bot/tests/public-search.subscription-repository.test.ts`, add `consumeTrialSearchIfAllowed` to the repository imports:

```ts
consumeTrialSearchIfAllowed,
```

Replace the existing test named `starts one trial once and keeps username keyed by user id` with:

```ts
it('starts one quota trial once and keeps username keyed by user id', () => {
  const db = createDb();
  try {
    const first = startTrialIfEligible(db, { id: 42, username: 'first_name' }, new Date('2026-05-26T00:00:00.000Z'));
    const second = startTrialIfEligible(db, { id: 42, username: 'new_name' }, new Date('2026-05-26T01:00:00.000Z'));

    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(second.user).toMatchObject({
      telegramUserId: 42,
      username: 'new_name',
      status: 'Trial',
      trialStartedAt: '2026-05-26T00:00:00.000Z',
      trialExpiresAt: undefined,
      trialSearchesUsed: 0
    });
  } finally {
    db.close();
  }
});
```

Add this test after it:

```ts
it('consumes trial searches only up to the configured limit', () => {
  const db = createDb();
  try {
    startTrialIfEligible(db, { id: 42, username: 'trial_user' }, new Date('2026-05-26T00:00:00.000Z'));

    expect(consumeTrialSearchIfAllowed(db, 42, new Date('2026-05-26T00:01:00.000Z'), 2)).toMatchObject({
      trialSearchesUsed: 1
    });
    expect(consumeTrialSearchIfAllowed(db, 42, new Date('2026-05-26T00:02:00.000Z'), 2)).toMatchObject({
      trialSearchesUsed: 2
    });
    expect(consumeTrialSearchIfAllowed(db, 42, new Date('2026-05-26T00:03:00.000Z'), 2)).toBeUndefined();
    expect(getSubscriptionUser(db, 42)).toMatchObject({ trialSearchesUsed: 2 });
  } finally {
    db.close();
  }
});
```

Add this migration test near the legacy subscription users rebuild test:

```ts
it('adds trial search usage to legacy subscription users tables', () => {
  const db = createPublicSearchDatabase(':memory:');
  try {
    db.exec(`
      CREATE TABLE subscription_users (
        telegram_user_id INTEGER PRIMARY KEY,
        username TEXT,
        trial_started_at TEXT,
        trial_expires_at TEXT,
        subscription_start_date TEXT,
        subscription_end_date TEXT,
        days_remaining INTEGER,
        status TEXT NOT NULL DEFAULT 'Unpaid'
          CHECK (status IN ('Trial', 'Subscribe', 'Needs Attention', 'Unpaid', 'Kicked')),
        unpaid_since TEXT,
        kicked_at TEXT,
        history_exported_at TEXT,
        removed_from_group INTEGER NOT NULL DEFAULT 0 CHECK (removed_from_group IN (0, 1)),
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO subscription_users (
        telegram_user_id,
        username,
        status,
        removed_from_group,
        created_at,
        updated_at
      )
      VALUES (42, 'legacy_user', 'Trial', 0, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z');
    `);

    migratePublicSearchDatabase(db);

    expect(getSubscriptionUser(db, 42)).toMatchObject({
      telegramUserId: 42,
      trialSearchesUsed: 0
    });
  } finally {
    db.close();
  }
});
```

In the `marks kicked users without deleting permanent history` test, replace:

```ts
expect(startTrialIfEligible(db, { id: 42, username: 'late_user' }, new Date('2026-06-28T00:00:00.000Z'), 24).started).toBe(false);
```

with:

```ts
expect(startTrialIfEligible(db, { id: 42, username: 'late_user' }, new Date('2026-06-28T00:00:00.000Z')).started).toBe(false);
```

- [ ] **Step 3: Run repository tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.db.test.ts tests/public-search.subscription-repository.test.ts
```

Expected: FAIL because `trial_searches_used` and `consumeTrialSearchIfAllowed` do not exist.

- [ ] **Step 4: Update schema**

In `apps/public-search-bot/src/db/schema.sql`, add `trial_searches_used` after `trial_expires_at`:

```sql
  trial_started_at TEXT,
  trial_expires_at TEXT,
  trial_searches_used INTEGER NOT NULL DEFAULT 0,
  subscription_start_date TEXT,
```

- [ ] **Step 5: Update migrations**

In `apps/public-search-bot/src/db/migrate.ts`, update `migratePublicSearchDatabase` to call the new helper after `addSubscriptionUsersHistoryExportedAtColumnIfNeeded(db);`:

```ts
  addSubscriptionUsersTrialSearchesUsedColumnIfNeeded(db);
```

Add this helper after `addSubscriptionUsersHistoryExportedAtColumnIfNeeded`:

```ts
function addSubscriptionUsersTrialSearchesUsedColumnIfNeeded(db: PublicSearchDatabase) {
  const row = db
    .prepare(
      `SELECT 1
       FROM sqlite_schema
       WHERE type = 'table'
         AND name = 'subscription_users'`
    )
    .get();

  if (!row) {
    return;
  }

  const columns = db.pragma('table_info(subscription_users)') as Array<{ name: string }>;
  if (columns.some((column) => column.name === 'trial_searches_used')) {
    return;
  }

  db.exec('ALTER TABLE subscription_users ADD COLUMN trial_searches_used INTEGER NOT NULL DEFAULT 0');
}
```

In the `CREATE TABLE subscription_users_new` SQL inside `rebuildSubscriptionUsersBooleanConstraintIfNeeded`, add:

```sql
        trial_searches_used INTEGER NOT NULL DEFAULT 0,
```

after `trial_expires_at TEXT,`.

In the `INSERT INTO subscription_users_new` column list, add:

```sql
        trial_searches_used,
```

after `trial_expires_at,`.

In the matching `SELECT` list, add:

```sql
        COALESCE(trial_searches_used, 0),
```

after `trial_expires_at,`.

- [ ] **Step 6: Update repository types and selects**

In `apps/public-search-bot/src/subscriptions/repository.ts`, add this property to `SubscriptionUser`:

```ts
trialSearchesUsed: number;
```

Add this property to `SubscriptionUserRow`:

```ts
trialSearchesUsed: number;
```

In every `SELECT` list that reads from `subscription_users`, add this field after `trial_expires_at AS trialExpiresAt,`:

```sql
         trial_searches_used AS trialSearchesUsed,
```

In `mapSubscriptionUser`, add:

```ts
    trialSearchesUsed: row.trialSearchesUsed,
```

- [ ] **Step 7: Replace trial start helper**

In `apps/public-search-bot/src/subscriptions/repository.ts`, replace `startTrialIfEligible` with:

```ts
export function startTrialIfEligible(
  db: PublicSearchDatabase,
  identity: TelegramUserIdentity,
  now: Date
): { started: boolean; user: SubscriptionUser } {
  const trial = db.transaction(() => {
    const existing = upsertSeenTelegramUser(db, identity, now);

    if (existing.trialStartedAt || existing.subscriptionStartDate || existing.status === 'Kicked') {
      return { started: false, user: existing };
    }

    const trialStartedAt = now.toISOString();

    db.prepare(
      `UPDATE subscription_users
       SET trial_started_at = @trialStartedAt,
           trial_expires_at = NULL,
           trial_searches_used = 0,
           status = 'Trial',
           updated_at = @trialStartedAt
       WHERE telegram_user_id = @telegramUserId`
    ).run({
      telegramUserId: identity.id,
      trialStartedAt
    });

    return { started: true, user: requireSubscriptionUser(db, identity.id) };
  });

  return trial();
}
```

- [ ] **Step 8: Add trial consume helper and validation**

In `apps/public-search-bot/src/subscriptions/repository.ts`, add this exported function after `startTrialIfEligible`:

```ts
export function consumeTrialSearchIfAllowed(
  db: PublicSearchDatabase,
  telegramUserId: number,
  now: Date,
  trialSearchLimit: number
): SubscriptionUser | undefined {
  validateTrialSearchLimit(trialSearchLimit);
  const consume = db.transaction(() => {
    const nowIso = now.toISOString();
    const result = db
      .prepare(
        `UPDATE subscription_users
         SET trial_searches_used = trial_searches_used + 1,
             updated_at = @nowIso
         WHERE telegram_user_id = @telegramUserId
           AND status = 'Trial'
           AND removed_from_group = 0
           AND trial_searches_used < @trialSearchLimit`
      )
      .run({
        telegramUserId,
        trialSearchLimit,
        nowIso
      });

    return result.changes === 1 ? requireSubscriptionUser(db, telegramUserId) : undefined;
  });

  return consume();
}
```

Add this validation helper near `validateSubscriptionPeriodDays`:

```ts
export function validateTrialSearchLimit(trialSearchLimit: number) {
  if (!Number.isInteger(trialSearchLimit) || trialSearchLimit <= 0) {
    throw new Error('Trial search limit must be a positive integer');
  }
}
```

- [ ] **Step 9: Run repository tests**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.db.test.ts tests/public-search.subscription-repository.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit schema and repository changes**

Run:

```powershell
git add apps/public-search-bot/src/db/schema.sql apps/public-search-bot/src/db/migrate.ts apps/public-search-bot/src/subscriptions/repository.ts apps/public-search-bot/tests/public-search.db.test.ts apps/public-search-bot/tests/public-search.subscription-repository.test.ts
git commit -m "feat: persist trial search usage"
```

---

### Task 3: Access Service Split

**Files:**
- Modify: `apps/public-search-bot/src/subscriptions/access.service.ts`
- Modify: `apps/public-search-bot/tests/public-search.subscription-access.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.subscription-access-username.test.ts`

- [ ] **Step 1: Write failing access-service tests**

In `apps/public-search-bot/tests/public-search.subscription-access.test.ts`, update the import:

```ts
import { consumeSuccessfulSearchAccess, evaluateSearchAccess } from '../src/subscriptions/access.service.js';
```

Replace the first two tests with:

```ts
it('starts a search quota trial on first successful search', () => {
  const db = createDb();
  try {
    const result = consumeSuccessfulSearchAccess(db, {
      user: { id: 42, username: 'trial_user' },
      now: new Date('2026-05-26T00:00:00.000Z'),
      trialSearchLimit: 5
    });

    expect(result).toMatchObject({
      allowed: true,
      status: 'Trial',
      trialStarted: true,
      trialSearchesUsed: 1
    });
  } finally {
    db.close();
  }
});

it('blocks trial users after the configured successful search limit', () => {
  const db = createDb();
  try {
    for (let index = 0; index < 5; index += 1) {
      expect(
        consumeSuccessfulSearchAccess(db, {
          user: { id: 42, username: 'trial_user' },
          now: new Date(`2026-05-26T00:0${index}:00.000Z`),
          trialSearchLimit: 5
        })
      ).toMatchObject({ allowed: true, status: 'Trial', trialSearchesUsed: index + 1 });
    }

    expect(
      consumeSuccessfulSearchAccess(db, {
        user: { id: 42, username: 'trial_user' },
        now: new Date('2026-05-26T00:06:00.000Z'),
        trialSearchLimit: 5
      })
    ).toMatchObject({ allowed: false, reason: 'subscription-required', status: 'Trial' });
  } finally {
    db.close();
  }
});
```

Replace the paid/kicked test with:

```ts
it('allows active paid users and blocks kicked users', () => {
  const db = createDb();
  try {
    consumeSuccessfulSearchAccess(db, {
      user: { id: 42, username: 'paid_user' },
      now: new Date('2026-05-26T00:00:00.000Z'),
      trialSearchLimit: 5
    });
    applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), 31);

    expect(
      consumeSuccessfulSearchAccess(db, {
        user: { id: 42, username: 'paid_user' },
        now: new Date('2026-06-25T00:00:00.000Z'),
        trialSearchLimit: 5
      })
    ).toMatchObject({ allowed: true, status: 'Subscribe' });

    db.prepare("UPDATE subscription_users SET status = 'Kicked', removed_from_group = 1 WHERE telegram_user_id = 42").run();

    expect(
      consumeSuccessfulSearchAccess(db, {
        user: { id: 42, username: 'paid_user' },
        now: new Date('2026-06-25T01:00:00.000Z'),
        trialSearchLimit: 5
      })
    ).toMatchObject({ allowed: false, reason: 'subscription-required', status: 'Kicked' });
  } finally {
    db.close();
  }
});
```

Add this callback-style access test:

```ts
it('allows non-consuming callback access for a trial user at the search limit', () => {
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
    ).toMatchObject({ allowed: true, status: 'Trial' });
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Update username refresh mock test**

In `apps/public-search-bot/tests/public-search.subscription-access-username.test.ts`, update the mocked repository import:

```ts
  consumeTrialSearchIfAllowed,
  validateTrialSearchLimit,
```

Update the mock factory:

```ts
  consumeTrialSearchIfAllowed: vi.fn(),
  validateTrialSearchLimit: vi.fn(),
```

Add `trialSearchesUsed: 0` to both mocked user objects.

Before the `expect(evaluateSearchAccess(...))` assertion, make the validation mock behave like the real function for valid limits:

```ts
vi.mocked(validateTrialSearchLimit).mockImplementation((trialSearchLimit: number) => {
  if (!Number.isInteger(trialSearchLimit) || trialSearchLimit <= 0) {
    throw new Error('Trial search limit must be a positive integer');
  }
});
```

Replace `trialHours: 24` with:

```ts
trialSearchLimit: 5
```

- [ ] **Step 3: Run access tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.subscription-access.test.ts tests/public-search.subscription-access-username.test.ts
```

Expected: FAIL because `consumeSuccessfulSearchAccess` does not exist and `evaluateSearchAccess` still expects `trialHours`.

- [ ] **Step 4: Replace access service implementation**

In `apps/public-search-bot/src/subscriptions/access.service.ts`, replace the import with:

```ts
import type { PublicSearchDatabase } from '../db/database.js';
import type { SubscriptionStatus, TelegramUserIdentity } from './repository.js';
import {
  consumeTrialSearchIfAllowed,
  getSubscriptionUser,
  startTrialIfEligible,
  upsertSeenTelegramUser,
  validateTrialSearchLimit
} from './repository.js';
```

Replace `SearchAccessResult` with:

```ts
export type SearchAccessResult =
  | {
      allowed: true;
      status: SubscriptionStatus;
      trialStarted: boolean;
      trialSearchesUsed?: number | undefined;
    }
  | {
      allowed: false;
      reason: 'subscription-required';
      status?: SubscriptionStatus | undefined;
      trialStarted: false;
    };
```

Replace `evaluateSearchAccess` and remove `validateTrialHours`:

```ts
export function evaluateSearchAccess(
  db: PublicSearchDatabase,
  input: {
    user: TelegramUserIdentity | undefined;
    now: Date;
    trialSearchLimit: number;
  }
): SearchAccessResult {
  if (!input.user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  validateTrialSearchLimit(input.trialSearchLimit);
  upsertSeenTelegramUser(db, input.user, input.now);
  const user = getSubscriptionUser(db, input.user.id);

  return evaluateExistingUser(user);
}

export function consumeSuccessfulSearchAccess(
  db: PublicSearchDatabase,
  input: {
    user: TelegramUserIdentity | undefined;
    now: Date;
    trialSearchLimit: number;
  }
): SearchAccessResult {
  if (!input.user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  validateTrialSearchLimit(input.trialSearchLimit);
  upsertSeenTelegramUser(db, input.user, input.now);
  const trial = startTrialIfEligible(db, input.user, input.now);
  const user = getSubscriptionUser(db, input.user.id);

  if (!user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  if (user.status === 'Kicked' || user.removedFromGroup) {
    return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
  }

  if (user.status === 'Subscribe' || user.status === 'Needs Attention') {
    return { allowed: true, status: user.status, trialStarted: false };
  }

  if (user.status === 'Trial') {
    const consumed = consumeTrialSearchIfAllowed(db, input.user.id, input.now, input.trialSearchLimit);
    if (consumed) {
      return {
        allowed: true,
        status: 'Trial',
        trialStarted: trial.started,
        trialSearchesUsed: consumed.trialSearchesUsed
      };
    }

    return { allowed: false, reason: 'subscription-required', status: 'Trial', trialStarted: false };
  }

  return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
}

function evaluateExistingUser(user: ReturnType<typeof getSubscriptionUser>): SearchAccessResult {
  if (!user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  if (user.status === 'Kicked' || user.removedFromGroup) {
    return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
  }

  if (user.status === 'Subscribe' || user.status === 'Needs Attention') {
    return { allowed: true, status: user.status, trialStarted: false };
  }

  if (user.status === 'Trial') {
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

- [ ] **Step 5: Run access tests**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.subscription-access.test.ts tests/public-search.subscription-access-username.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit access-service changes**

Run:

```powershell
git add apps/public-search-bot/src/subscriptions/access.service.ts apps/public-search-bot/tests/public-search.subscription-access.test.ts apps/public-search-bot/tests/public-search.subscription-access-username.test.ts
git commit -m "feat: enforce trial search quota in access service"
```

---

### Task 4: Handler Quota Behavior

**Files:**
- Modify: `apps/public-search-bot/src/bot/handlers.ts`
- Modify: `apps/public-search-bot/tests/public-search.handlers.test.ts`

- [ ] **Step 1: Update handler tests for new dependency name**

In `apps/public-search-bot/tests/public-search.handlers.test.ts`, replace every `trialHours: 24` with:

```ts
trialSearchLimit: 5
```

Update the repository import at the top of the file from:

```ts
  applySubscriptionStartDate,
  markSubscriptionUserKicked,
  upsertSeenTelegramUser
```

to:

```ts
  applySubscriptionStartDate,
  consumeTrialSearchIfAllowed,
  markSubscriptionUserKicked,
  startTrialIfEligible,
  upsertSeenTelegramUser
```

In `createDeps`, the default subscription object should become:

```ts
subscription: {
  now: () => new Date('2026-05-26T00:00:00.000Z'),
  trialSearchLimit: 5,
  adminContact: '@seinen_illuminatiks',
  scheduleSheetRefresh: vi.fn()
},
```

Add this helper after `createDeps`:

```ts
function seedTrialSearchAccess(db: PublicSearchDatabase, userId = 42) {
  const now = new Date('2026-05-26T00:00:00.000Z');
  startTrialIfEligible(db, { id: userId, username: 'trial_user' }, now);
  consumeTrialSearchIfAllowed(db, userId, now, 5);
}
```

- [ ] **Step 2: Replace expired-trial test with quota test**

Replace the test named `blocks /search when the user has an expired trial` with:

```ts
it('blocks /search after five successful trial searches', async () => {
  const db = createMigratedDatabase();

  try {
    seedCatalog(db);
    const { deps, sentMessages } = createDeps(db);

    for (let index = 0; index < 5; index += 1) {
      await handleTelegramUpdate(
        deps,
        messageUpdate('/search inception', { from: { id: 42, username: 'trial_user' } })
      );
    }

    sentMessages.length = 0;
    await handleTelegramUpdate(
      deps,
      messageUpdate('/search inception', { from: { id: 42, username: 'trial_user' } })
    );

    const row = db
      .prepare(
        `SELECT status, trial_searches_used AS trialSearchesUsed
         FROM subscription_users
         WHERE telegram_user_id = 42`
      )
      .get() as { status: string; trialSearchesUsed: number } | undefined;

    expect(row).toMatchObject({ status: 'Trial', trialSearchesUsed: 5 });
    expect(sentMessages).toEqual([
      {
        chatId: 500,
        text: subscriptionRequiredMessage,
        replyMarkup: undefined
      }
    ]);
    expect(JSON.stringify(sentMessages)).not.toContain('providers.example');
  } finally {
    db.close();
  }
});
```

- [ ] **Step 3: Update first-search trial assertions**

In the test `starts a trial from the first /search and returns movie provider links`, change the row query to:

```ts
const row = db
  .prepare(
    `SELECT status,
            trial_started_at AS trialStartedAt,
            trial_searches_used AS trialSearchesUsed
     FROM subscription_users
     WHERE telegram_user_id = 42`
  )
  .get() as { status: string; trialStartedAt: string | null; trialSearchesUsed: number } | undefined;
```

Change the row expectations to:

```ts
expect(row).toMatchObject({ status: 'Trial', trialSearchesUsed: 1 });
expect(row?.trialStartedAt).toBe('2026-05-26T00:00:00.000Z');
```

- [ ] **Step 4: Add no-result free quota test**

Add this test after the first-search test:

```ts
it('does not consume trial quota for no-result searches', async () => {
  const db = createMigratedDatabase();

  try {
    seedCatalog(db);
    const { deps, sentMessages } = createDeps(db);

    await handleTelegramUpdate(
      deps,
      messageUpdate('/search definitely-not-in-catalog', { from: { id: 42, username: 'trial_user' } })
    );

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toBe('No results found. Try checking the spelling or using fewer words.');
    expect(db.prepare('SELECT telegram_user_id FROM subscription_users WHERE telegram_user_id = 42').get()).toBeUndefined();
  } finally {
    db.close();
  }
});
```

- [ ] **Step 5: Add season callback non-consuming test**

Add this test near the season callback tests:

```ts
it('does not consume trial quota for season callbacks', async () => {
  const db = createMigratedDatabase();

  try {
    seedCatalog(db);
    const { deps } = createDeps(db);

    await handleTelegramUpdate(
      deps,
      messageUpdate('/search breaking', { from: { id: 42, username: 'trial_user' } })
    );
    await handleTelegramUpdate(
      deps,
      callbackUpdate('season:30', { from: { id: 42, username: 'trial_user' } })
    );

    const row = db
      .prepare('SELECT trial_searches_used AS trialSearchesUsed FROM subscription_users WHERE telegram_user_id = 42')
      .get() as { trialSearchesUsed: number };

    expect(row.trialSearchesUsed).toBe(1);
  } finally {
    db.close();
  }
});
```

- [ ] **Step 6: Seed valid private callback tests with trial access**

For valid private season callback tests that call `callbackUpdate('season:30')` without first running a `/search`, add:

```ts
seedTrialSearchAccess(db);
```

immediately after `seedCatalog(db);`.

Apply this to these tests:

```text
answers season callbacks before queueing season detail messages
schedules a sheet refresh for an allowed season callback
answers season callbacks even when sending season details fails
returns episode-specific provider links as text for a season callback
```

Do not add trial setup to invalid callback tests, rate-limit tests, group-chat callback tests, or callbacks without a message. Those paths intentionally return before access is evaluated.

- [ ] **Step 7: Update old callback expiry tests**

In `does not leak provider links when subscription is required during a season callback` and `checks subscription again before showing season callback results`, replace the expired-time setup with a kicked-user setup because callbacks no longer fail due to trial time expiry.

Use this setup after `seedCatalog(db);`:

```ts
upsertSeenTelegramUser(db, { id: 42, username: 'kicked_user' }, new Date('2026-05-26T00:00:00.000Z'));
markSubscriptionUserKicked(db, 42, new Date('2026-05-26T00:00:00.000Z'));
```

Then remove `accessNow` mutation and the first callback that created the old trial. Keep the assertion that denied callback paths do not leak provider links.

- [ ] **Step 8: Run handler tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.handlers.test.ts
```

Expected before implementation: FAIL because `handlers.ts` still imports `evaluateSearchAccess` for `/search`.

- [ ] **Step 9: Implement consuming search access in handlers**

In `apps/public-search-bot/src/bot/handlers.ts`, replace the import:

```ts
import { evaluateSearchAccess } from '../subscriptions/access.service.js';
```

with:

```ts
import { consumeSuccessfulSearchAccess, evaluateSearchAccess } from '../subscriptions/access.service.js';
```

In `handleSearch`, replace:

```ts
  const now = deps.subscription.now();
  const access = evaluateSearchAccess(deps.db, {
    user,
    now,
    trialSearchLimit: deps.subscription.trialSearchLimit
  });
```

with:

```ts
  const now = deps.subscription.now();
  const access = consumeSuccessfulSearchAccess(deps.db, {
    user,
    now,
    trialSearchLimit: deps.subscription.trialSearchLimit
  });
```

Keep callback access using `evaluateSearchAccess`.

- [ ] **Step 10: Run handler tests**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.handlers.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit handler behavior**

Run:

```powershell
git add apps/public-search-bot/src/bot/handlers.ts apps/public-search-bot/tests/public-search.handlers.test.ts
git commit -m "feat: count successful trial searches"
```

---

### Task 5: Documentation And Environment Example

**Files:**
- Modify: `apps/public-search-bot/.env.example`
- Modify: `apps/public-search-bot/README.md`

- [ ] **Step 1: Update env example**

In `apps/public-search-bot/.env.example`, replace:

```env
SUBSCRIPTION_TRIAL_HOURS=24
```

with:

```env
SUBSCRIPTION_TRIAL_SEARCH_LIMIT=5
```

- [ ] **Step 2: Update README behavior text**

In `apps/public-search-bot/README.md`, replace each one-day trial reference with count-based text.

Replace:

```md
Public search access is backed by the standalone SQLite subscription database. A user's first search starts a 1-day trial. Paid access lasts 31 days from the current subscription start date. Users whose subscription is expired, unpaid, kicked, or otherwise inactive are blocked from download links.
```

with:

```md
Public search access is backed by the standalone SQLite subscription database. A user's first successful search starts a 5-search trial quota. Paid access lasts 31 days from the current subscription start date. Users whose trial quota is used, subscription is expired, unpaid, kicked, or otherwise inactive are blocked from download links.
```

Replace:

```md
- The default trial is 1 day, the default paid period is 31 days, and overdue users have a 1-day grace period before removal jobs are queued.
```

with:

```md
- The default trial is 5 successful searches, the default paid period is 31 days, and overdue users have a 1-day grace period before removal jobs are queued.
```

Replace:

```md
4. Confirm a new trial user appears in the `Users` sheet after the delayed refresh job.
```

with:

```md
4. Confirm a new trial user appears in the `Users` sheet after the delayed refresh job.
```

Keep this line unchanged because it still applies.

Replace:

```md
- First search starts a 1-day trial.
```

with:

```md
- First successful search starts a 5-search trial quota.
- Searches with no catalog results do not consume the trial quota.
- TV season button clicks do not consume the trial quota.
```

Replace troubleshooting text:

```md
- The user has an active trial or paid subscription row.
```

with:

```md
- The user has remaining trial searches or an active paid subscription row.
```

- [ ] **Step 3: Verify old wording is gone**

Run:

```powershell
rg -n "SUBSCRIPTION_TRIAL_HOURS|1-day trial|1 day free|one-day trial|24-hour" apps/public-search-bot
```

Expected: no matches in active source, tests, README, or `.env.example`.

- [ ] **Step 4: Commit docs**

Run:

```powershell
git add apps/public-search-bot/.env.example apps/public-search-bot/README.md
git commit -m "docs: describe trial search quota"
```

---

### Task 6: Full Verification

**Files:**
- Read: all modified public-search-bot files

- [ ] **Step 1: Search for old time-based trial API**

Run:

```powershell
rg -n "trialHours|subscriptionTrialHours|SUBSCRIPTION_TRIAL_HOURS|trial_expires_at.*Date\\.parse|1 day free trial|1-day trial" apps/public-search-bot/src apps/public-search-bot/tests apps/public-search-bot/README.md apps/public-search-bot/.env.example
```

Expected: no matches except `trial_expires_at` schema/repository compatibility fields if the search expression is broadened manually.

- [ ] **Step 2: Run standalone public search bot tests**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test
```

Expected: all standalone public-search-bot tests pass.

- [ ] **Step 3: Build standalone public search bot**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot run build
```

Expected: TypeScript build completes and writes `apps/public-search-bot/dist`.

- [ ] **Step 4: Run root TypeScript checks**

Run:

```powershell
npx.cmd tsc --noEmit
npx.cmd tsc -p tsconfig.server.json --noEmit
```

Expected: both commands pass.

- [ ] **Step 5: Check whitespace**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 6: Commit final verification fixes if any**

If verification required fixes, commit only the touched public-search-bot files:

```powershell
git add apps/public-search-bot
git commit -m "fix: verify trial search quota"
```

If no fixes were required, do not create an empty commit.

---

## Implementation Notes

- Do not stage unrelated root files currently modified by the previous Public Search preview change:
  - `src/client/pages/PublicSearchPage.tsx`
  - `src/client/styles.css`
  - `src/server/public-search/catalog.ts`
  - `tests/client/App.test.tsx`
  - `tests/public-search/public-search.sync-route.test.ts`
- The trial quota counts successful `/search` calls, not individual result messages. A query that returns 10 result messages still consumes one trial search.
- TV callback buttons are private-chat gated and access gated, but non-consuming. A trial user at `trial_searches_used = 5` can still click season buttons they received from the fifth successful search.
- The local deployment will use a fresh SQLite database, but migration code must keep tests and developer databases safe.

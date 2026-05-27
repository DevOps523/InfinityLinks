# Subscription Plan Months Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user 1 Month, 3 Months, and 6 Months paid subscription options to the public-search-bot Google Sheets subscription workflow.

**Architecture:** Add a small subscription-plan helper for parsing and canonical labels, keep calendar-month date math in the existing date utility, store each user's plan months in SQLite, and make sync/daily refresh calculate each paid user's end date from their own stored plan. The Google Sheets `Users` tab becomes the admin-facing control surface with a new `Plan` column.

**Tech Stack:** TypeScript, Vitest, SQLite via `better-sqlite3`, Google Sheets API adapter, existing public-search-bot subscription modules.

---

## File Structure

- Create `apps/public-search-bot/src/subscriptions/plan.ts`
  - Owns allowed paid plan values, admin-friendly parsing, canonical labels, defaults, and validation.
- Modify `apps/public-search-bot/src/subscriptions/date.ts`
  - Adds calendar-month addition with end-of-month clamping.
- Modify `apps/public-search-bot/src/subscriptions/sheet.mapper.ts`
  - Adds `Plan` to `USERS_HEADER`, parses sheet plan cells, and writes canonical plan labels for paid rows.
- Modify `apps/public-search-bot/src/subscriptions/repository.ts`
  - Adds `subscriptionPlanMonths` to `SubscriptionUser`, stores it in `subscription_users`, calculates paid end dates from plan months, and removes fixed `periodDays` from paid recalculation.
- Modify `apps/public-search-bot/src/db/schema.sql`
  - Adds `subscription_plan_months INTEGER NOT NULL DEFAULT 1`.
- Modify `apps/public-search-bot/src/db/migrate.ts`
  - Safely adds `subscription_plan_months` to existing databases and preserves it through table rebuilds.
- Modify `apps/public-search-bot/src/subscriptions/sync.service.ts`
  - Applies sheet `Plan` with `Start Date`, detects plan-only changes, and writes normalized rows.
- Modify `apps/public-search-bot/src/subscriptions/scheduler.ts`
  - Removes `periodDays` from daily refresh inputs.
- Modify `apps/public-search-bot/src/config.ts`
  - Removes production use of `SUBSCRIPTION_PERIOD_DAYS`.
- Modify `apps/public-search-bot/src/index.ts`
  - Stops passing paid period config into sync and scheduler.
- Modify `apps/public-search-bot/.env.example`
  - Removes `SUBSCRIPTION_PERIOD_DAYS`.
- Modify `apps/public-search-bot/README.md`
  - Documents the new `Plan` column and the allowed plan values.
- Modify tests under `apps/public-search-bot/tests`
  - Updates all affected unit/integration expectations.

---

### Task 1: Plan Helper And Calendar-Month Date Math

**Files:**
- Create: `apps/public-search-bot/src/subscriptions/plan.ts`
- Modify: `apps/public-search-bot/src/subscriptions/date.ts`
- Test: `apps/public-search-bot/tests/public-search.subscription-plan.test.ts`

- [ ] **Step 1: Write failing tests for plan parsing and calendar month math**

Create `apps/public-search-bot/tests/public-search.subscription-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addDateMonths } from '../src/subscriptions/date.js';
import {
  DEFAULT_SUBSCRIPTION_PLAN_MONTHS,
  normalizeSubscriptionPlan,
  subscriptionPlanLabel,
  validateSubscriptionPlanMonths
} from '../src/subscriptions/plan.js';

describe('subscription plan helpers', () => {
  it('normalizes supported plan labels and admin-friendly aliases', () => {
    expect(DEFAULT_SUBSCRIPTION_PLAN_MONTHS).toBe(1);
    expect(normalizeSubscriptionPlan('1 Month')).toBe(1);
    expect(normalizeSubscriptionPlan('1 month')).toBe(1);
    expect(normalizeSubscriptionPlan('1 months')).toBe(1);
    expect(normalizeSubscriptionPlan('1')).toBe(1);
    expect(normalizeSubscriptionPlan('one month')).toBe(1);

    expect(normalizeSubscriptionPlan('3 Months')).toBe(3);
    expect(normalizeSubscriptionPlan('3 month')).toBe(3);
    expect(normalizeSubscriptionPlan('three months')).toBe(3);
    expect(normalizeSubscriptionPlan('3')).toBe(3);

    expect(normalizeSubscriptionPlan('6 Months')).toBe(6);
    expect(normalizeSubscriptionPlan('6 month')).toBe(6);
    expect(normalizeSubscriptionPlan('six months')).toBe(6);
    expect(normalizeSubscriptionPlan('6')).toBe(6);
  });

  it('returns undefined for blank plan values so sheet rows without paid access can stay blank', () => {
    expect(normalizeSubscriptionPlan(undefined)).toBeUndefined();
    expect(normalizeSubscriptionPlan(null)).toBeUndefined();
    expect(normalizeSubscriptionPlan('')).toBeUndefined();
    expect(normalizeSubscriptionPlan('   ')).toBeUndefined();
  });

  it('rejects unsupported plan values with a clear message', () => {
    expect(() => normalizeSubscriptionPlan('2 Months')).toThrow(
      /Invalid Plan: 2 Months. Expected 1 Month, 3 Months, or 6 Months/
    );
    expect(() => normalizeSubscriptionPlan('lifetime')).toThrow(
      /Invalid Plan: lifetime. Expected 1 Month, 3 Months, or 6 Months/
    );
    expect(() => validateSubscriptionPlanMonths(2)).toThrow(
      /Subscription plan months must be 1, 3, or 6/
    );
  });

  it('formats canonical plan labels', () => {
    expect(subscriptionPlanLabel(1)).toBe('1 Month');
    expect(subscriptionPlanLabel(3)).toBe('3 Months');
    expect(subscriptionPlanLabel(6)).toBe('6 Months');
  });

  it('adds calendar months and clamps end-of-month dates', () => {
    expect(addDateMonths('2026-05-27', 1)).toBe('2026-06-27');
    expect(addDateMonths('2026-05-27', 3)).toBe('2026-08-27');
    expect(addDateMonths('2026-05-27', 6)).toBe('2026-11-27');
    expect(addDateMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addDateMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addDateMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(() => addDateMonths('2026-02-31', 1)).toThrow(/Invalid date-only value/);
    expect(() => addDateMonths('2026-05-27', 2)).toThrow(/Subscription plan months must be 1, 3, or 6/);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.subscription-plan.test.ts
```

Expected: FAIL because `apps/public-search-bot/src/subscriptions/plan.ts` and `addDateMonths` do not exist.

- [ ] **Step 3: Implement the plan helper**

Create `apps/public-search-bot/src/subscriptions/plan.ts`:

```ts
export type SubscriptionPlanMonths = 1 | 3 | 6;

export const DEFAULT_SUBSCRIPTION_PLAN_MONTHS: SubscriptionPlanMonths = 1;
export const SUBSCRIPTION_PLAN_MONTHS = [1, 3, 6] as const satisfies readonly SubscriptionPlanMonths[];

const PLAN_ERROR = 'Expected 1 Month, 3 Months, or 6 Months';

export function validateSubscriptionPlanMonths(months: number): asserts months is SubscriptionPlanMonths {
  if (!SUBSCRIPTION_PLAN_MONTHS.includes(months as SubscriptionPlanMonths)) {
    throw new Error(`Subscription plan months must be 1, 3, or 6`);
  }
}

export function subscriptionPlanLabel(months: SubscriptionPlanMonths) {
  validateSubscriptionPlanMonths(months);
  return months === 1 ? '1 Month' : `${months} Months`;
}

export function normalizeSubscriptionPlan(value: unknown): SubscriptionPlanMonths | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (['1', '1 month', '1 months', 'one month'].includes(normalized)) {
    return 1;
  }

  if (['3', '3 month', '3 months', 'three month', 'three months'].includes(normalized)) {
    return 3;
  }

  if (['6', '6 month', '6 months', 'six month', 'six months'].includes(normalized)) {
    return 6;
  }

  throw new Error(`Invalid Plan: ${String(value).trim()}. ${PLAN_ERROR}`);
}
```

- [ ] **Step 4: Implement calendar-month date math**

Modify `apps/public-search-bot/src/subscriptions/date.ts`:

```ts
import { validateSubscriptionPlanMonths, type SubscriptionPlanMonths } from './plan.js';
```

Place that import at the top of the file before `const DATE_ONLY_PATTERN`.

Add this helper near `parseDateOnly`:

```ts
function parseDateOnlyParts(value: string) {
  parseDateOnly(value);
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDateOnly(year: number, month: number, day: number) {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}
```

Add this exported function after `addDateDays`:

```ts
export function addDateMonths(dateOnly: string, months: SubscriptionPlanMonths) {
  validateSubscriptionPlanMonths(months);
  const parts = parseDateOnlyParts(dateOnly);
  const targetMonthIndex = parts.month - 1 + months;
  const targetYear = parts.year + Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12) + 1;
  const targetDay = Math.min(parts.day, lastDayOfMonth(targetYear, targetMonth));

  return formatDateOnly(targetYear, targetMonth, targetDay);
}
```

- [ ] **Step 5: Run the focused tests and commit**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.subscription-plan.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/public-search-bot/src/subscriptions/date.ts apps/public-search-bot/src/subscriptions/plan.ts apps/public-search-bot/tests/public-search.subscription-plan.test.ts
git commit -m "feat: add subscription plan helpers"
```

---

### Task 2: Database Schema, Migration, And Repository Plan Storage

**Files:**
- Modify: `apps/public-search-bot/src/db/schema.sql`
- Modify: `apps/public-search-bot/src/db/migrate.ts`
- Modify: `apps/public-search-bot/src/subscriptions/repository.ts`
- Test: `apps/public-search-bot/tests/public-search.db.test.ts`
- Test: `apps/public-search-bot/tests/public-search.subscription-repository.test.ts`

- [ ] **Step 1: Write failing database migration tests**

In `apps/public-search-bot/tests/public-search.db.test.ts`, add:

```ts
it('creates subscription plan months with a default one-month plan', () => {
  const db = createDb();
  try {
    expect(columnNames(db, 'subscription_users')).toContain('subscription_plan_months');

    const row = db
      .prepare(
        `INSERT INTO subscription_users (
           telegram_user_id,
           status,
           created_at,
           updated_at
         )
         VALUES (42, 'Unpaid', '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z')
         RETURNING subscription_plan_months AS subscriptionPlanMonths`
      )
      .get() as { subscriptionPlanMonths: number };

    expect(row.subscriptionPlanMonths).toBe(1);
  } finally {
    db.close();
  }
});

it('adds subscription plan months to legacy subscription users tables', () => {
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
        status TEXT NOT NULL DEFAULT 'Unpaid',
        unpaid_since TEXT,
        kicked_at TEXT,
        removed_from_group INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO subscription_users (
        telegram_user_id,
        username,
        subscription_start_date,
        subscription_end_date,
        days_remaining,
        status,
        removed_from_group,
        created_at,
        updated_at
      )
      VALUES (
        42,
        'paid_user',
        '2026-05-26',
        '2026-06-26',
        31,
        'Subscribe',
        0,
        '2026-05-26T00:00:00.000Z',
        '2026-05-26T00:00:00.000Z'
      );
    `);

    migratePublicSearchDatabase(db);

    expect(columnNames(db, 'subscription_users')).toContain('subscription_plan_months');
    expect(
      db
        .prepare('SELECT subscription_plan_months AS subscriptionPlanMonths FROM subscription_users WHERE telegram_user_id = 42')
        .get()
    ).toEqual({ subscriptionPlanMonths: 1 });
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Write failing repository tests for plan-specific paid dates**

In `apps/public-search-bot/tests/public-search.subscription-repository.test.ts`, update the imports:

```ts
import { addDateDays, addDateMonths, calculateDaysRemaining, todayDateString } from '../src/subscriptions/date.js';
```

Replace the `uses date-only math for 31-day subscriptions` test with:

```ts
it('uses date-only math for subscription date calculations', () => {
  expect(addDateDays('2026-05-26', 31)).toBe('2026-06-26');
  expect(addDateMonths('2026-05-26', 1)).toBe('2026-06-26');
  expect(calculateDaysRemaining('2026-06-26', '2026-05-26')).toBe(31);
  expect(calculateDaysRemaining('2026-06-26', '2026-06-25')).toBe(1);
  expect(calculateDaysRemaining('2026-06-26', '2026-06-26')).toBe(0);
  expect(todayDateString(new Date('2026-05-26T16:00:00.000Z'))).toBe('2026-05-26');
  expect(() => addDateDays('2026-02-31', 1)).toThrow(/Invalid date-only value/);
});
```

Replace calls shaped like:

```ts
applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), 31)
```

with:

```ts
applySubscriptionStartDate(db, 42, '2026-05-26', 1, new Date('2026-05-26T00:00:00.000Z'))
```

Replace calls shaped like:

```ts
recalculateSubscriptions(db, '2026-06-25', 31)
```

with:

```ts
recalculateSubscriptions(db, '2026-06-25')
```

Add this test:

```ts
it('applies paid start dates using each selected plan month duration', () => {
  const db = createDb();
  try {
    upsertSeenTelegramUser(db, { id: 42, username: 'one_month' }, new Date('2026-05-26T00:00:00.000Z'));
    upsertSeenTelegramUser(db, { id: 43, username: 'three_months' }, new Date('2026-05-26T00:00:00.000Z'));
    upsertSeenTelegramUser(db, { id: 44, username: 'six_months' }, new Date('2026-05-26T00:00:00.000Z'));

    expect(applySubscriptionStartDate(db, 42, '2026-05-26', 1, new Date('2026-05-26T00:00:00.000Z'))).toMatchObject({
      subscriptionPlanMonths: 1,
      subscriptionEndDate: '2026-06-26',
      daysRemaining: 31,
      status: 'Subscribe'
    });
    expect(applySubscriptionStartDate(db, 43, '2026-05-26', 3, new Date('2026-05-26T00:00:00.000Z'))).toMatchObject({
      subscriptionPlanMonths: 3,
      subscriptionEndDate: '2026-08-26',
      daysRemaining: 92,
      status: 'Subscribe'
    });
    expect(applySubscriptionStartDate(db, 44, '2026-05-26', 6, new Date('2026-05-26T00:00:00.000Z'))).toMatchObject({
      subscriptionPlanMonths: 6,
      subscriptionEndDate: '2026-11-26',
      daysRemaining: 184,
      status: 'Subscribe'
    });
  } finally {
    db.close();
  }
});

it('recalculates paid subscriptions using each stored plan duration', () => {
  const db = createDb();
  try {
    upsertSeenTelegramUser(db, { id: 42, username: 'one_month' }, new Date('2026-05-26T00:00:00.000Z'));
    upsertSeenTelegramUser(db, { id: 43, username: 'three_months' }, new Date('2026-05-26T00:00:00.000Z'));
    applySubscriptionStartDate(db, 42, '2026-05-26', 1, new Date('2026-05-26T00:00:00.000Z'));
    applySubscriptionStartDate(db, 43, '2026-05-26', 3, new Date('2026-05-26T00:00:00.000Z'));

    recalculateSubscriptions(db, '2026-06-26');

    expect(getSubscriptionUser(db, 42)).toMatchObject({
      subscriptionPlanMonths: 1,
      subscriptionEndDate: '2026-06-26',
      daysRemaining: 0,
      status: 'Unpaid',
      unpaidSince: '2026-06-26'
    });
    expect(getSubscriptionUser(db, 43)).toMatchObject({
      subscriptionPlanMonths: 3,
      subscriptionEndDate: '2026-08-26',
      daysRemaining: 61,
      status: 'Subscribe',
      unpaidSince: undefined
    });
  } finally {
    db.close();
  }
});
```

Replace the invalid period test with:

```ts
it('rejects invalid paid subscription plan months', () => {
  const db = createDb();
  try {
    upsertSeenTelegramUser(db, { id: 42, username: 'paid_user' }, new Date('2026-05-26T00:00:00.000Z'));

    for (const planMonths of [0, 2, 4, 12, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        applySubscriptionStartDate(db, 42, '2026-05-26', planMonths, new Date('2026-05-26T00:00:00.000Z'))
      ).toThrow(/Subscription plan months must be 1, 3, or 6/);
    }
  } finally {
    db.close();
  }
});
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.db.test.ts tests/public-search.subscription-repository.test.ts
```

Expected: FAIL because schema/repository do not yet expose `subscription_plan_months` or the new function signatures.

- [ ] **Step 4: Add schema and migration support**

In `apps/public-search-bot/src/db/schema.sql`, add `subscription_plan_months` after `subscription_end_date`:

```sql
  subscription_start_date TEXT,
  subscription_end_date TEXT,
  subscription_plan_months INTEGER NOT NULL DEFAULT 1,
  days_remaining INTEGER,
```

In `apps/public-search-bot/src/db/migrate.ts`, call the new migration before any table rebuild:

```ts
  addSubscriptionUsersTrialSearchesUsedColumnIfNeeded(db);
  addSubscriptionUsersPlanMonthsColumnIfNeeded(db);
  rebuildSubscriptionUsersBooleanConstraintIfNeeded(db);
```

Add this function after `addSubscriptionUsersTrialSearchesUsedColumnIfNeeded`:

```ts
function addSubscriptionUsersPlanMonthsColumnIfNeeded(db: PublicSearchDatabase) {
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
  if (columns.some((column) => column.name === 'subscription_plan_months')) {
    return;
  }

  db.exec('ALTER TABLE subscription_users ADD COLUMN subscription_plan_months INTEGER NOT NULL DEFAULT 1');
}
```

In `rebuildSubscriptionUsersBooleanConstraintIfNeeded`, add the column to the rebuilt table:

```sql
        subscription_start_date TEXT,
        subscription_end_date TEXT,
        subscription_plan_months INTEGER NOT NULL DEFAULT 1,
        days_remaining INTEGER,
```

Add it to the insert column list:

```sql
        subscription_start_date,
        subscription_end_date,
        subscription_plan_months,
        days_remaining,
```

Add it to the select list:

```sql
        subscription_start_date,
        subscription_end_date,
        COALESCE(subscription_plan_months, 1),
        days_remaining,
```

- [ ] **Step 5: Update repository types and paid date calculations**

In `apps/public-search-bot/src/subscriptions/repository.ts`, update imports:

```ts
import { addDateMonths, calculateDaysRemaining, dateDifferenceDays, todayDateString, validateDateOnly } from './date.js';
import {
  DEFAULT_SUBSCRIPTION_PLAN_MONTHS,
  validateSubscriptionPlanMonths,
  type SubscriptionPlanMonths
} from './plan.js';
```

Add `subscriptionPlanMonths` to `SubscriptionUser` and `SubscriptionUserRow`:

```ts
  subscriptionEndDate?: string | undefined;
  subscriptionPlanMonths: SubscriptionPlanMonths;
  daysRemaining?: number | undefined;
```

```ts
  subscriptionEndDate: string | null;
  subscriptionPlanMonths: SubscriptionPlanMonths;
  daysRemaining: number | null;
```

Add the select column in `getSubscriptionUser`:

```sql
         subscription_end_date AS subscriptionEndDate,
         subscription_plan_months AS subscriptionPlanMonths,
         days_remaining AS daysRemaining,
```

Add the same select column in `listSubscriptionUsers`:

```sql
         subscription_end_date AS subscriptionEndDate,
         subscription_plan_months AS subscriptionPlanMonths,
         days_remaining AS daysRemaining,
```

Update `applySubscriptionStartDate` signature and implementation:

```ts
export function applySubscriptionStartDate(
  db: PublicSearchDatabase,
  telegramUserId: number,
  startDate: string,
  planMonths: number,
  now: Date
): SubscriptionUser {
  validateSubscriptionPlanMonths(planMonths);
  const current = getSubscriptionUser(db, telegramUserId);

  if (!current) {
    throw new Error(`Subscription user ${telegramUserId} does not exist`);
  }

  const nowIso = now.toISOString();
  const endDate = addDateMonths(startDate, planMonths);
  const daysRemaining = calculateDaysRemaining(endDate, todayDateString(now));
  const calculatedStatus = statusForDaysRemaining(daysRemaining);
  const hasActivePaidAccess = isActivePaidStatus(calculatedStatus);
  const preserveRemovedState = !hasActivePaidAccess && (current.status === 'Kicked' || current.removedFromGroup);
  const status = preserveRemovedState ? 'Kicked' : calculatedStatus;
  const unpaidSince = hasActivePaidAccess ? null : current.unpaidSince ?? todayDateString(now);
  const kickedAt = current.kickedAt ?? null;
  const historyExportedAt = current.historyExportedAt ?? null;
  const removedFromGroup = current.removedFromGroup || preserveRemovedState ? 1 : 0;

  const result = db.prepare(
    `UPDATE subscription_users
     SET subscription_start_date = @subscriptionStartDate,
         subscription_end_date = @subscriptionEndDate,
         subscription_plan_months = @subscriptionPlanMonths,
         days_remaining = @daysRemaining,
         status = @status,
         unpaid_since = @unpaidSince,
         kicked_at = @kickedAt,
         history_exported_at = @historyExportedAt,
         removed_from_group = @removedFromGroup,
         updated_at = @nowIso
     WHERE telegram_user_id = @telegramUserId`
  ).run({
    telegramUserId,
    subscriptionStartDate: startDate,
    subscriptionEndDate: endDate,
    subscriptionPlanMonths: planMonths,
    daysRemaining,
    status,
    unpaidSince,
    kickedAt,
    historyExportedAt,
    removedFromGroup,
    nowIso
  });

  if (result.changes !== 1) {
    throw new Error(`Subscription user ${telegramUserId} does not exist`);
  }

  return requireSubscriptionUser(db, telegramUserId);
}
```

Update `recalculateSubscriptions` signature and calculation:

```ts
export function recalculateSubscriptions(db: PublicSearchDatabase, today: string): void {
  validateDateOnly(today);

  const updatedAt = `${today}T00:00:00.000Z`;
  const rows = db
    .prepare(
      `SELECT
         telegram_user_id AS telegramUserId,
         subscription_start_date AS subscriptionStartDate,
         subscription_plan_months AS subscriptionPlanMonths,
         unpaid_since AS unpaidSince
       FROM subscription_users
       WHERE status != 'Kicked'
         AND subscription_start_date IS NOT NULL`
    )
    .all() as Array<{
      telegramUserId: number;
      subscriptionStartDate: string;
      subscriptionPlanMonths: SubscriptionPlanMonths;
      unpaidSince: string | null;
    }>;
```

Inside the loop:

```ts
      validateSubscriptionPlanMonths(row.subscriptionPlanMonths);
      const subscriptionEndDate = addDateMonths(row.subscriptionStartDate, row.subscriptionPlanMonths);
```

Update `mapSubscriptionUser` near the bottom:

```ts
    subscriptionEndDate: row.subscriptionEndDate ?? undefined,
    subscriptionPlanMonths: row.subscriptionPlanMonths ?? DEFAULT_SUBSCRIPTION_PLAN_MONTHS,
    daysRemaining: row.daysRemaining ?? undefined,
```

Remove `validateSubscriptionPeriodDays` if it has no callers.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.db.test.ts tests/public-search.subscription-repository.test.ts tests/public-search.subscription-plan.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/public-search-bot/src/db/schema.sql apps/public-search-bot/src/db/migrate.ts apps/public-search-bot/src/subscriptions/repository.ts apps/public-search-bot/tests/public-search.db.test.ts apps/public-search-bot/tests/public-search.subscription-repository.test.ts
git commit -m "feat: store subscription plan months"
```

---

### Task 3: Sheet Mapper Plan Column

**Files:**
- Modify: `apps/public-search-bot/src/subscriptions/sheet.mapper.ts`
- Test: `apps/public-search-bot/tests/public-search.subscription-sheet-mapper.test.ts`

- [ ] **Step 1: Write failing sheet mapper tests**

In `apps/public-search-bot/tests/public-search.subscription-sheet-mapper.test.ts`, update row fixtures so `USERS_HEADER` means:

```ts
['User ID', 'Username', 'Start Date', 'Plan', 'End Date', 'Days Remaining', 'Status', 'Last Updated']
```

Add these focused tests:

```ts
it('parses and normalizes subscription plan values from the Users sheet', () => {
  expect(
    parseUsersSheetRows([
      USERS_HEADER,
      ['42', '@paid_user', '2026-05-26', '3 months', '', '', 'Subscribe', '2026-05-26T00:00:00.000Z'],
      ['43', '@trial_user', '', '', '', '', 'Trial', '2026-05-26T00:00:00.000Z']
    ])
  ).toEqual([
    {
      telegramUserId: 42,
      username: 'paid_user',
      startDate: '2026-05-26',
      planMonths: 3,
      status: 'Subscribe',
      lastUpdated: '2026-05-26T00:00:00.000Z'
    },
    {
      telegramUserId: 43,
      username: 'trial_user',
      status: 'Trial',
      lastUpdated: '2026-05-26T00:00:00.000Z'
    }
  ]);
});

it('rejects invalid subscription plan values with row context', () => {
  expect(() =>
    parseUsersSheetRows([
      USERS_HEADER,
      ['42', '@paid_user', '2026-05-26', '2 Months', '', '', 'Subscribe', '']
    ])
  ).toThrow(/Invalid Plan in Users sheet row 2: 2 Months. Expected 1 Month, 3 Months, or 6 Months/);
});

it('writes canonical plan labels only for paid rows with start dates', () => {
  expect(
    toUsersSheetRows([
      {
        telegramUserId: 42,
        username: 'paid_user',
        subscriptionStartDate: '2026-05-26',
        subscriptionPlanMonths: 3,
        subscriptionEndDate: '2026-08-26',
        daysRemaining: 92,
        status: 'Subscribe',
        trialSearchesUsed: 0,
        removedFromGroup: false,
        createdAt: '2026-05-26T00:00:00.000Z',
        updatedAt: '2026-05-26T00:00:00.000Z'
      },
      {
        telegramUserId: 43,
        username: 'trial_user',
        subscriptionPlanMonths: 1,
        status: 'Trial',
        trialSearchesUsed: 2,
        removedFromGroup: false,
        createdAt: '2026-05-26T00:00:00.000Z',
        updatedAt: '2026-05-26T00:00:00.000Z'
      }
    ])
  ).toEqual([
    USERS_HEADER,
    ['42', '@paid_user', '2026-05-26', '3 Months', '2026-08-26', '92', 'Subscribe', '2026-05-26T00:00:00.000Z'],
    ['43', '@trial_user', '', '', '', '', 'Trial', '2026-05-26T00:00:00.000Z']
  ]);
});
```

- [ ] **Step 2: Run sheet mapper tests and verify they fail**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.subscription-sheet-mapper.test.ts
```

Expected: FAIL because `Plan` is not yet in `USERS_HEADER` and parsed rows do not expose `planMonths`.

- [ ] **Step 3: Update the sheet mapper**

In `apps/public-search-bot/src/subscriptions/sheet.mapper.ts`, update imports:

```ts
import {
  DEFAULT_SUBSCRIPTION_PLAN_MONTHS,
  normalizeSubscriptionPlan,
  subscriptionPlanLabel,
  type SubscriptionPlanMonths
} from './plan.js';
```

Update `USERS_HEADER`:

```ts
export const USERS_HEADER = ['User ID', 'Username', 'Start Date', 'Plan', 'End Date', 'Days Remaining', 'Status', 'Last Updated'];
```

Add `planMonths` to `ParsedUsersSheetRow`:

```ts
  startDate?: string | undefined;
  planMonths?: SubscriptionPlanMonths | undefined;
  endDate?: string | undefined;
```

Add this normalizer after `normalizeDateOnly`:

```ts
function normalizePlan(value: SheetCell, rowNumber: number) {
  try {
    return normalizeSubscriptionPlan(value);
  } catch {
    const raw = normalizeString(value) ?? '';
    throw new SheetValidationError(
      `Invalid Plan in Users sheet row ${rowNumber}: ${raw}. Expected 1 Month, 3 Months, or 6 Months`
    );
  }
}
```

Update row parsing indexes:

```ts
        startDate: normalizeDateOnly(row[2], 'Start Date', index + 2),
        planMonths: normalizePlan(row[3], index + 2),
        endDate: normalizeDateOnly(row[4], 'End Date', index + 2),
        daysRemaining: normalizeDaysRemaining(row[5]),
        status: normalizeStatus(row[6]),
        lastUpdated: normalizeLastUpdated(row[7])
```

Add a helper before `toUsersSheetRows`:

```ts
function planCell(user: SubscriptionUser) {
  if (!user.subscriptionStartDate) {
    return '';
  }

  return subscriptionPlanLabel(user.subscriptionPlanMonths ?? DEFAULT_SUBSCRIPTION_PLAN_MONTHS);
}
```

Update writer row shape:

```ts
      user.subscriptionStartDate ?? '',
      planCell(user),
      user.subscriptionEndDate ?? '',
      user.daysRemaining === undefined ? '' : String(user.daysRemaining),
      user.status,
      user.updatedAt
```

- [ ] **Step 4: Run sheet mapper tests and commit**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.subscription-sheet-mapper.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/public-search-bot/src/subscriptions/sheet.mapper.ts apps/public-search-bot/tests/public-search.subscription-sheet-mapper.test.ts
git commit -m "feat: add subscription plan sheet column"
```

---

### Task 4: Sync And Daily Refresh Use Per-User Plans

**Files:**
- Modify: `apps/public-search-bot/src/subscriptions/sync.service.ts`
- Modify: `apps/public-search-bot/src/subscriptions/scheduler.ts`
- Modify: `apps/public-search-bot/src/index.ts`
- Test: `apps/public-search-bot/tests/public-search.subscription-sync.test.ts`
- Test: `apps/public-search-bot/tests/public-search.subscription-jobs.test.ts`

- [ ] **Step 1: Write failing sync and scheduler tests**

In `apps/public-search-bot/tests/public-search.subscription-sync.test.ts`, update all sheet rows to include the `Plan` column. For example:

```ts
readRows: vi.fn(async () => [USERS_HEADER, ['42', '@paid_user', '2026-05-26', '3 Months', '', '', '', '']])
```

Update the expected writeback:

```ts
expect(sheets.replaceRows).toHaveBeenCalledWith('Users!A:H', [
  USERS_HEADER,
  ['42', '@paid_user', '2026-05-26', '3 Months', '2026-08-26', '92', 'Subscribe', expect.any(String)]
]);
```

Add this test:

```ts
it('updates an existing paid subscription when only the plan changes', async () => {
  const db = createDb();
  try {
    db.prepare(
      `INSERT INTO subscription_users (
         telegram_user_id, username, subscription_start_date, subscription_end_date, subscription_plan_months,
         days_remaining, status, removed_from_group, created_at, updated_at
       )
       VALUES (
         42, 'paid_user', '2026-05-26', '2026-06-26', 1,
         31, 'Subscribe', 0, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z'
       )`
    ).run();
    const sheets = {
      readRows: vi.fn(async () => [USERS_HEADER, ['42', '@paid_user', '2026-05-26', '3 Months', '', '', 'Subscribe', '']]),
      replaceRows: vi.fn(async () => undefined),
      appendRows: vi.fn(async () => undefined)
    };

    const result = await syncSubscriptionsFromSheet(db, sheets, {
      usersRange: 'Users!A:H',
      historyRange: 'History!A:G',
      now: new Date('2026-05-26T00:00:00.000Z')
    });

    expect(result.updatedUsers).toBe(1);
    expect(getSubscriptionUser(db, 42)).toMatchObject({
      subscriptionStartDate: '2026-05-26',
      subscriptionPlanMonths: 3,
      subscriptionEndDate: '2026-08-26',
      daysRemaining: 92,
      status: 'Subscribe'
    });
  } finally {
    db.close();
  }
});

it('defaults blank paid plan cells to one month and writes the normalized plan back', async () => {
  const db = createDb();
  try {
    db.prepare(
      `INSERT INTO subscription_users (telegram_user_id, username, status, removed_from_group, created_at, updated_at)
       VALUES (42, 'paid_user', 'Unpaid', 0, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z')`
    ).run();
    const sheets = {
      readRows: vi.fn(async () => [USERS_HEADER, ['42', '@paid_user', '2026-05-26', '', '', '', '', '']]),
      replaceRows: vi.fn(async () => undefined),
      appendRows: vi.fn(async () => undefined)
    };

    await syncSubscriptionsFromSheet(db, sheets, {
      usersRange: 'Users!A:H',
      historyRange: 'History!A:G',
      now: new Date('2026-05-26T00:00:00.000Z')
    });

    expect(sheets.replaceRows).toHaveBeenCalledWith('Users!A:H', [
      USERS_HEADER,
      ['42', '@paid_user', '2026-05-26', '1 Month', '2026-06-26', '31', 'Subscribe', expect.any(String)]
    ]);
  } finally {
    db.close();
  }
});
```

Update daily refresh tests so calls no longer pass `periodDays`:

```ts
const result = await runDailySubscriptionRefresh(db, {
  today: '2026-06-27',
  overdueGraceDays: 1,
  enqueueAt: new Date('2026-06-27T00:00:00.000Z')
});
```

Add `subscription_plan_months` to inserted paid rows when a test needs a non-default plan:

```sql
subscription_start_date, subscription_end_date, subscription_plan_months, days_remaining,
```

- [ ] **Step 2: Run focused sync tests and verify they fail**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.subscription-sync.test.ts tests/public-search.subscription-jobs.test.ts
```

Expected: FAIL because sync and scheduler still require `periodDays`, and sync ignores plan changes.

- [ ] **Step 3: Update sync service**

In `apps/public-search-bot/src/subscriptions/sync.service.ts`, import the default plan:

```ts
import { DEFAULT_SUBSCRIPTION_PLAN_MONTHS } from './plan.js';
```

Remove `periodDays` from `SyncSubscriptionsFromSheetOptions`:

```ts
export type SyncSubscriptionsFromSheetOptions = {
  usersRange: string;
  historyRange: string;
  now: Date;
};
```

Update the initial recalculation:

```ts
  recalculateSubscriptions(db, todayDateString(options.now));
```

Replace the row loop paid-application logic with:

```ts
    const planMonths = row.planMonths ?? DEFAULT_SUBSCRIPTION_PLAN_MONTHS;
    const current = getSubscriptionUser(db, row.telegramUserId);
    if (!current) {
      skippedUnknownUsers += 1;
      continue;
    }

    const planChanged = current.subscriptionPlanMonths !== planMonths;
    if (current.subscriptionStartDate === row.startDate && !planChanged) {
      if (current.removedFromGroup) {
        const paidUser = applySubscriptionStartDate(db, row.telegramUserId, row.startDate, planMonths, options.now);
        if (needsUnban(paidUser)) {
          paidUsers.push(paidUser);
        }
      }
      continue;
    }

    const paidUser = applySubscriptionStartDate(db, row.telegramUserId, row.startDate, planMonths, options.now);
```

- [ ] **Step 4: Update scheduler and index wiring**

In `apps/public-search-bot/src/subscriptions/scheduler.ts`, remove `periodDays` from `DailySubscriptionRefreshOptions` and `createDailySubscriptionRefreshRun` input:

```ts
export type DailySubscriptionRefreshOptions = {
  today: string;
  overdueGraceDays: number;
  enqueueAt: Date;
};
```

Update refresh:

```ts
    recalculateSubscriptions(db, options.today);
```

Update create input:

```ts
export function createDailySubscriptionRefreshRun(input: {
  db: PublicSearchDatabase;
  overdueGraceDays: number;
  now?: (() => Date) | undefined;
}) {
```

In `apps/public-search-bot/src/index.ts`, remove `periodDays` arguments:

```ts
  const dailySubscriptionRefresh = createDailySubscriptionRefreshRun({
    db,
    overdueGraceDays: config.subscriptionOverdueGraceDays
  });
```

For sync route:

```ts
        const result = await syncSubscriptionsFromSheet(db, sheets, {
          usersRange: config.googleSheetsUsersRange,
          historyRange: config.googleSheetsHistoryRange,
          now: new Date()
        });
```

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.subscription-sync.test.ts tests/public-search.subscription-jobs.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/public-search-bot/src/subscriptions/sync.service.ts apps/public-search-bot/src/subscriptions/scheduler.ts apps/public-search-bot/src/index.ts apps/public-search-bot/tests/public-search.subscription-sync.test.ts apps/public-search-bot/tests/public-search.subscription-jobs.test.ts
git commit -m "feat: sync subscription plans"
```

---

### Task 5: Remove Fixed Paid-Period Configuration

**Files:**
- Modify: `apps/public-search-bot/src/config.ts`
- Modify: `apps/public-search-bot/.env.example`
- Test: `apps/public-search-bot/tests/public-search.config.test.ts`

- [ ] **Step 1: Write failing config tests**

In `apps/public-search-bot/tests/public-search.config.test.ts`, remove expected `subscriptionPeriodDays` from default and explicit config expectations.

Remove this explicit env input:

```ts
SUBSCRIPTION_PERIOD_DAYS: '30',
```

Add this test:

```ts
it('ignores obsolete SUBSCRIPTION_PERIOD_DAYS values', () => {
  const config = loadPublicSearchConfig({
    ...validRequiredEnv,
    SUBSCRIPTION_PERIOD_DAYS: '999'
  });

  expect(config).not.toHaveProperty('subscriptionPeriodDays');
});
```

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.config.test.ts
```

Expected: FAIL because `subscriptionPeriodDays` still exists.

- [ ] **Step 3: Remove fixed period config**

In `apps/public-search-bot/src/config.ts`, remove schema field:

```ts
SUBSCRIPTION_PERIOD_DAYS: numberWithDefault(31),
```

Remove type field:

```ts
subscriptionPeriodDays: number;
```

Remove return field:

```ts
subscriptionPeriodDays: parsed.SUBSCRIPTION_PERIOD_DAYS,
```

In `apps/public-search-bot/.env.example`, remove:

```text
SUBSCRIPTION_PERIOD_DAYS=31
```

- [ ] **Step 4: Run config tests and commit**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.config.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/public-search-bot/src/config.ts apps/public-search-bot/.env.example apps/public-search-bot/tests/public-search.config.test.ts
git commit -m "chore: remove fixed subscription period config"
```

---

### Task 6: Documentation And Environment Cleanup

**Files:**
- Modify: `apps/public-search-bot/README.md`
- Modify: `apps/public-search-bot/.env`
- Test: manual `rg` checks

- [ ] **Step 1: Update README sheet header and behavior docs**

In `apps/public-search-bot/README.md`, replace every `Users` sheet header:

```text
Users: User ID | Username | Start Date | End Date | Days Remaining | Status | Last Updated
```

with:

```text
Users: User ID | Username | Start Date | Plan | End Date | Days Remaining | Status | Last Updated
```

Replace setup examples containing:

```text
SUBSCRIPTION_PERIOD_DAYS=31
```

by removing the line entirely.

In the subscription behavior section, replace:

```text
Paid access is 31 days from `Start Date`.
```

with:

```text
Paid access is calculated from `Start Date` and `Plan`. Supported plans are `1 Month`, `3 Months`, and `6 Months`; blank paid plan cells default to `1 Month` and are written back as `1 Month`.
```

Add an operator note near the Google Sheets setup:

```markdown
For paid users, enter `Start Date` and choose `Plan` as `1 Month`, `3 Months`, or `6 Months`. The bot recalculates `End Date`, `Days Remaining`, and `Status` when you run `Subscriptions > Update Subscription`.
```

- [ ] **Step 2: Remove obsolete fixed-period env from local ignored env if present**

If `apps/public-search-bot/.env` exists and contains `SUBSCRIPTION_PERIOD_DAYS=31`, remove that line. Keep secrets unchanged.

Use `apply_patch` for the one-line removal:

```diff
-SUBSCRIPTION_PERIOD_DAYS=31
```

- [ ] **Step 3: Verify docs/env no longer mention fixed paid-period config**

Run:

```bash
rg -n "SUBSCRIPTION_PERIOD_DAYS|subscriptionPeriodDays|periodDays: config.subscriptionPeriodDays|Paid access is 31 days" apps/public-search-bot
```

Expected: no matches; `rg` exits 1.

Run:

```bash
rg -n "Plan \\| End Date|1 Month|3 Months|6 Months" apps/public-search-bot/README.md apps/public-search-bot/.env.example
```

Expected: matches in README for the new sheet header and plan docs.

- [ ] **Step 4: Commit documentation changes**

Commit:

```bash
git add apps/public-search-bot/README.md apps/public-search-bot/.env.example
git commit -m "docs: describe subscription plan options"
```

Do not commit `apps/public-search-bot/.env` because it is an ignored local environment file.

---

### Task 7: Full Test Update And Verification

**Files:**
- Modify any remaining affected tests under `apps/public-search-bot/tests`
- No production edits unless a verification failure identifies a missed compile or behavior update

- [ ] **Step 1: Find all stale fixed-period references**

Run:

```bash
rg -n "SUBSCRIPTION_PERIOD_DAYS|subscriptionPeriodDays|periodDays|Subscription period days|31-day subscriptions|Paid access is 31 days" apps/public-search-bot/src apps/public-search-bot/tests apps/public-search-bot/README.md apps/public-search-bot/.env.example
```

Expected: no production config references. Some `periodDays` references should not remain in `src`. If tests still have old helper names or old row shapes, update them to plan-month equivalents before proceeding.

- [ ] **Step 2: Run the full public-search-bot suite**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test
```

Expected: PASS with all public-search-bot tests green.

- [ ] **Step 3: Run the public-search-bot build**

Run:

```bash
npm.cmd --prefix apps/public-search-bot run build
```

Expected: PASS.

- [ ] **Step 4: Run workspace TypeScript checks**

Run:

```bash
npx.cmd tsc --noEmit
```

Expected: PASS.

Run:

```bash
npx.cmd tsc -p tsconfig.server.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Check whitespace and final git status**

Run:

```bash
git diff --check
```

Expected: PASS.

Run:

```bash
git status --short
```

Expected: only intentional changes for the current task remain. If `apps/public-search-bot/.env` is modified, leave it unstaged and mention it in the final handoff.

- [ ] **Step 6: Commit any final compile/test fixes**

If Step 1 through Step 5 required additional tracked source/test edits, commit them:

```bash
git add apps/public-search-bot/src apps/public-search-bot/tests apps/public-search-bot/README.md apps/public-search-bot/.env.example
git commit -m "test: verify subscription plan options"
```

If no additional tracked edits are needed, do not create an empty commit.

---

## Final Acceptance Criteria

- `Users` sheet header is `User ID | Username | Start Date | Plan | End Date | Days Remaining | Status | Last Updated`.
- Admin can enter `1 Month`, `3 Months`, or `6 Months` for each paid row.
- Blank `Plan` with a paid `Start Date` defaults to `1 Month` and writes back as `1 Month`.
- Rows without paid `Start Date` keep blank `Plan` when written back.
- End dates use calendar months with end-of-month clamping.
- Changing only `Plan` recalculates the subscription on the next update.
- Daily refresh uses each user's stored plan months.
- `SUBSCRIPTION_PERIOD_DAYS` is not used by production code and is not documented in `.env.example` or README.
- Public-search trial quota behavior remains unchanged.
- All verification commands pass.

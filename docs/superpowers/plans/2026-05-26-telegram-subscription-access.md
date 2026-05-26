# Telegram Subscription Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-day trial access, paid subscription gating, Google Sheets administration, subscription alerts, and overdue user removal to the standalone Telegram public search service.

**Architecture:** Extend `apps/public-search-bot/` into one VPS service that runs two Telegram bot tokens against one SQLite database. The public search bot gates `/search` and season callbacks through subscription access, while the subscription bot handles user tracking, alert posts, queued Telegram actions, and Google Sheets synchronization.

**Tech Stack:** Node.js 22, TypeScript, Express, better-sqlite3, Zod, Vitest, Supertest, Telegram Bot API, Google Sheets API through `googleapis`.

---

## Scope Check

The approved spec touches several subsystems: access gating, subscription storage, Telegram admin actions, Google Sheets sync, and deployment docs. They are coupled by the same SQLite subscription state, so this plan keeps them together but orders work in phases where each task is independently testable and commit-ready.

Do not start with Telegram live testing. Build the database, services, routes, and bot behavior behind tests first. Live Telegram and Google credentials are rollout work after the test suite passes.

## File Structure

Create a focused subscription module inside the standalone app:

```text
apps/public-search-bot/src/subscriptions/
  access.service.ts          # public search access decisions and trial start
  alert.service.ts           # alert message formatting/post/edit/delete behavior
  bot.handlers.ts            # subscription bot update handling
  date.ts                    # date-only subscription math
  google-sheets.client.ts    # Google Sheets API adapter
  job.processor.ts           # persistent job execution with retry/backoff
  job.repository.ts          # subscription job queue persistence
  repository.ts              # subscription user persistence and status transitions
  routes.ts                  # authenticated admin endpoints
  scheduler.ts               # periodic refresh loop
  sheet.mapper.ts            # Users/History row parsing and formatting
  sync.service.ts            # sheet/database orchestration
```

Modify existing standalone files:

```text
apps/public-search-bot/src/bot/formatter.ts
apps/public-search-bot/src/bot/handlers.ts
apps/public-search-bot/src/config.ts
apps/public-search-bot/src/app.ts
apps/public-search-bot/src/index.ts
apps/public-search-bot/src/telegram.client.ts
apps/public-search-bot/src/db/schema.sql
apps/public-search-bot/.env.example
apps/public-search-bot/package.json
apps/public-search-bot/package-lock.json
apps/public-search-bot/README.md
README.md
```

Add tests beside existing standalone tests:

```text
apps/public-search-bot/tests/public-search.subscription-access.test.ts
apps/public-search-bot/tests/public-search.subscription-alert.test.ts
apps/public-search-bot/tests/public-search.subscription-bot-handlers.test.ts
apps/public-search-bot/tests/public-search.subscription-jobs.test.ts
apps/public-search-bot/tests/public-search.subscription-repository.test.ts
apps/public-search-bot/tests/public-search.subscription-routes.test.ts
apps/public-search-bot/tests/public-search.subscription-sheet-mapper.test.ts
apps/public-search-bot/tests/public-search.subscription-sync.test.ts
```

Add a Google Apps Script template:

```text
apps/public-search-bot/google-apps-script/Code.gs
```

---

### Task 1: Add Subscription Configuration And Dependencies

**Files:**
- Modify: `apps/public-search-bot/src/config.ts`
- Modify: `apps/public-search-bot/tests/public-search.config.test.ts`
- Modify: `apps/public-search-bot/.env.example`
- Modify: `apps/public-search-bot/package.json`
- Modify: `apps/public-search-bot/package-lock.json`

- [ ] **Step 1: Install Google Sheets dependency**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot install googleapis
```

Expected: `apps/public-search-bot/package.json` gains a `googleapis` dependency and `apps/public-search-bot/package-lock.json` is updated.

- [ ] **Step 2: Write failing config tests**

Append focused tests to `apps/public-search-bot/tests/public-search.config.test.ts`:

```ts
it('requires subscription bot and admin secrets', () => {
  expect(() =>
    loadPublicSearchConfig({
      PUBLIC_BOT_TOKEN: 'bot-token',
      PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
      PUBLIC_SEARCH_STATUS_TOKEN: 'status-token',
      SUBSCRIPTION_ADMIN_TOKEN: 'admin-token'
    })
  ).toThrow(/SUBSCRIPTION_BOT_TOKEN is required/);

  expect(() =>
    loadPublicSearchConfig({
      PUBLIC_BOT_TOKEN: 'bot-token',
      PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
      PUBLIC_SEARCH_STATUS_TOKEN: 'status-token',
      SUBSCRIPTION_BOT_TOKEN: 'subscription-token'
    })
  ).toThrow(/SUBSCRIPTION_ADMIN_TOKEN is required/);
});

it('returns subscription defaults and explicit sheet settings', () => {
  expect(
    loadPublicSearchConfig({
      PUBLIC_BOT_TOKEN: 'bot-token',
      PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
      PUBLIC_SEARCH_STATUS_TOKEN: 'status-token',
      SUBSCRIPTION_BOT_TOKEN: 'subscription-token',
      SUBSCRIPTION_ADMIN_TOKEN: 'admin-token',
      GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id',
      GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/secure/google.json'
    })
  ).toMatchObject({
    subscriptionBotToken: 'subscription-token',
    subscriptionGroupChatId: -1003963665033,
    subscriptionAlertThreadId: 46,
    subscriptionAdminContact: '@seinen_illuminatiks',
    subscriptionTrialHours: 24,
    subscriptionPeriodDays: 31,
    subscriptionOverdueGraceDays: 1,
    subscriptionAdminToken: 'admin-token',
    googleSheetsSpreadsheetId: 'sheet-id',
    googleSheetsUsersRange: 'Users!A:G',
    googleSheetsHistoryRange: 'History!A:G',
    googleServiceAccountKeyFile: '/secure/google.json'
  });
});
```

- [ ] **Step 3: Run config tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.config.test.ts
```

Expected: FAIL because the new subscription config fields do not exist.

- [ ] **Step 4: Implement config fields**

Update `apps/public-search-bot/src/config.ts` with these schema fields and return properties:

```ts
function integerWithDefault(defaultValue: number) {
  return z.preprocess(emptyStringToUndefined, z.coerce.number().int().default(defaultValue));
}

const PublicSearchEnvSchema = z.object({
  PUBLIC_BOT_TOKEN: requiredSecret('PUBLIC_BOT_TOKEN'),
  PUBLIC_SEARCH_SYNC_TOKEN: requiredSecret('PUBLIC_SEARCH_SYNC_TOKEN'),
  PUBLIC_SEARCH_STATUS_TOKEN: requiredSecret('PUBLIC_SEARCH_STATUS_TOKEN'),
  PUBLIC_SEARCH_GROUP_HANDLE: trimmedStringWithDefault('@infinitylinks69'),
  PUBLIC_SEARCH_DATABASE_PATH: trimmedStringWithDefault('./data/public-search.sqlite'),
  PUBLIC_SEARCH_HOST: trimmedStringWithDefault('127.0.0.1'),
  PUBLIC_SEARCH_PORT: numberWithDefault(3001),
  SUBSCRIPTION_BOT_TOKEN: requiredSecret('SUBSCRIPTION_BOT_TOKEN'),
  SUBSCRIPTION_GROUP_CHAT_ID: integerWithDefault(-1003963665033),
  SUBSCRIPTION_ALERT_THREAD_ID: numberWithDefault(46),
  SUBSCRIPTION_ADMIN_CONTACT: trimmedStringWithDefault('@seinen_illuminatiks'),
  SUBSCRIPTION_TRIAL_HOURS: numberWithDefault(24),
  SUBSCRIPTION_PERIOD_DAYS: numberWithDefault(31),
  SUBSCRIPTION_OVERDUE_GRACE_DAYS: numberWithDefault(1),
  SUBSCRIPTION_ADMIN_TOKEN: requiredSecret('SUBSCRIPTION_ADMIN_TOKEN'),
  GOOGLE_SHEETS_SPREADSHEET_ID: requiredSecret('GOOGLE_SHEETS_SPREADSHEET_ID'),
  GOOGLE_SHEETS_USERS_RANGE: trimmedStringWithDefault('Users!A:G'),
  GOOGLE_SHEETS_HISTORY_RANGE: trimmedStringWithDefault('History!A:G'),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: requiredSecret('GOOGLE_SERVICE_ACCOUNT_KEY_FILE')
}).refine((env) => env.PUBLIC_SEARCH_SYNC_TOKEN !== env.PUBLIC_SEARCH_STATUS_TOKEN, {
  message: 'PUBLIC_SEARCH_STATUS_TOKEN must be different from PUBLIC_SEARCH_SYNC_TOKEN',
  path: ['PUBLIC_SEARCH_STATUS_TOKEN']
}).refine((env) => env.SUBSCRIPTION_ADMIN_TOKEN !== env.PUBLIC_SEARCH_SYNC_TOKEN, {
  message: 'SUBSCRIPTION_ADMIN_TOKEN must be different from PUBLIC_SEARCH_SYNC_TOKEN',
  path: ['SUBSCRIPTION_ADMIN_TOKEN']
});
```

Extend `PublicSearchConfig`:

```ts
subscriptionBotToken: string;
subscriptionGroupChatId: number;
subscriptionAlertThreadId: number;
subscriptionAdminContact: string;
subscriptionTrialHours: number;
subscriptionPeriodDays: number;
subscriptionOverdueGraceDays: number;
subscriptionAdminToken: string;
googleSheetsSpreadsheetId: string;
googleSheetsUsersRange: string;
googleSheetsHistoryRange: string;
googleServiceAccountKeyFile: string;
```

Return those fields from `loadPublicSearchConfig`.

- [ ] **Step 5: Update environment example**

Append to `apps/public-search-bot/.env.example`:

```env
SUBSCRIPTION_BOT_TOKEN=replace_with_subscription_bot_token
SUBSCRIPTION_GROUP_CHAT_ID=-1003963665033
SUBSCRIPTION_ALERT_THREAD_ID=46
SUBSCRIPTION_ADMIN_CONTACT=@seinen_illuminatiks
SUBSCRIPTION_TRIAL_HOURS=24
SUBSCRIPTION_PERIOD_DAYS=31
SUBSCRIPTION_OVERDUE_GRACE_DAYS=1
SUBSCRIPTION_ADMIN_TOKEN=replace_with_subscription_admin_secret
GOOGLE_SHEETS_SPREADSHEET_ID=replace_with_google_sheet_id
GOOGLE_SHEETS_USERS_RANGE=Users!A:G
GOOGLE_SHEETS_HISTORY_RANGE=History!A:G
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/opt/infinitylinks-public-search-bot/google-service-account.json
```

- [ ] **Step 6: Run config tests to verify pass**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/public-search-bot/src/config.ts apps/public-search-bot/tests/public-search.config.test.ts apps/public-search-bot/.env.example apps/public-search-bot/package.json apps/public-search-bot/package-lock.json
git commit -m "feat: add subscription bot configuration"
```

---

### Task 2: Add Subscription Schema And Repository

**Files:**
- Modify: `apps/public-search-bot/src/db/schema.sql`
- Create: `apps/public-search-bot/src/subscriptions/date.ts`
- Create: `apps/public-search-bot/src/subscriptions/repository.ts`
- Create: `apps/public-search-bot/tests/public-search.subscription-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `apps/public-search-bot/tests/public-search.subscription-repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import {
  addDateDays,
  calculateDaysRemaining,
  todayDateString
} from '../src/subscriptions/date.js';
import {
  applySubscriptionStartDate,
  listActiveSubscriptionRows,
  listKickCandidates,
  listUsersNeedingAlert,
  markSubscriptionUserKicked,
  recalculateSubscriptions,
  startTrialIfEligible,
  upsertSeenTelegramUser
} from '../src/subscriptions/repository.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription repository', () => {
  it('uses date-only math for 31-day subscriptions', () => {
    expect(addDateDays('2026-05-26', 31)).toBe('2026-06-26');
    expect(calculateDaysRemaining('2026-06-26', '2026-05-26')).toBe(31);
    expect(calculateDaysRemaining('2026-06-26', '2026-06-25')).toBe(1);
    expect(calculateDaysRemaining('2026-06-26', '2026-06-26')).toBe(0);
    expect(todayDateString(new Date('2026-05-26T16:00:00.000Z'))).toBe('2026-05-26');
  });

  it('starts one trial once and keeps username keyed by user id', () => {
    const db = createDb();
    try {
      const first = startTrialIfEligible(db, { id: 42, username: 'first_name' }, new Date('2026-05-26T00:00:00.000Z'), 24);
      const second = startTrialIfEligible(db, { id: 42, username: 'new_name' }, new Date('2026-05-26T01:00:00.000Z'), 24);

      expect(first.started).toBe(true);
      expect(second.started).toBe(false);
      expect(second.user).toMatchObject({
        telegramUserId: 42,
        username: 'new_name',
        status: 'Trial',
        trialStartedAt: '2026-05-26T00:00:00.000Z',
        trialExpiresAt: '2026-05-27T00:00:00.000Z'
      });
    } finally {
      db.close();
    }
  });

  it('applies a manual paid start date and recalculates alert statuses', () => {
    const db = createDb();
    try {
      upsertSeenTelegramUser(db, { id: 42, username: 'paid_user' }, new Date('2026-05-26T00:00:00.000Z'));

      const paid = applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), 31);
      expect(paid).toMatchObject({
        subscriptionStartDate: '2026-05-26',
        subscriptionEndDate: '2026-06-26',
        daysRemaining: 31,
        status: 'Subscribe'
      });

      recalculateSubscriptions(db, '2026-06-25', 31);
      expect(listUsersNeedingAlert(db).map((user) => user.telegramUserId)).toEqual([42]);
      expect(listActiveSubscriptionRows(db)[0]).toMatchObject({
        username: 'paid_user',
        daysRemaining: 1,
        status: 'Needs Attention'
      });

      recalculateSubscriptions(db, '2026-06-26', 31);
      expect(listUsersNeedingAlert(db)[0]).toMatchObject({
        telegramUserId: 42,
        status: 'Unpaid',
        unpaidSince: '2026-06-26'
      });
      expect(listKickCandidates(db, '2026-06-27', 1).map((user) => user.telegramUserId)).toEqual([42]);
    } finally {
      db.close();
    }
  });

  it('marks kicked users without deleting permanent history', () => {
    const db = createDb();
    try {
      upsertSeenTelegramUser(db, { id: 42, username: 'late_user' }, new Date('2026-05-26T00:00:00.000Z'));
      applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), 31);
      recalculateSubscriptions(db, '2026-06-26', 31);

      const kicked = markSubscriptionUserKicked(db, 42, new Date('2026-06-27T00:00:00.000Z'));

      expect(kicked).toMatchObject({
        telegramUserId: 42,
        status: 'Kicked',
        removedFromGroup: true,
        kickedAt: '2026-06-27T00:00:00.000Z'
      });
      expect(startTrialIfEligible(db, { id: 42, username: 'late_user' }, new Date('2026-06-28T00:00:00.000Z'), 24).started).toBe(false);
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Run repository tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-repository.test.ts
```

Expected: FAIL because subscription files and tables do not exist.

- [ ] **Step 3: Add database tables**

Append to `apps/public-search-bot/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS subscription_users (
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
  removed_from_group INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_alert_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  message_id INTEGER,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscription_users_status ON subscription_users(status);
CREATE INDEX IF NOT EXISTS idx_subscription_users_unpaid_since ON subscription_users(unpaid_since);
```

- [ ] **Step 4: Implement date utilities**

Create `apps/public-search-bot/src/subscriptions/date.ts`:

```ts
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(value: string) {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error(`Invalid date-only value: ${value}`);
  }

  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function todayDateString(now: Date = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function addDateDays(dateOnly: string, days: number) {
  const date = new Date(parseDateOnly(dateOnly) + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

export function calculateDaysRemaining(endDate: string, today: string) {
  return Math.max(0, Math.floor((parseDateOnly(endDate) - parseDateOnly(today)) / DAY_MS));
}

export function dateDifferenceDays(fromDate: string, toDate: string) {
  return Math.floor((parseDateOnly(toDate) - parseDateOnly(fromDate)) / DAY_MS);
}
```

- [ ] **Step 5: Implement repository**

Create `apps/public-search-bot/src/subscriptions/repository.ts` with these exported types and functions:

```ts
import type { PublicSearchDatabase } from '../db/database.js';
import { addDateDays, calculateDaysRemaining, dateDifferenceDays, todayDateString } from './date.js';

export type SubscriptionStatus = 'Trial' | 'Subscribe' | 'Needs Attention' | 'Unpaid' | 'Kicked';

export type TelegramUserIdentity = {
  id: number;
  username?: string | undefined;
};

export type SubscriptionUser = {
  telegramUserId: number;
  username?: string | undefined;
  trialStartedAt?: string | undefined;
  trialExpiresAt?: string | undefined;
  subscriptionStartDate?: string | undefined;
  subscriptionEndDate?: string | undefined;
  daysRemaining?: number | undefined;
  status: SubscriptionStatus;
  unpaidSince?: string | undefined;
  kickedAt?: string | undefined;
  removedFromGroup: boolean;
  lastSeenAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

type SubscriptionUserRow = {
  telegram_user_id: number;
  username: string | null;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  subscription_start_date: string | null;
  subscription_end_date: string | null;
  days_remaining: number | null;
  status: SubscriptionStatus;
  unpaid_since: string | null;
  kicked_at: string | null;
  removed_from_group: number;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

function toUser(row: SubscriptionUserRow): SubscriptionUser {
  return {
    telegramUserId: row.telegram_user_id,
    username: row.username ?? undefined,
    trialStartedAt: row.trial_started_at ?? undefined,
    trialExpiresAt: row.trial_expires_at ?? undefined,
    subscriptionStartDate: row.subscription_start_date ?? undefined,
    subscriptionEndDate: row.subscription_end_date ?? undefined,
    daysRemaining: row.days_remaining ?? undefined,
    status: row.status,
    unpaidSince: row.unpaid_since ?? undefined,
    kickedAt: row.kicked_at ?? undefined,
    removedFromGroup: row.removed_from_group === 1,
    lastSeenAt: row.last_seen_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getSubscriptionUser(db: PublicSearchDatabase, telegramUserId: number) {
  const row = db.prepare('SELECT * FROM subscription_users WHERE telegram_user_id = ?').get(telegramUserId) as SubscriptionUserRow | undefined;
  return row ? toUser(row) : undefined;
}

export function upsertSeenTelegramUser(db: PublicSearchDatabase, identity: TelegramUserIdentity, now: Date) {
  const nowIso = now.toISOString();
  const current = getSubscriptionUser(db, identity.id);
  const username = identity.username ?? current?.username;

  db.prepare(
    `INSERT INTO subscription_users (telegram_user_id, username, status, removed_from_group, last_seen_at, created_at, updated_at)
     VALUES (@telegramUserId, @username, 'Unpaid', 0, @nowIso, @nowIso, @nowIso)
     ON CONFLICT(telegram_user_id) DO UPDATE SET
       username = COALESCE(excluded.username, subscription_users.username),
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`
  ).run({ telegramUserId: identity.id, username, nowIso });

  return getSubscriptionUser(db, identity.id);
}

export function startTrialIfEligible(db: PublicSearchDatabase, identity: TelegramUserIdentity, now: Date, trialHours: number) {
  upsertSeenTelegramUser(db, identity, now);
  const current = getSubscriptionUser(db, identity.id);
  if (!current || current.trialStartedAt || current.status === 'Kicked' || current.subscriptionStartDate) {
    return { started: false, user: current };
  }

  const trialStartedAt = now.toISOString();
  const trialExpiresAt = new Date(now.getTime() + trialHours * 60 * 60 * 1000).toISOString();
  db.prepare(
    `UPDATE subscription_users
     SET trial_started_at = ?, trial_expires_at = ?, status = 'Trial', updated_at = ?
     WHERE telegram_user_id = ?`
  ).run(trialStartedAt, trialExpiresAt, trialStartedAt, identity.id);

  return { started: true, user: getSubscriptionUser(db, identity.id) };
}

function statusForDays(daysRemaining: number): Exclude<SubscriptionStatus, 'Trial' | 'Kicked'> {
  if (daysRemaining >= 2) {
    return 'Subscribe';
  }
  if (daysRemaining === 1) {
    return 'Needs Attention';
  }
  return 'Unpaid';
}

export function applySubscriptionStartDate(db: PublicSearchDatabase, telegramUserId: number, startDate: string, now: Date, periodDays: number) {
  const nowIso = now.toISOString();
  const today = todayDateString(now);
  const endDate = addDateDays(startDate, periodDays);
  const daysRemaining = calculateDaysRemaining(endDate, today);
  const status = statusForDays(daysRemaining);
  const unpaidSince = status === 'Unpaid' ? today : undefined;

  db.prepare(
    `UPDATE subscription_users
     SET subscription_start_date = @startDate,
         subscription_end_date = @endDate,
         days_remaining = @daysRemaining,
         status = @status,
         unpaid_since = @unpaidSince,
         kicked_at = NULL,
         removed_from_group = 0,
         updated_at = @nowIso
     WHERE telegram_user_id = @telegramUserId`
  ).run({ telegramUserId, startDate, endDate, daysRemaining, status, unpaidSince, nowIso });

  return getSubscriptionUser(db, telegramUserId);
}

export function recalculateSubscriptions(db: PublicSearchDatabase, today: string, periodDays: number) {
  const rows = db.prepare(
    `SELECT * FROM subscription_users
     WHERE subscription_start_date IS NOT NULL
       AND status != 'Kicked'`
  ).all() as SubscriptionUserRow[];
  const nowIso = `${today}T00:00:00.000Z`;

  for (const row of rows) {
    const startDate = row.subscription_start_date;
    if (!startDate) {
      continue;
    }
    const endDate = addDateDays(startDate, periodDays);
    const daysRemaining = calculateDaysRemaining(endDate, today);
    const status = statusForDays(daysRemaining);
    const unpaidSince = status === 'Unpaid' ? row.unpaid_since ?? today : null;

    db.prepare(
      `UPDATE subscription_users
       SET subscription_end_date = ?, days_remaining = ?, status = ?, unpaid_since = ?, updated_at = ?
       WHERE telegram_user_id = ?`
    ).run(endDate, daysRemaining, status, unpaidSince, nowIso, row.telegram_user_id);
  }
}

export function listUsersNeedingAlert(db: PublicSearchDatabase) {
  return (db.prepare(
    `SELECT * FROM subscription_users
     WHERE status IN ('Needs Attention', 'Unpaid')
       AND removed_from_group = 0
     ORDER BY status ASC, username ASC, telegram_user_id ASC`
  ).all() as SubscriptionUserRow[]).map(toUser);
}

export function listKickCandidates(db: PublicSearchDatabase, today: string, graceDays: number) {
  return (db.prepare(
    `SELECT * FROM subscription_users
     WHERE status = 'Unpaid'
       AND removed_from_group = 0
       AND unpaid_since IS NOT NULL`
  ).all() as SubscriptionUserRow[])
    .map(toUser)
    .filter((user) => user.unpaidSince && dateDifferenceDays(user.unpaidSince, today) >= graceDays);
}

export function markSubscriptionUserKicked(db: PublicSearchDatabase, telegramUserId: number, now: Date) {
  const nowIso = now.toISOString();
  db.prepare(
    `UPDATE subscription_users
     SET status = 'Kicked', kicked_at = ?, removed_from_group = 1, updated_at = ?
     WHERE telegram_user_id = ?`
  ).run(nowIso, nowIso, telegramUserId);
  return getSubscriptionUser(db, telegramUserId);
}

export function listActiveSubscriptionRows(db: PublicSearchDatabase) {
  return (db.prepare(
    `SELECT * FROM subscription_users
     WHERE status != 'Kicked'
     ORDER BY username ASC, telegram_user_id ASC`
  ).all() as SubscriptionUserRow[]).map(toUser);
}
```

- [ ] **Step 6: Run repository tests to verify pass**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/public-search-bot/src/db/schema.sql apps/public-search-bot/src/subscriptions/date.ts apps/public-search-bot/src/subscriptions/repository.ts apps/public-search-bot/tests/public-search.subscription-repository.test.ts
git commit -m "feat: add subscription persistence"
```

---

### Task 3: Gate Public Search Through Subscription Access

**Files:**
- Create: `apps/public-search-bot/src/subscriptions/access.service.ts`
- Modify: `apps/public-search-bot/src/bot/formatter.ts`
- Modify: `apps/public-search-bot/src/bot/handlers.ts`
- Modify: `apps/public-search-bot/tests/public-search.formatter.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.handlers.test.ts`
- Create: `apps/public-search-bot/tests/public-search.subscription-access.test.ts`

- [ ] **Step 1: Write failing access service tests**

Create `apps/public-search-bot/tests/public-search.subscription-access.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import { applySubscriptionStartDate } from '../src/subscriptions/repository.js';
import { evaluateSearchAccess } from '../src/subscriptions/access.service.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription access service', () => {
  it('starts a one-day trial on first search but not on /start', () => {
    const db = createDb();
    try {
      const result = evaluateSearchAccess(db, {
        user: { id: 42, username: 'trial_user' },
        now: new Date('2026-05-26T00:00:00.000Z'),
        trialHours: 24
      });

      expect(result).toMatchObject({ allowed: true, status: 'Trial', trialStarted: true });
    } finally {
      db.close();
    }
  });

  it('blocks expired trial users without resetting the trial', () => {
    const db = createDb();
    try {
      evaluateSearchAccess(db, {
        user: { id: 42, username: 'trial_user' },
        now: new Date('2026-05-26T00:00:00.000Z'),
        trialHours: 24
      });

      const expired = evaluateSearchAccess(db, {
        user: { id: 42, username: 'trial_user' },
        now: new Date('2026-05-27T00:00:01.000Z'),
        trialHours: 24
      });

      expect(expired).toMatchObject({ allowed: false, reason: 'subscription-required', status: 'Trial' });
    } finally {
      db.close();
    }
  });

  it('allows active paid users and blocks kicked users', () => {
    const db = createDb();
    try {
      evaluateSearchAccess(db, {
        user: { id: 42, username: 'paid_user' },
        now: new Date('2026-05-26T00:00:00.000Z'),
        trialHours: 24
      });
      applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), 31);

      expect(evaluateSearchAccess(db, {
        user: { id: 42, username: 'paid_user' },
        now: new Date('2026-06-25T00:00:00.000Z'),
        trialHours: 24
      })).toMatchObject({ allowed: true, status: 'Subscribe' });

      db.prepare("UPDATE subscription_users SET status = 'Kicked', removed_from_group = 1 WHERE telegram_user_id = 42").run();

      expect(evaluateSearchAccess(db, {
        user: { id: 42, username: 'paid_user' },
        now: new Date('2026-06-25T01:00:00.000Z'),
        trialHours: 24
      })).toMatchObject({ allowed: false, reason: 'subscription-required', status: 'Kicked' });
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Write failing handler/formatter expectations**

In `apps/public-search-bot/tests/public-search.formatter.test.ts`, update command-message expectations so `formatStartMessage(handles).text` includes:

```text
You have 1 day free trial access when you search.
After the trial, subscription is required to view download links.
```

Also import and assert:

```ts
expect(formatSubscriptionRequiredMessage('@seinen_illuminatiks').text).toBe(
  'You need a subscription to view and access download links. Contact @seinen_illuminatiks to keep you going.'
);
```

In `apps/public-search-bot/tests/public-search.handlers.test.ts`, replace membership-gate tests with:

```ts
it('blocks expired trial searches without leaking provider links', async () => {
  const db = createMigratedDatabase();
  try {
    seedCatalog(db);
    const { deps, sentMessages } = createDeps(db, {
      subscription: {
        now: () => new Date('2026-05-27T00:00:01.000Z'),
        trialHours: 24,
        adminContact: '@seinen_illuminatiks'
      }
    });

    db.prepare(
      `INSERT INTO subscription_users (telegram_user_id, username, trial_started_at, trial_expires_at, status, removed_from_group, created_at, updated_at)
       VALUES (42, 'expired_user', '2026-05-26T00:00:00.000Z', '2026-05-27T00:00:00.000Z', 'Trial', 0, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z')`
    ).run();

    await handleTelegramUpdate(deps, messageUpdate('/search inception'));

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toBe('You need a subscription to view and access download links. Contact @seinen_illuminatiks to keep you going.');
    expect(sentMessages[0].text).not.toContain('https://providers.example/inception-hd');
  } finally {
    db.close();
  }
});
```

- [ ] **Step 3: Run focused tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-access.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.handlers.test.ts
```

Expected: FAIL because the access service and formatter function do not exist, and handlers still check membership.

- [ ] **Step 4: Implement access service**

Create `apps/public-search-bot/src/subscriptions/access.service.ts`:

```ts
import type { PublicSearchDatabase } from '../db/database.js';
import type { TelegramUserIdentity, SubscriptionStatus } from './repository.js';
import { getSubscriptionUser, startTrialIfEligible, upsertSeenTelegramUser } from './repository.js';

export type SearchAccessResult =
  | { allowed: true; status: SubscriptionStatus; trialStarted: boolean }
  | { allowed: false; reason: 'subscription-required'; status?: SubscriptionStatus | undefined; trialStarted: false };

export function evaluateSearchAccess(
  db: PublicSearchDatabase,
  input: {
    user: TelegramUserIdentity | undefined;
    now: Date;
    trialHours: number;
  }
): SearchAccessResult {
  if (!input.user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  upsertSeenTelegramUser(db, input.user, input.now);
  const trial = startTrialIfEligible(db, input.user, input.now, input.trialHours);
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

  if (user.status === 'Trial' && user.trialExpiresAt && input.now.getTime() <= Date.parse(user.trialExpiresAt)) {
    return { allowed: true, status: 'Trial', trialStarted: trial.started };
  }

  return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
}
```

- [ ] **Step 5: Implement formatter updates**

In `apps/public-search-bot/src/bot/formatter.ts`, update `formatStartMessage` to include:

```ts
'🎁 You have 1 day free trial access when you search.',
'After the trial, subscription is required to view download links.',
'',
```

Add:

```ts
export function formatSubscriptionRequiredMessage(adminContact: string): PublicBotMessage {
  return {
    text: `You need a subscription to view and access download links. Contact ${adminContact} to keep you going.`
  };
}
```

- [ ] **Step 6: Replace membership checks in handlers**

In `apps/public-search-bot/src/bot/handlers.ts`:

Add imports:

```ts
import { evaluateSearchAccess } from '../subscriptions/access.service.js';
import { formatSubscriptionRequiredMessage } from './formatter.js';
```

Change `HandlerDeps`:

```ts
export type HandlerDeps = {
  db: AppDatabase;
  replies: ReplyQueue;
  rateLimiter: {
    check(key: string): RateLimitResult;
  };
  groupHandle: string;
  subscription: {
    now: () => Date;
    trialHours: number;
    adminContact: string;
  };
  replyThrottleState?: ReplyThrottleState;
};
```

Add helper:

```ts
function getTelegramUser(from: { id: number; username?: string } | undefined) {
  return from ? { id: from.id, username: from.username } : undefined;
}
```

At the top of `handleSearch`, replace membership logic with:

```ts
const access = evaluateSearchAccess(deps.db, {
  user,
  now: deps.subscription.now(),
  trialHours: deps.subscription.trialHours
});

if (!access.allowed) {
  await sendBotMessage(deps, chatId, formatSubscriptionRequiredMessage(deps.subscription.adminContact));
  return;
}
```

Then change `handleSearch` signature to receive the full Telegram user:

```ts
async function handleSearch(
  deps: HandlerDeps,
  chatId: number,
  user: { id: number; username?: string } | undefined,
  query: string
) {
```

And call it from `/search` with:

```ts
await handleSearch(deps, message.chat.id, getTelegramUser(message.from), query);
```

In `handleCallbackQuery`, run the same access check using `callbackQuery.from` before loading season details. If blocked, answer the callback with `Subscription required.` and send `formatSubscriptionRequiredMessage`.

Remove `checkMembership`, `JOINED_STATUSES`, and `telegram.getChatMember` usage from handlers.

- [ ] **Step 7: Run focused tests to verify pass**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-access.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.handlers.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/public-search-bot/src/subscriptions/access.service.ts apps/public-search-bot/src/bot/formatter.ts apps/public-search-bot/src/bot/handlers.ts apps/public-search-bot/tests/public-search.subscription-access.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.handlers.test.ts
git commit -m "feat: gate public search by subscription access"
```

---

### Task 4: Extend Telegram Client For Subscription Bot Actions

**Files:**
- Modify: `apps/public-search-bot/src/telegram.client.ts`
- Modify: `apps/public-search-bot/tests/public-search.telegram-client.test.ts`

- [ ] **Step 1: Write failing Telegram client tests**

Add tests to `apps/public-search-bot/tests/public-search.telegram-client.test.ts`:

```ts
it('sendMessage supports message threads and returns the message id', async () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true, result: { message_id: 777 } }));
  const client = createPublicTelegramClient({ botToken: 'bot-token' }, fetchMock);

  await expect(client.sendMessage({
    chatId: -1003963665033,
    messageThreadId: 46,
    text: 'Alert'
  })).resolves.toEqual({ messageId: 777 });

  expect(getJsonBody(fetchMock)).toEqual({
    chat_id: -1003963665033,
    message_thread_id: 46,
    text: 'Alert'
  });
});

it('edits and deletes messages', async () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true, result: true }));
  const client = createPublicTelegramClient({ botToken: 'bot-token' }, fetchMock);

  await client.editMessageText({ chatId: -1003963665033, messageId: 777, text: 'Updated' });
  await client.deleteMessage({ chatId: -1003963665033, messageId: 777 });

  expect(getJsonBody(fetchMock, 0)).toEqual({ chat_id: -1003963665033, message_id: 777, text: 'Updated' });
  expect(getJsonBody(fetchMock, 1)).toEqual({ chat_id: -1003963665033, message_id: 777 });
});

it('removes a chat member with ban then unban so admin can add them again later', async () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true, result: true }));
  const client = createPublicTelegramClient({ botToken: 'bot-token' }, fetchMock);

  await client.removeChatMember({ chatId: -1003963665033, userId: 42 });

  expect(getJsonBody(fetchMock, 0)).toEqual({ chat_id: -1003963665033, user_id: 42 });
  expect(getJsonBody(fetchMock, 1)).toEqual({ chat_id: -1003963665033, user_id: 42, only_if_banned: true });
});

it('getUpdates can request allowed update types', async () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true, result: [] }));
  const client = createPublicTelegramClient({ botToken: 'bot-token' }, fetchMock);

  await client.getUpdates({ offset: 101, timeout: 30, allowedUpdates: ['message', 'chat_member'] });

  expect(getJsonBody(fetchMock)).toEqual({
    offset: 101,
    timeout: 30,
    allowed_updates: ['message', 'chat_member']
  });
});
```

- [ ] **Step 2: Run Telegram client tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.telegram-client.test.ts
```

Expected: FAIL because the new methods/fields are not implemented.

- [ ] **Step 3: Implement Telegram client extensions**

In `apps/public-search-bot/src/telegram.client.ts`:

Extend `TelegramUpdate`:

```ts
export type TelegramChatMemberUpdated = {
  chat: { id: number; type?: string; username?: string };
  from: { id: number; username?: string; first_name?: string };
  date: number;
  old_chat_member: TelegramChatMember;
  new_chat_member: TelegramChatMember;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  chat_member?: TelegramChatMemberUpdated;
  my_chat_member?: TelegramChatMemberUpdated;
};
```

Change `getUpdates` input:

```ts
async getUpdates(input: {
  offset?: number | undefined;
  timeout?: number | undefined;
  allowedUpdates?: string[] | undefined;
}): Promise<TelegramUpdate[]> {
  const result = await post<TelegramUpdate[]>('getUpdates', {
    offset: input.offset,
    timeout: input.timeout,
    allowed_updates: input.allowedUpdates
  });

  return result ?? [];
}
```

Change `sendMessage`:

```ts
async sendMessage(input: {
  chatId: number;
  messageThreadId?: number | undefined;
  text: string;
  replyMarkup?: InlineKeyboardMarkup | undefined;
}): Promise<{ messageId: number | undefined }> {
  const result = await post<{ message_id?: number }>('sendMessage', {
    chat_id: input.chatId,
    message_thread_id: input.messageThreadId,
    text: input.text,
    reply_markup: input.replyMarkup
  });

  return { messageId: result?.message_id };
}
```

Add:

```ts
async editMessageText(input: { chatId: number; messageId: number; text: string }): Promise<void> {
  await post('editMessageText', {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text
  });
},

async deleteMessage(input: { chatId: number; messageId: number }): Promise<void> {
  await post('deleteMessage', {
    chat_id: input.chatId,
    message_id: input.messageId
  });
},

async removeChatMember(input: { chatId: number; userId: number }): Promise<void> {
  await post('banChatMember', {
    chat_id: input.chatId,
    user_id: input.userId
  });
  await post('unbanChatMember', {
    chat_id: input.chatId,
    user_id: input.userId,
    only_if_banned: true
  });
}
```

- [ ] **Step 4: Run Telegram client tests to verify pass**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.telegram-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/public-search-bot/src/telegram.client.ts apps/public-search-bot/tests/public-search.telegram-client.test.ts
git commit -m "feat: extend telegram client for subscriptions"
```

---

### Task 5: Add Persistent Subscription Job Queue

**Files:**
- Modify: `apps/public-search-bot/src/db/schema.sql`
- Create: `apps/public-search-bot/src/subscriptions/job.repository.ts`
- Create: `apps/public-search-bot/src/subscriptions/job.processor.ts`
- Create: `apps/public-search-bot/tests/public-search.subscription-jobs.test.ts`

- [ ] **Step 1: Write failing job queue tests**

Create `apps/public-search-bot/tests/public-search.subscription-jobs.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { TelegramRateLimitError } from '../src/telegram.client.js';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import {
  enqueueSubscriptionJob,
  listSubscriptionJobs,
  claimNextSubscriptionJob,
  markSubscriptionJobSucceeded,
  markSubscriptionJobFailed
} from '../src/subscriptions/job.repository.js';
import { processNextSubscriptionJob } from '../src/subscriptions/job.processor.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription jobs', () => {
  it('claims due jobs and records success', () => {
    const db = createDb();
    try {
      const job = enqueueSubscriptionJob(db, 'refresh-alert', {}, new Date('2026-05-26T00:00:00.000Z'));
      expect(claimNextSubscriptionJob(db, new Date('2026-05-26T00:00:01.000Z'))).toMatchObject({
        id: job.id,
        type: 'refresh-alert',
        status: 'running'
      });

      markSubscriptionJobSucceeded(db, job.id, new Date('2026-05-26T00:00:02.000Z'));
      expect(listSubscriptionJobs(db)).toEqual([
        expect.objectContaining({ id: job.id, status: 'succeeded' })
      ]);
    } finally {
      db.close();
    }
  });

  it('backs off rate limited jobs using retry_after', async () => {
    const db = createDb();
    try {
      enqueueSubscriptionJob(db, 'kick-user', { telegramUserId: 42 }, new Date('2026-05-26T00:00:00.000Z'));
      const handlers = {
        kickUser: vi.fn(async () => {
          throw new TelegramRateLimitError('Too Many Requests', 12);
        }),
        refreshAlert: vi.fn(),
        refreshSheet: vi.fn()
      };

      await expect(processNextSubscriptionJob(db, handlers, new Date('2026-05-26T00:00:01.000Z'))).resolves.toBe(true);

      expect(listSubscriptionJobs(db)[0]).toMatchObject({
        status: 'pending',
        attempts: 1,
        runAfter: '2026-05-26T00:00:13.000Z',
        lastError: 'Too Many Requests'
      });
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Run job tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-jobs.test.ts
```

Expected: FAIL because job queue files and table do not exist.

- [ ] **Step 3: Add job table**

Append to `apps/public-search-bot/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS subscription_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('refresh-alert', 'kick-user', 'refresh-sheet')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_jobs_status_run_after ON subscription_jobs(status, run_after);
```

- [ ] **Step 4: Implement job repository**

Create `apps/public-search-bot/src/subscriptions/job.repository.ts`:

```ts
import type { PublicSearchDatabase } from '../db/database.js';

export type SubscriptionJobType = 'refresh-alert' | 'kick-user' | 'refresh-sheet';
export type SubscriptionJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type SubscriptionJob = {
  id: number;
  type: SubscriptionJobType;
  payload: Record<string, unknown>;
  status: SubscriptionJobStatus;
  attempts: number;
  runAfter: string;
  lastError?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

type SubscriptionJobRow = {
  id: number;
  type: SubscriptionJobType;
  payload_json: string;
  status: SubscriptionJobStatus;
  attempts: number;
  run_after: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function toJob(row: SubscriptionJobRow): SubscriptionJob {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status,
    attempts: row.attempts,
    runAfter: row.run_after,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function enqueueSubscriptionJob(
  db: PublicSearchDatabase,
  type: SubscriptionJobType,
  payload: Record<string, unknown>,
  runAfter: Date
) {
  const nowIso = runAfter.toISOString();
  const result = db.prepare(
    `INSERT INTO subscription_jobs (type, payload_json, status, attempts, run_after, created_at, updated_at)
     VALUES (?, ?, 'pending', 0, ?, ?, ?)`
  ).run(type, JSON.stringify(payload), nowIso, nowIso, nowIso);

  return getSubscriptionJob(db, Number(result.lastInsertRowid));
}

export function getSubscriptionJob(db: PublicSearchDatabase, id: number) {
  const row = db.prepare('SELECT * FROM subscription_jobs WHERE id = ?').get(id) as SubscriptionJobRow | undefined;
  return row ? toJob(row) : undefined;
}

export function listSubscriptionJobs(db: PublicSearchDatabase) {
  return (db.prepare('SELECT * FROM subscription_jobs ORDER BY id ASC').all() as SubscriptionJobRow[]).map(toJob);
}

export function claimNextSubscriptionJob(db: PublicSearchDatabase, now: Date) {
  const nowIso = now.toISOString();
  const row = db.prepare(
    `SELECT * FROM subscription_jobs
     WHERE status = 'pending' AND run_after <= ?
     ORDER BY run_after ASC, id ASC
     LIMIT 1`
  ).get(nowIso) as SubscriptionJobRow | undefined;

  if (!row) {
    return undefined;
  }

  db.prepare(
    `UPDATE subscription_jobs
     SET status = 'running', updated_at = ?
     WHERE id = ? AND status = 'pending'`
  ).run(nowIso, row.id);

  return getSubscriptionJob(db, row.id);
}

export function markSubscriptionJobSucceeded(db: PublicSearchDatabase, id: number, now: Date) {
  db.prepare(
    `UPDATE subscription_jobs SET status = 'succeeded', updated_at = ? WHERE id = ?`
  ).run(now.toISOString(), id);
}

export function markSubscriptionJobFailed(db: PublicSearchDatabase, id: number, error: unknown, runAfter: Date, now: Date) {
  const message = error instanceof Error ? error.message : 'Unknown subscription job failure';
  db.prepare(
    `UPDATE subscription_jobs
     SET status = 'pending',
         attempts = attempts + 1,
         run_after = ?,
         last_error = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(runAfter.toISOString(), message, now.toISOString(), id);
}
```

- [ ] **Step 5: Implement job processor**

Create `apps/public-search-bot/src/subscriptions/job.processor.ts`:

```ts
import type { PublicSearchDatabase } from '../db/database.js';
import { TelegramRateLimitError } from '../telegram.client.js';
import {
  claimNextSubscriptionJob,
  markSubscriptionJobFailed,
  markSubscriptionJobSucceeded,
  type SubscriptionJob
} from './job.repository.js';

export type SubscriptionJobHandlers = {
  refreshAlert: () => Promise<void>;
  refreshSheet: () => Promise<void>;
  kickUser: (telegramUserId: number) => Promise<void>;
};

function retryAfterFor(error: unknown, attempts: number, now: Date) {
  if (error instanceof TelegramRateLimitError) {
    return new Date(now.getTime() + error.retryAfter * 1000);
  }

  const backoffSeconds = Math.min(300, Math.max(5, 5 * 2 ** attempts));
  return new Date(now.getTime() + backoffSeconds * 1000);
}

async function executeJob(job: SubscriptionJob, handlers: SubscriptionJobHandlers) {
  if (job.type === 'refresh-alert') {
    await handlers.refreshAlert();
    return;
  }

  if (job.type === 'refresh-sheet') {
    await handlers.refreshSheet();
    return;
  }

  const telegramUserId = job.payload.telegramUserId;
  if (typeof telegramUserId !== 'number') {
    throw new Error('kick-user job is missing numeric telegramUserId');
  }
  await handlers.kickUser(telegramUserId);
}

export async function processNextSubscriptionJob(
  db: PublicSearchDatabase,
  handlers: SubscriptionJobHandlers,
  now: Date = new Date()
) {
  const job = claimNextSubscriptionJob(db, now);
  if (!job) {
    return false;
  }

  try {
    await executeJob(job, handlers);
    markSubscriptionJobSucceeded(db, job.id, now);
  } catch (error) {
    markSubscriptionJobFailed(db, job.id, error, retryAfterFor(error, job.attempts, now), now);
  }

  return true;
}
```

- [ ] **Step 6: Run job tests to verify pass**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-jobs.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/public-search-bot/src/db/schema.sql apps/public-search-bot/src/subscriptions/job.repository.ts apps/public-search-bot/src/subscriptions/job.processor.ts apps/public-search-bot/tests/public-search.subscription-jobs.test.ts
git commit -m "feat: add subscription job queue"
```

---

### Task 6: Add Subscription Alert Service

**Files:**
- Create: `apps/public-search-bot/src/subscriptions/alert.service.ts`
- Create: `apps/public-search-bot/tests/public-search.subscription-alert.test.ts`

- [ ] **Step 1: Write failing alert tests**

Create `apps/public-search-bot/tests/public-search.subscription-alert.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import { upsertSeenTelegramUser } from '../src/subscriptions/repository.js';
import { refreshSubscriptionAlert } from '../src/subscriptions/alert.service.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription alert service', () => {
  it('posts one alert for attention and unpaid users', async () => {
    const db = createDb();
    try {
      upsertSeenTelegramUser(db, { id: 42, username: 'need_pay' }, new Date('2026-05-26T00:00:00.000Z'));
      upsertSeenTelegramUser(db, { id: 43, username: 'unpaid_user' }, new Date('2026-05-26T00:00:00.000Z'));
      db.prepare("UPDATE subscription_users SET status = 'Needs Attention' WHERE telegram_user_id = 42").run();
      db.prepare("UPDATE subscription_users SET status = 'Unpaid' WHERE telegram_user_id = 43").run();

      const telegram = {
        sendMessage: vi.fn(async () => ({ messageId: 777 })),
        editMessageText: vi.fn(),
        deleteMessage: vi.fn()
      };

      await refreshSubscriptionAlert(db, telegram, {
        chatId: -1003963665033,
        messageThreadId: 46
      });

      expect(telegram.sendMessage).toHaveBeenCalledWith({
        chatId: -1003963665033,
        messageThreadId: 46,
        text: ['🚨 Subscription Alert', '', 'Your subscription is unpaid or almost expired. Please renew to keep access.', '', '@need_pay', '@unpaid_user'].join('\n')
      });
      expect(db.prepare('SELECT message_id FROM subscription_alert_state WHERE id = 1').get()).toEqual({ message_id: 777 });
    } finally {
      db.close();
    }
  });

  it('deletes the alert when no users need attention', async () => {
    const db = createDb();
    try {
      db.prepare("INSERT INTO subscription_alert_state (id, message_id, updated_at) VALUES (1, 777, '2026-05-26T00:00:00.000Z')").run();
      const telegram = {
        sendMessage: vi.fn(),
        editMessageText: vi.fn(),
        deleteMessage: vi.fn(async () => undefined)
      };

      await refreshSubscriptionAlert(db, telegram, { chatId: -1003963665033, messageThreadId: 46 });

      expect(telegram.deleteMessage).toHaveBeenCalledWith({ chatId: -1003963665033, messageId: 777 });
      expect(db.prepare('SELECT message_id FROM subscription_alert_state WHERE id = 1').get()).toEqual({ message_id: null });
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Run alert tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-alert.test.ts
```

Expected: FAIL because alert service does not exist.

- [ ] **Step 3: Implement alert service**

Create `apps/public-search-bot/src/subscriptions/alert.service.ts`:

```ts
import type { PublicSearchDatabase } from '../db/database.js';
import type { PublicTelegramClient } from '../telegram.client.js';
import { listUsersNeedingAlert, type SubscriptionUser } from './repository.js';

type AlertTelegramClient = Pick<PublicTelegramClient, 'sendMessage' | 'editMessageText' | 'deleteMessage'>;

function usernameLine(user: SubscriptionUser) {
  return user.username ? `@${user.username}` : `User ID: ${user.telegramUserId}`;
}

export function formatSubscriptionAlert(users: SubscriptionUser[]) {
  return [
    '🚨 Subscription Alert',
    '',
    'Your subscription is unpaid or almost expired. Please renew to keep access.',
    '',
    ...users.map(usernameLine)
  ].join('\n');
}

function getStoredAlertMessageId(db: PublicSearchDatabase) {
  const row = db.prepare('SELECT message_id FROM subscription_alert_state WHERE id = 1').get() as { message_id: number | null } | undefined;
  return row?.message_id ?? undefined;
}

function storeAlertMessageId(db: PublicSearchDatabase, messageId: number | undefined) {
  db.prepare(
    `INSERT INTO subscription_alert_state (id, message_id, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET message_id = excluded.message_id, updated_at = excluded.updated_at`
  ).run(messageId ?? null, new Date().toISOString());
}

export async function refreshSubscriptionAlert(
  db: PublicSearchDatabase,
  telegram: AlertTelegramClient,
  options: { chatId: number; messageThreadId: number }
) {
  const users = listUsersNeedingAlert(db);
  const existingMessageId = getStoredAlertMessageId(db);

  if (users.length === 0) {
    if (existingMessageId !== undefined) {
      await telegram.deleteMessage({ chatId: options.chatId, messageId: existingMessageId });
      storeAlertMessageId(db, undefined);
    }
    return { state: 'empty' as const, count: 0 };
  }

  const text = formatSubscriptionAlert(users);
  if (existingMessageId !== undefined) {
    await telegram.editMessageText({ chatId: options.chatId, messageId: existingMessageId, text });
    return { state: 'updated' as const, count: users.length, messageId: existingMessageId };
  }

  const result = await telegram.sendMessage({
    chatId: options.chatId,
    messageThreadId: options.messageThreadId,
    text
  });
  storeAlertMessageId(db, result.messageId);
  return { state: 'posted' as const, count: users.length, messageId: result.messageId };
}
```

- [ ] **Step 4: Run alert tests to verify pass**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-alert.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/public-search-bot/src/subscriptions/alert.service.ts apps/public-search-bot/tests/public-search.subscription-alert.test.ts
git commit -m "feat: add subscription alert service"
```

---

### Task 7: Add Google Sheets Mapping And Client

**Files:**
- Create: `apps/public-search-bot/src/subscriptions/sheet.mapper.ts`
- Create: `apps/public-search-bot/src/subscriptions/google-sheets.client.ts`
- Create: `apps/public-search-bot/tests/public-search.subscription-sheet-mapper.test.ts`

- [ ] **Step 1: Write failing sheet mapper tests**

Create `apps/public-search-bot/tests/public-search.subscription-sheet-mapper.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  HISTORY_HEADER,
  USERS_HEADER,
  parseUsersSheetRows,
  toHistorySheetRow,
  toUsersSheetRows
} from '../src/subscriptions/sheet.mapper.js';

describe('subscription sheet mapper', () => {
  it('parses user rows by permanent user id', () => {
    expect(parseUsersSheetRows([
      USERS_HEADER,
      ['42', '@paid_user', '2026-05-26', '2026-06-26', '31', 'Subscribe', '2026-05-26T00:00:00.000Z'],
      ['', '@missing_id', '2026-05-26', '', '', '', '']
    ])).toEqual([
      {
        telegramUserId: 42,
        username: 'paid_user',
        startDate: '2026-05-26'
      }
    ]);
  });

  it('formats active and history rows', () => {
    expect(toUsersSheetRows([
      {
        telegramUserId: 42,
        username: 'paid_user',
        subscriptionStartDate: '2026-05-26',
        subscriptionEndDate: '2026-06-26',
        daysRemaining: 31,
        status: 'Subscribe',
        removedFromGroup: false,
        createdAt: '2026-05-26T00:00:00.000Z',
        updatedAt: '2026-05-26T00:00:00.000Z'
      }
    ])).toEqual([
      USERS_HEADER,
      ['42', '@paid_user', '2026-05-26', '2026-06-26', '31', 'Subscribe', '2026-05-26T00:00:00.000Z']
    ]);

    expect(toHistorySheetRow({
      telegramUserId: 42,
      username: 'paid_user',
      subscriptionStartDate: '2026-05-26',
      subscriptionEndDate: '2026-06-26',
      status: 'Kicked',
      kickedAt: '2026-06-27T00:00:00.000Z',
      removedFromGroup: true,
      createdAt: '2026-05-26T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:00.000Z'
    })).toEqual(['42', '@paid_user', 'Kicked', '2026-06-27T00:00:00.000Z', '2026-05-26', '2026-06-26', 'Overdue subscription removed']);
  });
});
```

- [ ] **Step 2: Run sheet mapper tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-sheet-mapper.test.ts
```

Expected: FAIL because the mapper file does not exist.

- [ ] **Step 3: Implement sheet mapper**

Create `apps/public-search-bot/src/subscriptions/sheet.mapper.ts`:

```ts
import type { SubscriptionUser } from './repository.js';

export const USERS_HEADER = ['User ID', 'Username', 'Start Date', 'End Date', 'Days Remaining', 'Status', 'Last Updated'];
export const HISTORY_HEADER = ['User ID', 'Username', 'Last Status', 'Kicked At', 'Last Start Date', 'Last End Date', 'Notes'];

export type ParsedUsersSheetRow = {
  telegramUserId: number;
  username?: string | undefined;
  startDate?: string | undefined;
};

function normalizeUsername(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.replace(/^@/, '') : undefined;
}

function normalizeDate(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

export function parseUsersSheetRows(rows: unknown[][]): ParsedUsersSheetRow[] {
  return rows.slice(1).flatMap((row) => {
    const telegramUserId = Number(row[0]);
    if (!Number.isInteger(telegramUserId) || telegramUserId <= 0) {
      return [];
    }

    return [{
      telegramUserId,
      username: normalizeUsername(row[1]),
      startDate: normalizeDate(row[2])
    }];
  });
}

function usernameCell(user: SubscriptionUser) {
  return user.username ? `@${user.username}` : '';
}

export function toUsersSheetRows(users: SubscriptionUser[]) {
  return [
    USERS_HEADER,
    ...users.map((user) => [
      String(user.telegramUserId),
      usernameCell(user),
      user.subscriptionStartDate ?? '',
      user.subscriptionEndDate ?? '',
      user.daysRemaining === undefined ? '' : String(user.daysRemaining),
      user.status,
      user.updatedAt
    ])
  ];
}

export function toHistorySheetRow(user: SubscriptionUser) {
  return [
    String(user.telegramUserId),
    usernameCell(user),
    user.status,
    user.kickedAt ?? '',
    user.subscriptionStartDate ?? '',
    user.subscriptionEndDate ?? '',
    'Overdue subscription removed'
  ];
}
```

- [ ] **Step 4: Implement Google Sheets client**

Create `apps/public-search-bot/src/subscriptions/google-sheets.client.ts`:

```ts
import { google } from 'googleapis';

export type GoogleSheetsClientConfig = {
  spreadsheetId: string;
  serviceAccountKeyFile: string;
};

export function createGoogleSheetsClient(config: GoogleSheetsClientConfig) {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.serviceAccountKeyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  return {
    async readRows(range: string) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range
      });
      return response.data.values ?? [];
    },

    async replaceRows(range: string, rows: unknown[][]) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: rows
        }
      });
    },

    async appendRows(range: string, rows: unknown[][]) {
      if (rows.length === 0) {
        return;
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId: config.spreadsheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: rows
        }
      });
    }
  };
}

export type GoogleSheetsClient = ReturnType<typeof createGoogleSheetsClient>;
```

- [ ] **Step 5: Run sheet mapper tests to verify pass**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-sheet-mapper.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/public-search-bot/src/subscriptions/sheet.mapper.ts apps/public-search-bot/src/subscriptions/google-sheets.client.ts apps/public-search-bot/tests/public-search.subscription-sheet-mapper.test.ts
git commit -m "feat: add subscription sheet mapping"
```

---

### Task 8: Add Subscription Sync Service And Admin Routes

**Files:**
- Create: `apps/public-search-bot/src/subscriptions/sync.service.ts`
- Create: `apps/public-search-bot/src/subscriptions/routes.ts`
- Modify: `apps/public-search-bot/src/app.ts`
- Create: `apps/public-search-bot/tests/public-search.subscription-sync.test.ts`
- Create: `apps/public-search-bot/tests/public-search.subscription-routes.test.ts`

- [ ] **Step 1: Write failing sync service tests**

Create `apps/public-search-bot/tests/public-search.subscription-sync.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import { syncSubscriptionsFromSheet } from '../src/subscriptions/sync.service.js';
import { USERS_HEADER } from '../src/subscriptions/sheet.mapper.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription sync service', () => {
  it('applies manual start dates and writes refreshed active rows', async () => {
    const db = createDb();
    try {
      db.prepare(
        `INSERT INTO subscription_users (telegram_user_id, username, status, removed_from_group, created_at, updated_at)
         VALUES (42, 'paid_user', 'Unpaid', 0, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z')`
      ).run();
      const sheets = {
        readRows: vi.fn(async () => [USERS_HEADER, ['42', '@paid_user', '2026-05-26', '', '', '', '']]),
        replaceRows: vi.fn(async () => undefined),
        appendRows: vi.fn(async () => undefined)
      };

      const result = await syncSubscriptionsFromSheet(db, sheets, {
        usersRange: 'Users!A:G',
        historyRange: 'History!A:G',
        now: new Date('2026-05-26T00:00:00.000Z'),
        periodDays: 31
      });

      expect(result.updatedUsers).toBe(1);
      expect(sheets.replaceRows).toHaveBeenCalledWith('Users!A:G', [
        USERS_HEADER,
        ['42', '@paid_user', '2026-05-26', '2026-06-26', '31', 'Subscribe', expect.any(String)]
      ]);
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Write failing route tests**

Create `apps/public-search-bot/tests/public-search.subscription-routes.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createSubscriptionRouter } from '../src/subscriptions/routes.js';

describe('subscription routes', () => {
  it('requires subscription admin bearer token', async () => {
    const app = express();
    app.use('/api', createSubscriptionRouter({
      adminToken: 'admin-token',
      syncFromSheet: vi.fn(),
      refreshAlert: vi.fn()
    }));

    expect((await request(app).post('/api/subscriptions/update')).status).toBe(401);
    expect((await request(app).post('/api/subscriptions/send-alert').set('Authorization', 'Bearer wrong')).status).toBe(401);
  });

  it('runs update and send-alert actions', async () => {
    const app = express();
    const syncFromSheet = vi.fn(async () => ({ updatedUsers: 2 }));
    const refreshAlert = vi.fn(async () => ({ state: 'posted', count: 1 }));
    app.use('/api', createSubscriptionRouter({ adminToken: 'admin-token', syncFromSheet, refreshAlert }));

    const update = await request(app).post('/api/subscriptions/update').set('Authorization', 'Bearer admin-token');
    const alert = await request(app).post('/api/subscriptions/send-alert').set('Authorization', 'Bearer admin-token');

    expect(update.body).toEqual({ subscriptions: { updatedUsers: 2 } });
    expect(alert.body).toEqual({ alert: { state: 'posted', count: 1 } });
  });
});
```

- [ ] **Step 3: Run sync/route tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-sync.test.ts apps/public-search-bot/tests/public-search.subscription-routes.test.ts
```

Expected: FAIL because sync service and routes do not exist.

- [ ] **Step 4: Implement sync service**

Create `apps/public-search-bot/src/subscriptions/sync.service.ts`:

```ts
import type { PublicSearchDatabase } from '../db/database.js';
import type { GoogleSheetsClient } from './google-sheets.client.js';
import {
  applySubscriptionStartDate,
  getSubscriptionUser,
  listActiveSubscriptionRows,
  markSubscriptionUserKicked,
  type SubscriptionUser
} from './repository.js';
import { parseUsersSheetRows, toHistorySheetRow, toUsersSheetRows } from './sheet.mapper.js';

export async function syncSubscriptionsFromSheet(
  db: PublicSearchDatabase,
  sheets: Pick<GoogleSheetsClient, 'readRows' | 'replaceRows' | 'appendRows'>,
  options: {
    usersRange: string;
    historyRange: string;
    now: Date;
    periodDays: number;
  }
) {
  const rows = await sheets.readRows(options.usersRange);
  const parsedRows = parseUsersSheetRows(rows);
  let updatedUsers = 0;

  for (const row of parsedRows) {
    if (!row.startDate) {
      continue;
    }

    const current = getSubscriptionUser(db, row.telegramUserId);
    if (!current || current.subscriptionStartDate === row.startDate) {
      continue;
    }

    applySubscriptionStartDate(db, row.telegramUserId, row.startDate, options.now, options.periodDays);
    updatedUsers += 1;
  }

  await sheets.replaceRows(options.usersRange, toUsersSheetRows(listActiveSubscriptionRows(db)));
  return { updatedUsers };
}

export async function moveKickedUsersToHistory(
  db: PublicSearchDatabase,
  sheets: Pick<GoogleSheetsClient, 'replaceRows' | 'appendRows'>,
  options: {
    usersRange: string;
    historyRange: string;
    users: SubscriptionUser[];
  }
) {
  if (options.users.length > 0) {
    await sheets.appendRows(options.historyRange, options.users.map(toHistorySheetRow));
  }

  await sheets.replaceRows(options.usersRange, toUsersSheetRows(listActiveSubscriptionRows(db)));
  return { movedUsers: options.users.length };
}
```

- [ ] **Step 5: Implement subscription routes**

Create `apps/public-search-bot/src/subscriptions/routes.ts`:

```ts
import express from 'express';

function extractBearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function createSubscriptionRouter(options: {
  adminToken: string;
  syncFromSheet: () => Promise<unknown>;
  refreshAlert: () => Promise<unknown>;
}) {
  const router = express.Router();

  router.use('/subscriptions', (req, res, next) => {
    const token = extractBearerToken(req.header('authorization'));
    if (token !== options.adminToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });

  router.post('/subscriptions/update', async (_req, res, next) => {
    try {
      res.json({ subscriptions: await options.syncFromSheet() });
    } catch (error) {
      next(error);
    }
  });

  router.post('/subscriptions/send-alert', async (_req, res, next) => {
    try {
      res.json({ alert: await options.refreshAlert() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

- [ ] **Step 6: Mount routes in app**

Modify `apps/public-search-bot/src/app.ts` so `createPublicSearchApp` accepts optional subscription routes:

```ts
type CreatePublicSearchAppOptions = {
  db: PublicSearchDatabase;
  config: PublicSearchConfig;
  statusTracker?: PublicSearchStatusTracker;
  subscriptionRouter?: express.Router | undefined;
};
```

Mount before the 404 handler:

```ts
if (options.subscriptionRouter) {
  app.use('/api', options.subscriptionRouter);
}
```

- [ ] **Step 7: Run sync/route tests to verify pass**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-sync.test.ts apps/public-search-bot/tests/public-search.subscription-routes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/public-search-bot/src/subscriptions/sync.service.ts apps/public-search-bot/src/subscriptions/routes.ts apps/public-search-bot/src/app.ts apps/public-search-bot/tests/public-search.subscription-sync.test.ts apps/public-search-bot/tests/public-search.subscription-routes.test.ts
git commit -m "feat: add subscription admin routes"
```

---

### Task 9: Add Subscription Bot Update Handling

**Files:**
- Create: `apps/public-search-bot/src/subscriptions/bot.handlers.ts`
- Create: `apps/public-search-bot/tests/public-search.subscription-bot-handlers.test.ts`

- [ ] **Step 1: Write failing subscription bot handler tests**

Create `apps/public-search-bot/tests/public-search.subscription-bot-handlers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import { handleSubscriptionBotUpdate } from '../src/subscriptions/bot.handlers.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription bot handlers', () => {
  it('records latest username from chat member updates', async () => {
    const db = createDb();
    try {
      await handleSubscriptionBotUpdate({ db, now: () => new Date('2026-05-26T00:00:00.000Z') }, {
        update_id: 1,
        chat_member: {
          chat: { id: -1003963665033 },
          from: { id: 99, username: 'admin' },
          date: 1779753600,
          old_chat_member: { status: 'left', user: { id: 42, username: 'old_name' } },
          new_chat_member: { status: 'member', user: { id: 42, username: 'new_name' } }
        }
      });

      expect(db.prepare('SELECT telegram_user_id, username, removed_from_group FROM subscription_users').get()).toEqual({
        telegram_user_id: 42,
        username: 'new_name',
        removed_from_group: 0
      });
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Run subscription bot handler tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-bot-handlers.test.ts
```

Expected: FAIL because handler file does not exist.

- [ ] **Step 3: Implement subscription bot handlers**

Create `apps/public-search-bot/src/subscriptions/bot.handlers.ts`:

```ts
import type { PublicSearchDatabase } from '../db/database.js';
import type { TelegramChatMemberUpdated, TelegramUpdate } from '../telegram.client.js';
import { upsertSeenTelegramUser } from './repository.js';

const ACTIVE_MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);

export type SubscriptionBotDeps = {
  db: PublicSearchDatabase;
  now: () => Date;
};

function userFromChatMemberUpdate(update: TelegramChatMemberUpdated) {
  const user = update.new_chat_member.user ?? update.old_chat_member.user;
  return user ? { id: user.id, username: user.username } : undefined;
}

export async function handleSubscriptionBotUpdate(deps: SubscriptionBotDeps, update: TelegramUpdate) {
  const chatMemberUpdate = update.chat_member ?? update.my_chat_member;
  if (!chatMemberUpdate) {
    return;
  }

  const user = userFromChatMemberUpdate(chatMemberUpdate);
  if (!user) {
    return;
  }

  upsertSeenTelegramUser(deps.db, user, deps.now());

  const removedFromGroup = ACTIVE_MEMBER_STATUSES.has(chatMemberUpdate.new_chat_member.status) ? 0 : 1;
  deps.db.prepare(
    `UPDATE subscription_users
     SET removed_from_group = ?, updated_at = ?
     WHERE telegram_user_id = ? AND status != 'Kicked'`
  ).run(removedFromGroup, deps.now().toISOString(), user.id);
}
```

- [ ] **Step 4: Run subscription bot handler tests to verify pass**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-bot-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/public-search-bot/src/subscriptions/bot.handlers.ts apps/public-search-bot/tests/public-search.subscription-bot-handlers.test.ts
git commit -m "feat: track subscription bot members"
```

---

### Task 10: Add Daily Refresh, Kicks, And Runtime Wiring

**Files:**
- Create: `apps/public-search-bot/src/subscriptions/scheduler.ts`
- Modify: `apps/public-search-bot/src/index.ts`
- Modify: `apps/public-search-bot/src/poller.ts`
- Modify: `apps/public-search-bot/tests/public-search.poller.test.ts`
- Create or extend: `apps/public-search-bot/tests/public-search.subscription-sync.test.ts`

- [ ] **Step 1: Write failing daily refresh test**

Extend `apps/public-search-bot/tests/public-search.subscription-sync.test.ts`:

```ts
import { runDailySubscriptionRefresh } from '../src/subscriptions/scheduler.js';

it('queues overdue kicks and refreshes alerts during daily refresh', async () => {
  const db = createDb();
  try {
    db.prepare(
      `INSERT INTO subscription_users (telegram_user_id, username, subscription_start_date, subscription_end_date, days_remaining, status, unpaid_since, removed_from_group, created_at, updated_at)
       VALUES (42, 'late_user', '2026-05-26', '2026-06-26', 0, 'Unpaid', '2026-06-26', 0, '2026-05-26T00:00:00.000Z', '2026-06-26T00:00:00.000Z')`
    ).run();
    const result = await runDailySubscriptionRefresh(db, {
      today: '2026-06-27',
      periodDays: 31,
      overdueGraceDays: 1,
      enqueueAt: new Date('2026-06-27T00:00:00.000Z')
    });

    expect(result).toEqual({ queuedKicks: 1 });
    expect(db.prepare('SELECT type, payload_json FROM subscription_jobs').all()).toEqual([
      { type: 'kick-user', payload_json: '{"telegramUserId":42}' },
      { type: 'refresh-alert', payload_json: '{}' },
      { type: 'refresh-sheet', payload_json: '{}' }
    ]);
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Update poller test for allowed updates**

In `apps/public-search-bot/tests/public-search.poller.test.ts`, add/adjust a test so `pollOnce` forwards `allowedUpdates` to `getUpdates` when provided.

Use this expected call shape:

```ts
expect(telegram.getUpdates).toHaveBeenCalledWith({
  offset: undefined,
  timeout: 30,
  allowedUpdates: ['message', 'chat_member']
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-sync.test.ts apps/public-search-bot/tests/public-search.poller.test.ts
```

Expected: FAIL because scheduler does not exist and poller does not pass `allowedUpdates`.

- [ ] **Step 4: Implement scheduler**

Create `apps/public-search-bot/src/subscriptions/scheduler.ts`:

```ts
import type { PublicSearchDatabase } from '../db/database.js';
import { enqueueSubscriptionJob } from './job.repository.js';
import { listKickCandidates, recalculateSubscriptions } from './repository.js';

export async function runDailySubscriptionRefresh(
  db: PublicSearchDatabase,
  options: {
    today: string;
    periodDays: number;
    overdueGraceDays: number;
    enqueueAt: Date;
  }
) {
  recalculateSubscriptions(db, options.today, options.periodDays);
  const kickCandidates = listKickCandidates(db, options.today, options.overdueGraceDays);

  for (const user of kickCandidates) {
    enqueueSubscriptionJob(db, 'kick-user', { telegramUserId: user.telegramUserId }, options.enqueueAt);
  }
  enqueueSubscriptionJob(db, 'refresh-alert', {}, options.enqueueAt);
  enqueueSubscriptionJob(db, 'refresh-sheet', {}, options.enqueueAt);

  return { queuedKicks: kickCandidates.length };
}

export function startDailySubscriptionRefreshLoop(input: {
  run: () => Promise<void>;
  intervalMs?: number;
}) {
  const intervalMs = input.intervalMs ?? 60 * 60 * 1000;
  void input.run();
  return setInterval(() => {
    void input.run();
  }, intervalMs);
}
```

- [ ] **Step 5: Update poller**

Modify `apps/public-search-bot/src/poller.ts` so `pollOnce` accepts allowed updates:

```ts
export async function pollOnce(
  state: PollState,
  telegram: Pick<PublicTelegramClient, 'getUpdates'>,
  handleUpdate: (update: TelegramUpdate) => Promise<void>,
  options: { allowedUpdates?: string[] } = {}
) {
  const updates = await telegram.getUpdates({
    offset: state.offset,
    timeout: 30,
    allowedUpdates: options.allowedUpdates
  });
  // keep the existing update loop unchanged
}
```

- [ ] **Step 6: Wire runtime in index**

In `apps/public-search-bot/src/index.ts`:

Create both Telegram clients:

```ts
const publicTelegram = createPublicTelegramClient({ botToken: config.publicBotToken });
const subscriptionTelegram = createPublicTelegramClient({ botToken: config.subscriptionBotToken });
```

Pass subscription config to public handlers:

```ts
subscription: {
  now: () => new Date(),
  trialHours: config.subscriptionTrialHours,
  adminContact: config.subscriptionAdminContact
}
```

Create Google Sheets client:

```ts
const sheets = createGoogleSheetsClient({
  spreadsheetId: config.googleSheetsSpreadsheetId,
  serviceAccountKeyFile: config.googleServiceAccountKeyFile
});
```

Create route dependencies:

```ts
const refreshAlert = () => refreshSubscriptionAlert(db, subscriptionTelegram, {
  chatId: config.subscriptionGroupChatId,
  messageThreadId: config.subscriptionAlertThreadId
});
const syncFromSheet = () => syncSubscriptionsFromSheet(db, sheets, {
  usersRange: config.googleSheetsUsersRange,
  historyRange: config.googleSheetsHistoryRange,
  now: new Date(),
  periodDays: config.subscriptionPeriodDays
});
```

Mount `createSubscriptionRouter({ adminToken: config.subscriptionAdminToken, syncFromSheet, refreshAlert })`.

Run two polling loops with separate `PollState` objects:

```ts
const publicPollState: PollState = {};
const subscriptionPollState: PollState = {};
```

Public poll loop allowed updates:

```ts
{ allowedUpdates: ['message', 'callback_query'] }
```

Subscription poll loop allowed updates:

```ts
{ allowedUpdates: ['chat_member', 'my_chat_member'] }
```

Add job loop:

```ts
async function processSubscriptionJobs() {
  await processNextSubscriptionJob(db, {
    refreshAlert,
    refreshSheet: syncFromSheet,
    kickUser: async (telegramUserId) => {
      await subscriptionTelegram.removeChatMember({ chatId: config.subscriptionGroupChatId, userId: telegramUserId });
      const kicked = markSubscriptionUserKicked(db, telegramUserId, new Date());
      if (kicked) {
        await moveKickedUsersToHistory(db, sheets, {
          usersRange: config.googleSheetsUsersRange,
          historyRange: config.googleSheetsHistoryRange,
          users: [kicked]
        });
      }
    }
  });
}
```

Use `delay(1_000)` between job-loop iterations, matching the existing polling retry style.

- [ ] **Step 7: Run focused runtime tests**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.subscription-sync.test.ts apps/public-search-bot/tests/public-search.poller.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/public-search-bot/src/subscriptions/scheduler.ts apps/public-search-bot/src/index.ts apps/public-search-bot/src/poller.ts apps/public-search-bot/tests/public-search.subscription-sync.test.ts apps/public-search-bot/tests/public-search.poller.test.ts
git commit -m "feat: wire subscription runtime jobs"
```

---

### Task 11: Add Google Apps Script Template And Documentation

**Files:**
- Create: `apps/public-search-bot/google-apps-script/Code.gs`
- Modify: `apps/public-search-bot/README.md`
- Modify: `README.md`

- [ ] **Step 1: Add Apps Script template**

Create `apps/public-search-bot/google-apps-script/Code.gs`:

```js
function getSubscriptionApiConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const baseUrl = properties.getProperty('SUBSCRIPTION_API_BASE_URL');
  const token = properties.getProperty('SUBSCRIPTION_ADMIN_TOKEN');

  if (!baseUrl || !token) {
    throw new Error('Set SUBSCRIPTION_API_BASE_URL and SUBSCRIPTION_ADMIN_TOKEN in Script Properties.');
  }

  return { baseUrl: baseUrl.replace(/\/$/, ''), token };
}

function callSubscriptionApi_(path) {
  const config = getSubscriptionApiConfig_();
  const response = UrlFetchApp.fetch(config.baseUrl + path, {
    method: 'post',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + config.token
    }
  });
  const body = response.getContentText();

  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Subscription API failed: ' + response.getResponseCode() + ' ' + body);
  }

  return JSON.parse(body);
}

function updateSubscription() {
  const result = callSubscriptionApi_('/api/subscriptions/update');
  SpreadsheetApp.getActive().toast('Subscription sheet updated: ' + JSON.stringify(result.subscriptions));
}

function sendAlert() {
  const result = callSubscriptionApi_('/api/subscriptions/send-alert');
  SpreadsheetApp.getActive().toast('Subscription alert updated: ' + JSON.stringify(result.alert));
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Subscriptions')
    .addItem('Update Subscription', 'updateSubscription')
    .addItem('Send Alert', 'sendAlert')
    .addToUi();
}
```

- [ ] **Step 2: Update standalone README**

In `apps/public-search-bot/README.md`, add a `Subscription Access` section covering:

```text
The standalone service now runs two Telegram bot tokens:
- PUBLIC_BOT_TOKEN for /start and /search
- SUBSCRIPTION_BOT_TOKEN for subscription alerts and overdue removals

Create Google Sheet tabs:
Users: User ID | Username | Start Date | End Date | Days Remaining | Status | Last Updated
History: User ID | Username | Last Status | Kicked At | Last Start Date | Last End Date | Notes

Use a Google Cloud service account JSON key on the VPS and share the workbook with the service account email.
Copy apps/public-search-bot/google-apps-script/Code.gs into Apps Script.
Set Script Properties:
SUBSCRIPTION_API_BASE_URL=https://your-vps.example.com
SUBSCRIPTION_ADMIN_TOKEN=same value as VPS SUBSCRIPTION_ADMIN_TOKEN
```

- [ ] **Step 3: Update root README**

In `README.md`, update the public search bot section to say:

```text
The public search bot no longer uses group membership as the final search access gate. It uses the standalone bot's subscription database: first search starts a one-day free trial, active paid users can search, and expired/unpaid/kicked users are blocked from download links.
```

- [ ] **Step 4: Run docs sanity checks**

Run:

```powershell
rg -n "SUBSCRIPTION_BOT_TOKEN|Update Subscription|Send Alert|Google Cloud service account" README.md apps/public-search-bot/README.md apps/public-search-bot/google-apps-script/Code.gs
```

Expected: output includes all three files.

- [ ] **Step 5: Commit**

```powershell
git add README.md apps/public-search-bot/README.md apps/public-search-bot/google-apps-script/Code.gs
git commit -m "docs: add subscription setup instructions"
```

---

### Task 12: Full Verification

**Files:**
- No source changes expected unless verification finds a bug.

- [ ] **Step 1: Run standalone tests**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test
```

Expected: PASS.

- [ ] **Step 2: Run standalone build**

Run:

```powershell
npm.cmd --prefix apps/public-search-bot run build
```

Expected: PASS and `apps/public-search-bot/dist/` is generated.

- [ ] **Step 3: Run root test suite**

Run:

```powershell
npm.cmd test
```

Expected: PASS.

- [ ] **Step 4: Run root build**

Run:

```powershell
npm.cmd run build
```

Expected: PASS.

- [ ] **Step 5: Inspect git status**

Run:

```powershell
git status --short
```

Expected: only intentional generated or source changes remain. Do not stage `.env`, service account JSON files, SQLite databases, or unrelated local files.

- [ ] **Step 6: Commit verification fixes if needed**

Only if verification required fixes:

```powershell
git add apps/public-search-bot/src apps/public-search-bot/tests README.md apps/public-search-bot/README.md apps/public-search-bot/google-apps-script
git commit -m "fix: stabilize subscription access rollout"
```

Expected: commit includes only files touched to fix verification failures. If no verification fixes were required, skip this step.

---

## Implementation Notes

- Keep the database as the source of truth for access. Google Sheets is an admin dashboard and should not be read during `/search`.
- Do not delete kicked users from SQLite. Kicked users must not receive a second free trial.
- Keep public search responses fast. All Google Sheets and kick work belongs in admin routes, daily refresh, or queued jobs.
- Prefer one alert message that is edited/deleted over many reminder messages.
- Respect Telegram `retry_after` through the persistent job queue.
- Never commit `.env`, Google service account JSON, or SQLite database files.

## Self-Review

Spec coverage:

- Two bots in one service: Tasks 1, 9, 10.
- Shared SQLite subscription database: Task 2.
- One-day trial and search gate: Task 3.
- Username tracking by user id: Tasks 2, 3, 9.
- Google Sheets dashboard and buttons: Tasks 7, 8, 11.
- Alert post/edit/delete: Tasks 6, 8, 10.
- Queue and retry/backoff: Task 5 and Task 10.
- Overdue kicks and history movement: Tasks 8 and 10.
- Docs and rollout setup: Task 11.
- Verification: Task 12.

Placeholder scan: no unfinished markers or unspecified implementation steps remain in this plan. Placeholder values appear only in environment examples where the deployer must supply real secrets.

Type consistency: subscription statuses use `Trial`, `Subscribe`, `Needs Attention`, `Unpaid`, and `Kicked` throughout the plan. User identity is always keyed by `telegramUserId` in storage and numeric `id` when taken from Telegram updates.

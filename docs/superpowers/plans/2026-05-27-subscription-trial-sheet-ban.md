# Subscription Trial Sheet Sync and Ban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically push new trial/username updates to Google Sheets after five minutes, keep overdue users banned until payment, and unban paid users during `Update Subscription`.

**Architecture:** Reuse the existing subscription job queue by adding a deduplicated delayed `refresh-sheet` enqueue helper. Keep trial access synchronous in SQLite, then schedule a batched sheet refresh. Split Telegram group removal into explicit `banChatMember` and `unbanChatMember` methods so overdue removal stays banned and paid renewal can unban.

**Tech Stack:** TypeScript, Node.js, Express, Telegraf-style Telegram Bot API client, better-sqlite3, Google Sheets API, Vitest.

---

## File Map

- Modify `apps/public-search-bot/src/subscriptions/job.repository.ts`: add `enqueueSubscriptionJobIfNotActive` for deduplicated pending/running jobs.
- Modify `apps/public-search-bot/src/bot/handlers.ts`: accept optional `scheduleSheetRefresh` and call it after allowed user activity so new trials and username changes flow to Sheets through the same five-minute batch.
- Modify `apps/public-search-bot/src/index.ts`: wire `scheduleSheetRefresh`, switch overdue removal to persistent ban, and unban renewed users after sheet sync.
- Modify `apps/public-search-bot/src/telegram.client.ts`: replace current kick-and-unban behavior with explicit `banChatMember`, preserve `unbanChatMember`.
- Modify `apps/public-search-bot/src/subscriptions/sync.service.ts`: return the list of users whose paid start date was applied so the runtime can unban them.
- Modify tests:
  - `apps/public-search-bot/tests/public-search.subscription-jobs.test.ts`
  - `apps/public-search-bot/tests/public-search.handlers.test.ts`
  - `apps/public-search-bot/tests/public-search.telegram-client.test.ts`
  - `apps/public-search-bot/tests/public-search.subscription-sync.test.ts`

---

### Task 1: Deduplicated Delayed Sheet Refresh Jobs

**Files:**
- Modify: `apps/public-search-bot/src/subscriptions/job.repository.ts`
- Test: `apps/public-search-bot/tests/public-search.subscription-jobs.test.ts`

- [ ] **Step 1: Write failing tests for deduplicated active jobs**

Add `enqueueSubscriptionJobIfNotActive` to the existing import list in `public-search.subscription-jobs.test.ts`, then add:

```ts
it('deduplicates active refresh-sheet jobs', () => {
  const db = createDb();
  try {
    const first = enqueueSubscriptionJobIfNotActive(
      db,
      'refresh-sheet',
      {},
      new Date('2026-05-26T00:05:00.000Z')
    );
    const duplicate = enqueueSubscriptionJobIfNotActive(
      db,
      'refresh-sheet',
      {},
      new Date('2026-05-26T00:06:00.000Z')
    );

    expect(first.enqueued).toBe(true);
    expect(duplicate).toEqual({ enqueued: false, job: first.job });
    expect(listSubscriptionJobs(db)).toHaveLength(1);
    expect(listSubscriptionJobs(db)[0]).toMatchObject({
      type: 'refresh-sheet',
      status: 'pending',
      runAfter: '2026-05-26T00:05:00.000Z'
    });
  } finally {
    db.close();
  }
});

it('allows a new refresh-sheet job after prior active jobs finish', () => {
  const db = createDb();
  try {
    const first = enqueueSubscriptionJobIfNotActive(
      db,
      'refresh-sheet',
      {},
      new Date('2026-05-26T00:05:00.000Z')
    );
    const claimed = claimNextSubscriptionJob(db, new Date('2026-05-26T00:05:00.000Z'));
    expect(markSubscriptionJobSucceeded(db, first.job.id, claimed?.claimedAt ?? '', new Date('2026-05-26T00:05:01.000Z'))).toBe(true);

    const second = enqueueSubscriptionJobIfNotActive(
      db,
      'refresh-sheet',
      {},
      new Date('2026-05-26T00:10:00.000Z')
    );

    expect(second.enqueued).toBe(true);
    expect(listSubscriptionJobs(db)).toHaveLength(2);
    expect(listSubscriptionJobs(db)[1]).toMatchObject({
      type: 'refresh-sheet',
      status: 'pending',
      runAfter: '2026-05-26T00:10:00.000Z'
    });
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Run failing job tests**

Run:

```powershell
npm.cmd test -- public-search.subscription-jobs.test.ts
```

Expected: fail because `enqueueSubscriptionJobIfNotActive` is not exported.

- [ ] **Step 3: Implement the helper**

In `job.repository.ts`, add:

```ts
export type EnqueueSubscriptionJobIfNotActiveResult =
  | { enqueued: true; job: SubscriptionJob }
  | { enqueued: false; job: SubscriptionJob };

export function enqueueSubscriptionJobIfNotActive(
  db: PublicSearchDatabase,
  type: SubscriptionJobType,
  payload: Record<string, unknown>,
  runAfter: Date
): EnqueueSubscriptionJobIfNotActiveResult {
  const enqueue = db.transaction(() => {
    const active = db
      .prepare(
        `SELECT
           id,
           type,
           payload_json AS payloadJson,
           status,
           attempts,
           run_after AS runAfter,
           claimed_at AS claimedAt,
           last_error AS lastError,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM subscription_jobs
         WHERE type = @type
           AND status IN ('pending', 'running')
         ORDER BY run_after ASC, id ASC
         LIMIT 1`
      )
      .get({ type }) as SubscriptionJobRow | undefined;

    if (active) {
      return { enqueued: false as const, job: mapSubscriptionJob(active) };
    }

    return { enqueued: true as const, job: enqueueSubscriptionJob(db, type, payload, runAfter) };
  });

  return enqueue();
}
```

- [ ] **Step 4: Run job tests again**

Run:

```powershell
npm.cmd test -- public-search.subscription-jobs.test.ts
```

Expected: pass.

---

### Task 2: Schedule Sheet Refresh After Trial and Username Activity

**Files:**
- Modify: `apps/public-search-bot/src/bot/handlers.ts`
- Test: `apps/public-search-bot/tests/public-search.handlers.test.ts`

- [ ] **Step 1: Write failing handler tests**

Extend `HandlerDeps.subscription` in test helper setup with:

```ts
scheduleSheetRefresh: vi.fn()
```

Add or update tests:

```ts
it('schedules a delayed sheet refresh when a trial starts from search', async () => {
  const db = createMigratedDatabase();
  try {
    seedCatalog(db);
    const { deps } = createDeps(db);

    await handleTelegramUpdate(
      deps,
      messageUpdate('/search inception', { from: { id: 42, username: 'trial_user' } })
    );

    expect(deps.subscription.scheduleSheetRefresh).toHaveBeenCalledTimes(1);
    expect(deps.subscription.scheduleSheetRefresh).toHaveBeenCalledWith(new Date('2026-05-26T00:00:00.000Z'));
  } finally {
    db.close();
  }
});

it('schedules a sheet refresh for an existing active subscriber search so username updates flow to Sheets', async () => {
  const db = createMigratedDatabase();
  try {
    seedCatalog(db);
    db.prepare(
      `INSERT INTO subscription_users (
         telegram_user_id, username, subscription_start_date, subscription_end_date, days_remaining,
         status, removed_from_group, created_at, updated_at
       )
       VALUES (42, 'paid_user', '2026-05-01', '2026-06-01', 6, 'Subscribe', 0, '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')`
    ).run();
    const { deps } = createDeps(db);

    await handleTelegramUpdate(
      deps,
      messageUpdate('/search inception', { from: { id: 42, username: 'paid_user' } })
    );

    expect(deps.subscription.scheduleSheetRefresh).toHaveBeenCalledTimes(1);
    expect(deps.subscription.scheduleSheetRefresh).toHaveBeenCalledWith(new Date('2026-05-26T00:00:00.000Z'));
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Run failing handler tests**

Run:

```powershell
npm.cmd test -- public-search.handlers.test.ts
```

Expected: fail because `scheduleSheetRefresh` is not part of `HandlerDeps` and is not called.

- [ ] **Step 3: Implement scheduling in handlers**

In `HandlerDeps.subscription`, add:

```ts
scheduleSheetRefresh?: ((now: Date) => void) | undefined;
```

In `handleSearch`, use one `now` value and schedule after access is allowed:

```ts
const now = deps.subscription.now();
const access = evaluateSearchAccess(deps.db, {
  user,
  now,
  trialHours: deps.subscription.trialHours
});

if (!access.allowed) {
  await sendBotMessage(deps, chatId, formatSubscriptionRequiredMessage(deps.subscription.adminContact));
  return;
}

deps.subscription.scheduleSheetRefresh?.(now);
```

In `handleCallbackQuery`, use the same pattern around `evaluateSearchAccess` and call `deps.subscription.scheduleSheetRefresh?.(now)` after access is allowed. This means every active user interaction can refresh the Sheet, but the job repository dedupes it to one pending/running `refresh-sheet` job.

- [ ] **Step 4: Run handler tests again**

Run:

```powershell
npm.cmd test -- public-search.handlers.test.ts
```

Expected: pass.

---

### Task 3: Wire Five-Minute Sheet Refresh Scheduling

**Files:**
- Modify: `apps/public-search-bot/src/index.ts`
- Test: covered through Task 1 and Task 2; final behavior checked by TypeScript.

- [ ] **Step 1: Add runtime scheduling helper**

Import `enqueueSubscriptionJobIfNotActive` from `./subscriptions/job.repository.js`.

Add near `syncFromSheet`:

```ts
const scheduleSheetRefresh = (now: Date) => {
  const runAfter = new Date(now.getTime() + 5 * 60 * 1000);
  enqueueSubscriptionJobIfNotActive(db, 'refresh-sheet', {}, runAfter);
};
```

- [ ] **Step 2: Pass helper to public search handlers**

Inside the `handleTelegramUpdate` dependency object, change:

```ts
subscription: {
  now: () => new Date(),
  trialHours: config.subscriptionTrialHours,
  adminContact: config.subscriptionAdminContact
},
```

to:

```ts
subscription: {
  now: () => new Date(),
  trialHours: config.subscriptionTrialHours,
  adminContact: config.subscriptionAdminContact,
  scheduleSheetRefresh
},
```

- [ ] **Step 3: Type-check runtime wiring**

Run:

```powershell
npx.cmd tsc -p tsconfig.json --noEmit
```

Expected: pass.

---

### Task 4: Keep Overdue Users Banned

**Files:**
- Modify: `apps/public-search-bot/src/telegram.client.ts`
- Modify: `apps/public-search-bot/src/index.ts`
- Test: `apps/public-search-bot/tests/public-search.telegram-client.test.ts`

- [ ] **Step 1: Update Telegram client tests**

Replace the remove-member tests with:

```ts
it('bans a chat member without immediately unbanning them', async () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true, result: true }));
  const client = createPublicTelegramClient({ botToken: 'bot-token' }, fetchMock);

  await client.banChatMember({ chatId: -1003963665033, userId: 42 });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(getJsonBody(fetchMock, 0)).toEqual({ chat_id: -1003963665033, user_id: 42, revoke_messages: false });
});
```

Keep the existing `unbanChatMember sends the unban payload` test.

- [ ] **Step 2: Run failing Telegram client tests**

Run:

```powershell
npm.cmd test -- public-search.telegram-client.test.ts
```

Expected: fail because `banChatMember` is not exported yet and old remove tests no longer match.

- [ ] **Step 3: Implement explicit ban method**

In `telegram.client.ts`, replace `removeChatMember` with:

```ts
async banChatMember(input: { chatId: number; userId: number }): Promise<void> {
  await post('banChatMember', {
    chat_id: input.chatId,
    user_id: input.userId,
    revoke_messages: false
  });
},
```

Keep `unbanChatMember`.

- [ ] **Step 4: Use persistent ban in overdue job**

In `index.ts`, replace:

```ts
await subscriptionTelegram.removeChatMember({
  chatId: config.subscriptionGroupChatId,
  userId: telegramUserId
});
```

with:

```ts
await subscriptionTelegram.banChatMember({
  chatId: config.subscriptionGroupChatId,
  userId: telegramUserId
});
```

- [ ] **Step 5: Run Telegram client tests**

Run:

```powershell
npm.cmd test -- public-search.telegram-client.test.ts
```

Expected: pass.

---

### Task 5: Unban Users When Paid Start Date Is Applied

**Files:**
- Modify: `apps/public-search-bot/src/subscriptions/sync.service.ts`
- Modify: `apps/public-search-bot/src/index.ts`
- Test: `apps/public-search-bot/tests/public-search.subscription-sync.test.ts`

- [ ] **Step 1: Write failing sync result test**

Update `SyncSubscriptionsFromSheetResult` expectations in `public-search.subscription-sync.test.ts` so the paid-start test expects:

```ts
expect(result).toEqual({ updatedUsers: 1, skippedUnknownUsers: 0, paidUsers: [expect.objectContaining({ telegramUserId: 42 })] });
```

Add a kicked renewal test:

```ts
it('returns paid users when a kicked user receives a new start date', async () => {
  const db = createDb();
  try {
    db.prepare(
      `INSERT INTO subscription_users (
         telegram_user_id, username, status, removed_from_group, kicked_at,
         created_at, updated_at
       )
       VALUES (42, 'returning_user', 'Kicked', 1, '2026-06-27T00:00:00.000Z',
         '2026-05-26T00:00:00.000Z', '2026-06-27T00:00:00.000Z')`
    ).run();
    const sheets = {
      readRows: vi.fn(async () => [USERS_HEADER, ['42', '@returning_user', '2026-06-28', '', '', '', '']]),
      replaceRows: vi.fn(async () => undefined),
      appendRows: vi.fn(async () => undefined)
    };

    const result = await syncSubscriptionsFromSheet(db, sheets, {
      usersRange: 'Users!A:G',
      historyRange: 'History!A:G',
      now: new Date('2026-06-28T00:00:00.000Z'),
      periodDays: 31
    });

    expect(result.updatedUsers).toBe(1);
    expect(result.paidUsers).toEqual([expect.objectContaining({
      telegramUserId: 42,
      status: 'Subscribe',
      removedFromGroup: false
    })]);
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Run failing sync tests**

Run:

```powershell
npm.cmd test -- public-search.subscription-sync.test.ts
```

Expected: fail because `paidUsers` is not returned.

- [ ] **Step 3: Return paid users from sync**

In `sync.service.ts`:

```ts
export type SyncSubscriptionsFromSheetResult = {
  updatedUsers: number;
  skippedUnknownUsers: number;
  paidUsers: SubscriptionUser[];
};
```

Inside `syncSubscriptionsFromSheet`, add:

```ts
const paidUsers: SubscriptionUser[] = [];
```

After `applySubscriptionStartDate`:

```ts
const paidUser = applySubscriptionStartDate(db, row.telegramUserId, row.startDate, options.now, options.periodDays);
paidUsers.push(paidUser);
updatedUsers += 1;
```

Return:

```ts
return { updatedUsers, skippedUnknownUsers, paidUsers };
```

- [ ] **Step 4: Wire unban in runtime**

In `index.ts`, update `runSyncFromSheet` so it stores the result:

```ts
const result = await syncSubscriptionsFromSheet(db, sheets, {
  usersRange: config.googleSheetsUsersRange,
  historyRange: config.googleSheetsHistoryRange,
  now: new Date(),
  periodDays: config.subscriptionPeriodDays
});

for (const user of result.paidUsers) {
  await subscriptionTelegram.unbanChatMember({
    chatId: config.subscriptionGroupChatId,
    userId: user.telegramUserId,
    onlyIfBanned: true
  });
}

return result;
```

- [ ] **Step 5: Run sync tests**

Run:

```powershell
npm.cmd test -- public-search.subscription-sync.test.ts
```

Expected: pass after updating existing result expectations to include `paidUsers`.

---

### Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm.cmd test -- public-search.subscription-jobs.test.ts public-search.handlers.test.ts public-search.telegram-client.test.ts public-search.subscription-sync.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run TypeScript check**

Run:

```powershell
npx.cmd tsc -p tsconfig.json --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 3: Inspect git status**

Run:

```powershell
git status --short
```

Expected: source/test/doc files modified. `apps/public-search-bot/google-service-account.json` remains untracked and must not be staged.

- [ ] **Step 4: Report operational restart**

Tell the user to restart the public-search bot:

```powershell
cd C:\Users\Batosai\Desktop\infinitylinks\apps\public-search-bot
npm start
```

Explain that new trials will appear in Google Sheets after about five minutes, overdue users will remain banned, and paid users will be unbanned after `Update Subscription`.

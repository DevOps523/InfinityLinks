# Safe Season Repost Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Season repost safe so it cannot create duplicate Telegram posts, leave stale channel links, or edit an old post while a repost is pending.

**Architecture:** Keep the existing Season page and repost eligibility UI, but change the queue semantics. A repost should queue a retained delete plus a dependent send that is blocked until the retained delete succeeds; while that repost is pending, later content changes update the pending send payload instead of canceling the delete or editing the old message.

**Tech Stack:** TypeScript, Express, better-sqlite3, Vitest, React.

---

### Task 1: Add Queue Tests For Repost Ordering

**Files:**
- Modify: `tests/server/telegram.queue.test.ts`
- Modify: `src/server/telegram/telegram.queue.ts`

**Step 1: Write failing test for blocked repost send while delete is waiting retry**

Add a test near the existing queue ordering tests:

```ts
it('does not process a repost send while retained delete is waiting retry', async () => {
  const db = setupDb();
  createSeasonRow(db, 8);
  db.prepare("UPDATE seasons SET telegram_message_id = 456, post_status = 'posted' WHERE id = ?").run(8);

  enqueueTelegramJob(db, 'delete', 'season', 8, {
    messageId: 456,
    retainEntityState: true
  });
  enqueueTelegramJob(db, 'send', 'season', 8, {
    posterUrl: 'https://example.com/season.jpg',
    caption: 'Updated season'
  });

  const client = {
    sendPhotoPost: vi.fn(async () => ({ messageId: 999 })),
    editPhotoCaption: vi.fn(),
    deleteMessage: vi.fn(async () => {
      const error = new Error('Rate limited') as Error & { retryAfter: number };
      error.retryAfter = 60;
      throw error;
    })
  };

  await expect(processNextTelegramJob(db, client)).resolves.toBe(false);
  await expect(processNextTelegramJob(db, client)).resolves.toBe(false);

  expect(client.deleteMessage).toHaveBeenCalledTimes(1);
  expect(client.sendPhotoPost).not.toHaveBeenCalled();
  expect(getJobs(db).find((job) => job.job_type === 'send')).toMatchObject({ status: 'queued' });

  db.close();
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd test -- tests/server/telegram.queue.test.ts
```

Expected: FAIL because the send job is selected even though a retained delete is still waiting retry.

**Step 3: Implement repost send blocking in job selection**

In `src/server/telegram/telegram.queue.ts`, add a helper:

```ts
function hasBlockingRetainedDelete(db: AppDatabase, job: TelegramJobRow) {
  if (job.job_type !== 'send') {
    return false;
  }

  const rows = db
    .prepare(
      `SELECT payload
       FROM telegram_jobs
       WHERE job_type = 'delete'
         AND entity_type = ?
         AND entity_id = ?
         AND status IN ('queued', 'waiting_retry', 'running')`
    )
    .all(job.entity_type, job.entity_id) as Array<{ payload: string }>;

  return rows.some((row) => {
    const payload = JSON.parse(row.payload) as TelegramDeleteJobPayload;
    return payload.retainEntityState === true;
  });
}
```

Then in `processNextTelegramJob`, after selecting a job but before setting it `running`, skip blocked send jobs. Replace the single-row select with a small loop over due jobs ordered by `created_at ASC, id ASC`; choose the first job where `!hasBlockingRetainedDelete(db, selected)`. If all due jobs are blocked, return `undefined`.

**Step 4: Run test to verify it passes**

Run:

```bash
npm.cmd test -- tests/server/telegram.queue.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/telegram/telegram.queue.ts tests/server/telegram.queue.test.ts
git commit -m "fix: block repost send until delete succeeds"
```

---

### Task 2: Clear Stale Message ID After Retained Delete

**Files:**
- Modify: `tests/server/telegram.queue.test.ts`
- Modify: `src/server/telegram/telegram.queue.ts`

**Step 1: Write failing test for retained delete clearing old message ID**

Add:

```ts
it('clears old season message id after retained repost delete succeeds', async () => {
  const db = setupDb();
  createSeasonRow(db, 8);
  db.prepare("UPDATE seasons SET telegram_message_id = 456, post_status = 'posted' WHERE id = ?").run(8);

  enqueueTelegramJob(db, 'delete', 'season', 8, {
    messageId: 456,
    retainEntityState: true
  });

  const client = {
    sendPhotoPost: vi.fn(),
    editPhotoCaption: vi.fn(),
    deleteMessage: vi.fn(async () => undefined)
  };

  await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

  expect(getSeasonPostState(db, 8)).toEqual({
    telegram_message_id: null,
    post_status: 'posted'
  });

  db.close();
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd test -- tests/server/telegram.queue.test.ts
```

Expected: FAIL because retained delete currently leaves `telegram_message_id = 456`.

**Step 3: Update retained delete success handling**

In `src/server/telegram/telegram.queue.ts`, change the retained delete branch. Instead of skipping `updateEntityPostStatus`, call it with only `messageId: null` and preserve `postStatus: 'posted'`.

Implementation shape:

```ts
const isRetainedDelete = job.job_type === 'delete' && (completedPayload as TelegramDeleteJobPayload).retainEntityState;

if (isRetainedDelete) {
  updateEntityPostStatus(db, job.entity_type, job.entity_id, {
    messageId: null,
    postStatus: 'posted'
  });
} else {
  updateEntityPostStatus(db, job.entity_type, job.entity_id, {
    ...(job.job_type === 'delete' ? { messageId: null } : {}),
    ...(result?.messageId !== undefined ? { messageId: result.messageId } : {}),
    postStatus: getPostStatusForJobType(job.job_type)
  });
}
```

**Step 4: Run tests**

Run:

```bash
npm.cmd test -- tests/server/telegram.queue.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/telegram/telegram.queue.ts tests/server/telegram.queue.test.ts
git commit -m "fix: clear old season message after repost delete"
```

---

### Task 3: Preserve Repost Workflow During Content Changes

**Files:**
- Modify: `tests/server/media.tv.test.ts`
- Modify: `src/server/media/media.service.ts`
- Modify: `src/server/telegram/telegram.queue.ts`

**Step 1: Write failing integration test for content change while repost pending**

In `tests/server/media.tv.test.ts`, add:

```ts
it('updates pending repost send instead of editing old post when links change during repost', async () => {
  const { seasonId, episodeId } = createLinkedSeason({ telegramMessageId: 456 });

  await request(app())
    .post(`/api/episodes/${episodeId}/links`)
    .send({
      links: [
        {
          providerName: 'First Host',
          quality: 'HD',
          status: 'active',
          url: 'https://example.com/first'
        }
      ]
    })
    .expect(201);

  await request(app()).post(`/api/seasons/${seasonId}/repost`).expect(200);

  await request(app())
    .post(`/api/episodes/${episodeId}/links`)
    .send({
      links: [
        {
          providerName: 'Second Host',
          quality: 'HD',
          status: 'active',
          url: 'https://example.com/second'
        }
      ]
    })
    .expect(201);

  const jobs = getTelegramJobs();
  expect(jobs.filter((job) => job.job_type === 'delete')).toHaveLength(1);
  expect(jobs.filter((job) => job.job_type === 'edit')).toHaveLength(0);

  const [sendJob] = jobs.filter((job) => job.job_type === 'send');
  expect(JSON.parse(sendJob.payload).caption).toContain('Second Host');
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd test -- tests/server/media.tv.test.ts
```

Expected: FAIL because `syncSeasonPostAfterContentChange()` cancels delete and queues an edit when it sees the old message ID.

**Step 3: Add pending repost detection helper**

In `src/server/telegram/telegram.queue.ts`, export:

```ts
export function hasPendingRetainedTelegramDeleteJob(db: AppDatabase, entityType: TelegramEntityType, entityId: number) {
  const rows = db
    .prepare(
      `SELECT payload
       FROM telegram_jobs
       WHERE job_type = 'delete'
         AND entity_type = ?
         AND entity_id = ?
         AND status IN ('queued', 'waiting_retry', 'running')`
    )
    .all(entityType, entityId) as Array<{ payload: string }>;

  return rows.some((row) => (JSON.parse(row.payload) as TelegramDeleteJobPayload).retainEntityState === true);
}
```

**Step 4: Update season sync behavior**

In `src/server/media/media.service.ts`, import `hasPendingRetainedTelegramDeleteJob`.

In `syncSeasonPostAfterContentChange()`:

```ts
const payload = buildSeasonPayload(postData);
const hasPendingRepostDelete = hasPendingRetainedTelegramDeleteJob(db, 'season', seasonId);

if (hasPendingRepostDelete) {
  if (payload) {
    upsertActiveTelegramSendJob(db, 'season', seasonId, payload);
  }
  return;
}
```

Place this after `hasLinkedEpisode(postData)` passes and before `cancelPendingTelegramDeleteJobs()` or the `telegramMessageId` edit branch.

**Step 5: Run test**

Run:

```bash
npm.cmd test -- tests/server/media.tv.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/server/media/media.service.ts src/server/telegram/telegram.queue.ts tests/server/media.tv.test.ts
git commit -m "fix: update pending repost send on content changes"
```

---

### Task 4: Handle Retained Delete Failure Without Losing Repost State

**Files:**
- Modify: `tests/server/telegram.queue.test.ts`
- Modify: `src/server/telegram/telegram.queue.ts`

**Step 1: Write failing test for permanent retained delete failure**

Add:

```ts
it('does not run repost send after retained delete permanently fails', async () => {
  const db = setupDb();
  createSeasonRow(db, 8);
  db.prepare("UPDATE seasons SET telegram_message_id = 456, post_status = 'posted' WHERE id = ?").run(8);

  enqueueTelegramJob(db, 'delete', 'season', 8, {
    messageId: 456,
    retainEntityState: true
  });
  enqueueTelegramJob(db, 'send', 'season', 8, {
    posterUrl: 'https://example.com/season.jpg',
    caption: 'Updated season'
  });

  const client = {
    sendPhotoPost: vi.fn(async () => ({ messageId: 999 })),
    editPhotoCaption: vi.fn(),
    deleteMessage: vi.fn(async () => {
      throw new Error('Message delete failed');
    })
  };

  await expect(processNextTelegramJob(db, client)).resolves.toBe(false);
  await expect(processNextTelegramJob(db, client)).resolves.toBe(false);

  expect(client.sendPhotoPost).not.toHaveBeenCalled();
  expect(getSeasonPostState(db, 8)).toEqual({
    telegram_message_id: 456,
    post_status: 'posted'
  });

  db.close();
});
```

**Step 2: Run test to verify behavior**

Run:

```bash
npm.cmd test -- tests/server/telegram.queue.test.ts
```

Expected: PASS after Tasks 1-2 if blocked send checks include failed retained delete as a blocker, or FAIL if failed retained delete no longer blocks. If it fails, adjust `hasBlockingRetainedDelete()` to also block send when a retained delete for the same entity has status `failed`.

**Step 3: Decide send cleanup policy**

If retained delete fails permanently, leave the pending send blocked and visible for diagnosis. Do not auto-send, because that would duplicate the channel post. Future manual retry can be added later if needed.

**Step 4: Commit if code changed**

```bash
git add src/server/telegram/telegram.queue.ts tests/server/telegram.queue.test.ts
git commit -m "test: cover retained repost delete failure"
```

---

### Task 5: Full Regression And Review

**Files:**
- No new files unless fixes above require them.

**Step 1: Run focused tests**

Run:

```bash
npm.cmd test -- tests/server/telegram.queue.test.ts tests/server/media.tv.test.ts tests/client/App.test.tsx
```

Expected: PASS.

**Step 2: Run type check**

Run:

```bash
npx.cmd tsc --noEmit
```

Expected: PASS.

**Step 3: Run full test suite**

Run:

```bash
npm.cmd test
```

Expected: PASS.

**Step 4: Run production build**

Run:

```bash
npm.cmd run build
```

Expected: PASS.

**Step 5: Request code review**

Use `$requesting-code-review` on the final diff. The review must specifically check:
- Delete retry does not allow duplicate sends.
- Retained delete success clears the stale old message ID.
- Content changes during pending repost update the pending send payload.
- Public search cannot point at a known-deleted old season message after retained delete success.

**Step 6: Commit final verification changes**

If Task 5 required additional fixes:

```bash
git add src/server/telegram/telegram.queue.ts src/server/media/media.service.ts tests/server/telegram.queue.test.ts tests/server/media.tv.test.ts
git commit -m "fix: harden season repost queue workflow"
```

---

## Notes

- Do not modify `apps/public-search-bot/.env.example`; it is currently deleted in the working tree from unrelated user/local changes.
- Keep the Season page UI from commit `08a6e14`; this plan fixes backend queue safety around that UI.
- Do not add a broad rate limiter in this plan. The goal is correctness of one repost workflow, not a general Telegram throughput redesign.

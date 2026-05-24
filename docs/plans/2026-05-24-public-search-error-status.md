# Public Search Error Status Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an errors-only status check so the local admin app can see whether the standalone VPS public search bot is reachable and whether it has recorded recent safe errors.

**Architecture:** The standalone VPS bot gets an in-memory error status tracker and a protected `GET /api/status` endpoint using a separate read-only `PUBLIC_SEARCH_STATUS_TOKEN`. The local admin backend proxies that endpoint with the status token kept server-side, and the Public Search page renders a compact status card with reachable/unreachable and latest safe error information.

**Tech Stack:** TypeScript, Express, React, Vitest, Supertest, Testing Library, Node fetch, systemd/journalctl documentation.

---

## Preconditions

- Work from `C:\Users\Batosai\Desktop\infinitylinks` on branch `codex/standalone-public-search-bot`.
- Approved spec: `docs/superpowers/specs/2026-05-24-public-search-bot-error-status-design.md`.
- Do not stage or commit `apps/public-search-bot/.env.example` while it contains local/live-looking secrets. Add environment examples to README or restore placeholders in a separate explicit cleanup.

## Task 1: Add Standalone Status Token Config

**Files:**
- Modify: `apps/public-search-bot/src/config.ts`
- Modify: `apps/public-search-bot/tests/public-search.config.test.ts`

**Step 1: Write failing config tests**

Add expectations that `PUBLIC_SEARCH_STATUS_TOKEN` is required, trimmed, and returned as `publicSearchStatusToken`.

Example test shape:

```ts
it('requires PUBLIC_SEARCH_STATUS_TOKEN', () => {
  expect(() =>
    loadPublicSearchConfig({
      PUBLIC_BOT_TOKEN: 'bot-token',
      PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token'
    })
  ).toThrow(/PUBLIC_SEARCH_STATUS_TOKEN is required/);
});
```

Update the default-value test input:

```ts
loadPublicSearchConfig({
  PUBLIC_BOT_TOKEN: ' bot-token ',
  PUBLIC_SEARCH_SYNC_TOKEN: ' sync-token ',
  PUBLIC_SEARCH_STATUS_TOKEN: ' status-token '
})
```

Expected output includes:

```ts
publicSearchStatusToken: 'status-token'
```

**Step 2: Run test to verify failure**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.config.test.ts
```

Expected: FAIL because `publicSearchStatusToken` does not exist and missing status token is not required yet.

**Step 3: Implement config**

In `apps/public-search-bot/src/config.ts`, add:

```ts
PUBLIC_SEARCH_STATUS_TOKEN: requiredSecret('PUBLIC_SEARCH_STATUS_TOKEN'),
```

Add to `PublicSearchConfig`:

```ts
publicSearchStatusToken: string;
```

Return:

```ts
publicSearchStatusToken: parsed.PUBLIC_SEARCH_STATUS_TOKEN,
```

**Step 4: Run test to verify pass**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.config.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/public-search-bot/src/config.ts apps/public-search-bot/tests/public-search.config.test.ts
git commit -m "feat: require public search status token"
```

## Task 2: Add Standalone Error Status Tracker

**Files:**
- Create: `apps/public-search-bot/src/status-tracker.ts`
- Create: `apps/public-search-bot/tests/public-search.status-tracker.test.ts`

**Step 1: Write failing tracker tests**

Cover these cases:

- new tracker returns `state: 'ok'`, `lastError: null`, and `consecutiveErrorCount: 0`
- recording an error returns `state: 'error'`, safe `source`, ISO `at`, sanitized one-line `message`, and count `1`
- recording another error increments `consecutiveErrorCount`
- clearing a matching source returns `state: 'ok'` and count `0`
- sanitization removes newlines and hides stack-like details

Example:

```ts
import { describe, expect, it } from 'vitest';
import { createPublicSearchStatusTracker } from '../src/status-tracker.js';

describe('public search status tracker', () => {
  it('starts in an ok state', () => {
    const tracker = createPublicSearchStatusTracker({ now: () => new Date('2026-05-24T12:00:00.000Z') });

    expect(tracker.snapshot()).toMatchObject({
      state: 'ok',
      consecutiveErrorCount: 0,
      lastError: null
    });
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.status-tracker.test.ts
```

Expected: FAIL because `status-tracker.ts` does not exist.

**Step 3: Implement tracker**

Create a small in-memory module:

```ts
export type PublicSearchErrorSource = 'startup' | 'telegram_poll' | 'sync' | 'status_api' | 'unknown';

export type PublicSearchStatusSnapshot = {
  state: 'ok' | 'error';
  checkedAt: string;
  uptimeSeconds: number;
  consecutiveErrorCount: number;
  lastError: {
    source: PublicSearchErrorSource;
    at: string;
    message: string;
  } | null;
};
```

Implementation rules:

- accept optional `now` and `uptimeSeconds` dependencies for tests
- `recordError(source, error)` stores sanitized message and increments count
- `clearError(source)` clears only when the latest error source matches, then resets count
- `snapshot()` returns only the safe fields above
- sanitize by using `error instanceof Error ? error.message : String(error)`, replacing whitespace with single spaces, and truncating to a small limit such as 240 chars

**Step 4: Run test to verify pass**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.status-tracker.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/public-search-bot/src/status-tracker.ts apps/public-search-bot/tests/public-search.status-tracker.test.ts
git commit -m "feat: add public search error status tracker"
```

## Task 3: Add Protected Standalone Status Endpoint

**Files:**
- Create: `apps/public-search-bot/src/status.routes.ts`
- Modify: `apps/public-search-bot/src/app.ts`
- Create: `apps/public-search-bot/tests/public-search.status-endpoint.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.sync-endpoint.test.ts` only if `createPublicSearchApp` options change test helpers

**Step 1: Write failing endpoint tests**

Use Supertest and the existing app test style.

Test cases:

- `GET /api/status` returns `401` without token
- `GET /api/status` returns `401` with wrong token
- `GET /api/status` returns safe OK JSON with correct token
- after `tracker.recordError('telegram_poll', new Error('Telegram failed\nstack line'))`, endpoint returns sanitized error JSON
- endpoint body does not contain strings like `provider`, `https://provider.example`, `stack`, or token values

Example setup:

```ts
const tracker = createPublicSearchStatusTracker({ now: () => new Date('2026-05-24T12:00:00.000Z') });
const app = createPublicSearchApp({ db, config: createConfig(), statusTracker: tracker });
```

**Step 2: Run test to verify failure**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.status-endpoint.test.ts
```

Expected: FAIL because the route and app option do not exist.

**Step 3: Implement status route**

Create `createPublicSearchStatusRouter(config, statusTracker)`:

```ts
router.get('/status', (req, res) => {
  const token = extractBearerToken(req.header('authorization'));
  if (token !== config.publicSearchStatusToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json(statusTracker.snapshot());
});
```

Reuse or duplicate the small bearer-token helper locally. Keep it simple.

Modify `createPublicSearchApp` options to accept:

```ts
statusTracker?: PublicSearchStatusTracker;
```

If omitted, create a default tracker inside `createPublicSearchApp` for tests that do not care.

Mount before the sync router:

```ts
app.use('/api', createPublicSearchStatusRouter(options.config, statusTracker));
```

**Step 4: Run tests to verify pass**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.status-endpoint.test.ts tests/public-search.sync-endpoint.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/public-search-bot/src/app.ts apps/public-search-bot/src/status.routes.ts apps/public-search-bot/tests/public-search.status-endpoint.test.ts apps/public-search-bot/tests/public-search.sync-endpoint.test.ts
git commit -m "feat: expose public search status endpoint"
```

## Task 4: Record Standalone Sync And Poll Errors

**Files:**
- Modify: `apps/public-search-bot/src/sync.routes.ts`
- Modify: `apps/public-search-bot/src/app.ts`
- Modify: `apps/public-search-bot/src/index.ts`
- Modify: `apps/public-search-bot/tests/public-search.sync-endpoint.test.ts`

**Step 1: Write failing sync error tests**

In `public-search.sync-endpoint.test.ts`, add tests using an injected tracker:

- invalid sync payload records `sync` error
- valid sync clears the latest `sync` error
- unauthorized requests do not record runtime errors

Example assertion:

```ts
expect(tracker.snapshot()).toMatchObject({
  state: 'error',
  lastError: expect.objectContaining({ source: 'sync' })
});
```

**Step 2: Run sync tests to verify failure**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.sync-endpoint.test.ts
```

Expected: FAIL because sync route does not record/clear tracker state.

**Step 3: Implement sync tracking**

Change `createPublicSearchSyncRouter` to accept `statusTracker`.

Inside the authenticated and rate-limit-passed handler:

```ts
try {
  const catalog = PublicSearchCatalogSchema.parse(req.body);
  const counts = replacePublicCatalog(db, catalog);
  statusTracker.clearError('sync');
  res.json({ sync: counts });
} catch (error) {
  statusTracker.recordError('sync', error);
  throw error;
}
```

Do not record `401` token failures or `429` quota failures as bot runtime errors.

In `index.ts`, create one tracker and pass it to `createPublicSearchApp`.

In the polling loop:

```ts
try {
  await pollOnce(...);
  statusTracker.clearError('telegram_poll');
} catch (error) {
  statusTracker.recordError('telegram_poll', error);
  console.error('Public search polling failed', error);
  await delay(1_000);
}
```

In `main().catch`, keep `console.error`. Startup failures usually cannot be exposed over HTTP because the process did not start.

**Step 4: Run focused standalone tests**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- tests/public-search.status-tracker.test.ts tests/public-search.status-endpoint.test.ts tests/public-search.sync-endpoint.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/public-search-bot/src/app.ts apps/public-search-bot/src/index.ts apps/public-search-bot/src/sync.routes.ts apps/public-search-bot/tests/public-search.sync-endpoint.test.ts
git commit -m "feat: record public search runtime errors"
```

## Task 5: Add Local Admin Status Config And Service

**Files:**
- Modify: `src/server/config.ts`
- Modify: `tests/server/config.test.ts`
- Create: `src/server/public-search/status.service.ts`
- Create: `tests/public-search/public-search.status-route.test.ts`
- Modify: `src/server/public-search/public-search.routes.ts`

**Step 1: Write failing config tests**

Update `tests/server/config.test.ts` to accept:

```ts
PUBLIC_SEARCH_STATUS_URL: 'https://search.example.com/api/status',
PUBLIC_SEARCH_STATUS_TOKEN: 'status-token'
```

Expected config fields:

```ts
publicSearchStatusUrl: 'https://search.example.com/api/status',
publicSearchStatusToken: 'status-token'
```

Also extend the blank optional values test to prove blanks become `undefined`.

**Step 2: Run config test to verify failure**

Run:

```bash
npm.cmd test -- tests/server/config.test.ts
```

Expected: FAIL because fields are not in config.

**Step 3: Implement local config**

Add optional env fields to `EnvSchema`:

```ts
PUBLIC_SEARCH_STATUS_URL: OptionalTrimmedString,
PUBLIC_SEARCH_STATUS_TOKEN: OptionalTrimmedString,
```

Add optional `AppConfig` fields and return them from `loadConfig`.

**Step 4: Write failing route/service tests**

In `tests/public-search/public-search.status-route.test.ts`, cover:

- returns `{ reachable: false, error: 'Public search status is not configured' }` with HTTP `400` when URL/token missing
- calls configured URL with `Authorization: Bearer status-token`
- returns reachable status body from VPS and includes `lastSuccessfulCheckAt`
- does not expose `status-token` in response JSON
- returns safe unreachable status with HTTP `502` when fetch rejects or VPS returns non-OK

**Step 5: Run route tests to verify failure**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.status-route.test.ts
```

Expected: FAIL because route/service do not exist.

**Step 6: Implement status service and route**

Create `checkPublicSearchStatus(config, fetcher)` in `status.service.ts`.

Rules:

- require both `publicSearchStatusUrl` and `publicSearchStatusToken`
- call remote URL with `GET` and bearer token
- parse JSON only on `response.ok`
- keep a module-level `lastSuccessfulCheckAt: string | null`
- on success return:

```ts
{
  reachable: true,
  lastSuccessfulCheckAt,
  remote
}
```

- on fetch failure or non-OK remote response, throw a typed `PublicSearchStatusError` with safe message and status code
- do not include remote token, raw stack, or fetch internals

Update `createPublicSearchRouter`:

```ts
router.get('/public-search/status', async (_req, res, next) => {
  try {
    const result = await checkPublicSearchStatus(config, fetcher);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
```

If route tests expect unreachable JSON instead of the global `{ error }` shape, handle `PublicSearchStatusError` inside the route and send:

```ts
res.status(error.statusCode).json({
  reachable: false,
  lastSuccessfulCheckAt: error.lastSuccessfulCheckAt,
  error: error.message
});
```

**Step 7: Run tests to verify pass**

Run:

```bash
npm.cmd test -- tests/server/config.test.ts tests/public-search/public-search.status-route.test.ts tests/public-search/public-search.sync-route.test.ts
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/server/config.ts src/server/public-search/public-search.routes.ts src/server/public-search/status.service.ts tests/server/config.test.ts tests/public-search/public-search.status-route.test.ts
git commit -m "feat: proxy public search status checks"
```

## Task 6: Add Public Search Status Card In Local UI

**Files:**
- Modify: `src/client/pages/PublicSearchPage.tsx`
- Modify: `src/client/styles.css`
- Modify: `tests/client/App.test.tsx`

**Step 1: Write failing client tests**

Add tests near the existing Public Search tests:

- Public Search page shows a `Check Bot Status` button
- clicking it calls `/api/public-search/status`
- reachable OK response renders reachable, last successful check time, and `OK`
- reachable remote error renders `ERROR`, source, time, and message
- unreachable response renders safe unreachable message

Example response:

```ts
{
  reachable: true,
  lastSuccessfulCheckAt: '2026-05-24T12:10:00.000Z',
  remote: {
    state: 'error',
    checkedAt: '2026-05-24T12:09:30.000Z',
    uptimeSeconds: 120,
    consecutiveErrorCount: 2,
    lastError: {
      source: 'telegram_poll',
      at: '2026-05-24T12:09:00.000Z',
      message: 'Telegram request failed'
    }
  }
}
```

**Step 2: Run client tests to verify failure**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: FAIL because the button/card does not exist.

**Step 3: Implement UI**

In `PublicSearchPage.tsx`:

- import an appropriate lucide icon such as `Activity`
- add status response types
- add state: `statusResult`, `isCheckingStatus`, `statusError`
- add `checkPublicSearchStatus()`
- render a second panel below or beside sync:
  - button label: `Check Bot Status`
  - reachable/unreachable
  - last successful check time
  - bot state `OK` or `ERROR`
  - source/time/message only when `lastError` exists

Keep the panel compact and operational. Do not add explanatory marketing text.

In `styles.css`, reuse `.sync-panel` where possible and add small modifiers only if needed:

```css
.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border-radius: 6px;
  padding: 4px 8px;
  font-weight: 750;
}
```

Use distinct colors for OK and error, without making a one-note palette.

**Step 4: Run client tests to verify pass**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/client/pages/PublicSearchPage.tsx src/client/styles.css tests/client/App.test.tsx
git commit -m "feat: show public search bot status"
```

## Task 7: Update Deployment Documentation

**Files:**
- Modify: `apps/public-search-bot/README.md`
- Modify: `README.md`

**Step 1: Add status-token docs**

In `apps/public-search-bot/README.md`, add:

- `PUBLIC_SEARCH_STATUS_TOKEN` to the standalone environment table/block
- explain it is read-only and separate from `PUBLIC_SEARCH_SYNC_TOKEN`
- show a safe status test:

```bash
curl -H "Authorization: Bearer $PUBLIC_SEARCH_STATUS_TOKEN" http://127.0.0.1:3001/api/status
```

- show full logs from local machine:

```bash
ssh root@your-vps-ip "journalctl -u public-search-bot -n 100 --no-pager"
ssh root@your-vps-ip "journalctl -u public-search-bot -f"
```

In root `README.md`, document local admin variables:

```text
PUBLIC_SEARCH_STATUS_URL=https://your-vps-domain.example/api/status
PUBLIC_SEARCH_STATUS_TOKEN=replace-with-read-only-status-token
```

Clarify that the local admin status panel shows safe error status only; full logs stay in systemd on the VPS.

**Step 2: Review docs manually**

Run:

```bash
rg -n "PUBLIC_SEARCH_STATUS|journalctl|status" README.md apps/public-search-bot/README.md
```

Expected: docs mention both status variables and journalctl commands.

**Step 3: Commit**

```bash
git add README.md apps/public-search-bot/README.md
git commit -m "docs: document public search status checks"
```

## Task 8: Final Verification

**Files:**
- No code edits unless verification finds a defect.

**Step 1: Run standalone tests**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test
```

Expected: all standalone tests PASS.

**Step 2: Run root tests**

Run:

```bash
npm.cmd test
```

Expected: all root tests PASS.

**Step 3: Run standalone build**

Run:

```bash
npm.cmd --prefix apps/public-search-bot run build
```

Expected: build PASS.

**Step 4: Run root build**

Run:

```bash
npm.cmd run build
```

Expected: build PASS.

**Step 5: Confirm git state**

Run:

```bash
git status --short --branch
```

Expected: only intentional changes remain. If `apps/public-search-bot/.env.example` is still dirty from pre-existing local secret work, do not stage it.

**Step 6: Final summary**

Report:

- commits created
- tests/builds run
- reminder that full VPS logs are still checked with `journalctl`
- reminder that `.env.example` local secret changes were not staged

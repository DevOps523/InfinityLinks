# Security Findings Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the validated security findings from the 2026-05-27 repository-wide security scan.

**Architecture:** Keep the fixes small and defense-oriented: tighten trust-boundary validation at server entrypoints, enforce safe URL schemes at the data boundary, restrict subscription-gated bot output to authorized recipients, and harden deployment defaults. Prefer server-side controls first, then mirror useful client/docs guardrails.

**Tech Stack:** TypeScript, Express, React, Zod, Vitest, Supertest, Google Apps Script, systemd, Nginx deployment docs.

---

## Notes For The Implementer

- Work in a dedicated branch/worktree, for example `codex/security-findings-remediation`.
- Use TDD for behavior changes. Write the failing regression test first, run it, then implement the smallest fix.
- Keep each task commit-sized. Do not combine unrelated findings into one commit.
- Do not commit real `.env`, SQLite files, service account JSON, `dist/`, or `node_modules/`.
- Online `npm audit` requires explicit approval because it sends dependency metadata to npm. Use only offline audit unless the user approves that network disclosure.

### Task 1: Block DNS Rebinding Against The Local Admin API

**Files:**
- Modify: `src/server/security/api-request-guard.ts`
- Modify: `src/server/app.ts`
- Test: `tests/server/app.test.ts`

**Step 1: Write the failing DNS-rebinding regression test**

Add this test under `describe('admin API request guard', ...)` in `tests/server/app.test.ts`:

```ts
it('rejects same-origin browser API requests when Host is not loopback', async () => {
  const db = createGuardDb();

  try {
    const guardedApp = createApp({ db, config: guardConfig, fetcher: vi.fn<typeof fetch>() });

    const response = await request(guardedApp)
      .post('/api/tv-shows')
      .set('Host', 'evil.example:3000')
      .set('Origin', 'http://evil.example:3000')
      .set('Sec-Fetch-Site', 'same-origin')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({
        title: 'Injected Show',
        quality: 'HD'
      })
      .expect(403);

    expect(response.body).toEqual({ error: 'Cross-site request blocked' });
  } finally {
    db.close();
  }
});
```

**Step 2: Run the targeted test and verify it fails**

Run:

```bash
npm.cmd test -- tests/server/app.test.ts
```

Expected: FAIL because the current guard treats `Origin` and `Host` as same-origin when both use `evil.example:3000`.

**Step 3: Implement a loopback Host/Origin allowlist**

In `src/server/security/api-request-guard.ts`, add a small parser and options object:

```ts
type AdminApiRequestGuardOptions = {
  allowedHosts?: string[];
};

function normalizeHost(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.trim().toLowerCase();
}

function getAllowedHosts(options: AdminApiRequestGuardOptions) {
  return new Set((options.allowedHosts ?? []).map((host) => host.toLowerCase()));
}

function hasAllowedHost(req: Request, allowedHosts: Set<string>) {
  if (allowedHosts.size === 0) {
    return true;
  }

  const host = normalizeHost(req.get('host'));
  return Boolean(host && allowedHosts.has(host));
}
```

Update `createAdminApiRequestGuard`:

```ts
export function createAdminApiRequestGuard(options: AdminApiRequestGuardOptions = {}) {
  const allowedHosts = getAllowedHosts(options);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!hasAllowedHost(req, allowedHosts)) {
      res.status(403).json({ error: 'Cross-site request blocked' });
      return;
    }

    // Existing browser provenance, cross-site, and mutating-header checks stay below.
  };
}
```

In `src/server/app.ts`, pass exact loopback host values derived from config:

```ts
const adminPort = options.config?.port;
const allowedHosts =
  adminPort === undefined
    ? undefined
    : [`127.0.0.1:${adminPort}`, `localhost:${adminPort}`, `[::1]:${adminPort}`];

app.use('/api', createAdminApiRequestGuard({ allowedHosts }));
```

Keep `/api/health` before the guard as it is today.

**Step 4: Run targeted tests**

Run:

```bash
npm.cmd test -- tests/server/app.test.ts tests/server/config.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/security/api-request-guard.ts src/server/app.ts tests/server/app.test.ts
git commit -m "fix: reject non-loopback admin api hosts"
```

### Task 2: Reject Unsafe Provider URL Schemes

**Files:**
- Modify: `src/server/media/media.schemas.ts`
- Modify: `apps/public-search-bot/src/catalog.schema.ts`
- Test: `tests/server/media.schemas.test.ts`
- Test: `apps/public-search-bot/tests/public-search.sync-endpoint.test.ts`

**Step 1: Write failing media schema tests**

Add tests to `tests/server/media.schemas.test.ts`:

```ts
it('rejects non-http movie provider URLs', () => {
  expect(() =>
    MovieInputSchema.parse({
      title: 'Movie',
      quality: 'HD',
      links: [
        {
          providerName: 'Provider',
          quality: 'HD',
          status: 'active',
          url: 'javascript:alert(1)'
        }
      ]
    })
  ).toThrow(/URL must use http or https/);
});

it('rejects non-http TV poster URLs', () => {
  expect(() =>
    TvShowInputSchema.parse({
      title: 'Show',
      quality: 'HD',
      posterUrl: 'data:text/html,<h1>x</h1>'
    })
  ).toThrow(/URL must use http or https/);
});
```

**Step 2: Write failing public catalog sync test**

Add a sync endpoint test near the invalid payload tests in `apps/public-search-bot/tests/public-search.sync-endpoint.test.ts`:

```ts
it('rejects non-http provider URLs in synced catalogs', async () => {
  const db = createMigratedDatabase();

  try {
    const tracker = createTracker();
    const app = createPublicSearchApp({ db, config: createConfig(), statusTracker: tracker });
    const catalog = validCatalog();
    catalog.movies[0].providers[0].url = 'javascript:alert(1)';

    const response = await request(app)
      .post('/api/sync')
      .set('Authorization', 'Bearer sync-token')
      .send(catalog)
      .expect(400);

    expect(response.body.error).toBe('Validation failed');
    expect(JSON.stringify(response.body)).toContain('URL must use http or https');
  } finally {
    db.close();
  }
});
```

**Step 3: Run tests and verify failure**

Run:

```bash
npm.cmd test -- tests/server/media.schemas.test.ts apps/public-search-bot/tests/public-search.sync-endpoint.test.ts
```

Expected: FAIL because `z.string().url()` accepts `javascript:` and `data:` schemes.

**Step 4: Implement reusable HTTP URL schemas**

In `src/server/media/media.schemas.ts`, add:

```ts
const HttpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'URL must use http or https');
```

Then update:

```ts
url: HttpUrlSchema
posterUrl: z.union([HttpUrlSchema, z.literal('')]).optional()
```

In `apps/public-search-bot/src/catalog.schema.ts`, add the same `HttpUrlSchema` and update:

```ts
url: HttpUrlSchema
channelPostUrl: HttpUrlSchema.optional()
```

**Step 5: Run targeted tests**

Run:

```bash
npm.cmd test -- tests/server/media.schemas.test.ts apps/public-search-bot/tests/public-search.sync-endpoint.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/server/media/media.schemas.ts apps/public-search-bot/src/catalog.schema.ts tests/server/media.schemas.test.ts apps/public-search-bot/tests/public-search.sync-endpoint.test.ts
git commit -m "fix: require http urls for media links"
```

### Task 3: Add Client-Side URL Scheme Guardrails

**Files:**
- Modify: `src/client/components/LinkEditorModal.tsx`
- Modify: `src/client/pages/MovieForm.tsx`
- Test: `tests/client/App.test.tsx` or create focused component tests if current patterns support it

**Step 1: Write a failing UI validation test**

If `tests/client/App.test.tsx` already mounts the app flow, add a test that attempts to save a link with `javascript:alert(1)` and expects a validation message before any API call. If a component-level test is cleaner, create `tests/client/LinkEditorModal.test.tsx`.

Expected assertion:

```ts
expect(screen.getByText('URLs must start with http:// or https://.')).toBeInTheDocument();
```

**Step 2: Run the failing client test**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

or:

```bash
npm.cmd test -- tests/client/LinkEditorModal.test.tsx
```

Expected: FAIL until the UI validates schemes.

**Step 3: Implement a tiny client helper**

In `src/client/components/LinkEditorModal.tsx`, add:

```ts
function isHttpUrl(value: string) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
```

In `handleSave`, after the partial-link check:

```ts
if (nonEmptyLinks.some((link) => !isHttpUrl(link.url.trim()))) {
  setError('URLs must start with http:// or https://.');
  return;
}
```

In `src/client/pages/MovieForm.tsx`, apply the same check to `posterUrl` before submit, because the server will now reject non-http poster URLs:

```ts
if (posterUrl.trim() && !isHttpUrl(posterUrl.trim())) {
  setError('Poster URL must start with http:// or https://.');
  setIsSaving(false);
  return;
}
```

**Step 4: Run client tests**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/client/components/LinkEditorModal.tsx src/client/pages/MovieForm.tsx tests/client
git commit -m "fix: validate media urls in the admin ui"
```

### Task 4: Keep Subscription-Gated Bot Results In Private Chats

**Files:**
- Modify: `apps/public-search-bot/src/bot/formatter.ts`
- Modify: `apps/public-search-bot/src/bot/handlers.ts`
- Test: `apps/public-search-bot/tests/public-search.handlers.test.ts`

**Step 1: Update test helpers to model private chats**

In `apps/public-search-bot/tests/public-search.handlers.test.ts`, update `messageUpdate` and `callbackUpdate` defaults:

```ts
chat: { id: 500, type: 'private' }
```

This preserves the current happy-path tests after the fix.

**Step 2: Write failing group leak tests**

Add these tests:

```ts
it('does not send provider links into group chats from /search', async () => {
  const db = createMigratedDatabase();

  try {
    seedCatalog(db);
    const { deps, sentMessages } = createDeps(db);

    await handleTelegramUpdate(
      deps,
      messageUpdate('/search inception', {
        chat: { id: -100500, type: 'group' },
        from: { id: 42, username: 'paid_user' }
      })
    );

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].chatId).toBe(-100500);
    expect(sentMessages[0].text).toBe('Open a private chat with this bot to view download links.');
    expect(JSON.stringify(sentMessages)).not.toContain('providers.example');
  } finally {
    db.close();
  }
});

it('does not send season provider links into group chats from callbacks', async () => {
  const db = createMigratedDatabase();

  try {
    seedCatalog(db);
    const { deps, sentMessages, callbackAnswers } = createDeps(db);

    await handleTelegramUpdate(
      deps,
      callbackUpdate('season:30', {
        message: {
          message_id: 11,
          chat: { id: -100500, type: 'group' }
        },
        from: { id: 42, username: 'paid_user' }
      })
    );

    expect(callbackAnswers).toEqual([
      {
        callbackQueryId: 'callback-1',
        text: 'Open a private chat with this bot to view download links.'
      }
    ]);
    expect(sentMessages).toEqual([]);
  } finally {
    db.close();
  }
});
```

**Step 3: Run the failing test**

Run:

```bash
npm.cmd test -- apps/public-search-bot/tests/public-search.handlers.test.ts
```

Expected: FAIL because current handlers send link-bearing responses to any chat.

**Step 4: Implement private-chat checks**

In `apps/public-search-bot/src/bot/formatter.ts`, add:

```ts
export function formatPrivateChatRequiredMessage(): PublicBotMessage {
  return {
    text: 'Open a private chat with this bot to view download links.'
  };
}
```

In `apps/public-search-bot/src/bot/handlers.ts`, import it and add:

```ts
function isPrivateChat(chat: { type?: string } | undefined) {
  return chat?.type === 'private';
}
```

Before `handleSearch(...)` in the `/search` command branch:

```ts
if (!isPrivateChat(message.chat)) {
  await sendBotMessage(deps, message.chat.id, formatPrivateChatRequiredMessage());
  return;
}
```

Before resolving callback season details:

```ts
if (!isPrivateChat(callbackQuery.message?.chat)) {
  await deps.replies.enqueueAnswerCallbackQuery({
    callbackQueryId,
    text: formatPrivateChatRequiredMessage().text
  });
  return;
}
```

Keep `/start`, `/clear`, invalid search help, rate-limit messages, and subscription-required messages safe for non-private chats because they do not include provider links.

**Step 5: Run targeted tests**

Run:

```bash
npm.cmd test -- apps/public-search-bot/tests/public-search.handlers.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/public-search-bot/src/bot/formatter.ts apps/public-search-bot/src/bot/handlers.ts apps/public-search-bot/tests/public-search.handlers.test.ts
git commit -m "fix: keep bot download links in private chats"
```

### Task 5: Enforce Loopback Binding For The Standalone Bot

**Files:**
- Modify: `apps/public-search-bot/src/config.ts`
- Test: `apps/public-search-bot/tests/public-search.config.test.ts`

**Step 1: Change the existing acceptance test**

In `apps/public-search-bot/tests/public-search.config.test.ts`, change the test that currently accepts `PUBLIC_SEARCH_HOST: '0.0.0.0'` so it uses `localhost` as the explicit accepted value.

Add a new rejection test:

```ts
it('rejects non-loopback public search host values', () => {
  for (const host of ['0.0.0.0', '192.168.1.10', 'example.com']) {
    expect(() =>
      loadPublicSearchConfig({
        ...subscriptionEnv,
        PUBLIC_BOT_TOKEN: 'bot-token',
        PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
        PUBLIC_SEARCH_STATUS_TOKEN: 'status-token',
        PUBLIC_SEARCH_HOST: host
      })
    ).toThrow(/PUBLIC_SEARCH_HOST must be a localhost address/);
  }
});
```

**Step 2: Run and verify failure**

Run:

```bash
npm.cmd test -- apps/public-search-bot/tests/public-search.config.test.ts
```

Expected: FAIL until config rejects public bind addresses.

**Step 3: Implement the host refinement**

In `apps/public-search-bot/src/config.ts`, update the `PUBLIC_SEARCH_HOST` schema:

```ts
PUBLIC_SEARCH_HOST: trimmedStringWithDefault('127.0.0.1').refine(
  (host) => ['127.0.0.1', 'localhost', '::1'].includes(host),
  {
    message: 'PUBLIC_SEARCH_HOST must be a localhost address'
  }
),
```

**Step 4: Run targeted tests**

Run:

```bash
npm.cmd test -- apps/public-search-bot/tests/public-search.config.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/public-search-bot/src/config.ts apps/public-search-bot/tests/public-search.config.test.ts
git commit -m "fix: require loopback host for public bot service"
```

### Task 6: Require HTTPS For Token-Bearing Outbound URLs

**Files:**
- Modify: `src/server/config.ts`
- Modify: `apps/public-search-bot/google-apps-script/Code.gs`
- Test: `tests/server/config.test.ts`

**Step 1: Write failing root config tests**

Add tests to `tests/server/config.test.ts`:

```ts
it('requires https public search sync and status URLs', () => {
  const baseEnv = {
    TMDB_API_KEY: 'tmdb-key',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHANNEL_ID: '@channel'
  };

  expect(() =>
    loadConfig({
      ...baseEnv,
      PUBLIC_SEARCH_SYNC_URL: 'http://public.example/api/sync',
      PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token'
    })
  ).toThrow(/PUBLIC_SEARCH_SYNC_URL must use https/);

  expect(() =>
    loadConfig({
      ...baseEnv,
      PUBLIC_SEARCH_STATUS_URL: 'http://public.example/api/status',
      PUBLIC_SEARCH_STATUS_TOKEN: 'status-token'
    })
  ).toThrow(/PUBLIC_SEARCH_STATUS_URL must use https/);
});
```

**Step 2: Run and verify failure**

Run:

```bash
npm.cmd test -- tests/server/config.test.ts
```

Expected: FAIL because URLs are currently plain trimmed strings.

**Step 3: Implement HTTPS URL schema helpers**

In `src/server/config.ts`, add:

```ts
function httpsUrl(name: string) {
  return z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .trim()
      .url()
      .refine((value) => new URL(value).protocol === 'https:', {
        message: `${name} must use https`
      })
      .optional()
  );
}
```

Update env schema:

```ts
PUBLIC_SEARCH_SYNC_URL: httpsUrl('PUBLIC_SEARCH_SYNC_URL'),
PUBLIC_SEARCH_STATUS_URL: httpsUrl('PUBLIC_SEARCH_STATUS_URL'),
```

Leave blank values as `undefined`.

**Step 4: Add Apps Script base URL validation**

In `apps/public-search-bot/google-apps-script/Code.gs`, after loading `baseUrl`:

```js
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error('SUBSCRIPTION_API_BASE_URL must use https.');
  }
```

Use a clear error. Apps Script is production-facing and should not allow localhost exceptions.

**Step 5: Run targeted tests**

Run:

```bash
npm.cmd test -- tests/server/config.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/server/config.ts tests/server/config.test.ts apps/public-search-bot/google-apps-script/Code.gs
git commit -m "fix: require https for token-bearing endpoints"
```

### Task 7: Document Safe Deployment Copy Commands

**Files:**
- Modify: `apps/public-search-bot/README.md`

**Step 1: Replace the risky recursive copy example**

In `apps/public-search-bot/README.md`, replace the risky `scp -r` upload example with:

```bash
rsync -av --delete \
  --include '.env.example' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'google-service-account.json' \
  --exclude 'data/' \
  --exclude 'dist/' \
  --exclude 'node_modules/' \
  apps/public-search-bot/ root@your-vps-ip:/opt/infinitylinks-public-search-bot/
```

Add one sentence: `Create the production .env and Google service account JSON directly on the VPS; do not copy local secrets or local databases.`

**Step 2: Search docs for remaining unsafe copy guidance**

Run:

```bash
rg -n "scp -r\\s+apps/public-search-bot|google-service-account.json|node_modules|\\.env" apps/public-search-bot/README.md README.md docs
```

Expected: no remaining recommendation to recursively copy the full app directory without excludes.

**Step 3: Commit**

```bash
git add apps/public-search-bot/README.md
git commit -m "docs: exclude local secrets from bot deployment copy"
```

### Task 8: Harden The systemd Service Example

**Files:**
- Modify: `apps/public-search-bot/deploy/public-search-bot.service.example`
- Modify: `apps/public-search-bot/README.md`

**Step 1: Add service sandboxing directives**

In `[Service]`, add:

```ini
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/infinitylinks-public-search-bot/data
```

Keep `WorkingDirectory`, `EnvironmentFile`, `ExecStart`, `User`, and `Group`.

**Step 2: Add README note for writable paths**

Near the systemd setup docs, add:

```md
The example service uses `ProtectSystem=strict`, so only the SQLite data directory is writable by the app. If you place the database somewhere else, update `ReadWritePaths` to match.
```

**Step 3: Check the service file**

Run:

```bash
rg -n "NoNewPrivileges|PrivateTmp|ProtectSystem|ProtectHome|ReadWritePaths" apps/public-search-bot/deploy/public-search-bot.service.example
```

Expected: every hardening directive is present.

**Step 4: Commit**

```bash
git add apps/public-search-bot/deploy/public-search-bot.service.example apps/public-search-bot/README.md
git commit -m "docs: harden public bot systemd example"
```

### Task 9: Run Full Regression And Build Checks

**Files:**
- No source edits expected.

**Step 1: Run root tests**

Run:

```bash
npm.cmd test
```

Expected: PASS.

**Step 2: Run standalone bot tests**

Run:

```bash
npm.cmd run standalone-public-search:test
```

Expected: PASS.

**Step 3: Run root build**

Run:

```bash
npm.cmd run build
```

Expected: PASS.

**Step 4: Run standalone bot build**

Run:

```bash
npm.cmd run standalone-public-search:build
```

Expected: PASS.

**Step 5: Run offline audits**

Run:

```bash
npm.cmd audit --offline --json
npm.cmd --prefix apps/public-search-bot audit --offline --json
```

Expected: zero known vulnerabilities from local audit cache. Record if the local cache is stale or empty.

**Step 6: Commit any verification-only doc updates if needed**

Only commit if a verification note was intentionally added:

```bash
git add docs/plans/2026-05-27-security-findings-remediation.md
git commit -m "docs: record security remediation verification"
```

### Task 10: Final Security Review Pass

**Files:**
- Inspect changed files only.

**Step 1: Confirm findings are closed**

Run:

```bash
rg -n "z\\.string\\(\\)\\.url\\(\\)|PUBLIC_SEARCH_HOST|createAdminApiRequestGuard|message\\.chat\\.id|SUBSCRIPTION_API_BASE_URL|scp -r\\s+apps/public-search-bot" src apps tests README.md docs
```

Expected:
- Remaining `z.string().url()` instances are either wrapped by an HTTP/HTTPS protocol refinement or are intentionally non-token/non-clickable.
- `PUBLIC_SEARCH_HOST` rejects non-loopback values.
- Admin guard receives an allowed-host list.
- Bot handlers do not send provider links to group chats.
- Apps Script enforces HTTPS.
- Recursive copy docs are removed or replaced with excludes.

**Step 2: Manually re-run the original exploit sketches**

Check these cases:

```text
DNS rebinding sketch: Host evil.example:3000 plus same Origin returns 403.
Stored XSS sketch: javascript:alert(1) in provider URL returns validation error.
Bot group leak sketch: /search in a group returns private-chat-required text and no provider URLs.
Public bind sketch: PUBLIC_SEARCH_HOST=0.0.0.0 throws config validation error.
Plain HTTP token endpoint sketch: PUBLIC_SEARCH_SYNC_URL=http://... throws config validation error.
```

**Step 3: Commit final cleanup if needed**

```bash
git add <only changed files>
git commit -m "test: cover security remediation regressions"
```

Do this only if Task 10 produced additional test or cleanup changes.

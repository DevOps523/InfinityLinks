# Security Findings Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three approved low-severity security findings with focused code, test, and deployment-documentation changes.

**Architecture:** Keep the existing Express admin API guard as the single `/api` request boundary, but require the local admin request header for every mutating method before route handlers run. Keep public-search bot environment validation in Zod, adding the missing status/admin token separation refinement. Update deployment guidance and the systemd unit to use a dedicated `infinitylinks` service identity instead of the shared `www-data` identity.

**Tech Stack:** TypeScript, Express, Zod, Vitest, Supertest, npm scripts, systemd, Markdown deployment docs.

---

## File Structure

- Modify `tests/server/app.test.ts`: add a regression test for no-provenance mutating admin API requests.
- Modify `src/server/security/api-request-guard.ts`: require `X-InfinityLinks-Request: fetch` for all mutating API methods.
- Modify `apps/public-search-bot/tests/public-search.config.test.ts`: add a regression test for `SUBSCRIPTION_ADMIN_TOKEN` equal to `PUBLIC_SEARCH_STATUS_TOKEN`.
- Modify `apps/public-search-bot/src/config.ts`: add the missing Zod refinement for status/admin token separation.
- Modify `apps/public-search-bot/README.md`: document the dedicated `infinitylinks` user/group, data ownership, secret ownership, and systemd values.
- Modify `apps/public-search-bot/deploy/public-search-bot.service.example`: run the app service as `infinitylinks:infinitylinks`.
- Do not stage or edit `apps/public-search-bot/google-apps-script/Code.gs`; it is an existing unrelated working-tree change.

## Tasks

### Task 1: Admin API Guard

**Files:**
- Modify: `tests/server/app.test.ts`
- Modify: `src/server/security/api-request-guard.ts`

- [ ] **Step 1: Write the failing no-provenance POST regression test**

In `tests/server/app.test.ts`, insert this test inside the `describe('admin API request guard', () => {` block, immediately after the existing `rejects cross-site browser POSTs before bodyless sync work runs` test:

```ts
  it('rejects bodyless mutating requests without browser provenance before sync work runs', async () => {
    const db = createGuardDb();
    const fetchMock = vi.fn<typeof fetch>();

    try {
      const guardedApp = createApp({ db, config: guardConfig, fetcher: fetchMock });

      const response = await request(guardedApp)
        .post('/api/public-search/sync')
        .set('Host', '127.0.0.1:3000')
        .expect(403);

      expect(response.body).toEqual({ error: 'Cross-site request blocked' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 2: Run the targeted failing test**

Run:

```bash
npm.cmd test -- tests/server/app.test.ts -t "rejects bodyless mutating requests without browser provenance before sync work runs"
```

Expected: FAIL because the current guard lets a mutating request with no `Origin`, no `Sec-Fetch-Site`, and no `X-InfinityLinks-Request` continue past the guard.

- [ ] **Step 3: Implement the minimal admin guard change**

In `src/server/security/api-request-guard.ts`, replace the middleware body returned by `createAdminApiRequestGuard` with this version:

```ts
  return (req: Request, res: Response, next: NextFunction) => {
    const host = normalizeHost(req.get('host')) ?? '';

    if (allowedHosts && !allowedHosts.has(host)) {
      res.status(403).json(CROSS_SITE_BLOCKED_RESPONSE);
      return;
    }

    if (MUTATING_METHODS.has(req.method) && req.get(ADMIN_REQUEST_HEADER) !== ADMIN_REQUEST_VALUE) {
      res.status(403).json(CROSS_SITE_BLOCKED_RESPONSE);
      return;
    }

    if (hasBrowserProvenance(req) && isCrossSite(req)) {
      res.status(403).json(CROSS_SITE_BLOCKED_RESPONSE);
      return;
    }

    next();
  };
```

- [ ] **Step 4: Run the admin guard test file**

Run:

```bash
npm.cmd test -- tests/server/app.test.ts
```

Expected: PASS. Existing same-origin API-style requests with `X-InfinityLinks-Request: fetch` still reach route handlers, while the new no-provenance POST regression is rejected.

- [ ] **Step 5: Commit the admin guard change**

Run:

```bash
git add tests/server/app.test.ts src/server/security/api-request-guard.ts
git commit -m "fix: require admin request header for mutations"
```

Expected: Commit contains only the admin guard test and implementation files.

### Task 2: Public Bot Token Separation

**Files:**
- Modify: `apps/public-search-bot/tests/public-search.config.test.ts`
- Modify: `apps/public-search-bot/src/config.ts`

- [ ] **Step 1: Write the failing status/admin token regression test**

In `apps/public-search-bot/tests/public-search.config.test.ts`, insert this test immediately after `rejects reusing the sync token as the status token after trimming`:

```ts
  it('rejects reusing the status token as the subscription admin token after trimming', () => {
    expect(() =>
      loadPublicSearchConfig({
        PUBLIC_BOT_TOKEN: 'bot-token',
        PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
        PUBLIC_SEARCH_STATUS_TOKEN: ' shared-token ',
        SUBSCRIPTION_BOT_TOKEN: 'subscription-token',
        SUBSCRIPTION_ADMIN_TOKEN: 'shared-token',
        GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id',
        GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/secure/google.json'
      })
    ).toThrow(/SUBSCRIPTION_ADMIN_TOKEN must be different from PUBLIC_SEARCH_STATUS_TOKEN/);
  });
```

- [ ] **Step 2: Run the targeted failing config test**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.config.test.ts -t "rejects reusing the status token as the subscription admin token after trimming"
```

Expected: FAIL because current config validation accepts the status token as the subscription admin token when the sync token is distinct.

- [ ] **Step 3: Implement the missing Zod refinement**

In `apps/public-search-bot/src/config.ts`, append the new status/admin refinement after the existing sync/admin refinement so the `PublicSearchEnvSchema` chain ends with:

```ts
}).refine((env) => env.PUBLIC_SEARCH_SYNC_TOKEN !== env.PUBLIC_SEARCH_STATUS_TOKEN, {
  message: 'PUBLIC_SEARCH_STATUS_TOKEN must be different from PUBLIC_SEARCH_SYNC_TOKEN',
  path: ['PUBLIC_SEARCH_STATUS_TOKEN']
}).refine((env) => env.SUBSCRIPTION_ADMIN_TOKEN !== env.PUBLIC_SEARCH_SYNC_TOKEN, {
  message: 'SUBSCRIPTION_ADMIN_TOKEN must be different from PUBLIC_SEARCH_SYNC_TOKEN',
  path: ['SUBSCRIPTION_ADMIN_TOKEN']
}).refine((env) => env.SUBSCRIPTION_ADMIN_TOKEN !== env.PUBLIC_SEARCH_STATUS_TOKEN, {
  message: 'SUBSCRIPTION_ADMIN_TOKEN must be different from PUBLIC_SEARCH_STATUS_TOKEN',
  path: ['SUBSCRIPTION_ADMIN_TOKEN']
});
```

- [ ] **Step 4: Run the public-search config tests**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.config.test.ts
```

Expected: PASS. Existing required-secret, default, loopback-host, sync/status, and sync/admin token tests continue passing.

- [ ] **Step 5: Commit the public bot config change**

Run:

```bash
git add apps/public-search-bot/tests/public-search.config.test.ts apps/public-search-bot/src/config.ts
git commit -m "fix: separate public search status and admin tokens"
```

Expected: Commit contains only the public-search bot config test and implementation files.

### Task 3: Dedicated Public Bot Service Identity

**Files:**
- Modify: `apps/public-search-bot/README.md`
- Modify: `apps/public-search-bot/deploy/public-search-bot.service.example`

- [ ] **Step 1: Update the systemd service example**

Replace the full contents of `apps/public-search-bot/deploy/public-search-bot.service.example` with:

```ini
[Unit]
Description=InfinityLinks Public Search Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/infinitylinks-public-search-bot
EnvironmentFile=/opt/infinitylinks-public-search-bot/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
# Ensure /opt/infinitylinks-public-search-bot/data is writable by this user.
User=infinitylinks
Group=infinitylinks
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/infinitylinks-public-search-bot/data

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Update README deployment identity instructions**

In `apps/public-search-bot/README.md`, under `### 8. Set File Permissions`, replace the opening sentence and command blocks with:

````markdown
Create the dedicated service user and group if they do not already exist:

```bash
sudo adduser --system --group --home /opt/infinitylinks-public-search-bot --no-create-home infinitylinks
```

Create the database folder and make it writable by the service user:

```bash
sudo install -d -o infinitylinks -g infinitylinks /opt/infinitylinks-public-search-bot/data
sudo chown -R infinitylinks:infinitylinks /opt/infinitylinks-public-search-bot/data
```

Protect secrets while keeping them readable by the app service group:

```bash
sudo chown root:infinitylinks /opt/infinitylinks-public-search-bot/.env
sudo chmod 640 /opt/infinitylinks-public-search-bot/.env
sudo chown root:infinitylinks /opt/infinitylinks-public-search-bot/google-service-account.json
sudo chmod 640 /opt/infinitylinks-public-search-bot/google-service-account.json
```
````

In the `### 9. Build And Migrate The Database` command block, replace the final ownership command with:

```bash
sudo chown -R infinitylinks:infinitylinks /opt/infinitylinks-public-search-bot/data
```

In the `### 11. Install The systemd Service` confirmation block, replace the service identity lines with:

```ini
User=infinitylinks
Group=infinitylinks
```

Immediately after that confirmation block, use this paragraph:

```markdown
The example service uses `ProtectSystem=strict`, so only the SQLite data directory is writable by the app. If you place the database somewhere else, update `ReadWritePaths` to match. Do not run the app service as `www-data` on shared hosts; Nginx proxies requests and does not need access to the bot `.env` or Google service account JSON.
```

In the upgrade command block near the bottom of the README, replace the data ownership command with:

```bash
sudo chown -R infinitylinks:infinitylinks /opt/infinitylinks-public-search-bot/data
```

- [ ] **Step 3: Verify the old shared identity patterns are gone from deployment snippets**

Run:

```powershell
Select-String -Path apps\public-search-bot\README.md,apps\public-search-bot\deploy\public-search-bot.service.example -Pattern 'User=www-data|Group=www-data|www-data:www-data|root:www-data'
```

Expected: no matches.

- [ ] **Step 4: Commit the deployment identity docs**

Run:

```bash
git add apps/public-search-bot/README.md apps/public-search-bot/deploy/public-search-bot.service.example
git commit -m "docs: use dedicated public search service user"
```

Expected: Commit contains only the README and systemd service example.

### Task 4: Final Verification

**Files:**
- Verify: `tests/server/app.test.ts`
- Verify: `apps/public-search-bot/tests/public-search.config.test.ts`
- Verify: repository working tree

- [ ] **Step 1: Run targeted suites**

Run:

```bash
npm.cmd test -- tests/server/app.test.ts
npm.cmd --prefix apps/public-search-bot test -- public-search.config.test.ts
```

Expected: both commands PASS.

- [ ] **Step 2: Run broader suites**

Run:

```bash
npm.cmd test
npm.cmd --prefix apps/public-search-bot test
```

Expected: both commands PASS.

- [ ] **Step 3: Confirm only the pre-existing unrelated change remains unstaged**

Run:

```bash
git status --short
```

Expected:

```text
 M apps/public-search-bot/google-apps-script/Code.gs
```

- [ ] **Step 4: Summarize the remediation**

Report:

```text
Implemented the approved security remediation:
- admin mutating API requests now require X-InfinityLinks-Request: fetch even without browser provenance headers;
- public-search config rejects SUBSCRIPTION_ADMIN_TOKEN equal to PUBLIC_SEARCH_STATUS_TOKEN;
- public-search deployment docs and systemd example use the dedicated infinitylinks service identity.

Verification:
- npm.cmd test -- tests/server/app.test.ts
- npm.cmd --prefix apps/public-search-bot test -- public-search.config.test.ts
- npm.cmd test
- npm.cmd --prefix apps/public-search-bot test

Unrelated working-tree change preserved:
- apps/public-search-bot/google-apps-script/Code.gs
```

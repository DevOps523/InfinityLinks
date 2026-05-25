# Root Public Search Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete root `src/public-search/` runtime now that the deployable public bot lives in `apps/public-search-bot/`.

**Architecture:** The root project should build and test only the local admin app and its server-side public-search sync/export integration. The standalone public bot remains isolated under `apps/public-search-bot/` with its own package scripts, TypeScript config, source, and tests.

**Tech Stack:** TypeScript, Node.js, Express, React, Vite, Vitest, PowerShell, npm workspaces-by-prefix.

---

## File Structure

Remove old root public bot files:

- Delete: `src/public-search/`
- Delete: `tsconfig.public-search.json`
- Delete root tests that import `../../src/public-search/...`

Update root package scripts:

- Modify: `package.json`
- Modify: `package-lock.json` only if npm changes it during script/package metadata normalization. Manual edits should not be needed.

Keep active admin-side public-search code:

- Keep: `src/server/public-search/`
- Keep root tests that exercise `/api/public-search/sync`, `/api/public-search/sync-status`, and `/api/public-search/status`

Keep standalone bot code:

- Keep: `apps/public-search-bot/src/`
- Keep: `apps/public-search-bot/tests/`
- Keep root helper scripts: `standalone-public-search:install`, `standalone-public-search:test`, `standalone-public-search:build`, `standalone-public-search:start`

## Task 1: Remove Root Public Bot Build Scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Inspect the current root scripts**

Run:

```powershell
Get-Content package.json
```

Expected: `scripts` includes `public-search:dev`, `build:public-search`, `public-search:start`, and root `build` includes `tsc -p tsconfig.public-search.json`.

- [ ] **Step 2: Update root scripts**

Edit `package.json` so the scripts block becomes:

```json
{
  "scripts": {
    "dev": "tsx watch src/server/index.ts",
    "build": "tsc --noEmit && tsc -p tsconfig.server.json && vite build",
    "start": "node dist/server/index.js",
    "standalone-public-search:install": "npm --prefix apps/public-search-bot install",
    "standalone-public-search:test": "npm --prefix apps/public-search-bot test",
    "standalone-public-search:build": "npm --prefix apps/public-search-bot run build",
    "standalone-public-search:start": "npm --prefix apps/public-search-bot start",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx src/server/db/migrate.ts"
  }
}
```

Keep all existing dependencies, devDependencies, package metadata, and ordering outside `scripts` unchanged.

- [ ] **Step 3: Verify removed script references**

Run:

```powershell
rg -n "public-search:dev|public-search:start|build:public-search|tsconfig.public-search" package.json
```

Expected: no output and exit code 1.

## Task 2: Delete Old Root Public Bot Source and Config

**Files:**
- Delete: `src/public-search/`
- Delete: `tsconfig.public-search.json`

- [ ] **Step 1: Confirm the active admin directory is separate**

Run:

```powershell
Get-ChildItem src\server\public-search -File
```

Expected: files such as `catalog.ts`, `public-search.routes.ts`, `status.service.ts`, `sync.service.ts`, and `sync-state.repository.ts` are listed.

- [ ] **Step 2: Delete only the obsolete root runtime**

Delete:

```text
src/public-search/
tsconfig.public-search.json
```

Do not delete:

```text
src/server/public-search/
apps/public-search-bot/
```

- [ ] **Step 3: Verify the right paths remain**

Run:

```powershell
Test-Path src\public-search
Test-Path tsconfig.public-search.json
Test-Path src\server\public-search
Test-Path apps\public-search-bot
```

Expected output:

```text
False
False
True
True
```

## Task 3: Delete Root Tests for the Removed Runtime

**Files:**
- Delete: `tests/public-search/public-search.config.test.ts`
- Delete: `tests/public-search/public-search.db.test.ts`
- Delete: `tests/public-search/public-search.formatter.test.ts`
- Delete: `tests/public-search/public-search.handlers.test.ts`
- Delete: `tests/public-search/public-search.poller.test.ts`
- Delete: `tests/public-search/public-search.rate-limit.test.ts`
- Delete: `tests/public-search/public-search.repository.test.ts`
- Delete: `tests/public-search/public-search.reply-queue.test.ts`
- Delete: `tests/public-search/public-search.sync-endpoint.test.ts`
- Delete: `tests/public-search/public-search.telegram-client.test.ts`

- [ ] **Step 1: Identify root tests that import removed source**

Run:

```powershell
rg -l "\.\./\.\./src/public-search" tests\public-search
```

Expected output includes exactly the files listed in this task.

- [ ] **Step 2: Delete only tests that import removed source**

Delete the files listed in this task.

Keep these root tests because they exercise active admin server code:

```text
tests/public-search/public-search.catalog.test.ts
tests/public-search/public-search.sync-state.test.ts
tests/public-search/public-search.sync-route.test.ts
tests/public-search/public-search.status-route.test.ts
```

- [ ] **Step 3: Verify no root test imports the removed source**

Run:

```powershell
rg -n "\.\./\.\./src/public-search" tests
```

Expected: no output and exit code 1.

## Task 4: Clean Misleading Documentation References

**Files:**
- Modify: `docs/superpowers/specs/2026-05-24-standalone-public-search-bot-design.md`
- Modify: `docs/plans/2026-05-25-standalone-public-bot-command-messages.md`
- Modify: `docs/superpowers/specs/2026-05-25-standalone-public-bot-command-messages-design.md`

- [ ] **Step 1: Find current misleading references**

Run:

```powershell
rg -n "Root public-search copy|old `src/public-search`|Keep `src/public-search`|root `src/public-search/`|No root `src/public-search/`|src/public-search/ remains|can be removed later" docs
```

Expected: references are limited to historical plans/specs around the standalone bot split and command-message work.

- [ ] **Step 2: Update standalone design conclusion**

In `docs/superpowers/specs/2026-05-24-standalone-public-search-bot-design.md`, replace forward-looking compatibility language with historical wording:

```markdown
The old `src/public-search` service stayed temporarily for compatibility during the standalone extraction. It was later removed after the standalone app became the public bot runtime.
```

Also update checklist-style lines that say to keep `src/public-search` so they no longer read as current instructions. Use:

```markdown
- The standalone app owns the public bot runtime.
- The root local admin app keeps only `src/server/public-search/` for export and sync proxy behavior.
```

- [ ] **Step 3: Update command-message docs**

In `docs/plans/2026-05-25-standalone-public-bot-command-messages.md` and `docs/superpowers/specs/2026-05-25-standalone-public-bot-command-messages-design.md`, replace statements such as:

```markdown
Do not change `src/public-search/bot/formatter.ts`.
Do not change `src/public-search/bot/handlers.ts`.
- No root `src/public-search/` or root `tests/public-search/` files changed.
```

with historical wording:

```markdown
The command-message change targeted only `apps/public-search-bot/`; the old root `src/public-search/` compatibility copy was not part of that change.
```

- [ ] **Step 4: Verify only historical references remain**

Run:

```powershell
rg -n "src/public-search|tsconfig.public-search|public-search:dev|public-search:start|build:public-search|dist/public-search" package.json tsconfig.json README.md src tests apps docs
```

Expected: no live code/script/test references. Historical docs may still mention `src/public-search` only as past context in completed plans/specs.

## Task 5: Verify Root and Standalone Builds

**Files:**
- No source edits expected.

- [ ] **Step 1: Run root tests**

Run:

```powershell
npm.cmd test
```

Expected: PASS. Root public-search tests that imported `../../src/public-search/...` no longer run.

- [ ] **Step 2: Run root build**

Run:

```powershell
npm.cmd run build
```

Expected: PASS. The build should not call `tsc -p tsconfig.public-search.json`.

- [ ] **Step 3: Run standalone bot tests**

Run:

```powershell
npm.cmd --prefix apps\public-search-bot test
```

Expected: PASS. The standalone bot test suite remains responsible for public bot runtime behavior.

- [ ] **Step 4: Run standalone bot build**

Run:

```powershell
npm.cmd --prefix apps\public-search-bot run build
```

Expected: PASS. The standalone bot compiles independently.

## Task 6: Final Reference and Git Review

**Files:**
- No source edits expected unless verification reveals a missed reference.

- [ ] **Step 1: Confirm removed paths are gone**

Run:

```powershell
Test-Path src\public-search
Test-Path tsconfig.public-search.json
rg -n "\.\./\.\./src/public-search|src/public-search|tsconfig.public-search|public-search:dev|public-search:start|build:public-search|dist/public-search" package.json src tests apps
```

Expected:

```text
False
False
```

The `rg` command should produce no live code/script/test references and exit 1.

- [ ] **Step 2: Review git status**

Run:

```powershell
git status --short
```

Expected: changes include deleted `src/public-search/` files, deleted `tsconfig.public-search.json`, deleted obsolete root public-search tests, modified `package.json`, and any documentation updates from Task 4. Existing unrelated user changes, such as `README.md` or `apps/public-search-bot/.env.example`, must not be reverted.

- [ ] **Step 3: Review diff**

Run:

```powershell
git diff -- package.json docs src tests tsconfig.public-search.json
```

Expected: diff shows only the planned removal and reference cleanup. `src/server/public-search/` and `apps/public-search-bot/` source files are untouched.

- [ ] **Step 4: Commit**

Run:

```powershell
git add package.json docs src tests tsconfig.public-search.json
git commit -m "chore: remove root public search runtime"
```

Expected: commit succeeds. Do not stage unrelated pre-existing changes unless the user explicitly asks.

# Standalone Public Search Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `apps/public-search-bot/` as a self-contained deployable public Telegram search bot so the VPS no longer needs the full InfinityLinks admin repo.

**Architecture:** Copy the verified public-search VPS service into a standalone Node/TypeScript app with its own package scripts, config, tests, env example, README, and deployment examples. Keep the existing root `src/public-search` service during this compatibility phase; the local admin app continues syncing through the same `POST /api/sync` contract.

**Tech Stack:** Node.js, TypeScript `NodeNext`, Express, better-sqlite3, dotenv, Zod, Vitest, Supertest, Telegram Bot API.

---

### Task 1: Scaffold The Standalone App Package

**Files:**
- Create: `apps/public-search-bot/package.json`
- Create: `apps/public-search-bot/tsconfig.json`
- Create: `apps/public-search-bot/.env.example`
- Create: `apps/public-search-bot/.gitignore`

**Step 1: Write package metadata and scripts**

Create `apps/public-search-bot/package.json`:

```json
{
  "name": "infinitylinks-public-search-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.2",
    "@types/supertest": "^7.2.0",
    "supertest": "^7.2.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Write TypeScript config**

Create `apps/public-search-bot/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": false,
    "isolatedModules": false
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Add environment example**

Create `apps/public-search-bot/.env.example`:

```env
PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_secret_sync_token
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
PUBLIC_SEARCH_PORT=3001
```

**Step 4: Add local ignores**

Create `apps/public-search-bot/.gitignore`:

```gitignore
.env
dist/
data/
node_modules/
```

**Step 5: Run package sanity check**

Run from the repo root:

```sh
Get-Content apps/public-search-bot/package.json
```

Expected: JSON contains `build`, `start`, and `test` scripts.

**Step 6: Commit**

```sh
git add apps/public-search-bot/package.json apps/public-search-bot/tsconfig.json apps/public-search-bot/.env.example apps/public-search-bot/.gitignore
git commit -m "feat: scaffold standalone public search bot"
```

### Task 2: Copy The Runtime Source Into The Standalone App

**Files:**
- Copy from: `src/public-search/**/*.ts`
- Copy from: `src/public-search/db/schema.sql`
- Create under: `apps/public-search-bot/src/**`

**Step 1: Copy source files**

Copy the existing public-search source tree into the standalone app:

```text
src/public-search/app.ts -> apps/public-search-bot/src/app.ts
src/public-search/index.ts -> apps/public-search-bot/src/index.ts
src/public-search/poller.ts -> apps/public-search-bot/src/poller.ts
src/public-search/config.ts -> apps/public-search-bot/src/config.ts
src/public-search/catalog.repository.ts -> apps/public-search-bot/src/catalog.repository.ts
src/public-search/catalog.schema.ts -> apps/public-search-bot/src/catalog.schema.ts
src/public-search/rate-limit.ts -> apps/public-search-bot/src/rate-limit.ts
src/public-search/search.repository.ts -> apps/public-search-bot/src/search.repository.ts
src/public-search/sync.routes.ts -> apps/public-search-bot/src/sync.routes.ts
src/public-search/telegram.client.ts -> apps/public-search-bot/src/telegram.client.ts
src/public-search/telegram.reply-queue.ts -> apps/public-search-bot/src/telegram.reply-queue.ts
src/public-search/bot/* -> apps/public-search-bot/src/bot/*
src/public-search/db/* -> apps/public-search-bot/src/db/*
```

Use PowerShell copy commands or a file explorer; do not modify root `src/public-search`.

**Step 2: Verify no root imports**

Run:

```sh
rg -n "\.\./\.\./|src/public-search|src/server|from '../../../" apps/public-search-bot/src
```

Expected: no output. Relative imports within `apps/public-search-bot/src` are fine.

**Step 3: Build the standalone source**

Run:

```sh
cd apps/public-search-bot
npm install
npm run build
```

Expected: TypeScript compiles to `apps/public-search-bot/dist`.

**Step 4: Commit**

```sh
git add apps/public-search-bot/src apps/public-search-bot/package-lock.json
git commit -m "feat: copy public search bot runtime"
```

### Task 3: Copy And Adapt Standalone Tests

**Files:**
- Copy from: `tests/public-search/*.test.ts`
- Create under: `apps/public-search-bot/tests/*.test.ts`
- Modify copied tests only.

**Step 1: Copy tests**

Copy all existing public-search tests into:

```text
apps/public-search-bot/tests/
```

**Step 2: Update test import paths**

In copied tests, replace imports like:

```ts
from '../../src/public-search/...'
```

with:

```ts
from '../src/...'
```

The copied tests should not import anything from the repo root.

**Step 3: Remove local-admin-only test from standalone suite**

Do not include `public-search.sync-route.test.ts` in the standalone test suite unless it is rewritten. That test covers the root local admin route at `src/server/public-search/public-search.routes.ts`, not the standalone VPS bot.

If copied initially, delete:

```text
apps/public-search-bot/tests/public-search.sync-route.test.ts
```

**Step 4: Run standalone tests**

Run:

```sh
cd apps/public-search-bot
npm test
```

Expected: all standalone tests pass. The expected count should be the current public-search tests minus the local admin sync-route test.

**Step 5: Commit**

```sh
git add apps/public-search-bot/tests
git commit -m "test: add standalone public search bot tests"
```

### Task 4: Add Standalone Deployment Documentation

**Files:**
- Create: `apps/public-search-bot/README.md`
- Create: `apps/public-search-bot/deploy/nginx.conf.example`
- Create: `apps/public-search-bot/deploy/public-search-bot.service.example`

**Step 1: Write standalone README**

Create `apps/public-search-bot/README.md` with these sections:

````markdown
# InfinityLinks Public Search Bot

This is the standalone VPS app for the public Telegram search bot. It does not run the private InfinityLinks admin UI.

## Setup

```sh
npm install
cp .env.example .env
npm run build
npm start
```

## Environment

```env
PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_secret_sync_token
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
PUBLIC_SEARCH_PORT=3001
```

## Sync From Local Admin

Set the local admin app:

```env
PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync
PUBLIC_SEARCH_SYNC_TOKEN=same_secret_as_this_app
```

Then click `Sync Public Search` in the local admin app.

## Commands

```sh
npm run dev
npm run build
npm start
npm test
```
````

Include notes that:

- the public bot must be admin in `@infinitylinks65`.
- the local admin app remains private.
- the VPS app should be behind a reverse proxy.
- the proxy must overwrite or sanitize `X-Forwarded-For`.

**Step 2: Add Nginx example**

Create `apps/public-search-bot/deploy/nginx.conf.example`:

```nginx
server {
  server_name your-vps.example.com;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

**Step 3: Add systemd example**

Create `apps/public-search-bot/deploy/public-search-bot.service.example`:

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
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

**Step 4: Commit**

```sh
git add apps/public-search-bot/README.md apps/public-search-bot/deploy
git commit -m "docs: add standalone bot deployment guide"
```

### Task 5: Update Root README For The New Deployment Split

**Files:**
- Modify: `README.md`

**Step 1: Change VPS wording**

In `README.md`, update the public search deployment section to say:

```markdown
For VPS deployment, use the standalone app in `apps/public-search-bot/`.
The VPS does not need the full private admin app. Copy or deploy only
`apps/public-search-bot/`, then run its local `npm install`, `npm run build`,
and `npm start` commands.
```

Keep the local admin sync instructions, but point full VPS setup details to:

```markdown
apps/public-search-bot/README.md
```

**Step 2: Remove misleading full-root clone language**

If the README still says to clone the full repo on the VPS, replace it with a standalone-folder deployment explanation.

**Step 3: Run a docs check**

Run:

```sh
rg -n "clone the full repo|full repo|apps/public-search-bot|PUBLIC_SEARCH_SYNC_URL|PUBLIC_SEARCH_SYNC_TOKEN" README.md apps/public-search-bot/README.md
```

Expected: root README points to `apps/public-search-bot`; no instruction says the VPS must run the private admin app.

**Step 4: Commit**

```sh
git add README.md
git commit -m "docs: point vps deployment to standalone bot"
```

### Task 6: Add Optional Root Convenience Scripts

**Files:**
- Modify: `package.json`

**Step 1: Add root passthrough scripts**

Add scripts to the root `package.json`:

```json
"standalone-public-search:install": "npm --prefix apps/public-search-bot install",
"standalone-public-search:test": "npm --prefix apps/public-search-bot test",
"standalone-public-search:build": "npm --prefix apps/public-search-bot run build",
"standalone-public-search:start": "npm --prefix apps/public-search-bot start"
```

These are convenience scripts for local development only. The VPS can still run commands directly from `apps/public-search-bot`.

**Step 2: Run standalone build through root script**

Run:

```sh
npm run standalone-public-search:build
```

Expected: standalone TypeScript build passes.

**Step 3: Commit**

```sh
git add package.json package-lock.json
git commit -m "chore: add standalone public search scripts"
```

### Task 7: Verify The Standalone App Is Independent

**Files:**
- No code changes expected.

**Step 1: Check source imports**

Run:

```sh
rg -n "src/public-search|src/server|../../src|../../../src" apps/public-search-bot
```

Expected: no matches in `apps/public-search-bot/src` or `apps/public-search-bot/tests`.

**Step 2: Check app-local package use**

Run:

```sh
cd apps/public-search-bot
npm test
npm run build
```

Expected: standalone tests and build pass from inside the folder.

**Step 3: Check root compatibility**

Run from repo root:

```sh
npm test
npm run build
```

Expected: root tests and root build still pass. This confirms the compatibility phase did not break the existing app.

**Step 4: Commit if any verification-only docs changed**

Only commit if files changed:

```sh
git status --short
git add <changed-files>
git commit -m "test: verify standalone public search bot"
```

### Task 8: Final Review And Handoff

**Files:**
- No code changes expected unless review finds issues.

**Step 1: Review against the spec**

Confirm:

- `apps/public-search-bot` has its own `package.json`, `tsconfig.json`, `.env.example`, README, deploy examples, `src`, and `tests`.
- standalone app imports nothing from root `src`.
- standalone tests pass from inside the standalone folder.
- standalone build passes from inside the standalone folder.
- root tests/build remain green.
- root `src/public-search` remains in place for the later cleanup phase.
- root README says VPS can deploy only `apps/public-search-bot`.

**Step 2: Final command set**

Run:

```sh
cd apps/public-search-bot
npm test
npm run build
cd ../..
npm test
npm run build
git status --short
```

Expected:

- standalone tests pass.
- standalone build passes.
- root tests pass.
- root build passes.
- git working tree is clean after commits.

**Step 3: Report**

Final response should include:

- standalone app path: `apps/public-search-bot/`.
- key commands for VPS deployment.
- test/build results.
- note that old `src/public-search` remains temporarily and can be removed later.

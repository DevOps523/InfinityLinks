# Windows Compiled Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-only compiled distribution flow that ships InfinityLinks as `InfinityLinks.exe` plus external `.env`, `data/`, static client assets, and setup docs without source code.

**Architecture:** Keep the app runtime as Node/Express, package the server entry with `@yao-pkg/pkg`, and copy minified/obfuscated frontend assets beside the executable. Runtime paths must resolve relative to the executable folder for packaged customers and relative to the project root during development.

**Tech Stack:** TypeScript, React/Vite, Express, SQLite via `better-sqlite3`, `@yao-pkg/pkg`, `esbuild`, `javascript-obfuscator`, Vitest.

---

## File Structure

- Modify `package.json`: add packaging dependencies and Windows release scripts.
- Modify `tsconfig.server.json`: disable server source maps for release safety.
- Modify `vite.config.ts`: explicitly disable frontend source maps.
- Create `src/server/runtime/paths.ts`: centralize runtime directory, data path, and client asset path resolution.
- Modify `src/server/config.ts`: default `DATABASE_PATH` to the runtime `data/` folder.
- Modify `src/server/app.ts`: serve static client assets from the runtime-aware path resolver.
- Modify `src/server/db/migrate.ts`: find `schema.sql` from packaged release assets as well as development paths.
- Create `scripts/build-windows-release.ts`: build the release folder, obfuscate JS assets, run `pkg`, and copy runtime files.
- Create `scripts/templates/README.windows.txt`: customer setup instructions for the compiled Windows release.
- Create `tests/server/runtime.paths.test.ts`: unit coverage for runtime path helpers.
- Modify `.gitignore`: ignore generated release folders.

## Task 1: Add Packaging Dependencies And Scripts

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add packaging dev dependencies**

Run:

```powershell
npm.cmd install --save-dev @yao-pkg/pkg esbuild javascript-obfuscator
```

Expected: `package.json` and `package-lock.json` update with the three new dev dependencies.

- [ ] **Step 2: Add release scripts to `package.json`**

Update the `scripts` block to include:

```json
{
  "build:release:win": "npm.cmd run build && tsx scripts/build-windows-release.ts",
  "verify:release:win": "powershell -ExecutionPolicy Bypass -File scripts/verify-windows-release.ps1"
}
```

Keep the existing scripts unchanged.

- [ ] **Step 3: Ignore generated release output**

Append this to `.gitignore`:

```gitignore
release/
dist/package/
```

- [ ] **Step 4: Verify package metadata**

Run:

```powershell
npm.cmd run build
```

Expected: PASS. If the sandbox blocks Vite config reads, rerun with escalated project access.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json .gitignore
git commit -m "build: add windows packaging dependencies"
```

## Task 2: Add Runtime Path Resolution

**Files:**
- Create: `src/server/runtime/paths.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/db/migrate.ts`
- Test: `tests/server/runtime.paths.test.ts`

- [ ] **Step 1: Write failing runtime path tests**

Create `tests/server/runtime.paths.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getRuntimeBaseDir, resolveClientDistPath, resolveRuntimePath } from '../../src/server/runtime/paths';

const originalCwd = process.cwd();
let tempDir = '';

afterEach(() => {
  process.chdir(originalCwd);
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
  }
});

describe('runtime paths', () => {
  it('uses the current working directory outside a packaged executable', () => {
    expect(getRuntimeBaseDir()).toBe(process.cwd());
    expect(resolveRuntimePath('data/infinitylinks.sqlite')).toBe(path.resolve(process.cwd(), 'data/infinitylinks.sqlite'));
  });

  it('resolves client assets from a release-style client folder when present', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinitylinks-runtime-'));
    fs.mkdirSync(path.join(tempDir, 'client'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'client', 'index.html'), '<!doctype html>');
    process.chdir(tempDir);

    expect(resolveClientDistPath()).toBe(path.join(tempDir, 'client'));
  });

  it('falls back to dist/client during development builds', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinitylinks-runtime-'));
    process.chdir(tempDir);

    expect(resolveClientDistPath()).toBe(path.join(tempDir, 'dist', 'client'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- tests/server/runtime.paths.test.ts
```

Expected: FAIL because `src/server/runtime/paths.ts` does not exist yet.

- [ ] **Step 3: Create runtime path helper**

Create `src/server/runtime/paths.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

type PackagedProcess = NodeJS.Process & {
  pkg?: unknown;
};

export function isPackagedRuntime() {
  return Boolean((process as PackagedProcess).pkg);
}

export function getRuntimeBaseDir() {
  if (isPackagedRuntime()) {
    return path.dirname(process.execPath);
  }

  return process.cwd();
}

export function resolveRuntimePath(relativePath: string) {
  return path.resolve(getRuntimeBaseDir(), relativePath);
}

export function resolveClientDistPath() {
  const releaseClientPath = resolveRuntimePath('client');

  if (fs.existsSync(path.join(releaseClientPath, 'index.html'))) {
    return releaseClientPath;
  }

  return resolveRuntimePath(path.join('dist', 'client'));
}

export function resolveSchemaAssetPath() {
  return resolveRuntimePath('schema.sql');
}
```

- [ ] **Step 4: Update config database default**

Modify `src/server/config.ts`:

```ts
import { z } from 'zod';
import { resolveRuntimePath } from './runtime/paths.js';

function requiredSecret(name: string) {
  return z.string({ required_error: `${name} is required` }).trim().min(1, `${name} is required`);
}

const EnvSchema = z.object({
  TMDB_API_KEY: requiredSecret('TMDB_API_KEY'),
  TELEGRAM_BOT_TOKEN: requiredSecret('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHANNEL_ID: requiredSecret('TELEGRAM_CHANNEL_ID'),
  HOST: z
    .string()
    .trim()
    .default('127.0.0.1')
    .refine((host) => ['127.0.0.1', 'localhost', '::1'].includes(host), {
      message: 'HOST must be a localhost address'
    }),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().trim().min(1).optional()
});

export type AppConfig = {
  tmdbApiKey: string;
  telegramBotToken: string;
  telegramChannelId: string;
  host: string;
  port: number;
  databasePath: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.parse(env);

  return {
    tmdbApiKey: parsed.TMDB_API_KEY,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChannelId: parsed.TELEGRAM_CHANNEL_ID,
    host: parsed.HOST,
    port: parsed.PORT,
    databasePath: parsed.DATABASE_PATH ?? resolveRuntimePath('data/infinitylinks.sqlite')
  };
}
```

- [ ] **Step 5: Update static client path**

In `src/server/app.ts`, remove the `node:path`, `node:url`, `__filename`, and `__dirname` code used only for static assets. Add:

```ts
import path from 'node:path';
import { resolveClientDistPath } from './runtime/paths.js';
```

Then replace:

```ts
const clientDist = path.resolve(__dirname, '../../dist/client');
```

with:

```ts
const clientDist = resolveClientDistPath();
```

Keep:

```ts
app.use(express.static(clientDist));

app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});
```

- [ ] **Step 6: Update schema path resolution**

Modify `src/server/db/migrate.ts` so `resolveSchemaPath()` checks release assets first:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, type AppDatabase } from './database.js';
import { resolveSchemaAssetPath } from '../runtime/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveSchemaPath() {
  const candidates = [
    resolveSchemaAssetPath(),
    path.join(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../../../src/server/db/schema.sql'),
    path.resolve(process.cwd(), 'src/server/db/schema.sql')
  ];

  const schemaPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!schemaPath) {
    throw new Error(`Unable to find schema.sql. Checked: ${candidates.join(', ')}`);
  }

  return schemaPath;
}
```

Leave `migrate()` and the CLI block unchanged.

- [ ] **Step 7: Run runtime tests**

Run:

```powershell
npm.cmd test -- tests/server/runtime.paths.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run existing focused tests**

Run:

```powershell
npm.cmd test -- tests/client/App.test.tsx tests/server/telegram.formatter.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/server/runtime/paths.ts src/server/config.ts src/server/app.ts src/server/db/migrate.ts tests/server/runtime.paths.test.ts
git commit -m "build: resolve runtime paths for packaged app"
```

## Task 3: Disable Source Maps In Production Builds

**Files:**
- Modify: `tsconfig.server.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Disable server source maps**

Change `tsconfig.server.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist/server",
    "rootDir": "src/server",
    "noEmit": false,
    "declaration": false,
    "sourceMap": false,
    "isolatedModules": false
  },
  "include": ["src/server/**/*.ts"]
}
```

- [ ] **Step 2: Disable client source maps explicitly**

Change `vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000'
    }
  }
});
```

- [ ] **Step 3: Verify no source maps are emitted**

Run:

```powershell
npm.cmd run build
Get-ChildItem -Path dist -Recurse -Filter *.map
```

Expected: build passes and the `Get-ChildItem` command prints no `.map` files.

- [ ] **Step 4: Commit**

```powershell
git add tsconfig.server.json vite.config.ts
git commit -m "build: disable production source maps"
```

## Task 4: Create Windows Release Builder

**Files:**
- Create: `scripts/build-windows-release.ts`
- Create: `scripts/templates/README.windows.txt`

- [ ] **Step 1: Create customer README template**

Create `scripts/templates/README.windows.txt`:

```text
InfinityLinks Windows Release

1. Copy .env.example to .env.
2. Open .env and set:
   TMDB_API_KEY=your_tmdb_key
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_CHANNEL_ID=your_telegram_channel_id
3. Run InfinityLinks.exe.
4. Open http://127.0.0.1:3000 in your browser.

The data folder stores the local SQLite database. Do not delete it unless you want to reset the app.
```

- [ ] **Step 2: Create release builder script**

Create `scripts/build-windows-release.ts`:

```ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { build } from 'esbuild';

const rootDir = process.cwd();
const packageDir = path.join(rootDir, 'dist', 'package');
const releaseDir = path.join(rootDir, 'release', 'windows', 'InfinityLinks');
const serverBundlePath = path.join(packageDir, 'server.cjs');
const executablePath = path.join(releaseDir, 'InfinityLinks.exe');

const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  identifierNamesGenerator: 'hexadecimal' as const,
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['base64'] as Array<'base64'>,
  stringArrayThreshold: 0.55
};

function ensureCleanDirectory(directory: string) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function copyDirectory(source: string, destination: string) {
  fs.cpSync(source, destination, { recursive: true });
}

function obfuscateFile(filePath: string) {
  const source = fs.readFileSync(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(source, obfuscationOptions);
  fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
}

function obfuscateClientAssets(clientAssetsDir: string) {
  const entries = fs.readdirSync(clientAssetsDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(clientAssetsDir, entry.name);

    if (entry.isDirectory()) {
      obfuscateClientAssets(entryPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      obfuscateFile(entryPath);
    }
  }
}

async function main() {
  ensureCleanDirectory(packageDir);
  ensureCleanDirectory(releaseDir);

  await build({
    entryPoints: [path.join(rootDir, 'src', 'server', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: serverBundlePath,
    sourcemap: false,
    external: ['better-sqlite3']
  });

  obfuscateFile(serverBundlePath);

  copyDirectory(path.join(rootDir, 'dist', 'client'), path.join(releaseDir, 'client'));
  obfuscateClientAssets(path.join(releaseDir, 'client', 'assets'));

  fs.copyFileSync(path.join(rootDir, '.env.example'), path.join(releaseDir, '.env.example'));
  fs.copyFileSync(path.join(rootDir, 'src', 'server', 'db', 'schema.sql'), path.join(releaseDir, 'schema.sql'));
  fs.copyFileSync(path.join(rootDir, 'scripts', 'templates', 'README.windows.txt'), path.join(releaseDir, 'README.txt'));
  fs.mkdirSync(path.join(releaseDir, 'data'), { recursive: true });

  execFileSync(
    'npx.cmd',
    ['pkg', serverBundlePath, '--targets', 'node20-win-x64', '--output', executablePath],
    { stdio: 'inherit' }
  );

  console.log(`Windows release created at ${releaseDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Run release build**

Run:

```powershell
npm.cmd run build:release:win
```

Expected: `release/windows/InfinityLinks/InfinityLinks.exe` exists.

- [ ] **Step 4: Inspect release folder**

Run:

```powershell
Get-ChildItem -Path release/windows/InfinityLinks -Force
```

Expected output includes:

```text
InfinityLinks.exe
.env.example
README.txt
schema.sql
client
data
```

- [ ] **Step 5: Commit**

```powershell
git add scripts/build-windows-release.ts scripts/templates/README.windows.txt
git commit -m "build: create windows release builder"
```

## Task 5: Add Release Verification Script

**Files:**
- Create: `scripts/verify-windows-release.ps1`

- [ ] **Step 1: Create verification script**

Create `scripts/verify-windows-release.ps1`:

```powershell
$ErrorActionPreference = "Stop"

$releaseDir = Join-Path (Get-Location) "release/windows/InfinityLinks"
$exe = Join-Path $releaseDir "InfinityLinks.exe"

if (!(Test-Path $exe)) {
  throw "Missing InfinityLinks.exe"
}

$blocked = @("src", "tests", ".git")

foreach ($name in $blocked) {
  $path = Join-Path $releaseDir $name
  if (Test-Path $path) {
    throw "Release folder must not contain $name"
  }
}

$sourceFiles = Get-ChildItem -Path $releaseDir -Recurse -Include *.ts,*.tsx,*.map -File

if ($sourceFiles.Count -gt 0) {
  $sourceFiles | ForEach-Object { Write-Host $_.FullName }
  throw "Release folder contains source or source map files"
}

$required = @(
  "InfinityLinks.exe",
  ".env.example",
  "README.txt",
  "schema.sql",
  "client/index.html",
  "data"
)

foreach ($relativePath in $required) {
  $path = Join-Path $releaseDir $relativePath
  if (!(Test-Path $path)) {
    throw "Missing required release item: $relativePath"
  }
}

Write-Host "Windows release verification passed."
```

- [ ] **Step 2: Run verification**

Run:

```powershell
npm.cmd run verify:release:win
```

Expected: `Windows release verification passed.`

- [ ] **Step 3: Commit**

```powershell
git add scripts/verify-windows-release.ps1
git commit -m "build: verify windows release contents"
```

## Task 6: Smoke Test The Packaged App

**Files:**
- No code changes expected.

- [ ] **Step 1: Create a release `.env`**

Create `release/windows/InfinityLinks/.env` using real customer-style credentials:

```text
TMDB_API_KEY=replace_with_real_tmdb_key
TELEGRAM_BOT_TOKEN=replace_with_real_telegram_bot_token
TELEGRAM_CHANNEL_ID=-1003976784492
HOST=127.0.0.1
PORT=3000
```

Do not commit this file.

- [ ] **Step 2: Start executable**

Run:

```powershell
Set-Location release/windows/InfinityLinks
.\InfinityLinks.exe
```

Expected terminal log includes:

```text
InfinityLinks admin running
```

- [ ] **Step 3: Verify health endpoint**

In a second terminal, run:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

Expected:

```text
ok
--
True
```

- [ ] **Step 4: Verify browser UI**

Open:

```text
http://127.0.0.1:3000
```

Expected: the InfinityLinks admin UI loads from the packaged `client/` folder.

- [ ] **Step 5: Verify database file**

Run:

```powershell
Get-ChildItem -Path data
```

Expected: `infinitylinks.sqlite` exists after startup.

- [ ] **Step 6: Verify external-source exclusion**

Run:

```powershell
npm.cmd run verify:release:win
```

Expected: PASS.

- [ ] **Step 7: Commit any fixes**

If smoke testing revealed code fixes, commit them:

```powershell
git add <changed-files>
git commit -m "fix: support packaged windows runtime"
```

If there were no fixes, do not create an empty commit.

## Task 7: Final Build And Documentation Check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add maintainer packaging instructions to `README.md`**

Add:

````markdown
## Build Windows Release

To build the compiled Windows release:

```bash
npm.cmd run build:release:win
npm.cmd run verify:release:win
```

The generated customer package is written to:

```text
release/windows/InfinityLinks/
```

Do not distribute `src/`, `tests/`, `.git/`, TypeScript files, or source maps. Customers should edit only the `.env` file beside `InfinityLinks.exe`.
````

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run build:release:win
npm.cmd run verify:release:win
```

Expected: all commands pass.

- [ ] **Step 3: Commit**

```powershell
git add README.md
git commit -m "docs: document windows release build"
```

## Self-Review

- Spec coverage: The plan covers Windows-only compiled distribution, `.env` external configuration, external SQLite `data/`, no source maps, no source files in the release folder, obfuscation, `@yao-pkg/pkg`, release README, runtime logs, and verification.
- Placeholder scan: No task uses TODO, TBD, or undefined implementation language.
- Type consistency: Runtime path functions are named consistently across tests and implementation snippets.

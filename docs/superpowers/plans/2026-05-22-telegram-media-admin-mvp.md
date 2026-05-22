# Telegram Media Admin MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a localhost-only Node/Express/SQLite/React admin app that manages movies and TV shows and publishes public Telegram channel posts.

**Architecture:** A single Express backend owns configuration, SQLite, TMDB access, Telegram access, and Telegram queue processing. A React + Vite frontend talks only to local backend routes and never receives secrets. Telegram work is persisted in SQLite jobs and processed sequentially with retry timing for rate limits.

**Tech Stack:** Node.js, TypeScript, Express, SQLite via `better-sqlite3`, React, Vite, Vitest, Testing Library, Zod, Lucide React.

---

## File Structure And Responsibilities

Create this structure:

```text
package.json
tsconfig.json
vite.config.ts
vitest.config.ts
index.html
.env.example
src/
  client/
    App.tsx
    main.tsx
    styles.css
    api/http.ts
    components/
      ActionMenu.tsx
      ConfirmDialog.tsx
      LinkEditorModal.tsx
      Sidebar.tsx
      TmdbSearch.tsx
      ToastProvider.tsx
    pages/
      MovieForm.tsx
      MoviesPage.tsx
      EpisodePage.tsx
      SeasonPage.tsx
      TvShowForm.tsx
      TvShowsPage.tsx
  server/
    app.ts
    index.ts
    config.ts
    db/
      database.ts
      migrate.ts
      schema.sql
    media/
      media.routes.ts
      media.repository.ts
      media.schemas.ts
      media.service.ts
    telegram/
      telegram.client.ts
      telegram.formatter.ts
      telegram.queue.ts
      telegram.service.ts
    tmdb/
      tmdb.routes.ts
      tmdb.service.ts
    utils/
      errors.ts
      logger.ts
      time.ts
tests/
  server/
    db.test.ts
    media.movies.test.ts
    media.tv.test.ts
    telegram.formatter.test.ts
    telegram.queue.test.ts
    tmdb.service.test.ts
  client/
    App.test.tsx
```

Responsibility boundaries:

- `src/server/config.ts` validates env vars and exports typed config.
- `src/server/db/*` owns SQLite connection and migrations.
- `src/server/media/*` owns CRUD and publish-trigger decisions for movies, shows, seasons, episodes, and links.
- `src/server/tmdb/*` owns TMDB search, normalization, cache, and API logs.
- `src/server/telegram/*` owns Telegram formatting, transport, post tracking, and queue execution.
- `src/client/*` owns admin UI only; it calls backend routes and does not know credentials.

## Task 1: Project Scaffold

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `.env.example`
- Create: `src/server/index.ts`
- Create: `src/server/app.ts`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/styles.css`

- [ ] **Step 1: Create package metadata and scripts**

Create `package.json` with these scripts and dependencies:

```json
{
  "name": "infinitylinks",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server/index.ts",
    "build": "tsc --noEmit && vite build",
    "start": "node dist-server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx src/server/db/migrate.ts"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "better-sqlite3": "^11.8.1",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "lucide-react": "^0.468.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/better-sqlite3": "^7.6.12",
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.2",
    "jsdom": "^25.0.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and npm exits successfully.

- [ ] **Step 3: Add TypeScript and Vite config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

Create `vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true
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

Create `vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: []
  }
});
```

- [ ] **Step 4: Add base server and client files**

Create `src/server/app.ts`:

```ts
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  const clientDist = path.resolve(__dirname, '../../dist/client');
  app.use(express.static(clientDist));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}
```

Create `src/server/index.ts`:

```ts
import 'dotenv/config';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

createApp().listen(port, host, () => {
  console.log(`InfinityLinks admin running at http://${host}:${port}`);
});
```

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>InfinityLinks Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

Create `src/client/main.tsx`:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `src/client/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <h1>InfinityLinks Admin</h1>
      <p>Local media publishing dashboard</p>
    </main>
  );
}
```

Create `src/client/styles.css`:

```css
:root {
  color: #17202a;
  background: #f6f7f9;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
}

button,
input,
select,
textarea {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  padding: 24px;
}
```

Create `.env.example`:

```env
TMDB_API_KEY=replace_with_your_tmdb_api_key
TELEGRAM_BOT_TOKEN=replace_with_your_telegram_bot_token
TELEGRAM_CHANNEL_ID=-1003976784492
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=./data/infinitylinks.sqlite
```

- [ ] **Step 5: Verify scaffold**

Run:

```bash
npm run build
npm test
```

Expected: build succeeds and Vitest reports no failing tests.

- [ ] **Step 6: Commit scaffold**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts index.html .env.example src
git commit -m "feat: scaffold local admin app"
```

## Task 2: Database Schema And Migration

**Files:**

- Create: `src/server/db/schema.sql`
- Create: `src/server/db/database.ts`
- Create: `src/server/db/migrate.ts`
- Create: `tests/server/db.test.ts`

- [ ] **Step 1: Write migration test**

Create `tests/server/db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/database';
import { migrate } from '../../src/server/db/migrate';

describe('database migration', () => {
  it('creates every MVP table', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row: any) => row.name);

    expect(tables).toEqual([
      'api_logs',
      'episode_links',
      'episodes',
      'movie_links',
      'movies',
      'seasons',
      'telegram_jobs',
      'tmdb_cache',
      'tv_shows'
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/server/db.test.ts
```

Expected: FAIL because `src/server/db/database.ts` does not exist.

- [ ] **Step 3: Add schema**

Create `src/server/db/schema.sql` with these table definitions:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS movies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER,
  title TEXT NOT NULL,
  year INTEGER,
  poster_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  rating REAL,
  quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
  telegram_message_id INTEGER,
  post_status TEXT NOT NULL DEFAULT 'pending' CHECK (post_status IN ('pending', 'posted', 'failed', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS movie_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tv_shows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER,
  title TEXT NOT NULL,
  year INTEGER,
  poster_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  rating REAL,
  quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tv_show_id INTEGER NOT NULL REFERENCES tv_shows(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  telegram_message_id INTEGER,
  post_status TEXT NOT NULL DEFAULT 'pending' CHECK (post_status IN ('pending', 'posted', 'failed', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tv_show_id, season_number)
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (season_id, episode_number)
);

CREATE TABLE IF NOT EXISTS episode_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tmdb_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  query TEXT NOT NULL,
  result_payload TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (media_type, query)
);

CREATE TABLE IF NOT EXISTS api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  request_metadata TEXT NOT NULL DEFAULT '{}',
  response_summary TEXT,
  error_summary TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK (job_type IN ('send', 'edit', 'delete')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('movie', 'season')),
  entity_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'waiting_retry')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 4: Add database helpers**

Create `src/server/db/database.ts`:

```ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type AppDatabase = Database.Database;

export function createDatabase(databasePath: string): AppDatabase {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  return db;
}
```

Create `src/server/db/migrate.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, type AppDatabase } from './database';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function migrate(db: AppDatabase) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = createDatabase(process.env.DATABASE_PATH ?? './data/infinitylinks.sqlite');
  migrate(db);
  db.close();
  console.log('Database migrated');
}
```

- [ ] **Step 5: Verify migration**

Run:

```bash
npm test -- tests/server/db.test.ts
npm run db:migrate
```

Expected: test passes and `data/infinitylinks.sqlite` is created.

- [ ] **Step 6: Commit database schema**

```bash
git add src/server/db tests/server/db.test.ts data/.gitkeep
git commit -m "feat: add sqlite schema and migration"
```

If `data/.gitkeep` does not exist, create an empty `data/.gitkeep` so the directory is tracked while SQLite files remain ignored.

## Task 3: Configuration And Shared Validation

**Files:**

- Create: `src/server/config.ts`
- Create: `src/server/media/media.schemas.ts`
- Create: `tests/server/config.test.ts`

- [ ] **Step 1: Write config validation tests**

Create `tests/server/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config';

describe('loadConfig', () => {
  it('accepts required environment values', () => {
    const config = loadConfig({
      TMDB_API_KEY: 'tmdb-key',
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      TELEGRAM_CHANNEL_ID: '-1003976784492',
      HOST: '127.0.0.1',
      PORT: '3000',
      DATABASE_PATH: './data/test.sqlite'
    });

    expect(config.telegramChannelId).toBe('-1003976784492');
    expect(config.host).toBe('127.0.0.1');
  });

  it('rejects missing secrets', () => {
    expect(() => loadConfig({})).toThrow('TMDB_API_KEY is required');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/server/config.test.ts
```

Expected: FAIL because `src/server/config.ts` does not exist.

- [ ] **Step 3: Add config loader**

Create `src/server/config.ts`:

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  TMDB_API_KEY: z.string().min(1, 'TMDB_API_KEY is required'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_CHANNEL_ID: z.string().min(1, 'TELEGRAM_CHANNEL_ID is required'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default('./data/infinitylinks.sqlite')
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv) {
  const parsed = EnvSchema.parse(env);

  return {
    tmdbApiKey: parsed.TMDB_API_KEY,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChannelId: parsed.TELEGRAM_CHANNEL_ID,
    host: parsed.HOST,
    port: parsed.PORT,
    databasePath: parsed.DATABASE_PATH
  };
}
```

- [ ] **Step 4: Add media schemas**

Create `src/server/media/media.schemas.ts`:

```ts
import { z } from 'zod';

export const QualitySchema = z.enum(['SD', 'HD', 'Full HD', '2K', '4K']);
export const LinkStatusSchema = z.enum(['active', 'inactive']);

export const LinkInputSchema = z.object({
  providerName: z.string().min(1),
  quality: QualitySchema,
  status: LinkStatusSchema,
  url: z.string().url()
});

export const MovieInputSchema = z.object({
  tmdbId: z.number().int().optional(),
  title: z.string().min(1),
  year: z.number().int().optional(),
  posterUrl: z.string().url().optional().or(z.literal('')),
  description: z.string().default(''),
  rating: z.number().optional(),
  quality: QualitySchema,
  links: z.array(LinkInputSchema).default([])
});

export const TvShowInputSchema = z.object({
  tmdbId: z.number().int().optional(),
  title: z.string().min(1),
  year: z.number().int().optional(),
  posterUrl: z.string().url().optional().or(z.literal('')),
  description: z.string().default(''),
  rating: z.number().optional(),
  quality: QualitySchema
});

export const SeasonInputSchema = z.object({
  seasonNumber: z.number().int().positive()
});

export const BulkEpisodeInputSchema = z.object({
  startEpisode: z.number().int().positive(),
  count: z.number().int().positive().max(100)
});

export const EpisodeInputSchema = z.object({
  episodeNumber: z.number().int().positive()
});
```

- [ ] **Step 5: Wire config into server startup**

Modify `src/server/index.ts`:

```ts
import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig(process.env);

createApp().listen(config.port, config.host, () => {
  console.log(`InfinityLinks admin running at http://${config.host}:${config.port}`);
});
```

- [ ] **Step 6: Verify config and schemas**

Run:

```bash
npm test -- tests/server/config.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 7: Commit config and validation**

```bash
git add src/server/config.ts src/server/index.ts src/server/media/media.schemas.ts tests/server/config.test.ts
git commit -m "feat: validate configuration and media inputs"
```

## Task 4: Telegram Caption Formatter

**Files:**

- Create: `src/server/telegram/telegram.formatter.ts`
- Create: `tests/server/telegram.formatter.test.ts`

- [ ] **Step 1: Write formatter tests**

Create `tests/server/telegram.formatter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatMovieCaption, formatSeasonCaption } from '../../src/server/telegram/telegram.formatter';

describe('telegram formatter', () => {
  it('formats a movie caption with links directly in the caption', () => {
    const caption = formatMovieCaption({
      title: 'Inception',
      year: 2010,
      rating: 8.4,
      quality: 'Full HD',
      description: 'A thief enters dreams.',
      links: [
        { providerName: 'Provider A', quality: 'Full HD', status: 'active', url: 'https://example.com/inception' }
      ]
    });

    expect(caption).toContain('Inception (2010)');
    expect(caption).toContain('Rating: 8.4');
    expect(caption).toContain('Quality: Full HD');
    expect(caption).toContain('Provider A [Full HD, active]');
    expect(caption).toContain('https://example.com/inception');
  });

  it('omits TV episodes without links', () => {
    const caption = formatSeasonCaption({
      title: 'Example Show',
      seasonNumber: 1,
      year: 2024,
      rating: 7.2,
      quality: 'HD',
      description: 'Season description',
      episodes: [
        { episodeNumber: 1, links: [] },
        {
          episodeNumber: 2,
          links: [{ providerName: 'Provider B', quality: 'HD', status: 'active', url: 'https://example.com/s1e2' }]
        }
      ]
    });

    expect(caption).not.toContain('Episode 1');
    expect(caption).toContain('Episode 2');
    expect(caption).toContain('https://example.com/s1e2');
  });

  it('trims description before dropping required fields', () => {
    const caption = formatMovieCaption({
      title: 'Long Movie',
      year: 2026,
      rating: 9,
      quality: '4K',
      description: 'x'.repeat(5000),
      links: [{ providerName: 'P', quality: '4K', status: 'active', url: 'https://example.com/file' }]
    });

    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain('Long Movie (2026)');
    expect(caption).toContain('https://example.com/file');
  });
});
```

- [ ] **Step 2: Run formatter tests to verify failure**

Run:

```bash
npm test -- tests/server/telegram.formatter.test.ts
```

Expected: FAIL because formatter file does not exist.

- [ ] **Step 3: Add formatter implementation**

Create `src/server/telegram/telegram.formatter.ts`:

```ts
type LinkForCaption = {
  providerName: string;
  quality: string;
  status: string;
  url: string;
};

type MovieCaptionInput = {
  title: string;
  year?: number | null;
  rating?: number | null;
  quality: string;
  description: string;
  links: LinkForCaption[];
};

type SeasonCaptionInput = {
  title: string;
  seasonNumber: number;
  year?: number | null;
  rating?: number | null;
  quality: string;
  description: string;
  episodes: Array<{ episodeNumber: number; links: LinkForCaption[] }>;
};

const TELEGRAM_PHOTO_CAPTION_LIMIT = 1024;

export function formatMovieCaption(input: MovieCaptionInput) {
  const heading = `${input.title}${input.year ? ` (${input.year})` : ''}`;
  const links = formatLinks(input.links);
  return fitCaption({
    requiredParts: [heading, formatMeta(input.rating, input.quality), links],
    description: input.description
  });
}

export function formatSeasonCaption(input: SeasonCaptionInput) {
  const heading = `${input.title}${input.year ? ` (${input.year})` : ''} - Season ${input.seasonNumber}`;
  const episodeLines = input.episodes
    .filter((episode) => episode.links.length > 0)
    .map((episode) => [`Episode ${episode.episodeNumber}`, formatLinks(episode.links)].join('\n'))
    .join('\n\n');

  return fitCaption({
    requiredParts: [heading, formatMeta(input.rating, input.quality), episodeLines],
    description: input.description
  });
}

function formatMeta(rating: number | null | undefined, quality: string) {
  const ratingText = rating === null || rating === undefined ? 'N/A' : String(rating);
  return `Rating: ${ratingText}\nQuality: ${quality}`;
}

function formatLinks(links: LinkForCaption[]) {
  return links
    .map((link) => `${link.providerName} [${link.quality}, ${link.status}]\n${link.url}`)
    .join('\n');
}

function fitCaption(input: { requiredParts: string[]; description: string }) {
  const required = input.requiredParts.filter(Boolean).join('\n\n');
  const descriptionPrefix = input.description.trim() ? `\n\n${input.description.trim()}` : '';
  const full = `${required}${descriptionPrefix}`;

  if (full.length <= TELEGRAM_PHOTO_CAPTION_LIMIT) {
    return full;
  }

  const availableDescriptionLength = TELEGRAM_PHOTO_CAPTION_LIMIT - required.length - 5;
  if (availableDescriptionLength <= 0) {
    return required.slice(0, TELEGRAM_PHOTO_CAPTION_LIMIT);
  }

  return `${required}\n\n${input.description.trim().slice(0, availableDescriptionLength)}...`;
}
```

- [ ] **Step 4: Verify formatter**

Run:

```bash
npm test -- tests/server/telegram.formatter.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit formatter**

```bash
git add src/server/telegram/telegram.formatter.ts tests/server/telegram.formatter.test.ts
git commit -m "feat: format telegram media captions"
```

## Task 5: TMDB Search, Cache, And Route

**Files:**

- Create: `src/server/tmdb/tmdb.service.ts`
- Create: `src/server/tmdb/tmdb.routes.ts`
- Modify: `src/server/app.ts`
- Create: `tests/server/tmdb.service.test.ts`

- [ ] **Step 1: Write TMDB cache tests**

Create `tests/server/tmdb.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db/database';
import { migrate } from '../../src/server/db/migrate';
import { searchTmdb } from '../../src/server/tmdb/tmdb.service';

describe('searchTmdb', () => {
  it('uses cache after first successful search', async () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ id: 1, title: 'Inception', release_date: '2010-07-16', poster_path: '/poster.jpg', overview: 'Dreams', vote_average: 8.4 }]
      })
    });

    const first = await searchTmdb(db, fetcher as any, 'api-key', 'movie', 'ince');
    const second = await searchTmdb(db, fetcher as any, 'api-key', 'movie', 'ince');

    expect(first[0].title).toBe('Inception');
    expect(second[0].title).toBe('Inception');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run TMDB test to verify failure**

Run:

```bash
npm test -- tests/server/tmdb.service.test.ts
```

Expected: FAIL because `tmdb.service.ts` does not exist.

- [ ] **Step 3: Add TMDB service**

Create `src/server/tmdb/tmdb.service.ts`:

```ts
import type { AppDatabase } from '../db/database';

export type TmdbMediaType = 'movie' | 'tv';

export type TmdbResult = {
  tmdbId: number;
  title: string;
  year?: number;
  posterUrl?: string;
  description: string;
  rating?: number;
};

type Fetcher = typeof fetch;

const CACHE_MINUTES = 60;
const MIN_QUERY_LENGTH = 3;

export async function searchTmdb(
  db: AppDatabase,
  fetcher: Fetcher,
  apiKey: string,
  mediaType: TmdbMediaType,
  rawQuery: string
): Promise<TmdbResult[]> {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < MIN_QUERY_LENGTH) return [];

  const cached = db
    .prepare('SELECT result_payload FROM tmdb_cache WHERE media_type = ? AND query = ? AND expires_at > CURRENT_TIMESTAMP')
    .get(mediaType, query) as { result_payload: string } | undefined;

  if (cached) {
    return JSON.parse(cached.result_payload);
  }

  const url = new URL(`https://api.themoviedb.org/3/search/${mediaType}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', query);

  const response = await fetcher(url);
  if (!response.ok) {
    logApi(db, 'tmdb', 'search', 'failed', { mediaType, query }, undefined, `HTTP ${response.status}`);
    throw new Error(`TMDB search failed with status ${response.status}`);
  }

  const payload = await response.json();
  const results = normalizeResults(mediaType, payload.results ?? []);

  const expires = new Date(Date.now() + CACHE_MINUTES * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO tmdb_cache (media_type, query, result_payload, expires_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(media_type, query) DO UPDATE SET result_payload = excluded.result_payload, expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP`
  ).run(mediaType, query, JSON.stringify(results), expires);

  logApi(db, 'tmdb', 'search', 'succeeded', { mediaType, query }, `${results.length} results`, undefined);
  return results;
}

function normalizeResults(mediaType: TmdbMediaType, results: any[]): TmdbResult[] {
  return results.map((item) => {
    const title = mediaType === 'movie' ? item.title : item.name;
    const date = mediaType === 'movie' ? item.release_date : item.first_air_date;

    return {
      tmdbId: item.id,
      title,
      year: date ? Number(String(date).slice(0, 4)) : undefined,
      posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
      description: item.overview ?? '',
      rating: item.vote_average
    };
  });
}

function logApi(
  db: AppDatabase,
  provider: string,
  action: string,
  status: string,
  requestMetadata: object,
  responseSummary?: string,
  errorSummary?: string
) {
  db.prepare(
    'INSERT INTO api_logs (provider, action, status, request_metadata, response_summary, error_summary) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(provider, action, status, JSON.stringify(requestMetadata), responseSummary ?? null, errorSummary ?? null);
}
```

- [ ] **Step 4: Add TMDB route**

Create `src/server/tmdb/tmdb.routes.ts`:

```ts
import { Router } from 'express';
import type { AppConfig } from '../config';
import type { AppDatabase } from '../db/database';
import { searchTmdb, type TmdbMediaType } from './tmdb.service';

export function createTmdbRouter(db: AppDatabase, config: AppConfig) {
  const router = Router();

  router.get('/search', async (req, res, next) => {
    try {
      const mediaType = req.query.type === 'tv' ? 'tv' : 'movie';
      const query = String(req.query.query ?? '');
      const results = await searchTmdb(db, fetch, config.tmdbApiKey, mediaType as TmdbMediaType, query);
      res.json({ results });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

Modify `src/server/app.ts` so `createApp` accepts dependencies:

```ts
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './config';
import type { AppDatabase } from './db/database';
import { createTmdbRouter } from './tmdb/tmdb.routes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(deps?: { db?: AppDatabase; config?: AppConfig }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  if (deps?.db && deps.config) {
    app.use('/api/tmdb', createTmdbRouter(deps.db, deps.config));
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(500).json({ error: message });
  });

  const clientDist = path.resolve(__dirname, '../../dist/client');
  app.use(express.static(clientDist));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}
```

Modify `src/server/index.ts` to create and migrate the database:

```ts
import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/database';
import { migrate } from './db/migrate';

const config = loadConfig(process.env);
const db = createDatabase(config.databasePath);
migrate(db);

createApp({ db, config }).listen(config.port, config.host, () => {
  console.log(`InfinityLinks admin running at http://${config.host}:${config.port}`);
});
```

- [ ] **Step 5: Verify TMDB service**

Run:

```bash
npm test -- tests/server/tmdb.service.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit TMDB service**

```bash
git add src/server/app.ts src/server/index.ts src/server/tmdb tests/server/tmdb.service.test.ts
git commit -m "feat: add cached tmdb search"
```

## Task 6: Telegram Client And Queue

**Files:**

- Create: `src/server/telegram/telegram.client.ts`
- Create: `src/server/telegram/telegram.queue.ts`
- Create: `src/server/telegram/telegram.service.ts`
- Create: `tests/server/telegram.queue.test.ts`

- [ ] **Step 1: Write queue tests**

Create `tests/server/telegram.queue.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db/database';
import { migrate } from '../../src/server/db/migrate';
import { enqueueTelegramJob, processNextTelegramJob } from '../../src/server/telegram/telegram.queue';

describe('telegram queue', () => {
  it('processes one queued job successfully', async () => {
    const db = createDatabase(':memory:');
    migrate(db);
    const client = { sendPhotoPost: vi.fn().mockResolvedValue({ messageId: 123 }) };

    enqueueTelegramJob(db, {
      jobType: 'send',
      entityType: 'movie',
      entityId: 1,
      payload: { posterUrl: 'https://example.com/poster.jpg', caption: 'Movie' }
    });

    await processNextTelegramJob(db, client as any);

    const row = db.prepare('SELECT status FROM telegram_jobs').get() as { status: string };
    expect(row.status).toBe('succeeded');
    expect(client.sendPhotoPost).toHaveBeenCalledTimes(1);
  });

  it('waits before retrying Telegram rate limits', async () => {
    const db = createDatabase(':memory:');
    migrate(db);
    const error = Object.assign(new Error('Too Many Requests'), { retryAfter: 7 });
    const client = { sendPhotoPost: vi.fn().mockRejectedValue(error) };

    enqueueTelegramJob(db, {
      jobType: 'send',
      entityType: 'season',
      entityId: 9,
      payload: { posterUrl: 'https://example.com/poster.jpg', caption: 'Season' }
    });

    await processNextTelegramJob(db, client as any);

    const row = db.prepare('SELECT status, attempts, last_error FROM telegram_jobs').get() as any;
    expect(row.status).toBe('waiting_retry');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain('Too Many Requests');
  });
});
```

- [ ] **Step 2: Run queue tests to verify failure**

Run:

```bash
npm test -- tests/server/telegram.queue.test.ts
```

Expected: FAIL because queue module does not exist.

- [ ] **Step 3: Add Telegram client**

Create `src/server/telegram/telegram.client.ts`:

```ts
export type TelegramClientConfig = {
  botToken: string;
  channelId: string;
};

export type TelegramMessageResult = {
  messageId: number;
};

export class TelegramRateLimitError extends Error {
  constructor(public retryAfter: number, message = 'Telegram rate limit') {
    super(message);
  }
}

export function createTelegramClient(config: TelegramClientConfig) {
  const baseUrl = `https://api.telegram.org/bot${config.botToken}`;

  async function callTelegram(method: string, body: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await response.json();

    if (!response.ok || json.ok === false) {
      const retryAfter = json.parameters?.retry_after;
      if (response.status === 429 && retryAfter) {
        throw new TelegramRateLimitError(Number(retryAfter));
      }
      throw new Error(json.description ?? `Telegram ${method} failed`);
    }

    return json.result;
  }

  return {
    async sendPhotoPost(input: { posterUrl: string; caption: string }): Promise<TelegramMessageResult> {
      const result = await callTelegram('sendPhoto', {
        chat_id: config.channelId,
        photo: input.posterUrl,
        caption: input.caption
      });
      return { messageId: result.message_id };
    },

    async editPhotoCaption(input: { messageId: number; caption: string }) {
      await callTelegram('editMessageCaption', {
        chat_id: config.channelId,
        message_id: input.messageId,
        caption: input.caption
      });
    },

    async deleteMessage(input: { messageId: number }) {
      await callTelegram('deleteMessage', {
        chat_id: config.channelId,
        message_id: input.messageId
      });
    }
  };
}

export type TelegramClient = ReturnType<typeof createTelegramClient>;
```

- [ ] **Step 4: Add queue implementation**

Create `src/server/telegram/telegram.queue.ts`:

```ts
import type { AppDatabase } from '../db/database';
import type { TelegramClient } from './telegram.client';

type TelegramJobInput = {
  jobType: 'send' | 'edit' | 'delete';
  entityType: 'movie' | 'season';
  entityId: number;
  payload: Record<string, unknown>;
};

export function enqueueTelegramJob(db: AppDatabase, input: TelegramJobInput) {
  db.prepare(
    `INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status)
     VALUES (?, ?, ?, ?, 'queued')`
  ).run(input.jobType, input.entityType, input.entityId, JSON.stringify(input.payload));
}

export async function processNextTelegramJob(db: AppDatabase, client: TelegramClient) {
  const job = db
    .prepare(
      `SELECT * FROM telegram_jobs
       WHERE status IN ('queued', 'waiting_retry') AND next_run_at <= CURRENT_TIMESTAMP
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get() as any;

  if (!job) return false;

  db.prepare("UPDATE telegram_jobs SET status = 'running', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);

  try {
    const payload = JSON.parse(job.payload);
    if (job.job_type === 'send') {
      await client.sendPhotoPost(payload);
    }
    if (job.job_type === 'edit') {
      await client.editPhotoCaption(payload);
    }
    if (job.job_type === 'delete') {
      await client.deleteMessage(payload);
    }

    db.prepare("UPDATE telegram_jobs SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
    return true;
  } catch (error: any) {
    const retryAfter = Number(error.retryAfter ?? 0);
    const status = retryAfter > 0 ? 'waiting_retry' : 'failed';
    const nextRunAt = retryAfter > 0 ? new Date(Date.now() + retryAfter * 1000).toISOString() : new Date().toISOString();

    db.prepare(
      `UPDATE telegram_jobs
       SET status = ?, next_run_at = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(status, nextRunAt, error instanceof Error ? error.message : String(error), job.id);
    return false;
  }
}
```

Create `src/server/telegram/telegram.service.ts`:

```ts
import type { AppDatabase } from '../db/database';
import { enqueueTelegramJob } from './telegram.queue';

export function queueSendPost(db: AppDatabase, entityType: 'movie' | 'season', entityId: number, posterUrl: string, caption: string) {
  enqueueTelegramJob(db, { jobType: 'send', entityType, entityId, payload: { posterUrl, caption } });
}

export function queueEditPost(db: AppDatabase, entityType: 'movie' | 'season', entityId: number, messageId: number, caption: string) {
  enqueueTelegramJob(db, { jobType: 'edit', entityType, entityId, payload: { messageId, caption } });
}

export function queueDeletePost(db: AppDatabase, entityType: 'movie' | 'season', entityId: number, messageId: number) {
  enqueueTelegramJob(db, { jobType: 'delete', entityType, entityId, payload: { messageId } });
}
```

- [ ] **Step 5: Verify queue**

Run:

```bash
npm test -- tests/server/telegram.queue.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit Telegram queue**

```bash
git add src/server/telegram tests/server/telegram.queue.test.ts
git commit -m "feat: add telegram queue and client"
```

## Task 7: Movies Backend CRUD And Telegram Triggers

**Files:**

- Create: `src/server/media/media.repository.ts`
- Create: `src/server/media/media.service.ts`
- Create: `src/server/media/media.routes.ts`
- Modify: `src/server/app.ts`
- Create: `tests/server/media.movies.test.ts`

- [ ] **Step 1: Write movie API tests**

Create `tests/server/media.movies.test.ts` with `supertest` after adding `supertest` and `@types/supertest` as dev dependencies:

```bash
npm install -D supertest @types/supertest
```

Test file:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createDatabase } from '../../src/server/db/database';
import { migrate } from '../../src/server/db/migrate';

function testApp() {
  const db = createDatabase(':memory:');
  migrate(db);
  const app = createApp({ db, config: {
    tmdbApiKey: 'tmdb',
    telegramBotToken: 'telegram',
    telegramChannelId: '-1003976784492',
    host: '127.0.0.1',
    port: 3000,
    databasePath: ':memory:'
  } });
  return { app, db };
}

describe('movie API', () => {
  it('creates a movie with links and queues a Telegram send', async () => {
    const { app, db } = testApp();

    const response = await request(app)
      .post('/api/movies')
      .send({
        tmdbId: 1,
        title: 'Inception',
        year: 2010,
        posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
        description: 'Dreams',
        rating: 8.4,
        quality: 'Full HD',
        links: [{ providerName: 'Provider A', quality: 'Full HD', status: 'active', url: 'https://example.com/inception' }]
      })
      .expect(201);

    expect(response.body.movie.title).toBe('Inception');
    const jobs = db.prepare('SELECT * FROM telegram_jobs').all();
    expect(jobs).toHaveLength(1);
  });

  it('lists movies with title filter', async () => {
    const { app } = testApp();
    await request(app).post('/api/movies').send({ title: 'A Movie', description: '', quality: 'HD', links: [] });
    const response = await request(app).get('/api/movies?title=A').expect(200);
    expect(response.body.movies).toHaveLength(1);
  });

  it('deletes a movie permanently', async () => {
    const { app, db } = testApp();
    const created = await request(app).post('/api/movies').send({ title: 'Delete Me', description: '', quality: 'HD', links: [] });
    await request(app).delete(`/api/movies/${created.body.movie.id}`).expect(204);
    const rows = db.prepare('SELECT * FROM movies').all();
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run movie API tests to verify failure**

Run:

```bash
npm test -- tests/server/media.movies.test.ts
```

Expected: FAIL because movie routes do not exist.

- [ ] **Step 3: Add repository functions**

Create `src/server/media/media.repository.ts` with these exports:

```ts
import type { AppDatabase } from '../db/database';

export function listMovies(db: AppDatabase, filters: { title?: string; year?: number }) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.title) {
    clauses.push('title LIKE ?');
    params.push(`%${filters.title}%`);
  }
  if (filters.year) {
    clauses.push('year = ?');
    params.push(filters.year);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM movies ${where} ORDER BY id DESC`).all(...params);
}

export function getMovieWithLinks(db: AppDatabase, id: number) {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(id) as any;
  if (!movie) return undefined;
  const links = db.prepare('SELECT * FROM movie_links WHERE movie_id = ? ORDER BY sort_order ASC, id ASC').all(id);
  return { ...movie, links };
}

export function createMovieWithLinks(db: AppDatabase, input: any) {
  const tx = db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO movies (tmdb_id, title, year, poster_url, description, rating, quality)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(input.tmdbId ?? null, input.title, input.year ?? null, input.posterUrl ?? null, input.description ?? '', input.rating ?? null, input.quality);

    input.links.forEach((link: any, index: number) => {
      db.prepare(
        `INSERT INTO movie_links (movie_id, provider_name, quality, status, url, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(result.lastInsertRowid, link.providerName, link.quality, link.status, link.url, index);
    });

    return Number(result.lastInsertRowid);
  });

  return getMovieWithLinks(db, tx())!;
}

export function deleteMovie(db: AppDatabase, id: number) {
  const movie = getMovieWithLinks(db, id);
  if (!movie) return undefined;
  db.prepare('DELETE FROM movies WHERE id = ?').run(id);
  return movie;
}
```

- [ ] **Step 4: Add media service and routes**

Create `src/server/media/media.service.ts`:

```ts
import type { AppDatabase } from '../db/database';
import { formatMovieCaption } from '../telegram/telegram.formatter';
import { queueDeletePost, queueSendPost } from '../telegram/telegram.service';
import { createMovieWithLinks, deleteMovie, listMovies } from './media.repository';
import { MovieInputSchema } from './media.schemas';

export function createMovie(db: AppDatabase, body: unknown) {
  const input = MovieInputSchema.parse(body);
  const movie = createMovieWithLinks(db, input);

  if (movie.links.length > 0 && movie.poster_url) {
    queueSendPost(db, 'movie', movie.id, movie.poster_url, formatMovieCaption({
      title: movie.title,
      year: movie.year,
      rating: movie.rating,
      quality: movie.quality,
      description: movie.description,
      links: movie.links.map((link: any) => ({
        providerName: link.provider_name,
        quality: link.quality,
        status: link.status,
        url: link.url
      }))
    }));
  }

  return movie;
}

export function searchMovies(db: AppDatabase, query: { title?: string; year?: string }) {
  return listMovies(db, {
    title: query.title,
    year: query.year ? Number(query.year) : undefined
  });
}

export function removeMovie(db: AppDatabase, id: number) {
  const movie = deleteMovie(db, id);
  if (movie?.telegram_message_id) {
    queueDeletePost(db, 'movie', movie.id, movie.telegram_message_id);
  }
}
```

Create `src/server/media/media.routes.ts`:

```ts
import { Router } from 'express';
import type { AppDatabase } from '../db/database';
import { createMovie, removeMovie, searchMovies } from './media.service';

export function createMediaRouter(db: AppDatabase) {
  const router = Router();

  router.get('/movies', (req, res) => {
    res.json({ movies: searchMovies(db, req.query as any) });
  });

  router.post('/movies', (req, res, next) => {
    try {
      res.status(201).json({ movie: createMovie(db, req.body) });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/movies/:id', (req, res) => {
    removeMovie(db, Number(req.params.id));
    res.status(204).send();
  });

  return router;
}
```

Modify `src/server/app.ts` to mount media routes when `db` exists:

```ts
import { createMediaRouter } from './media/media.routes';
```

Inside `if (deps?.db && deps.config)`:

```ts
app.use('/api', createMediaRouter(deps.db));
```

- [ ] **Step 5: Verify movie backend**

Run:

```bash
npm test -- tests/server/media.movies.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit movie backend**

```bash
git add package.json package-lock.json src/server/media src/server/app.ts tests/server/media.movies.test.ts
git commit -m "feat: add movie crud backend"
```

## Task 8: Movies UI

**Files:**

- Create: `src/client/api/http.ts`
- Create: `src/client/components/Sidebar.tsx`
- Create: `src/client/components/ActionMenu.tsx`
- Create: `src/client/components/ConfirmDialog.tsx`
- Create: `src/client/components/TmdbSearch.tsx`
- Create: `src/client/components/LinkEditorModal.tsx`
- Create: `src/client/components/ToastProvider.tsx`
- Create: `src/client/pages/MoviesPage.tsx`
- Create: `src/client/pages/MovieForm.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`
- Create: `tests/client/App.test.tsx`

- [ ] **Step 1: Write navigation smoke test**

Create `tests/client/App.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';

describe('App', () => {
  it('shows movie and TV show navigation', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /movies/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tv shows/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add movie/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run UI test to verify failure**

Run:

```bash
npm test -- tests/client/App.test.tsx
```

Expected: FAIL because the current app has no sidebar links.

- [ ] **Step 3: Add HTTP helper**

Create `src/client/api/http.ts`:

```ts
export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error ?? response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
```

- [ ] **Step 4: Add sidebar and app routing state**

Create `src/client/components/Sidebar.tsx`:

```tsx
import { Film, Plus, Tv } from 'lucide-react';

type SidebarProps = {
  currentPage: string;
  onNavigate: (page: string) => void;
};

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand">InfinityLinks</div>
      <button className={currentPage === 'movies' ? 'nav-parent active' : 'nav-parent'} onClick={() => onNavigate('movies')}>
        <Film size={18} /> Movies
      </button>
      <a href="#add-movie" onClick={(event) => { event.preventDefault(); onNavigate('add-movie'); }}>
        <Plus size={16} /> Add Movie
      </a>
      <button className={currentPage === 'tv-shows' ? 'nav-parent active' : 'nav-parent'} onClick={() => onNavigate('tv-shows')}>
        <Tv size={18} /> TV Shows
      </button>
      <a href="#add-tv-show" onClick={(event) => { event.preventDefault(); onNavigate('add-tv-show'); }}>
        <Plus size={16} /> Add TV Show
      </a>
    </aside>
  );
}
```

Modify `src/client/App.tsx`:

```tsx
import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { MovieForm } from './pages/MovieForm';
import { MoviesPage } from './pages/MoviesPage';

export function App() {
  const [page, setPage] = useState('movies');

  return (
    <div className="admin-layout">
      <Sidebar currentPage={page} onNavigate={setPage} />
      <main className="content">
        {page === 'movies' && <MoviesPage onAddMovie={() => setPage('add-movie')} />}
        {page === 'add-movie' && <MovieForm onSaved={() => setPage('movies')} />}
        {page === 'tv-shows' && <section><h1>TV Shows</h1></section>}
        {page === 'add-tv-show' && <section><h1>Add TV Show</h1></section>}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Add Movies page and form**

Create `src/client/pages/MoviesPage.tsx` with title/year filters, table columns, and action menu. Create `src/client/pages/MovieForm.tsx` with TMDB search, quality select, and link editor. Use these API calls:

```ts
await apiJson<{ movies: any[] }>(`/api/movies?title=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}`);
await apiJson<{ movie: any }>('/api/movies', { method: 'POST', body: JSON.stringify(formState) });
await apiJson<void>(`/api/movies/${movie.id}`, { method: 'DELETE' });
```

The form state shape must match `MovieInputSchema`:

```ts
{
  tmdbId?: number;
  title: string;
  year?: number;
  posterUrl?: string;
  description: string;
  rating?: number;
  quality: 'SD' | 'HD' | 'Full HD' | '2K' | '4K';
  links: Array<{ providerName: string; quality: string; status: 'active' | 'inactive'; url: string; }>;
}
```

- [ ] **Step 6: Add shared UI components**

Create:

- `ActionMenu.tsx`: renders a compact button that opens Edit/Delete commands.
- `ConfirmDialog.tsx`: renders a modal with Cancel and Delete buttons.
- `TmdbSearch.tsx`: debounces input by 350ms, waits for 3 characters, calls `/api/tmdb/search?type=movie&query=...`, and calls `onSelect(result)`.
- `LinkEditorModal.tsx`: lets the admin add one or more provider/quality/status/url rows.
- `ToastProvider.tsx`: exposes a simple `showToast(message)` hook and renders dismissible messages.

- [ ] **Step 7: Add responsive admin CSS**

Modify `src/client/styles.css` so:

- At widths below 760px, sidebar becomes a top section and content uses single-column cards.
- Tables use horizontal overflow instead of squeezing text.
- Buttons have stable heights.
- Cards use border radius no larger than `8px`.
- The palette uses neutral backgrounds with blue and green accents, avoiding a one-hue page.

- [ ] **Step 8: Verify Movies UI**

Run:

```bash
npm test -- tests/client/App.test.tsx
npm run build
```

Expected: UI test and build pass.

- [ ] **Step 9: Commit Movies UI**

```bash
git add src/client tests/client/App.test.tsx
git commit -m "feat: add movie admin ui"
```

## Task 9: TV Shows, Seasons, Episodes Backend

**Files:**

- Modify: `src/server/media/media.repository.ts`
- Modify: `src/server/media/media.service.ts`
- Modify: `src/server/media/media.routes.ts`
- Create: `tests/server/media.tv.test.ts`

- [ ] **Step 1: Write TV backend tests**

Create `tests/server/media.tv.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createDatabase } from '../../src/server/db/database';
import { migrate } from '../../src/server/db/migrate';

function testApp() {
  const db = createDatabase(':memory:');
  migrate(db);
  const app = createApp({ db, config: {
    tmdbApiKey: 'tmdb',
    telegramBotToken: 'telegram',
    telegramChannelId: '-1003976784492',
    host: '127.0.0.1',
    port: 3000,
    databasePath: ':memory:'
  } });
  return { app, db };
}

describe('TV API', () => {
  it('creates a show, season, multiple episodes, and episode links', async () => {
    const { app, db } = testApp();

    const show = await request(app).post('/api/tv-shows').send({
      title: 'Example Show',
      year: 2026,
      posterUrl: 'https://image.tmdb.org/t/p/w500/show.jpg',
      description: 'Show description',
      rating: 7.8,
      quality: 'HD'
    }).expect(201);

    const season = await request(app).post(`/api/tv-shows/${show.body.tvShow.id}/seasons`).send({ seasonNumber: 1 }).expect(201);
    await request(app).post(`/api/seasons/${season.body.season.id}/episodes/bulk`).send({ startEpisode: 1, count: 3 }).expect(201);
    await request(app).post('/api/episodes/2/links').send({
      links: [{ providerName: 'Provider A', quality: 'HD', status: 'active', url: 'https://example.com/s1e2' }]
    }).expect(201);

    const jobs = db.prepare('SELECT * FROM telegram_jobs').all();
    expect(jobs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run TV tests to verify failure**

Run:

```bash
npm test -- tests/server/media.tv.test.ts
```

Expected: FAIL because TV routes do not exist.

- [ ] **Step 3: Add TV repository functions**

Extend `media.repository.ts` with functions to:

- `listTvShows(db, filters)`
- `createTvShow(db, input)`
- `deleteTvShow(db, id)`
- `createSeason(db, tvShowId, input)`
- `listSeasons(db, tvShowId)`
- `deleteSeason(db, id)`
- `bulkCreateEpisodes(db, seasonId, input)`
- `listEpisodes(db, seasonId)`
- `addEpisodeLinks(db, episodeId, links)`
- `getSeasonPostData(db, seasonId)`

`getSeasonPostData` must return show metadata, season metadata, and episodes with links so `formatSeasonCaption` can omit episodes without links.

- [ ] **Step 4: Add TV service functions**

Extend `media.service.ts` with service functions that:

- Validate TV show body with `TvShowInputSchema`.
- Validate season body with `SeasonInputSchema`.
- Validate bulk episode body with `BulkEpisodeInputSchema`.
- Validate link rows with `LinkInputSchema.array()`.
- Queue a season send when the first episode link is added and `telegram_message_id` is empty.
- Queue a season edit when later links are added and `telegram_message_id` exists.
- Queue deletes for season posts when seasons or TV shows are deleted.

- [ ] **Step 5: Add TV routes**

Extend `media.routes.ts` with:

```text
GET    /api/tv-shows
POST   /api/tv-shows
DELETE /api/tv-shows/:id
GET    /api/tv-shows/:id/seasons
POST   /api/tv-shows/:id/seasons
DELETE /api/seasons/:id
GET    /api/seasons/:id/episodes
POST   /api/seasons/:id/episodes/bulk
DELETE /api/episodes/:id
POST   /api/episodes/:id/links
DELETE /api/episode-links/:id
```

- [ ] **Step 6: Verify TV backend**

Run:

```bash
npm test -- tests/server/media.tv.test.ts
npm test -- tests/server/media.movies.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 7: Commit TV backend**

```bash
git add src/server/media tests/server/media.tv.test.ts
git commit -m "feat: add tv show season episode backend"
```

## Task 10: TV Shows, Seasons, Episodes UI

**Files:**

- Create: `src/client/pages/TvShowsPage.tsx`
- Create: `src/client/pages/TvShowForm.tsx`
- Create: `src/client/pages/SeasonPage.tsx`
- Create: `src/client/pages/EpisodePage.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/TmdbSearch.tsx`

- [ ] **Step 1: Extend UI test**

Modify `tests/client/App.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';

describe('App', () => {
  it('shows movie and TV show navigation', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /movies/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tv shows/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add movie/i })).toBeInTheDocument();
  });

  it('navigates to add TV show', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: /add tv show/i }));
    expect(screen.getByRole('heading', { name: /add tv show/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run UI tests to verify failure**

Run:

```bash
npm test -- tests/client/App.test.tsx
```

Expected: FAIL if Add TV Show still renders only a stub without the required form.

- [ ] **Step 3: Add TV pages**

Create:

- `TvShowsPage.tsx`: title/year filters, ID/title/description/year/action columns, actions Add Season/Edit/Delete.
- `TvShowForm.tsx`: TMDB search with `type="tv"`, autofill metadata, main quality select.
- `SeasonPage.tsx`: seasons table with ID/season number/actions and add season modal.
- `EpisodePage.tsx`: episode table with ID/episode number/links/actions, bulk add episodes form, and add link modal.

Use these route calls:

```ts
apiJson<{ tvShows: any[] }>('/api/tv-shows');
apiJson<{ tvShow: any }>('/api/tv-shows', { method: 'POST', body: JSON.stringify(input) });
apiJson<{ season: any }>(`/api/tv-shows/${showId}/seasons`, { method: 'POST', body: JSON.stringify({ seasonNumber }) });
apiJson<{ episodes: any[] }>(`/api/seasons/${seasonId}/episodes/bulk`, { method: 'POST', body: JSON.stringify({ startEpisode, count }) });
apiJson(`/api/episodes/${episodeId}/links`, { method: 'POST', body: JSON.stringify({ links }) });
```

- [ ] **Step 4: Wire app page state**

Modify `src/client/App.tsx` so TV navigation renders the new pages and passes selected IDs through component state:

```ts
const [selectedShowId, setSelectedShowId] = useState<number | null>(null);
const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null);
```

Route states:

- `tv-shows`
- `add-tv-show`
- `seasons`
- `episodes`

- [ ] **Step 5: Verify TV UI**

Run:

```bash
npm test -- tests/client/App.test.tsx
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit TV UI**

```bash
git add src/client tests/client/App.test.tsx
git commit -m "feat: add tv show admin ui"
```

## Task 11: Telegram Worker Startup And Post Status Updates

**Files:**

- Modify: `src/server/telegram/telegram.queue.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/media/media.repository.ts`
- Modify: `tests/server/telegram.queue.test.ts`

- [ ] **Step 1: Add queue status update test**

Extend `tests/server/telegram.queue.test.ts` with:

```ts
it('stores sent Telegram message id on the movie record', async () => {
  const db = createDatabase(':memory:');
  migrate(db);
  db.prepare("INSERT INTO movies (title, description, quality) VALUES ('Movie', '', 'HD')").run();

  const client = { sendPhotoPost: vi.fn().mockResolvedValue({ messageId: 777 }) };
  enqueueTelegramJob(db, {
    jobType: 'send',
    entityType: 'movie',
    entityId: 1,
    payload: { posterUrl: 'https://example.com/poster.jpg', caption: 'Movie' }
  });

  await processNextTelegramJob(db, client as any);

  const movie = db.prepare('SELECT telegram_message_id, post_status FROM movies WHERE id = 1').get() as any;
  expect(movie.telegram_message_id).toBe(777);
  expect(movie.post_status).toBe('posted');
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- tests/server/telegram.queue.test.ts
```

Expected: FAIL because queue does not update entity post status.

- [ ] **Step 3: Update queue success handling**

Modify `processNextTelegramJob` so:

- `send` stores returned `messageId` on `movies.telegram_message_id` or `seasons.telegram_message_id`.
- `send` sets entity `post_status` to `posted`.
- `edit` sets entity `post_status` to `posted`.
- `delete` sets entity `post_status` to `deleted`.
- non-rate-limit failure sets entity `post_status` to `failed`.

Add helper:

```ts
function updateEntityPostStatus(db: AppDatabase, entityType: string, entityId: number, values: { messageId?: number; postStatus: string }) {
  const table = entityType === 'movie' ? 'movies' : 'seasons';
  if (values.messageId) {
    db.prepare(`UPDATE ${table} SET telegram_message_id = ?, post_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(values.messageId, values.postStatus, entityId);
    return;
  }
  db.prepare(`UPDATE ${table} SET post_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(values.postStatus, entityId);
}
```

- [ ] **Step 4: Start queue loop in server**

Modify `src/server/index.ts`:

```ts
import { createTelegramClient } from './telegram/telegram.client';
import { processNextTelegramJob } from './telegram/telegram.queue';
```

After `migrate(db)`:

```ts
const telegramClient = createTelegramClient({
  botToken: config.telegramBotToken,
  channelId: config.telegramChannelId
});

setInterval(() => {
  processNextTelegramJob(db, telegramClient).catch((error) => {
    console.error('Telegram queue error', error);
  });
}, 1500);
```

- [ ] **Step 5: Verify worker**

Run:

```bash
npm test -- tests/server/telegram.queue.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit queue worker**

```bash
git add src/server/telegram/telegram.queue.ts src/server/index.ts tests/server/telegram.queue.test.ts
git commit -m "feat: update telegram post status from queue"
```

## Task 12: Final Local Run Verification

**Files:**

- Modify: `README.md`
- Modify: `.gitignore` if generated files reveal missing local artifacts

- [ ] **Step 1: Add README**

Create `README.md`:

```md
# InfinityLinks

Local Telegram media admin for movies and TV shows.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example` and add regenerated credentials:

   ```env
   TMDB_API_KEY=replace_with_your_tmdb_api_key
   TELEGRAM_BOT_TOKEN=replace_with_your_telegram_bot_token
   TELEGRAM_CHANNEL_ID=-1003976784492
   HOST=127.0.0.1
   PORT=3000
   DATABASE_PATH=./data/infinitylinks.sqlite
   ```

3. Start the local app:

   ```bash
   npm run dev
   ```

4. Open:

   ```text
   http://127.0.0.1:3000
   ```

## MVP Scope

- Telegram channel posting only.
- No login, no roles, one local admin.
- Movies post after saving with at least one link.
- TV shows post one Telegram message per season after the first linked episode.
- Telegram buttons are not used.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run build
npm run db:migrate
```

Expected:

- all tests pass
- production client builds
- SQLite database migrates

- [ ] **Step 3: Start local server**

Run:

```bash
npm run dev
```

Expected:

```text
InfinityLinks admin running at http://127.0.0.1:3000
```

Open `http://127.0.0.1:3000` and verify:

- Movies page loads.
- Add Movie page opens.
- TV Shows page loads.
- Add TV Show page opens.
- Sidebar is usable at a narrow mobile viewport.

- [ ] **Step 4: Commit docs and final polish**

```bash
git add README.md .gitignore
git commit -m "docs: add local run instructions"
```

## Plan Self-Review

Spec coverage:

- Localhost-only Node/Express/SQLite/React app: Tasks 1, 2, 12.
- Env vars and no hardcoded secrets: Tasks 1, 3, 12.
- TMDB search dropdown, debounce, minimum length, cache, logs: Tasks 5, 8, 10.
- Movies table, add/edit surface, links, immediate Telegram post: Tasks 7, 8.
- TV shows, seasons, episodes, bulk episode creation, modal link creation: Tasks 9, 10.
- One Telegram post per season and only linked episodes included: Tasks 4, 9, 11.
- Telegram photo posts with direct links and trimmed descriptions: Task 4.
- Telegram queue and rate-limit retry handling: Tasks 6, 11.
- Permanent delete with Telegram delete/edit behavior: Tasks 7, 9, 10.
- Tests for risky behavior: Tasks 2 through 11.

Placeholder scan:

- The plan contains concrete files, commands, test cases, route shapes, schema definitions, and service boundaries.
- No section depends on hidden prior context outside the approved spec and this plan.

Type consistency:

- Quality values are `SD`, `HD`, `Full HD`, `2K`, `4K`.
- Link statuses are `active` and `inactive`.
- Post statuses are `pending`, `posted`, `failed`, and `deleted`.
- Telegram job statuses are `queued`, `running`, `succeeded`, `failed`, and `waiting_retry`.

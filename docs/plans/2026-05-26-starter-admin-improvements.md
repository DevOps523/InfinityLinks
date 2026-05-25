# Starter Admin Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a small, useful batch of admin improvements: a dashboard, duplicate-title warnings, sort controls, failed Telegram job retry controls, and a Public Search preview.

**Architecture:** Keep the local admin app private and reuse the existing Express, React, SQLite, and Vitest patterns. Add narrow read endpoints for dashboard, duplicate checks, failed Telegram jobs, and Public Search preview, then expose them through lightweight React pages or controls without changing the public VPS bot contract.

**Tech Stack:** TypeScript, Express, better-sqlite3, React, lucide-react, Vitest, Testing Library.

---

### Task 1: Add Admin Dashboard Counts

**Files:**
- Create: `src/server/admin/admin.repository.ts`
- Create: `src/server/admin/admin.service.ts`
- Create: `src/server/admin/admin.routes.ts`
- Modify: `src/server/app.ts`
- Create: `tests/server/admin.dashboard.test.ts`
- Create: `src/client/pages/DashboardPage.tsx`
- Modify: `src/client/components/Sidebar.tsx`
- Modify: `src/client/App.tsx`
- Modify: `tests/client/App.test.tsx`

**Step 1: Write the failing server test**

Create `tests/server/admin.dashboard.test.ts`.

```ts
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

describe('admin dashboard', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns dashboard counts for local admin health', async () => {
    db.prepare(
      `INSERT INTO movies (title, description, quality, post_status, telegram_message_id)
       VALUES ('Movie One', '', 'HD', 'posted', 100)`
    ).run();
    db.prepare(
      `INSERT INTO movie_links (movie_id, provider_name, quality, status, url)
       VALUES (1, 'Provider', 'HD', 'active', 'https://example.com/movie')`
    ).run();
    db.prepare(
      `INSERT INTO tv_shows (title, description, quality)
       VALUES ('Show One', '', 'HD')`
    ).run();
    db.prepare(
      `INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status, last_error)
       VALUES ('send', 'movie', 1, '{}', 'failed', 'Telegram failed')`
    ).run();

    const app = createApp({
      db,
      config: {
        host: '127.0.0.1',
        port: 3000,
        databasePath: ':memory:',
        tmdbApiKey: undefined,
        telegramBotToken: undefined,
        telegramChannelId: '-1001',
        publicSearchSyncUrl: 'https://public.example/api/sync',
        publicSearchSyncToken: 'sync-token',
        publicSearchStatusUrl: undefined,
        publicSearchStatusToken: undefined,
        publicSearchGroupHandle: '@infinitylinks69'
      }
    });

    const response = await request(app).get('/api/admin/dashboard').expect(200);

    expect(response.body.dashboard).toEqual({
      movies: 1,
      tvShows: 1,
      activeLinks: 1,
      failedTelegramJobs: 1,
      pendingPublicSearchChanges: true
    });
  });
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npm.cmd test -- tests/server/admin.dashboard.test.ts
```

Expected: FAIL because `/api/admin/dashboard` does not exist.

**Step 3: Implement the repository**

Create `src/server/admin/admin.repository.ts`.

```ts
import type { AppDatabase } from '../db/database.js';

export type AdminDashboardCounts = {
  movies: number;
  tvShows: number;
  activeLinks: number;
  failedTelegramJobs: number;
};

function getCount(db: AppDatabase, sql: string) {
  const row = db.prepare(sql).get() as { count: number };
  return row.count;
}

export function getAdminDashboardCounts(db: AppDatabase): AdminDashboardCounts {
  return {
    movies: getCount(db, `SELECT COUNT(*) AS count FROM movies`),
    tvShows: getCount(db, `SELECT COUNT(*) AS count FROM tv_shows`),
    activeLinks: getCount(
      db,
      `SELECT COUNT(*) AS count
         FROM (
           SELECT id FROM movie_links WHERE status = 'active'
           UNION ALL
           SELECT id FROM episode_links WHERE status = 'active'
         ) active_links`
    ),
    failedTelegramJobs: getCount(db, `SELECT COUNT(*) AS count FROM telegram_jobs WHERE status = 'failed'`)
  };
}
```

**Step 4: Implement the service**

Create `src/server/admin/admin.service.ts`.

```ts
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { getPublicSearchSyncStatus } from '../public-search/sync.service.js';
import { getAdminDashboardCounts } from './admin.repository.js';

export function getAdminDashboard(db: AppDatabase, config: AppConfig) {
  const counts = getAdminDashboardCounts(db);
  const syncStatus = getPublicSearchSyncStatus(db, config);

  return {
    ...counts,
    pendingPublicSearchChanges: syncStatus.hasPendingChanges
  };
}
```

**Step 5: Add the route and mount it**

Create `src/server/admin/admin.routes.ts`.

```ts
import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { getAdminDashboard } from './admin.service.js';

export function createAdminRouter(db: AppDatabase, config: AppConfig) {
  const router = Router();

  router.get('/admin/dashboard', (_req, res, next) => {
    try {
      res.json({ dashboard: getAdminDashboard(db, config) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

In `src/server/app.ts`, import and mount the router near the existing API routers.

```ts
import { createAdminRouter } from './admin/admin.routes.js';
```

```ts
app.use('/api', createAdminRouter(db, config));
```

**Step 6: Run the server test to verify it passes**

Run:

```bash
npm.cmd test -- tests/server/admin.dashboard.test.ts
```

Expected: PASS.

**Step 7: Write the failing client test**

In `tests/client/App.test.tsx`, add a dashboard test. Extend the default `fetchMock` so `/api/admin/dashboard` returns a dashboard payload when this test runs.

```ts
it('renders the dashboard with local admin counts', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/admin/dashboard') {
      return {
        ok: true,
        json: async () => ({
          dashboard: {
            movies: 2,
            tvShows: 1,
            activeLinks: 5,
            failedTelegramJobs: 1,
            pendingPublicSearchChanges: true
          }
        })
      };
    }

    return {
      ok: true,
      json: async () => ({ movies: [] })
    };
  });

  render(<App />);

  const navigation = screen.getByRole('navigation', { name: /media navigation/i });
  fireEvent.click(within(navigation).getByRole('button', { name: /^dashboard$/i }));

  expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getByText('Pending public search sync')).toBeInTheDocument();
});
```

**Step 8: Run the client test to verify it fails**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: FAIL because the Dashboard navigation/page does not exist.

**Step 9: Implement the Dashboard page**

Create `src/client/pages/DashboardPage.tsx`.

```tsx
import { AlertTriangle, Film, Link as LinkIcon, RefreshCw, Tv } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiJson } from '../api/http';

type DashboardPayload = {
  movies: number;
  tvShows: number;
  activeLinks: number;
  failedTelegramJobs: number;
  pendingPublicSearchChanges: boolean;
};

const cards = [
  { key: 'movies', label: 'Movies', icon: Film },
  { key: 'tvShows', label: 'TV Shows', icon: Tv },
  { key: 'activeLinks', label: 'Active Links', icon: LinkIcon },
  { key: 'failedTelegramJobs', label: 'Failed Telegram Jobs', icon: AlertTriangle }
] as const;

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    apiJson<{ dashboard: DashboardPayload }>('/api/admin/dashboard', { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setDashboard(payload.dashboard);
        }
      })
      .catch((loadError) => {
        if ((loadError as { name?: string }).name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load dashboard.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Quick local admin status for the catalog and publishing queue.</p>
        </div>
      </div>

      {isLoading ? <div className="state-panel">Loading dashboard...</div> : null}
      {!isLoading && error ? <div className="state-panel state-panel--error">{error}</div> : null}
      {!isLoading && dashboard ? (
        <>
          <div className="metric-grid">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <article className="metric-card" key={card.key}>
                  <Icon aria-hidden="true" size={20} />
                  <span>{card.label}</span>
                  <strong>{dashboard[card.key]}</strong>
                </article>
              );
            })}
          </div>
          <div className="state-panel">
            <RefreshCw aria-hidden="true" size={18} />
            {dashboard.pendingPublicSearchChanges ? 'Pending public search sync' : 'Public search is synced'}
          </div>
        </>
      ) : null}
    </section>
  );
}
```

Add minimal CSS to `src/client/styles.css`.

```css
.metric-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.metric-card {
  align-items: flex-start;
  background: #ffffff;
  border: 1px solid #d9e2ec;
  border-radius: 8px;
  display: grid;
  gap: 0.5rem;
  padding: 1rem;
}

.metric-card strong {
  font-size: 2rem;
  line-height: 1;
}
```

**Step 10: Wire navigation**

In `src/client/components/Sidebar.tsx`, add `LayoutDashboard` from `lucide-react`, add `dashboard` to `PageKey`, and add the item before Movies.

```ts
import { Clapperboard, Film, LayoutDashboard, Plus, Search, Tv } from 'lucide-react';
```

```ts
export type PageKey =
  | 'dashboard'
  | 'movies'
  | 'add-movie'
  | 'tv-shows'
  | 'add-tv-show'
  | 'seasons'
  | 'episodes'
  | 'public-search';
```

```ts
{ key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
```

In `src/client/App.tsx`, import and route `DashboardPage`.

```ts
import { DashboardPage } from './pages/DashboardPage';
```

Add `dashboard` to `refreshSafePages`, make it the default page in `pageFromHash`, and return `<DashboardPage />` when `page === 'dashboard'`.

**Step 11: Run the client test to verify it passes**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

**Step 12: Commit**

```bash
git add src/server/admin src/server/app.ts tests/server/admin.dashboard.test.ts src/client/pages/DashboardPage.tsx src/client/components/Sidebar.tsx src/client/App.tsx src/client/styles.css tests/client/App.test.tsx
git commit -m "feat: add admin dashboard"
```

---

### Task 2: Add Duplicate Title Warnings

**Files:**
- Modify: `src/server/media/media.repository.ts`
- Modify: `src/server/media/media.service.ts`
- Modify: `src/server/media/media.routes.ts`
- Test: `tests/server/media.movies.test.ts`
- Test: `tests/server/media.tv.test.ts`
- Modify: `src/client/pages/MovieForm.tsx`
- Modify: `src/client/pages/TvShowForm.tsx`
- Test: `tests/client/App.test.tsx`

**Step 1: Write failing server tests**

In `tests/server/media.movies.test.ts`, add:

```ts
it('finds possible duplicate movies by title and year', async () => {
  await request(app)
    .post('/api/movies')
    .send({
      title: 'Arrival',
      year: 2016,
      description: '',
      quality: 'HD',
      links: []
    })
    .expect(201);

  const response = await request(app)
    .get('/api/movies/duplicates?title=arrival&year=2016')
    .expect(200);

  expect(response.body.duplicates).toEqual([
    expect.objectContaining({
      title: 'Arrival',
      year: 2016
    })
  ]);
});
```

In `tests/server/media.tv.test.ts`, add the same shape for `/api/tv-shows/duplicates?title=dark&year=2017`.

**Step 2: Run server tests to verify they fail**

Run:

```bash
npm.cmd test -- tests/server/media.movies.test.ts tests/server/media.tv.test.ts
```

Expected: FAIL because duplicate endpoints do not exist.

**Step 3: Add repository helpers**

In `src/server/media/media.repository.ts`, add:

```ts
export type DuplicateMediaCandidate = {
  id: number;
  title: string;
  year?: number;
};

function normalizeDuplicateQuery(title: string) {
  return title.trim().toLowerCase();
}

export function findDuplicateMovies(db: AppDatabase, filters: { title: string; year?: number; excludeId?: number }) {
  const rows = db
    .prepare(
      `SELECT id, title, year
         FROM movies
        WHERE lower(title) = ?
          AND (? IS NULL OR year = ?)
          AND (? IS NULL OR id <> ?)
        ORDER BY updated_at DESC, id DESC
        LIMIT 5`
    )
    .all(
      normalizeDuplicateQuery(filters.title),
      filters.year ?? null,
      filters.year ?? null,
      filters.excludeId ?? null,
      filters.excludeId ?? null
    ) as Array<{ id: number; title: string; year: number | null }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    year: row.year ?? undefined
  }));
}

export function findDuplicateTvShows(db: AppDatabase, filters: { title: string; year?: number; excludeId?: number }) {
  const rows = db
    .prepare(
      `SELECT id, title, year
         FROM tv_shows
        WHERE lower(title) = ?
          AND (? IS NULL OR year = ?)
          AND (? IS NULL OR id <> ?)
        ORDER BY updated_at DESC, id DESC
        LIMIT 5`
    )
    .all(
      normalizeDuplicateQuery(filters.title),
      filters.year ?? null,
      filters.year ?? null,
      filters.excludeId ?? null,
      filters.excludeId ?? null
    ) as Array<{ id: number; title: string; year: number | null }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    year: row.year ?? undefined
  }));
}
```

**Step 4: Add service validation**

In `src/server/media/media.service.ts`, import the helpers and add:

```ts
const DuplicateQuerySchema = z
  .object({
    title: z.string().trim().min(1),
    year: z.preprocess((value) => {
      if (value === undefined || value === '') {
        return undefined;
      }
      if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
        return value;
      }
      return Number(value);
    }, z.number().int().positive().optional()),
    excludeId: z.preprocess((value) => {
      if (value === undefined || value === '') {
        return undefined;
      }
      if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
        return value;
      }
      return Number(value);
    }, z.number().int().positive().optional())
  })
  .strict();

export function findMovieDuplicates(db: AppDatabase, query: unknown) {
  const filters = DuplicateQuerySchema.parse(query);
  return findDuplicateMovies(db, filters);
}

export function findTvShowDuplicates(db: AppDatabase, query: unknown) {
  const filters = DuplicateQuerySchema.parse(query);
  return findDuplicateTvShows(db, filters);
}
```

Use aliases in the import if needed to avoid name collisions.

**Step 5: Add routes**

In `src/server/media/media.routes.ts`, import the service functions and add these routes before `/:id` routes.

```ts
router.get('/movies/duplicates', (req, res, next) => {
  try {
    res.json({ duplicates: findMovieDuplicates(db, req.query) });
  } catch (error) {
    next(error);
  }
});

router.get('/tv-shows/duplicates', (req, res, next) => {
  try {
    res.json({ duplicates: findTvShowDuplicates(db, req.query) });
  } catch (error) {
    next(error);
  }
});
```

**Step 6: Run server tests to verify they pass**

Run:

```bash
npm.cmd test -- tests/server/media.movies.test.ts tests/server/media.tv.test.ts
```

Expected: PASS.

**Step 7: Write failing client tests**

In `tests/client/App.test.tsx`, add a Movie form test.

```ts
it('shows a duplicate movie warning while adding a similar title', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/movies/duplicates?title=Arrival&year=2016') {
      return {
        ok: true,
        json: async () => ({ duplicates: [{ id: 1, title: 'Arrival', year: 2016 }] })
      };
    }

    return {
      ok: true,
      json: async () => ({ movies: [] })
    };
  });

  render(<App />);
  fireEvent.click(within(screen.getByRole('navigation', { name: /media navigation/i })).getByRole('button', { name: /^add movie$/i }));
  fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Arrival' } });
  fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2016' } });

  expect(await screen.findByText(/possible duplicate/i)).toBeInTheDocument();
});
```

Add the equivalent TV show test for `/api/tv-shows/duplicates`.

**Step 8: Implement duplicate warning UI**

In `MovieForm.tsx`, add duplicate state and a debounced lookup effect.

```tsx
type DuplicateCandidate = {
  id: number;
  title: string;
  year?: number;
};

const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
```

```tsx
useEffect(() => {
  if (isEditMode || title.trim().length < 2) {
    setDuplicates([]);
    return;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    const params = new URLSearchParams({ title: title.trim() });
    if (year.trim()) {
      params.set('year', year.trim());
    }

    apiJson<{ duplicates: DuplicateCandidate[] }>(`/api/movies/duplicates?${params.toString()}`, {
      signal: controller.signal
    })
      .then((payload) => setDuplicates(payload.duplicates ?? []))
      .catch((lookupError) => {
        if ((lookupError as { name?: string }).name !== 'AbortError') {
          setDuplicates([]);
        }
      });
  }, 300);

  return () => {
    window.clearTimeout(timeout);
    controller.abort();
  };
}, [isEditMode, title, year]);
```

Render below the title/year fields or before errors:

```tsx
{duplicates.length > 0 ? (
  <div className="state-panel state-panel--warning">
    Possible duplicate: {duplicates.map((duplicate) => `${duplicate.title}${duplicate.year ? ` (${duplicate.year})` : ''}`).join(', ')}
  </div>
) : null}
```

Apply the same pattern in `TvShowForm.tsx` using `/api/tv-shows/duplicates`.

**Step 9: Add warning CSS**

In `src/client/styles.css`, add:

```css
.state-panel--warning {
  background: #fff8e1;
  border-color: #f3c969;
  color: #5f4300;
}
```

**Step 10: Run client tests**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

**Step 11: Commit**

```bash
git add src/server/media/media.repository.ts src/server/media/media.service.ts src/server/media/media.routes.ts tests/server/media.movies.test.ts tests/server/media.tv.test.ts src/client/pages/MovieForm.tsx src/client/pages/TvShowForm.tsx src/client/styles.css tests/client/App.test.tsx
git commit -m "feat: warn about duplicate media"
```

---

### Task 3: Add Movie And TV Sort Controls

**Files:**
- Modify: `src/server/media/media.repository.ts`
- Modify: `src/server/media/media.service.ts`
- Test: `tests/server/media.movies.test.ts`
- Test: `tests/server/media.tv.test.ts`
- Modify: `src/client/pages/MoviesPage.tsx`
- Modify: `src/client/pages/TvShowsPage.tsx`
- Test: `tests/client/App.test.tsx`

**Step 1: Write failing server tests**

In `tests/server/media.movies.test.ts`, add:

```ts
it('sorts movies by newest first', async () => {
  await request(app).post('/api/movies').send({ title: 'Older', description: '', quality: 'HD', links: [] }).expect(201);
  await request(app).post('/api/movies').send({ title: 'Newer', description: '', quality: 'HD', links: [] }).expect(201);

  const response = await request(app).get('/api/movies?sort=newest').expect(200);

  expect(response.body.movies.map((movie: { title: string }) => movie.title)).toEqual(['Newer', 'Older']);
});
```

Add a TV show equivalent for `/api/tv-shows?sort=title_asc`, expecting alphabetical order.

**Step 2: Run tests to verify they fail**

Run:

```bash
npm.cmd test -- tests/server/media.movies.test.ts tests/server/media.tv.test.ts
```

Expected: FAIL because sort is rejected by the strict search schema.

**Step 3: Extend filters and SQL**

In `src/server/media/media.repository.ts`, add:

```ts
export type MediaSort = 'newest' | 'oldest' | 'updated' | 'title_asc';
```

Update `MovieFilters` and `TvShowFilters`:

```ts
export type MovieFilters = {
  title?: string;
  year?: number;
  sort?: MediaSort;
};
```

Use this helper near list functions:

```ts
function getMediaOrderBy(sort: MediaSort | undefined, tableName: 'movies' | 'tv_shows') {
  if (sort === 'oldest') {
    return `${tableName}.created_at ASC, ${tableName}.id ASC`;
  }

  if (sort === 'updated') {
    return `${tableName}.updated_at DESC, ${tableName}.id DESC`;
  }

  if (sort === 'title_asc') {
    return `lower(${tableName}.title) ASC, ${tableName}.id ASC`;
  }

  return `${tableName}.created_at DESC, ${tableName}.id DESC`;
}
```

Update `listMovies` and `listTvShows` SQL to use the helper by interpolating only this controlled string:

```ts
const orderBy = getMediaOrderBy(filters.sort, 'movies');
```

```ts
`SELECT ...
   FROM movies
  WHERE ...
  ORDER BY ${orderBy}`
```

Do not interpolate user-provided raw values.

**Step 4: Extend service query schema**

In `src/server/media/media.service.ts`, add `sort` to `SearchQuerySchema`.

```ts
sort: z.enum(['newest', 'oldest', 'updated', 'title_asc']).optional()
```

Pass `sort: filters.sort` to `listMovies` and `listTvShows`.

**Step 5: Run server tests**

Run:

```bash
npm.cmd test -- tests/server/media.movies.test.ts tests/server/media.tv.test.ts
```

Expected: PASS.

**Step 6: Write failing client test**

In `tests/client/App.test.tsx`, add:

```ts
it('requests movies with the selected sort order', async () => {
  render(<App />);

  expect(await screen.findByRole('heading', { name: /^movies$/i })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^sort$/i), { target: { value: 'title_asc' } });

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/movies?sort=title_asc', expect.any(Object)));
});
```

Add an equivalent TV Shows test for `/api/tv-shows?sort=updated`.

**Step 7: Implement sort controls**

In `MoviesPage.tsx`, add:

```tsx
const [sort, setSort] = useState('newest');
```

Update URL construction:

```tsx
if (sort !== 'newest') {
  params.set('sort', sort);
}
```

Add this label inside `.filter-bar`:

```tsx
<label>
  Sort
  <select value={sort} onChange={(event) => setSort(event.target.value)}>
    <option value="newest">Newest</option>
    <option value="oldest">Oldest</option>
    <option value="updated">Recently updated</option>
    <option value="title_asc">Title A-Z</option>
  </select>
</label>
```

Apply the same control in `TvShowsPage.tsx`.

**Step 8: Run client tests**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

**Step 9: Commit**

```bash
git add src/server/media/media.repository.ts src/server/media/media.service.ts tests/server/media.movies.test.ts tests/server/media.tv.test.ts src/client/pages/MoviesPage.tsx src/client/pages/TvShowsPage.tsx tests/client/App.test.tsx
git commit -m "feat: add media sort controls"
```

---

### Task 4: Add Failed Telegram Jobs Page With Retry

**Files:**
- Modify: `src/server/telegram/telegram.queue.ts`
- Create: `src/server/telegram/telegram.admin.routes.ts`
- Modify: `src/server/app.ts`
- Create: `tests/server/telegram.admin.test.ts`
- Create: `src/client/pages/TelegramJobsPage.tsx`
- Modify: `src/client/components/Sidebar.tsx`
- Modify: `src/client/App.tsx`
- Modify: `tests/client/App.test.tsx`

**Step 1: Write failing server tests**

Create `tests/server/telegram.admin.test.ts`.

```ts
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

const config = {
  host: '127.0.0.1',
  port: 3000,
  databasePath: ':memory:',
  tmdbApiKey: undefined,
  telegramBotToken: undefined,
  telegramChannelId: '-1001',
  publicSearchSyncUrl: undefined,
  publicSearchSyncToken: undefined,
  publicSearchStatusUrl: undefined,
  publicSearchStatusToken: undefined,
  publicSearchGroupHandle: '@infinitylinks69'
};

describe('telegram admin jobs', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => db.close());

  it('lists failed Telegram jobs', async () => {
    db.prepare(
      `INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status, attempts, last_error)
       VALUES ('send', 'movie', 12, '{}', 'failed', 2, 'Bad request')`
    ).run();

    const app = createApp({ db, config });
    const response = await request(app).get('/api/telegram/jobs/failed').expect(200);

    expect(response.body.jobs).toEqual([
      expect.objectContaining({
        jobType: 'send',
        entityType: 'movie',
        entityId: 12,
        attempts: 2,
        lastError: 'Bad request'
      })
    ]);
  });

  it('requeues a failed Telegram job', async () => {
    const result = db.prepare(
      `INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status, attempts, last_error)
       VALUES ('send', 'movie', 12, '{}', 'failed', 2, 'Bad request')`
    ).run();

    const app = createApp({ db, config });
    await request(app).post(`/api/telegram/jobs/${result.lastInsertRowid}/retry`).expect(200);

    const row = db.prepare('SELECT status, last_error FROM telegram_jobs WHERE id = ?').get(result.lastInsertRowid) as {
      status: string;
      last_error: string | null;
    };
    expect(row).toEqual({ status: 'queued', last_error: null });
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd test -- tests/server/telegram.admin.test.ts
```

Expected: FAIL because the admin routes do not exist.

**Step 3: Add queue helpers**

In `src/server/telegram/telegram.queue.ts`, export:

```ts
export type FailedTelegramJob = {
  id: number;
  jobType: TelegramJobType;
  entityType: TelegramEntityType;
  entityId: number;
  attempts: number;
  lastError: string;
  updatedAt: string;
};

type FailedTelegramJobRow = {
  id: number;
  job_type: TelegramJobType;
  entity_type: TelegramEntityType;
  entity_id: number;
  attempts: number;
  last_error: string | null;
  updated_at: string;
};

export function listFailedTelegramJobs(db: AppDatabase): FailedTelegramJob[] {
  const rows = db
    .prepare(
      `SELECT id, job_type, entity_type, entity_id, attempts, last_error, updated_at
         FROM telegram_jobs
        WHERE status = 'failed'
        ORDER BY updated_at DESC, id DESC
        LIMIT 50`
    )
    .all() as FailedTelegramJobRow[];

  return rows.map((row) => ({
    id: row.id,
    jobType: row.job_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    attempts: row.attempts,
    lastError: row.last_error ?? '',
    updatedAt: row.updated_at
  }));
}

export function retryFailedTelegramJob(db: AppDatabase, id: number) {
  return db
    .prepare(
      `UPDATE telegram_jobs
          SET status = 'queued',
              next_run_at = CURRENT_TIMESTAMP,
              last_error = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'failed'`
    )
    .run(id);
}
```

**Step 4: Add Telegram admin routes**

Create `src/server/telegram/telegram.admin.routes.ts`.

```ts
import { Router } from 'express';
import { z } from 'zod';
import type { AppDatabase } from '../db/database.js';
import { listFailedTelegramJobs, retryFailedTelegramJob } from './telegram.queue.js';

const IdParamSchema = z.object({
  id: z.preprocess((value) => {
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return Number(value);
    }
    return value;
  }, z.number().int().positive())
});

export function createTelegramAdminRouter(db: AppDatabase) {
  const router = Router();

  router.get('/telegram/jobs/failed', (_req, res, next) => {
    try {
      res.json({ jobs: listFailedTelegramJobs(db) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/telegram/jobs/:id/retry', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const result = retryFailedTelegramJob(db, id);

      if (result.changes === 0) {
        res.status(404).json({ error: 'Failed Telegram job not found' });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

Mount it in `src/server/app.ts`.

```ts
import { createTelegramAdminRouter } from './telegram/telegram.admin.routes.js';
```

```ts
app.use('/api', createTelegramAdminRouter(db));
```

**Step 5: Run server test**

Run:

```bash
npm.cmd test -- tests/server/telegram.admin.test.ts
```

Expected: PASS.

**Step 6: Write failing client test**

In `tests/client/App.test.tsx`, add:

```ts
it('lists failed Telegram jobs and retries one', async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/telegram/jobs/failed') {
      return {
        ok: true,
        json: async () => ({
          jobs: [
            {
              id: 7,
              jobType: 'send',
              entityType: 'movie',
              entityId: 12,
              attempts: 2,
              lastError: 'Bad request',
              updatedAt: '2026-05-26 01:00:00'
            }
          ]
        })
      };
    }

    if (url === '/api/telegram/jobs/7/retry' && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ ok: true })
      };
    }

    return {
      ok: true,
      json: async () => ({ movies: [] })
    };
  });

  render(<App />);
  fireEvent.click(within(screen.getByRole('navigation', { name: /media navigation/i })).getByRole('button', { name: /^telegram jobs$/i }));

  expect(await screen.findByText('Bad request')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/telegram/jobs/7/retry', expect.objectContaining({ method: 'POST' })));
});
```

**Step 7: Implement the page**

Create `src/client/pages/TelegramJobsPage.tsx`.

```tsx
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '../api/http';
import { useToast } from '../components/ToastProvider';

type FailedTelegramJob = {
  id: number;
  jobType: string;
  entityType: string;
  entityId: number;
  attempts: number;
  lastError: string;
  updatedAt: string;
};

export function TelegramJobsPage() {
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<FailedTelegramJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const loadJobs = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ jobs: FailedTelegramJob[] }>('/api/telegram/jobs/failed');
      setJobs(payload.jobs ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load failed Telegram jobs.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  async function retryJob(job: FailedTelegramJob) {
    setRetryingId(job.id);
    try {
      await apiJson(`/api/telegram/jobs/${job.id}/retry`, { method: 'POST' });
      showToast('Telegram job queued for retry.');
      await loadJobs();
    } catch (retryError) {
      showToast(retryError instanceof Error ? retryError.message : 'Retry failed.', 'error');
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <h1>Telegram Jobs</h1>
          <p>Review failed publish jobs and queue them for retry.</p>
        </div>
      </div>

      {isLoading ? <div className="state-panel">Loading failed jobs...</div> : null}
      {!isLoading && error ? <div className="state-panel state-panel--error">{error}</div> : null}
      {!isLoading && !error && jobs.length === 0 ? <div className="state-panel">No failed Telegram jobs.</div> : null}
      {!isLoading && !error && jobs.length > 0 ? (
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Entity</th>
                  <th>Attempts</th>
                  <th>Error</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.jobType}</td>
                    <td>{job.entityType} #{job.entityId}</td>
                    <td>{job.attempts}</td>
                    <td>{job.lastError || '-'}</td>
                    <td>{job.updatedAt}</td>
                    <td>
                      <button className="button button--secondary" type="button" disabled={retryingId === job.id} onClick={() => retryJob(job)}>
                        <RefreshCw aria-hidden="true" size={16} />
                        Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
```

**Step 8: Wire navigation**

In `Sidebar.tsx`, add `Send` from `lucide-react`, add `telegram-jobs` to `PageKey`, and add the nav item.

```ts
{ key: 'telegram-jobs', label: 'Telegram Jobs', icon: Send },
```

In `App.tsx`, import `TelegramJobsPage`, add `telegram-jobs` to refresh-safe pages, and render it.

**Step 9: Run client tests**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

**Step 10: Commit**

```bash
git add src/server/telegram/telegram.queue.ts src/server/telegram/telegram.admin.routes.ts src/server/app.ts tests/server/telegram.admin.test.ts src/client/pages/TelegramJobsPage.tsx src/client/components/Sidebar.tsx src/client/App.tsx tests/client/App.test.tsx
git commit -m "feat: add failed telegram job retries"
```

---

### Task 5: Add Public Search Preview

**Files:**
- Modify: `src/server/public-search/catalog.ts`
- Modify: `src/server/public-search/sync.service.ts`
- Modify: `src/server/public-search/public-search.routes.ts`
- Test: `tests/public-search/public-search.sync-route.test.ts`
- Modify: `src/client/pages/PublicSearchPage.tsx`
- Test: `tests/client/App.test.tsx`

**Step 1: Write failing server test**

In `tests/public-search/public-search.sync-route.test.ts`, add:

```ts
it('returns a public search preview with sample titles', async () => {
  insertPostedMovieWithActiveLink(db, {
    title: 'Arrival',
    telegramMessageId: 101
  });

  const response = await request(app).get('/api/public-search/preview').expect(200);

  expect(response.body.preview).toEqual({
    movies: 1,
    tvShows: 0,
    sampleMovies: ['Arrival'],
    sampleTvShows: []
  });
});
```

If the existing test helper has a different signature, follow the local fixture style already used in that file.

**Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.sync-route.test.ts
```

Expected: FAIL because `/api/public-search/preview` does not exist.

**Step 3: Add preview builder**

In `src/server/public-search/catalog.ts`, add:

```ts
export type PublicSearchCatalogPreview = {
  movies: number;
  tvShows: number;
  sampleMovies: string[];
  sampleTvShows: string[];
};

export function createPublicSearchCatalogPreview(catalog: PublicSearchCatalog): PublicSearchCatalogPreview {
  return {
    movies: catalog.movies.length,
    tvShows: catalog.tvShows.length,
    sampleMovies: catalog.movies.slice(0, 5).map((movie) => movie.title),
    sampleTvShows: catalog.tvShows.slice(0, 5).map((tvShow) => tvShow.title)
  };
}
```

**Step 4: Add service function**

In `src/server/public-search/sync.service.ts`, import the preview helper and add:

```ts
export function getPublicSearchPreview(db: AppDatabase, config: AppConfig) {
  const catalog = buildPublicSearchCatalog(db, {
    channelHandle: config.publicSearchGroupHandle,
    groupHandle: config.publicSearchGroupHandle
  });

  return createPublicSearchCatalogPreview(catalog);
}
```

Use the same config fields already used by `getPublicSearchSyncStatus` and `syncPublicSearchCatalog`; do not introduce new environment variables.

**Step 5: Add route**

In `src/server/public-search/public-search.routes.ts`, import `getPublicSearchPreview` and add:

```ts
router.get('/public-search/preview', (_req, res, next) => {
  try {
    res.json({ preview: getPublicSearchPreview(db, config) });
  } catch (error) {
    next(error);
  }
});
```

**Step 6: Run server test**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.sync-route.test.ts
```

Expected: PASS.

**Step 7: Write failing client test**

In `tests/client/App.test.tsx`, extend the Public Search page test.

```ts
it('shows public search preview samples', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/public-search/sync-status') {
      return {
        ok: true,
        json: async () => createPublicSearchSyncStatus()
      };
    }

    if (url === '/api/public-search/preview') {
      return {
        ok: true,
        json: async () => ({
          preview: {
            movies: 1,
            tvShows: 1,
            sampleMovies: ['Arrival'],
            sampleTvShows: ['Dark']
          }
        })
      };
    }

    return {
      ok: true,
      json: async () => ({ movies: [] })
    };
  });

  render(<App />);
  fireEvent.click(within(screen.getByRole('navigation', { name: /media navigation/i })).getByRole('button', { name: /^public search$/i }));

  expect(await screen.findByText('Arrival')).toBeInTheDocument();
  expect(screen.getByText('Dark')).toBeInTheDocument();
});
```

**Step 8: Load and render preview**

In `src/client/pages/PublicSearchPage.tsx`, add:

```ts
type PublicSearchPreview = {
  movies: number;
  tvShows: number;
  sampleMovies: string[];
  sampleTvShows: string[];
};
```

Add state:

```tsx
const [preview, setPreview] = useState<PublicSearchPreview | null>(null);
const [previewError, setPreviewError] = useState('');
```

Add fetch function:

```ts
async function fetchPublicSearchPreview(): Promise<PublicSearchPreview> {
  const payload = await apiJson<{ preview: PublicSearchPreview }>('/api/public-search/preview');
  return payload.preview;
}
```

Load it in the existing mount effect after sync status succeeds, or use a second effect:

```tsx
useEffect(() => {
  let isMounted = true;

  fetchPublicSearchPreview()
    .then((payload) => {
      if (isMounted) {
        setPreview(payload);
      }
    })
    .catch((previewLoadError) => {
      if (isMounted) {
        setPreviewError(previewLoadError instanceof Error ? previewLoadError.message : 'Public search preview unavailable');
      }
    });

  return () => {
    isMounted = false;
  };
}, []);
```

Render a compact preview below the readiness panel:

```tsx
<section className="preview-panel" aria-label="Public search preview">
  <h2>Preview</h2>
  {previewError ? <div className="state-panel state-panel--error">{previewError}</div> : null}
  {preview ? (
    <>
      <p>{preview.movies} movies and {preview.tvShows} TV shows will be available after sync.</p>
      <div className="preview-panel__samples">
        <div>
          <h3>Movies</h3>
          {preview.sampleMovies.length > 0 ? (
            <ul>{preview.sampleMovies.map((title) => <li key={title}>{title}</li>)}</ul>
          ) : (
            <p>No movies ready.</p>
          )}
        </div>
        <div>
          <h3>TV Shows</h3>
          {preview.sampleTvShows.length > 0 ? (
            <ul>{preview.sampleTvShows.map((title) => <li key={title}>{title}</li>)}</ul>
          ) : (
            <p>No TV shows ready.</p>
          )}
        </div>
      </div>
    </>
  ) : null}
</section>
```

After successful sync, call `fetchPublicSearchPreview()` again and update `preview`.

**Step 9: Add preview CSS**

In `src/client/styles.css`, add:

```css
.preview-panel {
  display: grid;
  gap: 1rem;
}

.preview-panel__samples {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
```

**Step 10: Run client tests**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

**Step 11: Commit**

```bash
git add src/server/public-search/catalog.ts src/server/public-search/sync.service.ts src/server/public-search/public-search.routes.ts tests/public-search/public-search.sync-route.test.ts src/client/pages/PublicSearchPage.tsx src/client/styles.css tests/client/App.test.tsx
git commit -m "feat: preview public search catalog"
```

---

### Task 6: Final Verification

**Files:**
- Modify only if verification reveals a defect.

**Step 1: Run the full test suite**

Run:

```bash
npm.cmd test
```

Expected: all tests pass.

**Step 2: Run the production build**

Run:

```bash
npm.cmd run build
```

Expected: TypeScript and Vite build pass.

**Step 3: Run the database migration**

Run:

```bash
npm.cmd run db:migrate
```

Expected: migration completes without errors.

**Step 4: Manual smoke test**

Run:

```bash
npm.cmd run dev
```

Open `http://127.0.0.1:3000` and verify:

- Dashboard loads and shows counts.
- Add Movie shows duplicate warning after entering an existing title/year.
- Movies and TV Shows sort controls change the list request.
- Telegram Jobs shows failed jobs or the empty state.
- Public Search shows preview samples and refreshes after sync.

**Step 5: Final commit if fixes were needed**

```bash
git add <changed-files>
git commit -m "fix: polish starter admin improvements"
```

Do not commit environment files, local databases, `dist`, or unrelated user changes.

---

## Decision Log

- Build the first batch as one plan because the features are small and share the same app/server structure.
- Add read-only admin endpoints instead of overloading existing media endpoints, keeping daily admin status separate from media CRUD.
- Keep duplicate detection as an exact normalized title plus optional year match. Fuzzy matching is intentionally deferred.
- Add retry for failed Telegram jobs only. Automatic retry policy changes are intentionally deferred.
- Add Public Search preview from the existing catalog builder so preview and sync stay consistent.

## Deferred Ideas

- Provider presets.
- Missing-links view.
- Copy Telegram post link button.
- Bot search suggestions.
- Link health checking.

# Description Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove movie and TV show descriptions from InfinityLinks UI, API payloads, SQLite schema, TMDB mapping, Telegram captions, and tests.

**Architecture:** Treat this as a hard data-model removal. First make SQLite migration safe and covered by tests, then remove the field from server contracts, then remove the UI and caption presentation paths. Public search catalog behavior stays unchanged because descriptions are not synced there.

**Tech Stack:** TypeScript, React, Express, better-sqlite3, Zod, Vitest, Vite, Windows release packaging.

---

## File Structure

- `src/server/db/schema.sql`: canonical SQLite schema without `description`.
- `src/server/db/migrate.ts`: legacy-table rebuild migration that drops `movies.description` and `tv_shows.description`.
- `tests/server/db.test.ts`: migration tests proving the columns are removed and related rows survive.
- `src/server/media/media.schemas.ts`: media input schemas without description.
- `src/server/media/media.repository.ts`: repository types, row mappers, SQL selects/inserts/updates without description.
- `src/server/media/media.service.ts`: caption payloads continue to use repository data after description is removed.
- `tests/server/media.movies.test.ts`: movie API and queue tests without description.
- `tests/server/media.tv.test.ts`: TV show API and season queue tests without description.
- `tests/server/admin.dashboard.test.ts`: dashboard fixtures without description inserts.
- `src/server/tmdb/tmdb.service.ts`: TMDB normalized result without description.
- `tests/server/tmdb.service.test.ts`: TMDB expectations without description.
- `src/client/components/TmdbSearch.tsx`: TMDB search result type without description.
- `src/client/pages/MovieForm.tsx`: remove description state, textarea, payload field, and TMDB fill behavior.
- `src/client/pages/TvShowForm.tsx`: remove description state, textarea, payload field, and TMDB fill behavior.
- `src/client/pages/MoviesPage.tsx`: remove description type field and table column.
- `src/client/pages/TvShowsPage.tsx`: remove description type field and table column.
- `tests/client/App.test.tsx`: client fixtures and assertions without description UI.
- `src/server/telegram/telegram.formatter.ts`: caption input types and formatter without description handling.
- `tests/server/telegram.formatter.test.ts`: caption expectations without description.
- `tests/server/telegram.queue.test.ts`: queue fixtures without description inserts.

## Task 1: Drop Description From SQLite Schema And Migration

**Files:**
- Modify: `src/server/db/schema.sql`
- Modify: `src/server/db/migrate.ts`
- Modify: `tests/server/db.test.ts`

- [ ] **Step 1: Write failing database tests**

Add these tests to `tests/server/db.test.ts` near the existing database migration tests:

```ts
function columnNames(db: ReturnType<typeof createDatabase>, tableName: string) {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name);
}

it('creates media tables without description columns', () => {
  const db = createDatabase(':memory:');
  migrate(db);

  expect(columnNames(db, 'movies')).not.toContain('description');
  expect(columnNames(db, 'tv_shows')).not.toContain('description');

  db.close();
});

it('drops legacy description columns while preserving related media rows', () => {
  const db = createDatabase(':memory:');
  db.exec(`
    CREATE TABLE movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER,
      title TEXT NOT NULL,
      year INTEGER,
      poster_url TEXT,
      description TEXT NOT NULL DEFAULT '',
      rating REAL,
      quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
      topic_key TEXT NOT NULL DEFAULT 'FOREIGN_MOVIES' CHECK (topic_key IN ('FOREIGN_MOVIES', 'PINOY_MOVIES', 'ANIME', 'VIVAMAX')),
      telegram_message_id INTEGER,
      post_status TEXT NOT NULL DEFAULT 'pending' CHECK (post_status IN ('pending', 'posted', 'failed', 'deleted')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE movie_links (
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
    CREATE TABLE tv_shows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER,
      title TEXT NOT NULL,
      year INTEGER,
      poster_url TEXT,
      description TEXT NOT NULL DEFAULT '',
      rating REAL,
      quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
      topic_key TEXT NOT NULL DEFAULT 'FOREIGN_TV_SERIES' CHECK (topic_key IN ('FOREIGN_TV_SERIES', 'PINOY_TV_SERIES', 'ANIME', 'VIVAMAX')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tv_show_id INTEGER NOT NULL REFERENCES tv_shows(id) ON DELETE CASCADE,
      season_number INTEGER NOT NULL,
      telegram_message_id INTEGER,
      post_status TEXT NOT NULL DEFAULT 'pending' CHECK (post_status IN ('pending', 'posted', 'failed', 'deleted')),
      needs_repost INTEGER NOT NULL DEFAULT 0 CHECK (needs_repost IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tv_show_id, season_number)
    );
  `);
  db.prepare(
    `INSERT INTO movies (id, tmdb_id, title, year, poster_url, description, rating, quality, topic_key, telegram_message_id, post_status)
     VALUES (1, 27205, 'Inception', 2010, 'https://example.com/inception.jpg', 'Discard me', 8.8, 'Full HD', 'FOREIGN_MOVIES', 456, 'posted')`
  ).run();
  db.prepare(
    `INSERT INTO movie_links (movie_id, provider_name, quality, status, url)
     VALUES (1, 'Provider', 'Full HD', 'active', 'https://example.com/watch')`
  ).run();
  db.prepare(
    `INSERT INTO tv_shows (id, tmdb_id, title, year, poster_url, description, rating, quality, topic_key)
     VALUES (2, 1399, 'Game of Thrones', 2011, 'https://example.com/got.jpg', 'Discard me too', 9.2, 'HD', 'FOREIGN_TV_SERIES')`
  ).run();
  db.prepare('INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (2, 1, 789, "posted")').run();

  migrate(db);

  expect(columnNames(db, 'movies')).not.toContain('description');
  expect(columnNames(db, 'tv_shows')).not.toContain('description');
  expect(db.prepare('SELECT id, tmdb_id, title, year, poster_url, rating, quality, topic_key, telegram_message_id, post_status FROM movies').get()).toEqual({
    id: 1,
    tmdb_id: 27205,
    title: 'Inception',
    year: 2010,
    poster_url: 'https://example.com/inception.jpg',
    rating: 8.8,
    quality: 'Full HD',
    topic_key: 'FOREIGN_MOVIES',
    telegram_message_id: 456,
    post_status: 'posted'
  });
  expect(db.prepare('SELECT movie_id, provider_name, url FROM movie_links').get()).toEqual({
    movie_id: 1,
    provider_name: 'Provider',
    url: 'https://example.com/watch'
  });
  expect(db.prepare('SELECT id, tmdb_id, title, year, poster_url, rating, quality, topic_key FROM tv_shows').get()).toEqual({
    id: 2,
    tmdb_id: 1399,
    title: 'Game of Thrones',
    year: 2011,
    poster_url: 'https://example.com/got.jpg',
    rating: 9.2,
    quality: 'HD',
    topic_key: 'FOREIGN_TV_SERIES'
  });
  expect(db.prepare('SELECT tv_show_id, season_number, telegram_message_id, post_status FROM seasons').get()).toEqual({
    tv_show_id: 2,
    season_number: 1,
    telegram_message_id: 789,
    post_status: 'posted'
  });

  db.close();
});
```

- [ ] **Step 2: Run database tests to verify failure**

Run:

```bash
npm.cmd test -- tests/server/db.test.ts
```

Expected: FAIL because `movies.description` and `tv_shows.description` still exist.

- [ ] **Step 3: Remove description from canonical schema**

In `src/server/db/schema.sql`, remove these two lines:

```sql
  description TEXT NOT NULL DEFAULT '',
```

One occurrence is in `CREATE TABLE IF NOT EXISTS movies`; the other is in `CREATE TABLE IF NOT EXISTS tv_shows`.

- [ ] **Step 4: Add legacy table rebuild helpers**

In `src/server/db/migrate.ts`, keep the existing `ensureColumn` logic and add these helpers below it:

```ts
function hasColumn(db: AppDatabase, tableName: string, columnName: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function getForeignKeysEnabled(db: AppDatabase) {
  const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: 0 | 1 };
  return row.foreign_keys === 1;
}

function assertNoForeignKeyViolations(db: AppDatabase) {
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    throw new Error(`Foreign key check failed after description removal migration: ${JSON.stringify(violations)}`);
  }
}

function rebuildMoviesWithoutDescription(db: AppDatabase) {
  db.exec(`
    CREATE TABLE movies_without_description (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER,
      title TEXT NOT NULL,
      year INTEGER,
      poster_url TEXT,
      rating REAL,
      quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
      topic_key TEXT NOT NULL DEFAULT 'FOREIGN_MOVIES' CHECK (topic_key IN ('FOREIGN_MOVIES', 'PINOY_MOVIES', 'ANIME', 'VIVAMAX')),
      telegram_message_id INTEGER,
      post_status TEXT NOT NULL DEFAULT 'pending' CHECK (post_status IN ('pending', 'posted', 'failed', 'deleted')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO movies_without_description (
      id, tmdb_id, title, year, poster_url, rating, quality, topic_key,
      telegram_message_id, post_status, created_at, updated_at
    )
    SELECT
      id, tmdb_id, title, year, poster_url, rating, quality, topic_key,
      telegram_message_id, post_status, created_at, updated_at
    FROM movies;
    DROP TABLE movies;
    ALTER TABLE movies_without_description RENAME TO movies;
  `);
}

function rebuildTvShowsWithoutDescription(db: AppDatabase) {
  db.exec(`
    CREATE TABLE tv_shows_without_description (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER,
      title TEXT NOT NULL,
      year INTEGER,
      poster_url TEXT,
      rating REAL,
      quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
      topic_key TEXT NOT NULL DEFAULT 'FOREIGN_TV_SERIES' CHECK (topic_key IN ('FOREIGN_TV_SERIES', 'PINOY_TV_SERIES', 'ANIME', 'VIVAMAX')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tv_shows_without_description (
      id, tmdb_id, title, year, poster_url, rating, quality, topic_key, created_at, updated_at
    )
    SELECT
      id, tmdb_id, title, year, poster_url, rating, quality, topic_key, created_at, updated_at
    FROM tv_shows;
    DROP TABLE tv_shows;
    ALTER TABLE tv_shows_without_description RENAME TO tv_shows;
  `);
}

function removeDescriptionColumns(db: AppDatabase) {
  const shouldRebuildMovies = hasColumn(db, 'movies', 'description');
  const shouldRebuildTvShows = hasColumn(db, 'tv_shows', 'description');
  if (!shouldRebuildMovies && !shouldRebuildTvShows) {
    return;
  }

  const restoreForeignKeys = getForeignKeysEnabled(db);
  db.pragma('foreign_keys = OFF');

  try {
    db.transaction(() => {
      if (shouldRebuildMovies) {
        rebuildMoviesWithoutDescription(db);
      }
      if (shouldRebuildTvShows) {
        rebuildTvShowsWithoutDescription(db);
      }
    })();
    assertNoForeignKeyViolations(db);
  } finally {
    if (restoreForeignKeys) {
      db.pragma('foreign_keys = ON');
    }
  }
}
```

- [ ] **Step 5: Call the removal migration**

In `migrate(db)`, call `removeDescriptionColumns(db)` after the existing topic/repost backfills:

```ts
export function migrate(db: AppDatabase) {
  const schema = fs.readFileSync(resolveSchemaPath(), 'utf8');
  db.exec(schema);
  ensureColumn(db, 'movies', 'topic_key', "TEXT NOT NULL DEFAULT 'FOREIGN_MOVIES' CHECK (topic_key IN ('FOREIGN_MOVIES', 'PINOY_MOVIES', 'ANIME', 'VIVAMAX'))");
  ensureColumn(db, 'tv_shows', 'topic_key', "TEXT NOT NULL DEFAULT 'FOREIGN_TV_SERIES' CHECK (topic_key IN ('FOREIGN_TV_SERIES', 'PINOY_TV_SERIES', 'ANIME', 'VIVAMAX'))");
  ensureColumn(db, 'seasons', 'needs_repost', 'INTEGER NOT NULL DEFAULT 0 CHECK (needs_repost IN (0, 1))');
  db.prepare("UPDATE movies SET topic_key = 'FOREIGN_MOVIES' WHERE topic_key IS NULL OR TRIM(topic_key) = ''").run();
  db.prepare("UPDATE tv_shows SET topic_key = 'FOREIGN_TV_SERIES' WHERE topic_key IS NULL OR TRIM(topic_key) = ''").run();
  removeDescriptionColumns(db);
}
```

- [ ] **Step 6: Run database tests**

Run:

```bash
npm.cmd test -- tests/server/db.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit database migration**

```bash
git add src/server/db/schema.sql src/server/db/migrate.ts tests/server/db.test.ts
git commit -m "db: remove media description columns"
```

## Task 2: Remove Description From Media API And Repository

**Files:**
- Modify: `src/server/media/media.schemas.ts`
- Modify: `src/server/media/media.repository.ts`
- Modify: `src/server/media/media.service.ts`
- Modify: `tests/server/media.movies.test.ts`
- Modify: `tests/server/media.tv.test.ts`
- Modify: `tests/server/admin.dashboard.test.ts`

- [ ] **Step 1: Update media API tests to stop sending and expecting description**

In `tests/server/media.movies.test.ts`, remove `description` from request bodies and expectations. Replace assertions like this:

```ts
expect(response.body.movie).toMatchObject({
  tmdbId: 27205,
  title: 'Inception',
  year: 2010,
  posterUrl: 'https://example.com/inception.jpg',
  rating: 8.8,
  quality: 'Full HD'
});
expect(response.body.movie).not.toHaveProperty('description');
```

Update direct inserts to omit `description`:

```ts
db.prepare("INSERT INTO movies (title, year, quality) VALUES ('Arrival', 2016, 'HD')").run();
```

In `tests/server/media.tv.test.ts`, make the same change for `tv_shows`:

```ts
db.prepare("INSERT INTO tv_shows (title, year, poster_url, quality) VALUES ('Chronos', 2025, 'https://example.com/chronos.jpg', 'HD')").run();
```

In `tests/server/admin.dashboard.test.ts`, replace description inserts with:

```ts
db.prepare(
  `INSERT INTO movies (title, quality, post_status, telegram_message_id)
   VALUES ('Posted Movie', 'HD', 'posted', 123)`
).run();
db.prepare(
  `INSERT INTO tv_shows (title, quality)
   VALUES ('Series', 'HD')`
).run();
```

- [ ] **Step 2: Run media tests to verify failure**

Run:

```bash
npm.cmd test -- tests/server/media.movies.test.ts tests/server/media.tv.test.ts tests/server/admin.dashboard.test.ts
```

Expected: FAIL because repository responses still include description or SQL still references missing columns after Task 1.

- [ ] **Step 3: Remove description from input schema**

In `src/server/media/media.schemas.ts`, replace `MediaInputBaseSchema` with:

```ts
const MediaInputBaseSchema = z.object({
  tmdbId: z.number().int().positive().optional(),
  title: z.string().trim().min(1),
  year: z.number().int().positive().optional(),
  posterUrl: z.union([HttpUrlSchema, z.literal('')]).optional(),
  rating: z.number().optional(),
  quality: QualitySchema
});
```

- [ ] **Step 4: Remove description from repository types and mappers**

In `src/server/media/media.repository.ts`, remove `description: string;` from these exported and internal types:

```ts
export type Movie = {
  id: number;
  tmdbId?: number;
  title: string;
  year?: number;
  posterUrl?: string;
  rating?: number;
  quality: string;
  topicKey: string;
  telegramMessageId?: number;
  postStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type TvShow = {
  id: number;
  tmdbId?: number;
  title: string;
  year?: number;
  posterUrl?: string;
  rating?: number;
  quality: string;
  topicKey: string;
  createdAt: string;
  updatedAt: string;
};

export type SeasonPostData = {
  id: number;
  tvShowId: number;
  seasonNumber: number;
  telegramMessageId?: number;
  postStatus: string;
  title: string;
  year?: number;
  posterUrl?: string;
  rating?: number;
  quality: string;
  topicKey: string;
  episodes: Array<Episode & { links: EpisodeLink[] }>;
};
```

Remove `description` from `MovieRow`, `TvShowRow`, and `SeasonPostRow`. Remove these mapper properties:

```ts
description: row.description,
```

- [ ] **Step 5: Remove description from movie SQL**

In `src/server/media/media.repository.ts`, replace movie selects with the non-description column list:

```sql
SELECT id, tmdb_id, title, year, poster_url, rating, quality, topic_key,
       telegram_message_id, post_status, created_at, updated_at
FROM movies
```

Replace create movie SQL with:

```ts
`INSERT INTO movies (tmdb_id, title, year, poster_url, rating, quality, topic_key)
 VALUES (?, ?, ?, ?, ?, ?, ?)`
```

Use this `.run(...)` argument list:

```ts
input.tmdbId ?? null,
input.title,
input.year ?? null,
input.posterUrl ? input.posterUrl : null,
input.rating ?? null,
input.quality,
input.topicKey
```

Replace update movie SQL with:

```ts
`UPDATE movies
 SET tmdb_id = ?,
     title = ?,
     year = ?,
     poster_url = ?,
     rating = ?,
     quality = ?,
     topic_key = ?,
     updated_at = CURRENT_TIMESTAMP
 WHERE id = ?`
```

Use this `.run(...)` argument list:

```ts
input.tmdbId ?? null,
input.title,
input.year ?? null,
input.posterUrl ? input.posterUrl : null,
input.rating ?? null,
input.quality,
input.topicKey,
id
```

- [ ] **Step 6: Remove description from TV SQL and season post data**

Replace TV show selects with:

```sql
SELECT id, tmdb_id, title, year, poster_url, rating, quality, topic_key, created_at, updated_at
FROM tv_shows
```

Replace create TV SQL with:

```ts
`INSERT INTO tv_shows (tmdb_id, title, year, poster_url, rating, quality, topic_key)
 VALUES (?, ?, ?, ?, ?, ?, ?)`
```

Use this `.run(...)` argument list:

```ts
input.tmdbId ?? null,
input.title,
input.year ?? null,
input.posterUrl ? input.posterUrl : null,
input.rating ?? null,
input.quality,
input.topicKey
```

Replace update TV SQL with:

```ts
`UPDATE tv_shows
 SET tmdb_id = ?,
     title = ?,
     year = ?,
     poster_url = ?,
     rating = ?,
     quality = ?,
     topic_key = ?,
     updated_at = CURRENT_TIMESTAMP
 WHERE id = ?`
```

Use this `.run(...)` argument list:

```ts
input.tmdbId ?? null,
input.title,
input.year ?? null,
input.posterUrl ? input.posterUrl : null,
input.rating ?? null,
input.quality,
input.topicKey,
id
```

In `getSeasonPostData`, remove `tv_shows.description` from the SELECT list and remove `description: row.description` from the return value.

- [ ] **Step 7: Run server media tests**

Run:

```bash
npm.cmd test -- tests/server/media.movies.test.ts tests/server/media.tv.test.ts tests/server/admin.dashboard.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit media API cleanup**

```bash
git add src/server/media/media.schemas.ts src/server/media/media.repository.ts src/server/media/media.service.ts tests/server/media.movies.test.ts tests/server/media.tv.test.ts tests/server/admin.dashboard.test.ts
git commit -m "refactor: remove descriptions from media api"
```

## Task 3: Remove Description From TMDB Search Results

**Files:**
- Modify: `src/server/tmdb/tmdb.service.ts`
- Modify: `src/client/components/TmdbSearch.tsx`
- Modify: `tests/server/tmdb.service.test.ts`

- [ ] **Step 1: Update TMDB tests**

In `tests/server/tmdb.service.test.ts`, remove `description` from expected results and assert it is absent:

```ts
expect(results[0]).toEqual({
  tmdbId: 27205,
  title: 'Inception',
  year: 2010,
  posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
  rating: 8.4
});
expect(results[0]).not.toHaveProperty('description');
```

- [ ] **Step 2: Run TMDB tests to verify failure**

Run:

```bash
npm.cmd test -- tests/server/tmdb.service.test.ts
```

Expected: FAIL because `description` is still returned.

- [ ] **Step 3: Remove description from TMDB result type and mapper**

In `src/server/tmdb/tmdb.service.ts`, replace `TmdbResult` with:

```ts
export type TmdbResult = {
  tmdbId: number;
  title: string;
  year?: number;
  posterUrl?: string;
  rating?: number;
};
```

Keep `overview?: unknown;` in `TmdbApiResult` because TMDB payload fixtures include it, but do not read it when building `TmdbResult`.

Replace the normalized object creation with:

```ts
const normalized: TmdbResult = {
  tmdbId: result.id,
  title
};
```

- [ ] **Step 4: Remove description from client TMDB type**

In `src/client/components/TmdbSearch.tsx`, replace `TmdbResult` with:

```ts
export type TmdbResult = {
  tmdbId: number;
  title: string;
  year?: number;
  posterUrl?: string;
  rating?: number;
};
```

- [ ] **Step 5: Run TMDB tests**

Run:

```bash
npm.cmd test -- tests/server/tmdb.service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit TMDB cleanup**

```bash
git add src/server/tmdb/tmdb.service.ts src/client/components/TmdbSearch.tsx tests/server/tmdb.service.test.ts
git commit -m "refactor: remove descriptions from tmdb search results"
```

## Task 4: Remove Description From Admin UI

**Files:**
- Modify: `src/client/pages/MovieForm.tsx`
- Modify: `src/client/pages/TvShowForm.tsx`
- Modify: `src/client/pages/MoviesPage.tsx`
- Modify: `src/client/pages/TvShowsPage.tsx`
- Modify: `tests/client/App.test.tsx`

- [ ] **Step 1: Update client tests**

In `tests/client/App.test.tsx`, remove `description` from mocked movie, TV show, and TMDB result payloads. Add form assertions near existing add/edit form tests:

```ts
expect(screen.queryByLabelText(/^description$/i)).not.toBeInTheDocument();
```

Add list assertions near existing table tests:

```ts
expect(screen.queryByRole('columnheader', { name: /^description$/i })).not.toBeInTheDocument();
expect(screen.queryByText('No description')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run client tests to verify failure**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: FAIL because the description textarea and table columns still render.

- [ ] **Step 3: Remove description from MovieForm**

In `src/client/pages/MovieForm.tsx`:

Remove this from `MoviePayload`:

```ts
description: string;
```

Remove state and setters:

```ts
const [description, setDescription] = useState('');
setDescription('');
setDescription(movie.description);
setDescription(result.description);
```

Remove `description` from the request body:

```ts
const body = {
  tmdbId: tmdbId.trim() ? Number(tmdbId) : undefined,
  title,
  year: year.trim() ? Number(year) : undefined,
  posterUrl: trimmedPosterUrl,
  rating: rating.trim() ? Number(rating) : undefined,
  quality,
  topicKey,
  links
};
```

Remove the Description label block:

```tsx
<label className="field-grid__wide">
  Description
  <textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} />
</label>
```

- [ ] **Step 4: Remove description from TvShowForm**

In `src/client/pages/TvShowForm.tsx`, make the same removals. The final request body should be:

```ts
const body = {
  tmdbId: tmdbId.trim() ? Number(tmdbId) : undefined,
  title,
  year: year.trim() ? Number(year) : undefined,
  posterUrl: trimmedPosterUrl,
  rating: rating.trim() ? Number(rating) : undefined,
  quality,
  topicKey
};
```

- [ ] **Step 5: Remove description from MoviesPage**

In `src/client/pages/MoviesPage.tsx`, replace the `Movie` type with:

```ts
type Movie = {
  id: number;
  title: string;
  year?: number;
};
```

Remove this table header and cell:

```tsx
<th>Description</th>
<td>{movie.description || 'No description'}</td>
```

- [ ] **Step 6: Remove description from TvShowsPage**

In `src/client/pages/TvShowsPage.tsx`, replace the `TvShow` type with:

```ts
type TvShow = {
  id: number;
  title: string;
  year?: number;
};
```

Remove this table header and cell:

```tsx
<th>Description</th>
<td>{tvShow.description || 'No description'}</td>
```

- [ ] **Step 7: Run client tests**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit UI cleanup**

```bash
git add src/client/pages/MovieForm.tsx src/client/pages/TvShowForm.tsx src/client/pages/MoviesPage.tsx src/client/pages/TvShowsPage.tsx tests/client/App.test.tsx
git commit -m "refactor: remove descriptions from admin ui"
```

## Task 5: Remove Description From Telegram Captions

**Files:**
- Modify: `src/server/telegram/telegram.formatter.ts`
- Modify: `tests/server/telegram.formatter.test.ts`
- Modify: `tests/server/telegram.queue.test.ts`

- [ ] **Step 1: Update formatter tests**

In `tests/server/telegram.formatter.test.ts`, replace the movie caption test with one that expects no description section:

```ts
it('formats movie title/year, rating, quality, links, and footer directly in the caption', () => {
  const caption = formatMovieCaption({
    title: 'Inception',
    year: 2010,
    rating: 8.8,
    quality: 'Full HD',
    links: [
      { providerName: 'Provider A', quality: 'Full HD', url: 'https://example.com/a' }
    ]
  });

  expect(caption).toContain('Inception (2010)');
  expect(caption).toContain('Rating: 8.8');
  expect(caption).toContain('Quality: Full HD');
  expect(caption).toContain('Provider A - https://example.com/a');
  expect(caption).toContain('@dlhubcatalog_bot');
});
```

Replace the season caption test with:

```ts
it('formats season title/year, rating, quality, linked episodes, and footer directly in the caption', () => {
  const caption = formatSeasonCaption({
    title: 'Chronos',
    seasonNumber: 1,
    year: 2025,
    rating: 7.5,
    quality: 'HD',
    episodes: [
      {
        episodeNumber: 1,
        links: [{ providerName: 'Provider A', quality: 'HD', url: 'https://example.com/e1' }]
      }
    ]
  });

  expect(caption).toContain('Chronos (2025) - Season 1');
  expect(caption).toContain('Rating: 7.5');
  expect(caption).toContain('Quality: HD');
  expect(caption).toContain('Episode 1');
  expect(caption).toContain('Provider A - https://example.com/e1');
});
```

Delete the test named `trims long descriptions first so required title, meta, and links remain within the caption limit`.

In `tests/server/telegram.queue.test.ts`, remove `description` from `INSERT INTO movies` and `INSERT INTO tv_shows` helper SQL:

```ts
db.prepare('INSERT OR IGNORE INTO movies (id, title, poster_url, quality) VALUES (?, ?, ?, ?)').run(
  id,
  title,
  posterUrl,
  quality
);
db.prepare('INSERT OR IGNORE INTO tv_shows (id, title, poster_url, quality) VALUES (?, ?, ?, ?)').run(
  id,
  title,
  posterUrl,
  quality
);
```

- [ ] **Step 2: Run Telegram tests to verify failure**

Run:

```bash
npm.cmd test -- tests/server/telegram.formatter.test.ts tests/server/telegram.queue.test.ts
```

Expected: FAIL because formatter types and some queue fixtures still reference description.

- [ ] **Step 3: Remove description from caption types and fit logic**

In `src/server/telegram/telegram.formatter.ts`, remove `description?: string;` from `TelegramMovieCaptionInput`, `TelegramSeasonCaptionInput`, and `fitCaption` input.

Replace `formatMovieCaption` with:

```ts
export function formatMovieCaption(input: TelegramMovieCaptionInput): string {
  return fitCaption({
    heading: `🎬 ${formatTitle(input.title, input.year)}`,
    meta: formatMeta(input.rating, input.quality),
    trailing: formatMovieLinks(input.links ?? [])
  });
}
```

Replace `formatSeasonCaption` with:

```ts
export function formatSeasonCaption(input: TelegramSeasonCaptionInput): string {
  return fitCaption({
    heading: `📺 ${formatTitle(input.title, input.year)} - Season ${input.seasonNumber}`,
    meta: formatMeta(input.rating, input.quality),
    trailing: formatEpisodes(input.episodes ?? [])
  });
}
```

Replace `fitCaption` with:

```ts
function fitCaption(input: {
  heading: string;
  meta: string[];
  trailing: CaptionBlock[];
}): string {
  const fullCaption = composeCaption(input.heading, input.meta, input.trailing);

  if (fullCaption.length <= TELEGRAM_PHOTO_CAPTION_LIMIT) {
    return fullCaption;
  }

  return composeRequiredWithinLimit(input.heading, input.meta, input.trailing);
}
```

Replace `composeCaption` with:

```ts
function composeCaption(
  heading: string,
  meta: string[],
  trailing: CaptionBlock[]
): string {
  const trailingLines = trailing.flat();
  const sections = [[heading, ...meta], trailingLines]
    .filter((section) => section.length > 0)
    .map((section) => section.join('\n'));

  return sections.join('\n\n');
}
```

Delete the `trimDescription` function entirely.

- [ ] **Step 4: Run Telegram tests**

Run:

```bash
npm.cmd test -- tests/server/telegram.formatter.test.ts tests/server/telegram.queue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Telegram cleanup**

```bash
git add src/server/telegram/telegram.formatter.ts tests/server/telegram.formatter.test.ts tests/server/telegram.queue.test.ts
git commit -m "refactor: remove descriptions from telegram captions"
```

## Task 6: Global Description Cleanup And Public Bot Check

**Files:**
- Modify: any remaining root-app tests found by `rg`
- Inspect: `apps/public-search-bot/src`
- Inspect: `apps/public-search-bot/tests`

- [ ] **Step 1: Search remaining media description references**

Run:

```bash
rg -n "description|Description|overview|trimDescription" src tests apps/public-search-bot -S
```

Expected remaining references are only generic Telegram API error `description` fields in Telegram client code/tests and non-media service descriptions. Remove root media references that still point to movie or TV show descriptions.

- [ ] **Step 2: Clean remaining root media test fixtures**

For any remaining root test insert like:

```sql
INSERT INTO movies (..., description, ...)
```

rewrite it without `description`. For any expected object containing:

```ts
description: ''
```

remove that property and add this assertion when useful:

```ts
expect(result).not.toHaveProperty('description');
```

- [ ] **Step 3: Confirm public search bot has no catalog description dependency**

Run:

```bash
rg -n "public_movies|public_tv_shows|description" apps/public-search-bot/src apps/public-search-bot/tests -S
```

Expected: no public catalog schema or repository field named media description. Keep Telegram API response `description` error fields unchanged because they are unrelated to media content.

- [ ] **Step 4: Run full tests**

Run:

```bash
npm.cmd test
```

Expected: PASS.

- [ ] **Step 5: Commit remaining cleanup**

If Step 2 changed files:

```bash
git add src tests apps/public-search-bot
git commit -m "test: remove remaining media description fixtures"
```

If Step 2 changed no files, skip the commit.

## Task 7: Build, Release, And Final Verification

**Files:**
- Verify: `package.json`
- Verify: `scripts/build-windows-release.ts`
- Verify: `release/windows/InfinityLinks`

- [ ] **Step 1: Run production build**

Run:

```bash
npm.cmd run build
```

Expected: PASS.

- [ ] **Step 2: Build Windows release**

Run:

```bash
npm.cmd run build:release:win
```

Expected: PASS with no `Cannot resolve` pkg warning.

- [ ] **Step 3: Verify Windows release contents**

Run:

```bash
npm.cmd run verify:release:win
```

Expected:

```text
Windows release verification passed.
```

- [ ] **Step 4: Smoke-test generated exe**

Run this PowerShell command from the repo root:

```powershell
$releaseDir = Join-Path (Get-Location) 'release/windows/InfinityLinks'
$env:TMDB_API_KEY = 'smoke-tmdb-key'
$env:TELEGRAM_BOT_TOKEN = '123456:smoke-token'
$env:TELEGRAM_CHANNEL_ID = '@smoke_channel'
$env:HOST = '127.0.0.1'
$env:PORT = '3123'
$env:DATABASE_PATH = './data/smoke.sqlite'
$p = Start-Process -FilePath (Join-Path $releaseDir 'InfinityLinks.exe') -WorkingDirectory $releaseDir -WindowStyle Hidden -PassThru
try {
  $ok = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ($p.HasExited) { throw "Executable exited early with code $($p.ExitCode)" }
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3123/api/health' -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and $response.Content -match '"ok"\s*:\s*true') {
        $ok = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ok) { throw 'Executable did not answer /api/health in time' }
  Write-Host 'Executable smoke test passed.'
} finally {
  if (-not $p.HasExited) {
    Stop-Process -Id $p.Id -Force
  }
}
```

Expected:

```text
Executable smoke test passed.
```

- [ ] **Step 5: Remove smoke database**

Run:

```powershell
$releaseData = Resolve-Path 'release/windows/InfinityLinks/data'
$workspace = Resolve-Path '.'
if (-not ($releaseData.Path.StartsWith($workspace.Path))) { throw 'Refusing to clean outside workspace.' }
Get-ChildItem -LiteralPath $releaseData.Path -Filter 'smoke.sqlite*' -File | Remove-Item -Force
```

Expected: no output.

- [ ] **Step 6: Commit no-op release artifacts policy**

Run:

```bash
git status --short
```

Expected: no tracked release output is staged. The ignored `release/` folder can exist locally and should not be committed.

## Task 8: Final Status And Push

**Files:**
- Inspect: git status

- [ ] **Step 1: Confirm branch status**

Run:

```bash
git status --short --branch
```

Expected: only unrelated pre-existing untracked root release files may remain, such as `InfinityLinks.exe`, `README.txt`, `client/`, and `schema.sql`.

- [ ] **Step 2: Push main**

Run:

```bash
git push origin main
```

Expected: `main -> main`.

- [ ] **Step 3: Report outcome**

Report:

```text
Description removed from UI, API, SQLite schema/migration, TMDB result mapping, Telegram captions, and tests.
npm.cmd test passed.
npm.cmd run build passed.
npm.cmd run build:release:win passed.
npm.cmd run verify:release:win passed.
```

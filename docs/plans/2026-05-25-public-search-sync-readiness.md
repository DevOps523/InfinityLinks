# Public Search Sync Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the local Public Search page show whether public-searchable catalog changes are ready to sync, and disable `Sync Public Search` when everything is already synced.

**Architecture:** The local admin server will build the same public catalog used for sync, normalize it without `generatedAt`, hash it, and compare that hash with a single-row local sync state table. The Public Search page will load this readiness status on mount, enable sync only when pending changes exist, and refresh readiness after successful sync.

**Tech Stack:** TypeScript, Express, better-sqlite3, React, Vitest, Testing Library.

---

### Task 1: Add Local Sync State Migration

**Files:**
- Modify: `src/server/db/schema.sql`
- Modify: `src/server/db/migrate.ts`
- Test: `tests/server/db.test.ts`

**Step 1: Write the failing migration test**

Add a test that migrates an in-memory database and verifies `public_search_sync_state` exists with the expected columns.

```ts
it('creates public search sync state table', () => {
  const db = createDatabase(':memory:');

  try {
    migrate(db);

    const columns = db.prepare('PRAGMA table_info(public_search_sync_state)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'last_successful_sync_at',
      'last_catalog_hash',
      'last_movie_count',
      'last_tv_show_count',
      'updated_at'
    ]);
  } finally {
    db.close();
  }
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd test -- tests/server/db.test.ts
```

Expected: FAIL because `public_search_sync_state` does not exist.

**Step 3: Add schema**

Add this table to `src/server/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS public_search_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_successful_sync_at TEXT,
  last_catalog_hash TEXT,
  last_movie_count INTEGER NOT NULL DEFAULT 0,
  last_tv_show_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

No destructive migration is needed. Existing databases receive the table through the current schema execution.

**Step 4: Run test to verify it passes**

Run:

```bash
npm.cmd test -- tests/server/db.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/db/schema.sql tests/server/db.test.ts
git commit -m "feat: add public search sync state table"
```

Do not stage unrelated changes such as `README.md` or `apps/public-search-bot/.env.example`.

---

### Task 2: Add Catalog Fingerprint And Sync State Repository

**Files:**
- Create: `src/server/public-search/sync-state.repository.ts`
- Modify: `src/server/public-search/catalog.ts`
- Test: `tests/public-search/public-search.catalog.test.ts`
- Test: `tests/public-search/public-search.sync-state.test.ts`

**Step 1: Write failing fingerprint tests**

In `tests/public-search/public-search.catalog.test.ts`, add a test proving `generatedAt` does not change the fingerprint.

```ts
import { buildPublicSearchCatalog, createPublicSearchCatalogFingerprint } from '../../src/server/public-search/catalog.js';

it('creates the same fingerprint when only generatedAt changes', () => {
  insertPostedMovieWithActiveLink(db);

  const first = buildPublicSearchCatalog(db, {
    channelHandle: '@infinitylinks65',
    groupHandle: '@infinitylinks69',
    now: () => new Date('2026-05-25T00:00:00.000Z')
  });
  const second = buildPublicSearchCatalog(db, {
    channelHandle: '@infinitylinks65',
    groupHandle: '@infinitylinks69',
    now: () => new Date('2026-05-25T00:01:00.000Z')
  });

  expect(first.generatedAt).not.toBe(second.generatedAt);
  expect(createPublicSearchCatalogFingerprint(first)).toBe(createPublicSearchCatalogFingerprint(second));
});
```

Create `tests/public-search/public-search.sync-state.test.ts` with tests for reading empty state and upserting a successful sync.

```ts
it('returns null when public search sync state has not been stored', () => {
  expect(getPublicSearchSyncState(db)).toBeNull();
});

it('stores the last successful public search sync state', () => {
  upsertPublicSearchSyncState(db, {
    syncedAt: '2026-05-25T00:00:00.000Z',
    catalogHash: 'hash-1',
    movieCount: 1,
    tvShowCount: 2
  });

  expect(getPublicSearchSyncState(db)).toMatchObject({
    lastSuccessfulSyncAt: '2026-05-25T00:00:00.000Z',
    lastCatalogHash: 'hash-1',
    lastMovieCount: 1,
    lastTvShowCount: 2
  });
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.catalog.test.ts tests/public-search/public-search.sync-state.test.ts
```

Expected: FAIL because the fingerprint and repository do not exist.

**Step 3: Implement fingerprint**

In `src/server/public-search/catalog.ts`, import Node crypto and add:

```ts
import { createHash } from 'node:crypto';
```

Add:

```ts
export function createPublicSearchCatalogFingerprint(catalog: PublicSearchCatalog) {
  const { generatedAt: _generatedAt, ...fingerprintCatalog } = catalog;
  return createHash('sha256').update(JSON.stringify(fingerprintCatalog)).digest('hex');
}
```

The catalog builders already produce deterministic ordering, so dropping `generatedAt` is enough for a stable fingerprint.

**Step 4: Implement repository**

Create `src/server/public-search/sync-state.repository.ts`:

```ts
import type { AppDatabase } from '../db/database.js';

export type PublicSearchSyncState = {
  lastSuccessfulSyncAt: string;
  lastCatalogHash: string;
  lastMovieCount: number;
  lastTvShowCount: number;
};

type PublicSearchSyncStateRow = {
  last_successful_sync_at: string | null;
  last_catalog_hash: string | null;
  last_movie_count: number;
  last_tv_show_count: number;
};

export function getPublicSearchSyncState(db: AppDatabase): PublicSearchSyncState | null {
  const row = db
    .prepare(
      `SELECT last_successful_sync_at,
              last_catalog_hash,
              last_movie_count,
              last_tv_show_count
         FROM public_search_sync_state
        WHERE id = 1`
    )
    .get() as PublicSearchSyncStateRow | undefined;

  if (!row?.last_successful_sync_at || !row.last_catalog_hash) {
    return null;
  }

  return {
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastCatalogHash: row.last_catalog_hash,
    lastMovieCount: row.last_movie_count,
    lastTvShowCount: row.last_tv_show_count
  };
}

export function upsertPublicSearchSyncState(
  db: AppDatabase,
  input: {
    syncedAt: string;
    catalogHash: string;
    movieCount: number;
    tvShowCount: number;
  }
) {
  db.prepare(
    `INSERT INTO public_search_sync_state (
       id,
       last_successful_sync_at,
       last_catalog_hash,
       last_movie_count,
       last_tv_show_count,
       updated_at
     )
     VALUES (1, @syncedAt, @catalogHash, @movieCount, @tvShowCount, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       last_successful_sync_at = excluded.last_successful_sync_at,
       last_catalog_hash = excluded.last_catalog_hash,
       last_movie_count = excluded.last_movie_count,
       last_tv_show_count = excluded.last_tv_show_count,
       updated_at = CURRENT_TIMESTAMP`
  ).run(input);
}
```

**Step 5: Run tests to verify they pass**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.catalog.test.ts tests/public-search/public-search.sync-state.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/server/public-search/catalog.ts src/server/public-search/sync-state.repository.ts tests/public-search/public-search.catalog.test.ts tests/public-search/public-search.sync-state.test.ts
git commit -m "feat: track public search catalog fingerprint"
```

---

### Task 3: Add Local Sync Readiness Service And API

**Files:**
- Modify: `src/server/public-search/sync.service.ts`
- Modify: `src/server/public-search/public-search.routes.ts`
- Test: `tests/public-search/public-search.sync-route.test.ts`

**Step 1: Write failing route tests**

Add tests for:

- `GET /api/public-search/sync-status` returns pending changes before first sync when one posted movie exists.
- A successful `POST /api/public-search/sync` stores the hash.
- A second `GET /api/public-search/sync-status` returns `hasPendingChanges: false`.
- Failed remote sync does not store state.

Example assertion:

```ts
const status = await request(app(config, fetchMock)).get('/api/public-search/sync-status').expect(200);

expect(status.body).toMatchObject({
  configured: true,
  hasPublicSearchableContent: true,
  hasPendingChanges: true,
  current: {
    movies: 1,
    tvShows: 0,
    catalogHash: expect.any(String)
  },
  lastSuccessfulSync: null
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.sync-route.test.ts
```

Expected: FAIL because the status route does not exist and POST does not store state.

**Step 3: Implement readiness calculation**

In `src/server/public-search/sync.service.ts`, add a type and helper:

```ts
export type PublicSearchSyncStatus = {
  configured: boolean;
  hasPublicSearchableContent: boolean;
  hasPendingChanges: boolean;
  current: {
    catalogHash: string;
    movies: number;
    tvShows: number;
  };
  lastSuccessfulSync: null | {
    syncedAt: string;
    movies: number;
    tvShows: number;
  };
};

export function getPublicSearchSyncStatus(db: AppDatabase, config: AppConfig): PublicSearchSyncStatus {
  const catalog = buildPublicSearchCatalog(db, {
    channelHandle: config.publicSearchChannelHandle,
    groupHandle: config.publicSearchGroupHandle
  });
  const catalogHash = createPublicSearchCatalogFingerprint(catalog);
  const state = getPublicSearchSyncState(db);
  const hasPublicSearchableContent = catalog.movies.length > 0 || catalog.tvShows.length > 0;

  return {
    configured: Boolean(config.publicSearchSyncUrl && config.publicSearchSyncToken),
    hasPublicSearchableContent,
    hasPendingChanges: hasPublicSearchableContent && state?.lastCatalogHash !== catalogHash,
    current: {
      catalogHash,
      movies: catalog.movies.length,
      tvShows: catalog.tvShows.length
    },
    lastSuccessfulSync: state
      ? {
          syncedAt: state.lastSuccessfulSyncAt,
          movies: state.lastMovieCount,
          tvShows: state.lastTvShowCount
        }
      : null
  };
}
```

Update `syncPublicSearchCatalog` so it computes the fingerprint from the same catalog it sends, and only after a successful remote response calls `upsertPublicSearchSyncState`.

**Step 4: Add route**

In `src/server/public-search/public-search.routes.ts`, add:

```ts
router.get('/public-search/sync-status', (_req, res) => {
  res.json(getPublicSearchSyncStatus(db, config));
});
```

Make sure `POST /public-search/sync` returns the existing `sync` object plus the refreshed `status` object.

**Step 5: Run tests to verify they pass**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.sync-route.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/server/public-search/sync.service.ts src/server/public-search/public-search.routes.ts tests/public-search/public-search.sync-route.test.ts
git commit -m "feat: expose public search sync readiness"
```

---

### Task 4: Update Public Search Page UI

**Files:**
- Modify: `src/client/pages/PublicSearchPage.tsx`
- Test: `tests/client/App.test.tsx`

**Step 1: Write failing UI tests**

Add tests that mock API calls and verify:

- The page shows `Checking sync readiness...` while loading.
- The button is disabled when status says `hasPendingChanges: false`.
- The button is enabled and text says `1 movie ready to sync` when pending changes exist.
- After successful sync, the UI updates to `Everything is synced`.

Use existing `App.test.tsx` navigation patterns for opening the Public Search page.

**Step 2: Run tests to verify they fail**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: FAIL because the UI does not load readiness status yet.

**Step 3: Add client status types and fetcher**

In `src/client/pages/PublicSearchPage.tsx`, add:

```ts
type PublicSearchSyncStatus = {
  configured: boolean;
  hasPublicSearchableContent: boolean;
  hasPendingChanges: boolean;
  current: {
    catalogHash: string;
    movies: number;
    tvShows: number;
  };
  lastSuccessfulSync: null | {
    syncedAt: string;
    movies: number;
    tvShows: number;
  };
};
```

Update `SyncResponse` to include:

```ts
status: PublicSearchSyncStatus;
```

Load `/api/public-search/sync-status` in a `useEffect`.

**Step 4: Add readiness message helper**

Add a small helper in the component file:

```ts
function formatSyncReadiness(status: PublicSearchSyncStatus | null, isLoading: boolean) {
  if (isLoading) {
    return 'Checking sync readiness...';
  }
  if (!status?.hasPublicSearchableContent) {
    return 'No public-searchable content yet';
  }
  if (!status.hasPendingChanges) {
    return 'Everything is synced';
  }

  const parts = [];
  if (status.current.movies > 0) {
    parts.push(`${status.current.movies} ${status.current.movies === 1 ? 'movie' : 'movies'}`);
  }
  if (status.current.tvShows > 0) {
    parts.push(`${status.current.tvShows} TV ${status.current.tvShows === 1 ? 'show' : 'shows'}`);
  }

  return `${parts.join(' and ')} ready to sync`;
}
```

Button disabled rule:

```ts
const canSync = Boolean(syncStatus?.configured && syncStatus.hasPendingChanges && !isSyncing && !isLoadingSyncStatus);
```

Use `disabled={!canSync}`.

**Step 5: Update sync success flow**

After `POST /api/public-search/sync`, set:

```ts
setSyncStatus(payload.status);
```

Keep the existing `syncResult` display, but use readiness text as the main empty/status message.

**Step 6: Run tests to verify they pass**

Run:

```bash
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/client/pages/PublicSearchPage.tsx tests/client/App.test.tsx
git commit -m "feat: show public search sync readiness"
```

---

### Task 5: Full Verification And Documentation

**Files:**
- Modify if needed: `README.md`

**Step 1: Run focused public search tests**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.catalog.test.ts tests/public-search/public-search.sync-state.test.ts tests/public-search/public-search.sync-route.test.ts tests/client/App.test.tsx
```

Expected: PASS.

**Step 2: Run full test suite**

Run:

```bash
npm.cmd test
```

Expected: PASS.

**Step 3: Run build**

Run:

```bash
npm.cmd run build
```

Expected: PASS.

**Step 4: Check git status carefully**

Run:

```bash
git status --short
```

Expected: only intentional files for this feature are modified. Do not stage the unrelated deleted `apps/public-search-bot/.env.example`. Do not accidentally stage the earlier README database reset change unless intentionally documenting the sync readiness feature.

**Step 5: Commit any final docs if needed**

Only if README/docs changed for this feature:

```bash
git add README.md
git commit -m "docs: document public search sync readiness"
```

**Step 6: Final review**

Request a code review using the existing review workflow before merging or declaring done. Confirm no files under `apps/public-search-bot/` changed.

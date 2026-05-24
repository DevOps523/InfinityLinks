import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';
import {
  getPublicSearchSyncState,
  upsertPublicSearchSyncState
} from '../../src/server/public-search/sync-state.repository.js';

function createMigratedDatabase() {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

describe('public search sync state repository', () => {
  it('returns null when public search sync state has not been stored', () => {
    const db = createMigratedDatabase();

    try {
      expect(getPublicSearchSyncState(db)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('stores the last successful public search sync state', () => {
    const db = createMigratedDatabase();

    try {
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
    } finally {
      db.close();
    }
  });

  it('replaces the singleton public search sync state on a later successful sync', () => {
    const db = createMigratedDatabase();

    try {
      upsertPublicSearchSyncState(db, {
        syncedAt: '2026-05-25T00:00:00.000Z',
        catalogHash: 'hash-1',
        movieCount: 1,
        tvShowCount: 2
      });

      upsertPublicSearchSyncState(db, {
        syncedAt: '2026-05-25T01:00:00.000Z',
        catalogHash: 'hash-2',
        movieCount: 3,
        tvShowCount: 4
      });

      expect(getPublicSearchSyncState(db)).toMatchObject({
        lastSuccessfulSyncAt: '2026-05-25T01:00:00.000Z',
        lastCatalogHash: 'hash-2',
        lastMovieCount: 3,
        lastTvShowCount: 4
      });
      expect(db.prepare('SELECT COUNT(*) AS count FROM public_search_sync_state').get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });
});

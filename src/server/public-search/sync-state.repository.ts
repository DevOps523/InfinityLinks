import type { AppDatabase } from '../db/database.js';

export type PublicSearchSyncState = {
  lastSuccessfulSyncAt: string;
  lastCatalogHash: string;
  lastMovieCount: number;
  lastTvShowCount: number;
};

export type UpsertPublicSearchSyncStateInput = {
  syncedAt: string;
  catalogHash: string;
  movieCount: number;
  tvShowCount: number;
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

export function upsertPublicSearchSyncState(db: AppDatabase, input: UpsertPublicSearchSyncStateInput): void {
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

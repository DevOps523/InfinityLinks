import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { buildPublicSearchCatalog, createPublicSearchCatalogFingerprint } from './catalog.js';
import { getPublicSearchSyncState, upsertPublicSearchSyncState } from './sync-state.repository.js';

export type PublicSearchSyncStatus = {
  configured: boolean;
  hasPublicSearchableContent: boolean;
  hasPendingChanges: boolean;
  current: {
    catalogHash: string;
    movies: number;
    tvShows: number;
  };
  lastSuccessfulSync: {
    syncedAt: string;
    movies: number;
    tvShows: number;
  } | null;
};

export class PublicSearchSyncError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'PublicSearchSyncError';
  }
}

export async function syncPublicSearchCatalog(
  db: AppDatabase,
  config: AppConfig,
  fetcher: typeof fetch = fetch
) {
  if (!config.publicSearchSyncUrl || !config.publicSearchSyncToken) {
    throw new PublicSearchSyncError(400, 'Public search sync is not configured');
  }

  const catalog = buildPublicSearchCatalog(db, {
    channelHandle: config.publicSearchGroupHandle,
    groupHandle: config.publicSearchGroupHandle
  });
  const catalogHash = createPublicSearchCatalogFingerprint(catalog);

  const headers = new Headers({
    'content-type': 'application/json',
    authorization: `Bearer ${config.publicSearchSyncToken}`
  });

  let response: Response;
  try {
    response = await fetcher(config.publicSearchSyncUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(catalog)
    });
  } catch {
    throw new PublicSearchSyncError(502, 'Public search sync failed');
  }

  if (!response.ok) {
    throw new PublicSearchSyncError(502, 'Public search sync failed');
  }

  const syncedAt = new Date().toISOString();
  upsertPublicSearchSyncState(db, {
    syncedAt,
    catalogHash,
    movieCount: catalog.movies.length,
    tvShowCount: catalog.tvShows.length
  });

  return {
    syncedAt,
    movies: catalog.movies.length,
    tvShows: catalog.tvShows.length
  };
}

export function getPublicSearchSyncStatus(db: AppDatabase, config: AppConfig): PublicSearchSyncStatus {
  const catalog = buildPublicSearchCatalog(db, {
    channelHandle: config.publicSearchGroupHandle,
    groupHandle: config.publicSearchGroupHandle
  });
  const catalogHash = createPublicSearchCatalogFingerprint(catalog);
  const lastSyncState = getPublicSearchSyncState(db);
  const hasPublicSearchableContent = catalog.movies.length > 0 || catalog.tvShows.length > 0;

  return {
    configured: Boolean(config.publicSearchSyncUrl && config.publicSearchSyncToken),
    hasPublicSearchableContent,
    hasPendingChanges: lastSyncState ? catalogHash !== lastSyncState.lastCatalogHash : hasPublicSearchableContent,
    current: {
      catalogHash,
      movies: catalog.movies.length,
      tvShows: catalog.tvShows.length
    },
    lastSuccessfulSync: lastSyncState
      ? {
          syncedAt: lastSyncState.lastSuccessfulSyncAt,
          movies: lastSyncState.lastMovieCount,
          tvShows: lastSyncState.lastTvShowCount
        }
      : null
  };
}

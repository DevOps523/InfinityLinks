import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { buildPublicSearchCatalog } from './catalog.js';

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
    channelHandle: config.publicSearchChannelHandle,
    groupHandle: config.publicSearchGroupHandle
  });

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

  return {
    syncedAt: new Date().toISOString(),
    movies: catalog.movies.length,
    tvShows: catalog.tvShows.length
  };
}

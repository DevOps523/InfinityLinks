import type { AppDatabase } from '../db/database.js';

export type TmdbMediaType = 'movie' | 'tv';

export type TmdbResult = {
  tmdbId: number;
  title: string;
  year?: number;
  posterUrl?: string;
  description: string;
  rating?: number;
};

type TmdbFetcher = (url: string) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json: () => Promise<unknown>;
}>;

type TmdbApiResult = {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  release_date?: unknown;
  first_air_date?: unknown;
  poster_path?: unknown;
  overview?: unknown;
  vote_average?: unknown;
};

function parseYear(date: unknown) {
  if (typeof date !== 'string') {
    return undefined;
  }

  const match = date.match(/^(\d{4})/);
  return match ? Number(match[1]) : undefined;
}

function normalizeResult(mediaType: TmdbMediaType, result: TmdbApiResult): TmdbResult | null {
  if (typeof result.id !== 'number') {
    return null;
  }

  const rawTitle = mediaType === 'movie' ? result.title : result.name;
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (title.length === 0) {
    return null;
  }

  const rawDate = mediaType === 'movie' ? result.release_date : result.first_air_date;
  const normalized: TmdbResult = {
    tmdbId: result.id,
    title,
    description: typeof result.overview === 'string' ? result.overview : ''
  };

  const year = parseYear(rawDate);
  if (year !== undefined) {
    normalized.year = year;
  }

  if (typeof result.poster_path === 'string' && result.poster_path.length > 0) {
    normalized.posterUrl = `https://image.tmdb.org/t/p/w500${result.poster_path}`;
  }

  if (typeof result.vote_average === 'number') {
    normalized.rating = result.vote_average;
  }

  return normalized;
}

function logApiCall(
  db: AppDatabase,
  status: 'succeeded' | 'failed',
  metadata: Record<string, unknown>,
  summary: { responseSummary?: string; errorSummary?: string } = {}
) {
  db.prepare(
    `INSERT INTO api_logs (provider, action, status, request_metadata, response_summary, error_summary)
     VALUES ('tmdb', 'search', ?, ?, ?, ?)`
  ).run(status, JSON.stringify(metadata), summary.responseSummary ?? null, summary.errorSummary ?? null);
}

export async function searchTmdb(
  db: AppDatabase,
  fetcher: TmdbFetcher,
  apiKey: string,
  mediaType: TmdbMediaType,
  rawQuery: string
): Promise<TmdbResult[]> {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 3) {
    return [];
  }

  const cached = db
    .prepare(
      `SELECT result_payload
       FROM tmdb_cache
       WHERE media_type = ? AND query = ? AND expires_at > CURRENT_TIMESTAMP`
    )
    .get(mediaType, query) as { result_payload: string } | undefined;

  if (cached) {
    return JSON.parse(cached.result_payload) as TmdbResult[];
  }

  const params = new URLSearchParams({ api_key: apiKey, query });
  const url = `https://api.themoviedb.org/3/search/${mediaType}?${params.toString()}`;
  const response = await fetcher(url);
  const metadata = { mediaType, query };

  if (!response.ok) {
    const status = response.status ?? 'unknown';
    const message = `TMDB search failed with status ${status}`;
    logApiCall(db, 'failed', metadata, { errorSummary: message });
    throw new Error(message);
  }

  const payload = await response.json();
  const results = Array.isArray((payload as { results?: unknown }).results)
    ? ((payload as { results: TmdbApiResult[] }).results.map((result) => normalizeResult(mediaType, result)).filter(Boolean) as TmdbResult[])
    : [];

  db.prepare(
    `INSERT INTO tmdb_cache (media_type, query, result_payload, expires_at, updated_at)
     VALUES (?, ?, ?, datetime('now', '+60 minutes'), CURRENT_TIMESTAMP)
     ON CONFLICT(media_type, query) DO UPDATE SET
       result_payload = excluded.result_payload,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`
  ).run(mediaType, query, JSON.stringify(results));

  logApiCall(db, 'succeeded', metadata, { responseSummary: JSON.stringify({ count: results.length }) });

  return results;
}

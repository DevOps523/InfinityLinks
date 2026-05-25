import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { createFixedWindowRateLimiter } from '../security/fixed-window-rate-limit.js';
import { withFetchTimeout } from './fetch-timeout.js';
import { searchTmdb, type TmdbMediaType } from './tmdb.service.js';

export type TmdbRouterOptions = {
  fetcher?: typeof fetch;
  rateLimit?: {
    limit: number;
    windowMs: number;
  };
  timeoutMs?: number;
};

export function createTmdbRouter(db: AppDatabase, config: AppConfig, options: TmdbRouterOptions = {}) {
  const router = Router();
  const rateLimit = options.rateLimit ?? { limit: 30, windowMs: 60_000 };
  const rateLimiter = createFixedWindowRateLimiter(rateLimit);
  const fetcher = withFetchTimeout(options.fetcher ?? fetch, options.timeoutMs ?? 10_000);

  router.get('/search', async (req, res, next) => {
    const limit = rateLimiter.check(req.ip);
    if (!limit.allowed) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))));
      res.status(429).json({ error: 'Too many TMDB searches. Please wait and try again.' });
      return;
    }

    try {
      const mediaType: TmdbMediaType = req.query.type === 'tv' ? 'tv' : 'movie';
      const query = typeof req.query.query === 'string' ? req.query.query : '';
      const results = await searchTmdb(db, fetcher, config.tmdbApiKey, mediaType, query);

      res.json({ results });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        res.status(502).json({ error: 'TMDB search failed' });
        return;
      }

      next(error);
    }
  });

  return router;
}

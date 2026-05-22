import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { searchTmdb, type TmdbMediaType } from './tmdb.service.js';

export function createTmdbRouter(db: AppDatabase, config: AppConfig) {
  const router = Router();

  router.get('/search', async (req, res, next) => {
    try {
      const mediaType: TmdbMediaType = req.query.type === 'tv' ? 'tv' : 'movie';
      const query = typeof req.query.query === 'string' ? req.query.query : '';
      const results = await searchTmdb(db, fetch, config.tmdbApiKey, mediaType, query);

      res.json({ results });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { syncPublicSearchCatalog } from './sync.service.js';

export function createPublicSearchRouter(db: AppDatabase, config: AppConfig, fetcher: typeof fetch = fetch) {
  const router = Router();

  router.post('/public-search/sync', async (_req, res, next) => {
    try {
      const result = await syncPublicSearchCatalog(db, config, fetcher);
      res.json({ sync: result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

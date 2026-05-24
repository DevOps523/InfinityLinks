import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { createPublicSearchStatusService, PublicSearchStatusError } from './status.service.js';
import { syncPublicSearchCatalog } from './sync.service.js';

export function createPublicSearchRouter(db: AppDatabase, config: AppConfig, fetcher: typeof fetch = fetch) {
  const router = Router();
  const statusService = createPublicSearchStatusService(config, fetcher);

  router.post('/public-search/sync', async (_req, res, next) => {
    try {
      const result = await syncPublicSearchCatalog(db, config, fetcher);
      res.json({ sync: result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/public-search/status', async (_req, res, next) => {
    try {
      const status = await statusService.checkPublicSearchStatus();
      res.json(status);
    } catch (error) {
      if (error instanceof PublicSearchStatusError) {
        res.status(error.statusCode).json({
          reachable: false,
          lastSuccessfulCheckAt: error.lastSuccessfulCheckAt,
          error: error.message
        });
        return;
      }

      next(error);
    }
  });

  return router;
}

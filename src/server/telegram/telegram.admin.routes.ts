import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AppDatabase } from '../db/database.js';
import { listFailedTelegramJobs, retryFailedTelegramJob } from './telegram.queue.js';

const TELEGRAM_JOBS_FORBIDDEN_RESPONSE = { error: 'You do not have permission to manage Telegram jobs.' };

const IdParamSchema = z.object({
  id: z.preprocess((value) => {
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
      return value;
    }

    return Number(value);
  }, z.number().int().positive())
});

function requireTelegramJobsAdmin(_req: Request, res: Response, next: NextFunction) {
  if (res.locals.authUser?.role !== 'admin') {
    res.status(403).json(TELEGRAM_JOBS_FORBIDDEN_RESPONSE);
    return;
  }

  next();
}

export function createTelegramAdminRouter(db: AppDatabase) {
  const router = Router();

  router.use('/telegram/jobs', requireTelegramJobsAdmin);

  router.get('/telegram/jobs/failed', (_req, res, next) => {
    try {
      res.json({ jobs: listFailedTelegramJobs(db) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/telegram/jobs/:id/retry', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const result = retryFailedTelegramJob(db, id);

      if (result.changes === 0) {
        res.status(404).json({ error: 'Failed Telegram job not found' });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

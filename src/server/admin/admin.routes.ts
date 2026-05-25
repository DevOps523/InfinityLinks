import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { getAdminDashboard } from './admin.service.js';

export function createAdminRouter(db: AppDatabase, config: AppConfig) {
  const router = Router();

  router.get('/admin/dashboard', (_req, res, next) => {
    try {
      res.json({ dashboard: getAdminDashboard(db, config) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

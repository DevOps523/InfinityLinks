import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export function createAdminUsersRouter(_db: AppDatabase) {
  return Router();
}

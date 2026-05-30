import { Router } from 'express';
import type { AuthConfig } from '@auth/core';
import type { AppDatabase } from '../db/database.js';

export function createAuthRouter(_db: AppDatabase, _authConfig: AuthConfig) {
  return Router();
}

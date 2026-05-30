import type { AuthConfig } from '@auth/core';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDatabase } from '../db/database.js';
import { validateReplacementPassword, hashPassword, verifyPassword } from './passwords.js';
import { getRequestSessionUser, refreshSessionUserFromDatabase } from './session.js';
import { findAuthUserById, updateAuthUserPassword } from './users.repository.js';

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(1, 'New password is required.')
});

export function createAuthRouter(db: AppDatabase, authConfig: AuthConfig) {
  const router = Router();

  router.get('/me', async (req, res, next) => {
    try {
      const sessionUser = await getRequestSessionUser(req, authConfig);
      if (!sessionUser) {
        res.json({ user: null });
        return;
      }

      const user = refreshSessionUserFromDatabase(db, sessionUser);
      res.json({ user: user ?? null });
    } catch (error) {
      next(error);
    }
  });

  router.post('/change-password', async (req, res, next) => {
    try {
      const sessionUser = await getRequestSessionUser(req, authConfig);
      if (!sessionUser) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      const input = ChangePasswordSchema.parse(req.body);
      const strength = validateReplacementPassword(input.newPassword);
      if (!strength.valid) {
        res.status(400).json({ error: strength.error });
        return;
      }

      const user = findAuthUserById(db, Number(sessionUser.id));
      if (!user || !verifyPassword(input.currentPassword, user.passwordHash)) {
        res.status(400).json({ error: 'Current password is incorrect.' });
        return;
      }

      updateAuthUserPassword(db, user.id, hashPassword(input.newPassword), false);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

import { Router } from 'express';
import { z } from 'zod';
import { generateTemporaryPassword, hashPassword } from '../auth/passwords.js';
import { requireAdmin } from '../auth/session.js';
import {
  createAuthUser,
  findAuthUserByEmail,
  findAuthUserById,
  listAuthUsers,
  normalizeAuthEmail,
  updateAuthUserPassword
} from '../auth/users.repository.js';
import type { AppDatabase } from '../db/database.js';

const RoleSchema = z.enum(['admin', 'superadmin']);

const CreateUserSchema = z.object({
  email: z.string().trim().email().transform((value) => normalizeAuthEmail(value)),
  role: RoleSchema
});

const IdParamSchema = z.object({
  id: z.preprocess((value) => {
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
      return value;
    }
    return Number(value);
  }, z.number().int().positive())
});

export function createAdminUsersRouter(db: AppDatabase) {
  const router = Router();

  router.use(requireAdmin);

  router.get('/', (_req, res, next) => {
    try {
      res.json({ users: listAuthUsers(db) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const input = CreateUserSchema.parse(req.body);

      if (findAuthUserByEmail(db, input.email)) {
        res.status(409).json({ error: 'A user with that email already exists.' });
        return;
      }

      const temporaryPassword = generateTemporaryPassword();
      const user = createAuthUser(db, {
        email: input.email,
        role: input.role,
        passwordHash: hashPassword(temporaryPassword),
        mustChangePassword: true
      });

      res.status(201).json({ user, temporaryPassword });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/reset-password', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const user = findAuthUserById(db, id);

      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const temporaryPassword = generateTemporaryPassword();
      updateAuthUserPassword(db, id, hashPassword(temporaryPassword), true);

      res.json({ user: { ...user, mustChangePassword: true }, temporaryPassword });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

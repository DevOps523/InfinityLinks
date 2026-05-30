import { Router } from 'express';
import { z } from 'zod';
import { generateTemporaryPassword, hashPassword } from '../auth/passwords.js';
import {
  countAdminUsers,
  createAuthUser,
  deleteAuthUser,
  findAuthUserByEmail,
  findAuthUserById,
  listAuthUsers,
  normalizeAuthEmail,
  updateAuthUser,
  updateAuthUserPassword
} from '../auth/users.repository.js';
import type { AuthUser, PublicAuthUser } from '../auth/users.repository.js';
import type { AppDatabase } from '../db/database.js';

const MANAGE_USERS_FORBIDDEN_RESPONSE = { error: 'You do not have permission to manage users.' };

const RoleSchema = z.enum(['admin', 'superadmin']);

const CreateUserSchema = z.object({
  email: z.string().trim().email().transform((value) => normalizeAuthEmail(value)),
  role: RoleSchema
});

const UpdateUserSchema = CreateUserSchema;

const IdParamSchema = z.object({
  id: z.preprocess((value) => {
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
      return value;
    }
    return Number(value);
  }, z.number().int().positive())
});

function toPublicAuthUser(user: AuthUser): PublicAuthUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

export function createAdminUsersRouter(db: AppDatabase) {
  const router = Router();

  router.use((_req, res, next) => {
    const sessionUserId = Number(res.locals.authUser?.id);
    const user = Number.isInteger(sessionUserId) ? findAuthUserById(db, sessionUserId) : undefined;

    if (user?.role !== 'admin') {
      res.status(403).json(MANAGE_USERS_FORBIDDEN_RESPONSE);
      return;
    }

    next();
  });

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

  router.patch('/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const input = UpdateUserSchema.parse(req.body);
      const user = findAuthUserById(db, id);

      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const duplicateUser = findAuthUserByEmail(db, input.email);
      if (duplicateUser && duplicateUser.id !== id) {
        res.status(409).json({ error: 'A user with that email already exists.' });
        return;
      }

      if (user.role === 'admin' && input.role !== 'admin' && countAdminUsers(db) <= 1) {
        res.status(400).json({ error: 'At least one admin user is required.' });
        return;
      }

      const updatedUser = updateAuthUser(db, id, input);
      res.json({ user: updatedUser ?? toPublicAuthUser(user) });
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
      const updatedUser = findAuthUserById(db, id);

      res.json({ user: updatedUser ? toPublicAuthUser(updatedUser) : toPublicAuthUser(user), temporaryPassword });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const sessionUserId = Number(res.locals.authUser?.id);
      const user = findAuthUserById(db, id);

      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      if (sessionUserId === id) {
        res.status(400).json({ error: 'You cannot delete your own account.' });
        return;
      }

      if (user.role === 'admin' && countAdminUsers(db) <= 1) {
        res.status(400).json({ error: 'At least one admin user is required.' });
        return;
      }

      deleteAuthUser(db, id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

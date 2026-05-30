import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAdminUser } from '../../src/server/auth/bootstrap.js';
import { verifyPassword } from '../../src/server/auth/passwords.js';
import {
  createAuthUser,
  findAuthUserByEmail,
  listAuthUsers,
  updateAuthUserPassword
} from '../../src/server/auth/users.repository.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

describe('auth users repository and bootstrap', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates and reads auth users with normalized emails', () => {
    const user = createAuthUser(db, {
      email: 'Admin@Example.COM',
      role: 'admin',
      passwordHash: 'hash-1',
      mustChangePassword: true
    });

    expect(user).toMatchObject({
      id: expect.any(Number),
      email: 'admin@example.com',
      role: 'admin',
      mustChangePassword: true,
      lastLoginAt: null
    });
    expect(findAuthUserByEmail(db, ' ADMIN@example.com ')).toMatchObject({
      email: 'admin@example.com',
      passwordHash: 'hash-1'
    });
  });

  it('lists users without password hashes', () => {
    createAuthUser(db, {
      email: 'admin@example.com',
      role: 'admin',
      passwordHash: 'hash-1',
      mustChangePassword: false
    });

    expect(listAuthUsers(db)).toEqual([
      {
        id: 1,
        email: 'admin@example.com',
        role: 'admin',
        mustChangePassword: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        lastLoginAt: null
      }
    ]);
  });

  it('updates password hash and marks password change required', () => {
    const user = createAuthUser(db, {
      email: 'super@example.com',
      role: 'superadmin',
      passwordHash: 'old-hash',
      mustChangePassword: false
    });

    updateAuthUserPassword(db, user.id, 'new-hash', true);

    expect(findAuthUserByEmail(db, 'super@example.com')).toMatchObject({
      passwordHash: 'new-hash',
      mustChangePassword: true
    });
  });

  it('bootstraps the first admin and prints the generated password once', () => {
    const logger = vi.fn();

    const result = bootstrapAdminUser(db, {
      adminEmail: 'Owner@Example.COM',
      logger
    });

    if (!result.created) {
      throw new Error('Expected bootstrap to create an admin user.');
    }

    expect(result.email).toBe('owner@example.com');
    expect(result.temporaryPassword).toHaveLength(24);
    const storedUser = findAuthUserByEmail(db, 'owner@example.com');
    expect(storedUser).toMatchObject({
      role: 'admin',
      mustChangePassword: true
    });
    expect(storedUser?.passwordHash).not.toBe(result.temporaryPassword);
    expect(storedUser?.passwordHash).not.toContain(result.temporaryPassword);
    expect(verifyPassword(result.temporaryPassword, storedUser?.passwordHash ?? '')).toBe(true);

    const messages = logger.mock.calls.map(([message]) => message);
    expect(logger).toHaveBeenCalledTimes(3);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('owner@example.com'));
    expect(logger).toHaveBeenCalledWith(expect.stringContaining(result.temporaryPassword));
    expect(messages.filter((message) => message.includes(result.temporaryPassword))).toHaveLength(1);
  });

  it('does not bootstrap when an admin already exists', () => {
    createAuthUser(db, {
      email: 'admin@example.com',
      role: 'admin',
      passwordHash: 'hash-1',
      mustChangePassword: false
    });

    const result = bootstrapAdminUser(db, {
      adminEmail: 'owner@example.com',
      logger: vi.fn()
    });

    expect(result).toEqual({ created: false });
    expect(listAuthUsers(db)).toHaveLength(1);
  });

  it('fails clearly when bootstrap needs ADMIN_EMAIL', () => {
    expect(() => bootstrapAdminUser(db, { logger: vi.fn() })).toThrow(
      /ADMIN_EMAIL is required to bootstrap the first admin user/
    );
  });
});

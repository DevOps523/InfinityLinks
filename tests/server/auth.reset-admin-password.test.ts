import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/server/auth/passwords.js';
import { resetAdminPassword } from '../../src/server/auth/reset-admin-password.js';
import type { AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

let db: AppDatabase;

function seedUser(email: string, role: 'admin' | 'superadmin') {
  db.prepare('INSERT INTO auth_users (email, role, password_hash, must_change_password) VALUES (?, ?, ?, 0)').run(
    email,
    role,
    hashPassword('OldPassword123456')
  );
}

describe('admin password reset command helper', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('resets the requested admin password and forces a password change', () => {
    seedUser('admin@example.com', 'admin');

    const result = resetAdminPassword(db, { email: ' ADMIN@example.com ' });

    expect(result).toEqual({
      email: 'admin@example.com',
      temporaryPassword: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/)
    });

    const row = db.prepare('SELECT password_hash, must_change_password FROM auth_users WHERE email = ?').get('admin@example.com') as {
      password_hash: string;
      must_change_password: 0 | 1;
    };

    expect(row.password_hash).not.toContain(result.temporaryPassword);
    expect(verifyPassword(result.temporaryPassword, row.password_hash)).toBe(true);
    expect(verifyPassword('OldPassword123456', row.password_hash)).toBe(false);
    expect(row.must_change_password).toBe(1);
  });

  it('defaults to the first admin user when no email is provided', () => {
    seedUser('first@example.com', 'admin');
    seedUser('second@example.com', 'admin');

    const result = resetAdminPassword(db, {});

    expect(result.email).toBe('first@example.com');
    const firstRow = db.prepare('SELECT password_hash FROM auth_users WHERE email = ?').get('first@example.com') as {
      password_hash: string;
    };
    const secondRow = db.prepare('SELECT password_hash FROM auth_users WHERE email = ?').get('second@example.com') as {
      password_hash: string;
    };

    expect(verifyPassword(result.temporaryPassword, firstRow.password_hash)).toBe(true);
    expect(verifyPassword(result.temporaryPassword, secondRow.password_hash)).toBe(false);
  });

  it('refuses missing users, non-admin users, and databases without admins', () => {
    expect(() => resetAdminPassword(db, { email: 'missing@example.com' })).toThrow(/Admin user not found/);

    seedUser('super@example.com', 'superadmin');
    expect(() => resetAdminPassword(db, { email: 'super@example.com' })).toThrow(/Only admin users/);

    expect(() => resetAdminPassword(db, {})).toThrow(/No admin users found/);
  });
});

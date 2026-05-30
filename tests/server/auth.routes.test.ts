// @vitest-environment node

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/server/auth/passwords.js';
import { createApp } from '../../src/server/app.js';
import type { AppConfig } from '../../src/server/config.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

const config: AppConfig = {
  tmdbApiKey: 'tmdb-token',
  telegramBotToken: 'telegram-token',
  telegramChannelId: '-1001',
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:',
  authSecret: 'test-auth-secret-test-auth-secret-123',
  adminEmail: 'admin@example.com',
  publicSearchGroupHandle: '@infinitylinks69'
};

async function signIn(agent: request.Agent, email: string, password = 'Password123456') {
  const csrf = await agent.get('/auth/csrf').expect(200);

  await agent
    .post('/auth/callback/credentials')
    .type('form')
    .send({
      csrfToken: csrf.body.csrfToken,
      email,
      password,
      redirect: 'false',
      json: 'true'
    })
    .expect((response) => {
      expect([200, 302]).toContain(response.status);
    });
}

function seedUser(db: AppDatabase, email: string, role: 'admin' | 'superadmin', options: { mustChangePassword?: boolean } = {}) {
  db.prepare(
    `INSERT INTO auth_users (email, role, password_hash, must_change_password)
     VALUES (?, ?, ?, ?)`
  ).run(email, role, hashPassword('Password123456'), options.mustChangePassword ? 1 : 0);
}

describe('auth and admin user routes', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns current user session without password hash', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent.get('/api/auth/me').expect(200);

    expect(response.body.user).toEqual({
      id: '1',
      email: 'admin@example.com',
      role: 'admin',
      mustChangePassword: false
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('returns null current user when signed out', async () => {
    const app = createApp({ db, config });

    const response = await request(app).get('/api/auth/me').expect(200);

    expect(response.body).toEqual({ user: null });
  });

  it('allows admins to create users and returns the temporary password once', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent
      .post('/api/admin/users')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({ email: 'Team@Example.COM', role: 'superadmin' })
      .expect(201);

    expect(response.body).toEqual({
      user: {
        id: 2,
        email: 'team@example.com',
        role: 'superadmin',
        mustChangePassword: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        lastLoginAt: null
      },
      temporaryPassword: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/)
    });

    const row = db.prepare('SELECT password_hash, must_change_password FROM auth_users WHERE email = ?').get('team@example.com') as {
      password_hash: string;
      must_change_password: 0 | 1;
    };
    expect(row.password_hash).not.toContain(response.body.temporaryPassword);
    expect(verifyPassword(response.body.temporaryPassword, row.password_hash)).toBe(true);
    expect(row.must_change_password).toBe(1);
  });

  it('rejects duplicate user emails', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent
      .post('/api/admin/users')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({ email: 'ADMIN@example.com', role: 'admin' })
      .expect(409);

    expect(response.body).toEqual({ error: 'A user with that email already exists.' });
  });

  it('prevents superadmins from managing users', async () => {
    seedUser(db, 'super@example.com', 'superadmin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'super@example.com');

    const response = await agent.get('/api/admin/users').expect(403);

    expect(response.body).toEqual({ error: 'You do not have permission to manage users.' });
  });

  it('lets admins reset a superadmin password', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    seedUser(db, 'super@example.com', 'superadmin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent
      .post('/api/admin/users/2/reset-password')
      .set('X-InfinityLinks-Request', 'fetch')
      .expect(200);

    expect(response.body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const row = db.prepare('SELECT password_hash, must_change_password FROM auth_users WHERE id = 2').get() as {
      password_hash: string;
      must_change_password: 0 | 1;
    };
    expect(verifyPassword(response.body.temporaryPassword, row.password_hash)).toBe(true);
    expect(row.must_change_password).toBe(1);
  });

  it('changes own password and clears forced password change', async () => {
    seedUser(db, 'super@example.com', 'superadmin', { mustChangePassword: true });
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'super@example.com');

    await agent
      .post('/api/auth/change-password')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({
        currentPassword: 'Password123456',
        newPassword: 'NewPassword123456'
      })
      .expect(200);

    const row = db.prepare('SELECT password_hash, must_change_password FROM auth_users WHERE email = ?').get('super@example.com') as {
      password_hash: string;
      must_change_password: 0 | 1;
    };
    expect(verifyPassword('NewPassword123456', row.password_hash)).toBe(true);
    expect(row.must_change_password).toBe(0);
  });
});

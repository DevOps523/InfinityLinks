// @vitest-environment node

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function attemptSignIn(agent: request.Agent, email: string, password: string, ip = '203.0.113.10') {
  const csrf = await agent.get('/auth/csrf').expect(200);

  return agent
    .post('/auth/callback/credentials')
    .set('X-Forwarded-For', ip)
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

async function signIn(agent: request.Agent, email: string, password = 'Password123456', ip = '203.0.113.10') {
  await attemptSignIn(agent, email, password, ip);
}

async function withMutedExpectedCredentialErrors(callback: () => Promise<void>) {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    await callback();
  } finally {
    consoleError.mockRestore();
  }
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

  it('blocks credential login only for the email and IP pair that exceeded failed attempts', async () => {
    await withMutedExpectedCredentialErrors(async () => {
      seedUser(db, 'admin@example.com', 'admin');
      seedUser(db, 'other@example.com', 'admin');
      const app = createApp({ db, config });
      const blockedAgent = request.agent(app);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        await attemptSignIn(blockedAgent, ' Admin@Example.COM ', 'WrongPassword123456', '203.0.113.10');
      }

      const blockedCorrectAgent = request.agent(app);
      await attemptSignIn(blockedCorrectAgent, 'admin@example.com', 'Password123456', '203.0.113.10');
      const blockedSession = await blockedCorrectAgent.get('/api/auth/me').expect(200);
      expect(blockedSession.body).toEqual({ user: null });

      const otherEmailAgent = request.agent(app);
      await signIn(otherEmailAgent, 'other@example.com', 'Password123456', '203.0.113.10');
      const otherEmailSession = await otherEmailAgent.get('/api/auth/me').expect(200);
      expect(otherEmailSession.body.user).toMatchObject({ email: 'other@example.com' });

      const otherIpAgent = request.agent(app);
      await signIn(otherIpAgent, 'admin@example.com', 'Password123456', '198.51.100.25');
      const otherIpSession = await otherIpAgent.get('/api/auth/me').expect(200);
      expect(otherIpSession.body.user).toMatchObject({ email: 'admin@example.com' });
    });
  });

  it('clears accumulated credential failures after a successful login for the same email and IP', async () => {
    await withMutedExpectedCredentialErrors(async () => {
      seedUser(db, 'admin@example.com', 'admin');
      const app = createApp({ db, config });
      const agent = request.agent(app);

      for (let attempt = 0; attempt < 9; attempt += 1) {
        await attemptSignIn(agent, 'admin@example.com', 'WrongPassword123456', '203.0.113.10');
      }

      await signIn(agent, 'admin@example.com', 'Password123456', '203.0.113.10');
      await attemptSignIn(agent, 'admin@example.com', 'WrongPassword123456', '203.0.113.10');

      const freshAgent = request.agent(app);
      await signIn(freshAgent, 'admin@example.com', 'Password123456', '203.0.113.10');
      const response = await freshAgent.get('/api/auth/me').expect(200);
      expect(response.body.user).toMatchObject({ email: 'admin@example.com' });
    });
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

  it('lets admins edit a user email and role without changing the password', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    seedUser(db, 'super@example.com', 'superadmin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const previousRow = db.prepare('SELECT password_hash FROM auth_users WHERE email = ?').get('super@example.com') as {
      password_hash: string;
    };

    const response = await agent
      .patch('/api/admin/users/2')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({ email: 'Renamed@Example.COM', role: 'admin' })
      .expect(200);

    expect(response.body).toEqual({
      user: {
        id: 2,
        email: 'renamed@example.com',
        role: 'admin',
        mustChangePassword: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        lastLoginAt: null
      }
    });

    expect(db.prepare('SELECT id FROM auth_users WHERE email = ?').get('super@example.com')).toBeUndefined();
    const updatedRow = db.prepare('SELECT password_hash FROM auth_users WHERE email = ?').get('renamed@example.com') as {
      password_hash: string;
    };
    expect(updatedRow.password_hash).toBe(previousRow.password_hash);

    const renamedAgent = request.agent(app);
    await signIn(renamedAgent, 'renamed@example.com');
    const me = await renamedAgent.get('/api/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ id: '2', email: 'renamed@example.com', role: 'admin' });
  });

  it('rejects editing a user to a duplicate email', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    seedUser(db, 'super@example.com', 'superadmin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent
      .patch('/api/admin/users/2')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({ email: 'ADMIN@example.com', role: 'superadmin' })
      .expect(409);

    expect(response.body).toEqual({ error: 'A user with that email already exists.' });
  });

  it('prevents removing the last admin role when editing users', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent
      .patch('/api/admin/users/1')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({ email: 'admin@example.com', role: 'superadmin' })
      .expect(400);

    expect(response.body).toEqual({ error: 'At least one admin user is required.' });
  });

  it('prevents superadmins from managing users', async () => {
    seedUser(db, 'super@example.com', 'superadmin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'super@example.com');

    const response = await agent.get('/api/admin/users').expect(403);

    expect(response.body).toEqual({ error: 'You do not have permission to manage users.' });
  });

  it('prevents stale admin sessions from managing users after role changes', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');
    db.prepare("UPDATE auth_users SET role = 'superadmin' WHERE email = ?").run('admin@example.com');

    const response = await agent.get('/api/admin/users').expect(403);

    expect(response.body).toEqual({ error: 'You do not have permission to manage users.' });
  });

  it('prevents deleted admin sessions from managing users', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');
    db.prepare('DELETE FROM auth_users WHERE email = ?').run('admin@example.com');

    const response = await agent.get('/api/admin/users').expect(401);

    expect(response.body).toEqual({ error: 'Authentication required.' });
  });

  it('requires must-change users to change their password before accessing protected admin APIs', async () => {
    seedUser(db, 'admin@example.com', 'admin', { mustChangePassword: true });
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user).toEqual({
      id: '1',
      email: 'admin@example.com',
      role: 'admin',
      mustChangePassword: true
    });

    const expectedResponse = {
      error: 'Password change required.',
      code: 'PASSWORD_CHANGE_REQUIRED'
    };

    const dashboardBlocked = await agent.get('/api/admin/dashboard').expect(403);
    expect(dashboardBlocked.body).toEqual(expectedResponse);

    const usersBlocked = await agent.get('/api/admin/users').expect(403);
    expect(usersBlocked.body).toEqual(expectedResponse);

    await agent
      .post('/api/auth/change-password')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({
        currentPassword: 'Password123456',
        newPassword: 'NewPassword123456'
      })
      .expect(200);

    await agent.get('/api/admin/dashboard').expect(200);
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

    expect(response.body).toEqual({
      user: {
        id: 2,
        email: 'super@example.com',
        role: 'superadmin',
        mustChangePassword: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        lastLoginAt: null
      },
      temporaryPassword: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/)
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');

    const row = db.prepare('SELECT password_hash, must_change_password FROM auth_users WHERE id = 2').get() as {
      password_hash: string;
      must_change_password: 0 | 1;
    };
    expect(verifyPassword(response.body.temporaryPassword, row.password_hash)).toBe(true);
    expect(row.must_change_password).toBe(1);
  });

  it('lets admins delete a user and blocks that stale session from API access', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    seedUser(db, 'super@example.com', 'superadmin');
    const app = createApp({ db, config });
    const adminAgent = request.agent(app);
    const deletedAgent = request.agent(app);

    await signIn(adminAgent, 'admin@example.com');
    await signIn(deletedAgent, 'super@example.com');

    await adminAgent.delete('/api/admin/users/2').set('X-InfinityLinks-Request', 'fetch').expect(204);

    expect(db.prepare('SELECT id FROM auth_users WHERE email = ?').get('super@example.com')).toBeUndefined();
    await deletedAgent.get('/api/admin/dashboard').expect(401);
  });

  it('prevents admins from deleting their own account', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    seedUser(db, 'other@example.com', 'admin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent.delete('/api/admin/users/1').set('X-InfinityLinks-Request', 'fetch').expect(400);

    expect(response.body).toEqual({ error: 'You cannot delete your own account.' });
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

  it('rejects changing password with the wrong current password', async () => {
    seedUser(db, 'super@example.com', 'superadmin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'super@example.com');

    const response = await agent
      .post('/api/auth/change-password')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({
        currentPassword: 'WrongPassword123456',
        newPassword: 'NewPassword123456'
      })
      .expect(400);

    expect(response.body).toEqual({ error: 'Current password is incorrect.' });
  });

  it('rejects weak replacement passwords', async () => {
    seedUser(db, 'super@example.com', 'superadmin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'super@example.com');

    const response = await agent
      .post('/api/auth/change-password')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({
        currentPassword: 'Password123456',
        newPassword: 'short1'
      })
      .expect(400);

    expect(response.body).toEqual({ error: 'Password must be at least 12 characters.' });
  });
});

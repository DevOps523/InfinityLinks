// @vitest-environment node

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../../../../../../../src/server/auth/passwords.js';
import { createApp } from '../../../../../../../src/server/app.js';
import type { AppConfig } from '../../../../../../../src/server/config.js';
import { createDatabase } from '../../../../../../../src/server/db/database.js';
import { migrate } from '../../../../../../../src/server/db/migrate.js';

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

describe('AUTH-MUSTCHANGE-001 validation', () => {
  it('allows a must-change-password admin session to call privileged API routes', async () => {
    const db = createDatabase(':memory:');
    migrate(db);
    db.prepare(
      `INSERT INTO auth_users (email, role, password_hash, must_change_password)
       VALUES (?, 'admin', ?, 1)`
    ).run('admin@example.com', hashPassword('Password123456'));

    try {
      const app = createApp({ db, config });
      const agent = request.agent(app);

      await signIn(agent, 'admin@example.com');

      const response = await agent.get('/api/admin/users').expect(200);
      expect(response.body.users).toEqual([
        expect.objectContaining({
          email: 'admin@example.com',
          role: 'admin',
          mustChangePassword: true
        })
      ]);
    } finally {
      db.close();
    }
  });

  it('allows an already-signed-in admin to continue privileged API access after reset sets must_change_password', async () => {
    const db = createDatabase(':memory:');
    migrate(db);
    db.prepare(
      `INSERT INTO auth_users (email, role, password_hash, must_change_password)
       VALUES (?, 'admin', ?, 0)`
    ).run('admin@example.com', hashPassword('Password123456'));

    try {
      const app = createApp({ db, config });
      const agent = request.agent(app);

      await signIn(agent, 'admin@example.com');
      db.prepare('UPDATE auth_users SET password_hash = ?, must_change_password = 1 WHERE email = ?')
        .run(hashPassword('TemporaryPassword123456'), 'admin@example.com');

      const response = await agent.get('/api/admin/users').expect(200);
      expect(response.body.users[0]).toMatchObject({
        email: 'admin@example.com',
        role: 'admin',
        mustChangePassword: true
      });
    } finally {
      db.close();
    }
  });
});

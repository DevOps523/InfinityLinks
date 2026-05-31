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

describe('AUTH-LOGIN-RATE-001 validation', () => {
  it('does not throttle repeated wrong-password credential callbacks', async () => {
    const db = createDatabase(':memory:');
    migrate(db);
    db.prepare(
      `INSERT INTO auth_users (email, role, password_hash, must_change_password)
       VALUES (?, 'admin', ?, 0)`
    ).run('admin@example.com', hashPassword('Password123456'));

    try {
      const app = createApp({ db, config });
      const agent = request.agent(app);
      const statuses: number[] = [];

      for (let index = 0; index < 15; index += 1) {
        const csrf = await agent.get('/auth/csrf').expect(200);
        const response = await agent
          .post('/auth/callback/credentials')
          .type('form')
          .send({
            csrfToken: csrf.body.csrfToken,
            email: 'admin@example.com',
            password: `WrongPassword${index}`,
            redirect: 'false',
            json: 'true'
          });
        statuses.push(response.status);
      }

      expect(statuses).not.toContain(429);
    } finally {
      db.close();
    }
  });
});

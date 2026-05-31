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

describe('TEL-JOB-AUTHZ-001 validation', () => {
  it('allows a non-admin authenticated role to list and retry failed Telegram jobs', async () => {
    const db = createDatabase(':memory:');
    migrate(db);
    db.prepare(
      `INSERT INTO auth_users (email, role, password_hash, must_change_password)
       VALUES (?, 'superadmin', ?, 0)`
    ).run('super@example.com', hashPassword('Password123456'));
    const insert = db
      .prepare(
        `INSERT INTO telegram_jobs (
           job_type, entity_type, entity_id, payload, status, attempts, next_run_at, last_error
         )
         VALUES ('delete', 'season', 7, '{"messageId":123}', 'failed', 4, '2099-01-01 00:00:00', 'Telegram failed')`
      )
      .run();

    try {
      const app = createApp({ db, config });
      const agent = request.agent(app);

      await signIn(agent, 'super@example.com');

      const list = await agent.get('/api/telegram/jobs/failed').expect(200);
      expect(list.body.jobs).toHaveLength(1);

      await agent
        .post(`/api/telegram/jobs/${insert.lastInsertRowid}/retry`)
        .set('X-InfinityLinks-Request', 'fetch')
        .expect(200, { ok: true });

      const job = db.prepare('SELECT status, last_error FROM telegram_jobs WHERE id = ?').get(
        insert.lastInsertRowid
      ) as { status: string; last_error: string | null };

      expect(job).toEqual({ status: 'queued', last_error: null });
    } finally {
      db.close();
    }
  });
});

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import type { AppConfig } from '../../src/server/config.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:',
  tmdbApiKey: 'tmdb-token',
  telegramBotToken: 'telegram-token',
  telegramChannelId: '-1001',
  publicSearchSyncUrl: 'https://public.example/api/sync',
  publicSearchSyncToken: 'sync-token',
  publicSearchStatusUrl: undefined,
  publicSearchStatusToken: undefined,
  publicSearchGroupHandle: '@infinitylinks69'
};

describe('telegram admin jobs', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('lists up to 50 failed Telegram jobs in newest order', async () => {
    for (let index = 1; index <= 52; index += 1) {
      db.prepare(
        `INSERT INTO telegram_jobs (
           job_type, entity_type, entity_id, payload, status, attempts, last_error, updated_at
         )
         VALUES ('send', 'movie', ?, '{}', 'failed', ?, ?, ?)`
      ).run(index, index % 3, `Failure ${index}`, `2026-05-26 10:${String(index).padStart(2, '0')}:00`);
    }

    db.prepare(
      `INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status, last_error, updated_at)
       VALUES ('edit', 'movie', 999, '{}', 'queued', 'Not failed', '2026-05-26 11:59:00')`
    ).run();

    const app = createApp({ db, config });
    const response = await request(app).get('/api/telegram/jobs/failed').expect(200);

    expect(response.body.jobs).toHaveLength(50);
    expect(response.body.jobs[0]).toEqual({
      id: 52,
      jobType: 'send',
      entityType: 'movie',
      entityId: 52,
      attempts: 1,
      lastError: 'Failure 52',
      updatedAt: '2026-05-26 10:52:00'
    });
    expect(response.body.jobs.at(-1).id).toBe(3);
    expect(response.body.jobs.map((job: { entityId: number }) => job.entityId)).not.toContain(999);
  });

  it('requeues a failed Telegram job without resetting attempts', async () => {
    const insert = db
      .prepare(
        `INSERT INTO telegram_jobs (
           job_type, entity_type, entity_id, payload, status, attempts, next_run_at, last_error
         )
         VALUES ('delete', 'season', 7, '{"messageId":123}', 'failed', 4, '2099-01-01 00:00:00', 'Telegram failed')`
      )
      .run();

    const app = createApp({ db, config });

    await request(app).post(`/api/telegram/jobs/${insert.lastInsertRowid}/retry`).expect(200, { ok: true });

    const job = db.prepare('SELECT status, attempts, last_error, next_run_at FROM telegram_jobs WHERE id = ?').get(
      insert.lastInsertRowid
    ) as { status: string; attempts: number; last_error: string | null; next_run_at: string };

    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(4);
    expect(job.last_error).toBeNull();
    expect(new Date(`${job.next_run_at.replace(' ', 'T')}Z`).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('returns 404 when retrying a job that is not currently failed', async () => {
    const insert = db
      .prepare(
        `INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status)
         VALUES ('send', 'movie', 1, '{}', 'queued')`
      )
      .run();

    const app = createApp({ db, config });

    await request(app).post(`/api/telegram/jobs/${insert.lastInsertRowid}/retry`).expect(404);
  });
});

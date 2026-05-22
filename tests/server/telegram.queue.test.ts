import { describe, expect, it, vi } from 'vitest';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';
import { createTelegramClient, TelegramRateLimitError } from '../../src/server/telegram/telegram.client.js';
import { enqueueTelegramJob, processNextTelegramJob } from '../../src/server/telegram/telegram.queue.js';

function setupDb() {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

function getJob(db: AppDatabase) {
  return db.prepare('SELECT * FROM telegram_jobs').get() as {
    id: number;
    status: string;
    attempts: number;
    next_run_at: string;
    last_error: string | null;
  };
}

function parseSqliteTimestamp(value: string) {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime();
}

describe('telegram queue', () => {
  it('processes one queued send job successfully and marks it succeeded', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => ({ messageId: 123 })),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn()
    };

    enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/poster.jpg',
      caption: 'Inception (2010)'
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.sendPhotoPost).toHaveBeenCalledWith({
      posterUrl: 'https://example.com/poster.jpg',
      caption: 'Inception (2010)'
    });
    expect(client.editPhotoCaption).not.toHaveBeenCalled();
    expect(client.deleteMessage).not.toHaveBeenCalled();
    expect(getJob(db)).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      last_error: null
    });

    db.close();
  });

  it('delays rate-limited jobs for retry and stores the error', async () => {
    const db = setupDb();
    const before = Date.now();
    const client = {
      sendPhotoPost: vi.fn(async () => {
        throw new TelegramRateLimitError('Too Many Requests: retry later', 60);
      }),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn()
    };

    enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/poster.jpg',
      caption: 'Inception (2010)'
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(false);

    const job = getJob(db);
    expect(job.status).toBe('waiting_retry');
    expect(job.attempts).toBe(1);
    expect(job.last_error).toContain('Too Many Requests');
    expect(parseSqliteTimestamp(job.next_run_at)).toBeGreaterThanOrEqual(before + 60_000 - 1_000);

    db.close();
  });

  it('delays any error with a positive retryAfter for retry', async () => {
    const db = setupDb();
    const before = Date.now();
    const retryError = new Error('Generic throttled');
    Object.assign(retryError, { retryAfter: 7 });
    const client = {
      sendPhotoPost: vi.fn(async () => {
        throw retryError;
      }),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn()
    };

    enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/poster.jpg',
      caption: 'Inception (2010)'
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(false);

    const job = getJob(db);
    expect(job.status).toBe('waiting_retry');
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBe('Generic throttled');
    expect(parseSqliteTimestamp(job.next_run_at)).toBeGreaterThanOrEqual(before + 7_000 - 1_000);

    db.close();
  });

  it('recovers a stale running job before selecting the next job', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => ({ messageId: 123 })),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn()
    };

    const staleJob = enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/stale.jpg',
      caption: 'Stale job'
    });
    db.prepare(
      `UPDATE telegram_jobs
       SET status = 'running',
           attempts = 1,
           updated_at = datetime('now', '-6 minutes')
       WHERE id = ?`
    ).run(staleJob.lastInsertRowid);

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.sendPhotoPost).toHaveBeenCalledWith({
      posterUrl: 'https://example.com/stale.jpg',
      caption: 'Stale job'
    });
    expect(getJob(db)).toMatchObject({
      status: 'succeeded',
      attempts: 2,
      last_error: null
    });

    db.close();
  });

  it('dispatches edit and delete jobs to the matching client methods', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => ({ messageId: 123 })),
      editPhotoCaption: vi.fn(async () => undefined),
      deleteMessage: vi.fn(async () => undefined)
    };

    enqueueTelegramJob(db, 'edit', 'movie', 7, {
      messageId: 123,
      caption: 'Updated caption'
    });
    enqueueTelegramJob(db, 'delete', 'season', 8, {
      messageId: 456
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);
    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.editPhotoCaption).toHaveBeenCalledWith({
      messageId: 123,
      caption: 'Updated caption'
    });
    expect(client.deleteMessage).toHaveBeenCalledWith({
      messageId: 456
    });
    expect(client.sendPhotoPost).not.toHaveBeenCalled();

    db.close();
  });

  it('marks non-rate-limit failures as failed', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => {
        throw new Error('Telegram is unavailable');
      }),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn()
    };

    enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/poster.jpg',
      caption: 'Inception (2010)'
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(false);

    expect(getJob(db)).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error: 'Telegram is unavailable'
    });

    db.close();
  });

  it('processes the oldest eligible job before a newer job with an earlier next_run_at', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => ({ messageId: 123 })),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn()
    };

    const olderJob = enqueueTelegramJob(db, 'send', 'movie', 1, {
      posterUrl: 'https://example.com/older.jpg',
      caption: 'Older job'
    });
    const newerJob = enqueueTelegramJob(db, 'send', 'movie', 2, {
      posterUrl: 'https://example.com/newer.jpg',
      caption: 'Newer job'
    });

    db.prepare(
      `UPDATE telegram_jobs
       SET created_at = '2026-05-22 00:00:00',
           next_run_at = datetime('now', '-1 minute')
       WHERE id = ?`
    ).run(olderJob.lastInsertRowid);
    db.prepare(
      `UPDATE telegram_jobs
       SET created_at = '2026-05-22 00:01:00',
           next_run_at = datetime('now', '-2 minutes')
       WHERE id = ?`
    ).run(newerJob.lastInsertRowid);

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.sendPhotoPost).toHaveBeenCalledWith({
      posterUrl: 'https://example.com/older.jpg',
      caption: 'Older job'
    });

    db.close();
  });
});

describe('telegram client', () => {
  it('rejects invalid JSON responses with a meaningful error', async () => {
    const client = createTelegramClient(
      {
        botToken: 'test-token',
        channelId: '@channel'
      },
      vi.fn(async () => new Response('not json', { status: 200 }))
    );

    await expect(
      client.sendPhotoPost({
        posterUrl: 'https://example.com/poster.jpg',
        caption: 'Inception (2010)'
      })
    ).rejects.toThrow('Telegram sendPhoto returned invalid JSON');
  });

  it('requires successful Telegram responses to explicitly include ok true', async () => {
    const client = createTelegramClient(
      {
        botToken: 'test-token',
        channelId: '@channel'
      },
      vi.fn(async () => Response.json({ result: { message_id: 123 } }))
    );

    await expect(
      client.sendPhotoPost({
        posterUrl: 'https://example.com/poster.jpg',
        caption: 'Inception (2010)'
      })
    ).rejects.toThrow('Telegram sendPhoto failed');
  });
});

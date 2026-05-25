import { describe, expect, it, vi } from 'vitest';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';
import { getTopicRoute } from '../../src/server/media/topics.js';
import { createTelegramClient, TelegramRateLimitError } from '../../src/server/telegram/telegram.client.js';
import { enqueueTelegramJob, processNextTelegramJob, upsertActiveTelegramSendJob } from '../../src/server/telegram/telegram.queue.js';

function setupDb() {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

function getJob(db: AppDatabase) {
  return db.prepare('SELECT * FROM telegram_jobs').get() as {
    id: number;
    payload: string;
    status: string;
    attempts: number;
    next_run_at: string;
    last_error: string | null;
  };
}

function getJobs(db: AppDatabase) {
  return db.prepare('SELECT * FROM telegram_jobs ORDER BY id ASC').all() as Array<{
    id: number;
    job_type: string;
    entity_type: string;
    entity_id: number;
    payload: string;
    status: string;
    next_run_at: string;
    last_error: string | null;
  }>;
}

function getMoviePostState(db: AppDatabase, id: number) {
  return db.prepare('SELECT telegram_message_id, post_status FROM movies WHERE id = ?').get(id) as {
    telegram_message_id: number | null;
    post_status: string;
  };
}

function getSeasonPostState(db: AppDatabase, id: number) {
  return db.prepare('SELECT telegram_message_id, post_status FROM seasons WHERE id = ?').get(id) as {
    telegram_message_id: number | null;
    post_status: string;
  };
}

function createMovieRow(db: AppDatabase, id: number, title = `Movie ${id}`) {
  db.prepare('INSERT OR IGNORE INTO movies (id, title, poster_url, quality, description) VALUES (?, ?, ?, ?, ?)').run(
    id,
    title,
    `https://example.com/${id}.jpg`,
    'HD',
    'Queued movie'
  );
  db.prepare(
    'INSERT OR IGNORE INTO movie_links (movie_id, provider_name, quality, status, url) VALUES (?, ?, ?, ?, ?)'
  ).run(id, 'Provider', 'HD', 'active', `https://example.com/watch/${id}`);
}

function createSeasonRow(db: AppDatabase, id: number) {
  db.prepare('INSERT OR IGNORE INTO tv_shows (id, title, poster_url, quality, description) VALUES (?, ?, ?, ?, ?)').run(
    id,
    `Show ${id}`,
    `https://example.com/show-${id}.jpg`,
    'HD',
    'Queued show'
  );
  db.prepare('INSERT OR IGNORE INTO seasons (id, tv_show_id, season_number) VALUES (?, ?, ?)').run(id, id, 1);
  db.prepare('INSERT OR IGNORE INTO episodes (id, season_id, episode_number) VALUES (?, ?, ?)').run(id, id, 1);
  db.prepare(
    'INSERT OR IGNORE INTO episode_links (episode_id, provider_name, quality, status, url) VALUES (?, ?, ?, ?, ?)'
  ).run(id, 'Provider', 'HD', 'active', `https://example.com/watch/show-${id}`);
}

function parseSqliteTimestamp(value: string) {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime();
}

describe('telegram queue', () => {
  it('processes one queued send job successfully and marks it succeeded', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => ({ messageId: 777 })),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn()
    };

    createMovieRow(db, 7, 'Inception');
    enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/poster.jpg',
      caption: 'Inception (2010)',
      messageThreadId: 20
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.sendPhotoPost).toHaveBeenCalledWith({
      posterUrl: 'https://example.com/poster.jpg',
      caption: 'Inception (2010)',
      messageThreadId: 20
    });
    expect(client.editPhotoCaption).not.toHaveBeenCalled();
    expect(client.deleteMessage).not.toHaveBeenCalled();
    expect(getJob(db)).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      last_error: null
    });
    expect(getMoviePostState(db, 7)).toEqual({
      telegram_message_id: 777,
      post_status: 'posted'
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

    createMovieRow(db, 7, 'Inception');
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
    expect(getMoviePostState(db, 7)).toEqual({
      telegram_message_id: null,
      post_status: 'pending'
    });

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

    createMovieRow(db, 7, 'Inception');
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

    createMovieRow(db, 7, 'Stale job');
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

    createMovieRow(db, 7, 'Editable movie');
    createSeasonRow(db, 8);
    db.prepare("UPDATE seasons SET telegram_message_id = 456, post_status = 'posted' WHERE id = ?").run(8);
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
    expect(getMoviePostState(db, 7)).toEqual({
      telegram_message_id: null,
      post_status: 'posted'
    });
    expect(getSeasonPostState(db, 8)).toEqual({
      telegram_message_id: null,
      post_status: 'deleted'
    });

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

    createMovieRow(db, 7, 'Inception');
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
    expect(getMoviePostState(db, 7)).toEqual({
      telegram_message_id: null,
      post_status: 'failed'
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

    createMovieRow(db, 1, 'Older job');
    createMovieRow(db, 2, 'Newer job');
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

  it('does not process a repost send while retained delete is waiting retry', async () => {
    const db = setupDb();
    createSeasonRow(db, 8);
    db.prepare("UPDATE seasons SET telegram_message_id = 456, post_status = 'posted' WHERE id = ?").run(8);

    enqueueTelegramJob(db, 'delete', 'season', 8, {
      messageId: 456,
      retainEntityState: true
    });
    enqueueTelegramJob(db, 'send', 'season', 8, {
      posterUrl: 'https://example.com/season.jpg',
      caption: 'Updated season'
    });

    const client = {
      sendPhotoPost: vi.fn(async () => ({ messageId: 999 })),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn(async () => {
        const error = new Error('Rate limited') as Error & { retryAfter: number };
        error.retryAfter = 60;
        throw error;
      })
    };

    await expect(processNextTelegramJob(db, client)).resolves.toBe(false);
    await expect(processNextTelegramJob(db, client)).resolves.toBe(false);

    expect(client.deleteMessage).toHaveBeenCalledTimes(1);
    expect(client.sendPhotoPost).not.toHaveBeenCalled();
    expect(getJobs(db).find((job) => job.job_type === 'send')).toMatchObject({ status: 'queued' });

    db.close();
  });

  it('clears old season message id after retained repost delete succeeds', async () => {
    const db = setupDb();
    createSeasonRow(db, 8);
    db.prepare("UPDATE seasons SET telegram_message_id = 456, post_status = 'posted' WHERE id = ?").run(8);

    enqueueTelegramJob(db, 'delete', 'season', 8, {
      messageId: 456,
      retainEntityState: true
    });

    const client = {
      sendPhotoPost: vi.fn(),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn(async () => undefined)
    };

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(getSeasonPostState(db, 8)).toEqual({
      telegram_message_id: null,
      post_status: 'posted'
    });

    db.close();
  });

  it('does not process a repost send after retained delete permanently fails', async () => {
    const db = setupDb();
    createSeasonRow(db, 8);
    db.prepare("UPDATE seasons SET telegram_message_id = 456, post_status = 'posted' WHERE id = ?").run(8);

    enqueueTelegramJob(db, 'delete', 'season', 8, {
      messageId: 456,
      retainEntityState: true
    });
    enqueueTelegramJob(db, 'send', 'season', 8, {
      posterUrl: 'https://example.com/season.jpg',
      caption: 'Updated season'
    });

    const client = {
      sendPhotoPost: vi.fn(async () => ({ messageId: 999 })),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn(async () => {
        throw new Error('Telegram delete failed');
      })
    };

    await expect(processNextTelegramJob(db, client)).resolves.toBe(false);
    await expect(processNextTelegramJob(db, client)).resolves.toBe(false);

    expect(client.deleteMessage).toHaveBeenCalledTimes(1);
    expect(client.sendPhotoPost).not.toHaveBeenCalled();
    expect(getJobs(db).find((job) => job.job_type === 'send')).toMatchObject({
      status: 'failed',
      last_error: 'Telegram delete failed'
    });
    expect(getSeasonPostState(db, 8)).toEqual({
      telegram_message_id: 456,
      post_status: 'posted'
    });

    db.close();
  });

  it('updates waiting_retry send payload without changing retry timing', () => {
    const db = setupDb();
    const job = enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/old.jpg',
      caption: 'Old caption'
    });
    db.prepare(
      `UPDATE telegram_jobs
       SET status = 'waiting_retry',
           next_run_at = datetime('now', '+10 minutes'),
           last_error = 'Rate limited'
       WHERE id = ?`
    ).run(job.lastInsertRowid);

    const before = getJob(db);

    upsertActiveTelegramSendJob(db, 'movie', 7, {
      posterUrl: 'https://example.com/new.jpg',
      caption: 'New caption'
    });

    const after = getJob(db);
    expect(after).toMatchObject({
      id: before.id,
      status: 'waiting_retry',
      next_run_at: before.next_run_at,
      last_error: 'Rate limited'
    });
    expect(JSON.parse(after.payload)).toEqual({
      posterUrl: 'https://example.com/new.jpg',
      caption: 'New caption'
    });

    db.close();
  });

  it('coalesces running send follow-up payloads without inserting another send', () => {
    const db = setupDb();
    const runningJob = enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/running.jpg',
      caption: 'Running caption'
    });
    db.prepare(
      `UPDATE telegram_jobs
       SET status = 'running',
           attempts = 1
       WHERE id = ?`
    ).run(runningJob.lastInsertRowid);

    upsertActiveTelegramSendJob(db, 'movie', 7, {
      posterUrl: 'https://example.com/follow-up.jpg',
      caption: 'Follow-up caption'
    });

    const jobs = getJobs(db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: runningJob.lastInsertRowid,
      status: 'running'
    });
    expect(JSON.parse(jobs[0].payload)).toEqual({
      posterUrl: 'https://example.com/follow-up.jpg',
      caption: 'Follow-up caption'
    });

    db.close();
  });

  it('coalesces a running send follow-up into one post and a final caption edit', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => {
        upsertActiveTelegramSendJob(db, 'movie', 7, {
          posterUrl: 'https://example.com/follow-up.jpg',
          caption: 'Follow-up caption'
        });
        return { messageId: 888 };
      }),
      editPhotoCaption: vi.fn(async () => undefined),
      deleteMessage: vi.fn()
    };

    createMovieRow(db, 7, 'Running Movie');
    enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/running.jpg',
      caption: 'Running caption'
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.sendPhotoPost).toHaveBeenCalledTimes(1);
    expect(client.deleteMessage).not.toHaveBeenCalled();
    expect(getJobs(db).filter((job) => job.job_type === 'send')).toHaveLength(1);
    expect(getJobs(db).filter((job) => job.job_type === 'edit')).toHaveLength(1);

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.sendPhotoPost).toHaveBeenCalledTimes(1);
    expect(client.editPhotoCaption).toHaveBeenCalledWith({
      messageId: 888,
      caption: 'Follow-up caption'
    });
    expect(getMoviePostState(db, 7)).toEqual({
      telegram_message_id: 888,
      post_status: 'posted'
    });

    db.close();
  });

  it('deletes and resends when a running send payload moves to another topic', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => {
        upsertActiveTelegramSendJob(db, 'movie', 7, {
          posterUrl: 'https://example.com/follow-up.jpg',
          caption: 'Follow-up caption',
          messageThreadId: 27
        });
        return { messageId: 888 };
      }),
      editPhotoCaption: vi.fn(async () => undefined),
      deleteMessage: vi.fn(async () => undefined)
    };

    createMovieRow(db, 7, 'Running Movie');
    enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/running.jpg',
      caption: 'Running caption',
      messageThreadId: 20
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.sendPhotoPost).toHaveBeenCalledTimes(1);
    expect(client.sendPhotoPost).toHaveBeenCalledWith({
      posterUrl: 'https://example.com/running.jpg',
      caption: 'Running caption',
      messageThreadId: 20
    });
    expect(client.editPhotoCaption).not.toHaveBeenCalled();
    expect(getMoviePostState(db, 7)).toEqual({
      telegram_message_id: null,
      post_status: 'pending'
    });

    const replacementJobs = getJobs(db).slice(1);
    expect(replacementJobs.map((job) => job.job_type)).toEqual(['delete', 'send']);
    expect(JSON.parse(replacementJobs[0].payload)).toEqual({
      messageId: 888,
      retainEntityState: true,
      awaitReplacementSend: true
    });
    expect(JSON.parse(replacementJobs[1].payload)).toEqual({
      posterUrl: 'https://example.com/follow-up.jpg',
      caption: 'Follow-up caption',
      messageThreadId: 27
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);
    expect(client.deleteMessage).toHaveBeenCalledWith({ messageId: 888 });

    client.sendPhotoPost.mockResolvedValueOnce({ messageId: 999 });
    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.sendPhotoPost).toHaveBeenLastCalledWith({
      posterUrl: 'https://example.com/follow-up.jpg',
      caption: 'Follow-up caption',
      messageThreadId: 27
    });
    expect(getMoviePostState(db, 7)).toEqual({
      telegram_message_id: 999,
      post_status: 'posted'
    });

    db.close();
  });

  it('keeps topic replacement pending after cleanup delete succeeds until replacement send succeeds', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => {
        upsertActiveTelegramSendJob(db, 'movie', 7, {
          posterUrl: 'https://example.com/follow-up.jpg',
          caption: 'Follow-up caption',
          messageThreadId: 27
        });
        return { messageId: 888 };
      }),
      editPhotoCaption: vi.fn(async () => undefined),
      deleteMessage: vi.fn(async () => undefined)
    };

    createMovieRow(db, 7, 'Running Movie');
    enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/running.jpg',
      caption: 'Running caption',
      messageThreadId: 20
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);
    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.deleteMessage).toHaveBeenCalledWith({ messageId: 888 });
    expect(getMoviePostState(db, 7)).toEqual({
      telegram_message_id: null,
      post_status: 'pending'
    });
    expect(getJobs(db).filter((job) => job.job_type === 'send').at(-1)).toMatchObject({
      status: 'queued'
    });

    db.close();
  });

  it('keeps topic replacement pending and queued when cleanup delete fails', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => {
        upsertActiveTelegramSendJob(db, 'movie', 7, {
          posterUrl: 'https://example.com/follow-up.jpg',
          caption: 'Follow-up caption',
          messageThreadId: 27
        });
        return { messageId: 888 };
      }),
      editPhotoCaption: vi.fn(async () => undefined),
      deleteMessage: vi.fn(async () => {
        throw new Error('Telegram delete failed');
      })
    };

    createMovieRow(db, 7, 'Running Movie');
    enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/running.jpg',
      caption: 'Running caption',
      messageThreadId: 20
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);
    await expect(processNextTelegramJob(db, client)).resolves.toBe(false);

    expect(getMoviePostState(db, 7)).toEqual({
      telegram_message_id: null,
      post_status: 'pending'
    });
    expect(getJobs(db).filter((job) => job.job_type === 'send').at(-1)).toMatchObject({
      status: 'queued'
    });

    db.close();
  });

  it('deletes the just-sent Telegram message when a movie is deleted while the send is running', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => {
        db.prepare('DELETE FROM movies WHERE id = ?').run(7);
        return { messageId: 999 };
      }),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn(async () => undefined)
    };

    createMovieRow(db, 7, 'Deleted During Send');
    enqueueTelegramJob(db, 'send', 'movie', 7, {
      posterUrl: 'https://example.com/deleted.jpg',
      caption: 'Deleted During Send'
    });

    await expect(processNextTelegramJob(db, client)).resolves.toBe(true);

    expect(client.sendPhotoPost).toHaveBeenCalledTimes(1);
    expect(client.deleteMessage).toHaveBeenCalledWith({
      messageId: 999
    });
    expect(getJob(db)).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error: 'Entity no longer publishable after send completed'
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM movies WHERE id = ?').get(7)).toEqual({
      count: 0
    });

    db.close();
  });

  it('does not recover or send stale running movie send jobs when the movie was deleted', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => ({ messageId: 123 })),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn()
    };

    const movie = db
      .prepare("INSERT INTO movies (title, year, poster_url, quality, description) VALUES ('Deleted Movie', 2026, 'https://example.com/deleted.jpg', 'HD', 'Deleted')")
      .run();
    const job = enqueueTelegramJob(db, 'send', 'movie', Number(movie.lastInsertRowid), {
      posterUrl: 'https://example.com/deleted.jpg',
      caption: 'Deleted Movie (2026)'
    });
    db.prepare(
      `UPDATE telegram_jobs
       SET status = 'running',
           attempts = 1,
           updated_at = datetime('now', '-6 minutes')
       WHERE id = ?`
    ).run(job.lastInsertRowid);
    db.prepare('DELETE FROM movies WHERE id = ?').run(movie.lastInsertRowid);

    await expect(processNextTelegramJob(db, client)).resolves.toBe(false);

    expect(client.sendPhotoPost).not.toHaveBeenCalled();
    expect(getJob(db)).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error: 'Entity no longer exists'
    });

    db.close();
  });

  it('does not recover or send stale running season send jobs when the season was deleted', async () => {
    const db = setupDb();
    const client = {
      sendPhotoPost: vi.fn(async () => ({ messageId: 123 })),
      editPhotoCaption: vi.fn(),
      deleteMessage: vi.fn()
    };

    createSeasonRow(db, 8);
    const job = enqueueTelegramJob(db, 'send', 'season', 8, {
      posterUrl: 'https://example.com/season.jpg',
      caption: 'Show 8 - Season 1'
    });
    db.prepare(
      `UPDATE telegram_jobs
       SET status = 'running',
           attempts = 1,
           updated_at = datetime('now', '-6 minutes')
       WHERE id = ?`
    ).run(job.lastInsertRowid);
    db.prepare('DELETE FROM seasons WHERE id = ?').run(8);

    await expect(processNextTelegramJob(db, client)).resolves.toBe(false);

    expect(client.sendPhotoPost).not.toHaveBeenCalled();
    expect(getJob(db)).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error: 'Entity no longer exists'
    });

    db.close();
  });
});

describe('telegram topic routes', () => {
  it('falls back for missing legacy topic keys and rejects invalid non-empty keys', () => {
    expect(getTopicRoute(undefined, 'movie')).toMatchObject({ messageThreadId: 20 });
    expect(getTopicRoute('', 'tv')).toMatchObject({ messageThreadId: 22 });
    expect(() => getTopicRoute('NOT_A_TOPIC', 'movie')).toThrow(
      'Telegram topic route is not configured for NOT_A_TOPIC'
    );
  });
});

describe('telegram client', () => {
  it('sends photo posts to a message thread when provided', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, result: { message_id: 123 } }));
    const client = createTelegramClient(
      {
        botToken: 'test-token',
        channelId: '-1003963665033'
      },
      fetcher
    );

    await expect(
      client.sendPhotoPost({
        posterUrl: 'https://example.com/poster.jpg',
        caption: 'Inception (2010)',
        messageThreadId: 27
      })
    ).resolves.toEqual({ messageId: 123 });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendPhoto',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chat_id: '-1003963665033',
          photo: 'https://example.com/poster.jpg',
          caption: 'Inception (2010)',
          message_thread_id: 27
        })
      })
    );
  });

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

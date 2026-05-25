import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

describe('admin dashboard', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns dashboard counts for local admin health', async () => {
    db.prepare(
      `INSERT INTO movies (title, description, quality, post_status, telegram_message_id)
       VALUES ('Movie One', '', 'HD', 'posted', 100)`
    ).run();
    db.prepare(
      `INSERT INTO movie_links (movie_id, provider_name, quality, status, url)
       VALUES (1, 'Provider', 'HD', 'active', 'https://example.com/movie')`
    ).run();
    db.prepare(
      `INSERT INTO tv_shows (title, description, quality)
       VALUES ('Show One', '', 'HD')`
    ).run();
    db.prepare(
      `INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status)
       VALUES (1, 1, 200, 'posted')`
    ).run();
    db.prepare(
      `INSERT INTO episodes (season_id, episode_number)
       VALUES (1, 1)`
    ).run();
    db.prepare(
      `INSERT INTO episode_links (episode_id, provider_name, quality, status, url)
       VALUES (1, 'Provider', 'HD', 'active', 'https://example.com/episode')`
    ).run();
    db.prepare(
      `INSERT INTO episode_links (episode_id, provider_name, quality, status, url)
       VALUES (1, 'Provider', 'HD', 'inactive', 'https://example.com/inactive')`
    ).run();
    db.prepare(
      `INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status, last_error)
       VALUES ('send', 'movie', 1, '{}', 'failed', 'Telegram failed')`
    ).run();

    const app = createApp({
      db,
      config: {
        host: '127.0.0.1',
        port: 3000,
        databasePath: ':memory:',
        tmdbApiKey: 'tmdb-token',
        telegramBotToken: 'telegram-token',
        telegramChannelId: '-1001',
        publicSearchSyncUrl: 'https://public.example/api/sync',
        publicSearchSyncToken: 'sync-token',
        publicSearchStatusUrl: undefined,
        publicSearchStatusToken: undefined,
        publicSearchGroupHandle: '@infinitylinks69'
      }
    });

    const response = await request(app).get('/api/admin/dashboard').expect(200);

    expect(response.body.dashboard).toEqual({
      movies: 1,
      tvShows: 1,
      activeLinks: 2,
      failedTelegramJobs: 1,
      pendingPublicSearchChanges: true
    });
  });
});

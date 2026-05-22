import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import type { AppConfig } from '../../src/server/config.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

const config: AppConfig = {
  tmdbApiKey: 'test-tmdb-key',
  telegramBotToken: 'test-telegram-token',
  telegramChannelId: '@test-channel',
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:'
};

let db: AppDatabase;

function app() {
  return createApp({ db, config });
}

function getTelegramJobs() {
  return db.prepare('SELECT * FROM telegram_jobs ORDER BY id ASC').all() as Array<{
    job_type: string;
    entity_type: string;
    entity_id: number;
    payload: string;
    status: string;
  }>;
}

beforeEach(() => {
  db = createDatabase(':memory:');
  migrate(db);
});

afterEach(() => {
  db.close();
});

describe('tv media API', () => {
  it('creates a TV show', async () => {
    const response = await request(app())
      .post('/api/tv-shows')
      .send({
        tmdbId: 1399,
        title: 'Game of Thrones',
        year: 2011,
        posterUrl: 'https://example.com/got.jpg',
        rating: 8.4,
        quality: 'Full HD',
        description: 'Noble families fight for control.'
      })
      .expect(201);

    expect(response.body.tvShow).toMatchObject({
      id: expect.any(Number),
      tmdbId: 1399,
      title: 'Game of Thrones',
      year: 2011,
      posterUrl: 'https://example.com/got.jpg',
      rating: 8.4,
      quality: 'Full HD',
      description: 'Noble families fight for control.'
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM tv_shows WHERE id = ?').get(response.body.tvShow.id)).toEqual({
      count: 1
    });
  });

  it('creates a season for a TV show', async () => {
    const show = db
      .prepare(
        "INSERT INTO tv_shows (title, year, poster_url, quality, description) VALUES ('Chronos', 2025, 'https://example.com/chronos.jpg', 'HD', 'Time loops')"
      )
      .run();

    const response = await request(app())
      .post(`/api/tv-shows/${show.lastInsertRowid}/seasons`)
      .send({ seasonNumber: 2 })
      .expect(201);

    expect(response.body.season).toMatchObject({
      id: expect.any(Number),
      tvShowId: Number(show.lastInsertRowid),
      seasonNumber: 2,
      postStatus: 'pending'
    });
  });

  it('creates multiple episodes for a season', async () => {
    const show = db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Chronos', 'HD')").run();
    const season = db
      .prepare('INSERT INTO seasons (tv_show_id, season_number) VALUES (?, 1)')
      .run(show.lastInsertRowid);

    const response = await request(app())
      .post(`/api/seasons/${season.lastInsertRowid}/episodes/bulk`)
      .send({ startEpisode: 3, count: 3 })
      .expect(201);

    expect(response.body.episodes).toEqual([
      expect.objectContaining({ seasonId: Number(season.lastInsertRowid), episodeNumber: 3 }),
      expect.objectContaining({ seasonId: Number(season.lastInsertRowid), episodeNumber: 4 }),
      expect.objectContaining({ seasonId: Number(season.lastInsertRowid), episodeNumber: 5 })
    ]);
  });

  it('queues one Telegram season send job when the first linked episode is added', async () => {
    const show = db
      .prepare(
        "INSERT INTO tv_shows (title, year, poster_url, rating, quality, description) VALUES ('Chronos', 2025, 'https://example.com/chronos.jpg', 7.5, 'HD', 'Time loops')"
      )
      .run();
    const season = db
      .prepare('INSERT INTO seasons (tv_show_id, season_number) VALUES (?, 2)')
      .run(show.lastInsertRowid);
    const episode = db
      .prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)')
      .run(season.lastInsertRowid);

    const response = await request(app())
      .post(`/api/episodes/${episode.lastInsertRowid}/links`)
      .send([
        {
          providerName: 'Infinity Stream',
          quality: 'HD',
          status: 'active',
          url: 'https://example.com/chronos/s2/e1'
        }
      ])
      .expect(201);

    expect(response.body.links).toEqual([
      expect.objectContaining({
        episodeId: Number(episode.lastInsertRowid),
        providerName: 'Infinity Stream',
        quality: 'HD',
        status: 'active',
        url: 'https://example.com/chronos/s2/e1',
        sortOrder: 0
      })
    ]);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'send',
      entity_type: 'season',
      entity_id: Number(season.lastInsertRowid),
      status: 'queued'
    });
    expect(JSON.parse(jobs[0].payload)).toEqual({
      posterUrl: 'https://example.com/chronos.jpg',
      caption: expect.stringContaining('Chronos (2025) - Season 2')
    });
    expect(JSON.parse(jobs[0].payload).caption).toContain('Episode 1');
  });

  it('returns 400 JSON for invalid TV show ids and bodies', async () => {
    const invalidIdResponse = await request(app()).get('/api/tv-shows/nope/seasons').expect(400);
    expect(invalidIdResponse.body).toMatchObject({ error: 'Validation failed' });

    const invalidBodyResponse = await request(app())
      .post('/api/tv-shows')
      .send({ title: '', quality: 'BluRay' })
      .expect(400);
    expect(invalidBodyResponse.body).toMatchObject({ error: 'Validation failed' });
  });
});

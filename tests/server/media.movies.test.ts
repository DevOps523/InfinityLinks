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

function setupDb() {
  db = createDatabase(':memory:');
  migrate(db);
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
  setupDb();
});

afterEach(() => {
  db.close();
});

describe('movie media API', () => {
  it('creates a movie with links and queues one Telegram send job', async () => {
    const response = await request(app())
      .post('/api/movies')
      .send({
        tmdbId: 27205,
        title: 'Inception',
        year: 2010,
        posterUrl: 'https://example.com/inception.jpg',
        rating: 8.8,
        quality: 'Full HD',
        description: 'A thief steals corporate secrets through dream-sharing technology.',
        links: [
          {
            providerName: 'Infinity Stream',
            quality: 'Full HD',
            status: 'active',
            url: 'https://example.com/watch/inception'
          },
          {
            providerName: 'Mirror',
            quality: 'HD',
            status: 'inactive',
            url: 'https://example.com/mirror/inception'
          }
        ]
      })
      .expect(201);

    expect(response.body.movie).toMatchObject({
      id: expect.any(Number),
      tmdbId: 27205,
      title: 'Inception',
      year: 2010,
      posterUrl: 'https://example.com/inception.jpg',
      rating: 8.8,
      quality: 'Full HD',
      description: 'A thief steals corporate secrets through dream-sharing technology.',
      links: [
        {
          id: expect.any(Number),
          movieId: expect.any(Number),
          providerName: 'Infinity Stream',
          quality: 'Full HD',
          status: 'active',
          url: 'https://example.com/watch/inception',
          sortOrder: 0
        },
        {
          id: expect.any(Number),
          movieId: expect.any(Number),
          providerName: 'Mirror',
          quality: 'HD',
          status: 'inactive',
          url: 'https://example.com/mirror/inception',
          sortOrder: 1
        }
      ]
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM movies WHERE id = ?').get(response.body.movie.id)).toEqual({
      count: 1
    });

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'send',
      entity_type: 'movie',
      entity_id: response.body.movie.id,
      status: 'queued'
    });
    expect(JSON.parse(jobs[0].payload)).toEqual({
      posterUrl: 'https://example.com/inception.jpg',
      caption: expect.stringContaining('Inception (2010)')
    });
  });

  it('returns 400 JSON for invalid movie bodies', async () => {
    const response = await request(app())
      .post('/api/movies')
      .send({
        title: '',
        quality: 'BluRay',
        links: []
      })
      .expect(400);

    expect(response.body).toMatchObject({
      error: 'Validation failed',
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: 'title',
          message: expect.any(String)
        }),
        expect.objectContaining({
          path: 'quality',
          message: expect.any(String)
        })
      ])
    });
  });

  it('does not enqueue a Telegram send job when a movie has links but no poster', async () => {
    await request(app())
      .post('/api/movies')
      .send({
        title: 'Posterless',
        year: 2026,
        quality: 'HD',
        description: 'A movie without poster art.',
        links: [
          {
            providerName: 'Infinity Stream',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/watch/posterless'
          }
        ]
      })
      .expect(201);

    expect(getTelegramJobs()).toEqual([]);
  });

  it('lists movies filtered by title', async () => {
    db.prepare("INSERT INTO movies (title, year, quality, description) VALUES ('Arrival', 2016, 'HD', 'First contact')")
      .run();
    db.prepare("INSERT INTO movies (title, year, quality, description) VALUES ('Moon', 2009, 'HD', 'Lunar mystery')").run();
    db.prepare("INSERT INTO movies (title, year, quality, description) VALUES ('Alien', 1979, 'HD', 'Space horror')").run();

    const response = await request(app()).get('/api/movies?title=A').expect(200);

    expect(response.body.movies.map((movie: { title: string }) => movie.title)).toEqual(['Alien', 'Arrival']);
  });

  it('returns 400 JSON for invalid movie list filters', async () => {
    const response = await request(app()).get('/api/movies?year=abc').expect(400);

    expect(response.body).toMatchObject({
      error: 'Validation failed',
      issues: [
        expect.objectContaining({
          path: 'year',
          message: expect.any(String)
        })
      ]
    });
  });

  it('returns 400 JSON for unknown movie list filters', async () => {
    const response = await request(app()).get('/api/movies?yeer=2026').expect(400);

    expect(response.body).toMatchObject({
      error: 'Validation failed',
      issues: [
        expect.objectContaining({
          path: '',
          message: expect.any(String)
        })
      ]
    });
  });

  it('permanently deletes movie rows', async () => {
    const movie = db.prepare("INSERT INTO movies (title, year, quality) VALUES ('Deleted Movie', 2026, '4K')").run();
    db.prepare(
      "INSERT INTO movie_links (movie_id, provider_name, quality, status, url) VALUES (?, 'Provider', '4K', 'active', 'https://example.com/deleted')"
    ).run(movie.lastInsertRowid);

    await request(app()).delete(`/api/movies/${movie.lastInsertRowid}`).expect(204);

    expect(db.prepare('SELECT COUNT(*) AS count FROM movies WHERE id = ?').get(movie.lastInsertRowid)).toEqual({
      count: 0
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM movie_links WHERE movie_id = ?').get(movie.lastInsertRowid)).toEqual({
      count: 0
    });
  });

  it('returns 400 JSON for invalid delete movie ids', async () => {
    const response = await request(app()).delete('/api/movies/not-a-number').expect(400);

    expect(response.body).toMatchObject({
      error: 'Validation failed',
      issues: [
        expect.objectContaining({
          path: 'id',
          message: expect.any(String)
        })
      ]
    });
  });

  it('queues a Telegram delete job when deleting a movie with a Telegram message id', async () => {
    const movie = db
      .prepare("INSERT INTO movies (title, year, quality, telegram_message_id) VALUES ('Posted Movie', 2026, '4K', 456)")
      .run();

    await request(app()).delete(`/api/movies/${movie.lastInsertRowid}`).expect(204);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'delete',
      entity_type: 'movie',
      entity_id: movie.lastInsertRowid,
      status: 'queued'
    });
    expect(JSON.parse(jobs[0].payload)).toEqual({
      messageId: 456
    });
  });
});

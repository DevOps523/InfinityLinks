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
  databasePath: ':memory:',
  publicSearchChannelHandle: '@infinitylinks65',
  publicSearchGroupHandle: '@infinitylinks69'
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
        topicKey: 'PINOY_MOVIES',
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
      topicKey: 'PINOY_MOVIES',
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

  it('defaults movie topic and rejects TV-only movie topics', async () => {
    const defaultResponse = await request(app())
      .post('/api/movies')
      .send({
        title: 'Default Topic Movie',
        quality: 'HD',
        description: '',
        links: []
      })
      .expect(201);

    expect(defaultResponse.body.movie.topicKey).toBe('FOREIGN_MOVIES');

    const invalidResponse = await request(app())
      .post('/api/movies')
      .send({
        title: 'Invalid Topic Movie',
        quality: 'HD',
        topicKey: 'FOREIGN_TV_SERIES',
        description: '',
        links: []
      })
      .expect(400);

    expect(invalidResponse.body).toMatchObject({
      error: 'Validation failed',
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: 'topicKey'
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

  it('returns a movie with links by id', async () => {
    const movie = db
      .prepare(
        "INSERT INTO movies (tmdb_id, title, year, poster_url, rating, quality, description) VALUES (27205, 'Inception', 2010, 'https://example.com/inception.jpg', 8.8, 'Full HD', 'Dream heist')"
      )
      .run();
    db.prepare(
      "INSERT INTO movie_links (movie_id, provider_name, quality, status, url) VALUES (?, 'Provider', 'Full HD', 'active', 'https://example.com/watch')"
    ).run(movie.lastInsertRowid);

    const response = await request(app()).get(`/api/movies/${movie.lastInsertRowid}`).expect(200);

    expect(response.body.movie).toMatchObject({
      id: movie.lastInsertRowid,
      tmdbId: 27205,
      title: 'Inception',
      year: 2010,
      posterUrl: 'https://example.com/inception.jpg',
      rating: 8.8,
      quality: 'Full HD',
      description: 'Dream heist',
      links: [
        {
          providerName: 'Provider',
          quality: 'Full HD',
          status: 'active',
          url: 'https://example.com/watch'
        }
      ]
    });
  });

  it('updates a movie with replacement links and queues a Telegram edit job for posted movies', async () => {
    const movie = db
      .prepare(
        "INSERT INTO movies (title, year, poster_url, quality, description, telegram_message_id, post_status) VALUES ('Old Title', 2020, 'https://example.com/old.jpg', 'HD', 'Old description', 456, 'posted')"
      )
      .run();
    db.prepare(
      "INSERT INTO movie_links (movie_id, provider_name, quality, status, url) VALUES (?, 'Old Provider', 'HD', 'active', 'https://example.com/old')"
    ).run(movie.lastInsertRowid);

    const response = await request(app())
      .put(`/api/movies/${movie.lastInsertRowid}`)
      .send({
        tmdbId: 27205,
        title: 'Updated Title',
        year: 2026,
        posterUrl: 'https://example.com/new.jpg',
        rating: 7.5,
        quality: '4K',
        description: 'Updated description',
        links: [
          {
            providerName: 'New Provider',
            quality: '4K',
            status: 'active',
            url: 'https://example.com/new'
          },
          {
            providerName: 'Backup',
            quality: 'HD',
            status: 'inactive',
            url: 'https://example.com/backup'
          }
        ]
      })
      .expect(200);

    expect(response.body.movie).toMatchObject({
      id: movie.lastInsertRowid,
      tmdbId: 27205,
      title: 'Updated Title',
      year: 2026,
      posterUrl: 'https://example.com/new.jpg',
      rating: 7.5,
      quality: '4K',
      description: 'Updated description',
      telegramMessageId: 456,
      links: [
        {
          providerName: 'New Provider',
          quality: '4K',
          status: 'active',
          url: 'https://example.com/new',
          sortOrder: 0
        },
        {
          providerName: 'Backup',
          quality: 'HD',
          status: 'inactive',
          url: 'https://example.com/backup',
          sortOrder: 1
        }
      ]
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM movie_links WHERE provider_name = ?').get('Old Provider')).toEqual({
      count: 0
    });

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'edit',
      entity_type: 'movie',
      entity_id: movie.lastInsertRowid,
      status: 'queued'
    });
    expect(JSON.parse(jobs[0].payload)).toEqual({
      messageId: 456,
      caption: expect.stringContaining('Updated Title (2026)')
    });
  });

  it('queues a Telegram delete job when a posted movie update removes all links', async () => {
    const movie = db
      .prepare(
        "INSERT INTO movies (title, year, poster_url, quality, description, telegram_message_id, post_status) VALUES ('Posted Movie', 2020, 'https://example.com/old.jpg', 'HD', 'Old description', 456, 'posted')"
      )
      .run();
    db.prepare(
      "INSERT INTO movie_links (movie_id, provider_name, quality, status, url) VALUES (?, 'Old Provider', 'HD', 'active', 'https://example.com/old')"
    ).run(movie.lastInsertRowid);

    await request(app())
      .put(`/api/movies/${movie.lastInsertRowid}`)
      .send({
        title: 'Posted Movie',
        year: 2020,
        posterUrl: 'https://example.com/old.jpg',
        quality: 'HD',
        description: 'No links remain',
        links: []
      })
      .expect(200);

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

  it('updates an existing active Telegram send job instead of queuing duplicates for unposted movie edits', async () => {
    const createResponse = await request(app())
      .post('/api/movies')
      .send({
        title: 'Queued Movie',
        year: 2024,
        posterUrl: 'https://example.com/old.jpg',
        quality: 'HD',
        description: 'Queued description',
        links: [
          {
            providerName: 'Provider',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/old'
          }
        ]
      })
      .expect(201);

    expect(getTelegramJobs()).toHaveLength(1);

    await request(app())
      .put(`/api/movies/${createResponse.body.movie.id}`)
      .send({
        title: 'Queued Movie Updated',
        year: 2025,
        posterUrl: 'https://example.com/new.jpg',
        quality: '4K',
        description: 'Updated queued description',
        links: [
          {
            providerName: 'Provider',
            quality: '4K',
            status: 'active',
            url: 'https://example.com/new'
          }
        ]
      })
      .expect(200);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'send',
      entity_type: 'movie',
      entity_id: createResponse.body.movie.id,
      status: 'queued'
    });
    expect(JSON.parse(jobs[0].payload)).toEqual({
      posterUrl: 'https://example.com/new.jpg',
      caption: expect.stringContaining('Queued Movie Updated (2025)')
    });
  });

  it('removes pending Telegram send jobs when an unposted movie edit removes all links', async () => {
    const createResponse = await request(app())
      .post('/api/movies')
      .send({
        title: 'No Links Later',
        year: 2024,
        posterUrl: 'https://example.com/poster.jpg',
        quality: 'HD',
        description: 'Initially publishable',
        links: [
          {
            providerName: 'Provider',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/watch'
          }
        ]
      })
      .expect(201);

    expect(getTelegramJobs()).toHaveLength(1);

    await request(app())
      .put(`/api/movies/${createResponse.body.movie.id}`)
      .send({
        title: 'No Links Later',
        year: 2024,
        posterUrl: 'https://example.com/poster.jpg',
        quality: 'HD',
        description: 'No longer publishable',
        links: []
      })
      .expect(200);

    expect(getTelegramJobs()).toEqual([]);
  });

  it('removes pending Telegram send jobs when an unposted movie edit removes poster', async () => {
    const createResponse = await request(app())
      .post('/api/movies')
      .send({
        title: 'No Poster Later',
        year: 2024,
        posterUrl: 'https://example.com/poster.jpg',
        quality: 'HD',
        description: 'Initially publishable',
        links: [
          {
            providerName: 'Provider',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/watch'
          }
        ]
      })
      .expect(201);

    const queuedJob = getTelegramJobs()[0];
    db.prepare(
      `UPDATE telegram_jobs
       SET status = 'waiting_retry',
           next_run_at = datetime('now', '+5 minutes')
       WHERE entity_id = ?`
    ).run(createResponse.body.movie.id);

    await request(app())
      .put(`/api/movies/${createResponse.body.movie.id}`)
      .send({
        title: 'No Poster Later',
        year: 2024,
        posterUrl: '',
        quality: 'HD',
        description: 'No longer publishable',
        links: [
          {
            providerName: 'Provider',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/watch'
          }
        ]
      })
      .expect(200);

    expect(queuedJob).toMatchObject({
      job_type: 'send',
      status: 'queued'
    });
    expect(getTelegramJobs()).toEqual([]);
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

  it('removes pending Telegram send jobs when deleting an unposted movie before processing', async () => {
    const response = await request(app())
      .post('/api/movies')
      .send({
        title: 'Deleted Before Send',
        year: 2026,
        posterUrl: 'https://example.com/deleted.jpg',
        quality: 'HD',
        description: 'Queued but deleted',
        links: [
          {
            providerName: 'Provider',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/deleted'
          }
        ]
      })
      .expect(201);

    expect(getTelegramJobs()).toHaveLength(1);

    db.prepare(
      `UPDATE telegram_jobs
       SET status = 'waiting_retry',
           next_run_at = datetime('now', '+5 minutes')
       WHERE entity_id = ?`
    ).run(response.body.movie.id);

    await request(app()).delete(`/api/movies/${response.body.movie.id}`).expect(204);

    expect(getTelegramJobs()).toEqual([]);
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

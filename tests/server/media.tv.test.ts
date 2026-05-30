import express from 'express';
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
  authSecret: 'test-auth-secret-test-auth-secret-123',
  publicSearchGroupHandle: '@infinitylinks69'
};

const testAuthUser = {
  id: '1',
  email: 'admin@example.com',
  role: 'admin' as const,
  mustChangePassword: false
};

let db: AppDatabase;

function app() {
  const testApp = express();
  testApp.use((req, _res, next) => {
    req.headers['x-infinitylinks-request'] = 'fetch';
    next();
  });
  testApp.use(createApp({ db, config, testAuthUser }));
  return testApp;
}

function getTelegramJobs() {
  return db.prepare('SELECT * FROM telegram_jobs ORDER BY id ASC').all() as Array<{
    id: number;
    job_type: string;
    entity_type: string;
    entity_id: number;
    payload: string;
    status: string;
  }>;
}

function createLinkedSeason(options: { posterUrl?: string | null; telegramMessageId?: number } = {}) {
  const posterUrl = Object.hasOwn(options, 'posterUrl') ? options.posterUrl : 'https://example.com/chronos.jpg';
  const show = db
    .prepare(
      `INSERT INTO tv_shows (title, year, poster_url, rating, quality)
       VALUES ('Chronos', 2025, ?, 7.5, 'HD')`
    )
    .run(posterUrl);
  const season = db
    .prepare('INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 2, ?, ?)')
    .run(show.lastInsertRowid, options.telegramMessageId ?? null, options.telegramMessageId ? 'posted' : 'pending');
  const episode = db
    .prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)')
    .run(season.lastInsertRowid);

  return {
    showId: Number(show.lastInsertRowid),
    seasonId: Number(season.lastInsertRowid),
    episodeId: Number(episode.lastInsertRowid)
  };
}

function createPostedLinkedSeason() {
  const ids = createLinkedSeason({ telegramMessageId: 456 });
  const link = db
    .prepare(
      "INSERT INTO episode_links (episode_id, provider_name, quality, status, url) VALUES (?, 'Infinity Stream', 'HD', 'active', 'https://example.com/chronos/s2/e1')"
    )
    .run(ids.episodeId);

  return {
    ...ids,
    linkId: Number(link.lastInsertRowid)
  };
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
        topicKey: 'PINOY_TV_SERIES'
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
      topicKey: 'PINOY_TV_SERIES'
    });
    expect(response.body.tvShow).not.toHaveProperty('description');
    expect(db.prepare('SELECT COUNT(*) AS count FROM tv_shows WHERE id = ?').get(response.body.tvShow.id)).toEqual({
      count: 1
    });
  });

  it('defaults TV topic and rejects movie-only TV topics', async () => {
    const defaultResponse = await request(app())
      .post('/api/tv-shows')
      .send({
        title: 'Default Topic Show',
        quality: 'HD'
      })
      .expect(201);

    expect(defaultResponse.body.tvShow.topicKey).toBe('FOREIGN_TV_SERIES');

    const invalidResponse = await request(app())
      .post('/api/tv-shows')
      .send({
        title: 'Invalid Topic Show',
        quality: 'HD',
        topicKey: 'PINOY_MOVIES'
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

  it('sorts TV shows by created date, updated date, and title', async () => {
    db.prepare(
      `INSERT INTO tv_shows (title, year, quality, created_at, updated_at)
       VALUES ('Dark', 2017, 'HD', '2026-01-01 00:00:00', '2026-01-02 00:00:00')`
    ).run();
    db.prepare(
      `INSERT INTO tv_shows (title, year, quality, created_at, updated_at)
       VALUES ('Severance', 2022, 'HD', '2026-01-03 00:00:00', '2026-01-04 00:00:00')`
    ).run();
    db.prepare(
      `INSERT INTO tv_shows (title, year, quality, created_at, updated_at)
       VALUES ('Andor', 2022, 'HD', '2026-01-02 00:00:00', '2026-01-05 00:00:00')`
    ).run();

    const newest = await request(app()).get('/api/tv-shows').expect(200);
    expect(newest.body.tvShows.map((tvShow: { title: string }) => tvShow.title)).toEqual(['Severance', 'Andor', 'Dark']);

    const oldest = await request(app()).get('/api/tv-shows?sort=oldest').expect(200);
    expect(oldest.body.tvShows.map((tvShow: { title: string }) => tvShow.title)).toEqual(['Dark', 'Andor', 'Severance']);

    const updated = await request(app()).get('/api/tv-shows?sort=updated').expect(200);
    expect(updated.body.tvShows.map((tvShow: { title: string }) => tvShow.title)).toEqual(['Andor', 'Severance', 'Dark']);

    const titleAsc = await request(app()).get('/api/tv-shows?sort=title_asc').expect(200);
    expect(titleAsc.body.tvShows.map((tvShow: { title: string }) => tvShow.title)).toEqual(['Andor', 'Dark', 'Severance']);
  });

  it('returns 400 JSON for invalid TV show list sort filters', async () => {
    const response = await request(app()).get('/api/tv-shows?sort=random').expect(400);

    expect(response.body).toMatchObject({
      error: 'Validation failed',
      issues: [
        expect.objectContaining({
          path: 'sort',
          message: expect.any(String)
        })
      ]
    });
  });

  it('finds possible duplicate TV shows by title and year', async () => {
    await request(app())
      .post('/api/tv-shows')
      .send({
        title: 'Dark',
        year: 2017,
        quality: 'HD'
      })
      .expect(201);

    await request(app())
      .post('/api/tv-shows')
      .send({
        title: 'Dark',
        year: 2026,
        quality: 'HD'
      })
      .expect(201);

    const response = await request(app()).get('/api/tv-shows/duplicates?title=dark&year=2017').expect(200);

    expect(response.body.duplicates).toEqual([
      expect.objectContaining({
        title: 'Dark',
        year: 2017
      })
    ]);
  });

  it('validates duplicate TV show query filters', async () => {
    await request(app()).get('/api/tv-shows/duplicates?title=').expect(400);
    await request(app()).get('/api/tv-shows/duplicates?title=Dark&year=abc').expect(400);
    await request(app()).get('/api/tv-shows/duplicates?title=Dark&excludeId=0').expect(400);
  });

  it('creates a season for a TV show', async () => {
    const show = db
      .prepare(
        "INSERT INTO tv_shows (title, year, poster_url, quality) VALUES ('Chronos', 2025, 'https://example.com/chronos.jpg', 'HD')"
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

  it('queues anime season sends to the anime topic', async () => {
    const show = db
      .prepare(
        "INSERT INTO tv_shows (title, year, poster_url, quality, topic_key) VALUES ('Anime Show', 2026, 'https://example.com/anime.jpg', 'HD', 'ANIME')"
      )
      .run();
    const season = db
      .prepare('INSERT INTO seasons (tv_show_id, season_number) VALUES (?, 1)')
      .run(show.lastInsertRowid);
    const episode = db
      .prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)')
      .run(season.lastInsertRowid);

    await request(app())
      .post(`/api/episodes/${episode.lastInsertRowid}/links`)
      .send({
        links: [
          {
            providerName: 'Infinity Stream',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/anime/s1/e1'
          }
        ]
      })
      .expect(201);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].payload)).toEqual({
      posterUrl: 'https://example.com/anime.jpg',
      caption: expect.stringContaining('Anime Show (2026) - Season 1'),
      messageThreadId: 24
    });
  });

  it('returns and updates a TV show, then queues edits for posted seasons', async () => {
    const { showId, seasonId } = createPostedLinkedSeason();

    const getResponse = await request(app()).get(`/api/tv-shows/${showId}`).expect(200);
    expect(getResponse.body.tvShow).toMatchObject({
      id: showId,
      title: 'Chronos',
      year: 2025
    });

    const updateResponse = await request(app())
      .put(`/api/tv-shows/${showId}`)
      .send({
        tmdbId: 1234,
        title: 'Chronos Updated',
        year: 2026,
        posterUrl: 'https://example.com/chronos-updated.jpg',
        rating: 8.2,
        quality: 'Full HD'
      })
      .expect(200);

    expect(updateResponse.body.tvShow).toMatchObject({
      id: showId,
      title: 'Chronos Updated',
      year: 2026,
      posterUrl: 'https://example.com/chronos-updated.jpg',
      quality: 'Full HD'
    });

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'edit',
      entity_type: 'season',
      entity_id: seasonId
    });
    expect(JSON.parse(jobs[0].payload)).toMatchObject({
      messageId: 456,
      caption: expect.stringContaining('Chronos Updated (2026)')
    });
  });

  it('updates a season number and queues an edit for posted seasons', async () => {
    const { seasonId } = createPostedLinkedSeason();

    const response = await request(app()).put(`/api/seasons/${seasonId}`).send({ seasonNumber: 3 }).expect(200);

    expect(response.body.season).toMatchObject({
      id: seasonId,
      seasonNumber: 3
    });
    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].payload)).toMatchObject({
      messageId: 456,
      caption: expect.stringContaining('Season 3')
    });
  });

  it('updates an episode number and queues an edit for posted seasons', async () => {
    const { episodeId } = createPostedLinkedSeason();

    const response = await request(app()).put(`/api/episodes/${episodeId}`).send({ episodeNumber: 4 }).expect(200);

    expect(response.body.episode).toMatchObject({
      id: episodeId,
      episodeNumber: 4
    });
    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].payload)).toMatchObject({
      messageId: 456,
      caption: expect.stringContaining('Episode 4')
    });
  });

  it('updates an episode link and queues an edit for posted seasons', async () => {
    const { linkId } = createPostedLinkedSeason();

    const response = await request(app())
      .put(`/api/episode-links/${linkId}`)
      .send({
        providerName: 'Mirror',
        quality: 'Full HD',
        status: 'inactive',
        url: 'https://example.com/chronos/s2/e1/mirror'
      })
      .expect(200);

    expect(response.body.link).toMatchObject({
      id: linkId,
      providerName: 'Mirror',
      quality: 'Full HD',
      status: 'inactive',
      url: 'https://example.com/chronos/s2/e1/mirror'
    });
    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].payload)).toMatchObject({
      messageId: 456,
      caption: expect.stringContaining('Mirror')
    });
  });

  it('returns one season, one episode with links, and one episode link for edit surfaces', async () => {
    const { seasonId, episodeId, linkId } = createPostedLinkedSeason();

    const seasonResponse = await request(app()).get(`/api/seasons/${seasonId}`).expect(200);
    expect(seasonResponse.body.season).toMatchObject({
      id: seasonId,
      seasonNumber: 2,
      telegramMessageId: 456
    });

    const episodeResponse = await request(app()).get(`/api/episodes/${episodeId}`).expect(200);
    expect(episodeResponse.body.episode).toMatchObject({
      id: episodeId,
      seasonId,
      episodeNumber: 1,
      links: [
        expect.objectContaining({
          id: linkId,
          providerName: 'Infinity Stream',
          quality: 'HD',
          status: 'active',
          url: 'https://example.com/chronos/s2/e1'
        })
      ]
    });

    const linkResponse = await request(app()).get(`/api/episode-links/${linkId}`).expect(200);
    expect(linkResponse.body.link).toMatchObject({
      id: linkId,
      episodeId,
      providerName: 'Infinity Stream',
      quality: 'HD',
      status: 'active',
      url: 'https://example.com/chronos/s2/e1'
    });
  });

  it('returns 400 for invalid read ids and 404 for missing read entities', async () => {
    await request(app()).get('/api/seasons/nope').expect(400);
    await request(app()).get('/api/episodes/999').expect(404);
    await request(app()).get('/api/episode-links/999').expect(404);
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

  it('returns controlled JSON for duplicate seasons and overlapping bulk episodes', async () => {
    const show = db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Chronos', 'HD')").run();
    const season = db.prepare('INSERT INTO seasons (tv_show_id, season_number) VALUES (?, 1)').run(show.lastInsertRowid);
    db.prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 3)').run(season.lastInsertRowid);

    const duplicateSeason = await request(app())
      .post(`/api/tv-shows/${show.lastInsertRowid}/seasons`)
      .send({ seasonNumber: 1 })
      .expect(409);
    expect(duplicateSeason.body).toMatchObject({
      error: expect.any(String)
    });

    const overlappingEpisodes = await request(app())
      .post(`/api/seasons/${season.lastInsertRowid}/episodes/bulk`)
      .send({ startEpisode: 2, count: 3 })
      .expect(409);
    expect(overlappingEpisodes.body).toMatchObject({
      error: expect.any(String)
    });
  });

  it('queues one Telegram season send job when the first linked episode is added', async () => {
    const show = db
      .prepare(
        "INSERT INTO tv_shows (title, year, poster_url, rating, quality) VALUES ('Chronos', 2025, 'https://example.com/chronos.jpg', 7.5, 'HD')"
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
      .send({
        links: [
          {
            providerName: 'Infinity Stream',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/chronos/s2/e1'
          }
        ]
      })
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
      caption: expect.stringContaining('Chronos (2025) - Season 2'),
      messageThreadId: 22
    });
    expect(JSON.parse(jobs[0].payload).caption).toContain('Episode 1');
  });

  it('does not queue a Telegram season send job when linked episodes have no show poster', async () => {
    const { episodeId } = createLinkedSeason({ posterUrl: null });

    await request(app())
      .post(`/api/episodes/${episodeId}/links`)
      .send({
        links: [
          {
            providerName: 'Infinity Stream',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/chronos/s2/e1'
          }
        ]
      })
      .expect(201);

    expect(getTelegramJobs()).toHaveLength(0);
  });

  it('updates an existing pending season send and filters unlinked episodes from the caption', async () => {
    const { seasonId, episodeId } = createLinkedSeason();
    db.prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 2)').run(seasonId);

    await request(app())
      .post(`/api/episodes/${episodeId}/links`)
      .send({
        links: [
          {
            providerName: 'Infinity Stream',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/chronos/s2/e1'
          }
        ]
      })
      .expect(201);

    await request(app())
      .post(`/api/episodes/${episodeId}/links`)
      .send({
        links: [
          {
            providerName: 'Mirror',
            quality: 'Full HD',
            status: 'active',
            url: 'https://example.com/chronos/s2/e1/mirror'
          }
        ]
      })
      .expect(201);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'send',
      entity_type: 'season',
      entity_id: seasonId,
      status: 'queued'
    });
    const payload = JSON.parse(jobs[0].payload) as { caption: string };
    expect(payload.caption).toContain('Mirror');
    expect(payload.caption).not.toContain('Episode 2');
  });

  it('queues a posted season edit when later episode links are added', async () => {
    const { seasonId, episodeId } = createLinkedSeason({ telegramMessageId: 456 });

    await request(app())
      .post(`/api/episodes/${episodeId}/links`)
      .send({
        links: [
          {
            providerName: 'Infinity Stream',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/chronos/s2/e1'
          }
        ]
      })
      .expect(201);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'edit',
      entity_type: 'season',
      entity_id: seasonId,
      status: 'queued'
    });
    expect(JSON.parse(jobs[0].payload)).toMatchObject({
      messageId: 456,
      caption: expect.stringContaining('Infinity Stream')
    });
  });

  it('marks posted seasons repostable after linked episode changes', async () => {
    const { showId, episodeId } = createLinkedSeason({ telegramMessageId: 456 });

    await request(app())
      .post(`/api/episodes/${episodeId}/links`)
      .send({
        links: [
          {
            providerName: 'Infinity Stream',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/chronos/s2/e1'
          }
        ]
      })
      .expect(201);

    const response = await request(app()).get(`/api/tv-shows/${showId}/seasons`).expect(200);

    expect(response.body.seasons[0]).toMatchObject({
      id: expect.any(Number),
      canRepost: true
    });
  });

  it('queues a repost only when a posted season has new linked episode changes', async () => {
    const { seasonId, episodeId } = createLinkedSeason({ telegramMessageId: 456 });

    await request(app()).post(`/api/seasons/${seasonId}/repost`).expect(409);

    await request(app())
      .post(`/api/episodes/${episodeId}/links`)
      .send({
        links: [
          {
            providerName: 'Infinity Stream',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/chronos/s2/e1'
          }
        ]
      })
      .expect(201);

    await request(app()).post(`/api/seasons/${seasonId}/repost`).expect(200);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      job_type: 'delete',
      entity_type: 'season',
      entity_id: seasonId
    });
    expect(JSON.parse(jobs[0].payload)).toEqual({
      messageId: 456,
      retainEntityState: true
    });
    expect(jobs[1]).toMatchObject({
      job_type: 'send',
      entity_type: 'season',
      entity_id: seasonId
    });
    expect(JSON.parse(jobs[1].payload)).toMatchObject({
      posterUrl: 'https://example.com/chronos.jpg',
      caption: expect.stringContaining('Infinity Stream')
    });
    expect(await request(app()).get(`/api/seasons/${seasonId}`).expect(200)).toMatchObject({
      body: {
        season: expect.objectContaining({
          canRepost: false
        })
      }
    });
  });

  it('updates pending repost send instead of editing old post when links change during repost', async () => {
    const { seasonId, episodeId } = createLinkedSeason({ telegramMessageId: 456 });

    await request(app())
      .post(`/api/episodes/${episodeId}/links`)
      .send({
        links: [
          {
            providerName: 'First Host',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/first'
          }
        ]
      })
      .expect(201);

    await request(app()).post(`/api/seasons/${seasonId}/repost`).expect(200);

    await request(app())
      .post(`/api/episodes/${episodeId}/links`)
      .send({
        links: [
          {
            providerName: 'Second Host',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/second'
          }
        ]
      })
      .expect(201);

    const jobs = getTelegramJobs();
    expect(jobs.filter((job) => job.job_type === 'delete')).toHaveLength(1);
    expect(jobs.filter((job) => job.job_type === 'edit')).toHaveLength(0);

    const [deleteJob] = jobs.filter((job) => job.job_type === 'delete');
    expect(JSON.parse(deleteJob.payload)).toEqual({
      messageId: 456,
      retainEntityState: true
    });

    const [sendJob] = jobs.filter((job) => job.job_type === 'send');
    expect(sendJob).toBeDefined();
    expect(JSON.parse(sendJob.payload).caption).toContain('Second Host');
  });

  it('cancels pending repost send and keeps retained delete when poster is removed during repost', async () => {
    const { showId, seasonId, episodeId } = createLinkedSeason({ telegramMessageId: 456 });

    await request(app())
      .post(`/api/episodes/${episodeId}/links`)
      .send({
        links: [
          {
            providerName: 'First Host',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/first'
          }
        ]
      })
      .expect(201);

    await request(app()).post(`/api/seasons/${seasonId}/repost`).expect(200);

    await request(app())
      .put(`/api/tv-shows/${showId}`)
      .send({
        title: 'Chronos',
        year: 2025,
        posterUrl: '',
        rating: 7.5,
        quality: 'HD'
      })
      .expect(200);

    const jobs = getTelegramJobs();
    expect(jobs.filter((job) => job.job_type === 'send')).toHaveLength(0);
    expect(jobs.filter((job) => job.job_type === 'edit')).toHaveLength(0);

    const [deleteJob] = jobs.filter((job) => job.job_type === 'delete');
    expect(deleteJob).toBeDefined();
    expect(JSON.parse(deleteJob.payload)).toEqual({
      messageId: 456,
      retainEntityState: true
    });
  });

  it('queues a posted season delete when the last episode link is deleted', async () => {
    const { seasonId, episodeId } = createLinkedSeason({ telegramMessageId: 456 });
    const link = db
      .prepare(
        "INSERT INTO episode_links (episode_id, provider_name, quality, status, url) VALUES (?, 'Infinity Stream', 'HD', 'active', 'https://example.com/chronos/s2/e1')"
      )
      .run(episodeId);

    await request(app()).delete(`/api/episode-links/${link.lastInsertRowid}`).expect(204);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'delete',
      entity_type: 'season',
      entity_id: seasonId,
      status: 'queued'
    });
    expect(JSON.parse(jobs[0].payload)).toEqual({ messageId: 456 });
  });

  it('does not create duplicate pending season delete jobs when delete sync repeats', async () => {
    const { seasonId, episodeId } = createLinkedSeason({ telegramMessageId: 456 });
    const firstLink = db
      .prepare(
        "INSERT INTO episode_links (episode_id, provider_name, quality, status, url) VALUES (?, 'Infinity Stream', 'HD', 'active', 'https://example.com/chronos/s2/e1')"
      )
      .run(episodeId);
    const secondLink = db
      .prepare(
        "INSERT INTO episode_links (episode_id, provider_name, quality, status, url) VALUES (?, 'Mirror', 'HD', 'active', 'https://example.com/chronos/s2/e1/mirror')"
      )
      .run(episodeId);

    await request(app()).delete(`/api/episode-links/${firstLink.lastInsertRowid}`).expect(204);
    await request(app()).delete(`/api/episode-links/${secondLink.lastInsertRowid}`).expect(204);
    await request(app()).delete(`/api/episodes/${episodeId}`).expect(204);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'delete',
      entity_type: 'season',
      entity_id: seasonId
    });
  });

  it('cancels stale pending season deletes when content becomes publishable again', async () => {
    const { seasonId, episodeId } = createLinkedSeason({ telegramMessageId: 456 });
    db.prepare(
      "INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status) VALUES ('delete', 'season', ?, '{\"messageId\":456}', 'queued')"
    ).run(seasonId);

    await request(app())
      .post(`/api/episodes/${episodeId}/links`)
      .send({
        links: [
          {
            providerName: 'Infinity Stream',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/chronos/s2/e1'
          }
        ]
      })
      .expect(201);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'edit',
      entity_type: 'season',
      entity_id: seasonId
    });
  });

  it('cancels pending season sends and queues delete when a posted season is deleted', async () => {
    const { seasonId } = createLinkedSeason({ telegramMessageId: 456 });
    db.prepare(
      "INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status) VALUES ('send', 'season', ?, '{\"posterUrl\":\"https://example.com/old.jpg\",\"caption\":\"Old\"}', 'queued')"
    ).run(seasonId);

    await request(app()).delete(`/api/seasons/${seasonId}`).expect(204);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'delete',
      entity_type: 'season',
      entity_id: seasonId
    });
    expect(JSON.parse(jobs[0].payload)).toEqual({ messageId: 456 });
  });

  it('cancels pending season sends and queues deletes when a TV show is deleted', async () => {
    const { showId, seasonId } = createLinkedSeason({ telegramMessageId: 456 });
    db.prepare(
      "INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status) VALUES ('send', 'season', ?, '{\"posterUrl\":\"https://example.com/old.jpg\",\"caption\":\"Old\"}', 'queued')"
    ).run(seasonId);

    await request(app()).delete(`/api/tv-shows/${showId}`).expect(204);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_type: 'delete',
      entity_type: 'season',
      entity_id: seasonId
    });
    expect(JSON.parse(jobs[0].payload)).toEqual({ messageId: 456 });
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

  it('returns 400 JSON for empty episode link arrays', async () => {
    const { episodeId } = createLinkedSeason();

    const response = await request(app()).post(`/api/episodes/${episodeId}/links`).send({ links: [] }).expect(400);

    expect(response.body).toMatchObject({
      error: 'Validation failed'
    });
  });
});

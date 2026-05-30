import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.js';
import type { AppConfig } from '../../src/server/config.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

const baseConfig: AppConfig = {
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

function app(config: AppConfig, fetcher: typeof fetch = vi.fn<typeof fetch>()) {
  const testApp = express();
  testApp.use((req, _res, next) => {
    req.headers['x-infinitylinks-request'] = 'fetch';
    next();
  });
  testApp.use(createApp({ db, config, fetcher, testAuthUser }));
  return testApp;
}

function createMigratedDatabase() {
  db = createDatabase(':memory:');
  migrate(db);
}

function insertPostedMovie() {
  const movie = db
    .prepare(
      "INSERT INTO movies (title, year, quality, telegram_message_id, post_status) VALUES ('Inception', 2010, 'HD', 123, 'posted')"
    )
    .run();

  db.prepare(
    `INSERT INTO movie_links (movie_id, provider_name, quality, status, url)
     VALUES (?, 'MixDrop', 'HD', 'active', 'https://mixdrop.example/inception')`
  ).run(movie.lastInsertRowid);
}

function insertPostedTvShow(title: string) {
  const show = db.prepare('INSERT INTO tv_shows (title, quality) VALUES (?, ?)').run(title, 'HD');
  const season = db
    .prepare(
      "INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 1, 456, 'posted')"
    )
    .run(show.lastInsertRowid);
  const episode = db.prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)').run(season.lastInsertRowid);

  db.prepare(
    `INSERT INTO episode_links (episode_id, provider_name, quality, status, url)
     VALUES (?, 'MixDrop', 'HD', 'active', ?)`
  ).run(episode.lastInsertRowid, `https://mixdrop.example/${title.toLowerCase().replace(/\s+/g, '-')}`);
}

beforeEach(() => {
  createMigratedDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

describe('public search sync route', () => {
  it('returns 400 when public search sync URL is missing', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const response = await request(app({ ...baseConfig, publicSearchSyncToken: 'secret-token' }, fetchMock))
      .post('/api/public-search/sync')
      .expect(400);

    expect(response.body).toEqual({ error: 'Public search sync is not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when public search sync token is missing', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const response = await request(app({ ...baseConfig, publicSearchSyncUrl: 'https://search.example.com/api/sync' }, fetchMock))
      .post('/api/public-search/sync')
      .expect(400);

    expect(response.body).toEqual({ error: 'Public search sync is not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds the public catalog and sends it to the configured URL', async () => {
    insertPostedMovie();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    const response = await request(
      app(
        {
          ...baseConfig,
          publicSearchSyncUrl: 'https://search.example.com/api/sync',
          publicSearchSyncToken: 'secret-token'
        },
        fetchMock
      )
    )
      .post('/api/public-search/sync')
      .expect(200);

    expect(response.body.sync).toMatchObject({
      syncedAt: expect.any(String),
      movies: 1,
      tvShows: 0
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://search.example.com/api/sync',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Headers),
        body: expect.stringContaining('"movies"')
      })
    );

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer secret-token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      channelHandle: '@infinitylinks69',
      groupHandle: '@infinitylinks69',
      movies: [
        {
          title: 'Inception',
          providers: [
            {
              providerName: 'MixDrop',
              url: 'https://mixdrop.example/inception'
            }
          ]
        }
      ],
      tvShows: []
    });
  });

  it('returns configured true and pending changes before first sync when one posted movie exists', async () => {
    insertPostedMovie();

    const response = await request(
      app({
        ...baseConfig,
        publicSearchSyncUrl: 'https://search.example.com/api/sync',
        publicSearchSyncToken: 'secret-token'
      })
    )
      .get('/api/public-search/sync-status')
      .expect(200);

    expect(response.body).toEqual({
      configured: true,
      hasPublicSearchableContent: true,
      hasPendingChanges: true,
      current: {
        catalogHash: expect.any(String),
        movies: 1,
        tvShows: 0
      },
      lastSuccessfulSync: null
    });
  });

  it('returns a public search catalog preview with counts only', async () => {
    const movieTitles = ['Zulu Movie', 'Alpha Movie', 'Beta Movie', 'Delta Movie', 'Echo Movie', 'Foxtrot Movie'];

    for (const [index, title] of movieTitles.entries()) {
      const movie = db
        .prepare('INSERT INTO movies (title, quality, telegram_message_id, post_status) VALUES (?, ?, ?, ?)')
        .run(title, 'HD', 700 + index, 'posted');

      db.prepare(
        `INSERT INTO movie_links (movie_id, provider_name, quality, status, url)
         VALUES (?, 'MixDrop', 'HD', 'active', ?)`
      ).run(movie.lastInsertRowid, `https://mixdrop.example/${title.toLowerCase().replace(/\s+/g, '-')}`);
    }

    for (const title of ['Zeta Show', 'Alpha Show', 'Beta Show', 'Delta Show', 'Echo Show', 'Foxtrot Show']) {
      insertPostedTvShow(title);
    }

    const response = await request(app(baseConfig)).get('/api/public-search/preview').expect(200);

    expect(response.body).toEqual({
      preview: {
        movies: 6,
        tvShows: 6
      }
    });
  });

  it('stores current hash after successful sync and reports no pending changes', async () => {
    insertPostedMovie();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const config = {
      ...baseConfig,
      publicSearchSyncUrl: 'https://search.example.com/api/sync',
      publicSearchSyncToken: 'secret-token'
    };

    const syncResponse = await request(app(config, fetchMock)).post('/api/public-search/sync').expect(200);

    expect(syncResponse.body.sync).toMatchObject({
      syncedAt: expect.any(String),
      movies: 1,
      tvShows: 0
    });
    expect(syncResponse.body.status).toMatchObject({
      configured: true,
      hasPublicSearchableContent: true,
      hasPendingChanges: false,
      current: {
        catalogHash: expect.any(String),
        movies: 1,
        tvShows: 0
      },
      lastSuccessfulSync: {
        syncedAt: syncResponse.body.sync.syncedAt,
        movies: 1,
        tvShows: 0
      }
    });
    expect(syncResponse.body.status.lastSuccessfulSync).not.toHaveProperty('catalogHash');

    const statusResponse = await request(app(config, fetchMock)).get('/api/public-search/sync-status').expect(200);

    expect(statusResponse.body).toMatchObject({
      configured: true,
      hasPublicSearchableContent: true,
      hasPendingChanges: false,
      current: {
        catalogHash: syncResponse.body.status.current.catalogHash,
        movies: 1,
        tvShows: 0
      },
      lastSuccessfulSync: {
        syncedAt: syncResponse.body.sync.syncedAt,
        movies: 1,
        tvShows: 0
      }
    });
    expect(statusResponse.body.lastSuccessfulSync).not.toHaveProperty('catalogHash');
  });

  it('reports pending changes when previously synced content becomes non-exportable', async () => {
    insertPostedMovie();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const config = {
      ...baseConfig,
      publicSearchSyncUrl: 'https://search.example.com/api/sync',
      publicSearchSyncToken: 'secret-token'
    };

    const syncResponse = await request(app(config, fetchMock)).post('/api/public-search/sync').expect(200);

    db.prepare("UPDATE movie_links SET status = 'inactive'").run();

    const statusResponse = await request(app(config, fetchMock)).get('/api/public-search/sync-status').expect(200);

    expect(statusResponse.body).toMatchObject({
      configured: true,
      hasPublicSearchableContent: false,
      hasPendingChanges: true,
      current: {
        catalogHash: expect.any(String),
        movies: 0,
        tvShows: 0
      },
      lastSuccessfulSync: {
        syncedAt: syncResponse.body.sync.syncedAt,
        movies: 1,
        tvShows: 0
      }
    });
    expect(statusResponse.body.current.catalogHash).not.toBe(syncResponse.body.status.current.catalogHash);
  });

  it('does not store sync state after failed remote sync, so pending changes remain', async () => {
    insertPostedMovie();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status: 500 }));
    const config = {
      ...baseConfig,
      publicSearchSyncUrl: 'https://search.example.com/api/sync',
      publicSearchSyncToken: 'secret-token'
    };

    await request(app(config, fetchMock)).post('/api/public-search/sync').expect(502);

    const statusResponse = await request(app(config, fetchMock)).get('/api/public-search/sync-status').expect(200);

    expect(statusResponse.body).toMatchObject({
      configured: true,
      hasPublicSearchableContent: true,
      hasPendingChanges: true,
      current: {
        catalogHash: expect.any(String),
        movies: 1,
        tvShows: 0
      },
      lastSuccessfulSync: null
    });
  });

  it('returns 502 when the configured public search sync endpoint fails', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status: 500 }));

    const response = await request(
      app(
        {
          ...baseConfig,
          publicSearchSyncUrl: 'https://search.example.com/api/sync',
          publicSearchSyncToken: 'secret-token'
        },
        fetchMock
      )
    )
      .post('/api/public-search/sync')
      .expect(502);

    expect(response.body).toEqual({ error: 'Public search sync failed' });
  });

  it('returns 502 when the configured public search sync endpoint cannot be reached', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('connection refused'));

    const response = await request(
      app(
        {
          ...baseConfig,
          publicSearchSyncUrl: 'https://search.example.com/api/sync',
          publicSearchSyncToken: 'secret-token'
        },
        fetchMock
      )
    )
      .post('/api/public-search/sync')
      .expect(502);

    expect(response.body).toEqual({ error: 'Public search sync failed' });
  });
});

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
  publicSearchChannelHandle: '@infinitylinks65',
  publicSearchGroupHandle: '@infinitylinks69'
};

let db: AppDatabase;

function app(config: AppConfig, fetcher: typeof fetch = vi.fn<typeof fetch>()) {
  return createApp({ db, config, fetcher });
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
      channelHandle: '@infinitylinks65',
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

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

beforeEach(() => {
  createMigratedDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

describe('public search status route', () => {
  it('returns 400 when public search status URL is missing', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const response = await request(app({ ...baseConfig, publicSearchStatusToken: 'status-token' }, fetchMock))
      .get('/api/public-search/status')
      .expect(400);

    expect(response.body).toEqual({
      reachable: false,
      lastSuccessfulCheckAt: null,
      error: 'Public search status is not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when public search status token is missing', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const response = await request(
      app({ ...baseConfig, publicSearchStatusUrl: 'https://search.example.com/api/status' }, fetchMock)
    )
      .get('/api/public-search/status')
      .expect(400);

    expect(response.body).toEqual({
      reachable: false,
      lastSuccessfulCheckAt: null,
      error: 'Public search status is not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the configured URL with a bearer token and returns reachable status', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        state: 'ok',
        checkedAt: '2026-05-24T09:10:11.000Z',
        uptimeSeconds: 1234,
        consecutiveErrorCount: 0,
        lastError: null,
        token: 'remote-token-value',
        authorization: 'Bearer status-token',
        nested: {
          secret: 'nested-secret'
        }
      })
    );

    const response = await request(
      app(
        {
          ...baseConfig,
          publicSearchStatusUrl: 'https://search.example.com/api/status',
          publicSearchStatusToken: 'status-token'
        },
        fetchMock
      )
    )
      .get('/api/public-search/status')
      .expect(200);

    expect(response.body).toEqual({
      reachable: true,
      lastSuccessfulCheckAt: expect.any(String),
      remote: {
        state: 'ok',
        checkedAt: '2026-05-24T09:10:11.000Z',
        uptimeSeconds: 1234,
        consecutiveErrorCount: 0,
        lastError: null
      }
    });
    expect(response.text).not.toContain('status-token');
    expect(response.text).not.toContain('remote-token-value');
    expect(response.text).not.toContain('nested-secret');
    expect(response.body.remote).not.toHaveProperty('token');
    expect(response.body.remote).not.toHaveProperty('authorization');
    expect(response.body.remote).not.toHaveProperty('nested');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://search.example.com/api/status',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers)
      })
    );

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer status-token');
  });

  it('returns 502 without raw remote data when public search status payload is malformed', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        state: 'ok',
        checkedAt: '2026-05-24T09:10:11.000Z',
        uptimeSeconds: '1234',
        consecutiveErrorCount: 0,
        lastError: null,
        token: 'leaked-token',
        rawHeaders: {
          authorization: 'Bearer status-token'
        }
      })
    );

    const response = await request(
      app(
        {
          ...baseConfig,
          publicSearchStatusUrl: 'https://search.example.com/api/status',
          publicSearchStatusToken: 'status-token'
        },
        fetchMock
      )
    )
      .get('/api/public-search/status')
      .expect(502);

    expect(response.body).toEqual({
      reachable: false,
      lastSuccessfulCheckAt: expect.any(String),
      error: 'Public search status is unreachable'
    });
    expect(response.text).not.toContain('leaked-token');
    expect(response.text).not.toContain('status-token');
    expect(response.text).not.toContain('rawHeaders');
  });

  it('returns 502 when the configured public search status endpoint fails', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status: 500 }));

    const response = await request(
      app(
        {
          ...baseConfig,
          publicSearchStatusUrl: 'https://search.example.com/api/status',
          publicSearchStatusToken: 'status-token'
        },
        fetchMock
      )
    )
      .get('/api/public-search/status')
      .expect(502);

    expect(response.body).toEqual({
      reachable: false,
      lastSuccessfulCheckAt: expect.any(String),
      error: 'Public search status is unreachable'
    });
    expect(response.text).not.toContain('status-token');
  });

  it('returns 502 when the configured public search status endpoint cannot be reached', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('connection refused'));

    const response = await request(
      app(
        {
          ...baseConfig,
          publicSearchStatusUrl: 'https://search.example.com/api/status',
          publicSearchStatusToken: 'status-token'
        },
        fetchMock
      )
    )
      .get('/api/public-search/status')
      .expect(502);

    expect(response.body).toEqual({
      reachable: false,
      lastSuccessfulCheckAt: expect.any(String),
      error: 'Public search status is unreachable'
    });
    expect(response.text).not.toContain('connection refused');
    expect(response.text).not.toContain('status-token');
  });
});

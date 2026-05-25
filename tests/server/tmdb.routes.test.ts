import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.js';
import type { AppConfig } from '../../src/server/config.js';
import { createDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';
import { withFetchTimeout, type TmdbFetchWithInit } from '../../src/server/tmdb/fetch-timeout.js';

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

function createDb() {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

describe('withFetchTimeout', () => {
  it('preserves caller-provided abort signals', async () => {
    const callerController = new AbortController();
    const fetcher = vi.fn<TmdbFetchWithInit>((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const wrapped = withFetchTimeout(fetcher, 1000);

    const request = wrapped('https://example.test/search', { signal: callerController.signal });
    callerController.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

describe('TMDB search route protections', () => {
  it('rate limits repeated TMDB search requests from one client', async () => {
    const db = createDb();
    const fetcher = vi.fn<TmdbFetchWithInit>().mockImplementation(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));

    try {
      const app = createApp({
        db,
        config,
        tmdbOptions: {
          fetcher,
          rateLimit: { limit: 2, windowMs: 60_000 },
          timeoutMs: 1000
        }
      });

      await request(app).get('/api/tmdb/search?query=one').set('X-InfinityLinks-Request', 'fetch').expect(200);
      await request(app).get('/api/tmdb/search?query=two').set('X-InfinityLinks-Request', 'fetch').expect(200);

      const response = await request(app)
        .get('/api/tmdb/search?query=three')
        .set('X-InfinityLinks-Request', 'fetch')
        .expect(429);

      expect(response.body).toEqual({ error: 'Too many TMDB searches. Please wait and try again.' });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });

  it('returns a safe upstream failure when TMDB search times out', async () => {
    const db = createDb();
    const fetcher = vi.fn<TmdbFetchWithInit>((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    try {
      const app = createApp({
        db,
        config,
        tmdbOptions: {
          fetcher,
          rateLimit: { limit: 10, windowMs: 60_000 },
          timeoutMs: 1
        }
      });

      const response = await request(app)
        .get('/api/tmdb/search?query=inception')
        .set('X-InfinityLinks-Request', 'fetch')
        .expect(502);

      expect(response.body).toEqual({ error: 'TMDB search failed' });
    } finally {
      db.close();
    }
  });

  it('returns a safe upstream failure when TMDB response body times out', async () => {
    const db = createDb();
    const fetcher = vi.fn<TmdbFetchWithInit>(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => new Promise(() => undefined)
    }));

    try {
      const app = createApp({
        db,
        config,
        tmdbOptions: {
          fetcher,
          rateLimit: { limit: 10, windowMs: 60_000 },
          timeoutMs: 1
        }
      });

      const response = await request(app)
        .get('/api/tmdb/search?query=inception')
        .set('X-InfinityLinks-Request', 'fetch')
        .expect(502);

      expect(response.body).toEqual({ error: 'TMDB search failed' });
    } finally {
      db.close();
    }
  });
});

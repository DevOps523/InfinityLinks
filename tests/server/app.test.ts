import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.js';
import type { AppConfig } from '../../src/server/config.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

let server: Server | undefined;

afterEach(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  server = undefined;
});

async function requestApp(path: string) {
  const app = createApp();
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`);
}

describe('createApp', () => {
  it('returns JSON 404 for unknown API routes', async () => {
    const response = await requestApp('/api/unknown');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'API route not found' });
  });
});

const guardConfig: AppConfig = {
  tmdbApiKey: 'test-tmdb-key',
  telegramBotToken: 'test-telegram-token',
  telegramChannelId: '@test-channel',
  host: '127.0.0.1',
  port: 3000,
  databasePath: ':memory:',
  publicSearchSyncUrl: 'https://search.example.com/api/sync',
  publicSearchSyncToken: 'secret-token',
  publicSearchGroupHandle: '@infinitylinks69'
};

function createGuardDb(): AppDatabase {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

describe('admin API request guard', () => {
  it('rejects cross-site browser POSTs before bodyless sync work runs', async () => {
    const db = createGuardDb();
    const fetchMock = vi.fn<typeof fetch>();

    try {
      const guardedApp = createApp({ db, config: guardConfig, fetcher: fetchMock });

      const response = await request(guardedApp)
        .post('/api/public-search/sync')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'https://evil.example')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('X-InfinityLinks-Request', 'fetch')
        .expect(403);

      expect(response.body).toEqual({ error: 'Cross-site request blocked' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('rejects bodyless mutating requests without browser provenance before sync work runs', async () => {
    const db = createGuardDb();
    const fetchMock = vi.fn<typeof fetch>();

    try {
      const guardedApp = createApp({ db, config: guardConfig, fetcher: fetchMock });

      const response = await request(guardedApp)
        .post('/api/public-search/sync')
        .set('Host', '127.0.0.1:3000')
        .expect(403);

      expect(response.body).toEqual({ error: 'Cross-site request blocked' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('rejects browser requests with a non-loopback host even when the browser reports same-origin', async () => {
    const db = createGuardDb();

    try {
      const guardedApp = createApp({ db, config: guardConfig, fetcher: vi.fn<typeof fetch>() });

      const response = await request(guardedApp)
        .post('/api/tv-shows')
        .set('Host', 'evil.example:3000')
        .set('Origin', 'http://evil.example:3000')
        .set('Sec-Fetch-Site', 'same-origin')
        .set('X-InfinityLinks-Request', 'fetch')
        .send({ title: 'Injected Show', quality: 'HD' })
        .expect(403);

      expect(response.body).toEqual({ error: 'Cross-site request blocked' });
    } finally {
      db.close();
    }
  });

  it('rejects same-origin browser mutating requests without the admin request header', async () => {
    const db = createGuardDb();

    try {
      const guardedApp = createApp({ db, config: guardConfig, fetcher: vi.fn<typeof fetch>() });

      const response = await request(guardedApp)
        .post('/api/seasons/1/repost')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'http://127.0.0.1:3000')
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(403);

      expect(response.body).toEqual({ error: 'Cross-site request blocked' });
    } finally {
      db.close();
    }
  });

  it('allows same-origin API-style mutating requests with the admin request header', async () => {
    const db = createGuardDb();

    try {
      const guardedApp = createApp({ db, config: guardConfig, fetcher: vi.fn<typeof fetch>() });

      const response = await request(guardedApp)
        .post('/api/seasons/1/repost')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'http://127.0.0.1:3000')
        .set('Sec-Fetch-Site', 'same-origin')
        .set('X-InfinityLinks-Request', 'fetch')
        .expect(404);

      expect(response.body).toEqual({ error: 'Season not found' });
    } finally {
      db.close();
    }
  });
});

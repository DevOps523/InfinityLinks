// @vitest-environment node

import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { hashPassword } from '../../src/server/auth/passwords.js';
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
  authSecret: 'test-auth-secret-test-auth-secret-123',
  adminEmail: 'admin@example.com',
  publicSearchSyncUrl: 'https://search.example.com/api/sync',
  publicSearchSyncToken: 'secret-token',
  publicSearchGroupHandle: '@infinitylinks69'
};

function createGuardDb(): AppDatabase {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

function seedAuthUser(db: AppDatabase, email: string, role: 'admin' | 'superadmin' = 'admin') {
  db.prepare(
    `INSERT INTO auth_users (email, role, password_hash, must_change_password)
     VALUES (?, ?, ?, 0)`
  ).run(email, role, hashPassword('Password123456'));
}

async function signIn(agent: request.Agent, email = 'admin@example.com') {
  const csrf = await agent.get('/auth/csrf').expect(200);
  const csrfToken = csrf.body.csrfToken;

  await agent
    .post('/auth/callback/credentials')
    .type('form')
    .send({
      csrfToken,
      email,
      password: 'Password123456',
      redirect: 'false',
      json: 'true'
    })
    .expect((response) => {
      expect([200, 302]).toContain(response.status);
    });
}

describe('admin API request guard', () => {
  it('keeps health public while protecting admin API data', async () => {
    const db = createGuardDb();

    try {
      const guardedApp = createApp({ db, config: guardConfig, fetcher: vi.fn<typeof fetch>() });

      await request(guardedApp).get('/api/health').expect(200);

      const response = await request(guardedApp)
        .get('/api/admin/dashboard')
        .set('Host', '127.0.0.1:3000')
        .expect(401);

      expect(response.body).toEqual({ error: 'Authentication required.' });
    } finally {
      db.close();
    }
  });

  it('allows authenticated users to reach existing admin APIs', async () => {
    const db = createGuardDb();
    seedAuthUser(db, 'admin@example.com');

    try {
      const guardedApp = createApp({ db, config: guardConfig, fetcher: vi.fn<typeof fetch>() });
      const agent = request.agent(guardedApp);

      await signIn(agent);

      const response = await agent
        .get('/api/admin/dashboard')
        .set('Host', '127.0.0.1:3000')
        .expect(200);

      expect(response.body.dashboard).toMatchObject({
        movies: 0,
        tvShows: 0
      });
    } finally {
      db.close();
    }
  });

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
    seedAuthUser(db, 'admin@example.com');

    try {
      const guardedApp = createApp({ db, config: guardConfig, fetcher: vi.fn<typeof fetch>() });
      const agent = request.agent(guardedApp);

      await signIn(agent);

      const response = await agent
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

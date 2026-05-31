import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createPublicSearchApp } from '../src/app.js';
import type { PublicSearchConfig } from '../src/config.js';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import { createPublicSearchStatusTracker } from '../src/status-tracker.js';

function createMigratedDatabase() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

function createConfig(overrides: Partial<PublicSearchConfig> = {}): PublicSearchConfig {
  return {
    publicBotToken: 'bot-token',
    publicSearchSyncToken: 'sync-token',
    publicSearchStatusToken: 'status-token',
    publicSearchGroupHandle: '@infinitylinks69',
    publicSearchDatabasePath: ':memory:',
    publicSearchHost: '127.0.0.1',
    publicSearchPort: 3001,
    subscriptionBotToken: 'subscription-bot-token',
    subscriptionGroupChatId: -1003963665033,
    subscriptionAlertThreadId: 46,
    subscriptionAdminContact: '@seinen_illuminatiks',
    subscriptionTrialSearchLimit: 5,
    subscriptionOverdueGraceDays: 1,
    subscriptionAdminToken: 'admin-token',
    googleSheetsSpreadsheetId: 'spreadsheet-id',
    googleSheetsUsersRange: 'Users!A:H',
    googleSheetsHistoryRange: 'History!A:G',
    googleServiceAccountKeyFile: 'C:\\secrets\\public-search-service-account.json',
    ...overrides
  };
}

function createTracker() {
  return createPublicSearchStatusTracker({
    now: () => new Date('2026-05-24T00:00:00.000Z'),
    uptimeSeconds: () => 12
  });
}

describe('public search status endpoint', () => {
  it('returns 401 without a bearer token', async () => {
    const db = createMigratedDatabase();

    try {
      const app = createPublicSearchApp({ db, config: createConfig(), statusTracker: createTracker() });

      const response = await request(app).get('/api/status');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    } finally {
      db.close();
    }
  });

  it('returns 401 with the wrong bearer token', async () => {
    const db = createMigratedDatabase();

    try {
      const app = createPublicSearchApp({ db, config: createConfig(), statusTracker: createTracker() });

      const response = await request(app).get('/api/status').set('Authorization', 'Bearer wrong-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    } finally {
      db.close();
    }
  });

  it('rate limits repeated invalid bearer tokens by client IP', async () => {
    const db = createMigratedDatabase();

    try {
      const app = createPublicSearchApp({ db, config: createConfig(), statusTracker: createTracker() });

      for (let index = 0; index < 10; index += 1) {
        await request(app)
          .get('/api/status')
          .set('Authorization', 'Bearer wrong-token')
          .set('X-Forwarded-For', '198.51.100.10')
          .expect(401);
      }

      const response = await request(app)
        .get('/api/status')
        .set('Authorization', 'Bearer wrong-token')
        .set('X-Forwarded-For', '198.51.100.10');

      expect(response.status).toBe(429);
      expect(Number(response.header['retry-after'])).toBeGreaterThan(0);
      expect(Number(response.header['retry-after'])).toBeLessThanOrEqual(60);
      expect(response.body).toEqual({ error: 'Too many unauthorized status attempts. Please wait and try again.' });

      await request(app)
        .get('/api/status')
        .set('Authorization', 'Bearer wrong-token')
        .set('X-Forwarded-For', '198.51.100.20')
        .expect(401);
    } finally {
      db.close();
    }
  });

  it('does not count correct bearer tokens against the status bad-auth quota', async () => {
    const db = createMigratedDatabase();

    try {
      const app = createPublicSearchApp({ db, config: createConfig(), statusTracker: createTracker() });

      for (let index = 0; index < 11; index += 1) {
        await request(app)
          .get('/api/status')
          .set('Authorization', 'Bearer status-token')
          .set('X-Forwarded-For', '198.51.100.30')
          .expect(200);
      }

      await request(app)
        .get('/api/status')
        .set('Authorization', 'Bearer wrong-token')
        .set('X-Forwarded-For', '198.51.100.30')
        .expect(401);
    } finally {
      db.close();
    }
  });

  it('returns safe OK JSON with the correct bearer token', async () => {
    const db = createMigratedDatabase();

    try {
      const app = createPublicSearchApp({ db, config: createConfig(), statusTracker: createTracker() });

      const response = await request(app).get('/api/status').set('Authorization', 'Bearer status-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        state: 'ok',
        checkedAt: '2026-05-24T00:00:00.000Z',
        uptimeSeconds: 12,
        consecutiveErrorCount: 0,
        lastError: null
      });

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('https://mixdrop.example/movie');
      expect(body).not.toContain('stack line');
      expect(body).not.toContain('status-token');
      expect(body).not.toContain('sync-token');
      expect(body).not.toContain('bot-token');
    } finally {
      db.close();
    }
  });

  it('returns sanitized error JSON after a tracked Telegram polling error', async () => {
    const db = createMigratedDatabase();

    try {
      const tracker = createTracker();
      tracker.recordError('telegram_poll', new Error('Telegram failed\nstack line'));
      const app = createPublicSearchApp({ db, config: createConfig(), statusTracker: tracker });

      const response = await request(app).get('/api/status').set('Authorization', 'Bearer status-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        state: 'error',
        checkedAt: '2026-05-24T00:00:00.000Z',
        uptimeSeconds: 12,
        consecutiveErrorCount: 1,
        lastError: {
          source: 'telegram_poll',
          at: '2026-05-24T00:00:00.000Z',
          message: 'Telegram failed'
        }
      });

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('https://mixdrop.example/movie');
      expect(body).not.toContain('stack line');
      expect(body).not.toContain('status-token');
      expect(body).not.toContain('sync-token');
      expect(body).not.toContain('bot-token');
    } finally {
      db.close();
    }
  });
});

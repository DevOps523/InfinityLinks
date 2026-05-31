// @vitest-environment node

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createPublicSearchApp } from '../../../../../../../apps/public-search-bot/src/app.js';
import type { PublicSearchConfig } from '../../../../../../../apps/public-search-bot/src/config.js';
import { createPublicSearchDatabase } from '../../../../../../../apps/public-search-bot/src/db/database.js';
import { migratePublicSearchDatabase } from '../../../../../../../apps/public-search-bot/src/db/migrate.js';
import { createSubscriptionRouter } from '../../../../../../../apps/public-search-bot/src/subscriptions/routes.js';

const config: PublicSearchConfig = {
  publicBotToken: 'bot-token',
  publicSearchSyncToken: 'sync-token',
  publicSearchStatusToken: 'status-token',
  publicSearchGroupHandle: '@infinitylinks69',
  publicSearchDatabasePath: ':memory:',
  publicSearchHost: '127.0.0.1',
  publicSearchPort: 3001,
  subscriptionBotToken: 'subscription-token',
  subscriptionGroupChatId: -1003963665033,
  subscriptionAlertThreadId: 46,
  subscriptionAdminContact: '@admin',
  subscriptionTrialSearchLimit: 5,
  subscriptionOverdueGraceDays: 1,
  subscriptionAdminToken: 'admin-token',
  googleSheetsSpreadsheetId: 'sheet-id',
  googleSheetsUsersRange: 'Users!A:H',
  googleSheetsHistoryRange: 'History!A:G',
  googleServiceAccountKeyFile: '/secure/google.json'
};

describe('CAND-PSB-002 validation', () => {
  it('does not throttle repeated wrong status bearer tokens', async () => {
    const db = createPublicSearchDatabase(':memory:');
    migratePublicSearchDatabase(db);

    try {
      const app = createPublicSearchApp({ db, config });
      const statuses: number[] = [];

      for (let index = 0; index < 20; index += 1) {
        const response = await request(app).get('/api/status').set('Authorization', `Bearer wrong-${index}`);
        statuses.push(response.status);
      }

      expect(statuses).toEqual(Array.from({ length: 20 }, () => 401));
    } finally {
      db.close();
    }
  });

  it('does not throttle repeated wrong subscription admin bearer tokens', async () => {
    const db = createPublicSearchDatabase(':memory:');
    migratePublicSearchDatabase(db);

    try {
      const subscriptionRouter = createSubscriptionRouter({
        adminToken: config.subscriptionAdminToken,
        syncFromSheet: vi.fn(async () => ({ ok: true })),
        refreshAlert: vi.fn(async () => ({ ok: true }))
      });
      const app = createPublicSearchApp({ db, config, subscriptionRouter });
      const statuses: number[] = [];

      for (let index = 0; index < 20; index += 1) {
        const response = await request(app)
          .post('/api/subscriptions/update')
          .set('Authorization', `Bearer wrong-${index}`);
        statuses.push(response.status);
      }

      expect(statuses).toEqual(Array.from({ length: 20 }, () => 401));
    } finally {
      db.close();
    }
  });
});

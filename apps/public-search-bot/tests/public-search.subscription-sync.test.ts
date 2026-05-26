import { describe, expect, it, vi } from 'vitest';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import { syncSubscriptionsFromSheet, moveKickedUsersToHistory } from '../src/subscriptions/sync.service.js';
import { HISTORY_HEADER, USERS_HEADER } from '../src/subscriptions/sheet.mapper.js';
import { getSubscriptionUser, markSubscriptionUserKicked } from '../src/subscriptions/repository.js';
import { runDailySubscriptionRefresh } from '../src/subscriptions/scheduler.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription sync service', () => {
  it('queues overdue kicks and refreshes alerts during daily refresh', async () => {
    const db = createDb();
    try {
      db.prepare(
        `INSERT INTO subscription_users (
           telegram_user_id, username, subscription_start_date, subscription_end_date, days_remaining,
           status, unpaid_since, removed_from_group, created_at, updated_at
         )
         VALUES (42, 'late_user', '2026-05-26', '2026-06-26', 0, 'Unpaid', '2026-06-26', 0, '2026-05-26T00:00:00.000Z', '2026-06-26T00:00:00.000Z')`
      ).run();

      const result = await runDailySubscriptionRefresh(db, {
        today: '2026-06-27',
        periodDays: 31,
        overdueGraceDays: 1,
        enqueueAt: new Date('2026-06-27T00:00:00.000Z')
      });

      expect(result).toEqual({ queuedKicks: 1 });
      expect(db.prepare('SELECT type, payload_json FROM subscription_jobs').all()).toEqual([
        { type: 'kick-user', payload_json: '{"telegramUserId":42}' },
        { type: 'refresh-alert', payload_json: '{}' },
        { type: 'refresh-sheet', payload_json: '{}' }
      ]);
    } finally {
      db.close();
    }
  });

  it('applies manual start dates and writes refreshed active rows', async () => {
    const db = createDb();
    try {
      db.prepare(
        `INSERT INTO subscription_users (telegram_user_id, username, status, removed_from_group, created_at, updated_at)
         VALUES (42, 'paid_user', 'Unpaid', 0, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z')`
      ).run();
      const sheets = {
        readRows: vi.fn(async () => [USERS_HEADER, ['42', '@paid_user', '2026-05-26', '', '', '', '']]),
        replaceRows: vi.fn(async () => undefined),
        appendRows: vi.fn(async () => undefined)
      };

      const result = await syncSubscriptionsFromSheet(db, sheets, {
        usersRange: 'Users!A:G',
        historyRange: 'History!A:G',
        now: new Date('2026-05-26T00:00:00.000Z'),
        periodDays: 31
      });

      expect(result).toEqual({ updatedUsers: 1, skippedUnknownUsers: 0 });
      expect(sheets.replaceRows).toHaveBeenCalledWith('Users!A:G', [
        USERS_HEADER,
        ['42', '@paid_user', '2026-05-26', '2026-06-26', '31', 'Subscribe', expect.any(String)]
      ]);
    } finally {
      db.close();
    }
  });

  it('skips unknown sheet ids instead of creating paid subscriptions', async () => {
    const db = createDb();
    try {
      const sheets = {
        readRows: vi.fn(async () => [USERS_HEADER, ['99', '@stranger', '2026-05-26', '', '', '', '']]),
        replaceRows: vi.fn(async () => undefined),
        appendRows: vi.fn(async () => undefined)
      };

      await expect(
        syncSubscriptionsFromSheet(db, sheets, {
          usersRange: 'Users!A:G',
          historyRange: 'History!A:G',
          now: new Date('2026-05-26T00:00:00.000Z'),
          periodDays: 31
        })
      ).resolves.toEqual({ updatedUsers: 0, skippedUnknownUsers: 1 });
      expect(sheets.replaceRows).toHaveBeenCalledWith('Users!A:G', [USERS_HEADER]);
    } finally {
      db.close();
    }
  });

  it('moves kicked users to history and refreshes active rows', async () => {
    const db = createDb();
    try {
      db.prepare(
        `INSERT INTO subscription_users (
           telegram_user_id, username, subscription_start_date, subscription_end_date, days_remaining,
           status, removed_from_group, created_at, updated_at
         )
         VALUES
           (42, 'late_user', '2026-05-01', '2026-06-01', 0, 'Unpaid', 0, '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
           (43, 'active_user', '2026-05-26', '2026-06-26', 31, 'Subscribe', 0, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z')`
      ).run();
      const kicked = markSubscriptionUserKicked(db, 42, new Date('2026-06-02T00:00:00.000Z'));
      const sheets = {
        replaceRows: vi.fn(async () => undefined),
        appendRows: vi.fn(async () => undefined)
      };

      await expect(
        moveKickedUsersToHistory(db, sheets, {
          usersRange: 'Users!A:G',
          historyRange: 'History!A:G',
          users: [kicked]
        })
      ).resolves.toEqual({ movedUsers: 1 });

      expect(HISTORY_HEADER).toEqual(['User ID', 'Username', 'Last Status', 'Kicked At', 'Last Start Date', 'Last End Date', 'Notes']);
      expect(sheets.appendRows).toHaveBeenCalledWith('History!A:G', [
        ['42', '@late_user', 'Kicked', '2026-06-02T00:00:00.000Z', '2026-05-01', '2026-06-01', 'Overdue subscription removed']
      ]);
      expect(sheets.replaceRows).toHaveBeenCalledWith('Users!A:G', [
        USERS_HEADER,
        ['43', '@active_user', '2026-05-26', '2026-06-26', '31', 'Subscribe', '2026-05-26T00:00:00.000Z']
      ]);
    } finally {
      db.close();
    }
  });

  it('does not duplicate history rows when retrying after active row refresh fails', async () => {
    const db = createDb();
    try {
      db.prepare(
        `INSERT INTO subscription_users (
           telegram_user_id, username, subscription_start_date, subscription_end_date, days_remaining,
           status, removed_from_group, created_at, updated_at
         )
         VALUES
           (42, 'late_user', '2026-05-01', '2026-06-01', 0, 'Unpaid', 0, '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
           (43, 'active_user', '2026-05-26', '2026-06-26', 31, 'Subscribe', 0, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z')`
      ).run();
      const kicked = markSubscriptionUserKicked(db, 42, new Date('2026-06-02T00:00:00.000Z'));
      const sheets = {
        replaceRows: vi
          .fn()
          .mockRejectedValueOnce(new Error('Users sheet unavailable'))
          .mockResolvedValueOnce(undefined),
        appendRows: vi.fn(async () => undefined)
      };

      await expect(
        moveKickedUsersToHistory(db, sheets, {
          usersRange: 'Users!A:G',
          historyRange: 'History!A:G',
          users: [kicked]
        })
      ).rejects.toThrow(/Users sheet unavailable/);

      expect(sheets.appendRows).toHaveBeenCalledTimes(1);
      expect(getSubscriptionUser(db, 42)?.historyExportedAt).toEqual(expect.any(String));

      await expect(
        moveKickedUsersToHistory(db, sheets, {
          usersRange: 'Users!A:G',
          historyRange: 'History!A:G',
          users: [kicked]
        })
      ).resolves.toEqual({ movedUsers: 0 });

      expect(sheets.appendRows).toHaveBeenCalledTimes(1);
      expect(sheets.replaceRows).toHaveBeenCalledTimes(2);
      expect(sheets.replaceRows).toHaveBeenLastCalledWith('Users!A:G', [
        USERS_HEADER,
        ['43', '@active_user', '2026-05-26', '2026-06-26', '31', 'Subscribe', '2026-05-26T00:00:00.000Z']
      ]);
    } finally {
      db.close();
    }
  });
});

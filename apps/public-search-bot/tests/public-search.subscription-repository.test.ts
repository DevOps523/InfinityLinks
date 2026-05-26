import { describe, expect, it } from 'vitest';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import {
  addDateDays,
  calculateDaysRemaining,
  todayDateString
} from '../src/subscriptions/date.js';
import {
  applySubscriptionStartDate,
  listActiveSubscriptionRows,
  listKickCandidates,
  listUsersNeedingAlert,
  markSubscriptionUserKicked,
  recalculateSubscriptions,
  startTrialIfEligible,
  upsertSeenTelegramUser
} from '../src/subscriptions/repository.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription repository', () => {
  it('uses date-only math for 31-day subscriptions', () => {
    expect(addDateDays('2026-05-26', 31)).toBe('2026-06-26');
    expect(calculateDaysRemaining('2026-06-26', '2026-05-26')).toBe(31);
    expect(calculateDaysRemaining('2026-06-26', '2026-06-25')).toBe(1);
    expect(calculateDaysRemaining('2026-06-26', '2026-06-26')).toBe(0);
    expect(todayDateString(new Date('2026-05-26T16:00:00.000Z'))).toBe('2026-05-26');
    expect(() => addDateDays('2026-02-31', 1)).toThrow(/Invalid date-only value/);
  });

  it('starts one trial once and keeps username keyed by user id', () => {
    const db = createDb();
    try {
      const first = startTrialIfEligible(db, { id: 42, username: 'first_name' }, new Date('2026-05-26T00:00:00.000Z'), 24);
      const second = startTrialIfEligible(db, { id: 42, username: 'new_name' }, new Date('2026-05-26T01:00:00.000Z'), 24);

      expect(first.started).toBe(true);
      expect(second.started).toBe(false);
      expect(second.user).toMatchObject({
        telegramUserId: 42,
        username: 'new_name',
        status: 'Trial',
        trialStartedAt: '2026-05-26T00:00:00.000Z',
        trialExpiresAt: '2026-05-27T00:00:00.000Z'
      });
    } finally {
      db.close();
    }
  });

  it('applies a manual paid start date and recalculates alert statuses', () => {
    const db = createDb();
    try {
      upsertSeenTelegramUser(db, { id: 42, username: 'paid_user' }, new Date('2026-05-26T00:00:00.000Z'));

      const paid = applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), 31);
      expect(paid).toMatchObject({
        subscriptionStartDate: '2026-05-26',
        subscriptionEndDate: '2026-06-26',
        daysRemaining: 31,
        status: 'Subscribe'
      });

      recalculateSubscriptions(db, '2026-06-25', 31);
      expect(listUsersNeedingAlert(db).map((user) => user.telegramUserId)).toEqual([42]);
      expect(listActiveSubscriptionRows(db)[0]).toMatchObject({
        username: 'paid_user',
        daysRemaining: 1,
        status: 'Needs Attention'
      });

      recalculateSubscriptions(db, '2026-06-26', 31);
      expect(listUsersNeedingAlert(db)[0]).toMatchObject({
        telegramUserId: 42,
        status: 'Unpaid',
        unpaidSince: '2026-06-26'
      });
      expect(listKickCandidates(db, '2026-06-27', 1).map((user) => user.telegramUserId)).toEqual([42]);
    } finally {
      db.close();
    }
  });

  it('requires an existing user before applying a paid start date', () => {
    const db = createDb();
    try {
      expect(() => applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), 31)).toThrow(
        /Subscription user 42 does not exist/
      );
    } finally {
      db.close();
    }
  });

  it('rejects invalid paid subscription periods', () => {
    const db = createDb();
    try {
      upsertSeenTelegramUser(db, { id: 42, username: 'paid_user' }, new Date('2026-05-26T00:00:00.000Z'));

      for (const periodDays of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
        expect(() => applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), periodDays)).toThrow(
          /Subscription period days must be a positive integer/
        );
        expect(() => recalculateSubscriptions(db, '2026-06-25', periodDays)).toThrow(
          /Subscription period days must be a positive integer/
        );
      }
    } finally {
      db.close();
    }
  });

  it('rejects invalid recalculation dates before reading subscription rows', () => {
    const db = createDb();
    try {
      expect(() => recalculateSubscriptions(db, '2026-02-31', 31)).toThrow(/Invalid date-only value/);
    } finally {
      db.close();
    }
  });

  it('enforces removed from group as a boolean on fresh migrated databases', () => {
    const db = createDb();
    try {
      expect(() =>
        db
          .prepare(
            `INSERT INTO subscription_users (
               telegram_user_id,
               status,
               removed_from_group,
               created_at,
               updated_at
             )
             VALUES (42, 'Unpaid', 2, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z')`
          )
          .run()
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('rebuilds legacy subscription users tables with the removed from group boolean constraint', () => {
    const db = createPublicSearchDatabase(':memory:');
    try {
      db.exec(`
        CREATE TABLE subscription_users (
          telegram_user_id INTEGER PRIMARY KEY,
          username TEXT,
          trial_started_at TEXT,
          trial_expires_at TEXT,
          subscription_start_date TEXT,
          subscription_end_date TEXT,
          days_remaining INTEGER,
          status TEXT NOT NULL DEFAULT 'Unpaid',
          unpaid_since TEXT,
          kicked_at TEXT,
          removed_from_group INTEGER NOT NULL DEFAULT 0,
          last_seen_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO subscription_users (
          telegram_user_id,
          username,
          status,
          removed_from_group,
          created_at,
          updated_at
        )
        VALUES (42, 'legacy_user', 'Unpaid', 2, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z');
      `);

      migratePublicSearchDatabase(db);

      const row = db
        .prepare('SELECT removed_from_group AS removedFromGroup FROM subscription_users WHERE telegram_user_id = 42')
        .get() as { removedFromGroup: number };

      expect(row.removedFromGroup).toBe(0);
      expect(() =>
        db
          .prepare(
            `INSERT INTO subscription_users (
               telegram_user_id,
               status,
               removed_from_group,
               created_at,
               updated_at
             )
             VALUES (43, 'Unpaid', 2, '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z')`
          )
          .run()
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('marks kicked users without deleting permanent history', () => {
    const db = createDb();
    try {
      upsertSeenTelegramUser(db, { id: 42, username: 'late_user' }, new Date('2026-05-26T00:00:00.000Z'));
      applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), 31);
      recalculateSubscriptions(db, '2026-06-26', 31);

      const kicked = markSubscriptionUserKicked(db, 42, new Date('2026-06-27T00:00:00.000Z'));

      expect(kicked).toMatchObject({
        telegramUserId: 42,
        status: 'Kicked',
        removedFromGroup: true,
        kickedAt: '2026-06-27T00:00:00.000Z'
      });
      expect(startTrialIfEligible(db, { id: 42, username: 'late_user' }, new Date('2026-06-28T00:00:00.000Z'), 24).started).toBe(false);
    } finally {
      db.close();
    }
  });
});

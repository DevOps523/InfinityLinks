import { describe, expect, it } from 'vitest';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import { applySubscriptionStartDate } from '../src/subscriptions/repository.js';
import { evaluateSearchAccess } from '../src/subscriptions/access.service.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription access service', () => {
  it('starts a one-day trial on first search but not on /start', () => {
    const db = createDb();
    try {
      const result = evaluateSearchAccess(db, {
        user: { id: 42, username: 'trial_user' },
        now: new Date('2026-05-26T00:00:00.000Z'),
        trialHours: 24
      });

      expect(result).toMatchObject({ allowed: true, status: 'Trial', trialStarted: true });
    } finally {
      db.close();
    }
  });

  it('blocks expired trial users without resetting the trial', () => {
    const db = createDb();
    try {
      evaluateSearchAccess(db, {
        user: { id: 42, username: 'trial_user' },
        now: new Date('2026-05-26T00:00:00.000Z'),
        trialHours: 24
      });

      const expired = evaluateSearchAccess(db, {
        user: { id: 42, username: 'trial_user' },
        now: new Date('2026-05-27T00:00:01.000Z'),
        trialHours: 24
      });

      expect(expired).toMatchObject({ allowed: false, reason: 'subscription-required', status: 'Trial' });
    } finally {
      db.close();
    }
  });

  it('allows active paid users and blocks kicked users', () => {
    const db = createDb();
    try {
      evaluateSearchAccess(db, {
        user: { id: 42, username: 'paid_user' },
        now: new Date('2026-05-26T00:00:00.000Z'),
        trialHours: 24
      });
      applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), 31);

      expect(
        evaluateSearchAccess(db, {
          user: { id: 42, username: 'paid_user' },
          now: new Date('2026-06-25T00:00:00.000Z'),
          trialHours: 24
        })
      ).toMatchObject({ allowed: true, status: 'Subscribe' });

      db.prepare("UPDATE subscription_users SET status = 'Kicked', removed_from_group = 1 WHERE telegram_user_id = 42").run();

      expect(
        evaluateSearchAccess(db, {
          user: { id: 42, username: 'paid_user' },
          now: new Date('2026-06-25T01:00:00.000Z'),
          trialHours: 24
        })
      ).toMatchObject({ allowed: false, reason: 'subscription-required', status: 'Kicked' });
    } finally {
      db.close();
    }
  });
});

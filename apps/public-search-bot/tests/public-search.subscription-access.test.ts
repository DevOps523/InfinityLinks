import { describe, expect, it } from 'vitest';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import { applySubscriptionStartDate } from '../src/subscriptions/repository.js';
import { consumeSuccessfulSearchAccess, evaluateSearchAccess } from '../src/subscriptions/access.service.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription access service', () => {
  it('starts a search quota trial on first successful search', () => {
    const db = createDb();
    try {
      const result = consumeSuccessfulSearchAccess(db, {
        user: { id: 42, username: 'trial_user' },
        now: new Date('2026-05-26T00:00:00.000Z'),
        trialSearchLimit: 5
      });

      expect(result).toMatchObject({
        allowed: true,
        status: 'Trial',
        trialStarted: true,
        trialSearchesUsed: 1
      });
    } finally {
      db.close();
    }
  });

  it('blocks trial users after the configured successful search limit', () => {
    const db = createDb();
    try {
      for (let index = 0; index < 5; index += 1) {
        expect(
          consumeSuccessfulSearchAccess(db, {
            user: { id: 42, username: 'trial_user' },
            now: new Date(`2026-05-26T00:0${index}:00.000Z`),
            trialSearchLimit: 5
          })
        ).toMatchObject({ allowed: true, status: 'Trial', trialSearchesUsed: index + 1 });
      }

      expect(
        consumeSuccessfulSearchAccess(db, {
          user: { id: 42, username: 'trial_user' },
          now: new Date('2026-05-26T00:06:00.000Z'),
          trialSearchLimit: 5
        })
      ).toMatchObject({ allowed: false, reason: 'subscription-required', status: 'Trial' });
    } finally {
      db.close();
    }
  });

  it('allows active paid users and blocks kicked users', () => {
    const db = createDb();
    try {
      consumeSuccessfulSearchAccess(db, {
        user: { id: 42, username: 'paid_user' },
        now: new Date('2026-05-26T00:00:00.000Z'),
        trialSearchLimit: 5
      });
      applySubscriptionStartDate(db, 42, '2026-05-26', new Date('2026-05-26T00:00:00.000Z'), 31);

      expect(
        consumeSuccessfulSearchAccess(db, {
          user: { id: 42, username: 'paid_user' },
          now: new Date('2026-06-25T00:00:00.000Z'),
          trialSearchLimit: 5
        })
      ).toMatchObject({ allowed: true, status: 'Subscribe' });

      db.prepare("UPDATE subscription_users SET status = 'Kicked', removed_from_group = 1 WHERE telegram_user_id = 42").run();

      expect(
        consumeSuccessfulSearchAccess(db, {
          user: { id: 42, username: 'paid_user' },
          now: new Date('2026-06-25T01:00:00.000Z'),
          trialSearchLimit: 5
        })
      ).toMatchObject({ allowed: false, reason: 'subscription-required', status: 'Kicked' });
    } finally {
      db.close();
    }
  });

  it('allows non-consuming callback access for a trial user at the search limit', () => {
    const db = createDb();
    try {
      for (let index = 0; index < 5; index += 1) {
        consumeSuccessfulSearchAccess(db, {
          user: { id: 42, username: 'trial_user' },
          now: new Date(`2026-05-26T00:0${index}:00.000Z`),
          trialSearchLimit: 5
        });
      }

      expect(
        evaluateSearchAccess(db, {
          user: { id: 42, username: 'trial_user' },
          now: new Date('2026-05-26T00:10:00.000Z'),
          trialSearchLimit: 5
        })
      ).toMatchObject({ allowed: true, status: 'Trial' });
    } finally {
      db.close();
    }
  });
});

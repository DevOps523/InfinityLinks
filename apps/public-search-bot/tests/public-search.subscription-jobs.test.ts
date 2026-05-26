import { describe, expect, it, vi } from 'vitest';
import { TelegramRateLimitError } from '../src/telegram.client.js';
import { createPublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import {
  enqueueSubscriptionJob,
  listSubscriptionJobs,
  claimNextSubscriptionJob,
  markSubscriptionJobSucceeded,
  markSubscriptionJobFailed
} from '../src/subscriptions/job.repository.js';
import { processNextSubscriptionJob } from '../src/subscriptions/job.processor.js';

function createDb() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

describe('subscription jobs', () => {
  it('claims due jobs and records success', () => {
    const db = createDb();
    try {
      const job = enqueueSubscriptionJob(db, 'refresh-alert', {}, new Date('2026-05-26T00:00:00.000Z'));
      expect(claimNextSubscriptionJob(db, new Date('2026-05-26T00:00:01.000Z'))).toMatchObject({
        id: job.id,
        type: 'refresh-alert',
        status: 'running'
      });

      markSubscriptionJobSucceeded(db, job.id, new Date('2026-05-26T00:00:02.000Z'));
      expect(listSubscriptionJobs(db)).toEqual([
        expect.objectContaining({ id: job.id, status: 'succeeded' })
      ]);
    } finally {
      db.close();
    }
  });

  it('backs off rate limited jobs using retry_after', async () => {
    const db = createDb();
    try {
      enqueueSubscriptionJob(db, 'kick-user', { telegramUserId: 42 }, new Date('2026-05-26T00:00:00.000Z'));
      const handlers = {
        kickUser: vi.fn(async () => {
          throw new TelegramRateLimitError('Too Many Requests', 12);
        }),
        refreshAlert: vi.fn(),
        refreshSheet: vi.fn()
      };

      await expect(processNextSubscriptionJob(db, handlers, new Date('2026-05-26T00:00:01.000Z'))).resolves.toBe(true);

      expect(listSubscriptionJobs(db)[0]).toMatchObject({
        status: 'pending',
        attempts: 1,
        runAfter: '2026-05-26T00:00:13.000Z',
        lastError: 'Too Many Requests'
      });
    } finally {
      db.close();
    }
  });
});

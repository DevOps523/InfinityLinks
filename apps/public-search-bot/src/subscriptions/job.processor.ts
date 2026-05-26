import type { PublicSearchDatabase } from '../db/database.js';
import { TelegramRateLimitError } from '../telegram.client.js';
import {
  claimNextSubscriptionJob,
  markSubscriptionJobFailed,
  markSubscriptionJobSucceeded,
  type SubscriptionJob
} from './job.repository.js';

export type SubscriptionJobHandlers = {
  refreshAlert: () => Promise<void>;
  refreshSheet: () => Promise<void>;
  kickUser: (telegramUserId: number) => Promise<void>;
};

function retryAfterFor(error: unknown, attempts: number, now: Date) {
  if (error instanceof TelegramRateLimitError) {
    return new Date(now.getTime() + error.retryAfter * 1000);
  }

  const backoffSeconds = Math.min(300, Math.max(5, 5 * 2 ** attempts));
  return new Date(now.getTime() + backoffSeconds * 1000);
}

async function executeJob(job: SubscriptionJob, handlers: SubscriptionJobHandlers) {
  if (job.type === 'refresh-alert') {
    await handlers.refreshAlert();
    return;
  }

  if (job.type === 'refresh-sheet') {
    await handlers.refreshSheet();
    return;
  }

  const telegramUserId = job.payload.telegramUserId;
  if (typeof telegramUserId !== 'number') {
    throw new Error('kick-user job is missing numeric telegramUserId');
  }
  await handlers.kickUser(telegramUserId);
}

export async function processNextSubscriptionJob(
  db: PublicSearchDatabase,
  handlers: SubscriptionJobHandlers,
  now: Date = new Date()
) {
  const job = claimNextSubscriptionJob(db, now);
  if (!job) {
    return false;
  }

  try {
    await executeJob(job, handlers);
    markSubscriptionJobSucceeded(db, job.id, now);
  } catch (error) {
    markSubscriptionJobFailed(db, job.id, error, retryAfterFor(error, job.attempts, now), now);
  }

  return true;
}

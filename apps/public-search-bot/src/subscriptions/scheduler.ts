import type { PublicSearchDatabase } from '../db/database.js';
import { todayDateString } from './date.js';
import { enqueueSubscriptionJob } from './job.repository.js';
import { listKickCandidates, recalculateSubscriptions } from './repository.js';

export type DailySubscriptionRefreshOptions = {
  today: string;
  periodDays: number;
  overdueGraceDays: number;
  enqueueAt: Date;
};

export type StartDailySubscriptionRefreshLoopOptions = {
  run: () => Promise<void>;
  intervalMs?: number | undefined;
};

export async function runDailySubscriptionRefresh(
  db: PublicSearchDatabase,
  options: DailySubscriptionRefreshOptions
) {
  recalculateSubscriptions(db, options.today, options.periodDays);
  const kickCandidates = listKickCandidates(db, options.today, options.overdueGraceDays);

  for (const user of kickCandidates) {
    enqueueSubscriptionJob(db, 'kick-user', { telegramUserId: user.telegramUserId }, options.enqueueAt);
  }
  enqueueSubscriptionJob(db, 'refresh-alert', {}, options.enqueueAt);
  enqueueSubscriptionJob(db, 'refresh-sheet', {}, options.enqueueAt);

  return { queuedKicks: kickCandidates.length };
}

export function startDailySubscriptionRefreshLoop(input: StartDailySubscriptionRefreshLoopOptions) {
  const intervalMs = input.intervalMs ?? 60 * 60 * 1000;
  void input.run();

  return setInterval(() => {
    void input.run();
  }, intervalMs);
}

export function createDailySubscriptionRefreshRun(input: {
  db: PublicSearchDatabase;
  periodDays: number;
  overdueGraceDays: number;
  now?: (() => Date) | undefined;
}) {
  const now = input.now ?? (() => new Date());

  return () => {
    const enqueueAt = now();
    return runDailySubscriptionRefresh(input.db, {
      today: todayDateString(enqueueAt),
      periodDays: input.periodDays,
      overdueGraceDays: input.overdueGraceDays,
      enqueueAt
    });
  };
}

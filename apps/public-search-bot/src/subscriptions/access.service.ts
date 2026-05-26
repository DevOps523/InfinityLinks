import type { PublicSearchDatabase } from '../db/database.js';
import type { SubscriptionStatus, TelegramUserIdentity } from './repository.js';
import { getSubscriptionUser, startTrialIfEligible, upsertSeenTelegramUser } from './repository.js';

export type SearchAccessResult =
  | { allowed: true; status: SubscriptionStatus; trialStarted: boolean }
  | {
      allowed: false;
      reason: 'subscription-required';
      status?: SubscriptionStatus | undefined;
      trialStarted: false;
    };

export function evaluateSearchAccess(
  db: PublicSearchDatabase,
  input: {
    user: TelegramUserIdentity | undefined;
    now: Date;
    trialHours: number;
  }
): SearchAccessResult {
  if (!input.user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  const trialHours = validateTrialHours(input.trialHours);
  upsertSeenTelegramUser(db, input.user, input.now);
  const trial = startTrialIfEligible(db, input.user, input.now, trialHours);
  const user = getSubscriptionUser(db, input.user.id);

  if (!user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  if (user.status === 'Kicked' || user.removedFromGroup) {
    return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
  }

  if (user.status === 'Subscribe' || user.status === 'Needs Attention') {
    return { allowed: true, status: user.status, trialStarted: false };
  }

  if (user.status === 'Trial' && user.trialExpiresAt && input.now.getTime() <= Date.parse(user.trialExpiresAt)) {
    return { allowed: true, status: 'Trial', trialStarted: trial.started };
  }

  return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
}

function validateTrialHours(trialHours: number) {
  if (!Number.isInteger(trialHours) || trialHours <= 0) {
    throw new Error('trialHours must be a positive integer');
  }

  return trialHours;
}

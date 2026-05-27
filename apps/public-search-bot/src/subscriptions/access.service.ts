import type { PublicSearchDatabase } from '../db/database.js';
import type { SubscriptionStatus, TelegramUserIdentity } from './repository.js';
import {
  consumeTrialSearchIfAllowed,
  getSubscriptionUser,
  startTrialIfEligible,
  upsertSeenTelegramUser,
  validateTrialSearchLimit
} from './repository.js';

export type SearchAccessResult =
  | {
      allowed: true;
      status: SubscriptionStatus;
      trialStarted: boolean;
      trialSearchesUsed?: number | undefined;
    }
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
    trialSearchLimit: number;
  }
): SearchAccessResult {
  if (!input.user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  validateTrialSearchLimit(input.trialSearchLimit);
  upsertSeenTelegramUser(db, input.user, input.now);
  const user = getSubscriptionUser(db, input.user.id);

  return evaluateExistingUser(user);
}

export function consumeSuccessfulSearchAccess(
  db: PublicSearchDatabase,
  input: {
    user: TelegramUserIdentity | undefined;
    now: Date;
    trialSearchLimit: number;
  }
): SearchAccessResult {
  if (!input.user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  validateTrialSearchLimit(input.trialSearchLimit);
  upsertSeenTelegramUser(db, input.user, input.now);
  const trial = startTrialIfEligible(db, input.user, input.now);
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

  if (user.status === 'Trial') {
    const consumed = consumeTrialSearchIfAllowed(db, input.user.id, input.now, input.trialSearchLimit);
    if (consumed) {
      return {
        allowed: true,
        status: 'Trial',
        trialStarted: trial.started,
        trialSearchesUsed: consumed.trialSearchesUsed
      };
    }

    return { allowed: false, reason: 'subscription-required', status: 'Trial', trialStarted: false };
  }

  return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
}

function evaluateExistingUser(user: ReturnType<typeof getSubscriptionUser>): SearchAccessResult {
  if (!user) {
    return { allowed: false, reason: 'subscription-required', trialStarted: false };
  }

  if (user.status === 'Kicked' || user.removedFromGroup) {
    return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
  }

  if (user.status === 'Subscribe' || user.status === 'Needs Attention') {
    return { allowed: true, status: user.status, trialStarted: false };
  }

  if (user.status === 'Trial') {
    return {
      allowed: true,
      status: 'Trial',
      trialStarted: false,
      trialSearchesUsed: user.trialSearchesUsed
    };
  }

  return { allowed: false, reason: 'subscription-required', status: user.status, trialStarted: false };
}

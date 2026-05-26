import { describe, expect, it, vi } from 'vitest';
import { evaluateSearchAccess } from '../src/subscriptions/access.service.js';
import {
  getSubscriptionUser,
  startTrialIfEligible,
  upsertSeenTelegramUser
} from '../src/subscriptions/repository.js';

vi.mock('../src/subscriptions/repository.js', () => ({
  getSubscriptionUser: vi.fn(),
  startTrialIfEligible: vi.fn(),
  upsertSeenTelegramUser: vi.fn()
}));

describe('subscription access username refresh', () => {
  it('refreshes usernames from public bot interactions', () => {
    const db = {};
    const now = new Date('2026-05-26T00:00:00.000Z');
    vi.mocked(startTrialIfEligible).mockReturnValue({
      started: false,
      user: {
        telegramUserId: 42,
        username: 'new_name',
        status: 'Subscribe',
        removedFromGroup: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      }
    });
    vi.mocked(getSubscriptionUser).mockReturnValue({
      telegramUserId: 42,
      username: 'new_name',
      status: 'Subscribe',
      removedFromGroup: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });

    expect(
      evaluateSearchAccess(db as never, {
        user: { id: 42, username: 'new_name' },
        now,
        trialHours: 24
      })
    ).toMatchObject({ allowed: true, status: 'Subscribe' });

    expect(upsertSeenTelegramUser).toHaveBeenCalledWith(db, { id: 42, username: 'new_name' }, now);
  });
});

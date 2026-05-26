import type { PublicSearchDatabase } from '../db/database.js';
import { addDateDays, calculateDaysRemaining, dateDifferenceDays, todayDateString } from './date.js';

export type SubscriptionStatus = 'Trial' | 'Subscribe' | 'Needs Attention' | 'Unpaid' | 'Kicked';

export type TelegramUserIdentity = {
  id: number;
  username?: string | undefined;
};

export type SubscriptionUser = {
  telegramUserId: number;
  username?: string | undefined;
  trialStartedAt?: string | undefined;
  trialExpiresAt?: string | undefined;
  subscriptionStartDate?: string | undefined;
  subscriptionEndDate?: string | undefined;
  daysRemaining?: number | undefined;
  status: SubscriptionStatus;
  unpaidSince?: string | undefined;
  kickedAt?: string | undefined;
  removedFromGroup: boolean;
  lastSeenAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

type SubscriptionUserRow = {
  telegramUserId: number;
  username: string | null;
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  daysRemaining: number | null;
  status: SubscriptionStatus;
  unpaidSince: string | null;
  kickedAt: string | null;
  removedFromGroup: number;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function getSubscriptionUser(db: PublicSearchDatabase, telegramUserId: number): SubscriptionUser | undefined {
  const row = db
    .prepare(
      `SELECT
         telegram_user_id AS telegramUserId,
         username,
         trial_started_at AS trialStartedAt,
         trial_expires_at AS trialExpiresAt,
         subscription_start_date AS subscriptionStartDate,
         subscription_end_date AS subscriptionEndDate,
         days_remaining AS daysRemaining,
         status,
         unpaid_since AS unpaidSince,
         kicked_at AS kickedAt,
         removed_from_group AS removedFromGroup,
         last_seen_at AS lastSeenAt,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM subscription_users
       WHERE telegram_user_id = ?`
    )
    .get(telegramUserId) as SubscriptionUserRow | undefined;

  return row ? mapSubscriptionUser(row) : undefined;
}

export function upsertSeenTelegramUser(
  db: PublicSearchDatabase,
  identity: TelegramUserIdentity,
  now: Date
): SubscriptionUser {
  const nowIso = now.toISOString();

  db.prepare(
    `INSERT INTO subscription_users (
       telegram_user_id,
       username,
       status,
       removed_from_group,
       last_seen_at,
       created_at,
       updated_at
     )
     VALUES (@telegramUserId, @username, 'Unpaid', 0, @nowIso, @nowIso, @nowIso)
     ON CONFLICT(telegram_user_id) DO UPDATE SET
       username = excluded.username,
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`
  ).run({
    telegramUserId: identity.id,
    username: identity.username ?? null,
    nowIso
  });

  return requireSubscriptionUser(db, identity.id);
}

export function startTrialIfEligible(
  db: PublicSearchDatabase,
  identity: TelegramUserIdentity,
  now: Date,
  trialHours: number
): { started: boolean; user: SubscriptionUser } {
  const trial = db.transaction(() => {
    const existing = upsertSeenTelegramUser(db, identity, now);

    if (existing.trialStartedAt || existing.subscriptionStartDate || existing.status === 'Kicked') {
      return { started: false, user: existing };
    }

    const trialStartedAt = now.toISOString();
    const trialExpiresAt = new Date(now.getTime() + trialHours * 60 * 60 * 1000).toISOString();

    db.prepare(
      `UPDATE subscription_users
       SET trial_started_at = @trialStartedAt,
           trial_expires_at = @trialExpiresAt,
           status = 'Trial',
           updated_at = @trialStartedAt
       WHERE telegram_user_id = @telegramUserId`
    ).run({
      telegramUserId: identity.id,
      trialStartedAt,
      trialExpiresAt
    });

    return { started: true, user: requireSubscriptionUser(db, identity.id) };
  });

  return trial();
}

export function applySubscriptionStartDate(
  db: PublicSearchDatabase,
  telegramUserId: number,
  startDate: string,
  now: Date,
  periodDays: number
): SubscriptionUser {
  validateSubscriptionPeriodDays(periodDays);

  const nowIso = now.toISOString();
  const endDate = addDateDays(startDate, periodDays);
  const daysRemaining = calculateDaysRemaining(endDate, todayDateString(now));
  const status = statusForDaysRemaining(daysRemaining);
  const unpaidSince = status === 'Unpaid' ? todayDateString(now) : null;

  const result = db.prepare(
    `UPDATE subscription_users
     SET subscription_start_date = @subscriptionStartDate,
         subscription_end_date = @subscriptionEndDate,
         days_remaining = @daysRemaining,
         status = @status,
         unpaid_since = @unpaidSince,
         kicked_at = NULL,
         removed_from_group = 0,
         updated_at = @nowIso
     WHERE telegram_user_id = @telegramUserId`
  ).run({
    telegramUserId,
    subscriptionStartDate: startDate,
    subscriptionEndDate: endDate,
    daysRemaining,
    status,
    unpaidSince,
    nowIso
  });

  if (result.changes !== 1) {
    throw new Error(`Subscription user ${telegramUserId} does not exist`);
  }

  return requireSubscriptionUser(db, telegramUserId);
}

export function recalculateSubscriptions(db: PublicSearchDatabase, today: string, periodDays: number): void {
  validateSubscriptionPeriodDays(periodDays);

  const updatedAt = `${today}T00:00:00.000Z`;
  const rows = db
    .prepare(
      `SELECT telegram_user_id AS telegramUserId, subscription_start_date AS subscriptionStartDate, unpaid_since AS unpaidSince
       FROM subscription_users
       WHERE status != 'Kicked'
         AND subscription_start_date IS NOT NULL`
    )
    .all() as Array<{ telegramUserId: number; subscriptionStartDate: string; unpaidSince: string | null }>;

  const update = db.prepare(
    `UPDATE subscription_users
     SET subscription_end_date = @subscriptionEndDate,
         days_remaining = @daysRemaining,
         status = @status,
         unpaid_since = @unpaidSince,
         updated_at = @updatedAt
     WHERE telegram_user_id = @telegramUserId`
  );

  const updateAll = db.transaction(() => {
    for (const row of rows) {
      const subscriptionEndDate = addDateDays(row.subscriptionStartDate, periodDays);
      const daysRemaining = calculateDaysRemaining(subscriptionEndDate, today);
      const status = statusForDaysRemaining(daysRemaining);

      update.run({
        telegramUserId: row.telegramUserId,
        subscriptionEndDate,
        daysRemaining,
        status,
        unpaidSince: status === 'Unpaid' ? row.unpaidSince ?? today : null,
        updatedAt
      });
    }
  });

  updateAll();
}

export function listUsersNeedingAlert(db: PublicSearchDatabase): SubscriptionUser[] {
  return listSubscriptionUsers(
    db,
    `WHERE removed_from_group = 0
       AND status IN ('Needs Attention', 'Unpaid')
     ORDER BY telegram_user_id`
  );
}

export function listKickCandidates(db: PublicSearchDatabase, today: string, graceDays: number): SubscriptionUser[] {
  return listSubscriptionUsers(
    db,
    `WHERE removed_from_group = 0
       AND status = 'Unpaid'
       AND unpaid_since IS NOT NULL
     ORDER BY telegram_user_id`
  ).filter((user) => user.unpaidSince && dateDifferenceDays(user.unpaidSince, today) >= graceDays);
}

export function markSubscriptionUserKicked(
  db: PublicSearchDatabase,
  telegramUserId: number,
  now: Date
): SubscriptionUser {
  const nowIso = now.toISOString();

  db.prepare(
    `UPDATE subscription_users
     SET status = 'Kicked',
         kicked_at = @nowIso,
         removed_from_group = 1,
         updated_at = @nowIso
     WHERE telegram_user_id = @telegramUserId`
  ).run({
    telegramUserId,
    nowIso
  });

  return requireSubscriptionUser(db, telegramUserId);
}

export function listActiveSubscriptionRows(db: PublicSearchDatabase): SubscriptionUser[] {
  return listSubscriptionUsers(
    db,
    `WHERE status != 'Kicked'
     ORDER BY telegram_user_id`
  );
}

function listSubscriptionUsers(db: PublicSearchDatabase, whereClause: string): SubscriptionUser[] {
  const rows = db
    .prepare(
      `SELECT
         telegram_user_id AS telegramUserId,
         username,
         trial_started_at AS trialStartedAt,
         trial_expires_at AS trialExpiresAt,
         subscription_start_date AS subscriptionStartDate,
         subscription_end_date AS subscriptionEndDate,
         days_remaining AS daysRemaining,
         status,
         unpaid_since AS unpaidSince,
         kicked_at AS kickedAt,
         removed_from_group AS removedFromGroup,
         last_seen_at AS lastSeenAt,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM subscription_users
       ${whereClause}`
    )
    .all() as SubscriptionUserRow[];

  return rows.map(mapSubscriptionUser);
}

function requireSubscriptionUser(db: PublicSearchDatabase, telegramUserId: number): SubscriptionUser {
  const user = getSubscriptionUser(db, telegramUserId);

  if (!user) {
    throw new Error(`Subscription user not found: ${telegramUserId}`);
  }

  return user;
}

function statusForDaysRemaining(daysRemaining: number): SubscriptionStatus {
  if (daysRemaining >= 2) {
    return 'Subscribe';
  }

  if (daysRemaining === 1) {
    return 'Needs Attention';
  }

  return 'Unpaid';
}

function validateSubscriptionPeriodDays(periodDays: number) {
  if (!Number.isInteger(periodDays) || periodDays <= 0) {
    throw new Error('Subscription period days must be a positive integer');
  }
}

function mapSubscriptionUser(row: SubscriptionUserRow): SubscriptionUser {
  return {
    telegramUserId: row.telegramUserId,
    username: row.username ?? undefined,
    trialStartedAt: row.trialStartedAt ?? undefined,
    trialExpiresAt: row.trialExpiresAt ?? undefined,
    subscriptionStartDate: row.subscriptionStartDate ?? undefined,
    subscriptionEndDate: row.subscriptionEndDate ?? undefined,
    daysRemaining: row.daysRemaining ?? undefined,
    status: row.status,
    unpaidSince: row.unpaidSince ?? undefined,
    kickedAt: row.kickedAt ?? undefined,
    removedFromGroup: Boolean(row.removedFromGroup),
    lastSeenAt: row.lastSeenAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

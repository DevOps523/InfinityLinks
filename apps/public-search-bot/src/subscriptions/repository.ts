import type { PublicSearchDatabase } from '../db/database.js';
import { addDateDays, calculateDaysRemaining, dateDifferenceDays, todayDateString, validateDateOnly } from './date.js';

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
  historyExportedAt?: string | undefined;
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
  historyExportedAt: string | null;
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
         history_exported_at AS historyExportedAt,
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
  const current = getSubscriptionUser(db, telegramUserId);

  if (!current) {
    throw new Error(`Subscription user ${telegramUserId} does not exist`);
  }

  const nowIso = now.toISOString();
  const endDate = addDateDays(startDate, periodDays);
  const daysRemaining = calculateDaysRemaining(endDate, todayDateString(now));
  const calculatedStatus = statusForDaysRemaining(daysRemaining);
  const hasActivePaidAccess = isActivePaidStatus(calculatedStatus);
  const preserveRemovedState = !hasActivePaidAccess && (current.status === 'Kicked' || current.removedFromGroup);
  const status = preserveRemovedState ? 'Kicked' : calculatedStatus;
  const unpaidSince = hasActivePaidAccess ? null : current.unpaidSince ?? todayDateString(now);
  const kickedAt = current.kickedAt ?? null;
  const historyExportedAt = current.historyExportedAt ?? null;
  const removedFromGroup = current.removedFromGroup || preserveRemovedState ? 1 : 0;

  const result = db.prepare(
    `UPDATE subscription_users
     SET subscription_start_date = @subscriptionStartDate,
         subscription_end_date = @subscriptionEndDate,
         days_remaining = @daysRemaining,
         status = @status,
         unpaid_since = @unpaidSince,
         kicked_at = @kickedAt,
         history_exported_at = @historyExportedAt,
         removed_from_group = @removedFromGroup,
         updated_at = @nowIso
     WHERE telegram_user_id = @telegramUserId`
  ).run({
    telegramUserId,
    subscriptionStartDate: startDate,
    subscriptionEndDate: endDate,
    daysRemaining,
    status,
    unpaidSince,
    kickedAt,
    historyExportedAt,
    removedFromGroup,
    nowIso
  });

  if (result.changes !== 1) {
    throw new Error(`Subscription user ${telegramUserId} does not exist`);
  }

  return requireSubscriptionUser(db, telegramUserId);
}

export function markSubscriptionUserUnbanned(
  db: PublicSearchDatabase,
  telegramUserId: number,
  now: Date
): SubscriptionUser | undefined {
  const nowIso = now.toISOString();
  const result = db
    .prepare(
      `UPDATE subscription_users
       SET removed_from_group = 0,
           kicked_at = NULL,
           history_exported_at = NULL,
           updated_at = @nowIso
       WHERE telegram_user_id = @telegramUserId
         AND removed_from_group = 1
         AND status IN ('Subscribe', 'Needs Attention')`
    )
    .run({
      telegramUserId,
      nowIso
    });

  return result.changes === 1 ? requireSubscriptionUser(db, telegramUserId) : undefined;
}

export function recalculateSubscriptions(db: PublicSearchDatabase, today: string, periodDays: number): void {
  validateDateOnly(today);
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

export function isKickStillDue(
  db: PublicSearchDatabase,
  telegramUserId: number,
  today: string,
  graceDays: number
): boolean {
  validateDateOnly(today);
  const user = getSubscriptionUser(db, telegramUserId);

  return Boolean(
    user &&
      user.status === 'Unpaid' &&
      !user.removedFromGroup &&
      user.unpaidSince &&
      dateDifferenceDays(user.unpaidSince, today) >= graceDays
  );
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

export function markSubscriptionUserKickedIfStillDue(
  db: PublicSearchDatabase,
  telegramUserId: number,
  now: Date,
  today: string,
  graceDays: number
): SubscriptionUser | undefined {
  validateDateOnly(today);
  const current = getSubscriptionUser(db, telegramUserId);
  if (
    !current ||
    current.status !== 'Unpaid' ||
    current.removedFromGroup ||
    !current.unpaidSince ||
    dateDifferenceDays(current.unpaidSince, today) < graceDays
  ) {
    return undefined;
  }

  const nowIso = now.toISOString();
  const result = db
    .prepare(
      `UPDATE subscription_users
       SET status = 'Kicked',
           kicked_at = @nowIso,
           removed_from_group = 1,
           updated_at = @nowIso
       WHERE telegram_user_id = @telegramUserId
         AND status = 'Unpaid'
         AND removed_from_group = 0
         AND unpaid_since = @unpaidSince`
    )
    .run({
      telegramUserId,
      unpaidSince: current.unpaidSince,
      nowIso
    });

  return result.changes === 1 ? requireSubscriptionUser(db, telegramUserId) : undefined;
}

export function listActiveSubscriptionRows(db: PublicSearchDatabase): SubscriptionUser[] {
  return listSubscriptionUsers(
    db,
    `WHERE status != 'Kicked'
     ORDER BY telegram_user_id`
  );
}

export function listKickedUsersPendingHistoryExport(
  db: PublicSearchDatabase,
  telegramUserIds: number[]
): SubscriptionUser[] {
  if (telegramUserIds.length === 0) {
    return [];
  }

  const placeholders = telegramUserIds.map(() => '?').join(', ');
  return listSubscriptionUsers(
    db,
    `WHERE status = 'Kicked'
       AND history_exported_at IS NULL
       AND telegram_user_id IN (${placeholders})
     ORDER BY telegram_user_id`,
    telegramUserIds
  );
}

export function markSubscriptionUsersHistoryExported(
  db: PublicSearchDatabase,
  telegramUserIds: number[],
  now: Date
): number {
  if (telegramUserIds.length === 0) {
    return 0;
  }

  const placeholders = telegramUserIds.map(() => '?').join(', ');
  const nowIso = now.toISOString();
  const result = db.prepare(
    `UPDATE subscription_users
     SET history_exported_at = ?,
         updated_at = ?
     WHERE status = 'Kicked'
       AND history_exported_at IS NULL
       AND telegram_user_id IN (${placeholders})`
  ).run(nowIso, nowIso, ...telegramUserIds);

  return result.changes;
}

function listSubscriptionUsers(db: PublicSearchDatabase, whereClause: string, params: unknown[] = []): SubscriptionUser[] {
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
         history_exported_at AS historyExportedAt,
         removed_from_group AS removedFromGroup,
         last_seen_at AS lastSeenAt,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM subscription_users
       ${whereClause}`
    )
    .all(...params) as SubscriptionUserRow[];

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

function isActivePaidStatus(status: SubscriptionStatus) {
  return status === 'Subscribe' || status === 'Needs Attention';
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
    historyExportedAt: row.historyExportedAt ?? undefined,
    removedFromGroup: Boolean(row.removedFromGroup),
    lastSeenAt: row.lastSeenAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

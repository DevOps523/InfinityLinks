import { validateDateOnly } from './date.js';
import type { SubscriptionStatus, SubscriptionUser } from './repository.js';

export const USERS_HEADER = ['User ID', 'Username', 'Start Date', 'End Date', 'Days Remaining', 'Status', 'Last Updated'];
export const HISTORY_HEADER = ['User ID', 'Username', 'Last Status', 'Kicked At', 'Last Start Date', 'Last End Date', 'Notes'];

const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'Trial',
  'Subscribe',
  'Needs Attention',
  'Unpaid',
  'Kicked'
];

export type ParsedUsersSheetRow = {
  telegramUserId: number;
  username?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  daysRemaining?: number | undefined;
  status?: SubscriptionStatus | undefined;
  lastUpdated?: string | undefined;
};

type SheetCell = unknown;

function normalizeString(value: SheetCell) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeUsername(value: SheetCell) {
  const trimmed = normalizeString(value);
  return trimmed ? trimmed.replace(/^@+/, '') : undefined;
}

function normalizeDateOnly(value: SheetCell, columnName: string) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return undefined;
  }

  validateDateOnly(trimmed);
  return trimmed;
}

function normalizeDaysRemaining(value: SheetCell) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return undefined;
  }

  const daysRemaining = Number(trimmed);
  if (!Number.isInteger(daysRemaining) || daysRemaining < 0) {
    throw new Error(`Invalid Days Remaining value: ${trimmed}`);
  }

  return daysRemaining;
}

function normalizeStatus(value: SheetCell) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return undefined;
  }

  const status = SUBSCRIPTION_STATUSES.find((candidate) => candidate.toLowerCase() === trimmed.toLowerCase());
  if (!status) {
    throw new Error(`Invalid subscription status: ${trimmed}`);
  }

  return status;
}

function normalizeLastUpdated(value: SheetCell) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return undefined;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid Last Updated value: ${trimmed}`);
  }

  return trimmed;
}

function usernameCell(user: SubscriptionUser) {
  return user.username ? `@${user.username.replace(/^@+/, '')}` : '';
}

export function parseUsersSheetRows(rows: SheetCell[][]): ParsedUsersSheetRow[] {
  return rows.slice(1).flatMap((row) => {
    const telegramUserId = Number(normalizeString(row[0]));
    if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
      return [];
    }

    return [
      {
        telegramUserId,
        username: normalizeUsername(row[1]),
        startDate: normalizeDateOnly(row[2], 'Start Date'),
        endDate: normalizeDateOnly(row[3], 'End Date'),
        daysRemaining: normalizeDaysRemaining(row[4]),
        status: normalizeStatus(row[5]),
        lastUpdated: normalizeLastUpdated(row[6])
      }
    ];
  });
}

export function toUsersSheetRows(users: SubscriptionUser[]) {
  return [
    USERS_HEADER,
    ...users.map((user) => [
      String(user.telegramUserId),
      usernameCell(user),
      user.subscriptionStartDate ?? '',
      user.subscriptionEndDate ?? '',
      user.daysRemaining === undefined ? '' : String(user.daysRemaining),
      user.status,
      user.updatedAt
    ])
  ];
}

export function toHistorySheetRow(user: SubscriptionUser) {
  return [
    String(user.telegramUserId),
    usernameCell(user),
    user.status,
    user.kickedAt ?? '',
    user.subscriptionStartDate ?? '',
    user.subscriptionEndDate ?? '',
    'Overdue subscription removed'
  ];
}

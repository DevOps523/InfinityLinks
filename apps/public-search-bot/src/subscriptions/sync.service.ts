import type { PublicSearchDatabase } from '../db/database.js';
import type { GoogleSheetsClient } from './google-sheets.client.js';
import {
  applySubscriptionStartDate,
  getSubscriptionUser,
  listActiveSubscriptionRows,
  recalculateSubscriptions,
  type SubscriptionUser
} from './repository.js';
import { todayDateString } from './date.js';
import { parseUsersSheetRows, toHistorySheetRow, toUsersSheetRows } from './sheet.mapper.js';

type SyncSheetsClient = Pick<GoogleSheetsClient, 'readRows' | 'replaceRows' | 'appendRows'>;

export type SyncSubscriptionsFromSheetOptions = {
  usersRange: string;
  historyRange: string;
  now: Date;
  periodDays: number;
};

export type SyncSubscriptionsFromSheetResult = {
  updatedUsers: number;
  skippedUnknownUsers: number;
};

export async function syncSubscriptionsFromSheet(
  db: PublicSearchDatabase,
  sheets: SyncSheetsClient,
  options: SyncSubscriptionsFromSheetOptions
): Promise<SyncSubscriptionsFromSheetResult> {
  const rows = await sheets.readRows(options.usersRange);
  const parsedRows = parseUsersSheetRows(rows);
  let updatedUsers = 0;
  let skippedUnknownUsers = 0;

  for (const row of parsedRows) {
    if (!row.startDate) {
      continue;
    }

    const current = getSubscriptionUser(db, row.telegramUserId);
    if (!current) {
      skippedUnknownUsers += 1;
      continue;
    }

    if (current.subscriptionStartDate === row.startDate) {
      continue;
    }

    applySubscriptionStartDate(db, row.telegramUserId, row.startDate, options.now, options.periodDays);
    updatedUsers += 1;
  }

  recalculateSubscriptions(db, todayDateString(options.now), options.periodDays);
  await sheets.replaceRows(options.usersRange, toUsersSheetRows(listActiveSubscriptionRows(db)));

  return { updatedUsers, skippedUnknownUsers };
}

export async function moveKickedUsersToHistory(
  db: PublicSearchDatabase,
  sheets: Pick<GoogleSheetsClient, 'replaceRows' | 'appendRows'>,
  options: {
    usersRange: string;
    historyRange: string;
    users: SubscriptionUser[];
  }
) {
  if (options.users.length > 0) {
    await sheets.appendRows(options.historyRange, options.users.map(toHistorySheetRow));
  }

  await sheets.replaceRows(options.usersRange, toUsersSheetRows(listActiveSubscriptionRows(db)));
  return { movedUsers: options.users.length };
}

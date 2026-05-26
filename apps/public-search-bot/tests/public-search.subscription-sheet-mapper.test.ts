import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_HEADER,
  USERS_HEADER,
  parseUsersSheetRows,
  toHistorySheetRow,
  toUsersSheetRows
} from '../src/subscriptions/sheet.mapper.js';
import { createGoogleSheetsClient } from '../src/subscriptions/google-sheets.client.js';

const googleApiMock = vi.hoisted(() => {
  const get = vi.fn();
  const clear = vi.fn();
  const update = vi.fn();
  const append = vi.fn();
  const sheets = vi.fn(() => ({
    spreadsheets: {
      values: {
        clear,
        get,
        update,
        append
      }
    }
  }));
  const GoogleAuth = vi.fn();

  return { append, clear, get, GoogleAuth, sheets, update };
});

vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: googleApiMock.GoogleAuth
    },
    sheets: googleApiMock.sheets
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('subscription sheet mapper', () => {
  it('parses user rows by permanent user id', () => {
    expect(
      parseUsersSheetRows([
        USERS_HEADER,
        ['42', '@paid_user', '2026-05-26', '2026-06-26', '31', 'Subscribe', '2026-05-26T00:00:00.000Z'],
        ['', '', '', '', '', '', '']
      ])
    ).toEqual([
      {
        telegramUserId: 42,
        username: 'paid_user',
        startDate: '2026-05-26',
        endDate: '2026-06-26',
        daysRemaining: 31,
        status: 'Subscribe',
        lastUpdated: '2026-05-26T00:00:00.000Z'
      }
    ]);
  });

  it('requires the expected Users sheet header', () => {
    expect(() => parseUsersSheetRows([])).toThrow(/Users sheet header mismatch/);
    expect(() =>
      parseUsersSheetRows([
        ['Username', 'User ID', 'Start Date', 'End Date', 'Days Remaining', 'Status', 'Last Updated'],
        ['42', '@paid_user', '2026-05-26', '2026-06-26', '31', 'Subscribe', '2026-05-26T00:00:00.000Z']
      ])
    ).toThrow(/Users sheet header mismatch: expected User ID \| Username \| Start Date \| End Date \| Days Remaining \| Status \| Last Updated/);
  });

  it('ignores blank trailing rows but rejects nonblank invalid user ids', () => {
    expect(
      parseUsersSheetRows([
        USERS_HEADER,
        ['42', '@paid_user', '2026-05-26', '', '', 'Subscribe', '2026-05-26T00:00:00.000Z'],
        [],
        [' ', ' ', '', '', '', '', '']
      ])
    ).toEqual([
      {
        telegramUserId: 42,
        username: 'paid_user',
        startDate: '2026-05-26',
        endDate: undefined,
        daysRemaining: undefined,
        status: 'Subscribe',
        lastUpdated: '2026-05-26T00:00:00.000Z'
      }
    ]);

    for (const invalidUserId of ['abc', '42.5', '0', '-1', '']) {
      expect(() =>
        parseUsersSheetRows([USERS_HEADER, [invalidUserId, '@paid_user', '2026-05-26', '', '', 'Subscribe', '']])
      ).toThrow(/Invalid User ID in Users sheet row 2/);
    }
  });

  it('allows empty start dates for trial and unpaid users', () => {
    expect(
      parseUsersSheetRows([
        USERS_HEADER,
        ['42', 'trial_user', '', '', '', 'Trial', '2026-05-26T00:00:00.000Z'],
        ['43', '@unpaid_user', '', '', '', 'unpaid', '']
      ])
    ).toEqual([
      {
        telegramUserId: 42,
        username: 'trial_user',
        startDate: undefined,
        endDate: undefined,
        daysRemaining: undefined,
        status: 'Trial',
        lastUpdated: '2026-05-26T00:00:00.000Z'
      },
      {
        telegramUserId: 43,
        username: 'unpaid_user',
        startDate: undefined,
        endDate: undefined,
        daysRemaining: undefined,
        status: 'Unpaid',
        lastUpdated: undefined
      }
    ]);
  });

  it('rejects invalid dates, days remaining, and statuses', () => {
    expect(() => parseUsersSheetRows([USERS_HEADER, ['42', '@paid_user', '2026-02-31', '', '', '', '']])).toThrow(
      /Invalid date-only value/
    );
    expect(() => parseUsersSheetRows([USERS_HEADER, ['42', '@paid_user', '', '', '-1', '', '']])).toThrow(
      /Invalid Days Remaining/
    );
    expect(() => parseUsersSheetRows([USERS_HEADER, ['42', '@paid_user', '', '', '', 'Paused', '']])).toThrow(
      /Invalid subscription status/
    );
  });

  it('formats active and history rows', () => {
    expect(
      toUsersSheetRows([
        {
          telegramUserId: 42,
          username: 'paid_user',
          subscriptionStartDate: '2026-05-26',
          subscriptionEndDate: '2026-06-26',
          daysRemaining: 31,
          status: 'Subscribe',
          removedFromGroup: false,
          createdAt: '2026-05-26T00:00:00.000Z',
          updatedAt: '2026-05-26T00:00:00.000Z'
        }
      ])
    ).toEqual([
      USERS_HEADER,
      ['42', '@paid_user', '2026-05-26', '2026-06-26', '31', 'Subscribe', '2026-05-26T00:00:00.000Z']
    ]);

    expect(
      toHistorySheetRow({
        telegramUserId: 42,
        username: 'paid_user',
        subscriptionStartDate: '2026-05-26',
        subscriptionEndDate: '2026-06-26',
        status: 'Kicked',
        kickedAt: '2026-06-27T00:00:00.000Z',
        removedFromGroup: true,
        createdAt: '2026-05-26T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:00.000Z'
      })
    ).toEqual(['42', '@paid_user', 'Kicked', '2026-06-27T00:00:00.000Z', '2026-05-26', '2026-06-26', 'Overdue subscription removed']);

    expect(HISTORY_HEADER).toEqual(['User ID', 'Username', 'Last Status', 'Kicked At', 'Last Start Date', 'Last End Date', 'Notes']);
  });
});

describe('Google Sheets subscription client', () => {
  it('sets up auth lazily and wires values requests', async () => {
    googleApiMock.get.mockResolvedValueOnce({
      data: {
        values: [USERS_HEADER, ['42', '@paid_user', '2026-05-26', '', '', 'Subscribe', '2026-05-26T00:00:00.000Z']]
      }
    });

    const client = createGoogleSheetsClient({
      spreadsheetId: 'sheet-id',
      serviceAccountKeyFile: '/secure/google.json',
      usersRange: 'Users!A:G',
      historyRange: 'History!A:G'
    });

    expect(googleApiMock.GoogleAuth).not.toHaveBeenCalled();
    await expect(client.readUsers()).resolves.toEqual([
      {
        telegramUserId: 42,
        username: 'paid_user',
        startDate: '2026-05-26',
        endDate: undefined,
        daysRemaining: undefined,
        status: 'Subscribe',
        lastUpdated: '2026-05-26T00:00:00.000Z'
      }
    ]);

    expect(googleApiMock.GoogleAuth).toHaveBeenCalledWith({
      keyFile: '/secure/google.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    expect(googleApiMock.sheets).toHaveBeenCalledWith({
      version: 'v4',
      auth: expect.any(googleApiMock.GoogleAuth)
    });
    expect(googleApiMock.get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: 'Users!A:G'
    });
  });

  it('replaces users and appends history with raw values', async () => {
    googleApiMock.clear.mockResolvedValueOnce({ data: {} });
    googleApiMock.update.mockResolvedValueOnce({ data: {} });
    googleApiMock.append.mockResolvedValueOnce({ data: {} });

    const client = createGoogleSheetsClient({
      spreadsheetId: 'sheet-id',
      serviceAccountKeyFile: '/secure/google.json',
      usersRange: 'Users!A:G',
      historyRange: 'History!A:G'
    });
    const user = {
      telegramUserId: 42,
      username: 'paid_user',
      subscriptionStartDate: '2026-05-26',
      subscriptionEndDate: '2026-06-26',
      daysRemaining: 31,
      status: 'Kicked' as const,
      kickedAt: '2026-06-27T00:00:00.000Z',
      removedFromGroup: true,
      createdAt: '2026-05-26T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:00.000Z'
    };

    await client.writeUsers([user]);
    await client.appendHistory([user]);
    await client.appendHistory([]);

    expect(googleApiMock.clear).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: 'Users!A:G'
    });
    expect(googleApiMock.update).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: 'Users!A:G',
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          USERS_HEADER,
          ['42', '@paid_user', '2026-05-26', '2026-06-26', '31', 'Kicked', '2026-06-27T00:00:00.000Z']
        ]
      }
    });
    expect(googleApiMock.clear.mock.invocationCallOrder[0]).toBeLessThan(googleApiMock.update.mock.invocationCallOrder[0] ?? 0);
    expect(googleApiMock.append).toHaveBeenCalledTimes(1);
    expect(googleApiMock.append).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: 'History!A:G',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [['42', '@paid_user', 'Kicked', '2026-06-27T00:00:00.000Z', '2026-05-26', '2026-06-26', 'Overdue subscription removed']]
      }
    });
  });
});

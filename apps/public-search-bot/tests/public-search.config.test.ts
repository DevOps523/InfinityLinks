import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublicSearchConfig } from '../src/config.js';

const PUBLIC_BOT_TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
const SUBSCRIPTION_BOT_TOKEN = '987654321:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
const SYNC_TOKEN = 'sync_token_abcdefghijklmnopqrstuvwxyz0123456789';
const STATUS_TOKEN = 'status_token_abcdefghijklmnopqrstuvwxyz0123456789';
const ADMIN_TOKEN = 'admin_token_abcdefghijklmnopqrstuvwxyz0123456789';
const SHARED_TOKEN = 'shared_token_abcdefghijklmnopqrstuvwxyz0123456789';
const SERVICE_ACCOUNT_KEY_FILE = '/etc/infinitylinks/google-service-account.json';
const PUBLIC_SEARCH_BOT_ROOT =
  basename(process.cwd()) === 'public-search-bot' ? process.cwd() : resolve(process.cwd(), 'apps/public-search-bot');
const APP_TREE_SERVICE_ACCOUNT_KEY_FILE = resolve(PUBLIC_SEARCH_BOT_ROOT, 'google-service-account.json');

describe('loadPublicSearchConfig', () => {
  const publicEnv = {
    PUBLIC_BOT_TOKEN,
    PUBLIC_SEARCH_SYNC_TOKEN: SYNC_TOKEN,
    PUBLIC_SEARCH_STATUS_TOKEN: STATUS_TOKEN
  };

  const subscriptionEnv = {
    SUBSCRIPTION_BOT_TOKEN,
    SUBSCRIPTION_ADMIN_TOKEN: ADMIN_TOKEN,
    GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id',
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: SERVICE_ACCOUNT_KEY_FILE
  };

  function validEnv(overrides: NodeJS.ProcessEnv = {}) {
    return {
      ...publicEnv,
      ...subscriptionEnv,
      ...overrides
    };
  }

  it('requires PUBLIC_BOT_TOKEN', () => {
    expect(() =>
      loadPublicSearchConfig({
        ...subscriptionEnv,
        PUBLIC_SEARCH_SYNC_TOKEN: SYNC_TOKEN,
        PUBLIC_SEARCH_STATUS_TOKEN: STATUS_TOKEN
      })
    ).toThrow(/PUBLIC_BOT_TOKEN is required/);
  });

  it('requires PUBLIC_SEARCH_SYNC_TOKEN', () => {
    expect(() =>
      loadPublicSearchConfig({
        ...subscriptionEnv,
        PUBLIC_BOT_TOKEN,
        PUBLIC_SEARCH_STATUS_TOKEN: STATUS_TOKEN
      })
    ).toThrow(/PUBLIC_SEARCH_SYNC_TOKEN is required/);
  });

  it('requires PUBLIC_SEARCH_STATUS_TOKEN', () => {
    expect(() =>
      loadPublicSearchConfig({
        ...subscriptionEnv,
        PUBLIC_BOT_TOKEN,
        PUBLIC_SEARCH_SYNC_TOKEN: SYNC_TOKEN
      })
    ).toThrow(/PUBLIC_SEARCH_STATUS_TOKEN is required/);
  });

  it.each([
    ['PUBLIC_BOT_TOKEN', 'x'],
    ['PUBLIC_BOT_TOKEN', 'bot-token'],
    ['PUBLIC_BOT_TOKEN', '123456789:example_public_search_bot_token_abc'],
    ['PUBLIC_BOT_TOKEN', '123456789:replace_public_search_bot_token_abc'],
    ['SUBSCRIPTION_BOT_TOKEN', 'x'],
    ['SUBSCRIPTION_BOT_TOKEN', 'subscription-token'],
    ['SUBSCRIPTION_BOT_TOKEN', '987654321:placeholder_subscription_bot_token']
  ])('rejects weak or placeholder Telegram bot token %s=%s', (name, value) => {
    expect(() => loadPublicSearchConfig(validEnv({ [name]: value }))).toThrow(
      new RegExp(`${name} must be a generated Telegram bot token`)
    );
  });

  it.each([
    ['PUBLIC_SEARCH_SYNC_TOKEN', 'x'],
    ['PUBLIC_SEARCH_SYNC_TOKEN', 'sync-token'],
    ['PUBLIC_SEARCH_SYNC_TOKEN', 'sync_token_changeme_abcdefghijklmnopqrstuvwxyz'],
    ['PUBLIC_SEARCH_STATUS_TOKEN', 'x'],
    ['PUBLIC_SEARCH_STATUS_TOKEN', 'status-token'],
    ['PUBLIC_SEARCH_STATUS_TOKEN', 'status_token_example_abcdefghijklmnopqrstuvwxyz'],
    ['SUBSCRIPTION_ADMIN_TOKEN', 'x'],
    ['SUBSCRIPTION_ADMIN_TOKEN', 'admin-token'],
    ['SUBSCRIPTION_ADMIN_TOKEN', 'admin_token_placeholder_abcdefghijklmnopqrstuvwxyz']
  ])('rejects weak or placeholder bearer token %s=%s', (name, value) => {
    expect(() => loadPublicSearchConfig(validEnv({ [name]: value }))).toThrow(
      new RegExp(`${name} must be a generated bearer token`)
    );
  });

  it('rejects reusing the sync token as the status token after trimming', () => {
    expect(() =>
      loadPublicSearchConfig(
        validEnv({
          PUBLIC_SEARCH_SYNC_TOKEN: ` ${SHARED_TOKEN} `,
          PUBLIC_SEARCH_STATUS_TOKEN: SHARED_TOKEN
        })
      )
    ).toThrow(/PUBLIC_SEARCH_STATUS_TOKEN must be different from PUBLIC_SEARCH_SYNC_TOKEN/);
  });

  it('rejects reusing the status token as the subscription admin token after trimming', () => {
    expect(() =>
      loadPublicSearchConfig(
        validEnv({
          PUBLIC_SEARCH_STATUS_TOKEN: ` ${SHARED_TOKEN} `,
          SUBSCRIPTION_ADMIN_TOKEN: SHARED_TOKEN
        })
      )
    ).toThrow(/SUBSCRIPTION_ADMIN_TOKEN must be different from PUBLIC_SEARCH_STATUS_TOKEN/);
  });

  it('returns required secrets and default public search settings', () => {
    expect(
      loadPublicSearchConfig(
        validEnv({
          PUBLIC_BOT_TOKEN: ` ${PUBLIC_BOT_TOKEN} `,
          PUBLIC_SEARCH_SYNC_TOKEN: ` ${SYNC_TOKEN} `,
          PUBLIC_SEARCH_STATUS_TOKEN: ` ${STATUS_TOKEN} `
        })
      )
    ).toEqual({
      publicBotToken: PUBLIC_BOT_TOKEN,
      publicSearchSyncToken: SYNC_TOKEN,
      publicSearchStatusToken: STATUS_TOKEN,
      publicSearchGroupHandle: '@infinitylinks69',
      publicSearchDatabasePath: './data/public-search.sqlite',
      publicSearchHost: '127.0.0.1',
      publicSearchPort: 3001,
      subscriptionBotToken: SUBSCRIPTION_BOT_TOKEN,
      subscriptionGroupChatId: -1003963665033,
      subscriptionAlertThreadId: 46,
      subscriptionAdminContact: '@seinen_illuminatiks',
      subscriptionTrialSearchLimit: 5,
      subscriptionOverdueGraceDays: 1,
      subscriptionAdminToken: ADMIN_TOKEN,
      googleSheetsSpreadsheetId: 'sheet-id',
      googleSheetsUsersRange: 'Users!A:H',
      googleSheetsHistoryRange: 'History!A:G',
      googleServiceAccountKeyFile: SERVICE_ACCOUNT_KEY_FILE
    });
  });

  it('falls back to defaults for blank optional values', () => {
    expect(
      loadPublicSearchConfig(
        validEnv({
          PUBLIC_SEARCH_GROUP_HANDLE: '',
          PUBLIC_SEARCH_DATABASE_PATH: '   ',
          PUBLIC_SEARCH_HOST: ' ',
          PUBLIC_SEARCH_PORT: undefined
        })
      )
    ).toMatchObject({
      publicSearchGroupHandle: '@infinitylinks69',
      publicSearchDatabasePath: './data/public-search.sqlite',
      publicSearchHost: '127.0.0.1',
      publicSearchPort: 3001
    });
  });

  it('accepts explicit optional values', () => {
    expect(
      loadPublicSearchConfig(
        validEnv({
          PUBLIC_SEARCH_GROUP_HANDLE: '@customGroup',
          PUBLIC_SEARCH_DATABASE_PATH: './tmp/search.sqlite',
          PUBLIC_SEARCH_HOST: 'localhost',
          PUBLIC_SEARCH_PORT: '4321'
        })
      )
    ).toMatchObject({
      publicSearchGroupHandle: '@customGroup',
      publicSearchDatabasePath: './tmp/search.sqlite',
      publicSearchHost: 'localhost',
      publicSearchPort: 4321
    });
  });

  it.each(['0.0.0.0', '192.168.1.10', 'example.com'])(
    'rejects externally reachable PUBLIC_SEARCH_HOST %s',
    (host) => {
      expect(() =>
        loadPublicSearchConfig(
          validEnv({
            PUBLIC_SEARCH_HOST: host
          })
        )
      ).toThrow(/PUBLIC_SEARCH_HOST must be a loopback host/);
    }
  );

  it('requires subscription bot and admin secrets', () => {
    expect(() =>
      loadPublicSearchConfig({
        ...publicEnv,
        SUBSCRIPTION_ADMIN_TOKEN: ADMIN_TOKEN,
        GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id',
        GOOGLE_SERVICE_ACCOUNT_KEY_FILE: SERVICE_ACCOUNT_KEY_FILE
      })
    ).toThrow(/SUBSCRIPTION_BOT_TOKEN is required/);

    expect(() =>
      loadPublicSearchConfig({
        ...publicEnv,
        SUBSCRIPTION_BOT_TOKEN,
        GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id',
        GOOGLE_SERVICE_ACCOUNT_KEY_FILE: SERVICE_ACCOUNT_KEY_FILE
      })
    ).toThrow(/SUBSCRIPTION_ADMIN_TOKEN is required/);
  });

  it('requires Google Sheets spreadsheet and service account settings', () => {
    expect(() =>
      loadPublicSearchConfig({
        ...publicEnv,
        SUBSCRIPTION_BOT_TOKEN,
        SUBSCRIPTION_ADMIN_TOKEN: ADMIN_TOKEN,
        GOOGLE_SERVICE_ACCOUNT_KEY_FILE: SERVICE_ACCOUNT_KEY_FILE
      })
    ).toThrow(/GOOGLE_SHEETS_SPREADSHEET_ID is required/);

    expect(() =>
      loadPublicSearchConfig({
        ...publicEnv,
        SUBSCRIPTION_BOT_TOKEN,
        SUBSCRIPTION_ADMIN_TOKEN: ADMIN_TOKEN,
        GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id'
      })
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY_FILE is required/);
  });

  it('rejects service-account key files resolved under the public bot app tree', () => {
    expect(() =>
      loadPublicSearchConfig(
        validEnv({
          GOOGLE_SERVICE_ACCOUNT_KEY_FILE: APP_TREE_SERVICE_ACCOUNT_KEY_FILE
        })
      )
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY_FILE must be an absolute path outside the public search bot app tree/);

    expect(() =>
      loadPublicSearchConfig(
        validEnv({
          GOOGLE_SERVICE_ACCOUNT_KEY_FILE: 'google-service-account.json'
        })
      )
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY_FILE must be an absolute path outside the public search bot app tree/);

    expect(() =>
      loadPublicSearchConfig(
        validEnv({
          GOOGLE_SERVICE_ACCOUNT_KEY_FILE: resolve(PUBLIC_SEARCH_BOT_ROOT, '..secrets/google-service-account.json')
        })
      )
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY_FILE must be an absolute path outside the public search bot app tree/);
  });

  it('rejects relative service-account key file paths outside the public bot app tree', () => {
    expect(() =>
      loadPublicSearchConfig(
        validEnv({
          GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '../../google-service-account.json'
        })
      )
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY_FILE must be an absolute path outside the public search bot app tree/);
  });

  it('rejects reusing the sync token as the subscription admin token after trimming', () => {
    expect(() =>
      loadPublicSearchConfig(
        validEnv({
          PUBLIC_SEARCH_SYNC_TOKEN: ` ${SHARED_TOKEN} `,
          SUBSCRIPTION_ADMIN_TOKEN: SHARED_TOKEN
        })
      )
    ).toThrow(/SUBSCRIPTION_ADMIN_TOKEN must be different from PUBLIC_SEARCH_SYNC_TOKEN/);
  });

  it('returns subscription defaults and explicit sheet settings', () => {
    expect(loadPublicSearchConfig(validEnv())).toMatchObject({
      subscriptionBotToken: SUBSCRIPTION_BOT_TOKEN,
      subscriptionGroupChatId: -1003963665033,
      subscriptionAlertThreadId: 46,
      subscriptionAdminContact: '@seinen_illuminatiks',
      subscriptionTrialSearchLimit: 5,
      subscriptionOverdueGraceDays: 1,
      subscriptionAdminToken: ADMIN_TOKEN,
      googleSheetsSpreadsheetId: 'sheet-id',
      googleSheetsUsersRange: 'Users!A:H',
      googleSheetsHistoryRange: 'History!A:G',
      googleServiceAccountKeyFile: SERVICE_ACCOUNT_KEY_FILE
    });
  });

  it('accepts explicit subscription and Google Sheets optional values', () => {
    expect(
      loadPublicSearchConfig(
        validEnv({
          SUBSCRIPTION_GROUP_CHAT_ID: '-100123',
          SUBSCRIPTION_ALERT_THREAD_ID: '47',
          SUBSCRIPTION_ADMIN_CONTACT: ' @admin_contact ',
          SUBSCRIPTION_TRIAL_SEARCH_LIMIT: '7',
          SUBSCRIPTION_OVERDUE_GRACE_DAYS: '2',
          GOOGLE_SHEETS_USERS_RANGE: ' Members!A:H ',
          GOOGLE_SHEETS_HISTORY_RANGE: ' Payments!A:G '
        })
      )
    ).toMatchObject({
      subscriptionGroupChatId: -100123,
      subscriptionAlertThreadId: 47,
      subscriptionAdminContact: '@admin_contact',
      subscriptionTrialSearchLimit: 7,
      subscriptionOverdueGraceDays: 2,
      googleSheetsUsersRange: 'Members!A:H',
      googleSheetsHistoryRange: 'Payments!A:G'
    });
  });

  it('ignores obsolete SUBSCRIPTION_PERIOD_DAYS env values', () => {
    expect(
      loadPublicSearchConfig(
        validEnv({
          SUBSCRIPTION_PERIOD_DAYS: '365'
        })
      )
    ).not.toHaveProperty('subscriptionPeriodDays');
  });

  it.each(['0', '-1', '1.5', 'not-a-number'])(
    'rejects invalid SUBSCRIPTION_TRIAL_SEARCH_LIMIT %s',
    (limit) => {
      expect(() =>
        loadPublicSearchConfig(
          validEnv({
            SUBSCRIPTION_TRIAL_SEARCH_LIMIT: limit
          })
        )
      ).toThrow();
    }
  );
});

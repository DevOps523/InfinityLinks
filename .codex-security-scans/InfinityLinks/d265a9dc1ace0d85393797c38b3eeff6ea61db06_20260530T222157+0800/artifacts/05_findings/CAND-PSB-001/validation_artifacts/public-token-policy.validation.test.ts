// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { loadPublicSearchConfig } from '../../../../../../../apps/public-search-bot/src/config.js';

describe('CAND-PSB-001 validation', () => {
  it('accepts distinct one-character public API tokens', () => {
    expect(
      loadPublicSearchConfig({
        PUBLIC_BOT_TOKEN: 'b',
        PUBLIC_SEARCH_SYNC_TOKEN: 's',
        PUBLIC_SEARCH_STATUS_TOKEN: 't',
        SUBSCRIPTION_BOT_TOKEN: 'u',
        SUBSCRIPTION_ADMIN_TOKEN: 'a',
        GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id',
        GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/secure/google.json'
      })
    ).toMatchObject({
      publicBotToken: 'b',
      publicSearchSyncToken: 's',
      publicSearchStatusToken: 't',
      subscriptionAdminToken: 'a'
    });
  });

  it('accepts placeholder-shaped public API tokens when they differ', () => {
    expect(
      loadPublicSearchConfig({
        PUBLIC_BOT_TOKEN: 'replace_with_public_search_bot_token',
        PUBLIC_SEARCH_SYNC_TOKEN: 'replace_with_secret_sync_token',
        PUBLIC_SEARCH_STATUS_TOKEN: 'replace_with_read_only_status_token',
        SUBSCRIPTION_BOT_TOKEN: 'replace_with_subscription_bot_token',
        SUBSCRIPTION_ADMIN_TOKEN: 'replace_with_subscription_admin_secret',
        GOOGLE_SHEETS_SPREADSHEET_ID: 'replace_with_google_sheet_id',
        GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/secure/google.json'
      })
    ).toMatchObject({
      publicSearchSyncToken: 'replace_with_secret_sync_token',
      publicSearchStatusToken: 'replace_with_read_only_status_token',
      subscriptionAdminToken: 'replace_with_subscription_admin_secret'
    });
  });
});

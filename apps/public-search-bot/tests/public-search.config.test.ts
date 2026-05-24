import { describe, expect, it } from 'vitest';
import { loadPublicSearchConfig } from '../src/config.js';

describe('loadPublicSearchConfig', () => {
  it('requires PUBLIC_BOT_TOKEN', () => {
    expect(() =>
      loadPublicSearchConfig({
        PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
        PUBLIC_SEARCH_STATUS_TOKEN: 'status-token'
      })
    ).toThrow(/PUBLIC_BOT_TOKEN is required/);
  });

  it('requires PUBLIC_SEARCH_SYNC_TOKEN', () => {
    expect(() =>
      loadPublicSearchConfig({
        PUBLIC_BOT_TOKEN: 'bot-token',
        PUBLIC_SEARCH_STATUS_TOKEN: 'status-token'
      })
    ).toThrow(/PUBLIC_SEARCH_SYNC_TOKEN is required/);
  });

  it('requires PUBLIC_SEARCH_STATUS_TOKEN', () => {
    expect(() =>
      loadPublicSearchConfig({
        PUBLIC_BOT_TOKEN: 'bot-token',
        PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token'
      })
    ).toThrow(/PUBLIC_SEARCH_STATUS_TOKEN is required/);
  });

  it('returns required secrets and default public search settings', () => {
    expect(
      loadPublicSearchConfig({
        PUBLIC_BOT_TOKEN: ' bot-token ',
        PUBLIC_SEARCH_SYNC_TOKEN: ' sync-token ',
        PUBLIC_SEARCH_STATUS_TOKEN: ' status-token '
      })
    ).toEqual({
      publicBotToken: 'bot-token',
      publicSearchSyncToken: 'sync-token',
      publicSearchStatusToken: 'status-token',
      publicSearchChannelHandle: '@infinitylinks65',
      publicSearchGroupHandle: '@infinitylinks69',
      publicSearchDatabasePath: './data/public-search.sqlite',
      publicSearchHost: '127.0.0.1',
      publicSearchPort: 3001
    });
  });

  it('falls back to defaults for blank optional values', () => {
    expect(
      loadPublicSearchConfig({
        PUBLIC_BOT_TOKEN: 'bot-token',
        PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
        PUBLIC_SEARCH_STATUS_TOKEN: 'status-token',
        PUBLIC_SEARCH_CHANNEL_HANDLE: ' ',
        PUBLIC_SEARCH_GROUP_HANDLE: '',
        PUBLIC_SEARCH_DATABASE_PATH: '   ',
        PUBLIC_SEARCH_HOST: ' ',
        PUBLIC_SEARCH_PORT: undefined
      })
    ).toMatchObject({
      publicSearchChannelHandle: '@infinitylinks65',
      publicSearchGroupHandle: '@infinitylinks69',
      publicSearchDatabasePath: './data/public-search.sqlite',
      publicSearchHost: '127.0.0.1',
      publicSearchPort: 3001
    });
  });

  it('accepts explicit optional values', () => {
    expect(
      loadPublicSearchConfig({
        PUBLIC_BOT_TOKEN: 'bot-token',
        PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
        PUBLIC_SEARCH_STATUS_TOKEN: 'status-token',
        PUBLIC_SEARCH_CHANNEL_HANDLE: '@customChannel',
        PUBLIC_SEARCH_GROUP_HANDLE: '@customGroup',
        PUBLIC_SEARCH_DATABASE_PATH: './tmp/search.sqlite',
        PUBLIC_SEARCH_HOST: '0.0.0.0',
        PUBLIC_SEARCH_PORT: '4321'
      })
    ).toMatchObject({
      publicSearchChannelHandle: '@customChannel',
      publicSearchGroupHandle: '@customGroup',
      publicSearchDatabasePath: './tmp/search.sqlite',
      publicSearchHost: '0.0.0.0',
      publicSearchPort: 4321
    });
  });
});

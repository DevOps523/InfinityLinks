import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';

describe('loadConfig', () => {
  it('accepts environment variables and returns camelCase values', () => {
    expect(
      loadConfig({
        TMDB_API_KEY: 'tmdb-key',
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        TELEGRAM_CHANNEL_ID: '@channel',
        HOST: 'localhost',
        PORT: '4321',
        DATABASE_PATH: './data/test.sqlite'
      })
    ).toEqual({
      tmdbApiKey: 'tmdb-key',
      telegramBotToken: 'telegram-token',
      telegramChannelId: '@channel',
      host: 'localhost',
      port: 4321,
      databasePath: './data/test.sqlite',
      publicSearchSyncUrl: undefined,
      publicSearchSyncToken: undefined,
      publicSearchStatusUrl: undefined,
      publicSearchStatusToken: undefined,
      publicSearchChannelHandle: '@infinitylinks65',
      publicSearchGroupHandle: '@infinitylinks69'
    });
  });

  it('accepts optional public search sync configuration', () => {
    expect(
      loadConfig({
        TMDB_API_KEY: 'tmdb-key',
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        TELEGRAM_CHANNEL_ID: '@channel',
        PUBLIC_SEARCH_SYNC_URL: 'https://search.example.com/api/sync',
        PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
        PUBLIC_SEARCH_CHANNEL_HANDLE: '@infinitylinks65',
        PUBLIC_SEARCH_GROUP_HANDLE: '@infinitylinks69'
      })
    ).toMatchObject({
      publicSearchSyncUrl: 'https://search.example.com/api/sync',
      publicSearchSyncToken: 'sync-token',
      publicSearchChannelHandle: '@infinitylinks65',
      publicSearchGroupHandle: '@infinitylinks69'
    });
  });

  it('treats empty optional public search sync values as undefined', () => {
    expect(
      loadConfig({
        TMDB_API_KEY: 'tmdb-key',
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        TELEGRAM_CHANNEL_ID: '@channel',
        PUBLIC_SEARCH_SYNC_URL: '   ',
        PUBLIC_SEARCH_SYNC_TOKEN: '',
        PUBLIC_SEARCH_CHANNEL_HANDLE: '   ',
        PUBLIC_SEARCH_GROUP_HANDLE: ''
      })
    ).toMatchObject({
      publicSearchSyncUrl: undefined,
      publicSearchSyncToken: undefined,
      publicSearchChannelHandle: '@infinitylinks65',
      publicSearchGroupHandle: '@infinitylinks69'
    });
  });

  it('accepts optional public search status configuration', () => {
    expect(
      loadConfig({
        TMDB_API_KEY: 'tmdb-key',
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        TELEGRAM_CHANNEL_ID: '@channel',
        PUBLIC_SEARCH_STATUS_URL: 'https://search.example.com/api/status',
        PUBLIC_SEARCH_STATUS_TOKEN: 'status-token'
      })
    ).toMatchObject({
      publicSearchStatusUrl: 'https://search.example.com/api/status',
      publicSearchStatusToken: 'status-token'
    });
  });

  it('treats empty optional public search status values as undefined', () => {
    expect(
      loadConfig({
        TMDB_API_KEY: 'tmdb-key',
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        TELEGRAM_CHANNEL_ID: '@channel',
        PUBLIC_SEARCH_STATUS_URL: '   ',
        PUBLIC_SEARCH_STATUS_TOKEN: ''
      })
    ).toMatchObject({
      publicSearchStatusUrl: undefined,
      publicSearchStatusToken: undefined
    });
  });

  it('allows loopback host values only', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      expect(
        loadConfig({
          TMDB_API_KEY: 'tmdb-key',
          TELEGRAM_BOT_TOKEN: 'telegram-token',
          TELEGRAM_CHANNEL_ID: '@channel',
          HOST: host
        }).host
      ).toBe(host);
    }
  });

  it('rejects non-localhost host values', () => {
    for (const host of ['0.0.0.0', '192.168.1.10', 'example.com']) {
      expect(() =>
        loadConfig({
          TMDB_API_KEY: 'tmdb-key',
          TELEGRAM_BOT_TOKEN: 'telegram-token',
          TELEGRAM_CHANNEL_ID: '@channel',
          HOST: host
        })
      ).toThrow(/HOST must be a localhost address/);
    }
  });

  it('rejects missing secrets with a clear message', () => {
    expect(() => loadConfig({})).toThrow(/TMDB_API_KEY is required/);
  });
});

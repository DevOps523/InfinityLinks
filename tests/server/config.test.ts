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
      databasePath: './data/test.sqlite'
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

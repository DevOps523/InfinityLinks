import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';

describe('loadConfig', () => {
  it('accepts environment variables and returns camelCase values', () => {
    expect(
      loadConfig({
        TMDB_API_KEY: 'tmdb-key',
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        TELEGRAM_CHANNEL_ID: '@channel',
        HOST: '0.0.0.0',
        PORT: '4321',
        DATABASE_PATH: './data/test.sqlite'
      })
    ).toEqual({
      tmdbApiKey: 'tmdb-key',
      telegramBotToken: 'telegram-token',
      telegramChannelId: '@channel',
      host: '0.0.0.0',
      port: 4321,
      databasePath: './data/test.sqlite'
    });
  });

  it('rejects missing secrets with a clear message', () => {
    expect(() => loadConfig({})).toThrow(/TMDB_API_KEY is required/);
  });
});

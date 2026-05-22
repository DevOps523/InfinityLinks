import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

describe('database migration', () => {
  it('creates every MVP table', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row: any) => row.name);

    expect(tables).toEqual([
      'api_logs',
      'episode_links',
      'episodes',
      'movie_links',
      'movies',
      'seasons',
      'telegram_jobs',
      'tmdb_cache',
      'tv_shows'
    ]);
  });
});

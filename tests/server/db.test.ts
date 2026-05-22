import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/database.js';
import { migrate, resolveSchemaPath } from '../../src/server/db/migrate.js';

describe('database migration', () => {
  it('creates every MVP table', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
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

    db.close();
  });

  it('uses autoincrement ids and indexes foreign key columns', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const tableSql = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string; sql: string }>;

    expect(tableSql).toHaveLength(9);
    for (const table of tableSql) {
      expect(table.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    }

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name")
      .all()
      .map((row: any) => row.name);

    expect(indexes).toEqual([
      'idx_episode_links_episode_id',
      'idx_episodes_season_id',
      'idx_movie_links_movie_id',
      'idx_seasons_tv_show_id'
    ]);

    db.close();
  });

  it('enforces foreign key cascades', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const movie = db.prepare("INSERT INTO movies (title, quality) VALUES ('Movie', 'HD')").run();
    db.prepare(
      "INSERT INTO movie_links (movie_id, provider_name, quality, status, url) VALUES (?, 'Provider', 'HD', 'active', 'https://example.com')"
    ).run(movie.lastInsertRowid);

    db.prepare('DELETE FROM movies WHERE id = ?').run(movie.lastInsertRowid);

    expect(db.prepare('SELECT COUNT(*) AS count FROM movie_links').get()).toEqual({ count: 0 });
    db.close();
  });

  it('enforces check constraints and default statuses', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    expect(() => {
      db.prepare("INSERT INTO movies (title, quality) VALUES ('Movie', 'BluRay')").run();
    }).toThrow();

    const movie = db.prepare("INSERT INTO movies (title, quality) VALUES ('Movie', 'HD')").run();
    const storedMovie = db.prepare('SELECT post_status FROM movies WHERE id = ?').get(movie.lastInsertRowid);
    expect(storedMovie).toEqual({ post_status: 'pending' });

    expect(() => {
      db.prepare(
        "INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status) VALUES ('send', 'movie', 1, '{}', 'paused')"
      ).run();
    }).toThrow();

    const job = db
      .prepare("INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload) VALUES ('send', 'movie', 1, '{}')")
      .run();
    const storedJob = db.prepare('SELECT status, attempts FROM telegram_jobs WHERE id = ?').get(job.lastInsertRowid);
    expect(storedJob).toEqual({ status: 'queued', attempts: 0 });

    db.close();
  });

  it('enforces unique season and episode numbers per parent', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const show = db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Show', 'Full HD')").run();
    const season = db
      .prepare('INSERT INTO seasons (tv_show_id, season_number) VALUES (?, 1)')
      .run(show.lastInsertRowid);

    expect(() => {
      db.prepare('INSERT INTO seasons (tv_show_id, season_number) VALUES (?, 1)').run(show.lastInsertRowid);
    }).toThrow();

    db.prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)').run(season.lastInsertRowid);
    expect(() => {
      db.prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)').run(season.lastInsertRowid);
    }).toThrow();

    db.close();
  });

  it('resolves the schema path from source layout', () => {
    expect(resolveSchemaPath()).toMatch(/src[\\/]server[\\/]db[\\/]schema\.sql$/);
  });
});

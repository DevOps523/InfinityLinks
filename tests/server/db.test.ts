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
      'public_search_sync_state',
      'seasons',
      'telegram_jobs',
      'tmdb_cache',
      'tv_shows'
    ]);

    db.close();
  });

  it('creates public search sync state table with expected columns', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const columns = db.prepare('PRAGMA table_info(public_search_sync_state)').all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'last_successful_sync_at',
      'last_catalog_hash',
      'last_movie_count',
      'last_tv_show_count',
      'updated_at'
    ]);

    db.close();
  });

  it('creates topic keys on movies and tv shows with media defaults', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const movieColumns = db.prepare('PRAGMA table_info(movies)').all() as Array<{ name: string }>;
    const tvColumns = db.prepare('PRAGMA table_info(tv_shows)').all() as Array<{ name: string }>;

    expect(movieColumns.map((column) => column.name)).toContain('topic_key');
    expect(tvColumns.map((column) => column.name)).toContain('topic_key');

    const movie = db.prepare("INSERT INTO movies (title, quality) VALUES ('Movie', 'HD')").run();
    const show = db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Show', 'HD')").run();

    expect(db.prepare('SELECT topic_key FROM movies WHERE id = ?').get(movie.lastInsertRowid)).toEqual({
      topic_key: 'FOREIGN_MOVIES'
    });
    expect(db.prepare('SELECT topic_key FROM tv_shows WHERE id = ?').get(show.lastInsertRowid)).toEqual({
      topic_key: 'FOREIGN_TV_SERIES'
    });

    expect(() => {
      db.prepare("INSERT INTO movies (title, quality, topic_key) VALUES ('Bad Movie', 'HD', 'FOREIGN_TV_SERIES')").run();
    }).toThrow();
    expect(() => {
      db.prepare("INSERT INTO tv_shows (title, quality, topic_key) VALUES ('Bad Show', 'HD', 'PINOY_MOVIES')").run();
    }).toThrow();

    db.close();
  });

  it('adds and backfills topic keys on existing movie and tv show tables', () => {
    const db = createDatabase(':memory:');
    db.exec(`
      CREATE TABLE movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        quality TEXT NOT NULL
      );
      CREATE TABLE tv_shows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        quality TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO movies (title, quality) VALUES ('Legacy Movie', 'HD')").run();
    db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Legacy Show', 'HD')").run();

    migrate(db);

    expect(db.prepare("SELECT topic_key FROM movies WHERE title = 'Legacy Movie'").get()).toEqual({
      topic_key: 'FOREIGN_MOVIES'
    });
    expect(db.prepare("SELECT topic_key FROM tv_shows WHERE title = 'Legacy Show'").get()).toEqual({
      topic_key: 'FOREIGN_TV_SERIES'
    });

    db.close();
  });

  it('uses autoincrement ids and indexes foreign key columns', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const tableSql = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string; sql: string }>;

    expect(tableSql).toHaveLength(10);
    for (const table of tableSql.filter((table) => table.name !== 'public_search_sync_state')) {
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

  it('adds repost tracking to existing season tables', () => {
    const db = createDatabase(':memory:');
    db.exec(`
      CREATE TABLE tv_shows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        quality TEXT NOT NULL
      );
      CREATE TABLE seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tv_show_id INTEGER NOT NULL,
        season_number INTEGER NOT NULL,
        telegram_message_id INTEGER,
        post_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    migrate(db);

    const columns = db.prepare('PRAGMA table_info(seasons)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('needs_repost');

    const show = db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Show', 'HD')").run();
    const season = db.prepare('INSERT INTO seasons (tv_show_id, season_number) VALUES (?, 1)').run(show.lastInsertRowid);
    expect(db.prepare('SELECT needs_repost FROM seasons WHERE id = ?').get(season.lastInsertRowid)).toEqual({ needs_repost: 0 });

    db.close();
  });

  it('resolves the schema path from source layout', () => {
    expect(resolveSchemaPath()).toMatch(/src[\\/]server[\\/]db[\\/]schema\.sql$/);
  });
});

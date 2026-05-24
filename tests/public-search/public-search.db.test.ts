import { describe, expect, it } from 'vitest';
import { createPublicSearchDatabase } from '../../src/public-search/db/database.js';
import { migratePublicSearchDatabase } from '../../src/public-search/db/migrate.js';

function createMigratedDatabase() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

function tableNames(db: ReturnType<typeof createPublicSearchDatabase>) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

describe('public search database', () => {
  it('creates the public search service tables', () => {
    const db = createMigratedDatabase();

    try {
      expect(tableNames(db)).toEqual([
        'public_episode_providers',
        'public_episodes',
        'public_movie_providers',
        'public_movies',
        'public_seasons',
        'public_sync_state',
        'public_tv_shows'
      ]);
    } finally {
      db.close();
    }
  });

  it('cascades movie provider rows when a movie is deleted', () => {
    const db = createMigratedDatabase();

    try {
      const movie = db
        .prepare(
          `INSERT INTO public_movies (id, title, year, telegram_message_id, channel_post_url)
           VALUES (1, 'Inception', 2010, 123, 'https://t.me/infinitylinks65/123')`
        )
        .run();

      db.prepare(
        `INSERT INTO public_movie_providers (movie_id, provider_name, quality, url, sort_order)
         VALUES (?, 'MixDrop', 'HD', 'https://mixdrop.example/movie', 1)`
      ).run(movie.lastInsertRowid);

      db.prepare('DELETE FROM public_movies WHERE id = ?').run(movie.lastInsertRowid);

      expect(db.prepare('SELECT COUNT(*) AS count FROM public_movie_providers').get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it('cascades TV child rows when a show is deleted', () => {
    const db = createMigratedDatabase();

    try {
      const show = db.prepare("INSERT INTO public_tv_shows (id, title, year) VALUES (1, 'Breaking Bad', 2008)").run();
      const season = db
        .prepare(
          `INSERT INTO public_seasons (id, tv_show_id, season_number, telegram_message_id, channel_post_url)
           VALUES (1, ?, 1, 201, 'https://t.me/infinitylinks65/201')`
        )
        .run(show.lastInsertRowid);
      const episode = db
        .prepare('INSERT INTO public_episodes (id, season_id, episode_number) VALUES (1, ?, 1)')
        .run(season.lastInsertRowid);

      db.prepare(
        `INSERT INTO public_episode_providers (episode_id, provider_name, quality, url, sort_order)
         VALUES (?, 'FileMoon', 'HD', 'https://filemoon.example/s1e1', 1)`
      ).run(episode.lastInsertRowid);

      db.prepare('DELETE FROM public_tv_shows WHERE id = ?').run(show.lastInsertRowid);

      expect(db.prepare('SELECT COUNT(*) AS count FROM public_seasons').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM public_episodes').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM public_episode_providers').get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});

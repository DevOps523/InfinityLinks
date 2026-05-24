import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';
import { buildPublicSearchCatalog } from '../../src/server/public-search/catalog.js';

function createMigratedDatabase() {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

describe('public search catalog export', () => {
  it('exports active movie links and excludes inactive movie links', () => {
    const db = createMigratedDatabase();

    try {
      const movie = db
        .prepare(
          "INSERT INTO movies (title, year, quality, telegram_message_id) VALUES ('Inception', 2010, 'HD', 123)"
        )
        .run();

      db.prepare(
        `INSERT INTO movie_links (movie_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'MixDrop', 'HD', 'active', 'https://mixdrop.example/movie', 1)`
      ).run(movie.lastInsertRowid);
      db.prepare(
        `INSERT INTO movie_links (movie_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'InactiveHost', 'HD', 'inactive', 'https://inactive.example/movie', 2)`
      ).run(movie.lastInsertRowid);

      const catalog = buildPublicSearchCatalog(db, {
        channelHandle: '@infinitylinks65',
        groupHandle: '@infinitylinks69',
        now: () => new Date('2026-05-24T00:00:00.000Z')
      });

      expect(catalog.movies).toEqual([
        {
          id: 1,
          title: 'Inception',
          year: 2010,
          telegramMessageId: 123,
          channelPostUrl: 'https://t.me/infinitylinks65/123',
          providers: [
            {
              providerName: 'MixDrop',
              quality: 'HD',
              url: 'https://mixdrop.example/movie',
              sortOrder: 1
            }
          ]
        }
      ]);
      expect(catalog.generatedAt).toBe('2026-05-24T00:00:00.000Z');
      expect(catalog.channelHandle).toBe('@infinitylinks65');
      expect(catalog.groupHandle).toBe('@infinitylinks69');
    } finally {
      db.close();
    }
  });

  it('exports active episode links under the correct show, season, and episode', () => {
    const db = createMigratedDatabase();

    try {
      const show = db.prepare("INSERT INTO tv_shows (title, year, quality) VALUES ('Breaking Bad', 2008, 'HD')").run();
      const seasonOne = db
        .prepare('INSERT INTO seasons (tv_show_id, season_number, telegram_message_id) VALUES (?, 1, 201)')
        .run(show.lastInsertRowid);
      const seasonTwo = db
        .prepare('INSERT INTO seasons (tv_show_id, season_number, telegram_message_id) VALUES (?, 2, 202)')
        .run(show.lastInsertRowid);

      const episodeOne = db
        .prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)')
        .run(seasonOne.lastInsertRowid);
      const episodeTwo = db
        .prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 2)')
        .run(seasonOne.lastInsertRowid);
      const episodeThree = db
        .prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 3)')
        .run(seasonOne.lastInsertRowid);
      const seasonTwoEpisodeOne = db
        .prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)')
        .run(seasonTwo.lastInsertRowid);

      db.prepare(
        `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'MixDrop', 'HD', 'active', 'https://mixdrop.example/breaking-bad/s1e1', 2)`
      ).run(episodeOne.lastInsertRowid);
      db.prepare(
        `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'FileMoon', 'Full HD', 'active', 'https://filemoon.example/breaking-bad/s1e1', 1)`
      ).run(episodeOne.lastInsertRowid);
      db.prepare(
        `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'InactiveHost', 'HD', 'inactive', 'https://inactive.example/breaking-bad/s1e2', 1)`
      ).run(episodeTwo.lastInsertRowid);
      db.prepare(
        `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'StreamTape', 'HD', 'active', 'https://streamtape.example/breaking-bad/s1e3', 1)`
      ).run(episodeThree.lastInsertRowid);
      db.prepare(
        `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'MixDrop', 'HD', 'inactive', 'https://mixdrop.example/breaking-bad/s2e1', 1)`
      ).run(seasonTwoEpisodeOne.lastInsertRowid);

      const catalog = buildPublicSearchCatalog(db, {
        channelHandle: '@infinitylinks65',
        groupHandle: '@infinitylinks69',
        now: () => new Date('2026-05-24T00:00:00.000Z')
      });

      expect(catalog.tvShows).toEqual([
        {
          id: 1,
          title: 'Breaking Bad',
          year: 2008,
          seasons: [
            {
              id: 1,
              seasonNumber: 1,
              telegramMessageId: 201,
              channelPostUrl: 'https://t.me/infinitylinks65/201',
              episodes: [
                {
                  episodeNumber: 1,
                  providers: [
                    {
                      providerName: 'FileMoon',
                      quality: 'Full HD',
                      url: 'https://filemoon.example/breaking-bad/s1e1',
                      sortOrder: 1
                    },
                    {
                      providerName: 'MixDrop',
                      quality: 'HD',
                      url: 'https://mixdrop.example/breaking-bad/s1e1',
                      sortOrder: 2
                    }
                  ]
                },
                {
                  episodeNumber: 3,
                  providers: [
                    {
                      providerName: 'StreamTape',
                      quality: 'HD',
                      url: 'https://streamtape.example/breaking-bad/s1e3',
                      sortOrder: 1
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]);
    } finally {
      db.close();
    }
  });
});

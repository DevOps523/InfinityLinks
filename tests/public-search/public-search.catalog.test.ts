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
          "INSERT INTO movies (title, year, quality, telegram_message_id, post_status) VALUES ('Inception', 2010, 'HD', 123, 'posted')"
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
        .prepare(
          "INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 1, 201, 'posted')"
        )
        .run(show.lastInsertRowid);
      const seasonTwo = db
        .prepare(
          "INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 2, 202, 'posted')"
        )
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

  it('excludes active links for movies and seasons that are not posted public Telegram content', () => {
    const db = createMigratedDatabase();

    try {
      const pendingMovie = db
        .prepare(
          "INSERT INTO movies (title, quality, telegram_message_id, post_status) VALUES ('Pending Movie', 'HD', 301, 'pending')"
        )
        .run();
      const missingMessageMovie = db
        .prepare(
          "INSERT INTO movies (title, quality, telegram_message_id, post_status) VALUES ('Missing Message Movie', 'HD', NULL, 'posted')"
        )
        .run();
      const deletedMovie = db
        .prepare(
          "INSERT INTO movies (title, quality, telegram_message_id, post_status) VALUES ('Deleted Movie', 'HD', 303, 'deleted')"
        )
        .run();

      for (const movieId of [pendingMovie.lastInsertRowid, missingMessageMovie.lastInsertRowid, deletedMovie.lastInsertRowid]) {
        db.prepare(
          `INSERT INTO movie_links (movie_id, provider_name, quality, status, url)
           VALUES (?, 'MixDrop', 'HD', 'active', 'https://mixdrop.example/not-public')`
        ).run(movieId);
      }

      const show = db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Hidden Show', 'HD')").run();
      const pendingSeason = db
        .prepare(
          "INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 1, 401, 'pending')"
        )
        .run(show.lastInsertRowid);
      const missingMessageSeason = db
        .prepare(
          "INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 2, NULL, 'posted')"
        )
        .run(show.lastInsertRowid);
      const deletedSeason = db
        .prepare(
          "INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 3, 403, 'deleted')"
        )
        .run(show.lastInsertRowid);

      for (const seasonId of [
        pendingSeason.lastInsertRowid,
        missingMessageSeason.lastInsertRowid,
        deletedSeason.lastInsertRowid
      ]) {
        const episode = db.prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)').run(seasonId);
        db.prepare(
          `INSERT INTO episode_links (episode_id, provider_name, quality, status, url)
           VALUES (?, 'FileMoon', 'HD', 'active', 'https://filemoon.example/not-public')`
        ).run(episode.lastInsertRowid);
      }

      const catalog = buildPublicSearchCatalog(db, {
        channelHandle: '@infinitylinks65',
        groupHandle: '@infinitylinks69',
        now: () => new Date('2026-05-24T00:00:00.000Z')
      });

      expect(catalog.movies).toEqual([]);
      expect(catalog.tvShows).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('orders movies, tv shows, seasons, episodes, and providers predictably', () => {
    const db = createMigratedDatabase();

    try {
      const betaMovie = db
        .prepare(
          "INSERT INTO movies (title, quality, telegram_message_id, post_status) VALUES ('Beta Movie', 'HD', 502, 'posted')"
        )
        .run();
      const alphaMovie = db
        .prepare(
          "INSERT INTO movies (title, quality, telegram_message_id, post_status) VALUES ('Alpha Movie', 'HD', 501, 'posted')"
        )
        .run();

      db.prepare(
        `INSERT INTO movie_links (movie_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'Second Provider', 'HD', 'active', 'https://example.com/beta-second', 2)`
      ).run(betaMovie.lastInsertRowid);
      db.prepare(
        `INSERT INTO movie_links (movie_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'First Provider', 'HD', 'active', 'https://example.com/beta-first', 1)`
      ).run(betaMovie.lastInsertRowid);
      db.prepare(
        `INSERT INTO movie_links (movie_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'Alpha Provider', 'HD', 'active', 'https://example.com/alpha', 1)`
      ).run(alphaMovie.lastInsertRowid);

      const zetaShow = db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Zeta Show', 'HD')").run();
      const alphaShow = db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Alpha Show', 'HD')").run();

      const zetaSeason = db
        .prepare(
          "INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 1, 601, 'posted')"
        )
        .run(zetaShow.lastInsertRowid);
      const zetaEpisode = db.prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)').run(zetaSeason.lastInsertRowid);
      db.prepare(
        `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'Zeta Provider', 'HD', 'active', 'https://example.com/zeta', 1)`
      ).run(zetaEpisode.lastInsertRowid);

      const alphaSeasonTwo = db
        .prepare(
          "INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 2, 702, 'posted')"
        )
        .run(alphaShow.lastInsertRowid);
      const alphaSeasonOne = db
        .prepare(
          "INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 1, 701, 'posted')"
        )
        .run(alphaShow.lastInsertRowid);

      const alphaSeasonOneEpisodeTwo = db
        .prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 2)')
        .run(alphaSeasonOne.lastInsertRowid);
      const alphaSeasonOneEpisodeOne = db
        .prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)')
        .run(alphaSeasonOne.lastInsertRowid);
      const alphaSeasonTwoEpisodeOne = db
        .prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)')
        .run(alphaSeasonTwo.lastInsertRowid);

      db.prepare(
        `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'Episode Two Provider', 'HD', 'active', 'https://example.com/alpha-s1e2', 1)`
      ).run(alphaSeasonOneEpisodeTwo.lastInsertRowid);
      db.prepare(
        `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'Second Episode One Provider', 'HD', 'active', 'https://example.com/alpha-s1e1-second', 2)`
      ).run(alphaSeasonOneEpisodeOne.lastInsertRowid);
      db.prepare(
        `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'First Episode One Provider', 'HD', 'active', 'https://example.com/alpha-s1e1-first', 1)`
      ).run(alphaSeasonOneEpisodeOne.lastInsertRowid);
      db.prepare(
        `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
         VALUES (?, 'Season Two Provider', 'HD', 'active', 'https://example.com/alpha-s2e1', 1)`
      ).run(alphaSeasonTwoEpisodeOne.lastInsertRowid);

      const catalog = buildPublicSearchCatalog(db, {
        channelHandle: '@infinitylinks65',
        groupHandle: '@infinitylinks69',
        now: () => new Date('2026-05-24T00:00:00.000Z')
      });

      expect(catalog.movies.map((movie) => movie.title)).toEqual(['Alpha Movie', 'Beta Movie']);
      expect(catalog.movies[1].providers.map((provider) => provider.providerName)).toEqual([
        'First Provider',
        'Second Provider'
      ]);

      expect(catalog.tvShows.map((show) => show.title)).toEqual(['Alpha Show', 'Zeta Show']);
      expect(catalog.tvShows[0].seasons.map((season) => season.seasonNumber)).toEqual([1, 2]);
      expect(catalog.tvShows[0].seasons[0].episodes.map((episode) => episode.episodeNumber)).toEqual([1, 2]);
      expect(catalog.tvShows[0].seasons[0].episodes[0].providers.map((provider) => provider.providerName)).toEqual([
        'First Episode One Provider',
        'Second Episode One Provider'
      ]);
    } finally {
      db.close();
    }
  });
});

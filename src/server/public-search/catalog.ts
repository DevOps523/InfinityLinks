import { createHash } from 'node:crypto';

import type { AppDatabase } from '../db/database.js';

export type PublicSearchProvider = {
  providerName: string;
  quality: string;
  url: string;
  sortOrder: number;
};

export type PublicSearchMovie = {
  id: number;
  title: string;
  year?: number;
  telegramMessageId?: number;
  channelPostUrl?: string;
  providers: PublicSearchProvider[];
};

export type PublicSearchEpisode = {
  episodeNumber: number;
  providers: PublicSearchProvider[];
};

export type PublicSearchSeason = {
  id: number;
  seasonNumber: number;
  telegramMessageId?: number;
  channelPostUrl?: string;
  episodes: PublicSearchEpisode[];
};

export type PublicSearchTvShow = {
  id: number;
  title: string;
  year?: number;
  seasons: PublicSearchSeason[];
};

export type PublicSearchCatalog = {
  generatedAt: string;
  channelHandle: string;
  groupHandle: string;
  movies: PublicSearchMovie[];
  tvShows: PublicSearchTvShow[];
};

type MovieCatalogRow = {
  movie_id: number;
  title: string;
  year: number | null;
  telegram_message_id: number | null;
  provider_name: string;
  quality: string;
  url: string;
  sort_order: number;
};

type TvCatalogRow = {
  tv_show_id: number;
  title: string;
  year: number | null;
  season_id: number;
  season_number: number;
  telegram_message_id: number | null;
  episode_number: number;
  provider_name: string;
  quality: string;
  url: string;
  sort_order: number;
};

type SeasonAccumulator = {
  season: PublicSearchSeason;
  episodesByNumber: Map<number, PublicSearchEpisode>;
};

type TvShowAccumulator = {
  tvShow: PublicSearchTvShow;
  seasonsById: Map<number, SeasonAccumulator>;
};

function buildChannelPostUrl(channelHandle: string, messageId: number | null): string | undefined {
  if (messageId === null) {
    return undefined;
  }

  const publicHandle = channelHandle.trim().replace(/^@+/, '');
  return `https://t.me/${publicHandle}/${messageId}`;
}

function mapProvider(row: Pick<MovieCatalogRow | TvCatalogRow, 'provider_name' | 'quality' | 'url'>, sortOrder: number) {
  return {
    providerName: row.provider_name,
    quality: row.quality,
    url: row.url,
    sortOrder
  };
}

export function buildPublicSearchCatalog(
  db: AppDatabase,
  options: { channelHandle: string; groupHandle: string; now?: () => Date }
): PublicSearchCatalog {
  const channelHandle = options.channelHandle.trim();
  const groupHandle = options.groupHandle.trim();

  return {
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    channelHandle,
    groupHandle,
    movies: buildMovies(db, channelHandle),
    tvShows: buildTvShows(db, channelHandle)
  };
}

export function createPublicSearchCatalogFingerprint(catalog: PublicSearchCatalog): string {
  const { generatedAt: _generatedAt, ...fingerprintCatalog } = catalog;
  return createHash('sha256').update(JSON.stringify(fingerprintCatalog)).digest('hex');
}

function buildMovies(db: AppDatabase, channelHandle: string): PublicSearchMovie[] {
  const rows = db
    .prepare(
      `SELECT movies.id AS movie_id,
              movies.title,
              movies.year,
              movies.telegram_message_id,
              movie_links.provider_name,
              movie_links.quality,
              movie_links.url,
              movie_links.sort_order
         FROM movies
         JOIN movie_links ON movie_links.movie_id = movies.id
        WHERE movie_links.status = 'active'
          AND movies.post_status = 'posted'
          AND movies.telegram_message_id IS NOT NULL
        ORDER BY lower(movies.title) ASC,
                 movies.id ASC,
                 movie_links.sort_order ASC,
                 movie_links.id ASC`
    )
    .all() as MovieCatalogRow[];

  const moviesById = new Map<number, PublicSearchMovie>();

  for (const row of rows) {
    let movie = moviesById.get(row.movie_id);
    if (!movie) {
      movie = {
        id: row.movie_id,
        title: row.title,
        providers: []
      };

      if (row.year !== null) {
        movie.year = row.year;
      }
      if (row.telegram_message_id !== null) {
        movie.telegramMessageId = row.telegram_message_id;
        movie.channelPostUrl = buildChannelPostUrl(channelHandle, row.telegram_message_id);
      }

      moviesById.set(row.movie_id, movie);
    }

    movie.providers.push(mapProvider(row, movie.providers.length + 1));
  }

  return Array.from(moviesById.values());
}

function buildTvShows(db: AppDatabase, channelHandle: string): PublicSearchTvShow[] {
  const rows = db
    .prepare(
      `SELECT tv_shows.id AS tv_show_id,
              tv_shows.title,
              tv_shows.year,
              seasons.id AS season_id,
              seasons.season_number,
              seasons.telegram_message_id,
              episodes.episode_number,
              episode_links.provider_name,
              episode_links.quality,
              episode_links.url,
              episode_links.sort_order
         FROM tv_shows
         JOIN seasons ON seasons.tv_show_id = tv_shows.id
         JOIN episodes ON episodes.season_id = seasons.id
         JOIN episode_links ON episode_links.episode_id = episodes.id
        WHERE episode_links.status = 'active'
          AND seasons.post_status = 'posted'
        ORDER BY lower(tv_shows.title) ASC,
                 tv_shows.id ASC,
                 seasons.season_number ASC,
                 seasons.id ASC,
                 episodes.episode_number ASC,
                 episodes.id ASC,
                 episode_links.sort_order ASC,
                 episode_links.id ASC`
    )
    .all() as TvCatalogRow[];

  const tvShowsById = new Map<number, TvShowAccumulator>();

  for (const row of rows) {
    let tvShowAccumulator = tvShowsById.get(row.tv_show_id);
    if (!tvShowAccumulator) {
      const tvShow: PublicSearchTvShow = {
        id: row.tv_show_id,
        title: row.title,
        seasons: []
      };

      if (row.year !== null) {
        tvShow.year = row.year;
      }

      tvShowAccumulator = {
        tvShow,
        seasonsById: new Map()
      };
      tvShowsById.set(row.tv_show_id, tvShowAccumulator);
    }

    let seasonAccumulator = tvShowAccumulator.seasonsById.get(row.season_id);
    if (!seasonAccumulator) {
      const season: PublicSearchSeason = {
        id: row.season_id,
        seasonNumber: row.season_number,
        episodes: []
      };

      if (row.telegram_message_id !== null) {
        season.telegramMessageId = row.telegram_message_id;
        season.channelPostUrl = buildChannelPostUrl(channelHandle, row.telegram_message_id);
      }

      seasonAccumulator = {
        season,
        episodesByNumber: new Map()
      };
      tvShowAccumulator.seasonsById.set(row.season_id, seasonAccumulator);
      tvShowAccumulator.tvShow.seasons.push(season);
    }

    let episode = seasonAccumulator.episodesByNumber.get(row.episode_number);
    if (!episode) {
      episode = {
        episodeNumber: row.episode_number,
        providers: []
      };
      seasonAccumulator.episodesByNumber.set(row.episode_number, episode);
      seasonAccumulator.season.episodes.push(episode);
    }

    episode.providers.push(mapProvider(row, episode.providers.length + 1));
  }

  return Array.from(tvShowsById.values()).map((accumulator) => accumulator.tvShow);
}

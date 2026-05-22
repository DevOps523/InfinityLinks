import type { AppDatabase } from '../db/database.js';
import type {
  BulkEpisodeInputSchema,
  LinkInputSchema,
  MovieInputSchema,
  SeasonInputSchema,
  TvShowInputSchema
} from './media.schemas.js';
import type { z } from 'zod';

type MovieInput = z.infer<typeof MovieInputSchema>;
type LinkInput = z.infer<typeof LinkInputSchema>;
type TvShowInput = z.infer<typeof TvShowInputSchema>;
type SeasonInput = z.infer<typeof SeasonInputSchema>;
type BulkEpisodeInput = z.infer<typeof BulkEpisodeInputSchema>;

export type MovieLink = {
  id: number;
  movieId: number;
  providerName: string;
  quality: string;
  status: string;
  url: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Movie = {
  id: number;
  tmdbId?: number;
  title: string;
  year?: number;
  posterUrl?: string;
  description: string;
  rating?: number;
  quality: string;
  telegramMessageId?: number;
  postStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type MovieWithLinks = Movie & {
  links: MovieLink[];
};

export type MovieFilters = {
  title?: string;
  year?: number;
};

export type TvShow = {
  id: number;
  tmdbId?: number;
  title: string;
  year?: number;
  posterUrl?: string;
  description: string;
  rating?: number;
  quality: string;
  createdAt: string;
  updatedAt: string;
};

export type Season = {
  id: number;
  tvShowId: number;
  seasonNumber: number;
  telegramMessageId?: number;
  postStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type Episode = {
  id: number;
  seasonId: number;
  episodeNumber: number;
  createdAt: string;
  updatedAt: string;
};

export type EpisodeLink = {
  id: number;
  episodeId: number;
  providerName: string;
  quality: string;
  status: string;
  url: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type TvShowFilters = {
  title?: string;
  year?: number;
};

export type DeletedTvShow = TvShow & {
  seasons: Season[];
};

export type DeletedEpisode = Episode & {
  season: Season;
};

export type DeletedEpisodeLink = EpisodeLink & {
  season: Season;
};

export type EpisodeLinkWithSeason = EpisodeLink & {
  season: Season;
};

export type SeasonPostData = {
  id: number;
  tvShowId: number;
  seasonNumber: number;
  telegramMessageId?: number;
  postStatus: string;
  title: string;
  year?: number;
  posterUrl?: string;
  description: string;
  rating?: number;
  quality: string;
  episodes: Array<Episode & { links: EpisodeLink[] }>;
};

type MovieRow = {
  id: number;
  tmdb_id: number | null;
  title: string;
  year: number | null;
  poster_url: string | null;
  description: string;
  rating: number | null;
  quality: string;
  telegram_message_id: number | null;
  post_status: string;
  created_at: string;
  updated_at: string;
};

type MovieLinkRow = {
  id: number;
  movie_id: number;
  provider_name: string;
  quality: string;
  status: string;
  url: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type TvShowRow = {
  id: number;
  tmdb_id: number | null;
  title: string;
  year: number | null;
  poster_url: string | null;
  description: string;
  rating: number | null;
  quality: string;
  created_at: string;
  updated_at: string;
};

type SeasonRow = {
  id: number;
  tv_show_id: number;
  season_number: number;
  telegram_message_id: number | null;
  post_status: string;
  created_at: string;
  updated_at: string;
};

type EpisodeRow = {
  id: number;
  season_id: number;
  episode_number: number;
  created_at: string;
  updated_at: string;
};

type EpisodeLinkRow = {
  id: number;
  episode_id: number;
  provider_name: string;
  quality: string;
  status: string;
  url: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type SeasonPostRow = SeasonRow & {
  title: string;
  year: number | null;
  poster_url: string | null;
  description: string;
  rating: number | null;
  quality: string;
};

function mapMovie(row: MovieRow): Movie {
  return {
    id: row.id,
    tmdbId: row.tmdb_id ?? undefined,
    title: row.title,
    year: row.year ?? undefined,
    posterUrl: row.poster_url ?? undefined,
    description: row.description,
    rating: row.rating ?? undefined,
    quality: row.quality,
    telegramMessageId: row.telegram_message_id ?? undefined,
    postStatus: row.post_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMovieLink(row: MovieLinkRow): MovieLink {
  return {
    id: row.id,
    movieId: row.movie_id,
    providerName: row.provider_name,
    quality: row.quality,
    status: row.status,
    url: row.url,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTvShow(row: TvShowRow): TvShow {
  return {
    id: row.id,
    tmdbId: row.tmdb_id ?? undefined,
    title: row.title,
    year: row.year ?? undefined,
    posterUrl: row.poster_url ?? undefined,
    description: row.description,
    rating: row.rating ?? undefined,
    quality: row.quality,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSeason(row: SeasonRow): Season {
  return {
    id: row.id,
    tvShowId: row.tv_show_id,
    seasonNumber: row.season_number,
    telegramMessageId: row.telegram_message_id ?? undefined,
    postStatus: row.post_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    seasonId: row.season_id,
    episodeNumber: row.episode_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEpisodeLink(row: EpisodeLinkRow): EpisodeLink {
  return {
    id: row.id,
    episodeId: row.episode_id,
    providerName: row.provider_name,
    quality: row.quality,
    status: row.status,
    url: row.url,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listMovieLinks(db: AppDatabase, movieId: number) {
  return (
    db
      .prepare(
        `SELECT id, movie_id, provider_name, quality, status, url, sort_order, created_at, updated_at
         FROM movie_links
         WHERE movie_id = ?
         ORDER BY sort_order ASC, id ASC`
      )
      .all(movieId) as MovieLinkRow[]
  ).map(mapMovieLink);
}

export function listMovies(db: AppDatabase, filters: MovieFilters = {}) {
  const where: string[] = [];
  const params: Array<number | string> = [];

  if (filters.title) {
    where.push('title LIKE ?');
    params.push(`%${filters.title}%`);
  }

  if (filters.year !== undefined) {
    where.push('year = ?');
    params.push(filters.year);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  return (
    db
      .prepare(
        `SELECT id, tmdb_id, title, year, poster_url, description, rating, quality,
                telegram_message_id, post_status, created_at, updated_at
         FROM movies
         ${whereSql}
         ORDER BY created_at DESC, id DESC`
      )
      .all(...params) as MovieRow[]
  ).map(mapMovie);
}

export function getMovieWithLinks(db: AppDatabase, id: number): MovieWithLinks | undefined {
  const movie = db
    .prepare(
      `SELECT id, tmdb_id, title, year, poster_url, description, rating, quality,
              telegram_message_id, post_status, created_at, updated_at
       FROM movies
       WHERE id = ?`
    )
    .get(id) as MovieRow | undefined;

  if (!movie) {
    return undefined;
  }

  return {
    ...mapMovie(movie),
    links: listMovieLinks(db, id)
  };
}

function insertMovieLink(db: AppDatabase, movieId: number, link: LinkInput, sortOrder: number) {
  db.prepare(
    `INSERT INTO movie_links (movie_id, provider_name, quality, status, url, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(movieId, link.providerName, link.quality, link.status, link.url, sortOrder);
}

export function createMovieWithLinks(db: AppDatabase, input: MovieInput): MovieWithLinks {
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO movies (tmdb_id, title, year, poster_url, description, rating, quality)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.tmdbId ?? null,
        input.title,
        input.year ?? null,
        input.posterUrl ? input.posterUrl : null,
        input.description,
        input.rating ?? null,
        input.quality
      );

    const movieId = Number(result.lastInsertRowid);

    input.links.forEach((link, index) => {
      insertMovieLink(db, movieId, link, index);
    });

    const movie = getMovieWithLinks(db, movieId);
    if (!movie) {
      throw new Error('Created movie could not be loaded');
    }

    return movie;
  })();
}

export function updateMovieWithLinks(db: AppDatabase, id: number, input: MovieInput): MovieWithLinks | undefined {
  return db.transaction(() => {
    const existing = getMovieWithLinks(db, id);

    if (!existing) {
      return undefined;
    }

    db.prepare(
      `UPDATE movies
       SET tmdb_id = ?,
           title = ?,
           year = ?,
           poster_url = ?,
           description = ?,
           rating = ?,
           quality = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      input.tmdbId ?? null,
      input.title,
      input.year ?? null,
      input.posterUrl ? input.posterUrl : null,
      input.description,
      input.rating ?? null,
      input.quality,
      id
    );

    db.prepare('DELETE FROM movie_links WHERE movie_id = ?').run(id);
    input.links.forEach((link, index) => {
      insertMovieLink(db, id, link, index);
    });

    return getMovieWithLinks(db, id);
  })();
}

export function deleteMovie(db: AppDatabase, id: number): MovieWithLinks | undefined {
  return db.transaction(() => {
    const movie = getMovieWithLinks(db, id);

    if (!movie) {
      return undefined;
    }

    db.prepare('DELETE FROM movies WHERE id = ?').run(id);
    return movie;
  })();
}

export function listTvShows(db: AppDatabase, filters: TvShowFilters = {}) {
  const where: string[] = [];
  const params: Array<number | string> = [];

  if (filters.title) {
    where.push('title LIKE ?');
    params.push(`%${filters.title}%`);
  }

  if (filters.year !== undefined) {
    where.push('year = ?');
    params.push(filters.year);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  return (
    db
      .prepare(
        `SELECT id, tmdb_id, title, year, poster_url, description, rating, quality, created_at, updated_at
         FROM tv_shows
         ${whereSql}
         ORDER BY created_at DESC, id DESC`
      )
      .all(...params) as TvShowRow[]
  ).map(mapTvShow);
}

export function createTvShow(db: AppDatabase, input: TvShowInput): TvShow {
  const result = db
    .prepare(
      `INSERT INTO tv_shows (tmdb_id, title, year, poster_url, description, rating, quality)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.tmdbId ?? null,
      input.title,
      input.year ?? null,
      input.posterUrl ? input.posterUrl : null,
      input.description,
      input.rating ?? null,
      input.quality
    );

  const tvShow = getTvShow(db, Number(result.lastInsertRowid));
  if (!tvShow) {
    throw new Error('Created TV show could not be loaded');
  }

  return tvShow;
}

export function getTvShow(db: AppDatabase, id: number): TvShow | undefined {
  const row = db
    .prepare(
      `SELECT id, tmdb_id, title, year, poster_url, description, rating, quality, created_at, updated_at
       FROM tv_shows
       WHERE id = ?`
    )
    .get(id) as TvShowRow | undefined;

  return row ? mapTvShow(row) : undefined;
}

export function updateTvShow(db: AppDatabase, id: number, input: TvShowInput): TvShow | undefined {
  return db.transaction(() => {
    if (!getTvShow(db, id)) {
      return undefined;
    }

    db.prepare(
      `UPDATE tv_shows
       SET tmdb_id = ?,
           title = ?,
           year = ?,
           poster_url = ?,
           description = ?,
           rating = ?,
           quality = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      input.tmdbId ?? null,
      input.title,
      input.year ?? null,
      input.posterUrl ? input.posterUrl : null,
      input.description,
      input.rating ?? null,
      input.quality,
      id
    );

    return getTvShow(db, id);
  })();
}

export function deleteTvShow(db: AppDatabase, id: number): DeletedTvShow | undefined {
  return db.transaction(() => {
    const tvShow = getTvShow(db, id);

    if (!tvShow) {
      return undefined;
    }

    const seasons = listSeasons(db, id);
    db.prepare('DELETE FROM tv_shows WHERE id = ?').run(id);
    return { ...tvShow, seasons };
  })();
}

export function createSeason(db: AppDatabase, tvShowId: number, input: SeasonInput): Season | undefined {
  return db.transaction(() => {
    if (!getTvShow(db, tvShowId)) {
      return undefined;
    }

    const result = db
      .prepare('INSERT INTO seasons (tv_show_id, season_number) VALUES (?, ?)')
      .run(tvShowId, input.seasonNumber);

    return getSeason(db, Number(result.lastInsertRowid));
  })();
}

export function hasSeasonNumber(db: AppDatabase, tvShowId: number, seasonNumber: number, excludeId?: number) {
  const row = db
    .prepare(
      `SELECT 1 AS found
       FROM seasons
       WHERE tv_show_id = ?
         AND season_number = ?
         AND (? IS NULL OR id != ?)`
    )
    .get(tvShowId, seasonNumber, excludeId ?? null, excludeId ?? null) as { found: number } | undefined;

  return Boolean(row);
}

export function listSeasons(db: AppDatabase, tvShowId: number) {
  return (
    db
      .prepare(
        `SELECT id, tv_show_id, season_number, telegram_message_id, post_status, created_at, updated_at
         FROM seasons
         WHERE tv_show_id = ?
         ORDER BY season_number ASC, id ASC`
      )
      .all(tvShowId) as SeasonRow[]
  ).map(mapSeason);
}

export function getSeason(db: AppDatabase, id: number): Season | undefined {
  const row = db
    .prepare(
      `SELECT id, tv_show_id, season_number, telegram_message_id, post_status, created_at, updated_at
       FROM seasons
       WHERE id = ?`
    )
    .get(id) as SeasonRow | undefined;

  return row ? mapSeason(row) : undefined;
}

export function updateSeason(db: AppDatabase, id: number, input: SeasonInput): Season | undefined {
  return db.transaction(() => {
    const season = getSeason(db, id);

    if (!season) {
      return undefined;
    }

    db.prepare(
      `UPDATE seasons
       SET season_number = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(input.seasonNumber, id);

    return getSeason(db, id);
  })();
}

export function deleteSeason(db: AppDatabase, id: number): Season | undefined {
  return db.transaction(() => {
    const season = getSeason(db, id);

    if (!season) {
      return undefined;
    }

    db.prepare('DELETE FROM seasons WHERE id = ?').run(id);
    return season;
  })();
}

export function bulkCreateEpisodes(db: AppDatabase, seasonId: number, input: BulkEpisodeInput): Episode[] | undefined {
  return db.transaction(() => {
    if (!getSeason(db, seasonId)) {
      return undefined;
    }

    const insertEpisode = db.prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, ?)');
    const episodeNumbers = Array.from({ length: input.count }, (_, index) => input.startEpisode + index);
    episodeNumbers.forEach((episodeNumber) => {
      insertEpisode.run(seasonId, episodeNumber);
    });

    return listEpisodes(db, seasonId).filter((episode) => episodeNumbers.includes(episode.episodeNumber));
  })();
}

export function hasEpisodeNumbers(db: AppDatabase, seasonId: number, episodeNumbers: number[], excludeId?: number) {
  if (episodeNumbers.length === 0) {
    return false;
  }

  const placeholders = episodeNumbers.map(() => '?').join(', ');
  const row = db
    .prepare(
      `SELECT 1 AS found
       FROM episodes
       WHERE season_id = ?
         AND episode_number IN (${placeholders})
         AND (? IS NULL OR id != ?)
       LIMIT 1`
    )
    .get(seasonId, ...episodeNumbers, excludeId ?? null, excludeId ?? null) as { found: number } | undefined;

  return Boolean(row);
}

export function listEpisodes(db: AppDatabase, seasonId: number) {
  return (
    db
      .prepare(
        `SELECT id, season_id, episode_number, created_at, updated_at
         FROM episodes
         WHERE season_id = ?
         ORDER BY episode_number ASC, id ASC`
      )
      .all(seasonId) as EpisodeRow[]
  ).map(mapEpisode);
}

export function getEpisode(db: AppDatabase, id: number): Episode | undefined {
  const row = db
    .prepare(
      `SELECT id, season_id, episode_number, created_at, updated_at
       FROM episodes
       WHERE id = ?`
    )
    .get(id) as EpisodeRow | undefined;

  return row ? mapEpisode(row) : undefined;
}

export function updateEpisode(db: AppDatabase, id: number, input: { episodeNumber: number }): DeletedEpisode | undefined {
  return db.transaction(() => {
    const episode = getEpisode(db, id);

    if (!episode) {
      return undefined;
    }

    const season = getSeason(db, episode.seasonId);
    if (!season) {
      return undefined;
    }

    db.prepare(
      `UPDATE episodes
       SET episode_number = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(input.episodeNumber, id);

    const updated = getEpisode(db, id);
    return updated ? { ...updated, season } : undefined;
  })();
}

export function deleteEpisode(db: AppDatabase, id: number): DeletedEpisode | undefined {
  return db.transaction(() => {
    const episode = getEpisode(db, id);

    if (!episode) {
      return undefined;
    }

    const season = getSeason(db, episode.seasonId);
    if (!season) {
      return undefined;
    }

    db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
    return { ...episode, season };
  })();
}

export function addEpisodeLinks(db: AppDatabase, episodeId: number, links: LinkInput[]): EpisodeLink[] | undefined {
  return db.transaction(() => {
    if (!getEpisode(db, episodeId)) {
      return undefined;
    }

    const currentMaxSortOrder = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS sort_order FROM episode_links WHERE episode_id = ?')
      .get(episodeId) as { sort_order: number };
    const insertLink = db.prepare(
      `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const linkIds = links.map((link, index) => {
      const result = insertLink.run(
        episodeId,
        link.providerName,
        link.quality,
        link.status,
        link.url,
        currentMaxSortOrder.sort_order + index + 1
      );
      return Number(result.lastInsertRowid);
    });

    return listEpisodeLinksByIds(db, linkIds);
  })();
}

function listEpisodeLinksByIds(db: AppDatabase, ids: number[]) {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(', ');
  return (
    db
      .prepare(
        `SELECT id, episode_id, provider_name, quality, status, url, sort_order, created_at, updated_at
         FROM episode_links
         WHERE id IN (${placeholders})
         ORDER BY sort_order ASC, id ASC`
      )
      .all(...ids) as EpisodeLinkRow[]
  ).map(mapEpisodeLink);
}

function listEpisodeLinks(db: AppDatabase, episodeId: number) {
  return (
    db
      .prepare(
        `SELECT id, episode_id, provider_name, quality, status, url, sort_order, created_at, updated_at
         FROM episode_links
         WHERE episode_id = ?
         ORDER BY sort_order ASC, id ASC`
      )
      .all(episodeId) as EpisodeLinkRow[]
  ).map(mapEpisodeLink);
}

export function deleteEpisodeLink(db: AppDatabase, id: number): DeletedEpisodeLink | undefined {
  return db.transaction(() => {
    const link = db
      .prepare(
        `SELECT id, episode_id, provider_name, quality, status, url, sort_order, created_at, updated_at
         FROM episode_links
         WHERE id = ?`
      )
      .get(id) as EpisodeLinkRow | undefined;

    if (!link) {
      return undefined;
    }

    const episode = getEpisode(db, link.episode_id);
    if (!episode) {
      return undefined;
    }

    const season = getSeason(db, episode.seasonId);
    if (!season) {
      return undefined;
    }

    db.prepare('DELETE FROM episode_links WHERE id = ?').run(id);
    return { ...mapEpisodeLink(link), season };
  })();
}

export function updateEpisodeLink(db: AppDatabase, id: number, input: LinkInput): EpisodeLinkWithSeason | undefined {
  return db.transaction(() => {
    const link = db
      .prepare(
        `SELECT id, episode_id, provider_name, quality, status, url, sort_order, created_at, updated_at
         FROM episode_links
         WHERE id = ?`
      )
      .get(id) as EpisodeLinkRow | undefined;

    if (!link) {
      return undefined;
    }

    const episode = getEpisode(db, link.episode_id);
    if (!episode) {
      return undefined;
    }

    const season = getSeason(db, episode.seasonId);
    if (!season) {
      return undefined;
    }

    db.prepare(
      `UPDATE episode_links
       SET provider_name = ?,
           quality = ?,
           status = ?,
           url = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(input.providerName, input.quality, input.status, input.url, id);

    const [updated] = listEpisodeLinksByIds(db, [id]);
    return updated ? { ...updated, season } : undefined;
  })();
}

export function getSeasonPostData(db: AppDatabase, seasonId: number): SeasonPostData | undefined {
  const row = db
    .prepare(
      `SELECT seasons.id,
              seasons.tv_show_id,
              seasons.season_number,
              seasons.telegram_message_id,
              seasons.post_status,
              seasons.created_at,
              seasons.updated_at,
              tv_shows.title,
              tv_shows.year,
              tv_shows.poster_url,
              tv_shows.description,
              tv_shows.rating,
              tv_shows.quality
       FROM seasons
       INNER JOIN tv_shows ON tv_shows.id = seasons.tv_show_id
       WHERE seasons.id = ?`
    )
    .get(seasonId) as SeasonPostRow | undefined;

  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    tvShowId: row.tv_show_id,
    seasonNumber: row.season_number,
    telegramMessageId: row.telegram_message_id ?? undefined,
    postStatus: row.post_status,
    title: row.title,
    year: row.year ?? undefined,
    posterUrl: row.poster_url ?? undefined,
    description: row.description,
    rating: row.rating ?? undefined,
    quality: row.quality,
    episodes: listEpisodes(db, seasonId)
      .map((episode) => ({
        ...episode,
        links: listEpisodeLinks(db, episode.id)
      }))
      .filter((episode) => episode.links.length > 0)
  };
}

import type { AppDatabase } from '../db/database.js';
import { formatMovieCaption, formatSeasonCaption } from '../telegram/telegram.formatter.js';
import {
  cancelPendingTelegramDeleteJobs,
  cancelPendingTelegramEditJobs,
  cancelPendingTelegramSendJobs,
  enqueueTelegramJob,
  upsertPendingTelegramDeleteJob,
  upsertActiveTelegramSendJob
} from '../telegram/telegram.queue.js';
import {
  addEpisodeLinks,
  bulkCreateEpisodes,
  createMovieWithLinks,
  createSeason,
  createTvShow as insertTvShow,
  deleteEpisode,
  deleteEpisodeLink,
  deleteMovie,
  deleteSeason,
  deleteTvShow,
  getEpisode,
  getEpisodeLink,
  getEpisodeWithLinks,
  getMovieWithLinks,
  getSeason,
  getSeasonPostData,
  getTvShow,
  hasEpisodeNumbers,
  hasSeasonNumber,
  listEpisodes,
  listMovies,
  listSeasons,
  listTvShows,
  clearSeasonNeedsRepost,
  markSeasonNeedsRepost,
  updateEpisode,
  updateEpisodeLink,
  updateMovieWithLinks,
  updateSeason,
  updateTvShow as updateTvShowRow,
  type MovieWithLinks,
  type Season,
  type SeasonPostData
} from './media.repository.js';
import {
  BulkEpisodeInputSchema,
  EpisodeInputSchema,
  LinkInputSchema,
  MovieInputSchema,
  SeasonInputSchema,
  TvShowInputSchema
} from './media.schemas.js';
import { z } from 'zod';

export class MediaHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

const SearchQuerySchema = z
  .object({
    title: z
      .preprocess((value) => {
        if (value === undefined) {
          return undefined;
        }

        return typeof value === 'string' && value.trim().length === 0 ? undefined : value;
      }, z.string().trim().min(1).optional()),
    year: z
      .preprocess((value) => {
        if (value === undefined || value === '') {
          return undefined;
        }

        if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
          return value;
        }

        return Number(value);
      }, z.number().int().positive().optional())
  })
  .strict();

const EpisodeLinksBodySchema = z.union([
  LinkInputSchema.array().min(1),
  z
    .object({
      links: LinkInputSchema.array().min(1)
    })
    .strict()
]).transform((value) => (Array.isArray(value) ? value : value.links));

function hasLinkedEpisode(postData: SeasonPostData) {
  return postData.episodes.some((episode) => episode.links.length > 0);
}

function buildSeasonPayload(postData: SeasonPostData) {
  if (!postData.posterUrl) {
    return undefined;
  }

  return {
    posterUrl: postData.posterUrl,
    caption: formatSeasonCaption(postData)
  };
}

function isMoviePublishable(movie: MovieWithLinks): movie is MovieWithLinks & { posterUrl: string } {
  return movie.links.length > 0 && Boolean(movie.posterUrl);
}

function syncMoviePostAfterContentChange(db: AppDatabase, movie: MovieWithLinks) {
  if (!isMoviePublishable(movie)) {
    cancelPendingTelegramSendJobs(db, 'movie', movie.id);
    cancelPendingTelegramEditJobs(db, 'movie', movie.id);

    if (movie.telegramMessageId) {
      upsertPendingTelegramDeleteJob(db, 'movie', movie.id, {
        messageId: movie.telegramMessageId
      });
    }

    return;
  }

  cancelPendingTelegramDeleteJobs(db, 'movie', movie.id);

  if (movie.telegramMessageId) {
    enqueueTelegramJob(db, 'edit', 'movie', movie.id, {
      messageId: movie.telegramMessageId,
      caption: formatMovieCaption(movie)
    });
    return;
  }

  upsertActiveTelegramSendJob(db, 'movie', movie.id, {
    posterUrl: movie.posterUrl,
    caption: formatMovieCaption(movie)
  });
}

function syncSeasonPostAfterContentChange(db: AppDatabase, seasonId: number) {
  const postData = getSeasonPostData(db, seasonId);

  if (!postData) {
    return;
  }

  if (!hasLinkedEpisode(postData)) {
    cancelPendingTelegramSendJobs(db, 'season', seasonId);
    cancelPendingTelegramEditJobs(db, 'season', seasonId);

    if (postData.telegramMessageId) {
      upsertPendingTelegramDeleteJob(db, 'season', seasonId, {
        messageId: postData.telegramMessageId
      });
    }

    return;
  }

  cancelPendingTelegramDeleteJobs(db, 'season', seasonId);

  if (postData.telegramMessageId) {
    enqueueTelegramJob(db, 'edit', 'season', seasonId, {
      messageId: postData.telegramMessageId,
      caption: formatSeasonCaption(postData)
    });
    return;
  }

  const payload = buildSeasonPayload(postData);

  if (payload) {
    upsertActiveTelegramSendJob(db, 'season', seasonId, payload);
  } else {
    cancelPendingTelegramSendJobs(db, 'season', seasonId);
  }
}

function queueSeasonDelete(db: AppDatabase, season: Season) {
  cancelPendingTelegramSendJobs(db, 'season', season.id);
  cancelPendingTelegramEditJobs(db, 'season', season.id);

  if (season.telegramMessageId) {
    upsertPendingTelegramDeleteJob(db, 'season', season.id, {
      messageId: season.telegramMessageId
    });
  }
}

function markSeasonRepostableAfterLinkedContentChange(db: AppDatabase, seasonId: number) {
  markSeasonNeedsRepost(db, seasonId);
}

export function createMovie(db: AppDatabase, body: unknown) {
  const input = MovieInputSchema.parse(body);

  return db.transaction(() => {
    const movie = createMovieWithLinks(db, input);

    if (movie.links.length > 0 && movie.posterUrl) {
      enqueueTelegramJob(db, 'send', 'movie', movie.id, {
        posterUrl: movie.posterUrl,
        caption: formatMovieCaption(movie)
      });
    }

    return movie;
  })();
}

export function searchMovies(db: AppDatabase, query: unknown) {
  const filters = SearchQuerySchema.parse(query);

  return listMovies(db, {
    title: filters.title,
    year: filters.year
  });
}

export function getMovie(db: AppDatabase, id: number) {
  return getMovieWithLinks(db, id);
}

export function updateMovie(db: AppDatabase, id: number, body: unknown) {
  const input = MovieInputSchema.parse(body);

  return db.transaction(() => {
    const movie = updateMovieWithLinks(db, id, input);

    if (!movie) {
      return undefined;
    }

    syncMoviePostAfterContentChange(db, movie);

    return movie;
  })();
}

export function removeMovie(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const movie = deleteMovie(db, id);

    cancelPendingTelegramSendJobs(db, 'movie', id);
    cancelPendingTelegramEditJobs(db, 'movie', id);

    if (movie?.telegramMessageId) {
      upsertPendingTelegramDeleteJob(db, 'movie', movie.id, {
        messageId: movie.telegramMessageId
      });
    }

    return movie;
  })();
}

export function searchTvShows(db: AppDatabase, query: unknown) {
  const filters = SearchQuerySchema.parse(query);

  return listTvShows(db, {
    title: filters.title,
    year: filters.year
  });
}

export function createTvShow(db: AppDatabase, body: unknown) {
  const input = TvShowInputSchema.parse(body);
  return insertTvShow(db, input);
}

export function getTvShowById(db: AppDatabase, id: number) {
  return getTvShow(db, id);
}

export function updateTvShow(db: AppDatabase, id: number, body: unknown) {
  const input = TvShowInputSchema.parse(body);

  return db.transaction(() => {
    const tvShow = updateTvShowRow(db, id, input);

    if (!tvShow) {
      return undefined;
    }

    listSeasons(db, id).forEach((season) => {
      syncSeasonPostAfterContentChange(db, season.id);
    });

    return tvShow;
  })();
}

export function removeTvShow(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const tvShow = deleteTvShow(db, id);

    tvShow?.seasons.forEach((season) => {
      queueSeasonDelete(db, season);
    });

    return tvShow;
  })();
}

export function getSeasonsForTvShow(db: AppDatabase, tvShowId: number) {
  return listSeasons(db, tvShowId);
}

export function getSeasonById(db: AppDatabase, id: number) {
  return getSeason(db, id);
}

export function addSeason(db: AppDatabase, tvShowId: number, body: unknown) {
  const input = SeasonInputSchema.parse(body);

  if (hasSeasonNumber(db, tvShowId, input.seasonNumber)) {
    throw new MediaHttpError(409, 'Season number already exists');
  }

  return createSeason(db, tvShowId, input);
}

export function updateSeasonById(db: AppDatabase, id: number, body: unknown) {
  const input = SeasonInputSchema.parse(body);

  return db.transaction(() => {
    const existing = getSeason(db, id);

    if (!existing) {
      return undefined;
    }

    if (hasSeasonNumber(db, existing.tvShowId, input.seasonNumber, id)) {
      throw new MediaHttpError(409, 'Season number already exists');
    }

    const season = updateSeason(db, id, input);
    syncSeasonPostAfterContentChange(db, id);
    return season;
  })();
}

export function removeSeason(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const season = deleteSeason(db, id);

    if (season) {
      queueSeasonDelete(db, season);
    }

    return season;
  })();
}

export function repostSeason(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const season = getSeason(db, id);

    if (!season) {
      return undefined;
    }

    if (!season.canRepost) {
      throw new MediaHttpError(409, 'Season has no new linked episode changes to repost.');
    }

    const postData = getSeasonPostData(db, id);
    if (!postData || !hasLinkedEpisode(postData)) {
      throw new MediaHttpError(409, 'Season is not ready to repost.');
    }

    const payload = buildSeasonPayload(postData);
    if (!payload) {
      throw new MediaHttpError(409, 'Season needs a TV poster before it can be reposted.');
    }

    cancelPendingTelegramEditJobs(db, 'season', id);
    cancelPendingTelegramSendJobs(db, 'season', id);
    cancelPendingTelegramDeleteJobs(db, 'season', id);

    if (postData.telegramMessageId) {
      enqueueTelegramJob(db, 'delete', 'season', id, {
        messageId: postData.telegramMessageId,
        retainEntityState: true
      });
    }
    enqueueTelegramJob(db, 'send', 'season', id, payload);
    clearSeasonNeedsRepost(db, id);

    return getSeason(db, id);
  })();
}

export function getEpisodesForSeason(db: AppDatabase, seasonId: number) {
  return listEpisodes(db, seasonId);
}

export function getEpisodeById(db: AppDatabase, id: number) {
  return getEpisodeWithLinks(db, id);
}

export function createEpisodes(db: AppDatabase, seasonId: number, body: unknown) {
  const input = BulkEpisodeInputSchema.parse(body);

  const season = getSeason(db, seasonId);
  if (!season) {
    return undefined;
  }

  const episodeNumbers = Array.from({ length: input.count }, (_, index) => input.startEpisode + index);
  if (hasEpisodeNumbers(db, seasonId, episodeNumbers)) {
    throw new MediaHttpError(409, 'Episode number already exists');
  }

  return bulkCreateEpisodes(db, seasonId, input);
}

export function updateEpisodeById(db: AppDatabase, id: number, body: unknown) {
  const input = EpisodeInputSchema.parse(body);

  return db.transaction(() => {
    const existing = getEpisode(db, id);

    if (!existing) {
      return undefined;
    }

    if (hasEpisodeNumbers(db, existing.seasonId, [input.episodeNumber], id)) {
      throw new MediaHttpError(409, 'Episode number already exists');
    }

    const episode = updateEpisode(db, id, input);

    if (episode) {
      syncSeasonPostAfterContentChange(db, episode.season.id);
      markSeasonRepostableAfterLinkedContentChange(db, episode.season.id);
    }

    return episode;
  })();
}

export function removeEpisode(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const episode = deleteEpisode(db, id);

    if (episode) {
      syncSeasonPostAfterContentChange(db, episode.season.id);
      markSeasonRepostableAfterLinkedContentChange(db, episode.season.id);
    }

    return episode;
  })();
}

export function createEpisodeLinks(db: AppDatabase, episodeId: number, body: unknown) {
  const input = EpisodeLinksBodySchema.parse(body);

  return db.transaction(() => {
    const links = addEpisodeLinks(db, episodeId, input);

    if (!links) {
      return undefined;
    }

    const seasonId = db
      .prepare('SELECT season_id FROM episodes WHERE id = ?')
      .get(episodeId) as { season_id: number } | undefined;

    if (seasonId) {
      syncSeasonPostAfterContentChange(db, seasonId.season_id);
      markSeasonRepostableAfterLinkedContentChange(db, seasonId.season_id);
    }

    return links;
  })();
}

export function removeEpisodeLink(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const link = deleteEpisodeLink(db, id);

    if (link) {
      syncSeasonPostAfterContentChange(db, link.season.id);
      markSeasonRepostableAfterLinkedContentChange(db, link.season.id);
    }

    return link;
  })();
}

export function getEpisodeLinkById(db: AppDatabase, id: number) {
  return getEpisodeLink(db, id);
}

export function updateEpisodeLinkById(db: AppDatabase, id: number, body: unknown) {
  const input = LinkInputSchema.parse(body);

  return db.transaction(() => {
    const link = updateEpisodeLink(db, id, input);

    if (link) {
      syncSeasonPostAfterContentChange(db, link.season.id);
      markSeasonRepostableAfterLinkedContentChange(db, link.season.id);
    }

    return link;
  })();
}

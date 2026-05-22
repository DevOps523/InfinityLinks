import type { AppDatabase } from '../db/database.js';
import { formatMovieCaption, formatSeasonCaption } from '../telegram/telegram.formatter.js';
import { cancelPendingTelegramSendJobs, enqueueTelegramJob, upsertActiveTelegramSendJob } from '../telegram/telegram.queue.js';
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
  getMovieWithLinks,
  getSeasonPostData,
  listEpisodes,
  listMovies,
  listSeasons,
  listTvShows,
  updateMovieWithLinks,
  type Season,
  type SeasonPostData
} from './media.repository.js';
import { BulkEpisodeInputSchema, LinkInputSchema, MovieInputSchema, SeasonInputSchema, TvShowInputSchema } from './media.schemas.js';
import { z } from 'zod';

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

function hasLinkedEpisode(postData: SeasonPostData) {
  return postData.episodes.some((episode) => episode.links.length > 0);
}

function buildSeasonPayload(postData: SeasonPostData) {
  return {
    posterUrl: postData.posterUrl ?? '',
    caption: formatSeasonCaption(postData)
  };
}

function syncSeasonPostAfterContentChange(db: AppDatabase, seasonId: number) {
  const postData = getSeasonPostData(db, seasonId);

  if (!postData) {
    return;
  }

  if (!hasLinkedEpisode(postData)) {
    cancelPendingTelegramSendJobs(db, 'season', seasonId);

    if (postData.telegramMessageId) {
      enqueueTelegramJob(db, 'delete', 'season', seasonId, {
        messageId: postData.telegramMessageId
      });
    }

    return;
  }

  if (postData.telegramMessageId) {
    enqueueTelegramJob(db, 'edit', 'season', seasonId, {
      messageId: postData.telegramMessageId,
      caption: formatSeasonCaption(postData)
    });
    return;
  }

  upsertActiveTelegramSendJob(db, 'season', seasonId, buildSeasonPayload(postData));
}

function queueSeasonDelete(db: AppDatabase, season: Season) {
  cancelPendingTelegramSendJobs(db, 'season', season.id);

  if (season.telegramMessageId) {
    enqueueTelegramJob(db, 'delete', 'season', season.id, {
      messageId: season.telegramMessageId
    });
  }
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

    if (movie.telegramMessageId) {
      enqueueTelegramJob(db, 'edit', 'movie', movie.id, {
        messageId: movie.telegramMessageId,
        caption: formatMovieCaption(movie)
      });
    } else if (movie.links.length > 0 && movie.posterUrl) {
      upsertActiveTelegramSendJob(db, 'movie', movie.id, {
        posterUrl: movie.posterUrl,
        caption: formatMovieCaption(movie)
      });
    } else {
      cancelPendingTelegramSendJobs(db, 'movie', movie.id);
    }

    return movie;
  })();
}

export function removeMovie(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const movie = deleteMovie(db, id);

    cancelPendingTelegramSendJobs(db, 'movie', id);

    if (movie?.telegramMessageId) {
      enqueueTelegramJob(db, 'delete', 'movie', movie.id, {
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

export function addSeason(db: AppDatabase, tvShowId: number, body: unknown) {
  const input = SeasonInputSchema.parse(body);
  return createSeason(db, tvShowId, input);
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

export function getEpisodesForSeason(db: AppDatabase, seasonId: number) {
  return listEpisodes(db, seasonId);
}

export function createEpisodes(db: AppDatabase, seasonId: number, body: unknown) {
  const input = BulkEpisodeInputSchema.parse(body);
  return bulkCreateEpisodes(db, seasonId, input);
}

export function removeEpisode(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const episode = deleteEpisode(db, id);

    if (episode) {
      syncSeasonPostAfterContentChange(db, episode.season.id);
    }

    return episode;
  })();
}

export function createEpisodeLinks(db: AppDatabase, episodeId: number, body: unknown) {
  const input = LinkInputSchema.array().parse(body);

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
    }

    return links;
  })();
}

export function removeEpisodeLink(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const link = deleteEpisodeLink(db, id);

    if (link) {
      syncSeasonPostAfterContentChange(db, link.season.id);
    }

    return link;
  })();
}

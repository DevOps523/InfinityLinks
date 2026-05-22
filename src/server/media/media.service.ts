import type { AppDatabase } from '../db/database.js';
import { formatMovieCaption } from '../telegram/telegram.formatter.js';
import { enqueueTelegramJob } from '../telegram/telegram.queue.js';
import { createMovieWithLinks, deleteMovie, listMovies } from './media.repository.js';
import { MovieInputSchema } from './media.schemas.js';
import { z } from 'zod';

const MovieSearchQuerySchema = z
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
  .passthrough();

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
  const filters = MovieSearchQuerySchema.parse(query);

  return listMovies(db, {
    title: filters.title,
    year: filters.year
  });
}

export function removeMovie(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const movie = deleteMovie(db, id);

    if (movie?.telegramMessageId) {
      enqueueTelegramJob(db, 'delete', 'movie', movie.id, {
        messageId: movie.telegramMessageId
      });
    }

    return movie;
  })();
}

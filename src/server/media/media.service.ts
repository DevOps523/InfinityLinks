import type { AppDatabase } from '../db/database.js';
import { formatMovieCaption } from '../telegram/telegram.formatter.js';
import { enqueueTelegramJob } from '../telegram/telegram.queue.js';
import { createMovieWithLinks, deleteMovie, listMovies } from './media.repository.js';
import { MovieInputSchema } from './media.schemas.js';

type MovieSearchQuery = {
  title?: unknown;
  year?: unknown;
};

function parseTitle(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseYear(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const year = Number(value);
  return Number.isInteger(year) && year > 0 ? year : undefined;
}

export function createMovie(db: AppDatabase, body: unknown) {
  const input = MovieInputSchema.parse(body);
  const movie = createMovieWithLinks(db, input);

  if (movie.links.length > 0 && movie.posterUrl) {
    enqueueTelegramJob(db, 'send', 'movie', movie.id, {
      posterUrl: movie.posterUrl,
      caption: formatMovieCaption(movie)
    });
  }

  return movie;
}

export function searchMovies(db: AppDatabase, query: MovieSearchQuery) {
  return listMovies(db, {
    title: parseTitle(query.title),
    year: parseYear(query.year)
  });
}

export function removeMovie(db: AppDatabase, id: number) {
  const movie = deleteMovie(db, id);

  if (movie?.telegramMessageId) {
    enqueueTelegramJob(db, 'delete', 'movie', movie.id, {
      messageId: movie.telegramMessageId
    });
  }

  return movie;
}

import type { AppDatabase } from '../db/database.js';
import type { LinkInputSchema, MovieInputSchema } from './media.schemas.js';
import type { z } from 'zod';

type MovieInput = z.infer<typeof MovieInputSchema>;
type LinkInput = z.infer<typeof LinkInputSchema>;

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

export type MovieFilters = {
  title?: string;
  year?: number;
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

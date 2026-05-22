import { Router } from 'express';
import { z } from 'zod';
import type { AppDatabase } from '../db/database.js';
import { createMovie, removeMovie, searchMovies } from './media.service.js';

const MovieIdParamSchema = z.object({
  id: z.preprocess((value) => {
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
      return value;
    }

    return Number(value);
  }, z.number().int().positive())
});

export function createMediaRouter(db: AppDatabase) {
  const router = Router();

  router.get('/movies', (req, res, next) => {
    try {
      const movies = searchMovies(db, req.query);
      res.json({ movies });
    } catch (error) {
      next(error);
    }
  });

  router.post('/movies', (req, res, next) => {
    try {
      const movie = createMovie(db, req.body);
      res.status(201).json({ movie });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/movies/:id', (req, res, next) => {
    try {
      const { id } = MovieIdParamSchema.parse(req.params);
      removeMovie(db, id);

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

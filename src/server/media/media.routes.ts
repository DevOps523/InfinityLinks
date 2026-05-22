import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import { createMovie, removeMovie, searchMovies } from './media.service.js';

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

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
      const id = parseId(req.params.id);

      if (id !== undefined) {
        removeMovie(db, id);
      }

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

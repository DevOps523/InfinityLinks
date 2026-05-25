import { Router } from 'express';
import { z } from 'zod';
import type { AppDatabase } from '../db/database.js';
import {
  addSeason,
  createEpisodeLinks,
  createEpisodes,
  createMovie,
  createTvShow,
  findMovieDuplicates,
  findTvShowDuplicates,
  getEpisodeById,
  getEpisodeLinkById,
  getEpisodesForSeason,
  getMovie,
  getSeasonById,
  getSeasonsForTvShow,
  getTvShowById,
  removeEpisode,
  removeEpisodeLink,
  removeMovie,
  removeSeason,
  removeTvShow,
  repostSeason,
  searchMovies,
  searchTvShows,
  updateEpisodeById,
  updateEpisodeLinkById,
  updateMovie,
  updateSeasonById,
  updateTvShow
} from './media.service.js';

const IdParamSchema = z.object({
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

  router.get('/movies/duplicates', (req, res, next) => {
    try {
      const duplicates = findMovieDuplicates(db, req.query);
      res.json({ duplicates });
    } catch (error) {
      next(error);
    }
  });

  router.get('/movies/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const movie = getMovie(db, id);

      if (!movie) {
        res.status(404).json({ error: 'Movie not found' });
        return;
      }

      res.json({ movie });
    } catch (error) {
      next(error);
    }
  });

  router.put('/movies/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const movie = updateMovie(db, id, req.body);

      if (!movie) {
        res.status(404).json({ error: 'Movie not found' });
        return;
      }

      res.json({ movie });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/movies/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      removeMovie(db, id);

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/tv-shows', (req, res, next) => {
    try {
      const tvShows = searchTvShows(db, req.query);
      res.json({ tvShows });
    } catch (error) {
      next(error);
    }
  });

  router.post('/tv-shows', (req, res, next) => {
    try {
      const tvShow = createTvShow(db, req.body);
      res.status(201).json({ tvShow });
    } catch (error) {
      next(error);
    }
  });

  router.get('/tv-shows/duplicates', (req, res, next) => {
    try {
      const duplicates = findTvShowDuplicates(db, req.query);
      res.json({ duplicates });
    } catch (error) {
      next(error);
    }
  });

  router.get('/tv-shows/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const tvShow = getTvShowById(db, id);

      if (!tvShow) {
        res.status(404).json({ error: 'TV show not found' });
        return;
      }

      res.json({ tvShow });
    } catch (error) {
      next(error);
    }
  });

  router.put('/tv-shows/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const tvShow = updateTvShow(db, id, req.body);

      if (!tvShow) {
        res.status(404).json({ error: 'TV show not found' });
        return;
      }

      res.json({ tvShow });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/tv-shows/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      removeTvShow(db, id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/tv-shows/:id/seasons', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const seasons = getSeasonsForTvShow(db, id);
      res.json({ seasons });
    } catch (error) {
      next(error);
    }
  });

  router.post('/tv-shows/:id/seasons', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const season = addSeason(db, id, req.body);

      if (!season) {
        res.status(404).json({ error: 'TV show not found' });
        return;
      }

      res.status(201).json({ season });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/seasons/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      removeSeason(db, id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/seasons/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const season = getSeasonById(db, id);

      if (!season) {
        res.status(404).json({ error: 'Season not found' });
        return;
      }

      res.json({ season });
    } catch (error) {
      next(error);
    }
  });

  router.put('/seasons/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const season = updateSeasonById(db, id, req.body);

      if (!season) {
        res.status(404).json({ error: 'Season not found' });
        return;
      }

      res.json({ season });
    } catch (error) {
      next(error);
    }
  });

  router.post('/seasons/:id/repost', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const season = repostSeason(db, id);

      if (!season) {
        res.status(404).json({ error: 'Season not found' });
        return;
      }

      res.json({ season });
    } catch (error) {
      next(error);
    }
  });

  router.get('/seasons/:id/episodes', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const episodes = getEpisodesForSeason(db, id);
      res.json({ episodes });
    } catch (error) {
      next(error);
    }
  });

  router.post('/seasons/:id/episodes/bulk', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const episodes = createEpisodes(db, id, req.body);

      if (!episodes) {
        res.status(404).json({ error: 'Season not found' });
        return;
      }

      res.status(201).json({ episodes });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/episodes/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      removeEpisode(db, id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/episodes/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const episode = getEpisodeById(db, id);

      if (!episode) {
        res.status(404).json({ error: 'Episode not found' });
        return;
      }

      res.json({ episode });
    } catch (error) {
      next(error);
    }
  });

  router.put('/episodes/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const episode = updateEpisodeById(db, id, req.body);

      if (!episode) {
        res.status(404).json({ error: 'Episode not found' });
        return;
      }

      res.json({ episode });
    } catch (error) {
      next(error);
    }
  });

  router.post('/episodes/:id/links', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const links = createEpisodeLinks(db, id, req.body);

      if (!links) {
        res.status(404).json({ error: 'Episode not found' });
        return;
      }

      res.status(201).json({ links });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/episode-links/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      removeEpisodeLink(db, id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/episode-links/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const link = getEpisodeLinkById(db, id);

      if (!link) {
        res.status(404).json({ error: 'Episode link not found' });
        return;
      }

      res.json({ link });
    } catch (error) {
      next(error);
    }
  });

  router.put('/episode-links/:id', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const link = updateEpisodeLinkById(db, id, req.body);

      if (!link) {
        res.status(404).json({ error: 'Episode link not found' });
        return;
      }

      res.json({ link });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

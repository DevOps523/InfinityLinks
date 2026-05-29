import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';
import { searchTmdb } from '../../src/server/tmdb/tmdb.service.js';

function setupDb() {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

describe('searchTmdb', () => {
  it('normalizes movie results and caches repeated searches', async () => {
    const db = setupDb();

    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 27205,
            title: 'Inception',
            release_date: '2010-07-16',
            poster_path: '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg',
            overview: 'Cobb steals information by infiltrating the subconscious.',
            vote_average: 8.4
          }
        ]
      })
    }));

    const firstResults = await searchTmdb(db, fetcher, 'test-api-key', 'movie', 'ince');
    const secondResults = await searchTmdb(db, fetcher, 'test-api-key', 'movie', 'ince');

    expect(firstResults).toEqual([
      {
        tmdbId: 27205,
        title: 'Inception',
        year: 2010,
        posterUrl: 'https://image.tmdb.org/t/p/w500/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg',
        rating: 8.4
      }
    ]);
    expect(firstResults[0]).not.toHaveProperty('description');
    expect(secondResults).toEqual(firstResults);
    expect(fetcher).toHaveBeenCalledTimes(1);

    db.close();
  });

  it('returns no results without fetching or logging when query is too short', async () => {
    const db = setupDb();
    const fetcher = vi.fn();

    await expect(searchTmdb(db, fetcher, 'test-api-key', 'movie', 'in')).resolves.toEqual([]);

    expect(fetcher).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) AS count FROM api_logs').get()).toEqual({ count: 0 });
    db.close();
  });

  it('normalizes TV results from name and first_air_date', async () => {
    const db = setupDb();
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 95396,
            name: ' Severance ',
            first_air_date: '2022-02-18',
            poster_path: '/lFf6LLrQjYldcZItzOkGmMMigP7.jpg',
            overview: 'Employees split their work and personal memories.',
            vote_average: 8.3
          }
        ]
      })
    }));

    const results = await searchTmdb(db, fetcher, 'test-api-key', 'tv', 'severance');

    expect(results).toEqual([
      {
        tmdbId: 95396,
        title: 'Severance',
        year: 2022,
        posterUrl: 'https://image.tmdb.org/t/p/w500/lFf6LLrQjYldcZItzOkGmMMigP7.jpg',
        rating: 8.3
      }
    ]);
    expect(results[0]).not.toHaveProperty('description');

    db.close();
  });

  it('logs failed TMDB responses and throws a meaningful error', async () => {
    const db = setupDb();
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({})
    }));

    await expect(searchTmdb(db, fetcher, 'test-api-key', 'movie', 'ince')).rejects.toThrow('TMDB search failed with status 503');

    expect(db.prepare('SELECT provider, action, status FROM api_logs').get()).toEqual({
      provider: 'tmdb',
      action: 'search',
      status: 'failed'
    });
    db.close();
  });

  it('logs successful TMDB responses as succeeded', async () => {
    const db = setupDb();
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [] })
    }));

    await searchTmdb(db, fetcher, 'test-api-key', 'movie', 'ince');

    expect(db.prepare('SELECT provider, action, status FROM api_logs').get()).toEqual({
      provider: 'tmdb',
      action: 'search',
      status: 'succeeded'
    });
    db.close();
  });
});

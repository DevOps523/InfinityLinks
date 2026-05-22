import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';
import { searchTmdb } from '../../src/server/tmdb/tmdb.service.js';

describe('searchTmdb', () => {
  it('normalizes movie results and caches repeated searches', async () => {
    const db = createDatabase(':memory:');
    migrate(db);

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
        description: 'Cobb steals information by infiltrating the subconscious.',
        rating: 8.4
      }
    ]);
    expect(secondResults).toEqual(firstResults);
    expect(fetcher).toHaveBeenCalledTimes(1);

    db.close();
  });
});

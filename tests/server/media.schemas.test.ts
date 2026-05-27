import { describe, expect, it } from 'vitest';
import { MovieInputSchema, TvShowInputSchema } from '../../src/server/media/media.schemas.js';

describe('media input schemas', () => {
  it('accepts empty poster URLs for movies and TV shows', () => {
    expect(
      MovieInputSchema.parse({
        title: 'Movie',
        quality: 'HD',
        posterUrl: ''
      }).posterUrl
    ).toBe('');

    expect(
      TvShowInputSchema.parse({
        title: 'Show',
        quality: 'Full HD',
        posterUrl: ''
      }).posterUrl
    ).toBe('');
  });

  it('rejects unsafe provider URL schemes for movies', () => {
    expect(() =>
      MovieInputSchema.parse({
        title: 'Movie',
        quality: 'HD',
        links: [
          {
            providerName: 'UnsafeHost',
            quality: 'HD',
            status: 'active',
            url: 'javascript:alert(1)'
          }
        ]
      })
    ).toThrow(/URL must use http or https/);
  });

  it('rejects unsafe poster URL schemes for TV shows', () => {
    expect(() =>
      TvShowInputSchema.parse({
        title: 'Show',
        quality: 'Full HD',
        posterUrl: 'data:text/html,<h1>x</h1>'
      })
    ).toThrow(/URL must use http or https/);
  });

  it('accepts any numeric rating for movies and TV shows', () => {
    expect(
      MovieInputSchema.parse({
        title: 'Movie',
        quality: 'HD',
        rating: 12
      }).rating
    ).toBe(12);

    expect(
      TvShowInputSchema.parse({
        title: 'Show',
        quality: 'Full HD',
        rating: -1
      }).rating
    ).toBe(-1);
  });
});

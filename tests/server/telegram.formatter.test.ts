import { describe, expect, it } from 'vitest';
import { formatMovieCaption, formatSeasonCaption } from '../../src/server/telegram/telegram.formatter.js';

describe('telegram caption formatter', () => {
  it('formats movie title/year, rating, quality, links, and footer directly in the caption', () => {
    const caption = formatMovieCaption({
      title: 'Inception',
      year: 2010,
      rating: 8.8,
      quality: 'Full HD',
      links: [{ providerName: 'Provider A', quality: 'Full HD', url: 'https://example.com/a' }]
    });

    expect(caption).toBe(
      [
        '🎬 Inception (2010)',
        '⭐ Rating: 8.8',
        '🎥 Quality: Full HD',
        '',
        '📥 Download Links:',
        '🔗 Provider A - https://example.com/a',
        '',
        '🔎 Search Movies and Series: @dlhubcatalog_bot'
      ].join('\n')
    );
  });

  it('formats season title/year, rating, quality, linked episodes, and footer directly in the caption', () => {
    const caption = formatSeasonCaption({
      title: 'Chronos',
      seasonNumber: 1,
      year: 2025,
      rating: 7.5,
      quality: 'HD',
      episodes: [
        {
          episodeNumber: 1,
          links: [{ providerName: 'Provider A', quality: 'HD', url: 'https://example.com/e1' }]
        }
      ]
    });

    expect(caption).toBe(
      [
        '📺 Chronos (2025) - Season 1',
        '⭐ Rating: 7.5',
        '🎥 Quality: HD',
        '',
        '🎞️ Episode 1',
        '📥 Download Links:',
        '🔗 Provider A - https://example.com/e1',
        '',
        '🔎 Search Movies and Series: @dlhubcatalog_bot'
      ].join('\n')
    );
  });

  it('normalizes null year and rating like missing values', () => {
    const caption = formatMovieCaption({
      title: 'Null Case',
      year: null,
      rating: null,
      quality: 'HD',
      links: []
    });

    expect(caption).toBe(
      [
        '🎬 Null Case',
        '🎥 Quality: HD',
        '',
        '🔎 Search Movies and Series: @dlhubcatalog_bot'
      ].join('\n')
    );
    expect(caption).not.toContain('(null)');
    expect(caption).not.toContain('Rating: null');
  });

  it('omits overflowing required link lines instead of truncating URLs', () => {
    const longLinks = Array.from({ length: 40 }, (_, index) => ({
      providerName: `Provider ${index + 1}`,
      quality: '4K',
      status: 'Active',
      url: `https://example.com/media/${String(index + 1).padStart(2, '0')}/abcdefghijklmnopqrstuvwxyz`
    }));

    const caption = formatMovieCaption({
      title: 'Required Overflow',
      year: 2026,
      rating: 9.4,
      quality: '4K',
      links: longLinks
    });

    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain('Required Overflow (2026)');
    expect(caption).toContain('🔗 Provider 1 - https://example.com/media/01/abcdefghijklmnopqrstuvwxyz');
    expect(caption).toContain('@dlhubcatalog_bot');
    expect(caption).not.toContain('...');

    for (const line of caption.split('\n')) {
      if (line.includes('https://')) {
        expect(line).toMatch(/^🔗 Provider \d+ - https:\/\/example\.com\/media\/\d{2}\/abcdefghijklmnopqrstuvwxyz$/);
      }
    }
  });

  it('reserves footer space when fitting an oversized movie heading', () => {
    const caption = formatMovieCaption({
      title: `Oversized ${'Title '.repeat(220)}`,
      year: 2026,
      rating: 9.9,
      quality: '4K',
      links: [
        {
          providerName: 'Provider A',
          quality: '4K',
          url: 'https://example.com/oversized-title'
        }
      ]
    });

    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain('@dlhubcatalog_bot');
    expect(caption.split('\n')[0]).toContain('Oversized Title');
    expect(caption).not.toContain('https://example.com/oversized-title');
  });
});

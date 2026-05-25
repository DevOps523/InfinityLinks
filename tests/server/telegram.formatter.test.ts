import { describe, expect, it } from 'vitest';
import { formatMovieCaption, formatSeasonCaption } from '../../src/server/telegram/telegram.formatter.js';

describe('telegram caption formatter', () => {
  it('formats movie title/year, rating, quality, description, and links directly in the caption', () => {
    expect(
      formatMovieCaption({
        title: 'Inception',
        year: 2010,
        rating: 8.8,
        quality: '1080p',
        description: 'A thief who steals corporate secrets through dream-sharing technology.',
        links: [
          {
            providerName: 'StreamHub',
            quality: '4K',
            status: 'Active',
            url: 'https://example.com/inception'
          },
          {
            providerName: 'Mirror',
            quality: 'HD',
            url: 'https://mirror.example.com/inception'
          }
        ]
      })
    ).toBe(
      [
        '🎬 Inception (2010)',
        '⭐ Rating: 8.8',
        '🎥 Quality: 1080p',
        '',
        'A thief who steals corporate secrets through dream-sharing technology.',
        '',
        '📥 Download Links:',
        '🔗 StreamHub - https://example.com/inception',
        '🔗 Mirror - https://mirror.example.com/inception',
        '',
        '🔎 Search Movies and Series: @dlhubcatalog_bot'
      ].join('\n')
    );
  });

  it('omits episodes without links and includes linked episodes in season captions', () => {
    const caption = formatSeasonCaption({
      title: 'Chronos',
      year: 2025,
      seasonNumber: 2,
      rating: 7.6,
      quality: 'Full HD',
      description: 'A time-loop anthology.',
      episodes: [
        {
          episodeNumber: 1,
          title: 'Reset',
          links: [
            {
              providerName: 'StreamHub',
              quality: 'HD',
              status: 'Active',
              url: 'https://example.com/chronos/s02e01'
            },
            {
              providerName: 'Mirror',
              quality: 'HD',
              status: 'Active',
              url: 'https://mirror.example.com/chronos/s02e01'
            }
          ]
        },
        {
          episodeNumber: 2,
          title: 'Missing Link',
          links: []
        },
        {
          episodeNumber: 3,
          links: [
            {
              providerName: 'Archive',
              quality: 'SD',
              url: 'https://example.com/chronos/s02e03'
            }
          ]
        }
      ]
    });

    expect(caption).toBe(
      [
        '📺 Chronos (2025) - Season 2',
        '⭐ Rating: 7.6',
        '🎥 Quality: Full HD',
        '',
        'A time-loop anthology.',
        '',
        '🎞️ Episode 1',
        '📥 Download Links:',
        '🔗 StreamHub - https://example.com/chronos/s02e01',
        '🔗 Mirror - https://mirror.example.com/chronos/s02e01',
        '',
        '🎞️ Episode 3',
        '📥 Download Links:',
        '🔗 Archive - https://example.com/chronos/s02e03',
        '',
        '🔎 Search Movies and Series: @dlhubcatalog_bot'
      ].join('\n')
    );
    expect(caption).not.toContain('Missing Link');
    expect(caption).not.toContain('Episode 2');
    expect(caption).not.toContain('Episode 1 - Reset');
  });

  it('trims long descriptions first so required title, meta, and links remain within the caption limit', () => {
    const caption = formatMovieCaption({
      title: 'The Very Long Archive',
      year: 2026,
      rating: 9.1,
      quality: '4K',
      description: `Opening ${'description '.repeat(120)}final sentence that should be trimmed away.`,
      links: [
        {
          providerName: 'Primary',
          quality: '4K',
          status: 'Active',
          url: 'https://example.com/archive/primary'
        },
        {
          providerName: 'Backup',
          quality: '1080p',
          status: 'Standby',
          url: 'https://example.com/archive/backup'
        }
      ]
    });

    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain('The Very Long Archive (2026)');
    expect(caption).toContain('⭐ Rating: 9.1');
    expect(caption).toContain('🎥 Quality: 4K');
    expect(caption).toContain('🔗 Primary - https://example.com/archive/primary');
    expect(caption).toContain('🔗 Backup - https://example.com/archive/backup');
    expect(caption).toContain('🔎 Search Movies and Series: @dlhubcatalog_bot');
    expect(caption).toContain('Opening description');
    expect(caption).toContain('...');
    expect(caption).not.toContain('final sentence that should be trimmed away.');
  });

  it('normalizes null year and rating like missing values', () => {
    const caption = formatMovieCaption({
      title: 'Null Case',
      year: null,
      rating: null,
      quality: 'HD',
      description: 'Nullable database values should not leak into captions.',
      links: []
    });

    expect(caption).toBe(
      [
        '🎬 Null Case',
        '🎥 Quality: HD',
        '',
        'Nullable database values should not leak into captions.',
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
    expect(caption).not.toContain('...');

    for (const line of caption.split('\n')) {
      if (line.includes('https://')) {
        expect(line).toMatch(/^🔗 Provider \d+ - https:\/\/example\.com\/media\/\d{2}\/abcdefghijklmnopqrstuvwxyz$/);
      }
    }
  });
});

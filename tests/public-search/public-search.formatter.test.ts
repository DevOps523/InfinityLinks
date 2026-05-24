import { describe, expect, it } from 'vitest';
import type { PublicSearchResult, PublicSeasonDetails } from '../../src/public-search/search.repository.js';
import {
  formatJoinRequiredMessage,
  formatNoResultsMessage,
  formatSearchResults,
  formatSeasonDetails,
  formatStartMessage,
  formatUnavailableMessage,
  MAX_FORMATTED_MESSAGE_LENGTH
} from '../../src/public-search/bot/formatter.js';
import { decodeSeasonCallback, encodeSeasonCallback } from '../../src/public-search/bot/callback-data.js';

const handles = {
  channelHandle: '@infinitylinks65',
  groupHandle: '@infinitylinks69'
};

describe('public search bot formatter', () => {
  it('formats /start, join-required, no-result, and unavailable messages', () => {
    expect(formatStartMessage(handles).text).toBe(
      [
        'Welcome to InfinityLinks Search.',
        '',
        'Use:',
        '/search movie or tv show name',
        '',
        'Examples:',
        '/search inception',
        '/search breaking bad',
        '',
        'Channel: @infinitylinks65',
        'Group: @infinitylinks69'
      ].join('\n')
    );

    expect(formatJoinRequiredMessage(handles).text).toBe(
      [
        'Please join our channel first, then come back and use /search again.',
        '',
        'Channel: @infinitylinks65',
        'Group: @infinitylinks69'
      ].join('\n')
    );

    expect(formatNoResultsMessage('wrong name', handles).text).toContain(
      'No results found for "wrong name". Try checking the spelling or using fewer words.'
    );
    expect(formatNoResultsMessage('wrong name', handles).text).toContain('Channel: @infinitylinks65');
    expect(formatNoResultsMessage('wrong name', handles).text).toContain('Group: @infinitylinks69');
    expect(formatUnavailableMessage().text).toBe('Search is temporarily unavailable. Please try again later.');
  });

  it('formats movie results with provider URL buttons', () => {
    const results: PublicSearchResult[] = [
      {
        type: 'movie',
        id: 1,
        title: 'Inception',
        year: 2010,
        providers: [
          {
            providerName: 'MixDrop',
            quality: 'HD',
            url: 'https://providers.example/inception-hd',
            sortOrder: 1
          },
          {
            providerName: 'FileMoon',
            quality: '4K',
            url: 'https://providers.example/inception-4k',
            sortOrder: 2
          }
        ]
      }
    ];

    const messages = formatSearchResults(results, handles);

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe(
      [
        'Movie',
        'Inception (2010)',
        '',
        'Providers:',
        '',
        'Channel: @infinitylinks65',
        'Group: @infinitylinks69'
      ].join('\n')
    );
    expect(messages[0].replyMarkup).toEqual({
      inline_keyboard: [
        [
          { text: 'MixDrop HD', url: 'https://providers.example/inception-hd' },
          { text: 'FileMoon 4K', url: 'https://providers.example/inception-4k' }
        ]
      ]
    });
  });

  it('formats TV results with season callback buttons', () => {
    const results: PublicSearchResult[] = [
      {
        type: 'tv',
        id: 10,
        title: 'Breaking Bad',
        year: 2008,
        seasons: [
          { id: 101, seasonNumber: 1 },
          { id: 102, seasonNumber: 2 }
        ]
      }
    ];

    const messages = formatSearchResults(results, handles);

    expect(encodeSeasonCallback(101)).toBe('season:101');
    expect(decodeSeasonCallback('season:102')).toBe(102);
    expect(decodeSeasonCallback('movie:102')).toBeUndefined();
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe(
      [
        'TV Show',
        'Breaking Bad (2008)',
        '',
        'Choose a season:',
        '',
        'Channel: @infinitylinks65',
        'Group: @infinitylinks69'
      ].join('\n')
    );
    expect(messages[0].replyMarkup).toEqual({
      inline_keyboard: [
        [
          { text: 'Season 1', callback_data: 'season:101' },
          { text: 'Season 2', callback_data: 'season:102' }
        ]
      ]
    });
  });

  it('formats season details with provider buttons grouped by episode', () => {
    const details: PublicSeasonDetails = {
      id: 101,
      showTitle: 'Breaking Bad',
      showYear: 2008,
      seasonNumber: 1,
      episodes: [
        {
          episodeNumber: 1,
          providers: [
            {
              providerName: 'MixDrop',
              quality: 'HD',
              url: 'https://providers.example/breaking-bad-s1e1-hd',
              sortOrder: 1
            },
            {
              providerName: 'FileMoon',
              quality: '4K',
              url: 'https://providers.example/breaking-bad-s1e1-4k',
              sortOrder: 2
            }
          ]
        },
        {
          episodeNumber: 2,
          providers: [
            {
              providerName: 'StreamTape',
              quality: 'HD',
              url: 'https://providers.example/breaking-bad-s1e2-hd',
              sortOrder: 1
            }
          ]
        }
      ]
    };

    const messages = formatSeasonDetails(details, handles);

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe(
      [
        'Breaking Bad (2008)',
        'Season 1',
        '',
        'Episode 1',
        'Providers:',
        '',
        'Episode 2',
        'Providers:',
        '',
        'Channel: @infinitylinks65',
        'Group: @infinitylinks69'
      ].join('\n')
    );
    expect(messages[0].replyMarkup).toEqual({
      inline_keyboard: [
        [
          { text: 'MixDrop HD', url: 'https://providers.example/breaking-bad-s1e1-hd' },
          { text: 'FileMoon 4K', url: 'https://providers.example/breaking-bad-s1e1-4k' }
        ],
        [{ text: 'StreamTape HD', url: 'https://providers.example/breaking-bad-s1e2-hd' }]
      ]
    });
  });

  it('splits long season details while keeping episode provider buttons with the matching episode', () => {
    const details: PublicSeasonDetails = {
      id: 101,
      showTitle: 'Long Show',
      showYear: 2026,
      seasonNumber: 1,
      episodes: Array.from({ length: 260 }, (_, index) => ({
        episodeNumber: index + 1,
        providers: [
          {
            providerName: 'Host',
            quality: 'HD',
            url: `https://providers.example/long-show-s1e${index + 1}`,
            sortOrder: 1
          }
        ]
      }))
    };

    const messages = formatSeasonDetails(details, handles);

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.text.length <= MAX_FORMATTED_MESSAGE_LENGTH)).toBe(true);
    expect(messages[0].text).toContain('Episode 1');
    expect(messages[0].replyMarkup?.inline_keyboard[0]).toEqual([
      { text: 'Host HD', url: 'https://providers.example/long-show-s1e1' }
    ]);
    const episode260Message = messages.find((message) => message.text.includes('Episode 260'));
    expect(episode260Message).toBeDefined();
    expect(episode260Message?.replyMarkup?.inline_keyboard.at(-1)).toEqual([
      { text: 'Host HD', url: 'https://providers.example/long-show-s1e260' }
    ]);
  });
});

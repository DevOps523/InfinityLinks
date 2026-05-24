import { describe, expect, it } from 'vitest';
import type { PublicSearchResult, PublicSeasonDetails } from '../src/search.repository.js';
import {
  formatJoinRequiredMessage,
  formatNoResultsMessage,
  formatSearchResults,
  formatSeasonDetails,
  formatStartMessage,
  formatUnavailableMessage,
  MAX_INLINE_KEYBOARD_BUTTONS,
  MAX_INLINE_KEYBOARD_ROWS,
  MAX_FORMATTED_MESSAGE_LENGTH
} from '../src/bot/formatter.js';
import { decodeSeasonCallback, encodeSeasonCallback } from '../src/bot/callback-data.js';

const handles = {
  channelHandle: '@infinitylinks65',
  groupHandle: '@infinitylinks69'
};

const handleButtonRow = [
  { text: '@infinitylinks65', url: 'https://t.me/infinitylinks65' },
  { text: '@infinitylinks69', url: 'https://t.me/infinitylinks69' }
];

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
    expect(formatStartMessage(handles).replyMarkup).toEqual({ inline_keyboard: [handleButtonRow] });

    expect(formatJoinRequiredMessage(handles).text).toBe(
      [
        'Please join our channel first, then come back and use /search again.',
        '',
        'Channel: @infinitylinks65',
        'Group: @infinitylinks69'
      ].join('\n')
    );
    expect(formatJoinRequiredMessage(handles).replyMarkup).toEqual({ inline_keyboard: [handleButtonRow] });

    expect(formatNoResultsMessage(handles).text).toBe(
      [
        'No results found. Try checking the spelling or using fewer words.',
        '',
        'Channel: @infinitylinks65',
        'Group: @infinitylinks69'
      ].join('\n')
    );
    expect(formatNoResultsMessage(handles).replyMarkup).toEqual({ inline_keyboard: [handleButtonRow] });
    expect(formatUnavailableMessage().text).toBe('Search is temporarily unavailable. Please try again later.');
  });

  it('formats movie results with provider URL buttons', () => {
    const results: PublicSearchResult[] = [
      {
        type: 'movie',
        id: 1,
        title: 'Inception',
        year: 2010,
        channelPostUrl: 'https://t.me/infinitylinks65/101',
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
        [{ text: 'Original Post', url: 'https://t.me/infinitylinks65/101' }],
        [
          { text: 'MixDrop HD', url: 'https://providers.example/inception-hd' },
          { text: 'FileMoon 4K', url: 'https://providers.example/inception-4k' }
        ],
        handleButtonRow
      ]
    });
  });

  it('chunks many movie provider buttons into small rows', () => {
    const results: PublicSearchResult[] = [
      {
        type: 'movie',
        id: 1,
        title: 'Provider Test',
        year: 2026,
        providers: Array.from({ length: 5 }, (_, index) => ({
          providerName: `Host${index + 1}`,
          quality: 'HD',
          url: `https://providers.example/movie-${index + 1}`,
          sortOrder: index + 1
        }))
      }
    ];

    const messages = formatSearchResults(results, handles);

    expect(messages[0].replyMarkup?.inline_keyboard).toEqual([
      [
        { text: 'Host1 HD', url: 'https://providers.example/movie-1' },
        { text: 'Host2 HD', url: 'https://providers.example/movie-2' }
      ],
      [
        { text: 'Host3 HD', url: 'https://providers.example/movie-3' },
        { text: 'Host4 HD', url: 'https://providers.example/movie-4' }
      ],
      [{ text: 'Host5 HD', url: 'https://providers.example/movie-5' }],
      handleButtonRow
    ]);
  });

  it('splits movie result keyboards before Telegram limits are exceeded', () => {
    const results: PublicSearchResult[] = [
      {
        type: 'movie',
        id: 1,
        title: 'Provider Limit',
        year: 2026,
        channelPostUrl: 'https://t.me/infinitylinks65/401',
        providers: Array.from({ length: 39 }, (_, index) => ({
          providerName: `Host${index + 1}`,
          quality: 'HD',
          url: `https://providers.example/provider-limit-${index + 1}`,
          sortOrder: index + 1
        }))
      }
    ];

    const messages = formatSearchResults(results, handles);

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      const rows = message.replyMarkup?.inline_keyboard ?? [];

      expect(message.text).toContain('Provider Limit (2026)');
      expect(rows.length).toBeLessThanOrEqual(MAX_INLINE_KEYBOARD_ROWS);
      expect(rows.reduce((total, row) => total + row.length, 0)).toBeLessThanOrEqual(MAX_INLINE_KEYBOARD_BUTTONS);
      expect(rows[0]).toEqual([{ text: 'Original Post', url: 'https://t.me/infinitylinks65/401' }]);
      expect(rows.at(-1)).toEqual(handleButtonRow);
    }
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
        ],
        handleButtonRow
      ]
    });
  });

  it('chunks many TV season callback buttons into small rows', () => {
    const results: PublicSearchResult[] = [
      {
        type: 'tv',
        id: 10,
        title: 'Season Test',
        year: 2026,
        seasons: Array.from({ length: 7 }, (_, index) => ({
          id: 201 + index,
          seasonNumber: index + 1
        }))
      }
    ];

    const messages = formatSearchResults(results, handles);

    expect(messages[0].replyMarkup?.inline_keyboard).toEqual([
      [
        { text: 'Season 1', callback_data: 'season:201' },
        { text: 'Season 2', callback_data: 'season:202' },
        { text: 'Season 3', callback_data: 'season:203' }
      ],
      [
        { text: 'Season 4', callback_data: 'season:204' },
        { text: 'Season 5', callback_data: 'season:205' },
        { text: 'Season 6', callback_data: 'season:206' }
      ],
      [{ text: 'Season 7', callback_data: 'season:207' }],
      handleButtonRow
    ]);
  });

  it('splits TV season keyboards before Telegram limits are exceeded', () => {
    const results: PublicSearchResult[] = [
      {
        type: 'tv',
        id: 10,
        title: 'Season Limit',
        year: 2026,
        seasons: Array.from({ length: 40 }, (_, index) => ({
          id: 300 + index,
          seasonNumber: index + 1
        }))
      }
    ];

    const messages = formatSearchResults(results, handles);

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      const rows = message.replyMarkup?.inline_keyboard ?? [];

      expect(message.text).toContain('Season Limit (2026)');
      expect(rows.length).toBeLessThanOrEqual(MAX_INLINE_KEYBOARD_ROWS);
      expect(rows.reduce((total, row) => total + row.length, 0)).toBeLessThanOrEqual(MAX_INLINE_KEYBOARD_BUTTONS);
      expect(rows.at(-1)).toEqual(handleButtonRow);
    }
    expect(messages[0].replyMarkup?.inline_keyboard.at(-2)?.at(-1)).toEqual({
      text: 'Season 36',
      callback_data: 'season:335'
    });
    expect(messages[1].replyMarkup?.inline_keyboard[0]).toEqual([
      { text: 'Season 37', callback_data: 'season:336' },
      { text: 'Season 38', callback_data: 'season:337' },
      { text: 'Season 39', callback_data: 'season:338' }
    ]);
  });

  it('formats season details with provider buttons grouped by episode', () => {
    const details: PublicSeasonDetails = {
      id: 101,
      showTitle: 'Breaking Bad',
      showYear: 2008,
      seasonNumber: 1,
      channelPostUrl: 'https://t.me/infinitylinks65/301',
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
        [{ text: 'Original Post', url: 'https://t.me/infinitylinks65/301' }],
        [
          { text: 'E1 MixDrop HD', url: 'https://providers.example/breaking-bad-s1e1-hd' },
          { text: 'E1 FileMoon 4K', url: 'https://providers.example/breaking-bad-s1e1-4k' }
        ],
        [{ text: 'E2 StreamTape HD', url: 'https://providers.example/breaking-bad-s1e2-hd' }],
        handleButtonRow
      ]
    });
  });

  it('labels repeated season provider buttons with episode numbers', () => {
    const details: PublicSeasonDetails = {
      id: 101,
      showTitle: 'Repeated Hosts',
      showYear: 2026,
      seasonNumber: 1,
      episodes: [
        {
          episodeNumber: 1,
          providers: [
            {
              providerName: 'MixDrop',
              quality: 'HD',
              url: 'https://providers.example/repeated-s1e1',
              sortOrder: 1
            }
          ]
        },
        {
          episodeNumber: 2,
          providers: [
            {
              providerName: 'MixDrop',
              quality: 'HD',
              url: 'https://providers.example/repeated-s1e2',
              sortOrder: 1
            }
          ]
        }
      ]
    };

    const messages = formatSeasonDetails(details, handles);

    expect(messages[0].replyMarkup?.inline_keyboard).toEqual([
      [{ text: 'E1 MixDrop HD', url: 'https://providers.example/repeated-s1e1' }],
      [{ text: 'E2 MixDrop HD', url: 'https://providers.example/repeated-s1e2' }],
      handleButtonRow
    ]);
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
      { text: 'E1 Host HD', url: 'https://providers.example/long-show-s1e1' }
    ]);
    const episode260Message = messages.find((message) => message.text.includes('Episode 260'));
    expect(episode260Message).toBeDefined();
    expect(episode260Message?.replyMarkup?.inline_keyboard.at(-2)).toEqual([
      { text: 'E260 Host HD', url: 'https://providers.example/long-show-s1e260' }
    ]);
    expect(episode260Message?.replyMarkup?.inline_keyboard.at(-1)).toEqual(handleButtonRow);
  });

  it('splits season details when inline keyboard row limits are reached', () => {
    const details: PublicSeasonDetails = {
      id: 101,
      showTitle: 'Keyboard Limit Show',
      showYear: 2026,
      seasonNumber: 1,
      episodes: Array.from({ length: MAX_INLINE_KEYBOARD_ROWS + 1 }, (_, index) => ({
        episodeNumber: index + 1,
        providers: [
          {
            providerName: 'Host',
            quality: 'HD',
            url: `https://providers.example/keyboard-limit-s1e${index + 1}`,
            sortOrder: 1
          }
        ]
      }))
    };

    const messages = formatSeasonDetails(details, handles);

    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.text.length < MAX_FORMATTED_MESSAGE_LENGTH)).toBe(true);
    expect(messages[0].replyMarkup?.inline_keyboard).toHaveLength(MAX_INLINE_KEYBOARD_ROWS);
    expect(messages[0].replyMarkup?.inline_keyboard.at(-1)).toEqual(handleButtonRow);
    expect(messages[1].replyMarkup?.inline_keyboard).toEqual([
      [
        {
          text: `E${MAX_INLINE_KEYBOARD_ROWS} Host HD`,
          url: `https://providers.example/keyboard-limit-s1e${MAX_INLINE_KEYBOARD_ROWS}`
        }
      ],
      [
        {
          text: `E${MAX_INLINE_KEYBOARD_ROWS + 1} Host HD`,
          url: `https://providers.example/keyboard-limit-s1e${MAX_INLINE_KEYBOARD_ROWS + 1}`
        }
      ],
      handleButtonRow
    ]);
  });

  it('splits one episode with too many provider buttons across safe messages', () => {
    const details: PublicSeasonDetails = {
      id: 101,
      showTitle: 'Big Episode Show',
      showYear: 2026,
      seasonNumber: 1,
      episodes: [
        {
          episodeNumber: 1,
          providers: Array.from({ length: MAX_INLINE_KEYBOARD_BUTTONS + 1 }, (_, index) => ({
            providerName: `Host${index + 1}`,
            quality: 'HD',
            url: `https://providers.example/big-episode-s1e1-${index + 1}`,
            sortOrder: index + 1
          }))
        }
      ]
    };

    const messages = formatSeasonDetails(details, handles);

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      const rows = message.replyMarkup?.inline_keyboard ?? [];

      expect(message.text.length).toBeLessThanOrEqual(MAX_FORMATTED_MESSAGE_LENGTH);
      expect(message.text).toContain('Episode 1');
      expect(rows.length).toBeLessThanOrEqual(MAX_INLINE_KEYBOARD_ROWS);
      expect(rows.reduce((total, row) => total + row.length, 0)).toBeLessThanOrEqual(MAX_INLINE_KEYBOARD_BUTTONS);
      expect(rows.flat().filter((button) => !button.text.startsWith('@')).every((button) => button.text.startsWith('E1 '))).toBe(true);
    }
    expect(messages[0].replyMarkup?.inline_keyboard.at(-2)?.at(-1)).toEqual({
      text: `E1 Host${MAX_INLINE_KEYBOARD_BUTTONS - 2} HD`,
      url: `https://providers.example/big-episode-s1e1-${MAX_INLINE_KEYBOARD_BUTTONS - 2}`
    });
    expect(messages[0].replyMarkup?.inline_keyboard.at(-1)).toEqual(handleButtonRow);
    expect(messages[1].replyMarkup?.inline_keyboard[0]).toEqual([
      {
        text: `E1 Host${MAX_INLINE_KEYBOARD_BUTTONS - 1} HD`,
        url: `https://providers.example/big-episode-s1e1-${MAX_INLINE_KEYBOARD_BUTTONS - 1}`
      },
      {
        text: `E1 Host${MAX_INLINE_KEYBOARD_BUTTONS} HD`,
        url: `https://providers.example/big-episode-s1e1-${MAX_INLINE_KEYBOARD_BUTTONS}`
      }
    ]);
    expect(messages[1].replyMarkup?.inline_keyboard.at(-1)).toEqual(handleButtonRow);
  });
});

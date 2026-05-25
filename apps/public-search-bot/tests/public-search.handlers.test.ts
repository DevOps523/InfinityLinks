import { describe, expect, it, vi } from 'vitest';
import { replacePublicCatalog } from '../src/catalog.repository.js';
import { createPublicSearchDatabase, type PublicSearchDatabase } from '../src/db/database.js';
import { migratePublicSearchDatabase } from '../src/db/migrate.js';
import { createReplyThrottleState, handleTelegramUpdate, type HandlerDeps } from '../src/bot/handlers.js';
import type { PublicSearchCatalog } from '../src/catalog.schema.js';
import type { InlineKeyboardMarkup, TelegramUpdate } from '../src/telegram.client.js';

const handles = {
  groupHandle: '@infinitylinks69'
};

const membershipVerificationMessage = [
  'We could not verify your group membership right now. Please join the group and try again.',
  '',
  '👥 Group: @infinitylinks69'
].join('\n');

type SentMessage = {
  chatId: number;
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
};

type CallbackAnswer = {
  callbackQueryId: string;
  text?: string;
};

type Provider = PublicSearchCatalog['movies'][number]['providers'][number];
type NonEmptyProviders = [Provider, ...Provider[]];

function providers(...items: NonEmptyProviders): NonEmptyProviders {
  return items;
}

function createMigratedDatabase() {
  const db = createPublicSearchDatabase(':memory:');
  migratePublicSearchDatabase(db);
  return db;
}

function seedCatalog(db: PublicSearchDatabase) {
  replacePublicCatalog(db, {
    generatedAt: '2026-05-24T00:00:00.000Z',
    groupHandle: handles.groupHandle,
    movies: [
      {
        id: 1,
        title: 'Inception',
        year: 2010,
        telegramMessageId: 101,
        channelPostUrl: 'https://t.me/infinitylinks65/101',
        providers: providers(
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
        )
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: 100 + index,
        title: `Limit Match ${String(index + 1).padStart(2, '0')}`,
        year: 2010 + index,
        telegramMessageId: 200 + index,
        channelPostUrl: `https://t.me/infinitylinks65/${200 + index}`,
        providers: providers(
          {
            providerName: 'LimitHost',
            quality: 'HD',
            url: `https://providers.example/limit-${index + 1}`,
            sortOrder: 1
          }
        )
      }))
    ],
    tvShows: [
      {
        id: 20,
        title: 'Breaking Bad',
        year: 2008,
        seasons: [
          {
            id: 30,
            seasonNumber: 1,
            telegramMessageId: 301,
            channelPostUrl: 'https://t.me/infinitylinks65/301',
            episodes: [
              {
                episodeNumber: 1,
                providers: providers(
                  {
                    providerName: 'StreamTape',
                    quality: 'HD',
                    url: 'https://providers.example/breaking-s1e1',
                    sortOrder: 1
                  }
                )
              },
              {
                episodeNumber: 2,
                providers: providers(
                  {
                    providerName: 'MixDrop',
                    quality: 'HD',
                    url: 'https://providers.example/breaking-s1e2',
                    sortOrder: 1
                  }
                )
              }
            ]
          },
          {
            id: 31,
            seasonNumber: 2,
            telegramMessageId: 302,
            channelPostUrl: 'https://t.me/infinitylinks65/302',
            episodes: [
              {
                episodeNumber: 1,
                providers: providers(
                  {
                    providerName: 'FileMoon',
                    quality: '4K',
                    url: 'https://providers.example/breaking-s2e1',
                    sortOrder: 1
                  }
                )
              }
            ]
          }
        ]
      }
    ]
  });
}

function messageUpdate(text: string, overrides: Partial<TelegramUpdate['message']> = {}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      chat: { id: 500 },
      from: { id: 42 },
      text,
      ...overrides
    }
  };
}

function callbackUpdate(data: string | undefined, overrides: Partial<TelegramUpdate['callback_query']> = {}): TelegramUpdate {
  return {
    update_id: 2,
    callback_query: {
      id: 'callback-1',
      from: { id: 42 },
      message: {
        message_id: 11,
        chat: { id: 500 }
      },
      data,
      ...overrides
    }
  };
}

function createDeps(db: PublicSearchDatabase, overrides: Partial<HandlerDeps> = {}) {
  const sentMessages: SentMessage[] = [];
  const callbackAnswers: CallbackAnswer[] = [];
  const deps: HandlerDeps = {
    db,
    telegram: {
      getChatMember: vi.fn(async () => ({ status: 'member' }))
    },
    replies: {
      enqueueSendMessage: vi.fn(async (input: SentMessage) => {
        sentMessages.push(input);
      }),
      enqueueAnswerCallbackQuery: vi.fn(async (input: CallbackAnswer) => {
        callbackAnswers.push(input);
      })
    },
    rateLimiter: {
      check: vi.fn(() => ({ allowed: true as const }))
    },
    replyThrottleState: createReplyThrottleState(),
    ...handles,
    ...overrides
  };

  return { deps, sentMessages, callbackAnswers };
}

describe('public search bot handlers', () => {
  it('replies to /start with usage without requiring membership', async () => {
    const db = createMigratedDatabase();

    try {
      const { deps, sentMessages } = createDeps(db);

      await handleTelegramUpdate(deps, messageUpdate('/start'));

      expect(deps.telegram.getChatMember).not.toHaveBeenCalled();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toContain('Welcome to DownloadHub Search.');
      expect(sentMessages[0].text).toContain('/search movie or tv show name');
      expect(sentMessages[0].replyMarkup).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('replies to /search with no query with validation without requiring membership', async () => {
    const db = createMigratedDatabase();

    try {
      const { deps, sentMessages } = createDeps(db);

      await handleTelegramUpdate(deps, messageUpdate('/search'));

      expect(deps.telegram.getChatMember).not.toHaveBeenCalled();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toBe(
        ['⚠️ Please provide a movie or TV show title.', '', 'Example: /search inception'].join('\n')
      );
      expect(sentMessages[0].replyMarkup).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('replies to /clear with a clear message without requiring membership', async () => {
    const db = createMigratedDatabase();

    try {
      const { deps, sentMessages } = createDeps(db);

      await handleTelegramUpdate(deps, messageUpdate('/clear'));

      expect(deps.telegram.getChatMember).not.toHaveBeenCalled();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toBe('🧹 Cleared. Search anytime with /search movie or tv show name.');
      expect(sentMessages[0].replyMarkup).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('allows the first /start response even when the shared reply limiter would block', async () => {
    const db = createMigratedDatabase();

    try {
      const { deps, sentMessages } = createDeps(db, {
        rateLimiter: {
          check: vi.fn(() => ({ allowed: false as const, retryAfterMs: 60_000 }))
        }
      });

      await handleTelegramUpdate(deps, messageUpdate('/start', { from: { id: 99 } }));

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toContain('Welcome to DownloadHub Search.');
    } finally {
      db.close();
    }
  });

  it('uses isolated first-start state per handler dependency object', async () => {
    const firstDb = createMigratedDatabase();
    const secondDb = createMigratedDatabase();

    try {
      const blockedLimiter = () => ({
        check: vi.fn(() => ({ allowed: false as const, retryAfterMs: 60_000 }))
      });
      const first = createDeps(firstDb, { rateLimiter: blockedLimiter() });
      const second = createDeps(secondDb, { rateLimiter: blockedLimiter() });

      await handleTelegramUpdate(first.deps, messageUpdate('/start', { from: { id: 99 } }));
      await handleTelegramUpdate(second.deps, messageUpdate('/start', { from: { id: 99 } }));

      expect(first.sentMessages).toHaveLength(1);
      expect(first.sentMessages[0].text).toContain('Welcome to DownloadHub Search.');
      expect(second.sentMessages).toHaveLength(1);
      expect(second.sentMessages[0].text).toContain('Welcome to DownloadHub Search.');
    } finally {
      firstDb.close();
      secondDb.close();
    }
  });

  it('uses the normal reply limiter for repeated /start commands', async () => {
    const db = createMigratedDatabase();

    try {
      const { deps, sentMessages } = createDeps(db, {
        rateLimiter: {
          check: vi.fn(() => ({ allowed: false as const, retryAfterMs: 60_000 }))
        }
      });

      await handleTelegramUpdate(deps, messageUpdate('/start', { from: { id: 99 } }));
      await handleTelegramUpdate(deps, messageUpdate('/start', { from: { id: 99 } }));

      expect(sentMessages).toHaveLength(2);
      expect(sentMessages[0].text).toContain('Welcome to DownloadHub Search.');
      expect(sentMessages[1].text).toBe('Please wait 60 seconds before trying again.');
    } finally {
      db.close();
    }
  });

  it('rate limits repeated low-value message replies before enqueueing them', async () => {
    const db = createMigratedDatabase();

    try {
      const { deps, sentMessages } = createDeps(db, {
        rateLimiter: {
          check: vi
            .fn()
            .mockReturnValueOnce({ allowed: true as const })
            .mockReturnValueOnce({ allowed: false as const, retryAfterMs: 30_000 })
        }
      });

      await handleTelegramUpdate(deps, messageUpdate('/clear'));
      await handleTelegramUpdate(deps, messageUpdate('/clear'));

      expect(sentMessages).toHaveLength(2);
      expect(sentMessages[0].text).toContain('Cleared');
      expect(sentMessages[1].text).toBe('Please wait 30 seconds before trying again.');
    } finally {
      db.close();
    }
  });

  it('rate limits repeated unknown slash commands without requiring membership', async () => {
    const db = createMigratedDatabase();

    try {
      const { deps, sentMessages } = createDeps(db, {
        rateLimiter: {
          check: vi
            .fn()
            .mockReturnValueOnce({ allowed: true as const })
            .mockReturnValueOnce({ allowed: false as const, retryAfterMs: 30_000 })
        }
      });

      await handleTelegramUpdate(deps, messageUpdate('/wat'));
      await handleTelegramUpdate(deps, messageUpdate('/wat'));

      expect(deps.telegram.getChatMember).not.toHaveBeenCalled();
      expect(sentMessages).toHaveLength(2);
      expect(sentMessages[0].text).toContain('Welcome to DownloadHub Search.');
      expect(sentMessages[1].text).toBe('Please wait 30 seconds before trying again.');
    } finally {
      db.close();
    }
  });

  it('does not enqueue repeated wait messages for already throttled users', async () => {
    const db = createMigratedDatabase();

    try {
      const { deps, sentMessages } = createDeps(db, {
        rateLimiter: {
          check: vi.fn(() => ({ allowed: false as const, retryAfterMs: 30_000 }))
        }
      });

      await handleTelegramUpdate(deps, messageUpdate('/clear'));
      await handleTelegramUpdate(deps, messageUpdate('/clear'));

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toBe('Please wait 30 seconds before trying again.');
    } finally {
      db.close();
    }
  });

  it('allows another wait message after the retry window expires', async () => {
    const db = createMigratedDatabase();
    let now = 1_000;

    try {
      const { deps, sentMessages } = createDeps(db, {
        rateLimiter: {
          check: vi.fn(() => ({ allowed: false as const, retryAfterMs: 30_000 }))
        },
        replyThrottleState: createReplyThrottleState({ now: () => now })
      });

      await handleTelegramUpdate(deps, messageUpdate('/clear'));
      await handleTelegramUpdate(deps, messageUpdate('/clear'));
      now += 30_000;
      await handleTelegramUpdate(deps, messageUpdate('/clear'));

      expect(sentMessages).toHaveLength(2);
      expect(sentMessages[0].text).toBe('Please wait 30 seconds before trying again.');
      expect(sentMessages[1].text).toBe('Please wait 30 seconds before trying again.');
    } finally {
      db.close();
    }
  });

  it('rate limits callback replies before catalog details are loaded', async () => {
    const db = createMigratedDatabase();
    seedCatalog(db);

    try {
      const { deps, callbackAnswers, sentMessages } = createDeps(db, {
        rateLimiter: {
          check: vi.fn(() => ({ allowed: false as const, retryAfterMs: 10_000 }))
        }
      });

      await handleTelegramUpdate(deps, callbackUpdate('season:30'));

      expect(callbackAnswers).toEqual([
        {
          callbackQueryId: 'callback-1',
          text: 'Please wait 10 seconds before trying again.'
        }
      ]);
      expect(sentMessages).toHaveLength(0);
      expect(deps.telegram.getChatMember).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('blocks /search when the user has left the group', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages } = createDeps(db, {
        telegram: {
          getChatMember: vi.fn(async () => ({ status: 'left' }))
        }
      });

      await handleTelegramUpdate(deps, messageUpdate('/search inception'));

      expect(deps.telegram.getChatMember).toHaveBeenCalledWith({
        chatId: '@infinitylinks69',
        userId: 42
      });
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toBe(membershipVerificationMessage);
      expect(sentMessages[0].text).not.toContain('providers.example');
      expect(sentMessages[0].replyMarkup).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('returns movie provider links as text for a group member', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages } = createDeps(db);

      await handleTelegramUpdate(deps, messageUpdate('/search inception'));

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toContain('🎬 Movie');
      expect(sentMessages[0].text).toContain('Inception (2010)');
      expect(sentMessages[0].text).toContain('🔗 Download Links:');
      expect(sentMessages[0].text).toContain('📁 MixDrop HD - https://providers.example/inception-hd');
      expect(sentMessages[0].text).toContain('📁 FileMoon 4K - https://providers.example/inception-4k');
      expect(sentMessages[0].text).toContain('📌 Original Post:');
      expect(sentMessages[0].text).toContain('https://t.me/infinitylinks65/101');
      expect(sentMessages[0].text).not.toContain('📢 Channel:');
      expect(sentMessages[0].text).toContain('👥 Group: @infinitylinks69');
      expect(sentMessages[0].replyMarkup).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('returns TV season callback buttons for a group member', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages } = createDeps(db);

      await handleTelegramUpdate(deps, messageUpdate('/search breaking'));

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toContain('TV Show');
      expect(sentMessages[0].text).toContain('Breaking Bad (2008)');
      expect(sentMessages[0].replyMarkup).toEqual({
        inline_keyboard: [
          [
            { text: 'Season 1', callback_data: 'season:30' },
            { text: 'Season 2', callback_data: 'season:31' }
          ]
        ]
      });
    } finally {
      db.close();
    }
  });

  it('limits search results to 10 messages', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages } = createDeps(db);

      await handleTelegramUpdate(deps, messageUpdate('/search limit match'));

      expect(sentMessages).toHaveLength(10);
      expect(sentMessages.map((message) => message.text.split('\n')[1])).toEqual([
        'Limit Match 01 (2010)',
        'Limit Match 02 (2011)',
        'Limit Match 03 (2012)',
        'Limit Match 04 (2013)',
        'Limit Match 05 (2014)',
        'Limit Match 06 (2015)',
        'Limit Match 07 (2016)',
        'Limit Match 08 (2017)',
        'Limit Match 09 (2018)',
        'Limit Match 10 (2019)'
      ]);
    } finally {
      db.close();
    }
  });

  it('returns unavailable when no catalog has been synced', async () => {
    const db = createMigratedDatabase();

    try {
      const { deps, sentMessages } = createDeps(db);

      await handleTelegramUpdate(deps, messageUpdate('/search inception'));

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toBe('Search is temporarily unavailable. Please try again later.');
    } finally {
      db.close();
    }
  });

  it('does not leak provider links when membership verification fails during /search', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages } = createDeps(db, {
        telegram: {
          getChatMember: vi.fn(async () => {
            throw new Error('Telegram unavailable');
          })
        }
      });

      await handleTelegramUpdate(deps, messageUpdate('/search inception'));

      expect(sentMessages).toEqual([
        {
          chatId: 500,
          text: membershipVerificationMessage,
          replyMarkup: undefined
        }
      ]);
      expect(JSON.stringify(sentMessages)).not.toContain('providers.example');
    } finally {
      db.close();
    }
  });

  it('answers invalid callback data without leaking provider links', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages, callbackAnswers } = createDeps(db);

      await handleTelegramUpdate(deps, callbackUpdate('movie:1'));

      expect(deps.telegram.getChatMember).not.toHaveBeenCalled();
      expect(sentMessages).toEqual([]);
      expect(callbackAnswers).toEqual([{ callbackQueryId: 'callback-1', text: 'That button is no longer available.' }]);
    } finally {
      db.close();
    }
  });

  it('rate limits invalid callback data before the invalid-callback response path', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages, callbackAnswers } = createDeps(db, {
        rateLimiter: {
          check: vi.fn(() => ({ allowed: false, retryAfterMs: 3200 }))
        }
      });

      await handleTelegramUpdate(deps, callbackUpdate('movie:1'));

      expect(deps.rateLimiter.check).toHaveBeenCalledWith('callback:42');
      expect(deps.telegram.getChatMember).not.toHaveBeenCalled();
      expect(sentMessages).toEqual([]);
      expect(callbackAnswers).toEqual([{ callbackQueryId: 'callback-1', text: 'Please wait 4 seconds before trying again.' }]);
    } finally {
      db.close();
    }
  });

  it('answers season callbacks before queueing season detail messages', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps } = createDeps(db);

      await handleTelegramUpdate(deps, callbackUpdate('season:30'));

      const answerOrder = vi.mocked(deps.replies.enqueueAnswerCallbackQuery).mock.invocationCallOrder[0];
      const sendOrder = vi.mocked(deps.replies.enqueueSendMessage).mock.invocationCallOrder[0];
      expect(answerOrder).toBeLessThan(sendOrder);
    } finally {
      db.close();
    }
  });

  it('answers season callbacks even when sending season details fails', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const callbackAnswers: CallbackAnswer[] = [];
      const { deps } = createDeps(db, {
        replies: {
          enqueueSendMessage: vi.fn(async () => {
            throw new Error('send failed');
          }),
          enqueueAnswerCallbackQuery: vi.fn(async (input: CallbackAnswer) => {
            callbackAnswers.push(input);
          })
        }
      });

      await expect(handleTelegramUpdate(deps, callbackUpdate('season:30'))).rejects.toThrow('send failed');

      expect(callbackAnswers).toEqual([{ callbackQueryId: 'callback-1' }]);
    } finally {
      db.close();
    }
  });

  it('does not leak provider links when membership verification fails during a season callback', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages, callbackAnswers } = createDeps(db, {
        telegram: {
          getChatMember: vi.fn(async () => {
            throw new Error('Telegram unavailable');
          })
        }
      });

      await handleTelegramUpdate(deps, callbackUpdate('season:30'));

      expect(callbackAnswers).toEqual([{ callbackQueryId: 'callback-1', text: 'Please try again later.' }]);
      expect(sentMessages).toEqual([
        {
          chatId: 500,
          text: membershipVerificationMessage,
          replyMarkup: undefined
        }
      ]);
      expect(JSON.stringify({ sentMessages, callbackAnswers })).not.toContain('providers.example');
    } finally {
      db.close();
    }
  });

  it('checks membership again before showing season callback results', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages, callbackAnswers } = createDeps(db, {
        telegram: {
          getChatMember: vi.fn(async () => ({ status: 'left' }))
        }
      });

      await handleTelegramUpdate(deps, callbackUpdate('season:30'));

      expect(deps.telegram.getChatMember).toHaveBeenCalledWith({
        chatId: '@infinitylinks69',
        userId: 42
      });
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toBe(membershipVerificationMessage);
      expect(sentMessages[0].text).not.toContain('providers.example');
      expect(sentMessages[0].replyMarkup).toBeUndefined();
      expect(callbackAnswers).toEqual([{ callbackQueryId: 'callback-1', text: 'Please join the group first.' }]);
    } finally {
      db.close();
    }
  });

  it('returns episode-specific provider links as text for a season callback', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages, callbackAnswers } = createDeps(db);

      await handleTelegramUpdate(deps, callbackUpdate('season:30'));

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].text).toContain('📺 Breaking Bad (2008)');
      expect(sentMessages[0].text).toContain('📂 Season 1');
      expect(sentMessages[0].text).toContain('🎞 Episode 1');
      expect(sentMessages[0].text).toContain('🔗 Download Links:');
      expect(sentMessages[0].text).toContain('📁 StreamTape HD - https://providers.example/breaking-s1e1');
      expect(sentMessages[0].text).toContain('🎞 Episode 2');
      expect(sentMessages[0].text).toContain('📁 MixDrop HD - https://providers.example/breaking-s1e2');
      expect(sentMessages[0].text).toContain('📌 Original Post:');
      expect(sentMessages[0].text).toContain('https://t.me/infinitylinks65/301');
      expect(sentMessages[0].text).not.toContain('📢 Channel:');
      expect(sentMessages[0].text).toContain('👥 Group: @infinitylinks69');
      expect(sentMessages[0].replyMarkup).toBeUndefined();
      expect(callbackAnswers).toEqual([{ callbackQueryId: 'callback-1' }]);
    } finally {
      db.close();
    }
  });

  it('blocks spam with a wait message when the per-user rate limit is reached', async () => {
    const db = createMigratedDatabase();

    try {
      seedCatalog(db);
      const { deps, sentMessages } = createDeps(db, {
        rateLimiter: {
          check: vi.fn(() => ({ allowed: false, retryAfterMs: 4500 }))
        }
      });

      await handleTelegramUpdate(deps, messageUpdate('/search inception'));

      expect(deps.telegram.getChatMember).not.toHaveBeenCalled();
      expect(sentMessages).toEqual([
        {
          chatId: 500,
          text: 'Please wait 5 seconds before trying again.'
        }
      ]);
    } finally {
      db.close();
    }
  });
});

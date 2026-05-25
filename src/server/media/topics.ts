export const MOVIE_TOPIC_KEYS = ['FOREIGN_MOVIES', 'PINOY_MOVIES', 'ANIME', 'VIVAMAX'] as const;
export const TV_TOPIC_KEYS = ['FOREIGN_TV_SERIES', 'PINOY_TV_SERIES', 'ANIME', 'VIVAMAX'] as const;

export type MovieTopicKey = (typeof MOVIE_TOPIC_KEYS)[number];
export type TvTopicKey = (typeof TV_TOPIC_KEYS)[number];
export type MediaTopicKey = MovieTopicKey | TvTopicKey;

export const DEFAULT_MOVIE_TOPIC_KEY: MovieTopicKey = 'FOREIGN_MOVIES';
export const DEFAULT_TV_TOPIC_KEY: TvTopicKey = 'FOREIGN_TV_SERIES';

export const MOVIE_TOPIC_OPTIONS: Array<{ key: MovieTopicKey; label: string }> = [
  { key: 'FOREIGN_MOVIES', label: 'FOREIGN MOVIES' },
  { key: 'PINOY_MOVIES', label: 'PINOY MOVIES' },
  { key: 'ANIME', label: 'ANIME' },
  { key: 'VIVAMAX', label: 'VIVAMAX' }
];

export const TV_TOPIC_OPTIONS: Array<{ key: TvTopicKey; label: string }> = [
  { key: 'FOREIGN_TV_SERIES', label: 'FOREIGN TV SERIES' },
  { key: 'PINOY_TV_SERIES', label: 'PINOY TV SERIES' },
  { key: 'ANIME', label: 'ANIME' },
  { key: 'VIVAMAX', label: 'VIVAMAX' }
];

const TELEGRAM_GROUP_CHAT_ID = '-1003963665033';

const TOPIC_ROUTES: Record<MediaTopicKey, { chatId: string; messageThreadId: number }> = {
  FOREIGN_MOVIES: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 20 },
  PINOY_MOVIES: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 27 },
  ANIME: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 24 },
  VIVAMAX: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 29 },
  FOREIGN_TV_SERIES: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 22 },
  PINOY_TV_SERIES: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 28 }
};

export function getTopicRoute(topicKey: MediaTopicKey | string | undefined, mediaType: 'movie' | 'tv') {
  const fallbackTopicKey = mediaType === 'movie' ? DEFAULT_MOVIE_TOPIC_KEY : DEFAULT_TV_TOPIC_KEY;
  const requestedTopicKey = typeof topicKey === 'string' && topicKey.trim().length > 0 ? topicKey : fallbackTopicKey;
  const route = TOPIC_ROUTES[requestedTopicKey as MediaTopicKey];

  if (!route) {
    throw new Error(`Telegram topic route is not configured for ${requestedTopicKey}`);
  }

  return route;
}

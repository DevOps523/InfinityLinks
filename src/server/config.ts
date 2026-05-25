import { z } from 'zod';

function requiredSecret(name: string) {
  return z.string({ required_error: `${name} is required` }).trim().min(1, `${name} is required`);
}

function emptyStringToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim().length === 0 ? undefined : value;
}

const OptionalTrimmedString = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional()
);

function trimmedStringWithDefault(defaultValue: string) {
  return z.preprocess(emptyStringToUndefined, z.string().trim().min(1).default(defaultValue));
}

const EnvSchema = z.object({
  TMDB_API_KEY: requiredSecret('TMDB_API_KEY'),
  TELEGRAM_BOT_TOKEN: requiredSecret('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHANNEL_ID: requiredSecret('TELEGRAM_CHANNEL_ID'),
  HOST: z
    .string()
    .trim()
    .default('127.0.0.1')
    .refine((host) => ['127.0.0.1', 'localhost', '::1'].includes(host), {
      message: 'HOST must be a localhost address'
    }),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().trim().min(1).default('./data/infinitylinks.sqlite'),
  PUBLIC_SEARCH_SYNC_URL: OptionalTrimmedString,
  PUBLIC_SEARCH_SYNC_TOKEN: OptionalTrimmedString,
  PUBLIC_SEARCH_STATUS_URL: OptionalTrimmedString,
  PUBLIC_SEARCH_STATUS_TOKEN: OptionalTrimmedString,
  PUBLIC_SEARCH_GROUP_HANDLE: trimmedStringWithDefault('@infinitylinks69')
}).refine(
  (env) =>
    !env.PUBLIC_SEARCH_SYNC_TOKEN ||
    !env.PUBLIC_SEARCH_STATUS_TOKEN ||
    env.PUBLIC_SEARCH_SYNC_TOKEN !== env.PUBLIC_SEARCH_STATUS_TOKEN,
  {
    message: 'PUBLIC_SEARCH_STATUS_TOKEN must be different from PUBLIC_SEARCH_SYNC_TOKEN',
    path: ['PUBLIC_SEARCH_STATUS_TOKEN']
  }
);

export type AppConfig = {
  tmdbApiKey: string;
  telegramBotToken: string;
  telegramChannelId: string;
  host: string;
  port: number;
  databasePath: string;
  publicSearchSyncUrl?: string;
  publicSearchSyncToken?: string;
  publicSearchStatusUrl?: string;
  publicSearchStatusToken?: string;
  publicSearchGroupHandle: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.parse(env);

  return {
    tmdbApiKey: parsed.TMDB_API_KEY,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChannelId: parsed.TELEGRAM_CHANNEL_ID,
    host: parsed.HOST,
    port: parsed.PORT,
    databasePath: parsed.DATABASE_PATH,
    publicSearchSyncUrl: parsed.PUBLIC_SEARCH_SYNC_URL,
    publicSearchSyncToken: parsed.PUBLIC_SEARCH_SYNC_TOKEN,
    publicSearchStatusUrl: parsed.PUBLIC_SEARCH_STATUS_URL,
    publicSearchStatusToken: parsed.PUBLIC_SEARCH_STATUS_TOKEN,
    publicSearchGroupHandle: parsed.PUBLIC_SEARCH_GROUP_HANDLE
  };
}

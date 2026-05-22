import { z } from 'zod';

function requiredSecret(name: string) {
  return z.string({ required_error: `${name} is required` }).trim().min(1, `${name} is required`);
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
  DATABASE_PATH: z.string().trim().min(1).default('./data/infinitylinks.sqlite')
});

export type AppConfig = {
  tmdbApiKey: string;
  telegramBotToken: string;
  telegramChannelId: string;
  host: string;
  port: number;
  databasePath: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.parse(env);

  return {
    tmdbApiKey: parsed.TMDB_API_KEY,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChannelId: parsed.TELEGRAM_CHANNEL_ID,
    host: parsed.HOST,
    port: parsed.PORT,
    databasePath: parsed.DATABASE_PATH
  };
}

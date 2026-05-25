import { z } from 'zod';

function requiredSecret(name: string) {
  return z.string({ required_error: `${name} is required` }).trim().min(1, `${name} is required`);
}

function emptyStringToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim().length === 0 ? undefined : value;
}

function trimmedStringWithDefault(defaultValue: string) {
  return z.preprocess(emptyStringToUndefined, z.string().trim().min(1).default(defaultValue));
}

function numberWithDefault(defaultValue: number) {
  return z.preprocess(emptyStringToUndefined, z.coerce.number().int().positive().default(defaultValue));
}

const PublicSearchEnvSchema = z.object({
  PUBLIC_BOT_TOKEN: requiredSecret('PUBLIC_BOT_TOKEN'),
  PUBLIC_SEARCH_SYNC_TOKEN: requiredSecret('PUBLIC_SEARCH_SYNC_TOKEN'),
  PUBLIC_SEARCH_STATUS_TOKEN: requiredSecret('PUBLIC_SEARCH_STATUS_TOKEN'),
  PUBLIC_SEARCH_GROUP_HANDLE: trimmedStringWithDefault('@infinitylinks69'),
  PUBLIC_SEARCH_DATABASE_PATH: trimmedStringWithDefault('./data/public-search.sqlite'),
  PUBLIC_SEARCH_HOST: trimmedStringWithDefault('127.0.0.1'),
  PUBLIC_SEARCH_PORT: numberWithDefault(3001)
}).refine((env) => env.PUBLIC_SEARCH_SYNC_TOKEN !== env.PUBLIC_SEARCH_STATUS_TOKEN, {
  message: 'PUBLIC_SEARCH_STATUS_TOKEN must be different from PUBLIC_SEARCH_SYNC_TOKEN',
  path: ['PUBLIC_SEARCH_STATUS_TOKEN']
});

export type PublicSearchConfig = {
  publicBotToken: string;
  publicSearchSyncToken: string;
  publicSearchStatusToken: string;
  publicSearchGroupHandle: string;
  publicSearchDatabasePath: string;
  publicSearchHost: string;
  publicSearchPort: number;
};

export function loadPublicSearchConfig(env: NodeJS.ProcessEnv): PublicSearchConfig {
  const parsed = PublicSearchEnvSchema.parse(env);

  return {
    publicBotToken: parsed.PUBLIC_BOT_TOKEN,
    publicSearchSyncToken: parsed.PUBLIC_SEARCH_SYNC_TOKEN,
    publicSearchStatusToken: parsed.PUBLIC_SEARCH_STATUS_TOKEN,
    publicSearchGroupHandle: parsed.PUBLIC_SEARCH_GROUP_HANDLE,
    publicSearchDatabasePath: parsed.PUBLIC_SEARCH_DATABASE_PATH,
    publicSearchHost: parsed.PUBLIC_SEARCH_HOST,
    publicSearchPort: parsed.PUBLIC_SEARCH_PORT
  };
}

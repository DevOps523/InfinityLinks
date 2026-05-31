import { isAbsolute, relative, resolve, sep as pathSeparator } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

function requiredSecret(name: string) {
  return z.string({ required_error: `${name} is required` }).trim().min(1, `${name} is required`);
}

const placeholderFragments = ['example', 'changeme', 'replace', 'placeholder'];
const copiedExampleSecrets = new Set([
  'bot-token',
  'subscription-token',
  'sync-token',
  'status-token',
  'admin-token'
]);

function containsPlaceholder(value: string) {
  const lowerValue = value.toLowerCase();
  return (
    placeholderFragments.some((fragment) => lowerValue.includes(fragment)) ||
    copiedExampleSecrets.has(lowerValue)
  );
}

function generatedSecret(name: string, secretKind: string) {
  return requiredSecret(name)
    .min(32, `${name} must be a generated ${secretKind} at least 32 characters long`)
    .refine((value) => !containsPlaceholder(value), {
      message: `${name} must be a generated ${secretKind}, not a placeholder or example value`
    });
}

function telegramBotToken(name: string) {
  return generatedSecret(name, 'Telegram bot token').refine(
    (value) => /^\d{6,}:[A-Za-z0-9_-]{24,}$/.test(value),
    {
      message: `${name} must be a generated Telegram bot token`
    }
  );
}

function bearerToken(name: string) {
  return generatedSecret(name, 'bearer token');
}

function emptyStringToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim().length === 0 ? undefined : value;
}

function trimmedStringWithDefault(defaultValue: string) {
  return z.preprocess(emptyStringToUndefined, z.string().trim().min(1).default(defaultValue));
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

function loopbackHostWithDefault(defaultValue: string) {
  return trimmedStringWithDefault(defaultValue).refine((host) => loopbackHosts.has(host), {
    message: 'PUBLIC_SEARCH_HOST must be a loopback host: 127.0.0.1, localhost, or ::1'
  });
}

function numberWithDefault(defaultValue: number) {
  return z.preprocess(emptyStringToUndefined, z.coerce.number().int().positive().default(defaultValue));
}

function integerWithDefault(defaultValue: number) {
  return z.preprocess(emptyStringToUndefined, z.coerce.number().int().default(defaultValue));
}

function appRootFromModuleUrl() {
  try {
    const appRootUrl = new URL('..', import.meta.url);
    if (appRootUrl.protocol === 'file:') {
      return fileURLToPath(appRootUrl);
    }
  } catch {
    // Vitest can provide a non-file import.meta.url under jsdom; use cwd there.
  }

  return process.cwd();
}

const publicSearchBotAppRoot = resolve(appRootFromModuleUrl());

function isWithinPath(parentPath: string, candidatePath: string) {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith(`..${pathSeparator}`) && relativePath !== '..' && !isAbsolute(relativePath));
}

function serviceAccountKeyFile(name: string) {
  return requiredSecret(name).refine(
    (value) => {
      return isAbsolute(value) && !isWithinPath(publicSearchBotAppRoot, resolve(value));
    },
    {
      message: `${name} must be an absolute path outside the public search bot app tree`
    }
  );
}

const PublicSearchEnvSchema = z.object({
  PUBLIC_BOT_TOKEN: telegramBotToken('PUBLIC_BOT_TOKEN'),
  PUBLIC_SEARCH_SYNC_TOKEN: bearerToken('PUBLIC_SEARCH_SYNC_TOKEN'),
  PUBLIC_SEARCH_STATUS_TOKEN: bearerToken('PUBLIC_SEARCH_STATUS_TOKEN'),
  PUBLIC_SEARCH_GROUP_HANDLE: trimmedStringWithDefault('@infinitylinks69'),
  PUBLIC_SEARCH_DATABASE_PATH: trimmedStringWithDefault('./data/public-search.sqlite'),
  PUBLIC_SEARCH_HOST: loopbackHostWithDefault('127.0.0.1'),
  PUBLIC_SEARCH_PORT: numberWithDefault(3001),
  SUBSCRIPTION_BOT_TOKEN: telegramBotToken('SUBSCRIPTION_BOT_TOKEN'),
  SUBSCRIPTION_GROUP_CHAT_ID: integerWithDefault(-1003963665033),
  SUBSCRIPTION_ALERT_THREAD_ID: numberWithDefault(46),
  SUBSCRIPTION_ADMIN_CONTACT: trimmedStringWithDefault('@seinen_illuminatiks'),
  SUBSCRIPTION_TRIAL_SEARCH_LIMIT: numberWithDefault(5),
  SUBSCRIPTION_OVERDUE_GRACE_DAYS: numberWithDefault(1),
  SUBSCRIPTION_ADMIN_TOKEN: bearerToken('SUBSCRIPTION_ADMIN_TOKEN'),
  GOOGLE_SHEETS_SPREADSHEET_ID: requiredSecret('GOOGLE_SHEETS_SPREADSHEET_ID'),
  GOOGLE_SHEETS_USERS_RANGE: trimmedStringWithDefault('Users!A:H'),
  GOOGLE_SHEETS_HISTORY_RANGE: trimmedStringWithDefault('History!A:G'),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: serviceAccountKeyFile('GOOGLE_SERVICE_ACCOUNT_KEY_FILE')
}).refine((env) => env.PUBLIC_SEARCH_SYNC_TOKEN !== env.PUBLIC_SEARCH_STATUS_TOKEN, {
  message: 'PUBLIC_SEARCH_STATUS_TOKEN must be different from PUBLIC_SEARCH_SYNC_TOKEN',
  path: ['PUBLIC_SEARCH_STATUS_TOKEN']
}).refine((env) => env.SUBSCRIPTION_ADMIN_TOKEN !== env.PUBLIC_SEARCH_SYNC_TOKEN, {
  message: 'SUBSCRIPTION_ADMIN_TOKEN must be different from PUBLIC_SEARCH_SYNC_TOKEN',
  path: ['SUBSCRIPTION_ADMIN_TOKEN']
}).refine((env) => env.SUBSCRIPTION_ADMIN_TOKEN !== env.PUBLIC_SEARCH_STATUS_TOKEN, {
  message: 'SUBSCRIPTION_ADMIN_TOKEN must be different from PUBLIC_SEARCH_STATUS_TOKEN',
  path: ['SUBSCRIPTION_ADMIN_TOKEN']
});

export type PublicSearchConfig = {
  publicBotToken: string;
  publicSearchSyncToken: string;
  publicSearchStatusToken: string;
  publicSearchGroupHandle: string;
  publicSearchDatabasePath: string;
  publicSearchHost: string;
  publicSearchPort: number;
  subscriptionBotToken: string;
  subscriptionGroupChatId: number;
  subscriptionAlertThreadId: number;
  subscriptionAdminContact: string;
  subscriptionTrialSearchLimit: number;
  subscriptionOverdueGraceDays: number;
  subscriptionAdminToken: string;
  googleSheetsSpreadsheetId: string;
  googleSheetsUsersRange: string;
  googleSheetsHistoryRange: string;
  googleServiceAccountKeyFile: string;
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
    publicSearchPort: parsed.PUBLIC_SEARCH_PORT,
    subscriptionBotToken: parsed.SUBSCRIPTION_BOT_TOKEN,
    subscriptionGroupChatId: parsed.SUBSCRIPTION_GROUP_CHAT_ID,
    subscriptionAlertThreadId: parsed.SUBSCRIPTION_ALERT_THREAD_ID,
    subscriptionAdminContact: parsed.SUBSCRIPTION_ADMIN_CONTACT,
    subscriptionTrialSearchLimit: parsed.SUBSCRIPTION_TRIAL_SEARCH_LIMIT,
    subscriptionOverdueGraceDays: parsed.SUBSCRIPTION_OVERDUE_GRACE_DAYS,
    subscriptionAdminToken: parsed.SUBSCRIPTION_ADMIN_TOKEN,
    googleSheetsSpreadsheetId: parsed.GOOGLE_SHEETS_SPREADSHEET_ID,
    googleSheetsUsersRange: parsed.GOOGLE_SHEETS_USERS_RANGE,
    googleSheetsHistoryRange: parsed.GOOGLE_SHEETS_HISTORY_RANGE,
    googleServiceAccountKeyFile: parsed.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
  };
}

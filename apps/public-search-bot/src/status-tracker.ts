export type PublicSearchErrorSource = 'startup' | 'telegram_poll' | 'sync' | 'status_api' | 'unknown';

export type PublicSearchStatusState = 'ok' | 'error';

export type PublicSearchStatusError = {
  source: PublicSearchErrorSource;
  at: string;
  message: string;
};

export type PublicSearchStatusSnapshot = {
  state: PublicSearchStatusState;
  checkedAt: string;
  uptimeSeconds: number;
  consecutiveErrorCount: number;
  lastError: PublicSearchStatusError | null;
};

type PublicSearchStatusTrackerOptions = {
  now?: () => Date;
  uptimeSeconds?: () => number;
};

const ERROR_SOURCES = new Set<PublicSearchErrorSource>([
  'startup',
  'telegram_poll',
  'sync',
  'status_api',
  'unknown'
]);

const MAX_MESSAGE_LENGTH = 240;

function normalizeSource(source: PublicSearchErrorSource): PublicSearchErrorSource {
  return ERROR_SOURCES.has(source) ? source : 'unknown';
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

function sanitizeErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error && error.message ? error.message : String(error);
  const firstLine = rawMessage.split(/\r?\n/)[0] ?? '';
  const normalized = firstLine.replace(/\s+/g, ' ').trim();

  if (normalized.length <= MAX_MESSAGE_LENGTH) {
    return normalized;
  }

  return normalized.slice(0, MAX_MESSAGE_LENGTH);
}

export function createPublicSearchStatusTracker(options: PublicSearchStatusTrackerOptions = {}) {
  const now = options.now ?? (() => new Date());
  const uptimeSeconds = options.uptimeSeconds ?? (() => process.uptime());

  let consecutiveErrorCount = 0;
  let lastError: PublicSearchStatusError | null = null;

  return {
    recordError(source: PublicSearchErrorSource, error: unknown): PublicSearchStatusSnapshot {
      consecutiveErrorCount += 1;
      lastError = {
        source: normalizeSource(source),
        at: toIsoString(now()),
        message: sanitizeErrorMessage(error)
      };

      return this.snapshot();
    },

    clearError(source: PublicSearchErrorSource): PublicSearchStatusSnapshot {
      if (lastError?.source === normalizeSource(source)) {
        consecutiveErrorCount = 0;
        lastError = null;
      }

      return this.snapshot();
    },

    snapshot(): PublicSearchStatusSnapshot {
      return {
        state: lastError ? 'error' : 'ok',
        checkedAt: toIsoString(now()),
        uptimeSeconds: uptimeSeconds(),
        consecutiveErrorCount,
        lastError
      };
    }
  };
}

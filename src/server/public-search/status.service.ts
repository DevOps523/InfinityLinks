import type { AppConfig } from '../config.js';

let lastSuccessfulCheckAt: string | null = null;

type PublicSearchRemoteStatus = {
  state: 'ok' | 'error';
  checkedAt: string;
  uptimeSeconds: number;
  consecutiveErrorCount: number;
  lastError: null | {
    source: string;
    at: string;
    message: string;
  };
};

export class PublicSearchStatusError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly lastSuccessfulCheckAt: string | null
  ) {
    super(message);
    this.name = 'PublicSearchStatusError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLastError(value: unknown): PublicSearchRemoteStatus['lastError'] | undefined {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.source !== 'string' || typeof value.at !== 'string' || typeof value.message !== 'string') {
    return undefined;
  }

  return {
    source: value.source,
    at: value.at,
    message: value.message
  };
}

function normalizeRemoteStatus(value: unknown): PublicSearchRemoteStatus | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.state !== 'ok' && value.state !== 'error') {
    return undefined;
  }

  if (
    typeof value.checkedAt !== 'string' ||
    typeof value.uptimeSeconds !== 'number' ||
    !Number.isFinite(value.uptimeSeconds) ||
    typeof value.consecutiveErrorCount !== 'number' ||
    !Number.isFinite(value.consecutiveErrorCount)
  ) {
    return undefined;
  }

  const lastError = normalizeLastError(value.lastError);
  if (lastError === undefined) {
    return undefined;
  }

  return {
    state: value.state,
    checkedAt: value.checkedAt,
    uptimeSeconds: value.uptimeSeconds,
    consecutiveErrorCount: value.consecutiveErrorCount,
    lastError
  };
}

export async function checkPublicSearchStatus(config: AppConfig, fetcher: typeof fetch = fetch) {
  if (!config.publicSearchStatusUrl || !config.publicSearchStatusToken) {
    throw new PublicSearchStatusError(400, 'Public search status is not configured', lastSuccessfulCheckAt);
  }

  const headers = new Headers({
    authorization: `Bearer ${config.publicSearchStatusToken}`
  });

  let response: Response;
  try {
    response = await fetcher(config.publicSearchStatusUrl, {
      method: 'GET',
      headers
    });
  } catch {
    throw new PublicSearchStatusError(502, 'Public search status is unreachable', lastSuccessfulCheckAt);
  }

  if (!response.ok) {
    throw new PublicSearchStatusError(502, 'Public search status is unreachable', lastSuccessfulCheckAt);
  }

  let remote: unknown;
  try {
    remote = await response.json();
  } catch {
    throw new PublicSearchStatusError(502, 'Public search status is unreachable', lastSuccessfulCheckAt);
  }

  const normalizedRemote = normalizeRemoteStatus(remote);
  if (!normalizedRemote) {
    throw new PublicSearchStatusError(502, 'Public search status is unreachable', lastSuccessfulCheckAt);
  }

  lastSuccessfulCheckAt = new Date().toISOString();

  return {
    reachable: true,
    lastSuccessfulCheckAt,
    remote: normalizedRemote
  };
}

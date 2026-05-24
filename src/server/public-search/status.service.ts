import type { AppConfig } from '../config.js';

let lastSuccessfulCheckAt: string | null = null;

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

  lastSuccessfulCheckAt = new Date().toISOString();

  return {
    reachable: true,
    lastSuccessfulCheckAt,
    remote
  };
}

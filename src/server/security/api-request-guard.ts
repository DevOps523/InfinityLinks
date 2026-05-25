import type { NextFunction, Request, Response } from 'express';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ADMIN_REQUEST_HEADER = 'x-infinitylinks-request';
const ADMIN_REQUEST_VALUE = 'fetch';

function getOriginHost(origin: string | undefined): string | undefined {
  if (!origin) {
    return undefined;
  }

  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}

function hasBrowserProvenance(req: Request) {
  return Boolean(req.get('origin') || req.get('sec-fetch-site'));
}

function isSameOrigin(req: Request) {
  const originHost = getOriginHost(req.get('origin'));
  return !originHost || originHost === req.get('host');
}

function isCrossSite(req: Request) {
  const fetchSite = req.get('sec-fetch-site')?.toLowerCase();
  return fetchSite === 'cross-site' || !isSameOrigin(req);
}

export function createAdminApiRequestGuard() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hasBrowserProvenance(req)) {
      next();
      return;
    }

    if (isCrossSite(req)) {
      res.status(403).json({ error: 'Cross-site request blocked' });
      return;
    }

    if (MUTATING_METHODS.has(req.method) && req.get(ADMIN_REQUEST_HEADER) !== ADMIN_REQUEST_VALUE) {
      res.status(403).json({ error: 'Cross-site request blocked' });
      return;
    }

    next();
  };
}

import type { NextFunction, Request, Response } from 'express';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ADMIN_REQUEST_HEADER = 'x-infinitylinks-request';
const ADMIN_REQUEST_VALUE = 'fetch';
const CROSS_SITE_BLOCKED_RESPONSE = { error: 'Cross-site request blocked' };
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'] as const;

type AdminApiRequestGuardOptions = {
  allowedHosts?: Iterable<string>;
};

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

function normalizeHost(host: string | undefined) {
  return host?.trim().toLowerCase();
}

export function getLoopbackAdminApiAllowedHosts(port: number) {
  return LOOPBACK_HOSTS.map((host) => `${host}:${port}`);
}

export function createAdminApiRequestGuard(options: AdminApiRequestGuardOptions = {}) {
  const allowedHosts = options.allowedHosts
    ? new Set(
        Array.from(options.allowedHosts, (host) => normalizeHost(host)).filter((host): host is string => Boolean(host))
      )
    : undefined;

  return (req: Request, res: Response, next: NextFunction) => {
    const host = normalizeHost(req.get('host')) ?? '';

    if (allowedHosts && !allowedHosts.has(host)) {
      res.status(403).json(CROSS_SITE_BLOCKED_RESPONSE);
      return;
    }

    if (!hasBrowserProvenance(req)) {
      next();
      return;
    }

    if (isCrossSite(req)) {
      res.status(403).json(CROSS_SITE_BLOCKED_RESPONSE);
      return;
    }

    if (MUTATING_METHODS.has(req.method) && req.get(ADMIN_REQUEST_HEADER) !== ADMIN_REQUEST_VALUE) {
      res.status(403).json(CROSS_SITE_BLOCKED_RESPONSE);
      return;
    }

    next();
  };
}

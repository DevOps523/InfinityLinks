import express from 'express';
import type { PublicSearchConfig } from './config.js';
import { createFixedWindowRateLimiter } from './rate-limit.js';
import type { PublicSearchStatusSnapshot } from './status-tracker.js';

type PublicSearchStatusTracker = {
  snapshot: () => PublicSearchStatusSnapshot;
};

function extractBearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function createPublicSearchStatusRouter(
  config: PublicSearchConfig,
  statusTracker: PublicSearchStatusTracker
) {
  const router = express.Router();
  const badAuthRateLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });

  router.get('/status', (req, res) => {
    const token = extractBearerToken(req.header('authorization'));
    if (token !== config.publicSearchStatusToken) {
      const badAuthLimit = badAuthRateLimiter.check(req.ip ?? 'unknown');
      if (!badAuthLimit.allowed) {
        res.set('Retry-After', String(Math.max(1, Math.ceil(badAuthLimit.retryAfterMs / 1000))));
        res.status(429).json({ error: 'Too many unauthorized status attempts. Please wait and try again.' });
        return;
      }

      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    res.json(statusTracker.snapshot());
  });

  return router;
}

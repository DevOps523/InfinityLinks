import express from 'express';
import { createFixedWindowRateLimiter } from '../rate-limit.js';

function extractBearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function createSubscriptionRouter(options: {
  adminToken: string;
  syncFromSheet: () => Promise<unknown>;
  refreshAlert: () => Promise<unknown>;
}) {
  const router = express.Router();
  const badAuthRateLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });

  router.use('/subscriptions', (req, res, next) => {
    const token = extractBearerToken(req.header('authorization'));
    if (token !== options.adminToken) {
      const badAuthLimit = badAuthRateLimiter.check(req.ip ?? 'unknown');
      if (!badAuthLimit.allowed) {
        res.set('Retry-After', String(Math.max(1, Math.ceil(badAuthLimit.retryAfterMs / 1000))));
        res.status(429).json({ error: 'Too many unauthorized subscription attempts. Please wait and try again.' });
        return;
      }

      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  });

  router.post('/subscriptions/update', async (_req, res, next) => {
    try {
      const subscriptions = await options.syncFromSheet();
      const alert = await options.refreshAlert();
      res.json({ subscriptions, alert });
    } catch (error) {
      next(error);
    }
  });

  router.post('/subscriptions/send-alert', async (_req, res, next) => {
    try {
      res.json({ alert: await options.refreshAlert() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

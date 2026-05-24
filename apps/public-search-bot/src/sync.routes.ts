import express from 'express';
import type { PublicSearchConfig } from './config.js';
import { replacePublicCatalog } from './catalog.repository.js';
import { PublicSearchCatalogSchema } from './catalog.schema.js';
import type { PublicSearchDatabase } from './db/database.js';
import { createFixedWindowRateLimiter } from './rate-limit.js';

function extractBearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function createPublicSearchSyncRouter(db: PublicSearchDatabase, config: PublicSearchConfig) {
  const router = express.Router();
  const syncRateLimiter = createFixedWindowRateLimiter({ limit: 5, windowMs: 60_000 });

  router.post('/sync', (req, res) => {
    const token = extractBearerToken(req.header('authorization'));
    if (token !== config.publicSearchSyncToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rateLimit = syncRateLimiter.check(`${req.ip}:${token.slice(0, 8)}`);
    if (!rateLimit.allowed) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))));
      res.status(429).json({ error: 'Too many sync attempts. Please wait and try again.' });
      return;
    }

    const catalog = PublicSearchCatalogSchema.parse(req.body);
    const counts = replacePublicCatalog(db, catalog);

    res.json({ sync: counts });
  });

  return router;
}

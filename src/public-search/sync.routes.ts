import express from 'express';
import type { PublicSearchConfig } from './config.js';
import { replacePublicCatalog } from './catalog.repository.js';
import { PublicSearchCatalogSchema } from './catalog.schema.js';
import type { PublicSearchDatabase } from './db/database.js';

function extractBearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function createPublicSearchSyncRouter(db: PublicSearchDatabase, config: PublicSearchConfig) {
  const router = express.Router();

  router.post('/sync', (req, res) => {
    const token = extractBearerToken(req.header('authorization'));
    if (token !== config.publicSearchSyncToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const catalog = PublicSearchCatalogSchema.parse(req.body);
    const counts = replacePublicCatalog(db, catalog);

    res.json({ sync: counts });
  });

  return router;
}

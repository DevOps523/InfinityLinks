import express from 'express';
import { ZodError } from 'zod';
import type { PublicSearchConfig } from './config.js';
import type { PublicSearchDatabase } from './db/database.js';
import { createPublicSearchSyncRouter } from './sync.routes.js';

type CreatePublicSearchAppOptions = {
  db: PublicSearchDatabase;
  config: PublicSearchConfig;
};

function formatZodPath(path: Array<number | string>) {
  return path.map(String).join('.');
}

export function createPublicSearchApp(options: CreatePublicSearchAppOptions) {
  const app = express();

  app.use(express.json({ limit: '5mb' }));
  app.use('/api', createPublicSearchSyncRouter(options.db, options.config));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: 'Validation failed',
        issues: error.issues.map((issue) => ({
          path: formatZodPath(issue.path),
          message: issue.message
        }))
      });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unexpected server error';
    res.status(500).json({ error: message });
  });

  return app;
}

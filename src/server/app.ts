import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './db/database.js';
import { createTmdbRouter } from './tmdb/tmdb.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type CreateAppOptions = {
  db?: AppDatabase;
  config?: AppConfig;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  if (options.db && options.config) {
    app.use('/api/tmdb', createTmdbRouter(options.db, options.config));
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    res.status(500).json({ error: message });
  });

  const clientDist = path.resolve(__dirname, '../../dist/client');
  app.use(express.static(clientDist));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}

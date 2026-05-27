import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { createAdminRouter } from './admin/admin.routes.js';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './db/database.js';
import { createMediaRouter } from './media/media.routes.js';
import { createPublicSearchRouter } from './public-search/public-search.routes.js';
import { createAdminApiRequestGuard, getLoopbackAdminApiAllowedHosts } from './security/api-request-guard.js';
import type { PublicSearchStatusServiceOptions } from './public-search/status.service.js';
import { createTelegramAdminRouter } from './telegram/telegram.admin.routes.js';
import { createTmdbRouter, type TmdbRouterOptions } from './tmdb/tmdb.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type CreateAppOptions = {
  db?: AppDatabase;
  config?: AppConfig;
  fetcher?: typeof fetch;
  publicSearchStatusOptions?: PublicSearchStatusServiceOptions;
  tmdbOptions?: TmdbRouterOptions;
};

function formatZodPath(path: Array<number | string>) {
  return path.map(String).join('.');
}

function getAdminApiRequestGuardOptions(config: AppConfig | undefined) {
  if (!config) {
    return undefined;
  }

  if (config.port === 0) {
    return undefined;
  }

  return { allowedHosts: getLoopbackAdminApiAllowedHosts(config.port) };
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', createAdminApiRequestGuard(getAdminApiRequestGuardOptions(options.config)));

  if (options.db && options.config) {
    app.use('/api', createAdminRouter(options.db, options.config));
    app.use('/api', createMediaRouter(options.db));
    app.use('/api', createTelegramAdminRouter(options.db));
    app.use('/api/tmdb', createTmdbRouter(options.db, options.config, options.tmdbOptions));
    app.use('/api', createPublicSearchRouter(options.db, options.config, options.fetcher, options.publicSearchStatusOptions));
  }

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

    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      const statusCode = (error as { statusCode: unknown }).statusCode;
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
        const message = error instanceof Error ? error.message : 'Request failed';
        res.status(statusCode).json({ error: message });
        return;
      }
    }

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

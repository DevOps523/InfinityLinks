import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createSubscriptionRouter } from '../src/subscriptions/routes.js';

function createApp(options?: {
  syncFromSheet?: () => Promise<unknown>;
  refreshAlert?: () => Promise<unknown>;
}) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use('/api', createSubscriptionRouter({
    adminToken: 'admin-token',
    syncFromSheet: options?.syncFromSheet ?? vi.fn(),
    refreshAlert: options?.refreshAlert ?? vi.fn()
  }));
  return app;
}

describe('subscription routes', () => {
  it('requires subscription admin bearer token', async () => {
    const app = createApp();

    expect((await request(app).post('/api/subscriptions/update')).status).toBe(401);
    expect((await request(app).post('/api/subscriptions/send-alert').set('Authorization', 'Bearer wrong')).status).toBe(401);
  });

  it('rate limits repeated invalid admin bearer tokens by client IP before running actions', async () => {
    const syncFromSheet = vi.fn(async () => ({ updatedUsers: 2 }));
    const refreshAlert = vi.fn(async () => ({ state: 'posted', count: 1 }));
    const app = createApp({ syncFromSheet, refreshAlert });

    for (let index = 0; index < 10; index += 1) {
      await request(app)
        .post('/api/subscriptions/update')
        .set('Authorization', 'Bearer wrong')
        .set('X-Forwarded-For', '198.51.100.10')
        .expect(401);
    }

    const response = await request(app)
      .post('/api/subscriptions/update')
      .set('Authorization', 'Bearer wrong')
      .set('X-Forwarded-For', '198.51.100.10');

    expect(response.status).toBe(429);
    expect(Number(response.header['retry-after'])).toBeGreaterThan(0);
    expect(Number(response.header['retry-after'])).toBeLessThanOrEqual(60);
    expect(response.body).toEqual({ error: 'Too many unauthorized subscription attempts. Please wait and try again.' });
    expect(syncFromSheet).not.toHaveBeenCalled();
    expect(refreshAlert).not.toHaveBeenCalled();

    await request(app)
      .post('/api/subscriptions/update')
      .set('Authorization', 'Bearer wrong')
      .set('X-Forwarded-For', '198.51.100.20')
      .expect(401);
  });

  it('does not count correct admin bearer tokens against the subscription bad-auth quota', async () => {
    const app = createApp({
      syncFromSheet: vi.fn(async () => ({ updatedUsers: 2 })),
      refreshAlert: vi.fn(async () => ({ state: 'posted', count: 1 }))
    });

    for (let index = 0; index < 11; index += 1) {
      await request(app)
        .post('/api/subscriptions/send-alert')
        .set('Authorization', 'Bearer admin-token')
        .set('X-Forwarded-For', '198.51.100.30')
        .expect(200);
    }

    await request(app)
      .post('/api/subscriptions/send-alert')
      .set('Authorization', 'Bearer wrong')
      .set('X-Forwarded-For', '198.51.100.30')
      .expect(401);
  });

  it('runs update and send-alert actions', async () => {
    const app = express();
    const syncFromSheet = vi.fn(async () => ({ updatedUsers: 2 }));
    const refreshAlert = vi.fn(async () => ({ state: 'posted', count: 1 }));
    app.use('/api', createSubscriptionRouter({ adminToken: 'admin-token', syncFromSheet, refreshAlert }));

    const update = await request(app).post('/api/subscriptions/update').set('Authorization', 'Bearer admin-token');
    const alert = await request(app).post('/api/subscriptions/send-alert').set('Authorization', 'Bearer admin-token');

    expect(update.body).toEqual({
      subscriptions: { updatedUsers: 2 },
      alert: { state: 'posted', count: 1 }
    });
    expect(alert.body).toEqual({ alert: { state: 'posted', count: 1 } });
    expect(syncFromSheet).toHaveBeenCalledTimes(1);
    expect(refreshAlert).toHaveBeenCalledTimes(2);
    expect(syncFromSheet.mock.invocationCallOrder[0]).toBeLessThan(refreshAlert.mock.invocationCallOrder[0]);
  });

  it('passes action errors to the express error handler', async () => {
    const app = express();
    app.use('/api', createSubscriptionRouter({
      adminToken: 'admin-token',
      syncFromSheet: vi.fn(async () => {
        throw new Error('sheet unavailable');
      }),
      refreshAlert: vi.fn()
    }));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(503).json({ error: error instanceof Error ? error.message : 'unknown' });
    });

    await expect(
      request(app).post('/api/subscriptions/update').set('Authorization', 'Bearer admin-token')
    ).resolves.toMatchObject({
      status: 503,
      body: { error: 'sheet unavailable' }
    });
  });
});

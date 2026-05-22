import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';

let server: Server | undefined;

afterEach(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  server = undefined;
});

async function requestApp(path: string) {
  const app = createApp();
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`);
}

describe('createApp', () => {
  it('returns JSON 404 for unknown API routes', async () => {
    const response = await requestApp('/api/unknown');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'API route not found' });
  });
});

import { describe, expect, it } from 'vitest';
import { createPublicSearchStatusTracker } from '../src/status-tracker.js';

describe('public search status tracker', () => {
  it('starts in an ok state', () => {
    const tracker = createPublicSearchStatusTracker({
      now: () => new Date('2026-05-24T08:00:00.000Z'),
      uptimeSeconds: () => 12
    });

    expect(tracker.snapshot()).toEqual({
      state: 'ok',
      checkedAt: '2026-05-24T08:00:00.000Z',
      uptimeSeconds: 12,
      consecutiveErrorCount: 0,
      lastError: null
    });
  });

  it('records an error with a safe source, ISO timestamp, sanitized message, and count', () => {
    const tracker = createPublicSearchStatusTracker({
      now: () => new Date('2026-05-24T08:01:00.000Z'),
      uptimeSeconds: () => 20
    });

    expect(tracker.recordError('telegram_poll', new Error('Telegram polling failed\n    at poller.ts:12'))).toEqual({
      state: 'error',
      checkedAt: '2026-05-24T08:01:00.000Z',
      uptimeSeconds: 20,
      consecutiveErrorCount: 1,
      lastError: {
        source: 'telegram_poll',
        at: '2026-05-24T08:01:00.000Z',
        message: 'Telegram polling failed'
      }
    });
  });

  it('increments the consecutive error count when another error is recorded', () => {
    const tracker = createPublicSearchStatusTracker({
      now: () => new Date('2026-05-24T08:02:00.000Z'),
      uptimeSeconds: () => 30
    });

    tracker.recordError('sync', new Error('First sync failure'));

    expect(tracker.recordError('sync', new Error('Second sync failure'))).toMatchObject({
      state: 'error',
      consecutiveErrorCount: 2,
      lastError: {
        source: 'sync',
        message: 'Second sync failure'
      }
    });
  });

  it('clears a matching error source', () => {
    const tracker = createPublicSearchStatusTracker({
      now: () => new Date('2026-05-24T08:03:00.000Z'),
      uptimeSeconds: () => 40
    });

    tracker.recordError('startup', new Error('Missing token'));

    expect(tracker.clearError('startup')).toEqual({
      state: 'ok',
      checkedAt: '2026-05-24T08:03:00.000Z',
      uptimeSeconds: 40,
      consecutiveErrorCount: 0,
      lastError: null
    });
  });

  it('removes newlines and stack-like details from recorded messages', () => {
    const tracker = createPublicSearchStatusTracker({
      now: () => new Date('2026-05-24T08:04:00.000Z'),
      uptimeSeconds: () => 50
    });

    const snapshot = tracker.recordError(
      'status_api',
      new Error('Status route failed\r\n    at status.ts:10:5\r\n    at next')
    );

    expect(snapshot.lastError?.message).toBe('Status route failed');
    expect(snapshot.lastError?.message).not.toContain('\n');
    expect(snapshot.lastError?.message).not.toContain('status.ts:10:5');
  });
});

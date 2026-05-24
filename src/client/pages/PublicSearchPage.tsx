import { Activity, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { apiJson } from '../api/http';
import { useToast } from '../components/ToastProvider';

type SyncResult = {
  syncedAt: string;
  movies: number;
  tvShows: number;
};

type SyncResponse = {
  sync: SyncResult;
};

type PublicSearchLastError = {
  source: string;
  at: string;
  message: string;
};

type PublicSearchRemoteStatus = {
  state: 'ok' | 'error';
  checkedAt: string;
  uptimeSeconds: number;
  consecutiveErrorCount: number;
  lastError: PublicSearchLastError | null;
};

type PublicSearchStatusResponse =
  | {
      reachable: true;
      lastSuccessfulCheckAt: string;
      remote: PublicSearchRemoteStatus;
    }
  | {
      reachable: false;
      lastSuccessfulCheckAt: string | null;
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLastError(value: unknown): value is PublicSearchLastError | null {
  if (value === null) {
    return true;
  }

  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    typeof value.at === 'string' &&
    typeof value.message === 'string'
  );
}

function isRemoteStatus(value: unknown): value is PublicSearchRemoteStatus {
  return (
    isRecord(value) &&
    (value.state === 'ok' || value.state === 'error') &&
    typeof value.checkedAt === 'string' &&
    typeof value.uptimeSeconds === 'number' &&
    typeof value.consecutiveErrorCount === 'number' &&
    isLastError(value.lastError)
  );
}

function isPublicSearchStatusResponse(value: unknown): value is PublicSearchStatusResponse {
  if (!isRecord(value) || typeof value.reachable !== 'boolean') {
    return false;
  }

  if (value.reachable) {
    return typeof value.lastSuccessfulCheckAt === 'string' && isRemoteStatus(value.remote);
  }

  return (
    (typeof value.lastSuccessfulCheckAt === 'string' || value.lastSuccessfulCheckAt === null) &&
    typeof value.error === 'string'
  );
}

async function fetchPublicSearchStatus(): Promise<PublicSearchStatusResponse> {
  const response = await fetch('/api/public-search/status');
  const payload = (await response.json()) as unknown;

  if (isPublicSearchStatusResponse(payload)) {
    return payload;
  }

  throw new Error(response.ok ? 'Public search status check failed' : 'Public search status is unreachable');
}

export function PublicSearchPage() {
  const { showToast } = useToast();
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [statusResult, setStatusResult] = useState<PublicSearchStatusResponse | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');

  async function syncPublicSearch() {
    setIsSyncing(true);
    setError('');

    try {
      const payload = await apiJson<SyncResponse>('/api/public-search/sync', { method: 'POST' });
      const nextResult = payload?.sync;

      if (nextResult) {
        setSyncResult(nextResult);
        showToast('Public search synced.');
      }
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : 'Public search sync failed.';
      setError(message);
    } finally {
      setIsSyncing(false);
    }
  }

  async function checkPublicSearchStatus() {
    setIsCheckingStatus(true);
    setStatusError('');

    try {
      const payload = await fetchPublicSearchStatus();
      setStatusResult(payload);
    } catch (statusCheckError) {
      const message =
        statusCheckError instanceof Error ? statusCheckError.message : 'Public search status is unreachable';
      setStatusError(message || 'Public search status is unreachable');
      setStatusResult(null);
    } finally {
      setIsCheckingStatus(false);
    }
  }

  const lastSuccessfulCheckAt = statusResult?.lastSuccessfulCheckAt;
  const remoteStatus = statusResult?.reachable ? statusResult.remote : null;
  const lastError = remoteStatus?.lastError;

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <h1>Public Search</h1>
        </div>
        <button className="button button--primary" type="button" disabled={isSyncing} onClick={syncPublicSearch}>
          <RefreshCw aria-hidden="true" size={18} />
          {isSyncing ? 'Syncing...' : 'Sync Public Search'}
        </button>
      </div>

      <div className="sync-panel">
        {error ? (
          <div className="state-panel state-panel--error" role="alert">
            {error}
          </div>
        ) : null}
        {!error && syncResult ? (
          <div className="sync-panel__result" aria-live="polite">
            <strong>Last sync</strong>
            <span>{new Date(syncResult.syncedAt).toLocaleString()}</span>
            <span>{syncResult.movies} movies</span>
            <span>{syncResult.tvShows} TV shows</span>
          </div>
        ) : null}
        {!error && !syncResult ? <div className="state-panel">No sync has run in this session.</div> : null}
      </div>

      <div className="sync-panel public-search-status">
        <div className="public-search-status__header">
          <strong>Bot status</strong>
          <button
            className="button button--secondary"
            type="button"
            disabled={isCheckingStatus}
            onClick={checkPublicSearchStatus}
          >
            <Activity aria-hidden="true" size={18} />
            {isCheckingStatus ? 'Checking...' : 'Check Bot Status'}
          </button>
        </div>

        <div className="public-search-status__body" aria-live="polite">
          {statusError ? (
            <div className="state-panel state-panel--error" role="alert">
              {statusError}
            </div>
          ) : null}

          {!statusError && statusResult ? (
            <dl className="public-search-status__grid">
              <div>
                <dt>Reachability</dt>
                <dd>{statusResult.reachable ? 'reachable' : 'unreachable'}</dd>
              </div>
              <div>
                <dt>Last successful check</dt>
                <dd>{lastSuccessfulCheckAt ? new Date(lastSuccessfulCheckAt).toLocaleString() : 'None'}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>{remoteStatus?.state === 'error' ? 'ERROR' : statusResult.reachable ? 'OK' : 'ERROR'}</dd>
              </div>
              {lastError ? (
                <>
                  <div>
                    <dt>Source</dt>
                    <dd>{lastError.source}</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{new Date(lastError.at).toLocaleString()}</dd>
                  </div>
                  <div className="public-search-status__message">
                    <dt>Message</dt>
                    <dd>{lastError.message}</dd>
                  </div>
                </>
              ) : null}
              {!statusResult.reachable ? (
                <div className="public-search-status__message">
                  <dt>Message</dt>
                  <dd>{statusResult.error}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {!statusError && !statusResult ? <div className="state-panel">Status has not been checked.</div> : null}
        </div>
      </div>
    </section>
  );
}

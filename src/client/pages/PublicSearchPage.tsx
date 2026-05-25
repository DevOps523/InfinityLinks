import { Activity, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '../api/http';
import { useToast } from '../components/ToastProvider';

type SyncResult = {
  syncedAt: string;
  movies: number;
  tvShows: number;
};

type SyncResponse = {
  sync: SyncResult;
  status: PublicSearchSyncStatus;
};

type PublicSearchSyncStatus = {
  configured: boolean;
  hasPublicSearchableContent: boolean;
  hasPendingChanges: boolean;
  current: {
    catalogHash: string;
    movies: number;
    tvShows: number;
  };
  lastSuccessfulSync: SyncResult | null;
};

type PublicSearchPreview = {
  movies: number;
  tvShows: number;
  sampleMovies: string[];
  sampleTvShows: string[];
};

type PublicSearchPreviewResponse = {
  preview: PublicSearchPreview;
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

function isSyncResult(value: unknown): value is SyncResult {
  return (
    isRecord(value) &&
    typeof value.syncedAt === 'string' &&
    typeof value.movies === 'number' &&
    typeof value.tvShows === 'number'
  );
}

function isPublicSearchSyncStatus(value: unknown): value is PublicSearchSyncStatus {
  return (
    isRecord(value) &&
    typeof value.configured === 'boolean' &&
    typeof value.hasPublicSearchableContent === 'boolean' &&
    typeof value.hasPendingChanges === 'boolean' &&
    isRecord(value.current) &&
    typeof value.current.catalogHash === 'string' &&
    typeof value.current.movies === 'number' &&
    typeof value.current.tvShows === 'number' &&
    (value.lastSuccessfulSync === null || isSyncResult(value.lastSuccessfulSync))
  );
}

function isSyncResponse(value: unknown): value is SyncResponse {
  return isRecord(value) && isSyncResult(value.sync) && isPublicSearchSyncStatus(value.status);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPublicSearchPreview(value: unknown): value is PublicSearchPreview {
  return (
    isRecord(value) &&
    typeof value.movies === 'number' &&
    typeof value.tvShows === 'number' &&
    isStringArray(value.sampleMovies) &&
    isStringArray(value.sampleTvShows)
  );
}

function isPublicSearchPreviewResponse(value: unknown): value is PublicSearchPreviewResponse {
  return isRecord(value) && isPublicSearchPreview(value.preview);
}

function createReadinessMessage(syncStatus: PublicSearchSyncStatus | null, isLoadingSyncStatus: boolean) {
  if (isLoadingSyncStatus) {
    return 'Checking sync readiness...';
  }

  if (!syncStatus) {
    return 'Sync readiness unavailable';
  }

  if (!syncStatus.configured) {
    return 'Public search sync is not configured.';
  }

  if (!syncStatus.hasPublicSearchableContent && !syncStatus.hasPendingChanges) {
    return 'No public-searchable content yet';
  }

  if (!syncStatus.hasPendingChanges) {
    return 'Everything is synced';
  }

  if (!syncStatus.hasPublicSearchableContent) {
    return 'Public search catalog is empty, sync to clear old results.';
  }

  const pendingItems = [
    syncStatus.current.movies > 0 ? `${syncStatus.current.movies} ${syncStatus.current.movies === 1 ? 'movie' : 'movies'}` : '',
    syncStatus.current.tvShows > 0
      ? `${syncStatus.current.tvShows} ${syncStatus.current.tvShows === 1 ? 'TV show' : 'TV shows'}`
      : ''
  ].filter(Boolean);

  return `${pendingItems.join(' and ')} ready to sync`;
}

async function fetchPublicSearchStatus(): Promise<PublicSearchStatusResponse> {
  const response = await fetch('/api/public-search/status');
  const payload = (await response.json()) as unknown;

  if (isPublicSearchStatusResponse(payload)) {
    return payload;
  }

  throw new Error(response.ok ? 'Public search status check failed' : 'Public search status is unreachable');
}

async function fetchPublicSearchSyncStatus(): Promise<PublicSearchSyncStatus> {
  const payload = await apiJson<unknown>('/api/public-search/sync-status');

  if (isPublicSearchSyncStatus(payload)) {
    return payload;
  }

  throw new Error('Public search sync readiness check failed');
}

async function fetchPublicSearchPreview(): Promise<PublicSearchPreview> {
  const payload = await apiJson<unknown>('/api/public-search/preview');

  if (isPublicSearchPreviewResponse(payload)) {
    return payload.preview;
  }

  throw new Error('Public search preview could not be loaded');
}

export function PublicSearchPage() {
  const { showToast } = useToast();
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncStatus, setSyncStatus] = useState<PublicSearchSyncStatus | null>(null);
  const [preview, setPreview] = useState<PublicSearchPreview | null>(null);
  const [statusResult, setStatusResult] = useState<PublicSearchStatusResponse | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingSyncStatus, setIsLoadingSyncStatus] = useState(true);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [error, setError] = useState('');
  const [syncStatusError, setSyncStatusError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [statusError, setStatusError] = useState('');
  const isMountedRef = useRef(false);
  const previewRequestIdRef = useRef(0);

  const loadPublicSearchPreview = useCallback(async () => {
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;

    if (isMountedRef.current) {
      setPreviewError('');
    }

    try {
      const payload = await fetchPublicSearchPreview();

      if (isMountedRef.current && requestId === previewRequestIdRef.current) {
        setPreview(payload);
      }
    } catch (previewLoadError) {
      const message =
        previewLoadError instanceof Error ? previewLoadError.message : 'Public search preview could not be loaded';

      if (isMountedRef.current && requestId === previewRequestIdRef.current) {
        setPreview(null);
        setPreviewError(message || 'Public search preview could not be loaded');
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    isMountedRef.current = true;

    async function loadSyncStatus() {
      setIsLoadingSyncStatus(true);
      setSyncStatusError('');

      try {
        const payload = await fetchPublicSearchSyncStatus();

        if (isMounted) {
          setSyncStatus(payload);
          setSyncResult(payload.lastSuccessfulSync);
        }
      } catch (syncStatusCheckError) {
        const message =
          syncStatusCheckError instanceof Error
            ? syncStatusCheckError.message
            : 'Public search sync readiness check failed';

        if (isMounted) {
          setSyncStatus(null);
          setSyncResult(null);
          setSyncStatusError(message || 'Public search sync readiness check failed');
        }
      } finally {
        if (isMounted) {
          setIsLoadingSyncStatus(false);
        }
      }
    }

    void loadSyncStatus();
    void loadPublicSearchPreview();

    return () => {
      isMounted = false;
      isMountedRef.current = false;
      previewRequestIdRef.current += 1;
    };
  }, [loadPublicSearchPreview]);

  async function syncPublicSearch() {
    setIsSyncing(true);
    setError('');

    try {
      const payload = await apiJson<unknown>('/api/public-search/sync', { method: 'POST' });

      if (!isSyncResponse(payload)) {
        throw new Error('Public search sync response was invalid');
      }

      setSyncResult(payload.sync);
      setSyncStatus(payload.status);
      void loadPublicSearchPreview();
      showToast('Public search synced.');
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
  const readinessMessage = createReadinessMessage(syncStatus, isLoadingSyncStatus);
  const isSyncDisabled =
    isLoadingSyncStatus || isSyncing || Boolean(syncStatusError) || !syncStatus?.configured || !syncStatus.hasPendingChanges;

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <h1>Public Search</h1>
        </div>
        <button className="button button--primary" type="button" disabled={isSyncDisabled} onClick={syncPublicSearch}>
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
        {syncStatusError ? (
          <div className="state-panel state-panel--error" role="alert">
            {syncStatusError}
          </div>
        ) : null}
        {!error && !syncStatusError ? (
          <div className="state-panel" aria-live="polite">
            {readinessMessage}
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
      </div>

      <div className="sync-panel public-search-preview">
        <div className="public-search-status__header">
          <strong>Catalog preview</strong>
        </div>
        <div className="public-search-preview__body" aria-live="polite">
          {previewError ? <div className="state-panel state-panel--error">{previewError}</div> : null}
          {!previewError && preview ? (
            <>
              <dl className="public-search-preview__counts">
                <div>
                  <dt>Movies</dt>
                  <dd>{preview.movies}</dd>
                </div>
                <div>
                  <dt>TV shows</dt>
                  <dd>{preview.tvShows}</dd>
                </div>
              </dl>
              <div className="public-search-preview__samples">
                <div>
                  <strong>Sample movies</strong>
                  {preview.sampleMovies.length > 0 ? (
                    <ul>
                      {preview.sampleMovies.map((title) => (
                        <li key={title}>{title}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No movies in the public catalog.</p>
                  )}
                </div>
                <div>
                  <strong>Sample TV shows</strong>
                  {preview.sampleTvShows.length > 0 ? (
                    <ul>
                      {preview.sampleTvShows.map((title) => (
                        <li key={title}>{title}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No TV shows in the public catalog.</p>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
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

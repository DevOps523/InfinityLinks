import { RefreshCw } from 'lucide-react';
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

export function PublicSearchPage() {
  const { showToast } = useToast();
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');

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
        {error ? <div className="state-panel state-panel--error">{error}</div> : null}
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
    </section>
  );
}

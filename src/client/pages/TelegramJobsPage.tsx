import { RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '../api/http';
import { useToast } from '../components/ToastProvider';

type FailedTelegramJob = {
  id: number;
  jobType: 'send' | 'edit' | 'delete';
  entityType: 'movie' | 'season';
  entityId: number;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
};

type FailedTelegramJobsResponse = {
  jobs: FailedTelegramJob[];
};

type TelegramJobsPageProps = {
  onFailedJobCountChange?: (count: number) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailedTelegramJob(value: unknown): value is FailedTelegramJob {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    (value.jobType === 'send' || value.jobType === 'edit' || value.jobType === 'delete') &&
    (value.entityType === 'movie' || value.entityType === 'season') &&
    typeof value.entityId === 'number' &&
    typeof value.attempts === 'number' &&
    (typeof value.lastError === 'string' || value.lastError === null) &&
    typeof value.updatedAt === 'string'
  );
}

function isFailedTelegramJobsResponse(value: unknown): value is FailedTelegramJobsResponse {
  return isRecord(value) && Array.isArray(value.jobs) && value.jobs.every(isFailedTelegramJob);
}

async function fetchFailedTelegramJobs() {
  const payload = await apiJson<unknown>('/api/telegram/jobs/failed');

  if (!isFailedTelegramJobsResponse(payload)) {
    throw new Error('Failed Telegram jobs response was invalid');
  }

  return payload.jobs;
}

function formatJobLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function TelegramJobsPage({ onFailedJobCountChange }: TelegramJobsPageProps = {}) {
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<FailedTelegramJob[]>([]);
  const [retryingJobId, setRetryingJobId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadJobs = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const nextJobs = await fetchFailedTelegramJobs();
      setJobs(nextJobs);
      onFailedJobCountChange?.(nextJobs.length);
    } catch (jobsError) {
      const message = jobsError instanceof Error ? jobsError.message : 'Failed Telegram jobs could not be loaded';
      setJobs([]);
      setError(message || 'Failed Telegram jobs could not be loaded');
    } finally {
      setIsLoading(false);
    }
  }, [onFailedJobCountChange]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  async function retryJob(id: number) {
    setRetryingJobId(id);
    setError('');

    try {
      await apiJson<unknown>(`/api/telegram/jobs/${id}/retry`, { method: 'POST' });
      showToast('Telegram job queued for retry.');
      await loadJobs();
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : 'Telegram job retry failed';
      setError(message || 'Telegram job retry failed');
      showToast(message || 'Telegram job retry failed', 'error');
    } finally {
      setRetryingJobId(null);
    }
  }

  return (
    <section className="page-section">
      <header className="page-header">
        <div>
          <h1 className="page-title-with-badge">
            <span>Telegram Jobs</span>
            {jobs.length > 0 ? (
              <span className="count-badge" aria-hidden="true">
                {jobs.length}
              </span>
            ) : null}
          </h1>
          <p>Failed publish jobs waiting for admin review.</p>
        </div>
        <button className="button button--secondary" type="button" onClick={() => void loadJobs()} disabled={isLoading}>
          <RefreshCw aria-hidden="true" size={17} />
          Refresh
        </button>
      </header>

      <div className="table-card">
        {isLoading ? <div className="state-panel">Loading failed Telegram jobs...</div> : null}
        {!isLoading && error ? (
          <div className="state-panel state-panel--error" role="alert">
            {error}
          </div>
        ) : null}
        {!isLoading && !error && jobs.length === 0 ? <div className="state-panel">No failed Telegram jobs.</div> : null}

        {!isLoading && jobs.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Entity</th>
                  <th>Attempts</th>
                  <th>Last Error</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <strong>#{job.id}</strong>
                      <br />
                      {formatJobLabel(job.jobType)}
                    </td>
                    <td>
                      {formatJobLabel(job.entityType)} #{job.entityId}
                    </td>
                    <td>{job.attempts}</td>
                    <td>{job.lastError || 'No error recorded'}</td>
                    <td>{job.updatedAt}</td>
                    <td>
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => void retryJob(job.id)}
                        disabled={retryingJobId === job.id}
                      >
                        <RotateCcw aria-hidden="true" size={17} />
                        {retryingJobId === job.id ? 'Retrying' : 'Retry'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

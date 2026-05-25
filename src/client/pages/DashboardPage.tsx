import { AlertTriangle, CheckCircle2, Film, Link2, RefreshCw, Tv } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiJson } from '../api/http';

type DashboardCounts = {
  movies: number;
  tvShows: number;
  activeLinks: number;
  failedTelegramJobs: number;
  pendingPublicSearchChanges: boolean;
};

type DashboardResponse = {
  dashboard: DashboardCounts;
};

type DashboardCard = {
  label: string;
  value: number;
  icon: typeof Film;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDashboardCounts(value: unknown): value is DashboardCounts {
  return (
    isRecord(value) &&
    typeof value.movies === 'number' &&
    typeof value.tvShows === 'number' &&
    typeof value.activeLinks === 'number' &&
    typeof value.failedTelegramJobs === 'number' &&
    typeof value.pendingPublicSearchChanges === 'boolean'
  );
}

function isDashboardResponse(value: unknown): value is DashboardResponse {
  return isRecord(value) && isDashboardCounts(value.dashboard);
}

async function fetchDashboard() {
  const payload = await apiJson<unknown>('/api/admin/dashboard');

  if (!isDashboardResponse(payload)) {
    throw new Error('Dashboard response was invalid');
  }

  return payload.dashboard;
}

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardCounts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      setIsLoading(true);
      setError('');

      try {
        const nextDashboard = await fetchDashboard();

        if (isMounted) {
          setDashboard(nextDashboard);
        }
      } catch (dashboardError) {
        const message = dashboardError instanceof Error ? dashboardError.message : 'Dashboard failed to load';

        if (isMounted) {
          setDashboard(null);
          setError(message || 'Dashboard failed to load');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  const cards: DashboardCard[] = dashboard
    ? [
        { label: 'Movies', value: dashboard.movies, icon: Film },
        { label: 'TV Shows', value: dashboard.tvShows, icon: Tv },
        { label: 'Active Links', value: dashboard.activeLinks, icon: Link2 },
        { label: 'Failed Telegram Jobs', value: dashboard.failedTelegramJobs, icon: AlertTriangle }
      ]
    : [];

  return (
    <section className="page-section">
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Local catalog and publishing health.</p>
        </div>
      </header>

      {isLoading ? <div className="state-panel dashboard-state">Loading dashboard...</div> : null}
      {error ? <div className="state-panel state-panel--error dashboard-state">{error}</div> : null}

      {dashboard ? (
        <>
          <div className="dashboard-grid" aria-label="Dashboard counts">
            {cards.map((card) => {
              const Icon = card.icon;

              return (
                <article className="dashboard-card" key={card.label}>
                  <div className="dashboard-card__icon">
                    <Icon aria-hidden="true" size={20} />
                  </div>
                  <div>
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                  </div>
                </article>
              );
            })}
          </div>

          <section className="sync-panel dashboard-sync">
            <div className="dashboard-sync__icon">
              {dashboard.pendingPublicSearchChanges ? (
                <RefreshCw aria-hidden="true" size={22} />
              ) : (
                <CheckCircle2 aria-hidden="true" size={22} />
              )}
            </div>
            <div>
              <h2>{dashboard.pendingPublicSearchChanges ? 'Pending public search sync' : 'Public search is synced'}</h2>
              <p>
                {dashboard.pendingPublicSearchChanges
                  ? 'Public Search has local catalog updates waiting to publish.'
                  : 'Public Search matches the latest local catalog fingerprint.'}
              </p>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

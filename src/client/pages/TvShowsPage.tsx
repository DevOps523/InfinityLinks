import { CalendarPlus, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiJson } from '../api/http';
import { ActionMenu } from '../components/ActionMenu';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';

type TvShow = {
  id: number;
  title: string;
  year?: number;
  description: string;
};

type TvShowsPageProps = {
  onAddTvShow: () => void;
  onEditTvShow: (id: number) => void;
  onManageSeasons: (id: number) => void;
};

export function TvShowsPage({ onAddTvShow, onEditTvShow, onManageSeasons }: TvShowsPageProps) {
  const { showToast } = useToast();
  const [tvShows, setTvShows] = useState<TvShow[]>([]);
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({ title: '', year: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [tvShowToDelete, setTvShowToDelete] = useState<TvShow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (appliedFilters.title.trim()) {
      params.set('title', appliedFilters.title.trim());
    }
    if (appliedFilters.year.trim()) {
      params.set('year', appliedFilters.year.trim());
    }

    const query = params.toString();
    return query ? `/api/tv-shows?${query}` : '/api/tv-shows';
  }, [appliedFilters]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadTvShows = useCallback(async (url = listUrl, signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!mountedRef.current || signal?.aborted) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const payload = await apiJson<{ tvShows: TvShow[] }>(url, { signal });
      if (!mountedRef.current || signal?.aborted || requestId !== requestIdRef.current) {
        return;
      }
      setTvShows(payload?.tvShows ?? []);
    } catch (loadError) {
      if ((loadError as { name?: string }).name === 'AbortError' || signal?.aborted || requestId !== requestIdRef.current || !mountedRef.current) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : 'Unable to load TV shows.');
    } finally {
      if (!mountedRef.current || signal?.aborted || requestId !== requestIdRef.current) {
        return;
      }
      setIsLoading(false);
    }
  }, [listUrl]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTvShows(listUrl, controller.signal);

    return () => {
      controller.abort();
    };
  }, [listUrl, loadTvShows]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters({ title, year });
  }

  async function confirmDelete() {
    if (!tvShowToDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await apiJson(`/api/tv-shows/${tvShowToDelete.id}`, { method: 'DELETE' });
      if (!mountedRef.current) {
        return;
      }
      setTvShowToDelete(null);
      await loadTvShows();
      if (mountedRef.current) {
        showToast('TV show deleted and list refreshed.');
      }
    } catch (deleteError) {
      if (!mountedRef.current) {
        return;
      }
      showToast(deleteError instanceof Error ? deleteError.message : 'Delete failed.', 'error');
    } finally {
      if (mountedRef.current) {
        setIsDeleting(false);
      }
    }
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <h1>TV Shows</h1>
          <p>Manage TV show records, seasons, episodes, and links.</p>
        </div>
        <button className="button button--primary" type="button" onClick={onAddTvShow}>
          <Plus aria-hidden="true" size={18} />
          Add TV Show
        </button>
      </div>

      <form className="filter-bar" onSubmit={applyFilters}>
        <label>
          Title
          <input value={title} placeholder="Filter by title" onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Year
          <input inputMode="numeric" pattern="[0-9]*" value={year} placeholder="2026" onChange={(event) => setYear(event.target.value)} />
        </label>
        <button className="button button--secondary" type="submit">
          <Search aria-hidden="true" size={18} />
          Filter
        </button>
      </form>

      <div className="table-card">
        {isLoading ? <div className="state-panel">Loading TV shows...</div> : null}
        {!isLoading && error ? <div className="state-panel state-panel--error">{error}</div> : null}
        {!isLoading && !error && tvShows.length === 0 ? <div className="state-panel">No TV shows found.</div> : null}
        {!isLoading && !error && tvShows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>TV show title</th>
                  <th>Description</th>
                  <th>Year</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {tvShows.map((tvShow) => (
                  <tr key={tvShow.id}>
                    <td>{tvShow.id}</td>
                    <td>{tvShow.title}</td>
                    <td>{tvShow.description || 'No description'}</td>
                    <td>{tvShow.year ?? '-'}</td>
                    <td>
                      <ActionMenu
                        extraActions={[
                          {
                            label: 'Add Season',
                            icon: CalendarPlus,
                            onSelect: () => onManageSeasons(tvShow.id)
                          }
                        ]}
                        onEdit={() => onEditTvShow(tvShow.id)}
                        onDelete={() => setTvShowToDelete(tvShow)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(tvShowToDelete)}
        title="Delete TV show"
        message={tvShowToDelete ? `Delete "${tvShowToDelete.title}" permanently?` : ''}
        isBusy={isDeleting}
        onCancel={() => setTvShowToDelete(null)}
        onConfirm={confirmDelete}
      />
    </section>
  );
}

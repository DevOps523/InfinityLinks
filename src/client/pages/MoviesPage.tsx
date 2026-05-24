import { Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from '../api/http';
import { ActionMenu } from '../components/ActionMenu';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';

type Movie = {
  id: number;
  title: string;
  year?: number;
  description: string;
};

type MoviesPageProps = {
  onAddMovie: () => void;
  onEditMovie: (id: number) => void;
};

export function MoviesPage({ onAddMovie, onEditMovie }: MoviesPageProps) {
  const { showToast } = useToast();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [title, setTitle] = useState('');
  const [debouncedTitle, setDebouncedTitle] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [movieToDelete, setMovieToDelete] = useState<Movie | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedTitle.trim()) {
      params.set('title', debouncedTitle.trim());
    }

    const query = params.toString();
    return query ? `/api/movies?${query}` : '/api/movies';
  }, [debouncedTitle]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedTitle(title);
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [title]);

  const loadMovies = useCallback(async (url = listUrl, signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!mountedRef.current || signal?.aborted) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const payload = await apiJson<{ movies: Movie[] }>(url, { signal });
      if (!mountedRef.current || signal?.aborted || requestId !== requestIdRef.current) {
        return;
      }
      setMovies(payload?.movies ?? []);
    } catch (loadError) {
      if ((loadError as { name?: string }).name === 'AbortError' || signal?.aborted || requestId !== requestIdRef.current || !mountedRef.current) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : 'Unable to load movies.');
    } finally {
      if (!mountedRef.current || signal?.aborted || requestId !== requestIdRef.current) {
        return;
      }
      setIsLoading(false);
    }
  }, [listUrl]);

  useEffect(() => {
    const controller = new AbortController();
    void loadMovies(listUrl, controller.signal);

    return () => {
      controller.abort();
    };
  }, [listUrl, loadMovies]);

  async function confirmDelete() {
    if (!movieToDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await apiJson(`/api/movies/${movieToDelete.id}`, { method: 'DELETE' });
      if (!mountedRef.current) {
        return;
      }
      setMovieToDelete(null);
      await loadMovies();
      if (mountedRef.current) {
        showToast('Movie deleted and list refreshed.');
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
          <h1>Movies</h1>
          <p>Manage movie records and streaming links.</p>
        </div>
        <button className="button button--primary" type="button" onClick={onAddMovie}>
          <Plus aria-hidden="true" size={18} />
          Add Movie
        </button>
      </div>

      <div className="filter-bar filter-bar--title-only">
        <label className="filter-bar__search">
          Title
          <span className="input-with-icon">
            <Search aria-hidden="true" size={18} />
            <input value={title} placeholder="Filter by title" onChange={(event) => setTitle(event.target.value)} />
          </span>
        </label>
      </div>

      <div className="table-card">
        {isLoading ? <div className="state-panel">Loading movies...</div> : null}
        {!isLoading && error ? <div className="state-panel state-panel--error">{error}</div> : null}
        {!isLoading && !error && movies.length === 0 ? <div className="state-panel">No movies found.</div> : null}
        {!isLoading && !error && movies.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Movie title</th>
                  <th>Description</th>
                  <th>Year</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {movies.map((movie) => (
                  <tr key={movie.id}>
                    <td>{movie.id}</td>
                    <td>{movie.title}</td>
                    <td>{movie.description || 'No description'}</td>
                    <td>{movie.year ?? '-'}</td>
                    <td>
                      <ActionMenu onEdit={() => onEditMovie(movie.id)} onDelete={() => setMovieToDelete(movie)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(movieToDelete)}
        title="Delete movie"
        message={movieToDelete ? `Delete "${movieToDelete.title}" permanently?` : ''}
        isBusy={isDeleting}
        onCancel={() => setMovieToDelete(null)}
        onConfirm={confirmDelete}
      />
    </section>
  );
}

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../api/http';

export type TmdbResult = {
  tmdbId: number;
  title: string;
  year?: number;
  posterUrl?: string;
  description: string;
  rating?: number;
};

type TmdbSearchProps = {
  onSelect: (result: TmdbResult) => void;
  type?: 'movie' | 'tv';
};

export function TmdbSearch({ onSelect, type = 'movie' }: TmdbSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const selectedQueryRef = useRef('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3 || trimmed === selectedQueryRef.current) {
      setResults([]);
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const timeout = window.setTimeout(() => {
      setStatus('loading');
      apiJson<{ results: TmdbResult[] }>(`/api/tmdb/search?type=${type}&query=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal
      })
        .then((payload) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current) {
            return;
          }

          setResults(payload?.results ?? []);
          setStatus('idle');
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === 'AbortError') {
            return;
          }
          if (controller.signal.aborted || requestId !== requestIdRef.current) {
            return;
          }
          setStatus('error');
          setResults([]);
        });
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, type]);

  return (
    <div className="tmdb-search">
      <label htmlFor="tmdb-search">TMDB search</label>
      <div className="input-with-icon">
        <Search aria-hidden="true" size={18} />
        <input
          id="tmdb-search"
          type="search"
          value={query}
          placeholder="Search by title"
          onChange={(event) => {
            selectedQueryRef.current = '';
            setQuery(event.target.value);
          }}
        />
      </div>
      {status === 'loading' ? <p className="field-hint">Searching...</p> : null}
      {status === 'error' ? <p className="field-error">TMDB search failed.</p> : null}
      {results.length > 0 ? (
        <div className="tmdb-search__results" aria-label={`TMDB ${type === 'tv' ? 'TV show' : 'movie'} results`}>
          {results.map((result) => (
            <button
              key={result.tmdbId}
              type="button"
              className="tmdb-search__result"
              onClick={() => {
                onSelect(result);
                selectedQueryRef.current = result.title.trim();
                setQuery(result.title);
                setResults([]);
              }}
            >
              <span>{result.title}</span>
              <small>{result.year ?? 'Unknown year'}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

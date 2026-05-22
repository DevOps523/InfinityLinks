import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
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
};

export function TmdbSearch({ onSelect }: TmdbSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setStatus('loading');
      apiJson<{ results: TmdbResult[] }>(`/api/tmdb/search?type=movie&query=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal
      })
        .then((payload) => {
          setResults(payload?.results ?? []);
          setStatus('idle');
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === 'AbortError') {
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
  }, [query]);

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
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {status === 'loading' ? <p className="field-hint">Searching...</p> : null}
      {status === 'error' ? <p className="field-error">TMDB search failed.</p> : null}
      {results.length > 0 ? (
        <div className="tmdb-search__results" role="listbox" aria-label="TMDB movie results">
          {results.map((result) => (
            <button
              key={result.tmdbId}
              type="button"
              className="tmdb-search__result"
              onClick={() => {
                onSelect(result);
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

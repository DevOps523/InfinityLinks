import { Save } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { apiJson } from '../api/http';
import { TmdbSearch, type TmdbResult } from '../components/TmdbSearch';
import { useToast } from '../components/ToastProvider';

type TvShowFormProps = {
  tvShowId?: number;
  onSaved: () => void;
};

const qualities = ['SD', 'HD', 'Full HD', '2K', '4K'];
const tvTopics = [
  { value: 'FOREIGN_TV_SERIES', label: 'Foreign TV Series' },
  { value: 'PINOY_TV_SERIES', label: 'Pinoy TV Series' },
  { value: 'ANIME', label: 'Anime' },
  { value: 'VIVAMAX', label: 'Vivamax' }
];

type TvShowPayload = {
  id: number;
  tmdbId?: number;
  title: string;
  year?: number;
  posterUrl?: string;
  description: string;
  rating?: number;
  quality: string;
  topicKey?: string;
};

export function TvShowForm({ tvShowId, onSaved }: TvShowFormProps) {
  const { showToast } = useToast();
  const isEditMode = tvShowId !== undefined;
  const [tmdbId, setTmdbId] = useState('');
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [description, setDescription] = useState('');
  const [rating, setRating] = useState('');
  const [quality, setQuality] = useState('HD');
  const [topicKey, setTopicKey] = useState('FOREIGN_TV_SERIES');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(isEditMode);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isEditMode) {
      return;
    }

    setTmdbId('');
    setTitle('');
    setYear('');
    setPosterUrl('');
    setDescription('');
    setRating('');
    setQuality('HD');
    setTopicKey('FOREIGN_TV_SERIES');
    setError('');
    setIsLoading(false);
  }, [isEditMode]);

  useEffect(() => {
    if (!isEditMode) {
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError('');

    apiJson<{ tvShow: TvShowPayload }>(`/api/tv-shows/${tvShowId}`, { signal: controller.signal })
      .then((payload) => {
        const tvShow = payload?.tvShow;
        if (!tvShow || controller.signal.aborted) {
          return;
        }

        setTmdbId(tvShow.tmdbId ? String(tvShow.tmdbId) : '');
        setTitle(tvShow.title);
        setYear(tvShow.year ? String(tvShow.year) : '');
        setPosterUrl(tvShow.posterUrl ?? '');
        setDescription(tvShow.description);
        setRating(tvShow.rating !== undefined ? String(tvShow.rating) : '');
        setQuality(tvShow.quality);
        setTopicKey(tvShow.topicKey ?? 'FOREIGN_TV_SERIES');
      })
      .catch((loadError: unknown) => {
        if ((loadError as { name?: string }).name === 'AbortError') {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Unable to load TV show.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [isEditMode, tvShowId]);

  function applyTmdbResult(result: TmdbResult) {
    setTmdbId(String(result.tmdbId));
    setTitle(result.title);
    setYear(result.year ? String(result.year) : '');
    setPosterUrl(result.posterUrl ?? '');
    setDescription(result.description);
    setRating(result.rating !== undefined ? String(result.rating) : '');
  }

  async function submitTvShow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError('');

    const body = {
      tmdbId: tmdbId.trim() ? Number(tmdbId) : undefined,
      title,
      year: year.trim() ? Number(year) : undefined,
      posterUrl,
      description,
      rating: rating.trim() ? Number(rating) : undefined,
      quality,
      topicKey
    };

    try {
      await apiJson(isEditMode ? `/api/tv-shows/${tvShowId}` : '/api/tv-shows', {
        method: isEditMode ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      showToast(isEditMode ? 'TV show updated.' : 'TV show saved.');
      onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save TV show.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <h1>{isEditMode ? 'Edit TV Show' : 'Add TV Show'}</h1>
          <p>{isEditMode ? 'Update TV show details used in season posts.' : 'Create a TV show entry from TMDB data or manual details.'}</p>
        </div>
      </div>

      {isLoading ? <div className="state-panel">Loading TV show...</div> : null}
      {!isLoading ? (
        <form className="form-grid" onSubmit={submitTvShow}>
          <div className="form-panel">
            <TmdbSearch type="tv" onSelect={applyTmdbResult} />

            <div className="field-grid">
              <label>
                TMDB ID
                <input inputMode="numeric" value={tmdbId} onChange={(event) => setTmdbId(event.target.value)} />
              </label>
              <label>
                Title
                <input required value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label>
                Year
                <input inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value)} />
              </label>
              <label>
                Rating
                <input inputMode="decimal" value={rating} onChange={(event) => setRating(event.target.value)} />
              </label>
              <label>
                Quality
                <select value={quality} onChange={(event) => setQuality(event.target.value)}>
                  {qualities.map((qualityOption) => (
                    <option key={qualityOption}>{qualityOption}</option>
                  ))}
                </select>
              </label>
              <label>
                Topic
                <select value={topicKey} onChange={(event) => setTopicKey(event.target.value)}>
                  {tvTopics.map((topic) => (
                    <option key={topic.value} value={topic.value}>
                      {topic.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-grid__wide">
                Poster URL
                <input type="url" value={posterUrl} onChange={(event) => setPosterUrl(event.target.value)} />
              </label>
              <label className="field-grid__wide">
                Description
                <textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </div>

            {error ? <div className="state-panel state-panel--error">{error}</div> : null}

            <div className="form-actions">
              <button className="button button--primary" type="submit" disabled={isSaving}>
                <Save aria-hidden="true" size={18} />
                {isSaving ? 'Saving...' : isEditMode ? 'Update TV Show' : 'Save TV Show'}
              </button>
            </div>
          </div>

          <aside className="poster-panel" aria-label="Poster preview">
            {posterUrl ? <img src={posterUrl} alt={`${title || 'TV show'} poster preview`} /> : <span>No poster preview</span>}
          </aside>
        </form>
      ) : null}
    </section>
  );
}

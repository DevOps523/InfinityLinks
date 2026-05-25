import { Link as LinkIcon, Save } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { apiJson } from '../api/http';
import { LinkEditorModal, type MovieLinkInput } from '../components/LinkEditorModal';
import { TmdbSearch, type TmdbResult } from '../components/TmdbSearch';
import { useToast } from '../components/ToastProvider';

type MovieFormProps = {
  movieId?: number;
  onSaved: () => void;
};

const qualities = ['SD', 'HD', 'Full HD', '2K', '4K'];
const movieTopics = [
  { value: 'FOREIGN_MOVIES', label: 'Foreign Movies' },
  { value: 'PINOY_MOVIES', label: 'Pinoy Movies' },
  { value: 'ANIME', label: 'Anime' },
  { value: 'VIVAMAX', label: 'Vivamax' }
];

type MoviePayload = {
  id: number;
  tmdbId?: number;
  title: string;
  year?: number;
  posterUrl?: string;
  description: string;
  rating?: number;
  quality: string;
  topicKey?: string;
  links: MovieLinkInput[];
};

export function MovieForm({ movieId, onSaved }: MovieFormProps) {
  const { showToast } = useToast();
  const isEditMode = movieId !== undefined;
  const [tmdbId, setTmdbId] = useState('');
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [description, setDescription] = useState('');
  const [rating, setRating] = useState('');
  const [quality, setQuality] = useState('HD');
  const [topicKey, setTopicKey] = useState('FOREIGN_MOVIES');
  const [links, setLinks] = useState<MovieLinkInput[]>([]);
  const [linksOpen, setLinksOpen] = useState(false);
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
    setTopicKey('FOREIGN_MOVIES');
    setLinks([]);
    setLinksOpen(false);
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

    apiJson<{ movie: MoviePayload }>(`/api/movies/${movieId}`, { signal: controller.signal })
      .then((payload) => {
        const movie = payload?.movie;
        if (!movie || controller.signal.aborted) {
          return;
        }

        setTmdbId(movie.tmdbId ? String(movie.tmdbId) : '');
        setTitle(movie.title);
        setYear(movie.year ? String(movie.year) : '');
        setPosterUrl(movie.posterUrl ?? '');
        setDescription(movie.description);
        setRating(movie.rating !== undefined ? String(movie.rating) : '');
        setQuality(movie.quality);
        setTopicKey(movie.topicKey ?? 'FOREIGN_MOVIES');
        setLinks(movie.links ?? []);
      })
      .catch((loadError: unknown) => {
        if ((loadError as { name?: string }).name === 'AbortError') {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Unable to load movie.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [isEditMode, movieId]);

  function applyTmdbResult(result: TmdbResult) {
    setTmdbId(String(result.tmdbId));
    setTitle(result.title);
    setYear(result.year ? String(result.year) : '');
    setPosterUrl(result.posterUrl ?? '');
    setDescription(result.description);
    setRating(result.rating !== undefined ? String(result.rating) : '');
  }

  async function submitMovie(event: FormEvent<HTMLFormElement>) {
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
      topicKey,
      links
    };

    try {
      await apiJson(isEditMode ? `/api/movies/${movieId}` : '/api/movies', {
        method: isEditMode ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      showToast(isEditMode ? 'Movie updated.' : 'Movie saved.');
      onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save movie.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <h1>{isEditMode ? 'Edit Movie' : 'Add Movie'}</h1>
          <p>{isEditMode ? 'Update movie details and streaming links.' : 'Create a movie entry from TMDB data or manual details.'}</p>
        </div>
      </div>

      {isLoading ? <div className="state-panel">Loading movie...</div> : null}
      {!isLoading ? (
        <>
          <form className="form-grid" onSubmit={submitMovie}>
            <div className="form-panel">
              <TmdbSearch onSelect={applyTmdbResult} />

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
                    {movieTopics.map((topic) => (
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

              <div className="inline-actions">
                <button className="button button--secondary" type="button" onClick={() => setLinksOpen(true)}>
                  <LinkIcon aria-hidden="true" size={18} />
                  Edit links
                </button>
                <span>{links.length} link{links.length === 1 ? '' : 's'} added</span>
              </div>

              {error ? <div className="state-panel state-panel--error">{error}</div> : null}

              <div className="form-actions">
                <button className="button button--primary" type="submit" disabled={isSaving}>
                  <Save aria-hidden="true" size={18} />
                  {isSaving ? 'Saving...' : isEditMode ? 'Update Movie' : 'Save Movie'}
                </button>
              </div>
            </div>

            <aside className="poster-panel" aria-label="Poster preview">
              {posterUrl ? <img src={posterUrl} alt={`${title || 'Movie'} poster preview`} /> : <span>No poster preview</span>}
            </aside>
          </form>

          <LinkEditorModal
            open={linksOpen}
            links={links}
            onClose={() => setLinksOpen(false)}
            onSave={(nextLinks) => {
              setLinks(nextLinks);
              setLinksOpen(false);
            }}
          />
        </>
      ) : null}
    </section>
  );
}

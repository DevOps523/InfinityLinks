import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { LinkEditorModal } from '../../src/client/components/LinkEditorModal';
import { TmdbSearch } from '../../src/client/components/TmdbSearch';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useRealTimers();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ movies: [] })
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('App', () => {
  it('shows media navigation and the Add Movie link', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: /movies/i })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    expect(within(navigation).getByRole('button', { name: /^movies$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^add movie$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^tv shows$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^add tv show$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^public search$/i })).toBeInTheDocument();
  });

  it('renders the Add Movie form after clicking Add Movie', async () => {
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add movie$/i }));

    expect(screen.getByRole('heading', { name: /^add movie$/i })).toBeInTheDocument();
  });

  it('renders the Add TV Show form after clicking Add TV Show', async () => {
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add tv show$/i }));

    expect(screen.getByRole('heading', { name: /^add tv show$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/tmdb search/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^quality$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save tv show$/i })).toBeInTheDocument();
  });

  it('renders the Public Search sync page after clicking Public Search', () => {
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));

    expect(screen.getByRole('heading', { name: /^public search$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeInTheDocument();
  });

  it('syncs the public search catalog and shows returned counts', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync') {
        return {
          ok: true,
          json: async () => ({
            sync: {
              syncedAt: '2026-05-24T10:00:00.000Z',
              movies: 12,
              tvShows: 4
            }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^sync public search$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/public-search/sync', expect.objectContaining({ method: 'POST' }))
    );
    expect(await screen.findByText(/12 movies/i)).toBeInTheDocument();
    expect(screen.getByText(/4 tv shows/i)).toBeInTheDocument();
  });

  it('disables the public search sync button while syncing', async () => {
    let resolveSync: (response: unknown) => void = () => undefined;
    const syncPromise = new Promise((resolve) => {
      resolveSync = resolve;
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync') {
        return syncPromise;
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^sync public search$/i }));

    const syncingButton = await screen.findByRole('button', { name: /^syncing\.\.\.$/i });
    expect(syncingButton).toBeDisabled();

    resolveSync({
      ok: true,
      json: async () => ({
        sync: {
          syncedAt: '2026-05-24T10:00:00.000Z',
          movies: 2,
          tvShows: 1
        }
      })
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeEnabled());
  });

  it('shows the public search sync error message', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync') {
        return {
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          json: async () => ({ error: 'Public search sync failed' })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^sync public search$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Public search sync failed');
  });

  it('opens season management from the TV show action menu', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/movies' && !init?.method) {
        return {
          ok: true,
          json: async () => ({ movies: [] })
        };
      }

      if (url === '/api/tv-shows' && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            tvShows: [
              {
                id: 3,
                title: 'Dark',
                year: 2017,
                description: 'Missing children and time loops'
              }
            ]
          })
        };
      }

      if (url === '/api/tv-shows/3/seasons' && !init?.method) {
        return {
          ok: true,
          json: async () => ({ seasons: [] })
        };
      }

      return {
        ok: true,
        json: async () => ({})
      };
    });

    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^tv shows$/i }));

    expect(await screen.findByText('Dark')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open action menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^add season$/i }));

    expect(await screen.findByRole('heading', { name: /^seasons$/i })).toBeInTheDocument();
    const dialog = await screen.findByRole('dialog', { name: /^add season$/i });
    expect(within(dialog).getByLabelText(/season number/i)).toBeInTheDocument();
  });

  it('cancels delete confirmation without deleting', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/movies' && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            movies: [
              {
                id: 7,
                title: 'Arrival',
                year: 2016,
                description: 'First contact'
              }
            ]
          })
        };
      }

      return {
        ok: true,
        status: 204,
        json: async () => ({})
      };
    });

    render(<App />);

    expect(await screen.findByText('Arrival')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open action menu/i }));

    expect(screen.getByRole('menuitem', { name: /^edit$/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));

    const dialog = screen.getByRole('dialog', { name: /delete movie/i });
    expect(within(dialog).getByText(/delete "arrival" permanently/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /delete movie/i })).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalledWith('/api/movies/7', expect.objectContaining({ method: 'DELETE' }));
  });

  it('opens the edit movie form from the movie action menu', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/movies' && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            movies: [
              {
                id: 7,
                title: 'Arrival',
                year: 2016,
                description: 'First contact'
              }
            ]
          })
        };
      }

      if (url === '/api/movies/7' && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            movie: {
              id: 7,
              tmdbId: 329865,
              title: 'Arrival',
              year: 2016,
              posterUrl: 'https://example.com/arrival.jpg',
              description: 'First contact',
              rating: 7.6,
              quality: 'Full HD',
              links: [
                {
                  providerName: 'Provider',
                  quality: 'Full HD',
                  status: 'active',
                  url: 'https://example.com/watch'
                }
              ]
            }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({})
      };
    });

    render(<App />);

    expect(await screen.findByText('Arrival')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open action menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^edit$/i }));

    expect(await screen.findByRole('heading', { name: /^edit movie$/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Arrival')).toBeInTheDocument();
    expect(screen.getByText('1 link added')).toBeInTheDocument();
  });

  it('does not reopen TMDB results immediately after selecting a result', async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            tmdbId: 27205,
            title: 'Inception',
            year: 2010,
            description: 'Dream layers'
          }
        ]
      })
    });

    render(<TmdbSearch onSelect={onSelect} />);

    fireEvent.change(screen.getByRole('searchbox', { name: /tmdb search/i }), { target: { value: 'ince' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(351);
    });

    fireEvent.click(screen.getByRole('button', { name: /inception/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        tmdbId: 27205,
        title: 'Inception'
      })
    );
    expect(screen.queryByLabelText(/tmdb movie results/i)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/tmdb movie results/i)).not.toBeInTheDocument();
  });

  it('disables link saves while a link request is already saving', () => {
    const onSave = vi.fn();

    render(
      <LinkEditorModal
        open
        isSaving
        links={[
          {
            providerName: 'Provider',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/watch'
          }
        ]}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    const saveButton = screen.getByRole('button', { name: /^saving/i });
    expect(saveButton).toBeDisabled();

    fireEvent.click(saveButton);

    expect(onSave).not.toHaveBeenCalled();
  });
});

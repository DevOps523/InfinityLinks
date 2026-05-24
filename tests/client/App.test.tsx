import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { LinkEditorModal } from '../../src/client/components/LinkEditorModal';
import { TmdbSearch } from '../../src/client/components/TmdbSearch';
import { ToastProvider, useToast } from '../../src/client/components/ToastProvider';

const fetchMock = vi.fn();

function ToastHarness() {
  const { showToast } = useToast();

  return (
    <button type="button" onClick={() => showToast('Saved.')}>
      Show toast
    </button>
  );
}

beforeEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
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

  it('keeps the selected top-level page after reload through the URL hash', async () => {
    window.history.replaceState(null, '', '/#/public-search');

    render(<App />);

    expect(screen.getByRole('heading', { name: /^public search$/i })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    expect(within(navigation).getByRole('button', { name: /^public search$/i })).toHaveAttribute('aria-current', 'page');
  });

  it('updates the URL hash when navigating between top-level pages', async () => {
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^tv shows$/i }));

    expect(window.location.hash).toBe('#/tv-shows');
    expect(await screen.findByRole('heading', { name: /^tv shows$/i })).toBeInTheDocument();
  });

  it('renders movie action menus outside the scrollable table', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        movies: [
          {
            id: 1,
            title: 'Tom Clancy Jack Ryan',
            year: 2026,
            description: 'A covert mission unravels a conspiracy.'
          }
        ]
      })
    });

    render(<App />);

    expect(await screen.findByText(/tom clancy jack ryan/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^open action menu$/i }));

    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(menu.closest('.table-scroll')).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /^edit$/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^delete$/i })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /^check bot status$/i })).toBeInTheDocument();
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

  it('checks the public search bot status endpoint', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/status') {
        return {
          ok: true,
          json: async () => ({
            reachable: true,
            lastSuccessfulCheckAt: '2026-05-24T10:00:00.000Z',
            remote: {
              state: 'ok',
              checkedAt: '2026-05-24T09:59:58.000Z',
              uptimeSeconds: 120,
              consecutiveErrorCount: 0,
              lastError: null
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
    fireEvent.click(screen.getByRole('button', { name: /^check bot status$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/public-search/status'));
  });

  it('shows reachable OK public search bot status', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/status') {
        return {
          ok: true,
          json: async () => ({
            reachable: true,
            lastSuccessfulCheckAt: '2026-05-24T10:00:00.000Z',
            remote: {
              state: 'ok',
              checkedAt: '2026-05-24T09:59:58.000Z',
              uptimeSeconds: 120,
              consecutiveErrorCount: 0,
              lastError: null
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
    fireEvent.click(screen.getByRole('button', { name: /^check bot status$/i }));

    expect(await screen.findByText(/^reachable$/i)).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-05-24T10:00:00.000Z').toLocaleString())).toBeInTheDocument();
    expect(screen.getByText(/^OK$/)).toBeInTheDocument();
  });

  it('shows reachable ERROR public search bot status details', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/status') {
        return {
          ok: true,
          json: async () => ({
            reachable: true,
            lastSuccessfulCheckAt: '2026-05-24T10:00:00.000Z',
            remote: {
              state: 'error',
              checkedAt: '2026-05-24T09:59:58.000Z',
              uptimeSeconds: 120,
              consecutiveErrorCount: 2,
              lastError: {
                source: 'telegram',
                at: '2026-05-24T09:58:00.000Z',
                message: 'Channel lookup failed'
              }
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
    fireEvent.click(screen.getByRole('button', { name: /^check bot status$/i }));

    expect(await screen.findByText(/^ERROR$/)).toBeInTheDocument();
    expect(screen.getByText('telegram')).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-05-24T09:58:00.000Z').toLocaleString())).toBeInTheDocument();
    expect(screen.getByText('Channel lookup failed')).toBeInTheDocument();
  });

  it('shows a safe public search bot unreachable message', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/status') {
        return {
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          json: async () => ({
            reachable: false,
            lastSuccessfulCheckAt: null,
            error: 'Public search status is unreachable',
            token: 'secret-token',
            rawLog: 'connection refused'
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
    fireEvent.click(screen.getByRole('button', { name: /^check bot status$/i }));

    expect(await screen.findByText(/^unreachable$/i)).toBeInTheDocument();
    expect(screen.getByText('Public search status is unreachable')).toBeInTheDocument();
    expect(screen.queryByText('secret-token')).not.toBeInTheDocument();
    expect(screen.queryByText('connection refused')).not.toBeInTheDocument();
  });

  it('renders retained public search bot check time from a structured unreachable response', async () => {
    const lastSuccessfulCheckAt = '2026-05-24T10:00:00.000Z';

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ movies: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reachable: true,
          lastSuccessfulCheckAt,
          remote: {
            state: 'ok',
            checkedAt: '2026-05-24T09:59:58.000Z',
            uptimeSeconds: 120,
            consecutiveErrorCount: 0,
            lastError: null
          }
        })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({
          reachable: false,
          lastSuccessfulCheckAt,
          error: 'Public search status check failed',
          token: 'secret-token',
          authorization: 'Bearer secret-token'
        })
      });

    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));

    const checkButton = screen.getByRole('button', { name: /^check bot status$/i });
    fireEvent.click(checkButton);

    expect(await screen.findByText(/^OK$/)).toBeInTheDocument();

    fireEvent.click(checkButton);

    expect(await screen.findByText(/^unreachable$/i)).toBeInTheDocument();
    expect(screen.getByText(new Date(lastSuccessfulCheckAt).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText('Public search status check failed')).toBeInTheDocument();
    expect(screen.queryByText('secret-token')).not.toBeInTheDocument();
    expect(screen.queryByText('Bearer secret-token')).not.toBeInTheDocument();
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

  it('uses a fixed provider dropdown for streaming links', () => {
    const onSave = vi.fn();

    render(<LinkEditorModal open links={[]} onClose={vi.fn()} onSave={onSave} />);

    const providerSelect = screen.getByLabelText(/^provider$/i);
    expect(providerSelect).toHaveDisplayValue('Filekeeper');
    expect(within(providerSelect).getByRole('option', { name: 'Filekeeper' })).toBeInTheDocument();
    expect(within(providerSelect).getByRole('option', { name: 'Mixdrop' })).toBeInTheDocument();

    fireEvent.change(providerSelect, { target: { value: 'Mixdrop' } });
    fireEvent.change(screen.getByLabelText(/^url$/i), { target: { value: 'https://mixdrop.example/watch' } });
    fireEvent.click(screen.getByRole('button', { name: /^save links$/i }));

    expect(onSave).toHaveBeenCalledWith([
      {
        providerName: 'Mixdrop',
        quality: 'HD',
        status: 'active',
        url: 'https://mixdrop.example/watch'
      }
    ]);
  });

  it('automatically dismisses notification toasts', async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /^show toast$/i }));

    expect(screen.getByText('Saved.')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  });

  it('dismisses notification toasts manually', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync') {
        return {
          ok: true,
          json: async () => ({
            sync: {
              syncedAt: '2026-05-24T10:00:00.000Z',
              movies: 1,
              tvShows: 0
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

    expect(await screen.findByText('Public search synced.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^dismiss message$/i }));

    expect(screen.queryByText('Public search synced.')).not.toBeInTheDocument();
  });
});

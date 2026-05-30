import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { LinkEditorModal } from '../../src/client/components/LinkEditorModal';
import { TmdbSearch } from '../../src/client/components/TmdbSearch';
import { ToastProvider, useToast } from '../../src/client/components/ToastProvider';

const fetchMock = vi.fn();

type PublicSearchSyncStatusFixture = {
  configured: boolean;
  hasPublicSearchableContent: boolean;
  hasPendingChanges: boolean;
  current: {
    catalogHash: string;
    movies: number;
    tvShows: number;
  };
  lastSuccessfulSync: null | {
    syncedAt: string;
    movies: number;
    tvShows: number;
  };
};

type PublicSearchPreviewFixture = {
  movies: number;
  tvShows: number;
};

function createPublicSearchSyncStatus(
  overrides: Partial<Omit<PublicSearchSyncStatusFixture, 'current'>> & {
    current?: Partial<PublicSearchSyncStatusFixture['current']>;
  } = {}
): PublicSearchSyncStatusFixture {
  const { current, ...statusOverrides } = overrides;

  return {
    configured: true,
    hasPublicSearchableContent: true,
    hasPendingChanges: true,
    lastSuccessfulSync: null,
    ...statusOverrides,
    current: {
      catalogHash: 'hash-1',
      movies: 1,
      tvShows: 0,
      ...current
    }
  };
}

function createPublicSearchPreview(overrides: Partial<PublicSearchPreviewFixture> = {}): PublicSearchPreviewFixture {
  return {
    movies: 1,
    tvShows: 0,
    ...overrides
  };
}

function ToastHarness() {
  const { showToast } = useToast();

  return (
    <button type="button" onClick={() => showToast('Saved.')}>
      Show toast
    </button>
  );
}

function createAdminSessionResponse() {
  return {
    ok: true,
    json: async () => ({
      user: {
        id: '1',
        email: 'admin@example.com',
        role: 'admin',
        mustChangePassword: false
      }
    })
  };
}

function createSessionResponse(role: 'admin' | 'superadmin' = 'admin') {
  return {
    ok: true,
    json: async () => ({
      user: {
        id: role === 'admin' ? '1' : '2',
        email: `${role}@example.com`,
        role,
        mustChangePassword: false
      }
    })
  };
}

function getRequestHeader(init: RequestInit | undefined, name: string) {
  const headers = init?.headers;

  if (headers instanceof Headers) {
    return headers.get(name);
  }

  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null;
  }

  return headers?.[name as keyof typeof headers] ?? headers?.[name.toLowerCase() as keyof typeof headers] ?? null;
}

async function renderAuthenticatedApp() {
  render(<App />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByRole('navigation', { name: /media navigation/i })).toBeInTheDocument();
}

beforeEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/auth/me') {
      return createAdminSessionResponse();
    }

    if (url === '/api/admin/dashboard') {
      return {
        ok: true,
        json: async () => ({
          dashboard: {
            movies: 0,
            tvShows: 0,
            activeLinks: 0,
            failedTelegramJobs: 0,
            pendingPublicSearchChanges: false
          }
        })
      };
    }

    if (url === '/api/public-search/preview') {
      return {
        ok: true,
        json: async () => ({ preview: createPublicSearchPreview() })
      };
    }

    return {
      ok: true,
      json: async () => ({ movies: [] })
    };
  });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const response = await (init === undefined ? fetchMock(url) : fetchMock(url, init));

    if (url !== '/api/auth/me') {
      return response;
    }

    const payload = await response.json();

    if (Object.prototype.hasOwnProperty.call(payload, 'user')) {
      return {
        ...response,
        json: async () => payload
      };
    }

    return createAdminSessionResponse();
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('App', () => {
  it('shows login when no session exists', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return { ok: true, json: async () => ({ user: null }) };
      }

      return { ok: true, json: async () => ({}) };
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveClass('auth-page');
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^login$/i })).toHaveClass('auth-card__submit');
    expect(screen.queryByText(/sign up/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apple/i })).not.toBeInTheDocument();
  });

  it('submits login through Auth.js credentials flow', async () => {
    let authenticated = false;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return {
          ok: true,
          json: async () => ({
            user: authenticated
              ? { id: '1', email: 'admin@example.com', role: 'admin', mustChangePassword: false }
              : null
          })
        };
      }

      if (url === '/auth/csrf') {
        return { ok: true, json: async () => ({ csrfToken: 'csrf-token' }) };
      }

      if (url === '/auth/callback/credentials') {
        authenticated = true;
        expect(init?.method).toBe('POST');
        expect(getRequestHeader(init, 'X-Auth-Return-Redirect')).toBe('1');
        expect(init?.body?.toString()).toContain('csrfToken=csrf-token');
        expect(init?.body?.toString()).toContain('email=admin%40example.com');
        return { ok: true, json: async () => ({ url: 'http://localhost/' }) };
      }

      if (url === '/api/admin/dashboard') {
        return {
          ok: true,
          json: async () => ({
            dashboard: {
              movies: 0,
              tvShows: 0,
              activeLinks: 0,
              failedTelegramJobs: 0,
              pendingPublicSearchChanges: false
            }
          })
        };
      }

      return { ok: true, json: async () => ({}) };
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText(/^email$/i), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^login$/i }));

    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
  });

  it('shows a login error when Auth.js rejects credentials', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return { ok: true, json: async () => ({ user: null }) };
      }

      if (url === '/auth/csrf') {
        return { ok: true, json: async () => ({ csrfToken: 'csrf-token' }) };
      }

      if (url === '/auth/callback/credentials') {
        expect(init?.method).toBe('POST');
        expect(getRequestHeader(init, 'X-Auth-Return-Redirect')).toBe('1');
        return {
          ok: true,
          json: async () => ({ url: 'http://localhost/auth/signin?error=CredentialsSignin&code=credentials' })
        };
      }

      return { ok: true, json: async () => ({}) };
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText(/^email$/i), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /^login$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^dashboard$/i })).not.toBeInTheDocument();
  });

  it('forces password change when the session requires it', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return {
          ok: true,
          json: async () => ({
            user: {
              id: '2',
              email: 'super@example.com',
              role: 'superadmin',
              mustChangePassword: true
            }
          })
        };
      }

      return { ok: true, json: async () => ({}) };
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /^change password$/i })).toBeInTheDocument();
    expect(screen.getByText('super@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign out$/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /media navigation/i })).not.toBeInTheDocument();
  });

  it('shows an error when forced password-change sign out fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return {
          ok: true,
          json: async () => ({
            user: {
              id: '2',
              email: 'super@example.com',
              role: 'superadmin',
              mustChangePassword: true
            }
          })
        };
      }

      if (url === '/auth/csrf') {
        return { ok: true, json: async () => ({ csrfToken: 'csrf-token' }) };
      }

      if (url === '/auth/signout') {
        expect(getRequestHeader(init as RequestInit | undefined, 'X-Auth-Return-Redirect')).toBe('1');
        return {
          ok: true,
          json: async () => ({ url: 'http://localhost/auth/error?error=Configuration' })
        };
      }

      return { ok: true, json: async () => ({}) };
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /^change password$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign out failed. Please try again.');
    expect(screen.getByText('super@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /welcome back/i })).not.toBeInTheDocument();
  });

  it('shows media navigation and the Add Movie link', async () => {
    await renderAuthenticatedApp();

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    expect(within(navigation).getByRole('button', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^movies$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^add movie$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^tv shows$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^add tv show$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^public search$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^telegram jobs$/i })).toBeInTheDocument();
  });

  it('shows Users navigation to admin users', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    expect(within(navigation).getByRole('button', { name: /^users$/i })).toBeInTheDocument();
  });

  it('does not show Users navigation to superadmin users', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/me') {
        return createSessionResponse('superadmin');
      }

      if (url === '/api/admin/dashboard') {
        return {
          ok: true,
          json: async () => ({
            dashboard: {
              movies: 0,
              tvShows: 0,
              activeLinks: 0,
              failedTelegramJobs: 0,
              pendingPublicSearchChanges: false
            }
          })
        };
      }

      return { ok: true, json: async () => ({ movies: [] }) };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    expect(within(navigation).queryByRole('button', { name: /^users$/i })).not.toBeInTheDocument();
  });

  it('lets an admin create a user and shows the generated password once', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return createAdminSessionResponse();
      }

      if (url === '/api/admin/dashboard') {
        return {
          ok: true,
          json: async () => ({
            dashboard: {
              movies: 0,
              tvShows: 0,
              activeLinks: 0,
              failedTelegramJobs: 0,
              pendingPublicSearchChanges: false
            }
          })
        };
      }

      if (url === '/api/admin/users' && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            users: [
              {
                id: 1,
                email: 'admin@example.com',
                role: 'admin',
                mustChangePassword: false,
                createdAt: '2026-05-01T00:00:00.000Z',
                updatedAt: '2026-05-01T00:00:00.000Z',
                lastLoginAt: '2026-05-29T00:00:00.000Z'
              }
            ]
          })
        };
      }

      if (url === '/api/admin/users' && init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({
          email: 'new@example.com',
          role: 'superadmin'
        });

        return {
          ok: true,
          json: async () => ({
            user: {
              id: 3,
              email: 'new@example.com',
              role: 'superadmin',
              mustChangePassword: true,
              createdAt: '2026-05-30T00:00:00.000Z',
              updatedAt: '2026-05-30T00:00:00.000Z',
              lastLoginAt: null
            },
            temporaryPassword: 'Temp-Pass-123'
          })
        };
      }

      return { ok: true, json: async () => ({ movies: [] }) };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^users$/i }));

    expect(await screen.findByRole('heading', { name: /^users$/i })).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'admin@example.com' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^add user$/i }));
    const dialog = screen.getByRole('dialog', { name: /^add user$/i });
    expect(within(dialog).getByLabelText(/^role$/i)).toHaveDisplayValue('Superadmin');
    fireEvent.change(within(dialog).getByLabelText(/^email$/i), { target: { value: 'new@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^create user$/i }));

    expect(await screen.findByText('Temp-Pass-123')).toBeInTheDocument();
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    expect(screen.getByText('Must change password')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /^add user$/i })).not.toBeInTheDocument();
  });

  it('routes account menu password changes through the app shell', async () => {
    await renderAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: /^change password$/i }));

    expect(await screen.findByRole('heading', { name: /^change password$/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /media navigation/i })).toBeInTheDocument();
    expect(screen.getAllByText('admin@example.com')).toHaveLength(2);
  });

  it('signs out from the account menu', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return createAdminSessionResponse();
      }

      if (url === '/api/admin/dashboard') {
        return {
          ok: true,
          json: async () => ({
            dashboard: {
              movies: 0,
              tvShows: 0,
              activeLinks: 0,
              failedTelegramJobs: 0,
              pendingPublicSearchChanges: false
            }
          })
        };
      }

      if (url === '/auth/csrf') {
        return { ok: true, json: async () => ({ csrfToken: 'csrf-token' }) };
      }

      if (url === '/auth/signout') {
        expect(init?.method).toBe('POST');
        expect(getRequestHeader(init, 'X-Auth-Return-Redirect')).toBe('1');
        expect(init?.body?.toString()).toContain('csrfToken=csrf-token');
        return { ok: true, json: async () => ({ url: 'http://localhost/' }) };
      }

      return { ok: true, json: async () => ({ movies: [] }) };
    });

    await renderAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /media navigation/i })).not.toBeInTheDocument();
  });

  it('renders the dashboard with local admin counts', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/dashboard') {
        return {
          ok: true,
          json: async () => ({
            dashboard: {
              movies: 2,
              tvShows: 1,
              activeLinks: 5,
              failedTelegramJobs: 1,
              pendingPublicSearchChanges: true
            }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^dashboard$/i }));

    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Pending public search sync')).toBeInTheDocument();
  });

  it('renders the Add Movie form after clicking Add Movie', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add movie$/i }));

    expect(screen.getByRole('heading', { name: /^add movie$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^description$/i)).not.toBeInTheDocument();
  });

  it('saves an Add Movie form with the selected topic and trimmed poster URL', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add movie$/i }));

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Topic Movie' } });
    fireEvent.change(screen.getByLabelText(/^poster url$/i), { target: { value: '  https://example.com/topic.jpg  ' } });
    fireEvent.change(screen.getByLabelText(/^topic$/i), { target: { value: 'PINOY_MOVIES' } });
    fireEvent.click(screen.getByRole('button', { name: /^save movie$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/movies',
        expect.objectContaining({
          body: expect.any(String),
          method: 'POST'
        })
      )
    );
    const moviePost = fetchMock.mock.calls.find(([url, init]) => url === '/api/movies' && init?.method === 'POST');
    expect(JSON.parse(moviePost?.[1]?.body as string)).toEqual(
      expect.objectContaining({
        title: 'Topic Movie',
        posterUrl: 'https://example.com/topic.jpg',
        quality: 'HD',
        topicKey: 'PINOY_MOVIES'
      })
    );
  });

  it('rejects an unsafe movie poster URL before saving', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add movie$/i }));

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Unsafe Poster Movie' } });
    fireEvent.change(screen.getByLabelText(/^poster url$/i), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: /^save movie$/i }));

    expect(screen.getByText('Poster URL must start with http:// or https://.')).toBeInTheDocument();
    expect(screen.getByText('No poster preview')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /unsafe poster movie poster preview/i })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/movies', expect.objectContaining({ method: 'POST' }));
  });

  it('shows a duplicate movie warning while adding a similar title', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/dashboard') {
        return {
          ok: true,
          json: async () => ({
            dashboard: {
              movies: 0,
              tvShows: 0,
              activeLinks: 0,
              failedTelegramJobs: 0,
              pendingPublicSearchChanges: false
            }
          })
        };
      }

      if (url === '/api/movies/duplicates?title=Arrival&year=2016') {
        return {
          ok: true,
          json: async () => ({ duplicates: [{ id: 1, title: 'Arrival', year: 2016 }] })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add movie$/i }));
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Arrival' } });
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2016' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
      await Promise.resolve();
    });

    expect(screen.getByText(/possible duplicate/i)).toHaveTextContent('Arrival (2016)');
  });

  it('keeps the selected top-level page after reload through the URL hash', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () => createPublicSearchSyncStatus()
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });
    window.history.replaceState(null, '', '/#/public-search');

    await renderAuthenticatedApp();

    expect(screen.getByRole('heading', { name: /^public search$/i })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    expect(within(navigation).getByRole('button', { name: /^public search$/i })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('1 movie ready to sync')).toBeInTheDocument();
  });

  it('renders failed Telegram jobs and retries one', async () => {
    let failedJobsRequests = 0;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/telegram/jobs/failed') {
        failedJobsRequests += 1;

        return {
          ok: true,
          json: async () => ({
            jobs: failedJobsRequests > 1
              ? []
              : [
                  {
                    id: 7,
                    jobType: 'send',
                    entityType: 'movie',
                    entityId: 42,
                    attempts: 3,
                    lastError: 'Telegram failed',
                    updatedAt: '2026-05-26 10:30:00'
                  }
                ]
          })
        };
      }

      if (url === '/api/telegram/jobs/7/retry') {
        return {
          ok: true,
          json: async () => ({ ok: true })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    const telegramJobsButton = within(navigation).getByRole('button', { name: /^telegram jobs$/i });
    fireEvent.click(telegramJobsButton);

    expect(await screen.findByRole('heading', { name: /^telegram jobs$/i })).toBeInTheDocument();
    expect(await screen.findByText('Telegram failed')).toBeInTheDocument();
    await waitFor(() => expect(within(telegramJobsButton).getByText('1')).toBeInTheDocument());
    expect(within(screen.getByRole('heading', { name: /^telegram jobs$/i })).getByText('1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/telegram/jobs/7/retry', expect.objectContaining({ method: 'POST' }))
    );
    expect(await screen.findByText('Telegram job queued for retry.')).toBeInTheDocument();
    expect(await screen.findByText('No failed Telegram jobs.')).toBeInTheDocument();
    await waitFor(() => expect(within(telegramJobsButton).queryByText('1')).not.toBeInTheDocument());
    expect(within(screen.getByRole('heading', { name: /^telegram jobs$/i })).queryByText('1')).not.toBeInTheDocument();
    expect(failedJobsRequests).toBe(2);
  });

  it('keeps the Telegram jobs page after reload through the URL hash', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/telegram/jobs/failed') {
        return {
          ok: true,
          json: async () => ({ jobs: [] })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });
    window.history.replaceState(null, '', '/#/telegram-jobs');

    await renderAuthenticatedApp();

    expect(screen.getByRole('heading', { name: /^telegram jobs$/i })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    expect(within(navigation).getByRole('button', { name: /^telegram jobs$/i })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('No failed Telegram jobs.')).toBeInTheDocument();
  });

  it('updates the URL hash when navigating between top-level pages', async () => {
    await renderAuthenticatedApp();

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
            year: 2026
          }
        ]
      })
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^movies$/i }));

    expect(await screen.findByText(/tom clancy jack ryan/i)).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^description$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('No description')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^open action menu$/i }));

    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(menu.closest('.table-scroll')).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /^edit$/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('filters movies by title automatically while typing', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^movies$/i }));

    expect(await screen.findByRole('heading', { name: /^movies$/i })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/filter by title/i), { target: { value: 'arrival' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/movies?title=arrival', expect.any(Object)));
    expect(screen.queryByPlaceholderText('2026')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^filter$/i })).not.toBeInTheDocument();
  });

  it('requests movies with a non-default sort query', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^movies$/i }));

    expect(await screen.findByRole('heading', { name: /^movies$/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/movies', expect.any(Object));

    fireEvent.change(screen.getByLabelText(/^sort$/i), { target: { value: 'updated' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/movies?sort=updated', expect.any(Object)));
    expect(screen.getByRole('option', { name: 'Newest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Oldest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Recently updated' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Title A-Z' })).toBeInTheDocument();
  });

  it('renders the Add TV Show form after clicking Add TV Show', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add tv show$/i }));

    expect(screen.getByRole('heading', { name: /^add tv show$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/tmdb search/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^quality$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^description$/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save tv show$/i })).toBeInTheDocument();
  });

  it('saves an Add TV Show form with the selected topic and trimmed poster URL', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add tv show$/i }));

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Topic Show' } });
    fireEvent.change(screen.getByLabelText(/^poster url$/i), { target: { value: '  https://example.com/topic-show.jpg  ' } });
    fireEvent.change(screen.getByLabelText(/^topic$/i), { target: { value: 'PINOY_TV_SERIES' } });
    fireEvent.click(screen.getByRole('button', { name: /^save tv show$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tv-shows',
        expect.objectContaining({
          body: expect.any(String),
          method: 'POST'
        })
      )
    );
    const tvShowPost = fetchMock.mock.calls.find(([url, init]) => url === '/api/tv-shows' && init?.method === 'POST');
    expect(JSON.parse(tvShowPost?.[1]?.body as string)).toEqual(
      expect.objectContaining({
        title: 'Topic Show',
        posterUrl: 'https://example.com/topic-show.jpg',
        quality: 'HD',
        topicKey: 'PINOY_TV_SERIES'
      })
    );
  });

  it('rejects an unsafe TV show poster URL before saving', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add tv show$/i }));

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Unsafe Poster Show' } });
    fireEvent.change(screen.getByLabelText(/^poster url$/i), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: /^save tv show$/i }));

    expect(screen.getByText('Poster URL must start with http:// or https://.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/tv-shows', expect.objectContaining({ method: 'POST' }));
  });

  it('suppresses an unsafe TV show poster preview', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add tv show$/i }));

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Unsafe Preview Show' } });
    fireEvent.change(screen.getByLabelText(/^poster url$/i), { target: { value: 'javascript:alert(1)' } });

    expect(screen.getByText('No poster preview')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /unsafe preview show poster preview/i })).not.toBeInTheDocument();
  });

  it('shows a duplicate TV show warning while adding a similar title', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/dashboard') {
        return {
          ok: true,
          json: async () => ({
            dashboard: {
              movies: 0,
              tvShows: 0,
              activeLinks: 0,
              failedTelegramJobs: 0,
              pendingPublicSearchChanges: false
            }
          })
        };
      }

      if (url === '/api/tv-shows/duplicates?title=Dark&year=2017') {
        return {
          ok: true,
          json: async () => ({ duplicates: [{ id: 1, title: 'Dark', year: 2017 }] })
        };
      }

      return {
        ok: true,
        json: async () => ({ tvShows: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add tv show$/i }));
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Dark' } });
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2017' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
      await Promise.resolve();
    });

    expect(screen.getByText(/possible duplicate/i)).toHaveTextContent('Dark (2017)');
  });

  it('filters TV shows by title automatically while typing', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^tv shows$/i }));
    expect(await screen.findByRole('heading', { name: /^tv shows$/i })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/filter by title/i), { target: { value: 'dark' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tv-shows?title=dark', expect.any(Object)));
    expect(screen.queryByPlaceholderText('2026')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^filter$/i })).not.toBeInTheDocument();
  });

  it('requests TV shows with a non-default sort query', async () => {
    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^tv shows$/i }));

    expect(await screen.findByRole('heading', { name: /^tv shows$/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/tv-shows', expect.any(Object));

    fireEvent.change(screen.getByLabelText(/^sort$/i), { target: { value: 'title_asc' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tv-shows?sort=title_asc', expect.any(Object)));
    expect(screen.getByRole('option', { name: 'Newest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Oldest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Recently updated' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Title A-Z' })).toBeInTheDocument();
  });

  it('renders the Public Search sync page after clicking Public Search', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () => createPublicSearchSyncStatus()
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));

    expect(screen.getByRole('heading', { name: /^public search$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^check bot status$/i })).toBeInTheDocument();
    expect(await screen.findByText('1 movie ready to sync')).toBeInTheDocument();
  });

  it('renders the public search catalog preview', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () =>
            createPublicSearchSyncStatus({
              current: {
                movies: 3,
                tvShows: 2
              }
            })
        };
      }

      if (url === '/api/public-search/preview') {
        return {
          ok: true,
          json: async () => ({
            preview: createPublicSearchPreview({
              movies: 3,
              tvShows: 2
            })
          })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));

    const previewSection = (await screen.findByText('Catalog preview')).closest('.public-search-preview') as HTMLElement;
    await waitFor(() => expect(within(previewSection).getByText('3')).toBeInTheDocument());
    expect(within(previewSection).getByText('2')).toBeInTheDocument();
    expect(within(previewSection).queryByText('Sample movies')).not.toBeInTheDocument();
    expect(within(previewSection).queryByText('Sample TV shows')).not.toBeInTheDocument();
  });

  it('shows a public search preview error when the preview cannot be loaded', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () => createPublicSearchSyncStatus()
        };
      }

      if (url === '/api/public-search/preview') {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: 'Preview failed' })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));

    expect(await screen.findByText('Preview failed')).toBeInTheDocument();
  });

  it('shows loading public search readiness and enables sync when changes are pending', async () => {
    let resolveSyncStatus: (response: unknown) => void = () => undefined;
    const syncStatusPromise = new Promise((resolve) => {
      resolveSyncStatus = resolve;
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return syncStatusPromise;
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));

    expect(screen.getByText('Checking sync readiness...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeDisabled();

    resolveSyncStatus({
      ok: true,
      json: async () =>
        createPublicSearchSyncStatus({
          current: {
            movies: 1,
            tvShows: 2
          }
        })
    });

    expect(await screen.findByText('1 movie and 2 TV shows ready to sync')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeEnabled();
  });

  it('disables the public search sync button when everything is synced', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () =>
            createPublicSearchSyncStatus({
              hasPendingChanges: false,
              lastSuccessfulSync: {
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

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));

    expect(await screen.findByText('Everything is synced')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeDisabled();
  });

  it('shows an unconfigured public search sync readiness message', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () =>
            createPublicSearchSyncStatus({
              configured: false,
              hasPendingChanges: true,
              current: {
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

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));

    expect(await screen.findByText('Public search sync is not configured.')).toBeInTheDocument();
    expect(screen.queryByText('1 movie ready to sync')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeDisabled();
  });

  it('enables the public search sync button when pending changes clear old results', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () =>
            createPublicSearchSyncStatus({
              hasPublicSearchableContent: false,
              hasPendingChanges: true,
              current: {
                movies: 0,
                tvShows: 0
              },
              lastSuccessfulSync: {
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

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));

    expect(await screen.findByText('Public search catalog is empty, sync to clear old results.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeEnabled();
  });

  it('syncs the public search catalog and updates readiness', async () => {
    let previewRequests = 0;

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () => createPublicSearchSyncStatus()
        };
      }

      if (url === '/api/public-search/sync') {
        return {
          ok: true,
          json: async () => ({
            sync: {
              syncedAt: '2026-05-24T10:00:00.000Z',
              movies: 12,
              tvShows: 4
            },
            status: createPublicSearchSyncStatus({
              hasPendingChanges: false,
              current: {
                catalogHash: 'hash-2',
                movies: 12,
                tvShows: 4
              },
              lastSuccessfulSync: {
                syncedAt: '2026-05-24T10:00:00.000Z',
                movies: 12,
                tvShows: 4
              }
            })
          })
        };
      }

      if (url === '/api/public-search/preview') {
        previewRequests += 1;

        return {
          ok: true,
          json: async () => ({
            preview: createPublicSearchPreview({
              movies: previewRequests > 1 ? 12 : 1,
              tvShows: previewRequests > 1 ? 4 : 0
            })
          })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));
    expect(await screen.findByText('1 movie ready to sync')).toBeInTheDocument();
    const previewSection = (await screen.findByText('Catalog preview')).closest('.public-search-preview') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: /^sync public search$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/public-search/sync', expect.objectContaining({ method: 'POST' }))
    );
    expect(await screen.findByText(/12 movies/i)).toBeInTheDocument();
    expect(screen.getByText(/4 tv shows/i)).toBeInTheDocument();
    expect(screen.getByText('Everything is synced')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeDisabled();
    await waitFor(() => expect(within(previewSection).getByText('12')).toBeInTheDocument());
    expect(within(previewSection).getByText('4')).toBeInTheDocument();
    expect(previewRequests).toBe(2);
  });

  it('shows a sync error when the successful public search response is invalid', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () => createPublicSearchSyncStatus()
        };
      }

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

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));
    expect(await screen.findByText('1 movie ready to sync')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^sync public search$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Public search sync response was invalid');
    expect(screen.queryByText('Public search synced.')).not.toBeInTheDocument();
    expect(screen.queryByText(/12 movies/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Everything is synced')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeEnabled();
  });

  it('disables the public search sync button while syncing', async () => {
    let resolveSync: (response: unknown) => void = () => undefined;
    const syncPromise = new Promise((resolve) => {
      resolveSync = resolve;
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () => createPublicSearchSyncStatus()
        };
      }

      if (url === '/api/public-search/sync') {
        return syncPromise;
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));
    expect(await screen.findByText('1 movie ready to sync')).toBeInTheDocument();
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
        },
        status: createPublicSearchSyncStatus({
          hasPendingChanges: false,
          current: {
            catalogHash: 'hash-2',
            movies: 2,
            tvShows: 1
          },
          lastSuccessfulSync: {
            syncedAt: '2026-05-24T10:00:00.000Z',
            movies: 2,
            tvShows: 1
          }
        })
      })
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /^sync public search$/i })).toBeDisabled());
  });

  it('shows the public search sync error message', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () => createPublicSearchSyncStatus()
        };
      }

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

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));
    expect(await screen.findByText('1 movie ready to sync')).toBeInTheDocument();
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

    await renderAuthenticatedApp();

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

    await renderAuthenticatedApp();

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

    await renderAuthenticatedApp();

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

    await renderAuthenticatedApp();

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
    let statusChecks = 0;

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () => createPublicSearchSyncStatus()
        };
      }

      if (url === '/api/public-search/status') {
        statusChecks += 1;

        if (statusChecks === 1) {
          return {
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
          };
        }

        return {
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
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

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

  it('opens season management from the TV show action menu without opening the add dialog', async () => {
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
                year: 2017
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

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^tv shows$/i }));

    expect(await screen.findByText('Dark')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^description$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('No description')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open action menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^manage seasons$/i }));

    expect(await screen.findByRole('heading', { name: /^seasons$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^add season$/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /^add season$/i })).not.toBeInTheDocument();
  });

  it('shows and queues season repost only when a season is repostable', async () => {
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
                year: 2017
              }
            ]
          })
        };
      }

      if (url === '/api/tv-shows/3/seasons' && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            seasons: [
              {
                id: 9,
                tvShowId: 3,
                seasonNumber: 1,
                canRepost: true
              }
            ]
          })
        };
      }

      if (url === '/api/seasons/9/repost' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            season: {
              id: 9,
              tvShowId: 3,
              seasonNumber: 1,
              canRepost: false
            }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({})
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^tv shows$/i }));

    expect(await screen.findByText('Dark')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open action menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^manage seasons$/i }));

    const repostButton = await screen.findByRole('button', { name: /^repost season$/i });
    fireEvent.click(repostButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/seasons/9/repost', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('Season repost queued.')).toBeInTheDocument();
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
                year: 2016
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

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^movies$/i }));

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
                year: 2016
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

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^movies$/i }));

    expect(await screen.findByText('Arrival')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open action menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^edit$/i }));

    expect(await screen.findByRole('heading', { name: /^edit movie$/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Arrival')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^description$/i)).not.toBeInTheDocument();
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
            year: 2010
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

  it('renders TMDB results as an overlay list', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            tmdbId: 27205,
            title: 'Inception',
            year: 2010
          }
        ]
      })
    });

    render(<TmdbSearch onSelect={vi.fn()} />);

    fireEvent.change(screen.getByRole('searchbox', { name: /tmdb search/i }), { target: { value: 'ince' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(351);
    });

    const results = screen.getByLabelText(/tmdb movie results/i);
    expect(results).toHaveClass('tmdb-search__results');
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

  it('saves an untouched streaming link placeholder as an empty list', () => {
    const onSave = vi.fn();

    render(<LinkEditorModal open links={[]} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: /^save links$/i }));

    expect(onSave).toHaveBeenCalledWith([]);
    expect(screen.queryByText('Each saved link needs both a provider and URL.')).not.toBeInTheDocument();
  });

  it('saves an empty list after removing the last streaming link', () => {
    const onSave = vi.fn();

    render(
      <LinkEditorModal
        open
        links={[
          {
            providerName: 'Filekeeper',
            quality: 'HD',
            status: 'active',
            url: 'https://example.com/watch'
          }
        ]}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^remove link$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save links$/i }));

    expect(onSave).toHaveBeenCalledWith([]);
    expect(screen.queryByText('Each saved link needs both a provider and URL.')).not.toBeInTheDocument();
  });

  it('rejects an unsafe streaming link before saving', () => {
    const onSave = vi.fn();

    render(<LinkEditorModal open links={[]} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText(/^url$/i), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: /^save links$/i }));

    expect(screen.getByText('URLs must start with http:// or https://.')).toBeInTheDocument();
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
      if (url === '/api/public-search/sync-status') {
        return {
          ok: true,
          json: async () => createPublicSearchSyncStatus()
        };
      }

      if (url === '/api/public-search/sync') {
        return {
          ok: true,
          json: async () => ({
            sync: {
              syncedAt: '2026-05-24T10:00:00.000Z',
              movies: 1,
              tvShows: 0
            },
            status: createPublicSearchSyncStatus({
              hasPendingChanges: false,
              lastSuccessfulSync: {
                syncedAt: '2026-05-24T10:00:00.000Z',
                movies: 1,
                tvShows: 0
              }
            })
          })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    await renderAuthenticatedApp();

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));
    expect(await screen.findByText('1 movie ready to sync')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^sync public search$/i }));

    expect(await screen.findByText('Public search synced.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^dismiss message$/i }));

    expect(screen.queryByText('Public search synced.')).not.toBeInTheDocument();
  });
});

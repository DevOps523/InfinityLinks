import { useCallback, useEffect, useState } from 'react';
import { AuthGate } from './auth/AuthGate';
import type { SessionUser } from './auth/types';
import { Sidebar, type PageKey } from './components/Sidebar';
import { ToastProvider } from './components/ToastProvider';
import { DashboardPage } from './pages/DashboardPage';
import { EpisodePage } from './pages/EpisodePage';
import { MovieForm } from './pages/MovieForm';
import { MoviesPage } from './pages/MoviesPage';
import { PublicSearchPage } from './pages/PublicSearchPage';
import { SeasonPage } from './pages/SeasonPage';
import { TelegramJobsPage } from './pages/TelegramJobsPage';
import { TvShowForm } from './pages/TvShowForm';
import { TvShowsPage } from './pages/TvShowsPage';

type AppState = {
  editingMovieId: number | null;
  editingTvShowId: number | null;
  selectedTvShowId: number | null;
  selectedSeasonId: number | null;
  openSeasonDialogOnEntry: boolean;
};

type AppActions = {
  setPage: (page: PageKey) => void;
  setEditingMovieId: (id: number | null) => void;
  setEditingTvShowId: (id: number | null) => void;
  setSelectedTvShowId: (id: number | null) => void;
  setSelectedSeasonId: (id: number | null) => void;
  setOpenSeasonDialogOnEntry: (open: boolean) => void;
  setFailedTelegramJobCount: (count: number) => void;
};

const refreshSafePages = new Set<PageKey>([
  'dashboard',
  'movies',
  'add-movie',
  'tv-shows',
  'add-tv-show',
  'public-search',
  'telegram-jobs'
]);

function pageFromHash(hash: string): PageKey {
  const page = hash.replace(/^#\/?/, '') as PageKey;
  return refreshSafePages.has(page) ? page : 'dashboard';
}

function pageToHash(page: PageKey) {
  return `#/${page}`;
}

function renderPage(page: PageKey, state: AppState, actions: AppActions) {
  const { editingMovieId, editingTvShowId, selectedTvShowId, selectedSeasonId, openSeasonDialogOnEntry } = state;
  const {
    setPage,
    setEditingMovieId,
    setEditingTvShowId,
    setSelectedTvShowId,
    setSelectedSeasonId,
    setOpenSeasonDialogOnEntry,
    setFailedTelegramJobCount
  } = actions;

  if (page === 'dashboard') {
    return <DashboardPage />;
  }

  if (page === 'add-movie') {
    return <MovieForm movieId={editingMovieId ?? undefined} onSaved={() => setPage('movies')} />;
  }

  if (page === 'tv-shows') {
    return (
      <TvShowsPage
        onAddTvShow={() => {
          setEditingTvShowId(null);
          setPage('add-tv-show');
        }}
        onEditTvShow={(id) => {
          setEditingTvShowId(id);
          setPage('add-tv-show');
        }}
        onManageSeasons={(id) => {
          setSelectedTvShowId(id);
          setSelectedSeasonId(null);
          setOpenSeasonDialogOnEntry(false);
          setPage('seasons');
        }}
      />
    );
  }

  if (page === 'add-tv-show') {
    return <TvShowForm tvShowId={editingTvShowId ?? undefined} onSaved={() => setPage('tv-shows')} />;
  }

  if (page === 'seasons') {
    if (!selectedTvShowId) {
      return <div className="state-panel">Choose a TV show before managing seasons.</div>;
    }

    return (
      <SeasonPage
        tvShowId={selectedTvShowId}
        openAddOnEntry={openSeasonDialogOnEntry}
        onAddEntryHandled={() => setOpenSeasonDialogOnEntry(false)}
        onBack={() => setPage('tv-shows')}
        onManageEpisodes={(seasonId) => {
          setSelectedSeasonId(seasonId);
          setPage('episodes');
        }}
      />
    );
  }

  if (page === 'episodes') {
    if (!selectedSeasonId) {
      return <div className="state-panel">Choose a season before managing episodes.</div>;
    }

    return <EpisodePage seasonId={selectedSeasonId} onBack={() => setPage('seasons')} />;
  }

  if (page === 'public-search') {
    return <PublicSearchPage />;
  }

  if (page === 'telegram-jobs') {
    return <TelegramJobsPage onFailedJobCountChange={setFailedTelegramJobCount} />;
  }

  return (
    <MoviesPage
      onAddMovie={() => {
        setEditingMovieId(null);
        setPage('add-movie');
      }}
      onEditMovie={(id) => {
        setEditingMovieId(id);
        setPage('add-movie');
      }}
    />
  );
}

type AuthenticatedAppProps = {
  user: SessionUser;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onSignOut: () => Promise<void>;
};

function AuthenticatedApp({ onChangePassword: _onChangePassword, onSignOut: _onSignOut, user: _user }: AuthenticatedAppProps) {
  const [page, setPageState] = useState<PageKey>(() => pageFromHash(window.location.hash));
  const [editingMovieId, setEditingMovieId] = useState<number | null>(null);
  const [editingTvShowId, setEditingTvShowId] = useState<number | null>(null);
  const [selectedTvShowId, setSelectedTvShowId] = useState<number | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null);
  const [openSeasonDialogOnEntry, setOpenSeasonDialogOnEntry] = useState(false);
  const [failedTelegramJobCount, setFailedTelegramJobCount] = useState(0);
  const setPage = useCallback((nextPage: PageKey) => {
    setPageState(nextPage);

    if (refreshSafePages.has(nextPage) && window.location.hash !== pageToHash(nextPage)) {
      window.history.pushState(null, '', pageToHash(nextPage));
    }
  }, []);

  useEffect(() => {
    function handleHashChange() {
      setPageState(pageFromHash(window.location.hash));
      setEditingMovieId(null);
      setEditingTvShowId(null);
      setSelectedTvShowId(null);
      setSelectedSeasonId(null);
      setOpenSeasonDialogOnEntry(false);
    }

    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        currentPage={page}
        failedTelegramJobCount={failedTelegramJobCount}
        onNavigate={(nextPage) => {
          setEditingMovieId(null);
          setEditingTvShowId(null);
          if (
            nextPage === 'dashboard' ||
            nextPage === 'movies' ||
            nextPage === 'tv-shows' ||
            nextPage === 'add-tv-show' ||
            nextPage === 'public-search' ||
            nextPage === 'telegram-jobs'
          ) {
            setSelectedSeasonId(null);
          }
          if (
            nextPage === 'dashboard' ||
            nextPage === 'movies' ||
            nextPage === 'add-movie' ||
            nextPage === 'tv-shows' ||
            nextPage === 'add-tv-show' ||
            nextPage === 'public-search' ||
            nextPage === 'telegram-jobs'
          ) {
            setSelectedTvShowId(null);
          }
          setPage(nextPage);
        }}
      />
      <main className="content-shell">
        {renderPage(
          page,
          {
            editingMovieId,
            editingTvShowId,
            selectedTvShowId,
            selectedSeasonId,
            openSeasonDialogOnEntry
          },
          {
            setPage,
            setEditingMovieId,
            setEditingTvShowId,
            setSelectedTvShowId,
            setSelectedSeasonId,
            setOpenSeasonDialogOnEntry,
            setFailedTelegramJobCount
          }
        )}
      </main>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AuthGate>
        {({ user, onChangePassword, onSignOut }) => (
          <AuthenticatedApp user={user} onChangePassword={onChangePassword} onSignOut={onSignOut} />
        )}
      </AuthGate>
    </ToastProvider>
  );
}

import { useState } from 'react';
import { Sidebar, type PageKey } from './components/Sidebar';
import { ToastProvider } from './components/ToastProvider';
import { MovieForm } from './pages/MovieForm';
import { MoviesPage } from './pages/MoviesPage';

function renderPage(page: PageKey, setPage: (page: PageKey) => void, editingMovieId: number | null, setEditingMovieId: (id: number | null) => void) {
  if (page === 'add-movie') {
    return <MovieForm movieId={editingMovieId ?? undefined} onSaved={() => setPage('movies')} />;
  }

  if (page === 'tv-shows') {
    return (
      <section className="page-section">
        <div className="page-header">
          <div>
            <h1>TV Shows</h1>
            <p>TV show management will be added in a later task.</p>
          </div>
        </div>
      </section>
    );
  }

  if (page === 'add-tv-show') {
    return (
      <section className="page-section">
        <div className="page-header">
          <div>
            <h1>Add TV Show</h1>
            <p>TV show creation will be added in a later task.</p>
          </div>
        </div>
      </section>
    );
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

export function App() {
  const [page, setPage] = useState<PageKey>('movies');
  const [editingMovieId, setEditingMovieId] = useState<number | null>(null);

  return (
    <ToastProvider>
      <div className="app-shell">
        <Sidebar
          currentPage={page}
          onNavigate={(nextPage) => {
            setEditingMovieId(null);
            setPage(nextPage);
          }}
        />
        <main className="content-shell">{renderPage(page, setPage, editingMovieId, setEditingMovieId)}</main>
      </div>
    </ToastProvider>
  );
}

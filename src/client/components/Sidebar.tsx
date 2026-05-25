import { Clapperboard, Film, LayoutDashboard, Plus, Search, Tv } from 'lucide-react';

export type PageKey = 'dashboard' | 'movies' | 'add-movie' | 'tv-shows' | 'add-tv-show' | 'seasons' | 'episodes' | 'public-search';

type SidebarProps = {
  currentPage: PageKey;
  onNavigate: (page: PageKey) => void;
};

const items: Array<{ key: PageKey; label: string; icon: typeof Film }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'movies', label: 'Movies', icon: Film },
  { key: 'add-movie', label: 'Add Movie', icon: Plus },
  { key: 'tv-shows', label: 'TV Shows', icon: Tv },
  { key: 'add-tv-show', label: 'Add TV Show', icon: Clapperboard },
  { key: 'public-search', label: 'Public Search', icon: Search }
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__mark">IL</span>
        <div>
          <strong>InfinityLinks</strong>
          <span>Admin</span>
        </div>
      </div>
      <nav className="sidebar__nav" aria-label="Media navigation">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className="sidebar__button"
              type="button"
              aria-current={currentPage === item.key ? 'page' : undefined}
              onClick={() => onNavigate(item.key)}
            >
              <Icon aria-hidden="true" size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

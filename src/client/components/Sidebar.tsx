import { Clapperboard, Film, LayoutDashboard, Plus, Search, Send, Tv, Users } from 'lucide-react';
import type { UserRole } from '../auth/types';

export type PageKey =
  | 'dashboard'
  | 'movies'
  | 'add-movie'
  | 'tv-shows'
  | 'add-tv-show'
  | 'seasons'
  | 'episodes'
  | 'public-search'
  | 'telegram-jobs'
  | 'users'
  | 'change-password';

type SidebarProps = {
  currentPage: PageKey;
  failedTelegramJobCount?: number;
  userRole: UserRole;
  onNavigate: (page: PageKey) => void;
};

const commonItems: Array<{ key: PageKey; label: string; icon: typeof Film }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'movies', label: 'Movies', icon: Film },
  { key: 'add-movie', label: 'Add Movie', icon: Plus },
  { key: 'tv-shows', label: 'TV Shows', icon: Tv },
  { key: 'add-tv-show', label: 'Add TV Show', icon: Clapperboard },
  { key: 'public-search', label: 'Public Search', icon: Search }
];

const adminItems: Array<{ key: PageKey; label: string; icon: typeof Film }> = [
  { key: 'telegram-jobs', label: 'Telegram Jobs', icon: Send },
  { key: 'users', label: 'Users', icon: Users }
];

export function Sidebar({ currentPage, failedTelegramJobCount = 0, userRole, onNavigate }: SidebarProps) {
  const visibleItems = userRole === 'admin' ? [...commonItems, ...adminItems] : commonItems;

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
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const badgeCount = item.key === 'telegram-jobs' ? failedTelegramJobCount : 0;
          return (
            <button
              key={item.key}
              className="sidebar__button"
              type="button"
              aria-current={currentPage === item.key ? 'page' : undefined}
              onClick={() => onNavigate(item.key)}
            >
              <Icon aria-hidden="true" size={18} />
              <span className="sidebar__button-label">{item.label}</span>
              {badgeCount > 0 ? (
                <span className="sidebar__badge" aria-hidden="true">
                  {badgeCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS public_movies (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER,
  telegram_message_id INTEGER,
  channel_post_url TEXT
);

CREATE TABLE IF NOT EXISTS public_movie_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movie_id INTEGER NOT NULL REFERENCES public_movies(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  quality TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public_tv_shows (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER
);

CREATE TABLE IF NOT EXISTS public_seasons (
  id INTEGER PRIMARY KEY,
  tv_show_id INTEGER NOT NULL REFERENCES public_tv_shows(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  telegram_message_id INTEGER,
  channel_post_url TEXT,
  UNIQUE (tv_show_id, season_number)
);

CREATE TABLE IF NOT EXISTS public_episodes (
  id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES public_seasons(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  UNIQUE (season_id, episode_number)
);

CREATE TABLE IF NOT EXISTS public_episode_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES public_episodes(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  quality TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_successful_sync_at TEXT,
  generated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_public_movies_title ON public_movies(title);
CREATE INDEX IF NOT EXISTS idx_public_movie_providers_movie_id ON public_movie_providers(movie_id);
CREATE INDEX IF NOT EXISTS idx_public_tv_shows_title ON public_tv_shows(title);
CREATE INDEX IF NOT EXISTS idx_public_seasons_tv_show_id ON public_seasons(tv_show_id);
CREATE INDEX IF NOT EXISTS idx_public_episodes_season_id ON public_episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_public_episode_providers_episode_id ON public_episode_providers(episode_id);

CREATE TABLE IF NOT EXISTS subscription_users (
  telegram_user_id INTEGER PRIMARY KEY,
  username TEXT,
  trial_started_at TEXT,
  trial_expires_at TEXT,
  subscription_start_date TEXT,
  subscription_end_date TEXT,
  days_remaining INTEGER,
  status TEXT NOT NULL DEFAULT 'Unpaid'
    CHECK (status IN ('Trial', 'Subscribe', 'Needs Attention', 'Unpaid', 'Kicked')),
  unpaid_since TEXT,
  kicked_at TEXT,
  removed_from_group INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_alert_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  message_id INTEGER,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscription_users_status ON subscription_users(status);
CREATE INDEX IF NOT EXISTS idx_subscription_users_unpaid_since ON subscription_users(unpaid_since);

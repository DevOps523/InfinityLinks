# Telegram Media Admin MVP Design

## Purpose

Build a local, mobile-first admin system for managing movies and TV shows and publishing public Telegram channel posts. The MVP is Telegram-only, has one admin, has no login or roles, and runs on localhost.

Out of scope for the MVP: Discord, subscriptions, login, roles, link checking, automatic FileKeeper integration, automatic MixDrop integration, Docker, Redis, and production multi-user access.

## Selected Approach

Use a single local Node.js application:

- Express backend for API routes, TMDB integration, Telegram integration, queue processing, database access, and serving the production React build.
- React + Vite frontend for the admin UI.
- SQLite database stored as a local file.
- In-process Telegram job queue persisted in SQLite.
- Localhost-only binding by default.

This keeps local setup simple while preserving clean service boundaries for a later VPS deployment.

## Environment Configuration

Sensitive credentials and deployment-specific values are read from environment variables:

```env
TMDB_API_KEY=replace_with_your_tmdb_api_key
TELEGRAM_BOT_TOKEN=replace_with_your_telegram_bot_token
TELEGRAM_CHANNEL_ID=-1003976784492
```

The real TMDB API key and Telegram bot token must not be hardcoded. Because credentials were already pasted in chat, they should be regenerated before production use.

If required values are missing, the backend should show a clear startup or runtime error instead of silently failing.

## Architecture

The backend owns all external API access. The browser never receives the TMDB API key or Telegram bot token.

Main backend units:

- `config`: loads and validates environment variables.
- `db`: SQLite connection, migrations, and query helpers.
- `tmdbService`: searches TMDB, normalizes movie/show data, and writes cache/API logs.
- `telegramService`: sends, edits, and deletes Telegram photo posts.
- `telegramFormatter`: builds movie and season captions.
- `telegramQueue`: persists jobs, processes them sequentially, retries rate limits, and records failures.
- `mediaApi`: Express routes for movies, movie links, TV shows, seasons, episodes, and episode links.

Main frontend units:

- Layout with responsive sidebar/drawer.
- Movies list and Add/Edit Movie forms.
- TV Shows list and Add/Edit TV Show forms.
- Season and Episode management pages.
- Shared TMDB search dropdown.
- Shared link modal and confirmation modal.
- Shared table, filter, toast, and action dropdown components.

## Data Model

Common enum values:

- Media quality: `SD`, `HD`, `Full HD`, `2K`, `4K`.
- Link status: `active`, `inactive`.
- Post status: `pending`, `posted`, `failed`, `deleted`.
- Telegram job status: `queued`, `running`, `succeeded`, `failed`, `waiting_retry`.

### `movies`

Stores one row per movie:

- `id`
- `tmdb_id`
- `title`
- `year`
- `poster_url`
- `description`
- `rating`
- `quality`
- `telegram_message_id`
- `post_status`
- `created_at`
- `updated_at`

Movies have no seasons or episodes.

### `movie_links`

Stores download links for movies:

- `id`
- `movie_id`
- `provider_name`
- `quality`
- `status`
- `url`
- `sort_order`
- `created_at`
- `updated_at`

Each movie can have multiple links. Link quality can differ from the movie's main quality.

### `tv_shows`

Stores one row per TV show:

- `id`
- `tmdb_id`
- `title`
- `year`
- `poster_url`
- `description`
- `rating`
- `quality`
- `created_at`
- `updated_at`

TV shows do not post directly to Telegram.

### `seasons`

Stores one row per show season:

- `id`
- `tv_show_id`
- `season_number`
- `telegram_message_id`
- `post_status`
- `created_at`
- `updated_at`

Each season owns one Telegram post once at least one episode link exists.

### `episodes`

Stores one row per episode:

- `id`
- `season_id`
- `episode_number`
- `created_at`
- `updated_at`

Episodes without links are stored but omitted from Telegram posts.

### `episode_links`

Stores download links for episodes:

- `id`
- `episode_id`
- `provider_name`
- `quality`
- `status`
- `url`
- `sort_order`
- `created_at`
- `updated_at`

Each episode can have multiple links.

### `tmdb_cache`

Stores cached TMDB search results:

- `id`
- `media_type`
- `query`
- `result_payload`
- `expires_at`
- `created_at`
- `updated_at`

### `api_logs`

Stores API activity summaries:

- `id`
- `provider`
- `action`
- `status`
- `request_metadata`
- `response_summary`
- `error_summary`
- `created_at`

### `telegram_jobs`

Stores queued Telegram work:

- `id`
- `job_type`
- `entity_type`
- `entity_id`
- `payload`
- `status`
- `attempts`
- `next_run_at`
- `last_error`
- `created_at`
- `updated_at`

Jobs cover send, edit, and delete operations.

## Admin UI

The UI is mobile-first and responsive. On small screens, the sidebar becomes a drawer.

Sidebar menus:

- Movies
  - Add Movie
- TV Shows
  - Add TV Show

### Movies

The Movies table supports search and filtering by title and year.

Columns:

- ID
- Movie title
- Description
- Year
- Action dropdown

Actions:

- Edit
- Delete

The Add/Edit Movie form includes:

- TMDB API search dropdown.
- Autofilled title, year, poster, description, and rating.
- Manual main quality selection: SD, HD, Full HD, 2K, or 4K.
- One or more download links, each with provider name, quality, status, and URL.

Saving a movie with at least one link queues an immediate Telegram post or edit.

### TV Shows

The TV Shows table supports search and filtering by title and year.

Columns:

- ID
- TV show title
- Description
- Year
- Action dropdown

Actions:

- Add Season
- Edit
- Delete

The Add/Edit TV Show form includes:

- TMDB API search dropdown.
- Autofilled title, year, poster, description, and rating.
- Manual main quality selection: SD, HD, Full HD, 2K, or 4K.

### Seasons

The Season page shows:

- ID
- Season number
- Action dropdown

Actions:

- Add Episode
- Edit
- Delete

### Episodes

The Episode page shows:

- ID
- Episode number
- Links
- Action dropdown

Actions:

- Add Link
- Edit
- Delete

When adding episodes, the admin can add multiple episodes at once using auto-generated episode numbers. When adding links, the admin can add one or multiple links through a modal form.

### Destructive Actions

Deletes are permanent and require a confirmation modal. Confirmed deletes remove database records and queue the related Telegram delete or edit work.

## Telegram Behavior

All Telegram links are public. Telegram buttons are not used.

### Movie Posts

A movie posts immediately after saving if it has at least one link.

The Telegram post is a photo post using the TMDB poster image and a caption containing:

- Title
- Year
- Rating
- Main quality
- Description
- Download links shown directly in the caption

Editing a movie or its links queues an edit of the related Telegram post. Deleting a movie queues deletion of the related Telegram post.

### TV Season Posts

TV shows do not post at the show level. Each season has one Telegram photo post.

A season post is created automatically when the first episode link exists. Later changes edit the same Telegram message.

The season post includes:

- TV show title
- Season number
- Poster
- Rating
- Main quality
- Description
- Only episodes that already have download links

Episodes without links do not appear in the Telegram caption.

Editing a TV show, season, linked episode, or episode link queues an edit for the affected season post. Deleting an episode or link queues an edit so the season post contains only currently linked episodes. Deleting a season queues deletion of its Telegram post. Deleting a TV show queues deletion of all related season posts.

### Caption Length

Telegram photo captions have limited length. The formatter keeps the title, year, rating, quality, and links as priority content. If the caption is too long, the description is trimmed first.

## Queue And Rate Limiting

Telegram send, edit, and delete actions go through `telegram_jobs`.

Queue behavior:

- Process jobs sequentially or with very low concurrency.
- Persist job status in SQLite.
- Retry failed jobs with attempt counts and `last_error`.
- If Telegram returns a rate-limit response, set `next_run_at` using Telegram's retry delay before trying again.
- Keep post status fields updated as pending, posted, failed, or deleted.

TMDB protection:

- Search only after a minimum query length.
- Debounce search input in the UI.
- Cache repeated searches in SQLite.
- Log API success/failure summaries.

## Validation And Error Handling

Forms validate required fields before saving:

- Title or selected TMDB item.
- Quality.
- Provider name for links.
- Link quality.
- Link status.
- Valid URL.

The UI shows toast or banner errors when saves fail or when Telegram actions are queued but later fail.

API responses should be structured and predictable so the UI can show field-level errors where possible.

## Testing Strategy

Testing focuses on the highest-risk behavior:

- Unit tests for Telegram movie caption formatting.
- Unit tests for Telegram season caption formatting, including linked and unlinked episode filtering.
- Unit tests for long-description trimming.
- Unit tests for TMDB cache hits, misses, and expiry.
- API tests for create, edit, and delete flows for movies and movie links.
- API tests for create, edit, and delete flows for shows, seasons, episodes, and episode links.
- Queue tests for successful Telegram jobs and rate-limit retry scheduling.
- UI smoke test for navigation and core forms if it fits cleanly after scaffolding.

## First Milestone Plan

1. Scaffold the Node/Express/React/Vite/SQLite app.
2. Add database schema and migrations.
3. Build backend config loading and validation.
4. Build TMDB search/cache backend and dropdown UI.
5. Build Movies CRUD, movie links, and Telegram movie posting.
6. Build TV Shows CRUD.
7. Build Seasons, Episodes, and Episode Links CRUD.
8. Add season Telegram auto-post, edit, and delete behavior.
9. Add queue retries, API logs, user-facing error states, and UI polish.

## Acceptance Criteria

- The app runs locally on localhost.
- The admin can search TMDB while adding movies and TV shows.
- TMDB selection autofills title, year, poster, description, and rating.
- The admin can manually choose SD, HD, Full HD, 2K, or 4K.
- Movies can have multiple links and post to Telegram after saving.
- TV shows can have seasons and episodes.
- Adding the first linked episode creates one Telegram post for the season.
- Season posts include only episodes with links.
- Editing records updates related Telegram posts.
- Deleting records permanently removes database records and deletes or updates related Telegram posts.
- TMDB searches are debounced and cached.
- Telegram actions are queued and retry rate limits.
- No Discord, login, roles, subscriptions, link checking, FileKeeper automation, or MixDrop automation are included.

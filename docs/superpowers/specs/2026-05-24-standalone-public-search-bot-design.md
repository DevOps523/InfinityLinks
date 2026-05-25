# Standalone Public Search Bot Design

Date: 2026-05-24

## Goal

Make the public search bot deployable without cloning or running the full InfinityLinks admin app on the VPS.

The VPS should only need the standalone bot folder:

```text
apps/public-search-bot/
```

The private local admin app remains on the user's PC. It continues to own editing media, posting to Telegram, and exporting the searchable catalog.

## Current Context

The public search bot service initially lived under `src/public-search` and already had most of the correct runtime behavior:

- `POST /api/sync` catalog sync endpoint.
- SQLite storage for the public catalog.
- Telegram polling runtime.
- `/start` and `/search` handlers.
- channel membership checks for `@infinitylinks65`.
- movie result provider buttons.
- TV season selection and episode provider buttons.
- Original Post buttons for Telegram channel posts.
- active channel and group buttons for `@infinitylinks65` and `@infinitylinks69`.
- rate limiting and reply queue behavior.

However, it is still built and run through the root repo's `package.json`, TypeScript config, dependency tree, and build scripts. That means the VPS currently needs the full repo even though it only runs the public bot.

## Approved Approach

Create a self-contained app inside the same repo:

```text
apps/public-search-bot/
```

This folder will have everything needed to deploy the public bot on a VPS:

```text
apps/public-search-bot/
  package.json
  tsconfig.json
  .env.example
  README.md
  deploy/
    nginx.conf.example
    public-search-bot.service.example
  src/
    app.ts
    index.ts
    poller.ts
    config.ts
    catalog.repository.ts
    catalog.schema.ts
    rate-limit.ts
    search.repository.ts
    sync.routes.ts
    telegram.client.ts
    telegram.reply-queue.ts
    bot/
      callback-data.ts
      formatter.ts
      handlers.ts
    db/
      database.ts
      migrate.ts
      schema.sql
  tests/
    ...
```

The standalone app must not import from the root `src/` tree. The first implementation should copy the current working public-search service into the app folder and adapt imports, package scripts, tests, and docs.

The old `src/public-search` service stayed temporarily for compatibility during the standalone extraction. It was later removed after the standalone app became the public bot runtime.

## Data Flow

The local admin app and standalone bot communicate through the same sync API contract already implemented:

```text
POST /api/sync
Authorization: Bearer <PUBLIC_SEARCH_SYNC_TOKEN>
Content-Type: application/json
```

The local admin app exports only active links from media that has already been posted to the Telegram channel. It sends that catalog to the standalone bot's VPS endpoint.

The standalone bot validates the payload, replaces its local public catalog in SQLite, and serves searches from that SQLite database.

## Configuration

### Local Admin App

The private local admin app keeps its existing root `.env` values and points sync at the VPS:

```env
PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync
PUBLIC_SEARCH_SYNC_TOKEN=same_secret_as_vps
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
```

The local app does not need to be publicly reachable.

### Standalone VPS Bot

The standalone app has its own `.env.example`:

```env
PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token
PUBLIC_SEARCH_SYNC_TOKEN=same_secret_as_local
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
PUBLIC_SEARCH_PORT=3001
```

The SQLite database defaults to a `data/` folder inside the standalone app deployment. The local admin database and the VPS bot database remain separate.

## Runtime Commands

The standalone app commands are run from `apps/public-search-bot/`:

```sh
npm install
npm run dev
npm run build
npm start
npm test
```

Production deployment should be:

```sh
cd apps/public-search-bot
cp .env.example .env
npm install
npm run build
npm start
```

For historical reference, the root repo kept public-search scripts during the compatibility phase, while VPS instructions pointed to the standalone app commands.

## Deployment Examples

The standalone folder should include:

- `deploy/nginx.conf.example`
- `deploy/public-search-bot.service.example`

The Nginx example should proxy public traffic to the local Node process, normally:

```text
http://127.0.0.1:3001
```

It must overwrite or sanitize `X-Forwarded-For` so the sync endpoint rate limiter uses a real forwarded client IP from a trusted local proxy path.

The systemd example should run `npm start` from the standalone app folder with the standalone `.env` loaded.

## Bot Behavior

The standalone app preserves the current accepted behavior:

- `/start` shows search instructions and active channel/group buttons.
- `/search <Movie or TV Show>` searches the synced public catalog.
- Search requires membership in `@infinitylinks65`.
- If the user has not joined the channel, the bot tells them to join first.
- Movie results include:
  - Original Post button.
  - active provider URL buttons.
  - channel/group URL buttons.
- TV search results include:
  - season selection callback buttons.
  - channel/group URL buttons.
- TV season details include:
  - Original Post button for the season post.
  - episode-specific provider URL buttons.
  - channel/group URL buttons.
- Search result keyboards and season detail keyboards must stay under Telegram row and button limits.

## Testing

Copy the current public-search tests into the standalone app and make them run from `apps/public-search-bot` with:

```sh
npm test
```

The standalone test suite should cover:

- configuration loading and defaults.
- database creation and migration.
- catalog payload validation.
- sync endpoint auth and rate limiting.
- search repository behavior.
- Telegram API client behavior.
- formatter behavior, including Original Post and channel/group buttons.
- keyboard splitting limits.
- `/start`, `/search`, membership gate, and season callback handlers.
- reply queue and bot-side rate limiting.
- polling runtime behavior.

Root tests remained green during the compatibility phase.

## Migration Plan

Phase 1 (historical):

- Add `apps/public-search-bot`.
- Copy and adapt current public-search code/tests into it.
- Add standalone package scripts, env example, README, and deploy examples.
- The root local admin app keeps only `src/server/public-search/` for export and sync proxy behavior.
- The standalone app owns the public bot runtime.
- Update README files to explain that the VPS can deploy only `apps/public-search-bot`.

Phase 2 (historical):

- Remove the old root `src/public-search` compatibility copy.
- Remove or update root public-search build/start scripts.
- Keep the local admin export/sync route.
- Keep the same `/api/sync` contract unless a new migration is explicitly planned.

## Success Criteria

- The VPS can deploy only `apps/public-search-bot/`.
- Running `npm install`, `npm run build`, and `npm start` from `apps/public-search-bot/` starts the public bot service.
- Running `npm test` from `apps/public-search-bot/` verifies the standalone app.
- The local admin app can still sync to `https://your-vps.example.com/api/sync`.
- The public bot behavior remains unchanged for Telegram users.
- The full root repo test/build checks remain green during the compatibility phase.

# InfinityLinks

InfinityLinks is a local admin app for saving movie and TV streaming links and publishing MVP updates to a Telegram channel.

## Local Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a local `.env` file from `.env.example`.

   Regenerate any pasted credentials before production, and do not hardcode secrets in source files.

   ```env
   TMDB_API_KEY=replace_with_regenerated_tmdb_api_key
   TELEGRAM_BOT_TOKEN=replace_with_regenerated_telegram_bot_token
   TELEGRAM_CHANNEL_ID=-1003976784492
   HOST=127.0.0.1
   PORT=3000
   DATABASE_PATH=./data/infinitylinks.sqlite
   ```

3. Build the frontend assets served by the local Express app:

   ```sh
   npm run build
   ```

4. Start the local app:

   ```sh
   npm run dev
   ```

5. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Public Search Bot / VPS Setup

The InfinityLinks admin app should stay private on your local machine. Only the separate public search bot service needs to run online on a VPS.

Public Telegram users interact with the bot by sending `/start`, then `/search <Movie or TV Show>`. Before search results are shown, the bot checks whether the user joined `@infinitylinks65`. If the user has not joined, the bot tells them to join the channel and come back before using `/search`. Add the public bot as an admin in `@infinitylinks65` so it can check membership.

Search results link back to the original Telegram channel posts without exposing poster information. Movies show active provider links as inline URL buttons. TV results first show season selection buttons; after a season is selected, the bot shows that season's episodes with provider buttons for each episode.

Only active links and content that has already been posted to the Telegram channel are exported to the public search catalog. Bot replies also include active channel and group buttons for `@infinitylinks65` and `@infinitylinks69`.

Sync is triggered from the local admin app on the `Public Search` page. The `Sync Public Search` button exports the current public catalog from the private local database and posts it to the VPS sync endpoint.

Create the VPS service environment from `.env.public-search.example`:

```env
PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_secret_sync_token
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
PUBLIC_SEARCH_PORT=3001
```

Run the VPS bot service in development:

```sh
npm.cmd run public-search:dev
```

Build and start the VPS bot service for production:

```sh
npm.cmd run build:public-search
npm.cmd run public-search:start
```

For deployment, put the public search service behind a local reverse proxy such as Nginx or Caddy. Configure the proxy to overwrite or sanitize `X-Forwarded-For`; the Express app trusts loopback proxy headers so sync rate limits use the forwarded client IP only when the request comes through that local proxy.

## MVP Scope

- Telegram channel posting only.
- No login, roles, or user management.
- Movies post to Telegram after saving with at least one link.
- TV shows post one Telegram message per season after the first linked episode in that season is saved.
- Telegram buttons are not used.

## Verification

Task 12 local verification completed with:

- `npm.cmd test` passed: 10 test files, 78 tests.
- `npm.cmd run build` passed.
- `npm.cmd run db:migrate` passed.
- Dev server started with dummy environment values at [http://127.0.0.1:3000](http://127.0.0.1:3000) and was stopped after verification.
- Nonvisual HTTP smoke covered `/`, `/movies`, `/movies/new`, `/tv`, `/tv/new`, `/api/health`, `/api/movies`, and `/api/tv-shows`.
- Visual Browser verification was not performed because no in-app browser tool was exposed and Playwright was not installed.

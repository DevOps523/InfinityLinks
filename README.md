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

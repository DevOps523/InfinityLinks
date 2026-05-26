# InfinityLinks

InfinityLinks is a local admin app for saving movie and TV streaming links and publishing MVP updates to a Telegram group.

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
   TELEGRAM_CHANNEL_ID=-1003963665033
   HOST=127.0.0.1
   PORT=3000
   DATABASE_PATH=./data/infinitylinks.sqlite
   ```

   `TELEGRAM_CHANNEL_ID` is the public group chat id. New media posts are routed to configured Telegram topic thread ids based on the Movie or TV Show topic dropdown.

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

The InfinityLinks admin app should stay private on your local machine. For VPS deployment, use the standalone public search bot app in `apps/public-search-bot/`; the VPS does not need the full private admin app.

Public Telegram users interact with the bot by sending `/start`, then `/search <Movie or TV Show>`. The public search bot no longer uses group membership as the final search access gate. It uses the standalone bot's subscription database: first search starts a one-day free trial, active paid users can search, and expired, unpaid, or kicked users are blocked from download links.

Search results link back to the original Telegram group posts without exposing poster information. Movies show active provider links as inline URL buttons. TV results first show season selection buttons; after a season is selected, the bot shows that season's episodes with provider buttons for each episode.

Only active links and content that has already been posted to the Telegram group are exported to the public search catalog. Bot replies also include the active group link for [@infinitylinks69](https://t.me/infinitylinks69). Add the public search bot and subscription bot as admins in [@infinitylinks69](https://t.me/infinitylinks69) so the standalone service can serve searches, post alerts, and remove overdue users.

Sync is triggered from the local admin app on the `Public Search` page. The `Sync Public Search` button exports the current public catalog from the private local database and posts it to the VPS sync endpoint. In the local admin app's `.env`, set `PUBLIC_SEARCH_SYNC_URL` to the VPS `/api/sync` URL and use the same `PUBLIC_SEARCH_SYNC_TOKEN` value that the VPS service uses.

Copy or deploy only `apps/public-search-bot/` to the VPS, then run the standalone app's local commands from that directory. Use Node 22.x because the standalone package requires Node `>=22 <24`.

```sh
cd /opt/infinitylinks-public-search-bot
npm install
npm run build
npm start
```

Create the VPS service environment from `apps/public-search-bot/.env.example`. The standalone service loads `.env` by default, so copy the example to `.env` on the VPS or inject these variables through your process manager. After copying the example, add `PUBLIC_SEARCH_STATUS_TOKEN` as a separate required read-only value; do not reuse `PUBLIC_SEARCH_SYNC_TOKEN`.

Full VPS setup details, including reverse proxy and process manager notes, are in [`apps/public-search-bot/README.md`](apps/public-search-bot/README.md).

### Local-to-VPS Deployment Configuration

Use this split when deploying from your private local admin app to the public VPS bot service.

1. Prepare the standalone VPS app:

   ```sh
   cd /opt/infinitylinks-public-search-bot
   npm install
   cp .env.example .env
   ```

2. Configure the VPS `.env` for the public bot service:

   ```env
   PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token
   PUBLIC_SEARCH_SYNC_TOKEN=use_the_same_long_random_secret_as_local
   PUBLIC_SEARCH_STATUS_TOKEN=replace_with_read_only_status_token
   PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
   PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
   PUBLIC_SEARCH_HOST=127.0.0.1
   PUBLIC_SEARCH_PORT=3001
   SUBSCRIPTION_BOT_TOKEN=replace_with_subscription_bot_token
   SUBSCRIPTION_ADMIN_TOKEN=replace_with_subscription_admin_secret
   GOOGLE_SHEETS_SPREADSHEET_ID=replace_with_google_sheet_id
   GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/opt/infinitylinks-public-search-bot/google-service-account.json
   ```

   `PUBLIC_BOT_TOKEN` is the token for the public search bot. Add the public search bot and the `SUBSCRIPTION_BOT_TOKEN` bot as admins in [@infinitylinks69](https://t.me/infinitylinks69).
   `PUBLIC_SEARCH_STATUS_TOKEN` is a read-only token for status checks. Keep it separate from `PUBLIC_SEARCH_SYNC_TOKEN`, which authorizes catalog sync writes.
   `SUBSCRIPTION_ADMIN_TOKEN` protects the subscription update and alert endpoints used by Google Apps Script.
   Keep `PUBLIC_SEARCH_HOST=127.0.0.1` so the Node service is reachable only through the VPS reverse proxy.

3. Build and run the VPS service:

   ```sh
   npm run build
   npm start
   ```

   For a process manager such as systemd or PM2, run the same start command with the VPS `.env` variables loaded. Keep the service listening on `127.0.0.1:3001` behind your reverse proxy.

4. Point the VPS domain to the service. Example Nginx site:

   ```nginx
   server {
     server_name your-vps.example.com;

     location / {
       proxy_pass http://127.0.0.1:3001;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```

   The local admin app will sync to `https://your-vps.example.com/api/sync`. Configure the proxy to overwrite `X-Forwarded-For` as shown above so sync rate limits use the real client IP.

5. Configure the private local admin app `.env`:

   ```env
   TMDB_API_KEY=replace_with_your_tmdb_api_key
   TELEGRAM_BOT_TOKEN=replace_with_your_private_group_posting_bot_token
   TELEGRAM_CHANNEL_ID=-1003963665033
   HOST=127.0.0.1
   PORT=3000
   DATABASE_PATH=./data/infinitylinks.sqlite

   PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync
   PUBLIC_SEARCH_SYNC_TOKEN=use_the_same_long_random_secret_as_vps
   PUBLIC_SEARCH_STATUS_URL=https://your-vps-domain.example/api/status
   PUBLIC_SEARCH_STATUS_TOKEN=replace-with-read-only-status-token
   PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
   ```

   The local `PUBLIC_SEARCH_SYNC_TOKEN` must exactly match the VPS `PUBLIC_SEARCH_SYNC_TOKEN`. The local app does not need to be publicly reachable.
   The local `PUBLIC_SEARCH_STATUS_TOKEN` must match the VPS read-only status token and must not reuse the sync token. The local admin status panel shows only safe error status; full service logs stay in systemd on the VPS.

6. Sync from local to VPS:

   ```sh
   npm run dev
   ```

   Open [http://127.0.0.1:3000](http://127.0.0.1:3000), go to `Public Search`, and click `Sync Public Search`. The local app exports only active links from content already posted to the Telegram group, then sends that catalog to the VPS `/api/sync` endpoint.

7. Quick checks for the standalone VPS app:

   ```sh
   cd /opt/infinitylinks-public-search-bot
   npm run build
   npm test
   ```

   After syncing, open Telegram and test the public bot with `/start` and `/search <Movie or TV Show>`.

### Reset Databases With Git Bash

Stop the running local app or public bot before deleting a SQLite database file.

To reset the private local admin app database:

```sh
cd /c/Users/Batosai/Desktop/infinitylinks
rm -f ./data/infinitylinks.sqlite
npm run db:migrate
```

To reset the standalone public search bot database:

```sh
cd /c/Users/Batosai/Desktop/infinitylinks/apps/public-search-bot
rm -f ./data/public-search.sqlite
npm run db:migrate
npm run dev
```

After resetting the public search bot database, open the local admin app and click `Sync Public Search` again. The public bot database starts empty until the catalog is synced.

## MVP Scope

- Telegram group posting only.
- No login, roles, or user management.
- Movies post to Telegram after saving with at least one link.
- TV shows post one Telegram message per season after the first linked episode in that season is saved.
- Telegram buttons are not used by the local group-posting MVP.

## Verification

Task 12 local verification completed with:

- `npm.cmd test` passed: 10 test files, 78 tests.
- `npm.cmd run build` passed.
- `npm.cmd run db:migrate` passed.
- Dev server started with dummy environment values at [http://127.0.0.1:3000](http://127.0.0.1:3000) and was stopped after verification.
- Nonvisual HTTP smoke covered `/`, `/movies`, `/movies/new`, `/tv`, `/tv/new`, `/api/health`, `/api/movies`, and `/api/tv-shows`.
- Visual Browser verification was not performed because no in-app browser tool was exposed and Playwright was not installed.

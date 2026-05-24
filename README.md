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

The InfinityLinks admin app should stay private on your local machine. For VPS deployment, use the standalone public search bot app in `apps/public-search-bot/`; the VPS does not need the full private admin app.

Public Telegram users interact with the bot by sending `/start`, then `/search <Movie or TV Show>`. Before search results are shown, the bot checks whether the user joined [@infinitylinks65](https://t.me/infinitylinks65). If the user has not joined, the bot tells them to join the channel and come back before using `/search`. Add the public bot as an admin in [@infinitylinks65](https://t.me/infinitylinks65) so it can check membership.

Search results link back to the original Telegram channel posts without exposing poster information. Movies show active provider links as inline URL buttons. TV results first show season selection buttons; after a season is selected, the bot shows that season's episodes with provider buttons for each episode.

Only active links and content that has already been posted to the Telegram channel are exported to the public search catalog. Bot replies also include active channel and group buttons for [@infinitylinks65](https://t.me/infinitylinks65) and [@infinitylinks69](https://t.me/infinitylinks69).

Sync is triggered from the local admin app on the `Public Search` page. The `Sync Public Search` button exports the current public catalog from the private local database and posts it to the VPS sync endpoint. In the local admin app's `.env`, set `PUBLIC_SEARCH_SYNC_URL` to the VPS `/api/sync` URL and use the same `PUBLIC_SEARCH_SYNC_TOKEN` value that the VPS service uses.

Copy or deploy only `apps/public-search-bot/` to the VPS, then run the standalone app's local commands from that directory. Use Node 22.x because the standalone package requires Node `>=22 <24`.

```sh
cd /opt/infinitylinks-public-search-bot
npm install
npm run build
npm start
```

Create the VPS service environment from `apps/public-search-bot/.env.example`. The standalone service loads `.env` by default, so copy the example to `.env` on the VPS or inject these variables through your process manager.

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
   PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
   PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
   PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
   PUBLIC_SEARCH_HOST=127.0.0.1
   PUBLIC_SEARCH_PORT=3001
   ```

   `PUBLIC_BOT_TOKEN` is the token for the public search bot. Add that bot as an admin in [@infinitylinks65](https://t.me/infinitylinks65) so it can check whether users joined the channel.
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
   TELEGRAM_BOT_TOKEN=replace_with_your_private_channel_posting_bot_token
   TELEGRAM_CHANNEL_ID=-1003976784492
   HOST=127.0.0.1
   PORT=3000
   DATABASE_PATH=./data/infinitylinks.sqlite

   PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync
   PUBLIC_SEARCH_SYNC_TOKEN=use_the_same_long_random_secret_as_vps
   PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
   PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
   ```

   The local `PUBLIC_SEARCH_SYNC_TOKEN` must exactly match the VPS `PUBLIC_SEARCH_SYNC_TOKEN`. The local app does not need to be publicly reachable.

6. Sync from local to VPS:

   ```sh
   npm run dev
   ```

   Open [http://127.0.0.1:3000](http://127.0.0.1:3000), go to `Public Search`, and click `Sync Public Search`. The local app exports only active links from content already posted to the Telegram channel, then sends that catalog to the VPS `/api/sync` endpoint.

7. Quick checks for the standalone VPS app:

   ```sh
   cd /opt/infinitylinks-public-search-bot
   npm run build
   npm test
   ```

   After syncing, open Telegram and test the public bot with `/start` and `/search <Movie or TV Show>`.

## MVP Scope

- Telegram channel posting only.
- No login, roles, or user management.
- Movies post to Telegram after saving with at least one link.
- TV shows post one Telegram message per season after the first linked episode in that season is saved.
- Telegram buttons are not used by the local channel-posting MVP.

## Verification

Task 12 local verification completed with:

- `npm.cmd test` passed: 10 test files, 78 tests.
- `npm.cmd run build` passed.
- `npm.cmd run db:migrate` passed.
- Dev server started with dummy environment values at [http://127.0.0.1:3000](http://127.0.0.1:3000) and was stopped after verification.
- Nonvisual HTTP smoke covered `/`, `/movies`, `/movies/new`, `/tv`, `/tv/new`, `/api/health`, `/api/movies`, and `/api/tv-shows`.
- Visual Browser verification was not performed because no in-app browser tool was exposed and Playwright was not installed.

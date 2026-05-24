# Public Search Bot

Standalone VPS app for the public InfinityLinks Telegram search bot. This app serves the public search bot only; it does not run the private InfinityLinks admin UI.

## Requirements

- Node >=22 <24
- npm
- A VPS behind a reverse proxy
- The public bot must be an admin in `@infinitylinks65`

IMPORTANT: deploy with Node 22.x, not Node 24. The standalone package engines require Node >=22 <24, and `better-sqlite3` is native; Node 24 caused local install failure.

## Setup

```bash
npm install
cp .env.example .env
npm run build
npm start
```

For a systemd install under `/opt/infinitylinks-public-search-bot`, keep app files owned by your deploy user or root as appropriate. The service only needs write access to the SQLite data directory; do not make source files, `node_modules`, `dist`, or `.env` writable by `www-data`.

```bash
sudo install -d -o www-data -g www-data /opt/infinitylinks-public-search-bot/data
sudo chown -R www-data:www-data /opt/infinitylinks-public-search-bot/data
```

## Environment

```env
PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_secret_sync_token
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
PUBLIC_SEARCH_HOST=127.0.0.1
PUBLIC_SEARCH_PORT=3001
```

Keep `PUBLIC_SEARCH_HOST=127.0.0.1` for normal VPS deployments so the Node service is reachable only through the local reverse proxy.
The `data/` folder is included as an empty placeholder; the SQLite database file is created there at runtime and is ignored by git.

## Sync From Local Admin

The local admin app remains private. Configure it with:

```env
PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_secret_sync_token
```

Use the same `PUBLIC_SEARCH_SYNC_TOKEN` value on both the local admin app and this VPS app, then click Sync Public Search in the local admin app.

## Commands

```bash
npm run dev
npm run build
npm start
npm test
```

## Deployment Notes

Run this VPS app behind a TLS reverse proxy such as nginx. The sync endpoint uses a bearer-style secret token, so serve it over HTTPS; certbot can manage the certificate paths shown in the nginx example. The proxy must overwrite or sanitize `X-Forwarded-For` so clients cannot spoof the originating IP chain.

Example nginx and systemd unit files are available in `deploy/`.

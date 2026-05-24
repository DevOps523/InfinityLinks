# Public Search Bot

Standalone VPS app for the public InfinityLinks Telegram search bot. This app serves the public search bot only; it does not run the private InfinityLinks admin UI.

## Requirements

- Node >=22 <24
- npm
- A VPS behind a reverse proxy
- The public bot must be an admin in `@infinitylinks65`

IMPORTANT: deploy with Node 22.x, not Node 24. The standalone package engines require Node >=22 <24, and `better-sqlite3` is native; Node 24 caused local install failure.

## Quick Local Setup

```bash
npm install
cp .env.example .env
npm run build
npm start
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

## VPS Deployment

These steps deploy only this standalone app. The private InfinityLinks admin app stays on your local machine.

### 1. Prepare The Standalone Folder Locally

From the full InfinityLinks repo on your PC, package or copy only this folder:

```text
apps/public-search-bot/
```

That folder contains its own `package.json`, lockfile, source, tests, deploy examples, and env example. The VPS does not need the root admin app.

### 2. Install Node 22 On The VPS

Use Node 22.x. Do not use Node 24 for this app.

Check the version:

```bash
node -v
npm -v
```

Expected Node version:

```text
v22.x.x
```

### 3. Upload The Bot Folder

Copy the standalone folder to the VPS, for example:

```bash
/opt/infinitylinks-public-search-bot
```

After upload, the VPS folder should look like:

```text
/opt/infinitylinks-public-search-bot/
  package.json
  package-lock.json
  .env.example
  src/
  data/
  deploy/
```

### 4. Install Dependencies

Run these commands on the VPS:

```bash
cd /opt/infinitylinks-public-search-bot
npm ci
```

Use `npm ci` for production because it installs from `package-lock.json`.

### 5. Configure `.env`

Create the runtime env file:

```bash
cp .env.example .env
nano .env
```

Set these values:

```env
PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_a_long_random_secret
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
PUBLIC_SEARCH_HOST=127.0.0.1
PUBLIC_SEARCH_PORT=3001
```

Use a long random value for `PUBLIC_SEARCH_SYNC_TOKEN`. The local admin app must use the same token.

### 6. Prepare The Data Directory

Keep app files owned by your deploy user or root as appropriate. Only the SQLite data directory needs write access for the systemd service user.

```bash
sudo install -d -o www-data -g www-data /opt/infinitylinks-public-search-bot/data
sudo chown -R www-data:www-data /opt/infinitylinks-public-search-bot/data
```

Do not make source files, `node_modules`, `dist`, or `.env` writable by `www-data`.

### 7. Build And Smoke Test

Build the app:

```bash
npm run build
```

Start it manually once:

```bash
npm start
```

Expected startup log:

```text
Public search sync API listening on http://127.0.0.1:3001
```

Stop the manual process with `Ctrl+C` before setting up systemd.

### 8. Install The systemd Service

Copy the example service:

```bash
sudo cp deploy/public-search-bot.service.example /etc/systemd/system/public-search-bot.service
```

Review the paths:

```bash
sudo nano /etc/systemd/system/public-search-bot.service
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable public-search-bot
sudo systemctl start public-search-bot
sudo systemctl status public-search-bot
```

View logs:

```bash
sudo journalctl -u public-search-bot -f
```

### 9. Configure Nginx And HTTPS

Install Nginx and copy the example config:

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/public-search-bot
sudo ln -s /etc/nginx/sites-available/public-search-bot /etc/nginx/sites-enabled/public-search-bot
```

Edit the domain and certificate paths:

```bash
sudo nano /etc/nginx/sites-available/public-search-bot
```

The proxy target should remain:

```nginx
proxy_pass http://127.0.0.1:3001;
proxy_set_header X-Forwarded-For $remote_addr;
```

Use Certbot or your preferred TLS setup so the public sync URL is HTTPS. The sync endpoint uses a bearer-style token, so do not expose it over plain HTTP.

Check and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 10. Configure The Local Admin App

On your private local InfinityLinks admin app, set:

```env
PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_the_same_long_random_secret
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
```

The local admin app does not need to be public. It only sends catalog sync requests to the VPS.

### 11. Sync And Test In Telegram

In the local admin app:

1. Open `Public Search`.
2. Click `Sync Public Search`.
3. Open the public Telegram bot.
4. Send `/start`.
5. Send `/search <Movie or TV Show>`.

The bot should require channel membership, then return matching posts and provider buttons.

### 12. Updating The VPS Bot Later

When you change the standalone bot:

```bash
cd /opt/infinitylinks-public-search-bot
# replace the app files with the new standalone folder contents
npm ci
npm run build
sudo systemctl restart public-search-bot
sudo journalctl -u public-search-bot -n 100 --no-pager
```

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

# Public Search Bot

Standalone VPS app for the public InfinityLinks Telegram search bot. This app runs only the public bot and sync API. The private InfinityLinks admin app stays on your local machine.

The public bot uses Telegram long polling, so you do not need to configure a Telegram webhook. The VPS only needs to expose the HTTP API used by the local admin app for catalog sync and status checks.

## Requirements

- Ubuntu or another Linux VPS with SSH access
- Node.js 22.x and npm
- Nginx or another reverse proxy
- HTTPS certificate for the public VPS domain
- A public Telegram bot token for search
- A subscription Telegram bot token for alerts and overdue removals
- The public bot and subscription bot added as admins in `@infinitylinks69`
- A Google Cloud service account JSON key with access to the subscription workbook

Deploy with Node 22.x, not Node 24. This package requires Node `>=22 <24`, and `better-sqlite3` is a native dependency.

## Environment Variables

Create `apps/public-search-bot/.env` on the VPS from `.env.example`:

```env
PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_secret_sync_token
PUBLIC_SEARCH_STATUS_TOKEN=replace_with_read_only_status_token
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
PUBLIC_SEARCH_HOST=127.0.0.1
PUBLIC_SEARCH_PORT=3001
SUBSCRIPTION_BOT_TOKEN=replace_with_subscription_bot_token
SUBSCRIPTION_GROUP_CHAT_ID=-1003963665033
SUBSCRIPTION_ALERT_THREAD_ID=46
SUBSCRIPTION_ADMIN_CONTACT=@seinen_illuminatiks
SUBSCRIPTION_TRIAL_HOURS=24
SUBSCRIPTION_PERIOD_DAYS=31
SUBSCRIPTION_OVERDUE_GRACE_DAYS=1
SUBSCRIPTION_ADMIN_TOKEN=replace_with_subscription_admin_secret
GOOGLE_SHEETS_SPREADSHEET_ID=replace_with_google_sheet_id
GOOGLE_SHEETS_USERS_RANGE=Users!A:G
GOOGLE_SHEETS_HISTORY_RANGE=History!A:G
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/opt/infinitylinks-public-search-bot/google-service-account.json
```

`PUBLIC_BOT_TOKEN` is the Telegram bot token for the public search bot.
`PUBLIC_SEARCH_SYNC_TOKEN` authorizes local admin app writes to `/api/sync`.
`PUBLIC_SEARCH_STATUS_TOKEN` is read-only and is used by `/api/status`.
`PUBLIC_SEARCH_GROUP_HANDLE` is the public group shown in bot replies.
`SUBSCRIPTION_BOT_TOKEN` is the separate Telegram bot token used for subscription alerts and overdue removals.
`SUBSCRIPTION_ADMIN_TOKEN` authorizes `/api/subscriptions/update` and `/api/subscriptions/send-alert`.
`GOOGLE_SERVICE_ACCOUNT_KEY_FILE` points to the Google Cloud service account JSON key on the VPS.

Use different long random values for `PUBLIC_SEARCH_SYNC_TOKEN`, `PUBLIC_SEARCH_STATUS_TOKEN`, and `SUBSCRIPTION_ADMIN_TOKEN`.

## Subscription Access

The standalone service now runs two Telegram bot tokens:

- `PUBLIC_BOT_TOKEN` handles `/start`, `/search`, and search result callbacks.
- `SUBSCRIPTION_BOT_TOKEN` posts subscription alerts and removes overdue users from the group.

Public search access is backed by the standalone SQLite subscription database. A user's first search starts a 1-day trial. Paid access lasts 31 days from the current subscription start date. Users whose subscription is expired, unpaid, kicked, or otherwise inactive are blocked from download links.

Create a Google Sheets workbook with these tabs and headers:

```text
Users: User ID | Username | Start Date | End Date | Days Remaining | Status | Last Updated
History: User ID | Username | Last Status | Kicked At | Last Start Date | Last End Date | Notes
```

The `Users` tab is the current operating view. The `History` tab records previous status and kick activity so operators can audit what changed. Share the workbook with the Google Cloud service account email from the JSON key, then copy that JSON key to the VPS path configured in `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`.

Copy `apps/public-search-bot/google-apps-script/Code.gs` into the workbook's Apps Script project. In Apps Script, set Script Properties:

```text
SUBSCRIPTION_API_BASE_URL=https://your-vps.example.com
SUBSCRIPTION_ADMIN_TOKEN=same value as VPS SUBSCRIPTION_ADMIN_TOKEN
```

Reload the spreadsheet. The `Subscriptions` menu will include `Update Subscription` and `Send Alert`:

- `Update Subscription` POSTs to `/api/subscriptions/update`, synchronizing the sheet and subscription database.
- `Send Alert` POSTs to `/api/subscriptions/send-alert`, refreshing the alert message in the configured Telegram topic.

Operational notes:

- Keep the public search bot token and subscription bot token separate. Both bots need the Telegram permissions required for their jobs in `@infinitylinks69`.
- Run `Update Subscription` after manually changing subscription rows so the VPS database is refreshed from the sheet.
- Use `Send Alert` after updates when you want the alert topic to reflect current subscription state immediately.
- The default trial is 1 day, the default paid period is 31 days, and overdue users have a 1-day grace period before removal jobs are queued.
- Overdue kicks are performed by the subscription bot from persisted jobs with retry/backoff. Check systemd logs before manually intervening.

## Step By Step VPS Deployment

### 1. Prepare The Public Bot Folder On Your PC

From the full InfinityLinks repo, deploy only this folder:

```text
apps/public-search-bot/
```

The VPS does not need the root admin app. The standalone folder contains its own `package.json`, `package-lock.json`, source files, tests, deploy examples, and `.env.example`.

### 2. Upload The Folder To The VPS

Example using `scp` from your PC:

```bash
scp -r apps/public-search-bot root@your-vps-ip:/opt/infinitylinks-public-search-bot
```

Or upload it with your preferred SFTP/SSH tool. On the VPS, the folder should look like this:

```text
/opt/infinitylinks-public-search-bot/
  package.json
  package-lock.json
  .env.example
  src/
  data/
  deploy/
```

### 3. Install Node.js 22 And Nginx On The VPS

Use your preferred Node installer. On Ubuntu, install Node 22 from NodeSource, nvm, or another trusted source, then install Nginx:

```bash
sudo apt update
sudo apt install -y nginx
```

Check the installed version:

```bash
node -v
npm -v
```

Expected Node version:

```text
v22.x.x
```

If Node is missing or the version is wrong, install Node 22 before continuing.

### 4. Install App Dependencies

Run these commands on the VPS:

```bash
cd /opt/infinitylinks-public-search-bot
npm ci
```

Use `npm ci` on the VPS because it installs exactly from `package-lock.json`.

### 5. Create The VPS `.env`

```bash
cd /opt/infinitylinks-public-search-bot
cp .env.example .env
nano .env
```

Set the real values:

```env
PUBLIC_BOT_TOKEN=1234567890:replace_with_real_bot_token
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_a_long_random_secret
PUBLIC_SEARCH_STATUS_TOKEN=replace_with_a_different_long_random_secret
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
PUBLIC_SEARCH_HOST=127.0.0.1
PUBLIC_SEARCH_PORT=3001
```

Keep `PUBLIC_SEARCH_HOST=127.0.0.1` so the Node app is only reachable through Nginx.

### 6. Prepare The Data Directory

The SQLite database is created at runtime. Give the systemd service user write access to `data/` only:

```bash
sudo install -d -o www-data -g www-data /opt/infinitylinks-public-search-bot/data
sudo chown -R www-data:www-data /opt/infinitylinks-public-search-bot/data
```

Do not make source files, `node_modules`, `dist`, or `.env` writable by `www-data`.

### 7. Build And Test The App Manually

```bash
cd /opt/infinitylinks-public-search-bot
npm run build
npm start
```

Expected startup log:

```text
Public search sync API listening on http://127.0.0.1:3001
```

In another SSH terminal, test the local status endpoint:

```bash
cd /opt/infinitylinks-public-search-bot
set -a; . ./.env; set +a
curl -H "Authorization: Bearer $PUBLIC_SEARCH_STATUS_TOKEN" http://127.0.0.1:3001/api/status
```

Stop the manual app process with `Ctrl+C` before setting up systemd.

### 8. Install The systemd Service

```bash
sudo cp /opt/infinitylinks-public-search-bot/deploy/public-search-bot.service.example /etc/systemd/system/public-search-bot.service
sudo nano /etc/systemd/system/public-search-bot.service
```

Confirm these values match your VPS path and runtime user:

```ini
WorkingDirectory=/opt/infinitylinks-public-search-bot
EnvironmentFile=/opt/infinitylinks-public-search-bot/.env
ExecStart=/usr/bin/npm start
User=www-data
Group=www-data
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable public-search-bot
sudo systemctl start public-search-bot
sudo systemctl status public-search-bot
```

View logs:

```bash
sudo journalctl -u public-search-bot -n 100 --no-pager
sudo journalctl -u public-search-bot -f
```

### 9. Configure Nginx

Copy the example config:

```bash
sudo cp /opt/infinitylinks-public-search-bot/deploy/nginx.conf.example /etc/nginx/sites-available/public-search-bot
sudo nano /etc/nginx/sites-available/public-search-bot
```

Change every `your-vps.example.com` value to your real domain. The proxy target should stay:

```nginx
proxy_pass http://127.0.0.1:3001;
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/public-search-bot /etc/nginx/sites-enabled/public-search-bot
sudo nginx -t
sudo systemctl reload nginx
```

Use Certbot or your preferred TLS setup for HTTPS. On Ubuntu with Certbot, a common flow is:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-vps.example.com
```

Do not expose `/api/sync` over plain HTTP because it uses a bearer token.

The provided Nginx example caps `/api/sync` at `5m` and overwrites `X-Forwarded-For` with the real client IP. Keep both settings.

### 10. Test The Public VPS API

From the VPS:

```bash
cd /opt/infinitylinks-public-search-bot
set -a; . ./.env; set +a
curl -H "Authorization: Bearer $PUBLIC_SEARCH_STATUS_TOKEN" http://127.0.0.1:3001/api/status
```

From your PC:

```bash
curl -H "Authorization: Bearer replace_with_status_token" https://your-vps.example.com/api/status
```

If the public HTTPS status check works, the local admin app can reach the VPS.

### 11. Configure The Local Admin App

In the root InfinityLinks `.env` on your PC, set:

```env
PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_the_same_sync_token_from_the_vps
PUBLIC_SEARCH_STATUS_URL=https://your-vps.example.com/api/status
PUBLIC_SEARCH_STATUS_TOKEN=replace_with_the_same_status_token_from_the_vps
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
```

The local admin app only needs the public search sync/status settings and the group handle.

### 12. Sync The Catalog

On your PC:

1. Start the local InfinityLinks admin app.
2. Open `Public Search`.
3. Click `Sync Public Search`.
4. Confirm the sync succeeds.

The VPS bot database starts empty. The public bot will not return results until the first sync completes.

### 13. Test In Telegram

1. Open the public Telegram bot.
2. Send `/start`.
3. Confirm the trial or subscription message is shown.
4. Send `/search <movie or tv show name>`.

The bot should start or validate subscription access, then return matching original posts and provider links for active users.

## Updating The VPS Bot Later

When code changes are ready:

```bash
cd /opt/infinitylinks-public-search-bot
# replace the app files with the new apps/public-search-bot folder contents
npm ci
npm run build
sudo systemctl restart public-search-bot
sudo journalctl -u public-search-bot -n 100 --no-pager
```

After restarting, run a status check and sync again from the local admin app if catalog behavior changed.

## Useful Commands

```bash
npm run dev
npm run build
npm start
npm test
npm run db:migrate
```

## Troubleshooting

If `npm ci` fails, confirm the VPS is using Node 22.x.

If the service starts but Telegram commands do not respond, check:

```bash
sudo journalctl -u public-search-bot -n 100 --no-pager
```

If `/api/status` returns unauthorized, confirm the status token in your curl command matches `PUBLIC_SEARCH_STATUS_TOKEN`.

If `Sync Public Search` fails from the local admin app, confirm:

- `PUBLIC_SEARCH_SYNC_URL` points to `https://your-vps.example.com/api/sync`
- the local sync token matches the VPS `PUBLIC_SEARCH_SYNC_TOKEN`
- Nginx is forwarding to `127.0.0.1:3001`
- `sudo systemctl status public-search-bot` shows the service running

If users are always blocked from search, confirm the public bot is an admin in `@infinitylinks69`.

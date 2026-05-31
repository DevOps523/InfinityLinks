# Public Search Bot

Standalone VPS app for the public InfinityLinks Telegram search bot.

For a hardened production rollout with `/etc` secrets, systemd sandboxing, Nginx/TLS, firewall rules, and verification gates, use [`../../docs/deployment/secure-vps-deployment.md`](../../docs/deployment/secure-vps-deployment.md).

The private InfinityLinks admin app stays on your Windows PC. This VPS app only runs:

- the public Telegram search bot
- the protected catalog sync API used by the local admin app
- the protected status API used by the local admin app
- the subscription APIs used by Google Apps Script

The bot uses Telegram long polling, so you do not need a Telegram webhook.

## Deployment Values Used In This Guide

This guide uses these names. If you choose different names, replace them everywhere.

```text
VPS app folder: /opt/publicinfinity
Linux service user: infinitylinks
systemd service name: public-search-bot
local listen address: 127.0.0.1:3001
public HTTPS domain: https://your-vps.example.com
SQLite database: /var/lib/infinitylinks/public-search.sqlite
Google service account file: /etc/infinitylinks/google-service-account.json
```

Keep `PUBLIC_SEARCH_HOST=127.0.0.1`. Nginx is the public entry point.

## Requirements

- Ubuntu VPS with SSH access
- Domain name pointed to the VPS
- Node.js 22.x and npm
- Nginx and Certbot
- Two Telegram bots from BotFather:
  - public search bot
  - subscription bot
- Both bots added to `@infinitylinks69`
- Google Sheet for subscription data
- Google Cloud service account JSON with access to that sheet

Use Node 22, not Node 24. This app uses `better-sqlite3`, which has native bindings.

## How The Pieces Connect

```text
Windows PC local admin app
  -> POST https://your-vps.example.com/api/sync
  -> GET  https://your-vps.example.com/api/status

Google Apps Script in the subscription sheet
  -> POST https://your-vps.example.com/api/subscriptions/update
  -> POST https://your-vps.example.com/api/subscriptions/send-alert

Telegram users
  -> public search bot long polling on the VPS
```

Tokens:

- `PUBLIC_SEARCH_SYNC_TOKEN`: local admin app can write catalog data.
- `PUBLIC_SEARCH_STATUS_TOKEN`: local admin app can read bot status.
- `SUBSCRIPTION_ADMIN_TOKEN`: Google Apps Script can update subscriptions and send alerts.

Use three different long random secrets.

## Step 1. Prepare Telegram

Create or confirm these BotFather bots:

```text
Public search bot: handles /start, /search, and result buttons
Subscription bot: sends alerts and removes overdue users
```

Add both bots to `@infinitylinks69`.

The subscription bot must be an admin with permission to ban users. The public search bot must be able to receive and answer messages.

Record these values:

```text
PUBLIC_BOT_TOKEN
SUBSCRIPTION_BOT_TOKEN
SUBSCRIPTION_GROUP_CHAT_ID=-1003963665033
SUBSCRIPTION_ALERT_THREAD_ID=46
SUBSCRIPTION_ADMIN_CONTACT=@seinen_illuminatiks
```

## Step 2. Prepare The Google Sheet

Create a Google Sheet with exactly these tabs and headers:

```text
Users: User ID | Username | Start Date | Plan | End Date | Days Remaining | Status | Last Updated
History: User ID | Username | Last Status | Kicked At | Last Start Date | Last End Date | Notes
```

Copy the spreadsheet ID from the URL:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

Keep that value for `GOOGLE_SHEETS_SPREADSHEET_ID`.

For paid users, enter `Start Date` and choose `Plan` as `1 Month`, `3 Months`, or `6 Months`. Blank paid plan cells default to `1 Month`.

## Step 3. Create The Google Service Account

In Google Cloud:

1. Open or create the project used for this bot.
2. Enable the Google Sheets API.
3. Create a service account.
4. Create a JSON key for that service account.
5. Download the JSON file.
6. Open the JSON file and copy `client_email`.
7. Share the Google Sheet with that `client_email` as an editor.

Do not commit the JSON file. It is a secret.

## Step 4. Upload The App Folder To The VPS

Create the dedicated Linux user and target directories before uploading:

```bash
ssh root@your-vps-ip
id -u infinitylinks >/dev/null 2>&1 || sudo adduser --system --group --home /opt/publicinfinity --no-create-home infinitylinks
sudo install -d -o infinitylinks -g infinitylinks -m 755 /opt/publicinfinity
sudo install -d -o root -g infinitylinks -m 750 /etc/infinitylinks
sudo install -d -o infinitylinks -g infinitylinks -m 750 /var/lib/infinitylinks
exit
```

Do not run this service as `www-data`.

From your PC, upload only this folder:

```text
apps/public-search-bot/
```

Use `rsync` if available:

```bash
rsync -av --delete \
  --include '.env.example' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'google-service-account.json' \
  --exclude 'data/' \
  --exclude 'dist/' \
  --exclude 'node_modules/' \
  --exclude '*.sqlite' \
  --exclude '*.sqlite3' \
  --exclude '*.sqlite-wal' \
  --exclude '*.sqlite-shm' \
  --exclude '*.sqlite-journal' \
  --exclude '*.sqlite3-wal' \
  --exclude '*.sqlite3-shm' \
  --exclude '*.sqlite3-journal' \
  apps/public-search-bot/ root@your-vps-ip:/opt/publicinfinity/
```

If you use SFTP, copy the folder contents into `/opt/publicinfinity`.

After upload, the VPS folder should look like this:

```text
/opt/publicinfinity/
  package.json
  package-lock.json
  .env.example
  src/
  deploy/
  google-apps-script/
```

Do not copy local `.env`, local databases, `node_modules`, or Google JSON secrets from your PC.

## Step 5. Install Server Packages

SSH into the VPS:

```bash
ssh root@your-vps-ip
```

Install basic packages:

```bash
sudo apt update
sudo apt install -y nginx build-essential python3
```

Install Node.js 22 using NodeSource, nvm, or your preferred provider. Then verify:

```bash
node -v
npm -v
```

Expected:

```text
v22.x.x
```

Install app dependencies:

```bash
cd /opt/publicinfinity
npm ci
```

If `better-sqlite3` fails with a native binding or `NODE_MODULE_VERSION` error, switch back to Node 22 and reinstall:

```bash
cd /opt/publicinfinity
rm -rf node_modules
npm ci
```

## Step 6. Confirm The Service User And Directories

Confirm the dedicated Linux user and production directories exist:

```bash
id infinitylinks
sudo install -d -o infinitylinks -g infinitylinks -m 755 /opt/publicinfinity
sudo install -d -o root -g infinitylinks -m 750 /etc/infinitylinks
sudo install -d -o infinitylinks -g infinitylinks -m 750 /var/lib/infinitylinks
```

## Step 7. Create The VPS Environment File

Create the production environment file outside the app tree:

```bash
sudo nano /etc/infinitylinks/public-search-bot.env
sudo chown root:infinitylinks /etc/infinitylinks/public-search-bot.env
sudo chmod 640 /etc/infinitylinks/public-search-bot.env
```

Use this shape:

```env
PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token_from_botfather
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_32_plus_random_public_search_sync_token
PUBLIC_SEARCH_STATUS_TOKEN=replace_with_32_plus_random_public_search_status_token
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=/var/lib/infinitylinks/public-search.sqlite
PUBLIC_SEARCH_HOST=127.0.0.1
PUBLIC_SEARCH_PORT=3001

SUBSCRIPTION_BOT_TOKEN=replace_with_subscription_bot_token_from_botfather
SUBSCRIPTION_GROUP_CHAT_ID=-1003963665033
SUBSCRIPTION_ALERT_THREAD_ID=46
SUBSCRIPTION_ADMIN_CONTACT=@seinen_illuminatiks
SUBSCRIPTION_TRIAL_SEARCH_LIMIT=5
SUBSCRIPTION_OVERDUE_GRACE_DAYS=1
SUBSCRIPTION_ADMIN_TOKEN=replace_with_32_plus_random_subscription_admin_token

GOOGLE_SHEETS_SPREADSHEET_ID=replace_with_google_sheet_id
GOOGLE_SHEETS_USERS_RANGE=Users!A:H
GOOGLE_SHEETS_HISTORY_RANGE=History!A:G
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/etc/infinitylinks/google-service-account.json
```

Important:

- Keep `PUBLIC_SEARCH_HOST=127.0.0.1`.
- Use three different secrets for `PUBLIC_SEARCH_SYNC_TOKEN`, `PUBLIC_SEARCH_STATUS_TOKEN`, and `SUBSCRIPTION_ADMIN_TOKEN`.
- `SUBSCRIPTION_ADMIN_TOKEN` must also be saved in Google Apps Script later.
- Keep production secrets in `/etc/infinitylinks/public-search-bot.env`, not `/opt/publicinfinity/.env`.

## Step 8. Add The Google JSON On The VPS

Create the file on the VPS:

```bash
sudo nano /etc/infinitylinks/google-service-account.json
```

Paste the full Google service account JSON into that file and save.

Confirm `/etc/infinitylinks/public-search-bot.env` contains this path:

```env
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/etc/infinitylinks/google-service-account.json
```

## Step 9. Create Writable Paths And File Permissions

Create the writable database folder:

```bash
sudo install -d -o infinitylinks -g infinitylinks -m 750 /var/lib/infinitylinks
sudo chown -R infinitylinks:infinitylinks /var/lib/infinitylinks
```

Protect secrets:

```bash
sudo chown root:infinitylinks /etc/infinitylinks/public-search-bot.env
sudo chmod 640 /etc/infinitylinks/public-search-bot.env
sudo chown root:infinitylinks /etc/infinitylinks/google-service-account.json
sudo chmod 640 /etc/infinitylinks/google-service-account.json
```

## Step 10. Build And Create The Database

Run:

```bash
cd /opt/publicinfinity
set -a; set +H; . /etc/infinitylinks/public-search-bot.env; set +a
npm run build
sudo -u infinitylinks env PUBLIC_SEARCH_DATABASE_PATH="$PUBLIC_SEARCH_DATABASE_PATH" npm run db:migrate
sudo chown -R infinitylinks:infinitylinks /var/lib/infinitylinks
```

Expected database:

```text
/var/lib/infinitylinks/public-search.sqlite
```

## Step 11. Test The App Before systemd

Start the app manually:

```bash
cd /opt/publicinfinity
set -a; set +H; . /etc/infinitylinks/public-search-bot.env; set +a
npm start
```

Expected startup log:

```text
Public search sync API listening on http://127.0.0.1:3001
```

Open a second SSH terminal and test status:

```bash
cd /opt/publicinfinity
set -a; set +H; . /etc/infinitylinks/public-search-bot.env; set +a
curl -H "Authorization: Bearer $PUBLIC_SEARCH_STATUS_TOKEN" http://127.0.0.1:3001/api/status
```

Expected: JSON status output.

Stop the manual app with `Ctrl+C` before continuing.

## Step 12. Install The systemd Service

Copy the service file:

```bash
sudo cp /opt/publicinfinity/deploy/public-search-bot.service.example /etc/systemd/system/public-search-bot.service
sudo nano /etc/systemd/system/public-search-bot.service
```

Confirm these lines:

```ini
WorkingDirectory=/opt/publicinfinity
EnvironmentFile=/etc/infinitylinks/public-search-bot.env
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
ExecStart=/usr/bin/npm start
User=infinitylinks
Group=infinitylinks
ReadWritePaths=/var/lib/infinitylinks
```

If `npm` is not at `/usr/bin/npm`, find it:

```bash
which npm
```

Then update `ExecStart` with the correct path.

Enable and start:

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

## Step 13. Configure Nginx And HTTPS

Copy the Nginx example:

```bash
sudo cp /opt/publicinfinity/deploy/nginx.conf.example /etc/nginx/sites-available/public-search-bot
sudo nano /etc/nginx/sites-available/public-search-bot
```

Replace every `your-vps.example.com` with your real domain. The checked-in example is HTTP-only so `nginx -t` can pass before Certbot creates certificate files.

Keep this proxy target:

```nginx
proxy_pass http://127.0.0.1:3001;
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/public-search-bot /etc/nginx/sites-enabled/public-search-bot
sudo nginx -t
sudo systemctl reload nginx
```

Install HTTPS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-vps.example.com
```

Certbot will update the site with HTTPS listeners and certificate paths.

The sync and subscription APIs use bearer tokens, so use HTTPS before connecting the local admin app or Google Apps Script.

## Step 14. Test The Public API

From the VPS:

```bash
cd /opt/publicinfinity
set -a; set +H; . /etc/infinitylinks/public-search-bot.env; set +a
curl -H "Authorization: Bearer $PUBLIC_SEARCH_STATUS_TOKEN" http://127.0.0.1:3001/api/status
```

From your PC:

```bash
curl -H "Authorization: Bearer replace_with_status_token" https://your-vps.example.com/api/status
```

Expected: JSON status output.

If local works but HTTPS fails, check Nginx:

```bash
sudo nginx -t
sudo systemctl status nginx
sudo journalctl -u nginx -n 100 --no-pager
```

## Step 15. Configure Google Apps Script

Open the Google Sheet.

Go to `Extensions > Apps Script`.

Copy this file into the Apps Script editor:

```text
apps/public-search-bot/google-apps-script/Code.gs
```

Open `Project Settings > Script Properties` and add:

```text
SUBSCRIPTION_API_BASE_URL=https://your-vps.example.com
SUBSCRIPTION_ADMIN_TOKEN=same value as VPS SUBSCRIPTION_ADMIN_TOKEN
```

Save, reload the spreadsheet, then check for the `Subscriptions` menu.

Use:

- `Subscriptions > Update Subscription` after editing subscription rows.
- `Subscriptions > Send Alert` when you want the Telegram alert topic refreshed.

## Step 16. Configure The Local Admin App On Your PC

In the root InfinityLinks `.env` on your PC, set:

```env
PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync
PUBLIC_SEARCH_SYNC_TOKEN=use_the_same_32_plus_random_public_search_sync_token_as_vps
PUBLIC_SEARCH_STATUS_URL=https://your-vps.example.com/api/status
PUBLIC_SEARCH_STATUS_TOKEN=use_the_same_32_plus_random_public_search_status_token_as_vps
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
```

The local admin app only pushes public catalog data and reads bot status. It does not run the public Telegram search bot.

## Step 17. Sync The Public Catalog

On your PC:

1. Start the local InfinityLinks admin app.
2. Open `Public Search`.
3. Click `Sync Public Search`.
4. Confirm the sync succeeds.
5. Click `Check Bot Status`.

The VPS database starts empty. The public bot will not return movie or TV results until this sync succeeds.

## Step 18. Test In Telegram

1. Open the public search bot.
2. Send `/start`.
3. Send `/search movie name`.
4. Confirm results appear.
5. Confirm the user appears in the `Users` sheet after the delayed refresh job.
6. Add `Start Date` and `Plan` for a paid user.
7. Run `Subscriptions > Update Subscription`.
8. Confirm `End Date`, `Days Remaining`, and `Status` are recalculated.

Subscription behavior:

- First successful search starts a 5-search trial quota.
- After 5 successful searches, the next successful search attempt is blocked.
- Searches with no catalog results do not consume the trial quota.
- TV season button clicks do not consume the trial quota.
- Paid access is calculated from `Start Date` and `Plan`.
- At 1 day remaining, status becomes `Needs Attention`.
- At 0 days remaining, status becomes `Unpaid`.
- After the grace period, the subscription bot bans the unpaid user from the group.
- If a banned user pays, update `Start Date` and `Plan`, then run `Update Subscription`; the bot unbans them and refreshes the sheet.

## Updating The VPS Later

When code changes are ready:

```bash
cd /opt/publicinfinity
sudo systemctl stop public-search-bot
# upload or replace the app files with the new apps/public-search-bot contents
npm ci
set -a; set +H; . /etc/infinitylinks/public-search-bot.env; set +a
npm run build
sudo -u infinitylinks env PUBLIC_SEARCH_DATABASE_PATH="$PUBLIC_SEARCH_DATABASE_PATH" npm run db:migrate
sudo chown -R infinitylinks:infinitylinks /var/lib/infinitylinks
sudo systemctl start public-search-bot
sudo journalctl -u public-search-bot -n 100 --no-pager
```

After restarting, run a public status check and sync the catalog again from the local admin app if catalog behavior changed.

## Useful Commands

```bash
cd /opt/publicinfinity
set -a; set +H; . /etc/infinitylinks/public-search-bot.env; set +a
npm run build
sudo -u infinitylinks env PUBLIC_SEARCH_DATABASE_PATH="$PUBLIC_SEARCH_DATABASE_PATH" npm run db:migrate
npm start
npm test
sudo systemctl status public-search-bot
sudo journalctl -u public-search-bot -f
```

## Troubleshooting

### `attempt to write a readonly database`

The service user cannot write the SQLite file or folder. Run:

```bash
sudo systemctl stop public-search-bot
sudo install -d -o infinitylinks -g infinitylinks -m 750 /var/lib/infinitylinks
sudo chown -R infinitylinks:infinitylinks /var/lib/infinitylinks
sudo chmod 750 /var/lib/infinitylinks
sudo systemctl start public-search-bot
```

### `better-sqlite3` native binding errors

Confirm Node is 22.x:

```bash
node -v
```

Then reinstall:

```bash
cd /opt/publicinfinity
rm -rf node_modules
npm ci
npm run build
sudo systemctl restart public-search-bot
```

### Service starts but Telegram does not respond

Check logs:

```bash
sudo journalctl -u public-search-bot -n 100 --no-pager
```

If logs show `ConnectTimeoutError` with an IPv6 address such as `2001:...:443`, confirm this line exists in the systemd service:

```ini
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
```

Then restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart public-search-bot
```

### `/api/status` returns unauthorized

Check:

- the request uses `Authorization: Bearer <token>`
- the token matches `PUBLIC_SEARCH_STATUS_TOKEN`
- you are testing `/api/status`, not `/api/sync`

### `Sync Public Search` fails from the local admin app

Check:

- `PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync`
- local `PUBLIC_SEARCH_SYNC_TOKEN` matches `/etc/infinitylinks/public-search-bot.env`
- Nginx proxies to `127.0.0.1:3001`
- `sudo systemctl status public-search-bot` shows running
- `sudo journalctl -u public-search-bot -n 100 --no-pager` has no sync errors

### `Update Subscription` fails from Google Sheets

Check:

- `SUBSCRIPTION_API_BASE_URL=https://your-vps.example.com`
- Apps Script `SUBSCRIPTION_ADMIN_TOKEN` matches `/etc/infinitylinks/public-search-bot.env`
- `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` exists on the VPS
- the Google Sheet is shared with the service account `client_email`
- the `Users` and `History` headers match exactly

### Users are always blocked

Check:

- the public bot is receiving `/search`
- the subscription database exists at `PUBLIC_SEARCH_DATABASE_PATH`
- the user has remaining trial searches or an active paid subscription row
- systemd logs do not show Google Sheets or Telegram API errors

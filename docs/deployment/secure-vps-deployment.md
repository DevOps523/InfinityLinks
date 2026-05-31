# Secure VPS Deployment

Use this guide after the security-remediation tests pass and before production traffic reaches the public search bot.

## Stop Gates

Do not deploy when any command in this section prints a matching file:

```bash
find apps/public-search-bot -maxdepth 2 \( -name ".env" -o \( -name ".env.*" ! -name ".env.example" \) -o -name "google-service-account.json" \) -print
find apps/public-search-bot -maxdepth 3 \( -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.sqlite-wal" -o -name "*.sqlite-shm" -o -name "*.sqlite-journal" -o -name "*.sqlite3-wal" -o -name "*.sqlite3-shm" -o -name "*.sqlite3-journal" \) -print
```

Revoke any old Google service account key that was ever stored in the app tree, copied through chat, attached to a ticket, or backed up with a release archive. Create the replacement key directly on the VPS in `/etc/infinitylinks`.

## 1. Generate Fresh Secrets

Run these locally or on the VPS and save the values directly into the server secret store:

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
```

Use three different generated values for:

```text
PUBLIC_SEARCH_SYNC_TOKEN
PUBLIC_SEARCH_STATUS_TOKEN
SUBSCRIPTION_ADMIN_TOKEN
```

Create new Telegram bot tokens in BotFather if the old values were ever copied into shared files, logs, screenshots, backups, or support messages.

## 2. Install VPS Prerequisites

Use a fresh Ubuntu VPS with SSH access and a domain already pointed to the server. Install the runtime packages before uploading the app:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx build-essential python3 ufw
```

Install Node.js 22.x with npm through NodeSource, nvm, or your provider's supported package source, then verify:

```bash
node -v
npm -v
```

The Node version must be `v22.x.x`. This app uses `better-sqlite3`, which has native bindings and is pinned to Node `>=22 <24`.

Use a system-level Node install for systemd, or update `ExecStart` in the service file to the path returned by:

```bash
which npm
```

## 3. Create The VPS User And Directories

```bash
sudo adduser --system --group --home /opt/publicinfinity --no-create-home infinitylinks
sudo install -d -o infinitylinks -g infinitylinks -m 755 /opt/publicinfinity
sudo install -d -o root -g infinitylinks -m 750 /etc/infinitylinks
sudo install -d -o infinitylinks -g infinitylinks -m 750 /var/lib/infinitylinks
```

Keep `/opt/publicinfinity` for app code, `/etc/infinitylinks` for secrets, and `/var/lib/infinitylinks` for writable database state.

## 4. Place Secrets Outside The App Tree

Create `/etc/infinitylinks/public-search-bot.env`:

```bash
sudo nano /etc/infinitylinks/public-search-bot.env
sudo chown root:infinitylinks /etc/infinitylinks/public-search-bot.env
sudo chmod 640 /etc/infinitylinks/public-search-bot.env
```

The env file must include:

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

Create the Google service account file directly on the VPS:

```bash
sudo nano /etc/infinitylinks/google-service-account.json
sudo chown root:infinitylinks /etc/infinitylinks/google-service-account.json
sudo chmod 640 /etc/infinitylinks/google-service-account.json
```

## 5. Upload Only Safe App Files

From the repo root on your workstation:

```bash
rsync -av --delete \
  --include ".env.example" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "google-service-account.json" \
  --exclude "data/" \
  --exclude "dist/" \
  --exclude "node_modules/" \
  --exclude "*.sqlite" \
  --exclude "*.sqlite3" \
  --exclude "*.sqlite-wal" \
  --exclude "*.sqlite-shm" \
  --exclude "*.sqlite-journal" \
  --exclude "*.sqlite3-wal" \
  --exclude "*.sqlite3-shm" \
  --exclude "*.sqlite3-journal" \
  apps/public-search-bot/ root@your-vps-ip:/opt/publicinfinity/
```

Verify the deploy tree is clean:

```bash
ssh root@your-vps-ip 'find /opt/publicinfinity -maxdepth 3 \( -name ".env" -o \( -name ".env.*" ! -name ".env.example" \) -o -name "google-service-account.json" -o -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.sqlite-wal" -o -name "*.sqlite-shm" -o -name "*.sqlite-journal" -o -name "*.sqlite3-wal" -o -name "*.sqlite3-shm" -o -name "*.sqlite3-journal" \) -print'
```

The command should print nothing.

## 6. Install, Build, And Migrate

```bash
ssh root@your-vps-ip
cd /opt/publicinfinity
npm ci
npm run build
set -a
set +H
. /etc/infinitylinks/public-search-bot.env
set +a
sudo -u infinitylinks env \
  PUBLIC_SEARCH_DATABASE_PATH="$PUBLIC_SEARCH_DATABASE_PATH" \
  npm run db:migrate
sudo chown -R infinitylinks:infinitylinks /var/lib/infinitylinks
```

## 7. Install systemd Service

Create `/etc/systemd/system/public-search-bot.service`:

```ini
[Unit]
Description=InfinityLinks Public Search Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/publicinfinity
EnvironmentFile=/etc/infinitylinks/public-search-bot.env
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=infinitylinks
Group=infinitylinks
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/infinitylinks

[Install]
WantedBy=multi-user.target
```

If `npm` is not at `/usr/bin/npm`, replace `ExecStart=/usr/bin/npm start` with the absolute path from `which npm`.

Start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable public-search-bot
sudo systemctl start public-search-bot
sudo systemctl status public-search-bot --no-pager
```

## 8. Configure Nginx And TLS

Use Nginx as the only public entry point. The Node app must keep `PUBLIC_SEARCH_HOST=127.0.0.1`.

Create `/etc/nginx/sites-available/public-search-bot` with an HTTP-only config first so `nginx -t` can pass before Certbot creates certificate files:

```nginx
limit_req_zone $binary_remote_addr zone=public_search_api:10m rate=30r/m;

server {
  listen 80;
  server_name your-vps.example.com;

  client_max_body_size 6m;

  location /api/ {
    limit_req zone=public_search_api burst=20 nodelay;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable the site, verify Nginx, and then let Certbot add HTTPS and the redirect:

```bash
sudo ln -s /etc/nginx/sites-available/public-search-bot /etc/nginx/sites-enabled/public-search-bot
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your-vps.example.com --redirect
sudo nginx -t
sudo systemctl reload nginx
```

After Certbot updates the site, keep the proxy target as `http://127.0.0.1:3001` and keep `X-Forwarded-For` set to `$remote_addr`.

## 9. Firewall And SSH

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Keep port `3001` closed to the public internet.

## 10. Post-Deploy Verification

On the VPS:

```bash
sudo systemctl status public-search-bot --no-pager
sudo journalctl -u public-search-bot -n 100 --no-pager
curl -i http://127.0.0.1:3001/api/status
set -a
set +H
. /etc/infinitylinks/public-search-bot.env
set +a
curl -i -H "Authorization: Bearer $PUBLIC_SEARCH_STATUS_TOKEN" http://127.0.0.1:3001/api/status
find /opt/publicinfinity -maxdepth 3 \( -name ".env" -o \( -name ".env.*" ! -name ".env.example" \) -o -name "google-service-account.json" -o -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.sqlite-wal" -o -name "*.sqlite-shm" -o -name "*.sqlite-journal" -o -name "*.sqlite3-wal" -o -name "*.sqlite3-shm" -o -name "*.sqlite3-journal" \) -print
```

The unauthenticated status request should return `401`. The authenticated localhost request should return safe JSON. The `find` command should print nothing.

From your workstation:

```bash
curl -i https://your-vps.example.com/api/status
curl -i -H "Authorization: Bearer your_public_search_status_token" https://your-vps.example.com/api/status
```

## 11. Backup, Rollback, And Rotation

Back up only `/var/lib/infinitylinks` and encrypt the backup before moving it off the VPS. Do not back up `/etc/infinitylinks` into the app release archive.

Before rollback, confirm the rollback package does not contain `.env`, SQLite files, or Google JSON.

Rotate all public bearer tokens after admin turnover, suspected log exposure, accidental upload, or support handoff.

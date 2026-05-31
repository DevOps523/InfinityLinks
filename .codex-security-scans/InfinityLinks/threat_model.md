# InfinityLinks Threat Model

## Overview

InfinityLinks is a TypeScript/Node.js application with two runtime products:

- A private local admin web app in `src/` that serves a React UI and Express API for managing movie and TV streaming links, posting updates to Telegram, syncing a public search catalog, and managing admin users.
- A standalone VPS public search bot in `apps/public-search-bot/` that exposes token-protected sync/status/subscription APIs and runs Telegram long polling for public users.

The private admin app is expected to bind only to loopback addresses (`src/server/config.ts`) and should not be directly exposed to the internet. It protects API routes with Auth.js credentials sessions (`src/server/auth/session.ts`), stores users and media data in SQLite (`src/server/db/`), and keeps secrets in environment variables. The VPS bot is the internet-facing component through Nginx/HTTPS, with its own SQLite database, Telegram bot tokens, Google Sheets service account file, and bearer-token protected APIs.

The assets that matter most are admin credentials, Auth.js session integrity, password hashes, local SQLite databases, Telegram bot tokens, TMDB API keys, public search sync/status/subscription bearer tokens, Google service account JSON, Telegram group/channel authority, catalog integrity, and the confidentiality of unpublished or private media link data.

## Threat Model, Trust Boundaries, and Assumptions

Primary trust boundaries:

- Browser to local admin Express server. The browser can be malicious or compromised. All `/api/*` calls must be authenticated server-side; client-side routing and UI checks are not security boundaries.
- Auth.js credential callback and session cookies. Login credentials cross from browser-controlled form input into `@auth/express`; session state is stored in signed/encrypted JWT cookies derived from `AUTH_SECRET`.
- Admin API to SQLite. Request bodies and route parameters cross into SQL query builders in repositories. Prepared statements are expected to preserve SQL syntax boundaries.
- Local admin app to Telegram and TMDB. Operator-controlled secrets authorize outbound requests. Any SSRF-like behavior, log leakage, or user-influenced outbound URL construction would matter.
- Local admin app to VPS public search service. Catalog sync crosses from a private environment to a public internet-facing endpoint, authenticated by `PUBLIC_SEARCH_SYNC_TOKEN`.
- VPS public users to Telegram bot handlers. Public Telegram messages, callback payloads, usernames, and user IDs are attacker-controlled and must not grant access to private sync/status/subscription operations.
- Google Apps Script to VPS subscription APIs. Sheet data and Apps Script HTTP requests are semi-trusted operational inputs authenticated by `SUBSCRIPTION_ADMIN_TOKEN`.
- Nginx/reverse proxy to public-search Express app. The public app should listen on loopback and trust only proxy-provided request metadata that Nginx controls.
- Build/release tooling to runtime. Packaged executables, generated `dist/`, local `.env` files, SQLite files, and `node_modules/` are not source trust anchors.

Attacker-controlled inputs include login email/password fields, all browser requests, media/link form fields, admin user management form fields, public search sync/status requests if tokens leak, Telegram public bot messages and callback data, Google Sheet row values after sheet editors modify them, HTTP headers at the reverse proxy boundary, and any file paths/config values that can be influenced by environment variables in deployment.

Operator-controlled inputs include `.env` values, Telegram bot membership/admin permissions, Google service account JSON, Google Sheet sharing, VPS systemd/Nginx configuration, SQLite database files, and the choice to expose or keep private the local admin app.

Developer-controlled inputs include source code, tests, package lockfiles, release scripts, and deployment examples. These are in scope for supply-chain and secure-default review, but a vulnerability is less severe when exploitation requires commit access or local shell access.

Assumptions:

- The private admin app is not intentionally internet-exposed; if it is exposed beyond loopback, auth/session/CSRF/host controls become high-impact internet-facing controls.
- `AUTH_SECRET`, bot tokens, sync/status/subscription tokens, and Google service account JSON remain secret and are never committed, logged, or served to the browser.
- Nginx terminates HTTPS for the VPS app and proxies to `127.0.0.1:3001`.
- SQLite databases are local files and must be protected by filesystem permissions; remote attackers should only influence database writes through authenticated APIs or Telegram bot workflows.

## Attack Surface, Mitigations, and Attacker Stories

Admin authentication and session management are the highest-risk surfaces. `src/server/auth/session.ts` uses Auth.js credentials, JWT sessions, scrypt password verification, and database-backed user refresh on each API request. `src/server/auth/passwords.ts` hashes passwords with scrypt and random salts. `src/server/auth/auth.routes.ts` handles current-user and password-change APIs. `src/client/auth/auth-api.ts` performs CSRF-token fetches before credential login and sign-out. Relevant failure modes include weak or leaked `AUTH_SECRET`, cookies accepted over untrusted hosts, missing CSRF protections on state-changing APIs, brute-forceable login, session state that stays privileged after role/user changes, and temporary passwords exposed in browser responses longer than necessary.

Admin authorization is concentrated in `src/server/app.ts`, `src/server/auth/session.ts`, and `src/server/admin/users.routes.ts`. The API-wide `requireApiAuth` middleware protects `/api` routes before admin/media/Telegram/public-search routers mount. User-management routes require the current database user to have role `admin`. Important attacker stories include a lower-privilege user invoking admin-only user management, a deleted or demoted user continuing to act through a stale JWT, and direct API calls bypassing React UI restrictions.

Browser credential exposure matters because the app necessarily sends login passwords and generated temporary passwords through the browser. The expected invariant is that secrets are sent only over same-origin HTTPS or loopback, are never stored in localStorage/sessionStorage, are not embedded in the static bundle, and are not logged. A compromised browser is generally out of scope, but accidental exposure through source maps, error pages, debug output, persistent storage, or a public local app binding would be in scope.

Request origin/host controls matter because the local admin app is intended to be private. `src/server/config.ts` restricts `HOST` to loopback values and requires HTTPS URLs for public search sync/status targets. `src/server/security/api-request-guard.ts` is expected to reject suspicious admin API requests based on host/custom-header checks. If that guard is bypassable, a malicious website could try to drive loopback admin APIs from the user's browser.

Data validation and injection risks are present wherever request bodies reach SQLite repositories or outbound APIs. The codebase uses Zod in many route/config layers and better-sqlite3 prepared statements in repositories. A critical failure would be attacker-controlled SQL syntax or file path traversal leading to database overwrite or arbitrary file access. A lower-severity failure would be malformed media data causing inconsistent catalog entries without privilege escalation.

Public search VPS APIs are internet-facing. `apps/public-search-bot/src/config.ts` requires distinct sync/status/subscription bearer tokens and loopback binding by default. `apps/public-search-bot/src/sync.routes.ts`, `status.routes.ts`, and subscription routes must compare bearer tokens safely, enforce payload limits, rate-limit expensive write paths, and avoid leaking catalog or operational status beyond the intended audience. Public Telegram bot handlers must treat message text, callback data, usernames, and user IDs as untrusted.

Telegram and Google integrations are privileged external boundaries. Telegram bot tokens can post, search, alert, or remove users from the group depending on bot permissions. Google service account JSON can read/write subscription sheets. Any repository behavior that logs these secrets, serves them statically, commits them, copies them into release bundles, or exposes them in client responses is high impact.

Deployment and packaging are security-relevant. `README.md`, `apps/public-search-bot/README.md`, deploy examples, `.env.example`, `.gitignore`, and release scripts define secure defaults. The important mitigations are loopback binding, HTTPS at Nginx, separate tokens for write/read/admin APIs, protected filesystem permissions on `.env` and Google JSON, excluding local databases/secrets from uploads, and running the VPS app as a dedicated non-root user.

## Severity Calibration (Critical, High, Medium, Low)

Critical findings in this repository would include hardcoded real secrets in source or built client assets; an unauthenticated or CSRF-prone path that can create users, reset passwords, sync arbitrary public catalog data, or control Telegram postings; SQL injection reachable from public Telegram or unauthenticated HTTP input with data modification impact; or a deployment default that exposes the private admin app publicly without auth.

High findings would include login/session flaws that allow credential theft, session forgery, persistent privilege after user deletion/demotion, brute-forceable admin login without meaningful throttling, browser-exposed bearer tokens or temporary passwords through static assets/logs/storage, public VPS APIs accepting shared/reused tokens for different privileges, or Nginx/systemd examples that cause the public service to listen on a public interface with secrets readable by the wrong user.

Medium findings would include missing or weak rate limits on login or public sync endpoints, insufficient validation causing catalog corruption or subscription bypass, overly verbose operational status responses, unsafe handling of proxy headers that enables rate-limit evasion, temporary passwords remaining valid after first login, or repository scripts that make accidental deployment of `.env`, SQLite data, or Google JSON likely.

Low findings would include minor information leaks in generic error messages, missing hardening headers for a loopback-only admin UI, weak documentation around token rotation, developer-only scripts with unsafe assumptions that require local shell access, or tests/examples that use insecure placeholder values without affecting runtime defaults.

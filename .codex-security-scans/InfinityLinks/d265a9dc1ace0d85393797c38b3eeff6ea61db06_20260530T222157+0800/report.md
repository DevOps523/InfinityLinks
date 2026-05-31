# Security Review: InfinityLinks

## Scope

- Scan mode: repository-wide Codex Security scan of `C:\Users\Administrator\Desktop\InfinityLinks` at commit `d265a9dc1ace0d85393797c38b3eeff6ea61db06`.
- Primary focus requested by the user: login/authentication, browser credential exposure, and secure VPS deployment.
- In-scope code: private local admin app, public-search bot VPS service, Telegram integrations, SQLite repositories, deployment docs, and client/browser code present in this checkout.
- Generated context: the threat model was generated during Phase 1 and copied to `artifacts/01_context/threat_model.md` for this scan.
- Runtime validation: targeted Vitest artifacts reproduced the surviving auth, token-policy, token-throttling, and Telegram job authorization issues. Secret files were inspected only in redacted form.
- Explicit limitation: this scan did not connect to a live VPS, Telegram account, Google Sheet, or external network service. It reviewed this local checkout and existing local build artifacts.

### Scan Summary

| Field | Value |
|---|---|
| Reportable findings | 6 |
| Severity mix | high 1, medium 3, low 2 |
| Confidence mix | high 6 |
| Coverage | 114/114 ranked deep-review rows closed in `artifacts/02_discovery/work_ledger.jsonl` |
| Validation mode | Source review plus targeted local Vitest validation artifacts |
| Markdown report | `C:\Users\Administrator\Desktop\InfinityLinks\.codex-security-scans\InfinityLinks\d265a9dc1ace0d85393797c38b3eeff6ea61db06_20260530T222157+0800\report.md` |
| HTML report | `C:\Users\Administrator\Desktop\InfinityLinks\.codex-security-scans\InfinityLinks\d265a9dc1ace0d85393797c38b3eeff6ea61db06_20260530T222157+0800\report.html` |

## Threat Model

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

## Findings

| Finding | Severity | Confidence |
|---|---|---|
| [Google service account key is present in the deployable app tree](#1-google-service-account-key-is-present-in-the-deployable-app-tree) | high | high |
| [Forced password-change state is enforced only in the browser UI](#2-forced-password-change-state-is-enforced-only-in-the-browser-ui) | medium | high |
| [Public bot bearer tokens accept trivially weak or placeholder values](#3-public-bot-bearer-tokens-accept-trivially-weak-or-placeholder-values) | medium | high |
| [Authenticated non-admin users can list and retry failed Telegram jobs](#4-authenticated-non-admin-users-can-list-and-retry-failed-telegram-jobs) | medium | high |
| [Credentials login has no failed-attempt throttling](#5-credentials-login-has-no-failed-attempt-throttling) | low | high |
| [Status and subscription bearer endpoints do not throttle failed authentication](#6-status-and-subscription-bearer-endpoints-do-not-throttle-failed-authentication) | low | high |

### Confidence Scale

| Label | Meaning |
|---|---|
| high | Direct source, configuration, or runtime evidence supports the finding, with no material unresolved reachability or exploitability blocker. |
| medium | Source evidence supports a plausible issue, but runtime behavior, deployment configuration, role reachability, type constraints, or exploit reliability still need proof. |
| low | Weak or incomplete evidence; included only when follow-up candidates are intentionally retained. |

### [1] Google service account key is present in the deployable app tree

| Field | Value |
|---|---|
| Severity | high |
| Confidence | high |
| Confidence rationale | Redacted local inspection confirmed the file exists, has service_account structure, includes private key fields, is not git-tracked, and is ignored by .gitignore. Searches for the actual local secret values across client and dist output did not find browser exposure. |
| Category | Hardcoded credentials / secret material in deployable source tree |
| CWE | CWE-798: Use of Hard-coded Credentials |
| Affected lines | apps/public-search-bot/google-service-account.json:1; .gitignore:4; apps/public-search-bot/src/config.ts:49 |

#### Summary

A real Google service account JSON key is present at the root of the deployable public-search bot package. It is ignored by git and not bundled into browser code, but VPS copy, backup, archive, SFTP, support, or misconfigured static serving workflows can expose a credential that grants Google Sheets access.

#### Validation

Redacted local inspection confirmed the file exists, has service_account structure, includes private key fields, is not git-tracked, and is ignored by .gitignore. Searches for the actual local secret values across client and dist output did not find browser exposure.

Validation artifacts and receipts are saved under `artifacts/05_findings/DEPLOY-SECRETS-001`.

#### Dataflow

Local credential file -> GOOGLE_SERVICE_ACCOUNT_KEY_FILE config -> Google Sheets client authentication -> read/write subscription sheet operations.

#### Reachability

Anyone who gains access to a deployment archive, VPS copy, backup, or mistakenly served source directory can recover the key without needing application authentication. Direct browser exposure was not observed in this repo.

#### Severity

high: High because the file is live credential material in a deployable directory and compromise gives access to the subscription control-plane data store. Severity would drop after rotation and moving credentials outside the source/deploy tree; it would rise if the VPS serves repository files directly.

#### Remediation

Revoke and rotate the Google service account key. Store credentials outside the repo and deploy tree, preferably as a root-owned environment secret, systemd credential, or secret-manager mount. Keep only a path or injected JSON in runtime config, deny web access to source directories, and add a startup check that rejects key files under the repository path.

### [2] Forced password-change state is enforced only in the browser UI

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | high |
| Confidence rationale | A validation test created an admin user with must_change_password=1 and showed GET /api/admin/users still returns 200. The same test showed an existing signed-in admin session remains authorized after the database flips must_change_password to true. |
| Category | Authorization bypass / incomplete server-side session enforcement |
| CWE | CWE-602: Client-Side Enforcement of Server-Side Security |
| Affected lines | src/server/auth/session.ts:106-127; src/client/auth/AuthGate.tsx:78-85; src/server/admin/users.routes.ts:75-83; src/server/admin/users.routes.ts:128-132 |

#### Summary

Temporary and reset credentials set mustChangePassword, and the React auth gate sends those users to the change-password screen. The server-side API middleware refreshes the DB user but does not deny API access while mustChangePassword remains true, so the sensitive state is only enforced by client navigation.

#### Validation

A validation test created an admin user with must_change_password=1 and showed GET /api/admin/users still returns 200. The same test showed an existing signed-in admin session remains authorized after the database flips must_change_password to true.

Validation artifacts and receipts are saved under `artifacts/05_findings/AUTH-MUSTCHANGE-001`.

#### Dataflow

Temporary/reset credential -> Auth.js credentials authorize -> session cookie -> /api middleware requireApiAuth -> res.locals.authUser -> protected admin routes.

#### Reachability

An attacker with a temporary password, reset password, or stolen session can bypass the browser gate by calling APIs directly from same-origin tooling or any request path that satisfies the admin API request guard.

#### Severity

medium: Medium because exploitation requires a valid account credential or session and the app is intended for private administration, but it breaks a high-value account recovery boundary. Severity would rise if the admin app is exposed beyond a trusted operator network or if temporary passwords are distributed through weak channels.

#### Remediation

Make requireApiAuth reject mustChangePassword sessions for all APIs except /api/auth/change-password and sign-out/session refresh endpoints. Refresh JWT/session state after password change, add regression tests for every privileged router, and consider invalidating old sessions on reset.

### [3] Public bot bearer tokens accept trivially weak or placeholder values

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | high |
| Confidence rationale | A validation test loaded the public-search bot config with one-character and placeholder tokens and confirmed both cases were accepted. The current local .env uses long random-looking tokens, so this is a deployment guardrail weakness rather than proof that the live deployment is weak. |
| Category | Weak secret validation / insecure deployment default |
| CWE | CWE-521: Weak Password Requirements |
| Affected lines | apps/public-search-bot/src/config.ts:3-5; apps/public-search-bot/src/config.ts:31-49; apps/public-search-bot/src/config.ts:50-58 |

#### Summary

The public VPS bot protects sync, status, and subscription admin APIs with bearer tokens, but requiredSecret only enforces a trimmed length of at least one character. Placeholder-looking or one-character tokens pass startup validation as long as the three values differ.

#### Validation

A validation test loaded the public-search bot config with one-character and placeholder tokens and confirmed both cases were accepted. The current local .env uses long random-looking tokens, so this is a deployment guardrail weakness rather than proof that the live deployment is weak.

Validation artifacts and receipts are saved under `artifacts/05_findings/CAND-PSB-001`.

#### Dataflow

VPS environment variable -> requiredSecret min(1) -> config.publicSearchSyncToken/statusToken/subscriptionAdminToken -> bearer comparison in public HTTP routes.

#### Reachability

If an operator follows the example but leaves short or placeholder tokens in production, internet clients reaching the VPS endpoints can brute force or guess tokens that authorize catalog sync, status reads, or subscription actions.

#### Severity

medium: Medium because the affected APIs are intended to be public-network reachable behind Nginx and tokens are the main application-level control. Severity would drop if deployment automation always injects strong random secrets; it would rise if weak values are already deployed.

#### Remediation

Require at least 32 bytes of entropy or a 43+ character URL-safe/base64 secret, reject common placeholder words, and fail startup when tokens match example values. Update .env.example and README generation commands to use openssl rand or equivalent.

### [4] Authenticated non-admin users can list and retry failed Telegram jobs

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | high |
| Confidence rationale | A validation test signed in a non-admin superadmin-role user, inserted a failed Telegram job, and received 200 responses for both GET /api/telegram/jobs/failed and POST /api/telegram/jobs/:id/retry. |
| Category | Missing authorization for privileged job operations |
| CWE | CWE-862: Missing Authorization |
| Affected lines | src/server/telegram/telegram.admin.routes.ts:19-30; src/server/app.ts:64-69; src/server/telegram/telegram.queue.ts:355-377; src/server/telegram/telegram.queue.ts:527-538; src/server/telegram/telegram.client.ts:89 |

#### Summary

Telegram job routes are mounted after global authentication but do not check the caller role. The UI exposes Telegram Jobs to every authenticated role, while user-management routes have an admin check. A non-admin authenticated user can view failed job error details and move failed jobs back into the outbound queue.

#### Validation

A validation test signed in a non-admin superadmin-role user, inserted a failed Telegram job, and received 200 responses for both GET /api/telegram/jobs/failed and POST /api/telegram/jobs/:id/retry.

Validation artifacts and receipts are saved under `artifacts/05_findings/TEL-JOB-AUTHZ-001`.

#### Dataflow

Authenticated non-admin session -> /api/telegram/jobs/:id/retry -> retryFailedTelegramJob status update -> processNextTelegramJob -> Telegram Bot API send/edit/delete action.

#### Reachability

Any authenticated non-admin operator can trigger the route from the same-origin app or API client. The action is limited to retrying existing failed jobs, but those jobs represent privileged Telegram message operations.

#### Severity

medium: Medium because it crosses a role boundary and can trigger external Telegram side effects, though it cannot create arbitrary new jobs by itself. Severity would rise if failed job payloads include sensitive content or if lower-privileged roles are given broadly to untrusted users.

#### Remediation

Add a role middleware for Telegram job listing/retry, likely the same admin role required for user management or a dedicated job-admin permission. Hide the sidebar item for unauthorized roles and add tests that non-admin users receive 403.

### [5] Credentials login has no failed-attempt throttling

| Field | Value |
|---|---|
| Severity | low |
| Confidence | high |
| Confidence rationale | A validation test sent fifteen wrong-password credentials callbacks for the same account and observed authentication failures without a 429 or lockout signal. |
| Category | Missing rate limiting on authentication endpoint |
| CWE | CWE-307: Improper Restriction of Excessive Authentication Attempts |
| Affected lines | src/server/auth/session.ts:58-64; src/server/auth/passwords.ts:36 |

#### Summary

The Auth.js credentials provider checks email and password and returns null for failures, but there is no per-IP, per-account, or global failed-login limiter around the credential callback.

#### Validation

A validation test sent fifteen wrong-password credentials callbacks for the same account and observed authentication failures without a 429 or lockout signal.

Validation artifacts and receipts are saved under `artifacts/05_findings/AUTH-LOGIN-RATE-001`.

#### Dataflow

Attacker-supplied email/password -> /auth/callback/credentials -> authorize -> findAuthUserByEmail and verifyPassword -> null response without throttle state.

#### Reachability

Anyone who can reach the admin login endpoint can try repeated passwords. The admin request guard protects /api, not /auth, and no login-specific limiter was found in the credentials callback path.

#### Severity

low: Low in the intended private-loopback deployment because network exposure should be limited, but it becomes medium if the admin login is reachable from the internet or a shared network. Severity would drop if upstream VPN or reverse-proxy throttling is guaranteed and tested.

#### Remediation

Add failed-login throttling keyed by IP and normalized email, return consistent errors, log lockouts, and add tests for repeated bad credentials and successful login after the window resets.

### [6] Status and subscription bearer endpoints do not throttle failed authentication

| Field | Value |
|---|---|
| Severity | low |
| Confidence | high |
| Confidence rationale | A validation test sent twenty invalid bearer requests to status and subscription endpoints and observed only 401 responses. The same source review found sync has a dedicated bad-auth limiter, demonstrating the intended control pattern exists for one sibling route but not the others. |
| Category | Missing rate limiting on token-protected public endpoints |
| CWE | CWE-307: Improper Restriction of Excessive Authentication Attempts |
| Affected lines | apps/public-search-bot/src/status.routes.ts:20-23; apps/public-search-bot/src/subscriptions/routes.ts:15-18; apps/public-search-bot/src/sync.routes.ts:22-38 |

#### Summary

The sync endpoint has a bad-auth limiter, but the status and subscription admin routes compare bearer tokens directly and return 401 for every bad attempt without throttling. This leaves the read-only status token and subscription admin token easier to brute force if deployed weakly.

#### Validation

A validation test sent twenty invalid bearer requests to status and subscription endpoints and observed only 401 responses. The same source review found sync has a dedicated bad-auth limiter, demonstrating the intended control pattern exists for one sibling route but not the others.

Validation artifacts and receipts are saved under `artifacts/05_findings/CAND-PSB-002`.

#### Dataflow

Internet request with Authorization header -> /api/status or /api/subscriptions/* -> direct token comparison -> unlimited 401 responses until the correct token is guessed.

#### Reachability

The routes are intended for VPS access from local status checks or Google Apps Script. Attackers need network access to the VPS endpoint and benefit most if token policy also allows weak secrets.

#### Severity

low: Low on its own because strong random tokens make guessing impractical, but the missing limiter compounds the weak-token startup policy. Severity would rise if endpoint logs show internet scanning or if deployed tokens are short.

#### Remediation

Apply the same bad-auth fixed-window limiter used by /sync to status and subscription routes, ideally with separate buckets for token class and client IP. Add tests that repeated invalid status/subscription bearer attempts return 429.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
|---|---|---|---|
| Auth login, sessions, temporary-password flow | Credential theft, reset bypass, forced password-change bypass, browser credential exposure | Reported | AUTH-MUSTCHANGE-001 and AUTH-LOGIN-RATE-001 survived validation. Browser searches did not find secret values or credential persistence in client storage. |
| Admin request guard and user-management API | Cross-site API calls, stale/deleted user sessions, role checks | No issue found | Global /api guard checks custom header/origin/host; user-management router has an admin role check. |
| Public-search bot bearer-token configuration | Weak deployment secrets for sync/status/subscription APIs | Reported | CAND-PSB-001 survived validation; current local .env values appear long, but code permits weak or placeholder production values. |
| Public-search bot status and subscription routes | Token brute force and failed-auth throttling | Reported | CAND-PSB-002 survived validation; sync route has a bad-auth limiter but sibling status/subscription routes do not. |
| Private Telegram failed-job operations | Role bypass and external Telegram side effects | Reported | TEL-JOB-AUTHZ-001 survived validation; non-admin authenticated role can list and retry failed jobs. |
| Public Telegram bot season callbacks | Trial quota bypass and callback tampering | Rejected | CAND-PUBBOT-001 was ruled out as intended non-consuming callback behavior with tests denying exhausted/blocked users. |
| Deployment files and local secrets | Credential exposure in deployable source tree | Reported | DEPLOY-SECRETS-001 survived validation. .env files and the Google key are ignored and not tracked; the key still exists in the deployable app tree. |
| Media/TMDB/database repositories | SQL injection, SSRF, public URL validation, unsafe DB updates | No issue found | Reviewed queries use prepared statements and TMDB/public URL sources are configuration-driven. |
| Local public search sync/status UI | Token leakage to browser, unsafe status rendering, data exposure | No issue found | No secret tokens are returned to the browser; status output is whitelisted operational state. |

## Open Questions And Follow Up

- Run a live VPS configuration review focused on Nginx routing, systemd hardening, firewall rules, and whether repository files are ever served as static content.
- After fixes, rerun the validation artifacts in `artifacts/05_findings/*/validation_artifacts` to confirm the expected status codes change from vulnerable behavior to denied or throttled behavior.
- Review account lifecycle policy for temporary passwords: how they are distributed, when they expire, and whether password reset should invalidate all existing sessions.

## Secure VPS Deployment Guide

1. Rotate before deploy: revoke the current Google service account key, create a fresh least-privilege key for only the required spreadsheet, and generate fresh 32+ byte values for `PUBLIC_SEARCH_SYNC_TOKEN`, `PUBLIC_SEARCH_STATUS_TOKEN`, `SUBSCRIPTION_ADMIN_TOKEN`, `PUBLIC_BOT_TOKEN`, and `SUBSCRIPTION_BOT_TOKEN`.
2. Create a non-root Linux user such as `infinitylinks`; keep the app under `/opt/infinitylinks/public-search-bot` and runtime data under `/var/lib/infinitylinks` with owner `infinitylinks:infinitylinks`.
3. Keep secrets outside the repo: place the env file at `/etc/infinitylinks/public-search-bot.env` with mode `600`, and place the Google key at `/etc/infinitylinks/google-service-account.json` or inject it through a systemd credential. Do not copy `apps/public-search-bot/google-service-account.json` to the deploy tree.
4. Build locally or in CI with `npm ci`, `npm run build`, and `npm run build -w apps/public-search-bot`; deploy only the compiled app/package files needed to run, not `.env`, git metadata, tests, scan artifacts, or local database files.
5. In systemd, set `User=infinitylinks`, `EnvironmentFile=/etc/infinitylinks/public-search-bot.env`, `WorkingDirectory=/opt/infinitylinks/public-search-bot`, `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `ProtectHome=true`, and `ReadWritePaths=/var/lib/infinitylinks`.
6. Bind the Node service to `127.0.0.1:3001`; expose it only through Nginx with TLS, request body limits, and rate limits on `/api/status`, `/api/sync`, and `/api/subscriptions`.
7. Lock Nginx down to proxy only expected routes. Do not serve the repository directory as static content; deny dotfiles, source maps if not needed, env files, JSON credential files, and backups.
8. Configure firewall rules: allow SSH only from your IP if possible, allow HTTP/HTTPS, deny direct access to port 3001, and enable automatic security updates plus fail2ban or equivalent SSH protection.
9. Verify after deployment with redacted checks: `systemctl status`, localhost `/api/status` with the status token, a wrong-token request that should be rejected and eventually rate-limited, and `find /opt/infinitylinks -name .env -o -name '*service-account*.json'` to confirm secrets are not in the deploy tree.
10. Add operations hygiene: back up only the SQLite data directory with encrypted backups, rotate tokens after admin turnover, log failed bearer attempts without logging token values, and keep a rollback package that does not contain secrets.

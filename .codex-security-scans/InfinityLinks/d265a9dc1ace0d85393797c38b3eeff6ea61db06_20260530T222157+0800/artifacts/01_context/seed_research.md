# Seed Research

## User-Seeded Focus

The user explicitly requested extra coverage for login/authentication because it is prone to attacks, vulnerable to browser credential exposure, and relevant to secure VPS deployment.

No CVE, GHSA, advisory id, release note, or package-version vulnerability was provided. Network advisory research was not required for a named advisory. Local repository seed research was performed against authentication, session, browser credential handling, secret storage, bearer-token APIs, and deployment guidance.

## Local Search Terms And Files Opened

Search terms included:

- `login`, `csrf`, `cookie`, `session`, `AUTH_SECRET`, `password`, `temporaryPassword`
- `localStorage`, `sessionStorage`, `credentials`, `Bearer`, `Authorization`
- `PUBLIC_SEARCH`, `SUBSCRIPTION_ADMIN_TOKEN`, `GOOGLE_SERVICE_ACCOUNT`, `token`
- `exec`, `spawn`, `eval`, `innerHTML`, `fetch`, `sendFile`, `static`, `readFile`, `writeFile`, `path.join`, `prepare`

Seed files opened or assigned for full review:

- `src/server/auth/session.ts`
- `src/server/auth/auth.routes.ts`
- `src/server/auth/passwords.ts`
- `src/server/auth/users.repository.ts`
- `src/client/auth/auth-api.ts`
- `src/server/app.ts`
- `src/server/security/api-request-guard.ts`
- `src/server/admin/users.routes.ts`
- `src/client/pages/UsersPage.tsx`
- `src/client/auth/AuthGate.tsx`
- `apps/public-search-bot/src/app.ts`
- `apps/public-search-bot/src/sync.routes.ts`
- `apps/public-search-bot/src/status.routes.ts`
- `apps/public-search-bot/src/subscriptions/routes.ts`
- `apps/public-search-bot/src/config.ts`
- `apps/public-search-bot/src/bot/handlers.ts`
- `apps/public-search-bot/src/bot/callback-data.ts`
- `apps/public-search-bot/src/subscriptions/access.service.ts`
- `apps/public-search-bot/src/subscriptions/bot.handlers.ts`
- `apps/public-search-bot/src/subscriptions/job.processor.ts`
- `README.md`
- `apps/public-search-bot/README.md`
- `apps/public-search-bot/deploy/public-search-bot.service.example`
- `apps/public-search-bot/deploy/nginx.conf.example`
- `apps/public-search-bot/google-service-account.json`

## Seed Rows

| Seed id | Exact focus | Initial status |
| --- | --- | --- |
| seed-auth-login-browser-credentials | Login, session cookies, CSRF, temporary passwords, browser-side credential exposure | Open for discovery and validation |
| seed-auth-admin-authorization | API route ordering, admin authorization, stale role/user state | Open for discovery and validation |
| seed-public-bearer-tokens | VPS sync/status/subscription bearer-token APIs, rate limits, token separation, status leakage | Open for discovery and validation |
| seed-public-telegram-access | Public Telegram search access, callback tampering, provider link leakage to unpaid users | Open for discovery and validation |
| seed-deployment-secret-material | Real secrets in app tree, `.env`, Google service account JSON, deployment copying/permissions | Open for discovery and validation |

## Early Observations

- The local workspace contains `apps/public-search-bot/google-service-account.json`. Redacted inspection confirmed it is a Google `service_account` JSON with `private_key`, `private_key_id`, and `client_email` fields present. `git ls-files` did not show it as tracked, and root `.gitignore` contains `apps/public-search-bot/google-service-account.json`, but its presence inside the deployable app tree is a deployment secret-handling hazard.
- Root `.env` and app SQLite databases are ignored by `.gitignore`; values were not printed into scan artifacts.

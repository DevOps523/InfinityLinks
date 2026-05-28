# Security Findings Remediation Design

## Context

The repository-wide Codex Security scan found three low-severity issues worth fixing:

- The local admin API request guard allows mutating API requests with no `Origin`, no `Sec-Fetch-Site`, and no `X-InfinityLinks-Request` header to proceed.
- The standalone public-search bot rejects reuse of the sync token with the status token and admin token, but does not reject reuse of the status token as the subscription admin token.
- The public-search bot deployment guide and systemd example use the shared `www-data` identity for the application service and secret group access.

The remediation should stay targeted. The existing loopback host restrictions, HTTPS-only token endpoints, bearer-token route protection, URL scheme validation, SQL parameterization, and Telegram plaintext formatting controls remain in place.

## Goals

- Close the reproduced bodyless admin POST bypass without breaking normal same-origin UI API calls.
- Enforce separation for all public-search bot bearer-token roles.
- Move deployment guidance toward a dedicated service identity so unrelated `www-data` workloads cannot read app secrets.
- Add focused regression coverage for the two code-level findings.
- Keep the fix small and consistent with existing TypeScript, Zod, Express, and Vitest patterns.

## Non-Goals

- Redesign authentication for the local-only admin app.
- Add sessions, login, cookies, CSRF tokens, CORS, or a new auth middleware stack.
- Rotate live secrets from code.
- Change public bot API contracts or Telegram bot behavior.
- Perform broad systemd sandbox hardening beyond the service identity and ownership model.

## Proposed Approach

Use a targeted security patch.

Alternative approaches considered:

- Broader hardening pass: add the targeted fixes plus extra systemd controls and operational smoke scripts. This improves posture, but increases scope and is not needed to close the current findings.
- Docs-only triage: document manual rotation and deployment guidance. This is fast, but leaves the admin guard and token-separation issues unfixed.

The targeted patch best fits the findings because each issue has a narrow root control and straightforward regression test.

## Architecture

### Admin API Guard

`src/server/security/api-request-guard.ts` remains the single guard for `/api` routes. Its responsibilities stay the same:

- reject non-loopback `Host` values when an allowed-host set is configured;
- reject cross-site browser requests;
- require the admin request header on mutating browser-style API calls.

The behavior changes so all mutating methods require `X-InfinityLinks-Request: fetch`, regardless of whether `Origin` or `Sec-Fetch-Site` is present. Read-only methods may continue without the custom header. This preserves the existing UI flow because `src/client/api/http.ts` already sets the header for every API request.

### Public Bot Config

`apps/public-search-bot/src/config.ts` remains the config validation boundary. Add a third refinement:

- `SUBSCRIPTION_ADMIN_TOKEN` must differ from `PUBLIC_SEARCH_STATUS_TOKEN`.

The error should point at `SUBSCRIPTION_ADMIN_TOKEN`, because that is the higher-privilege token the operator should rotate or regenerate when a conflict exists.

### Deployment Identity

The public-search bot should run as a dedicated `infinitylinks` user and group in the systemd example. Deployment docs should instruct operators to:

- create the dedicated system user/group;
- make the SQLite data directory writable by `infinitylinks:infinitylinks`;
- make `.env` and `google-service-account.json` owned by `root:infinitylinks` with mode `640`;
- configure systemd with `User=infinitylinks` and `Group=infinitylinks`.

Nginx remains the public entry point and does not need access to application secrets.

## Data Flow And Trust Boundaries

### Admin App

Same-origin React UI calls go through `apiJson`, which sets `X-InfinityLinks-Request: fetch`. The Express guard now rejects every mutating request missing that header before route handlers can sync public search state, retry Telegram jobs, or mutate media data. This closes the no-provenance path while retaining loopback-only host enforcement.

### Public Bot

The standalone bot keeps three bearer-token roles:

- sync token: catalog writes to `/api/sync`;
- status token: read-only status checks at `/api/status`;
- subscription admin token: Google Apps Script and admin operations under `/api/subscriptions/*`.

Startup validation fails if any higher-privilege role is configured with the lower-trust status token.

### Deployment

The application process reads `.env`, the Google service account JSON, and writes SQLite data. Nginx proxies requests but does not read those files. A dedicated service group keeps app secrets out of the shared `www-data` boundary.

## Error Handling

- Admin guard failures continue returning `403` with `{ "error": "Cross-site request blocked" }` to match existing behavior.
- Public bot config failures should use the existing Zod error path and a clear message: `SUBSCRIPTION_ADMIN_TOKEN must be different from PUBLIC_SEARCH_STATUS_TOKEN`.
- Deployment docs should avoid ambiguous ownership commands and explicitly state that `www-data` should not be used for the app service on shared hosts.

## Test Plan

### Root Admin App

Add a regression test in `tests/server/app.test.ts`:

- send `POST /api/public-search/sync` with `Host: 127.0.0.1:3000`;
- omit `Origin`, `Sec-Fetch-Site`, and `X-InfinityLinks-Request`;
- expect `403`;
- assert the public-search sync fetch mock was not called.

Keep the existing positive-control test that same-origin API-style mutating requests with `X-InfinityLinks-Request: fetch` proceed to the route handler.

### Standalone Public Bot

Add a config test in `apps/public-search-bot/tests/public-search.config.test.ts`:

- set `PUBLIC_SEARCH_STATUS_TOKEN` and `SUBSCRIPTION_ADMIN_TOKEN` to the same value, with trimming coverage;
- expect the new `SUBSCRIPTION_ADMIN_TOKEN` separation error.

### Verification Commands

Run targeted tests first:

```sh
npm.cmd test -- tests/server/app.test.ts
npm.cmd --prefix apps/public-search-bot test -- public-search.config.test.ts
```

Then run the broader suites when targeted tests pass:

```sh
npm.cmd test
npm.cmd --prefix apps/public-search-bot test
```

## Rollout Notes

- Existing valid local UI usage should continue working because the frontend already sets the request header.
- Existing deployments with distinct token values continue starting normally.
- Deployments that reused status and subscription admin tokens will fail startup until tokens are separated.
- Operators following the updated deployment guide should create or migrate to the `infinitylinks` service identity and update file ownership before restarting systemd.

## Acceptance Criteria

- Bodyless mutating admin API requests without `X-InfinityLinks-Request` are rejected even when provenance headers are absent.
- Existing same-origin admin UI requests with the custom header still reach route handlers.
- Public bot config rejects `SUBSCRIPTION_ADMIN_TOKEN` equal to `PUBLIC_SEARCH_STATUS_TOKEN`.
- README and systemd example consistently use a dedicated `infinitylinks` service identity and keep secrets out of `www-data`.
- Targeted and broader tests pass.

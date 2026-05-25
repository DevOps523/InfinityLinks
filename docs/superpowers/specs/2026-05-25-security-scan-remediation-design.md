# Security Scan Remediation Design

## Goal

Fix the four security scan findings without adding a login system or changing the intended deployment model:

- The private admin app stays a low-friction localhost tool.
- The public search bot app remains safe when deployed behind nginx, but its core protections do not depend on nginx being perfect.
- Telegram bot responses remain friendly while avoiding unlimited reply spam.

## Findings Covered

1. Browser-to-localhost CSRF can trigger bodyless privileged admin actions.
2. Cross-origin GETs can force TMDB API calls, cache/log growth, and quota burn.
3. Public bot `/api/sync` parses large JSON bodies before auth/rate limiting.
4. Telegram command spam can bypass reply throttling and stall useful bot work.

## Architecture

Add controls at each runtime boundary.

The local admin server gets an API request guard mounted before API routers. The guard rejects cross-site browser requests using `Origin` and `Sec-Fetch-Site`, and requires state-changing browser API requests to include an intentional custom header. This blocks plain HTML form submissions from malicious sites while preserving same-origin React calls and local non-browser tooling.

TMDB search gets a small in-memory rate limiter and a timeout-capable outbound fetch wrapper. The route remains unauthenticated because the app is localhost-only, but noisy browser-triggered GETs become bounded.

The public search bot sync route performs bearer-token auth before parsing JSON. Invalid-token requests never enter the expensive catalog parser. A bad-auth limiter protects the route from repeated token guessing or body flood attempts.

Telegram bot handlers use a shared reply limiter before any user-triggered reply is enqueued. The first `/start` response remains allowed so onboarding stays friendly; repeated replies from the same user are bounded.

## Components

### Admin API Request Guard

Create a small Express middleware under `src/server` and mount it before `createMediaRouter`, `createTmdbRouter`, and `createPublicSearchRouter`.

Rules:

- Allow requests with no browser provenance headers from local tools such as curl and tests.
- Allow same-origin browser requests.
- Reject browser requests with cross-site `Origin` or `Sec-Fetch-Site: cross-site`.
- For state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`), require a custom header such as `X-InfinityLinks-Request: fetch`.

Update `src/client/api/http.ts` to add the custom header to API requests. It should not add secrets or credentials.

### TMDB Limiter And Timeout

Add a fixed-window limiter around `GET /api/tmdb/search`, keyed by `req.ip`.

Add a timeout wrapper for TMDB fetches. If the upstream request exceeds the timeout, return a safe upstream failure rather than waiting indefinitely. Keep user-facing error text generic.

### Public Sync Auth-Before-Body

Change `apps/public-search-bot/src/app.ts` so `/api/sync` is not behind a global `express.json({ limit: '5mb' })` parser.

The sync route should run in this order:

1. Check bearer token syntax and value.
2. Apply a failed-auth rate limiter per client IP.
3. Parse JSON with a sync-specific body limit.
4. Validate `PublicSearchCatalogSchema`.
5. Replace the catalog and clear sync errors.

The status route should stay token-protected and cheap. It does not need the sync JSON parser.

### Telegram Reply Limiter

Add a helper in `apps/public-search-bot/src/bot/handlers.ts` or a small adjacent module that wraps reply-producing paths.

Coverage:

- `/start`
- `/clear`
- `/search` with no query
- unknown slash commands
- valid search replies
- callback query replies

The first `/start` for a user should be allowed before normal limiting. After that, repeated `/start` uses the same limit as other reply paths.

Avoid enqueueing repeated wait messages when a user is already throttled, because those messages can become the spam being prevented.

### Optional Nginx Hardening Note

Keep nginx as a defense-in-depth deployment layer. Update docs or example config with request body and request rate guidance for `/api/sync`, but do not rely on nginx as the only protection.

## Data Flow

Admin React requests flow through `apiJson`, which attaches the custom request header. The admin API guard accepts those requests and rejects cross-site browser requests before handlers run.

A malicious page can still attempt a form POST to `http://127.0.0.1:3000`, but it cannot attach the custom header without CORS preflight approval. Since the server does not grant CORS, the privileged bodyless POST handlers are not reached.

Public sync requests flow through failed-auth limiting and bearer-token validation before body parsing. Only authenticated clients pay the JSON parsing and Zod validation cost.

Telegram updates flow through polling, handler classification, reply limiting, optional membership/catalog work, and then the reply queue. No low-value repeated command should enqueue unbounded outbound messages.

## Error Handling

Admin guard failures return `403` with a short generic message such as `Cross-site request blocked`. Existing Zod `400`, route `404`, and service errors remain unchanged.

TMDB local rate limits return `429`. TMDB timeout or upstream failures return the existing safe failure path or a `502` with generic text. The current UI can continue showing its generic TMDB failure message.

Public sync bad auth returns `401`; repeated bad auth returns `429`; oversized bodies return `413`; invalid catalogs return `400`; successful sync remains unchanged.

Telegram throttling should send at most one useful wait message per limit window. If sending that wait message would itself exceed the limiter, skip it.

## Testing

### Admin App Tests

- Cross-site form-style `POST /api/public-search/sync` is rejected before sync work runs.
- Cross-site form-style `POST /api/seasons/:id/repost` is rejected.
- Same-origin/API-style POST with `X-InfinityLinks-Request: fetch` still works.
- TMDB search returns `429` after the configured local limit.
- TMDB timeout maps to a safe upstream failure.

### Public Bot App Tests

- Invalid-token `POST /api/sync` with a large JSON body is rejected before catalog validation.
- Repeated invalid-token sync attempts receive `429`.
- Valid sync requests still parse, validate, replace the catalog, and update status.
- `GET /api/status` remains bearer-token protected.

### Telegram Handler Tests

- Repeated `/start`, `/clear`, empty `/search`, unknown slash commands, searches, and callbacks are rate-limited per user.
- The first `/start` response still gets through.
- Throttled commands do not enqueue unlimited wait messages.

## Rollout

Implement in three independent slices:

1. Admin request guard, TMDB limiter, and timeout.
2. Public sync auth-before-body and bad-auth limiter.
3. Telegram reply limiter.

Each slice should include targeted tests and can ship independently. The admin and public bot runtime changes should not alter database schema.

## Non-Goals

- No login, user accounts, or role system for the localhost admin app.
- No secret-bearing custom header in the browser.
- No dependency on nginx as the sole defense.
- No broad redesign of the Telegram polling architecture unless tests show the limiter cannot prevent reply queue stalls.

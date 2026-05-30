# Security Findings Remediation Design

## Context

The latest repository-wide Codex Security scan reported six findings that should be fixed before running the deeper scan and before using the VPS deployment guide for production:

- A real Google service account key exists in the deployable public-search bot tree.
- Forced password-change state is enforced by the React UI, but not by the server-side API auth middleware.
- Public-search bot bearer tokens can be configured as trivial or placeholder values.
- Authenticated non-admin users can list and retry failed Telegram jobs.
- Credentials login lacks failed-attempt throttling.
- Public-search status and subscription endpoints do not throttle failed bearer-token attempts.

The fixes should close these findings directly, keep secrets out of deployable source paths, and produce a concrete step-by-step secure VPS deployment guide in Markdown.

## Goals

- Remove the live Google service account JSON from the deployable app tree and make deployment guidance use secrets outside the repo.
- Enforce `mustChangePassword` on the server for protected APIs, not only in the browser.
- Require strong, non-placeholder public bot tokens at startup.
- Restrict Telegram failed-job list/retry operations to an authorized admin role.
- Add bounded failed-auth throttling for admin credentials login.
- Add bounded failed-auth throttling for public-search status and subscription bearer-token endpoints.
- Add or update focused tests so the validated vulnerable behaviors become denied or throttled behaviors.
- Create `docs/deployment/secure-vps-deployment.md` with exact production deployment steps and safety gates.
- Link the new deployment guide from existing README material so operators can find it.

## Non-Goals

- Rotate live secrets from inside application code. Rotation is an operator action and must be performed in Google Cloud, BotFather, Apps Script, and VPS secret storage.
- Redesign Auth.js session storage or replace it with a new authentication system.
- Add a new database-backed lockout table unless the existing in-memory fixed-window pattern proves insufficient for the current local admin app.
- Change Telegram job queue semantics beyond access control for list/retry.
- Change public Telegram bot search, subscription, or callback behavior that was not part of the surviving findings.
- Claim the VPS is deployed or secure without running the final deployment verification commands on the actual server.

## Proposed Approach

Use one coordinated security remediation pass. The six findings share authentication, authorization, token, and deployment-hardening boundaries, so fixing them together avoids leaving a known weak path open while preparing deployment.

Alternatives considered:

- Risk-first split: fix credential placement, must-change enforcement, token validation, and Telegram job authorization first, then rate limits. This reduces per-change size but leaves known brute-force surfaces open longer.
- Deep scan first: run the deep scan before fixing. This may discover more, but it keeps a real credential-placement issue and validated auth weaknesses around while scanning.

The coordinated pass is the best fit: it closes the current report, gives the deep scan a hardened baseline, and produces the deployment guide the user requested.

## Architecture

### Credential And Deployment Control

The repository should not contain the live Google service account JSON under `apps/public-search-bot/`. The implementation should remove the local key file from the deployable tree, keep ignore rules that prevent accidental commits, and make runtime config point at a secret path outside the repo such as `/etc/infinitylinks/google-service-account.json`.

The code should add a startup guard for `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` so obvious unsafe paths inside the repository or app directory fail fast. This is a guardrail, not a substitute for key rotation.

The new deployment guide should describe key revocation/rotation, expected secret locations, ownership, permissions, and a post-deploy check that verifies no `.env` or service-account JSON exists in the deployed app tree.

### Admin Auth And Forced Password Change

`src/server/auth/session.ts` remains the central API authentication boundary. `requireApiAuth` already refreshes the user from SQLite before setting `res.locals.authUser`; that refresh point should also enforce `mustChangePassword`.

The middleware should reject `mustChangePassword` users from normal protected APIs with `403`. It should allow only the minimal account-recovery endpoints required to inspect the current session and change the password. After password change, the normal existing flow should continue returning an updated user whose `mustChangePassword` value is false.

The browser `AuthGate` can remain a user experience layer, but the server must be the security boundary.

### Telegram Job Authorization

`src/server/telegram/telegram.admin.routes.ts` should require an admin role for:

- `GET /api/telegram/jobs/failed`
- `POST /api/telegram/jobs/:id/retry`

The route-level guard should be server-side and should not rely on the sidebar. The client should still hide Telegram Jobs from roles that cannot use the feature so the UI and API agree.

If a future non-admin operations role is desired, that should be a separate explicit permission model. For this remediation, use the existing `admin` role because user-management already treats it as the privileged local operator role.

### Token Strength And Placeholder Rejection

`apps/public-search-bot/src/config.ts` remains the public bot configuration boundary. It should replace `requiredSecret(...).min(1)` for bearer-token style secrets with a stronger helper that:

- trims input;
- requires a long value suitable for a bearer token;
- rejects common placeholder/example strings from `.env.example` and docs;
- keeps existing separation checks between sync, status, and subscription admin tokens.

The helper should apply to `PUBLIC_BOT_TOKEN`, `PUBLIC_SEARCH_SYNC_TOKEN`, `PUBLIC_SEARCH_STATUS_TOKEN`, `SUBSCRIPTION_BOT_TOKEN`, and `SUBSCRIPTION_ADMIN_TOKEN` where appropriate. Non-token values such as spreadsheet IDs and file paths should keep validation suited to their data type.

### Login Throttling

The credentials provider should apply bounded failed-login throttling before repeated password guesses can continue indefinitely. Use the existing fixed-window style already present in the codebase unless Auth.js integration requires a tiny local helper.

The limiter should key by both client IP and normalized email so one account can be slowed without globally locking every user out. Successful login should be allowed for unrelated buckets. The error response should remain generic and should not reveal whether the email exists.

Because the local admin app is expected to run on loopback or a trusted operator network, an in-memory limiter is acceptable for this pass. The design should not add persistent lockout state unless tests show process-local memory is not viable.

### Public Endpoint Bad-Auth Throttling

The public-search `/sync` route already has a bad-auth limiter. The same pattern should be factored or duplicated cleanly for:

- `GET /api/status`
- routes under `/api/subscriptions/*`

Invalid bearer-token attempts should eventually return `429` with `Retry-After`. Valid tokens should continue to work and should not consume the bad-auth bucket.

## Data Flow And Trust Boundaries

### Admin Password Reset Path

Admin creates or resets a user -> temporary password and `mustChangePassword=true` are stored -> user signs in through Auth.js credentials -> `requireApiAuth` refreshes the database user -> middleware rejects all protected APIs except allowed password-change/session endpoints until password change succeeds.

This converts forced password change from a browser navigation convention into a server-enforced access-control rule.

### Telegram Job Retry Path

Authenticated request -> global `/api` auth middleware -> Telegram job route admin guard -> `retryFailedTelegramJob` updates queue state -> `processNextTelegramJob` later calls Telegram API.

The new role check sits before queue mutation so lower-privileged authenticated users cannot trigger outbound Telegram side effects.

### Public Bearer Token Paths

VPS environment -> Zod config validation -> route bearer-token comparison -> sync/status/subscription action.

Strong startup validation prevents weak deployment secrets from becoming the only application-level control on public endpoints. Bad-auth limiters reduce guessing pressure against status and subscription routes.

### Deployment Secret Path

Operator-generated secret -> stored under `/etc/infinitylinks` with root ownership and service-group read access -> public bot reads the file by absolute path -> deployed app tree contains only code, package files, and runtime data directory references.

Nginx proxies requests but never needs access to `.env`, service account JSON, or SQLite data.

## Error Handling

- Must-change API rejection should return `403` with a clear machine-readable error such as `Password change required.`
- Telegram job authorization failures should return `403` with the existing permission style.
- Token config validation should fail startup with specific environment variable names and clear messages.
- Public bad-auth throttling should return `401` until the limiter trips, then `429` plus `Retry-After`.
- Login throttling should keep responses generic and avoid revealing account existence.
- Deployment guide commands should fail closed: if permissions or path checks do not match the expected state, operators should stop before starting the service.

## Testing Plan

### Root Admin App

- Add/update tests showing `mustChangePassword` admin users cannot call privileged APIs.
- Add/update tests showing those users can still call the minimal auth endpoints needed to change their password.
- Add/update tests showing normal admin users still reach protected APIs.
- Add login throttling tests that repeated bad credentials eventually throttle.
- Add login throttling tests that unrelated email/IP buckets are not incorrectly locked out.
- Add Telegram job tests that non-admin authenticated users receive `403`.
- Add Telegram job tests that admin users can still list/retry failed jobs.

### Public Search Bot

- Add config tests that one-character tokens fail.
- Add config tests that placeholder/example tokens fail.
- Keep or add tests that long distinct tokens pass.
- Keep separation tests so sync, status, and subscription admin tokens cannot be reused.
- Add status-route bad-auth tests that repeated invalid tokens eventually return `429`.
- Add subscription-route bad-auth tests that repeated invalid tokens eventually return `429`.
- Keep positive tests that valid status/subscription tokens still work.

### Deployment Documentation

- Add `docs/deployment/secure-vps-deployment.md`.
- Add a discoverability link from the public-search bot README or root README.
- Add a checklist section that blocks deployment if service-account JSON or `.env` files are in the deploy tree.
- Search docs for stale guidance that tells operators to copy local secrets into the app directory.

## Secure VPS Deployment Guide Deliverable

Create `docs/deployment/secure-vps-deployment.md` as a step-by-step guide with these sections:

1. Pre-deploy local safety checks.
2. Rotate and generate required secrets.
3. Create VPS user, directories, and permissions.
4. Place secrets under `/etc/infinitylinks`.
5. Build and upload only safe deployable files.
6. Install dependencies and run migrations.
7. Configure systemd with hardening directives.
8. Configure Nginx/TLS and route-level rate limits.
9. Configure firewall and SSH hardening.
10. Run post-deploy verification commands.
11. Backup, rollback, and token-rotation procedures.
12. Do-not-deploy gates for secrets in the repo or public app tree.

The guide should use concrete paths:

- `/opt/infinitylinks/public-search-bot`
- `/etc/infinitylinks/public-search-bot.env`
- `/etc/infinitylinks/google-service-account.json`
- `/var/lib/infinitylinks`

The guide should include copyable commands while avoiding any real secret values.

## Rollout Plan

1. Rotate the Google service account key and public bot/admin tokens outside the repository.
2. Apply code and test fixes.
3. Run targeted tests for each finding.
4. Run root and public-search bot test suites.
5. Run the updated security validation tests against the fixed behavior.
6. Run `codex-security:deep-security-scan` against the hardened code.
7. Deploy to the VPS using `docs/deployment/secure-vps-deployment.md`.
8. Run the guide's post-deploy verification commands before treating the service as production-ready.

## Acceptance Criteria

- The live Google service account JSON is no longer present under `apps/public-search-bot/`.
- Config or startup checks reject service account key paths inside the app/repo tree.
- `mustChangePassword` users are blocked server-side from privileged APIs until they change password.
- Telegram failed-job list/retry routes reject authenticated non-admin users.
- Public bot bearer-token config rejects short and placeholder tokens.
- Credentials login throttles repeated failed attempts.
- Status and subscription bearer-token routes throttle repeated failed attempts.
- Existing legitimate admin and public bot workflows continue passing tests.
- `docs/deployment/secure-vps-deployment.md` exists and contains exact step-by-step VPS deployment instructions.
- The final implementation plan can be executed without exposing or printing secret values.

# Public Search Trial Search Quota Design

## Goal

Replace the public search bot's one-day trial with a five-successful-search trial quota.

The user can receive normal public search results for five successful `/search <query>` requests. Starting with the sixth successful search attempt, the bot blocks results and sends the subscription-required message. TV season button clicks do not consume additional quota.

## Current Behavior

`apps/public-search-bot` currently gates public search access through `evaluateSearchAccess()` in `src/subscriptions/access.service.ts`.

For an unknown user, the first valid `/search <query>`:

- creates or refreshes a `subscription_users` row,
- starts a `Trial` status,
- stores `trial_started_at`,
- stores `trial_expires_at` using `SUBSCRIPTION_TRIAL_HOURS`,
- allows searches and season callbacks until the trial expiry time.

The handler also checks access before TV season callbacks, so expired trial users cannot retrieve episode provider links.

## Desired Behavior

The free trial is count-based instead of time-based:

- `/start` remains public and does not create or consume a trial.
- `/search` with no query remains validation-only and does not consume quota.
- A search consumes one trial search only when it returns at least one movie or TV show result.
- Search attempts with no results do not consume quota.
- Search attempts while the public catalog is unavailable do not consume quota.
- Group-chat searches that would expose provider links are redirected to private chat before access is evaluated and do not consume quota.
- Trial searches #1 through #5 return normal results.
- Trial search #6 and later return only the subscription-required message.
- TV season callbacks do not increment the trial counter.
- Paid subscribers remain unlimited.
- `Kicked` users and users with `removed_from_group = 1` remain blocked.

The deployment can start from a fresh SQLite database, so no old trial users need special migration handling. The schema should still migrate safely for local development databases.

## Data Model

Add a persistent counter to `subscription_users`:

```sql
trial_searches_used INTEGER NOT NULL DEFAULT 0
```

Keep the existing `Trial` status. Keep `trial_started_at` as the timestamp when the quota trial began. `trial_expires_at` may remain in the table for backward compatibility, but new quota trials should leave it null and access decisions will no longer depend on it.

No Google Sheets header change is required. The sheet can continue showing status `Trial` for trial users. The search count is operational state held in SQLite.

## Configuration

Replace the time-based trial config with a count-based limit:

```env
SUBSCRIPTION_TRIAL_SEARCH_LIMIT=5
```

Default: `5`.

Remove production use of `SUBSCRIPTION_TRIAL_HOURS`. Documentation and examples should describe only the new quota setting. If an old deployment `.env` still contains `SUBSCRIPTION_TRIAL_HOURS`, the config loader should ignore it as an unused environment variable.

## Access Flow

### `/search <query>`

The handler should keep the current defensive order:

1. Validate the catalog exists.
2. Search the catalog.
3. If results include provider links and the chat is not private, send the private-chat-required message.
4. Consume successful-search access for the user and configured search limit.
5. If access is denied, send the subscription-required message and do not format results.
6. If access is allowed and the user is a trial user, the trial search counter has been incremented exactly once for this successful search.
7. Schedule the sheet refresh after allowed access, as the handler does today.
8. Send formatted results.

This order prevents link leakage and avoids consuming quota for no-result, unavailable, invalid, or group-chat redirect paths.

### TV Season Callbacks

Season callbacks should still evaluate access before loading and sending provider links, but they must not increment trial usage.

This means a user who uses search #5 on a TV show can still open the season buttons from that result.

## Repository/API Changes

Update `src/subscriptions/repository.ts` with count-aware helpers:

- map `trial_searches_used` into `SubscriptionUser`,
- create trial rows with `trial_searches_used = 0`,
- expose an operation to consume one trial search atomically when the current count is below the configured limit,
- keep paid subscription helpers unchanged.

`evaluateSearchAccess()` should stop comparing `now` to `trial_expires_at`. It should remain useful for non-consuming access checks such as TV season callbacks.

Add a separate successful-search access operation for `/search` that starts the trial when eligible, checks the counter, and increments the counter atomically before results are formatted. This operation should run only after results are known. It should not be used by callbacks.

## User-Facing Text

Update `/start` copy from:

```text
You have 1 day free trial access when you search.
After the trial, subscription is required to view download links.
```

to:

```text
You get 5 free movie or TV searches.
After that, subscription is required to keep going.
```

Keep the subscription-required message short and link-free except for the admin contact:

```text
You need a subscription to view and access download links. Contact @seinen_illuminatiks to keep going.
```

## Files Expected To Change

Public search bot runtime:

- `apps/public-search-bot/src/db/schema.sql`
- `apps/public-search-bot/src/db/migrate.ts`
- `apps/public-search-bot/src/config.ts`
- `apps/public-search-bot/src/index.ts`
- `apps/public-search-bot/src/bot/handlers.ts`
- `apps/public-search-bot/src/bot/formatter.ts`
- `apps/public-search-bot/src/subscriptions/access.service.ts`
- `apps/public-search-bot/src/subscriptions/repository.ts`

Public search bot tests:

- `apps/public-search-bot/tests/public-search.config.test.ts`
- `apps/public-search-bot/tests/public-search.db.test.ts`
- `apps/public-search-bot/tests/public-search.formatter.test.ts`
- `apps/public-search-bot/tests/public-search.handlers.test.ts`
- `apps/public-search-bot/tests/public-search.subscription-access.test.ts`
- `apps/public-search-bot/tests/public-search.subscription-access-username.test.ts`
- `apps/public-search-bot/tests/public-search.subscription-repository.test.ts`

Docs and examples:

- `apps/public-search-bot/.env.example`
- `apps/public-search-bot/README.md`

## Test Plan

Add or update tests to cover:

- default config uses `subscriptionTrialSearchLimit = 5`,
- explicit `SUBSCRIPTION_TRIAL_SEARCH_LIMIT` is accepted,
- invalid non-positive limits are rejected,
- first successful search starts a trial and stores `trial_searches_used = 1`,
- searches #1 through #5 return results,
- search #6 returns the subscription-required message and does not leak provider links,
- no-result searches do not increment `trial_searches_used`,
- group-chat redirects do not create or consume a trial,
- season callbacks do not increment `trial_searches_used`,
- active paid users remain unlimited,
- kicked or removed users remain blocked,
- username refresh behavior still updates `last_seen_at` and username fields,
- schema migration adds `trial_searches_used` to an existing `subscription_users` table.

Run:

```powershell
npm.cmd --prefix apps/public-search-bot test
npm.cmd --prefix apps/public-search-bot run build
```

## Acceptance Criteria

- The public bot no longer grants access based on a 24-hour window.
- A new trial user receives results for exactly five successful searches.
- The sixth successful search attempt returns the subscription-required message.
- No-result searches are free.
- TV season callbacks are free but still gated by subscription/trial access.
- Paid subscribers are not limited by the trial quota.
- The bot never sends provider links on denied access paths.
- Public search bot docs and environment examples no longer describe a one-day trial as the active behavior.

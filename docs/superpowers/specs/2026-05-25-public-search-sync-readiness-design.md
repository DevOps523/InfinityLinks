# Public Search Sync Readiness Design

Date: 2026-05-25

## Purpose

The Public Search page should show whether the public search catalog has unsynced local changes before the admin clicks `Sync Public Search`. Repeated clicks should be prevented by making sync change-driven instead of session-driven.

The current VPS public search endpoint already rate-limits sync requests. This design adds local validation in the private admin app so the admin can see when sync is needed and the button is disabled when there is nothing new to send.

## Scope

This change is local admin app only.

In scope:

- Local admin database migration for public search sync state.
- Local public search catalog fingerprinting.
- Local API for sync readiness/status.
- Local sync endpoint update so successful sync stores the current fingerprint.
- Public Search page UI updates.
- Tests for readiness, successful sync state, failed sync state, and button behavior.

Out of scope:

- Changes under `apps/public-search-bot/`.
- Changes to the standalone public bot sync contract.
- Changes to Telegram posting, season repost queueing, or public bot search replies.

If implementation reveals an unavoidable shared-contract issue, it must be called out before changing the standalone public bot folder.

## User Experience

The Public Search page replaces `No sync has run in this session.` with readiness text based on the current exportable catalog:

- `1 movie ready to sync`
- `2 TV shows ready to sync`
- `1 movie and 2 TV shows ready to sync`
- `Everything is synced`
- `No public-searchable content yet`
- `Checking sync readiness...`

The `Sync Public Search` button is disabled while readiness is loading, while a sync request is running, and whenever there are no pending changes.

After a successful sync, the page shows the normal success toast, refreshes the readiness state, and disables the button until the exportable catalog changes again.

If sync fails, the last successful fingerprint is not updated. Pending changes remain visible and the button stays available after the request finishes.

## Catalog Fingerprint

The local server builds the public search catalog using the same rules used by the actual sync payload. It then creates a stable fingerprint from the catalog.

The fingerprint must be based on public-search-relevant data, including:

- Movie and TV show ids, titles, years, and post URLs.
- Season ids, season numbers, post URLs, and episode numbers.
- Active provider names, quality values, sort order, and URLs.
- Channel and group handles if they are part of the exported catalog.

The generated timestamp must not affect the fingerprint. Otherwise every status check would look like a new change.

The implementation should use stable JSON serialization by building a normalized object with deterministic ordering and hashing that normalized value.

## Storage

Add a local admin database table named `public_search_sync_state` with one row:

- `id INTEGER PRIMARY KEY CHECK (id = 1)`
- `last_successful_sync_at TEXT`
- `last_catalog_hash TEXT`
- `last_movie_count INTEGER NOT NULL DEFAULT 0`
- `last_tv_show_count INTEGER NOT NULL DEFAULT 0`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

The migration must be additive and safe for existing local databases.

## Local API

Add a local endpoint:

`GET /api/public-search/sync-status`

It returns:

- `configured`: whether sync URL and token are configured.
- `hasPublicSearchableContent`: whether the current export has any movies or TV shows.
- `hasPendingChanges`: whether the current catalog hash differs from the last successful sync hash.
- `current`: current catalog hash, movie count, and TV show count.
- `lastSuccessfulSync`: timestamp, movie count, and TV show count when available.

Update:

`POST /api/public-search/sync`

After the remote VPS endpoint accepts the sync, store the current catalog hash/counts and return the updated readiness status along with the existing sync result.

If the remote endpoint fails or is unreachable, do not update local sync state.

## Counting Rules

Readiness must use the same export rules as actual public search sync:

- Movies count only when they are posted, have a Telegram message id, and have at least one active provider link.
- TV shows count when at least one season is exportable with active episode provider links.
- Seasons in the existing repost window follow the current export behavior, including cases where provider links are present before a replacement Telegram message id exists.
- Deleted or inactive links are excluded.

Because the fingerprint compares the full normalized export, removals and URL/provider edits also become pending changes.

## Error Handling

If sync is not configured, the status endpoint still returns counts and pending state, but `configured` is false. The UI should keep the sync button disabled and show the existing configuration error when the admin attempts sync behavior.

If readiness loading fails, the UI should show a compact error panel and keep the sync button disabled. The admin can refresh or retry by revisiting the page.

If sync fails, show the existing sync error message and keep the pending readiness state.

## Testing

Server tests:

- Status returns pending changes before first successful sync when exportable content exists.
- Status returns no pending changes after successful sync stores the matching hash.
- Failed sync does not store the hash.
- Provider URL/link changes make the catalog pending again.
- Empty export returns no public-searchable content.
- Generated timestamps do not change the fingerprint.

Client tests:

- Public Search page loads readiness status.
- Button is disabled while loading and when everything is synced.
- Button is enabled when pending changes exist.
- Successful sync refreshes readiness and displays the synced state.
- Failed sync keeps the pending state visible.

## Rollout Notes

Existing users will start with no local public search sync state. If exportable content exists, the page will show it as ready to sync once. After the next successful sync, the state becomes `Everything is synced` until the catalog changes.

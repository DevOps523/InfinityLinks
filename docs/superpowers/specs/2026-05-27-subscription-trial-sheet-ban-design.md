# Subscription Trial Sheet Sync and Ban Design

## Purpose

Keep the subscription workflow automatic without making the public search bot noisy or easy to bypass.

When a new non-subscriber starts a trial through `/search`, the bot should update its local access state immediately, then push the user to Google Sheets automatically after a short delay. When a user becomes overdue, the bot should ban them from the private group and keep them banned until payment is recorded.

## Current Behavior

The public search bot already starts a one-day trial in SQLite when an unknown user searches. Google Sheets is updated by the daily refresh job or by the manual `Update Subscription` Apps Script button.

The overdue removal flow currently calls Telegram `banChatMember`, then immediately calls `unbanChatMember`. That removes the user, but it also allows them to rejoin later if they still have a valid invite link.

The `Update Subscription` button already sends the sheet state to the bot. The bot reads Start Date, recalculates End Date, Days Remaining, and Status, then rewrites the sheet from the database.

## Proposed Behavior

### Trial Users

When `/search <title>` starts a new trial:

- The user is saved immediately in SQLite with `Status = Trial`.
- The user can search right away.
- The bot queues a `refresh-sheet` job for five minutes later.
- If any `refresh-sheet` job is already pending or running, the bot should avoid adding another one. If none exists, it should enqueue one for five minutes after the triggering trial or username update.
- When the job runs, the Google Sheet `Users` tab is rewritten with the latest active subscription rows, including trial users and current usernames.

This keeps Google Sheets automatic while batching writes during bursts of trial traffic.

### Username Tracking

The bot already updates the latest username when a user interacts with `/search` or callback buttons. Those updates should flow to Google Sheets through the same delayed `refresh-sheet` queue. Manual `Update Subscription` remains available if the admin wants an immediate sheet refresh.

### Paid Renewal

The admin only enters `Start Date` in Google Sheets. The sheet may display formulas for End Date, Days Remaining, and Status, but the bot remains the source of truth after `Update Subscription`.

When the admin clicks `Update Subscription`:

- The bot reads the Start Date from Google Sheets.
- The bot recalculates End Date, Days Remaining, and Status.
- The user becomes `Subscribe` when the new start date is active.
- The bot rewrites the sheet with canonical values.

### Banned Overdue Users

When a user is unpaid past the configured grace period:

- The bot calls Telegram `banChatMember`.
- The bot does not immediately unban the user.
- The database marks the user as `Kicked` and `removed_from_group = true`.
- The user is moved from `Users` to `History` as already designed.
- The user cannot use `/search` while marked as removed or kicked.
- The user cannot rejoin the group using an old invite link while still banned.

### Paid After Ban

When a banned user pays:

- The admin updates the user's `Start Date` in Google Sheets.
- The admin clicks `Update Subscription`.
- The bot applies the new Start Date, resets subscription status and remaining days, clears `removed_from_group`, and unbans the user in Telegram.
- The sheet is rewritten with the active user row.
- The admin can then add or invite the user back to the private group.

## Data Flow

1. User sends `/search`.
2. Access service starts a trial if eligible.
3. Search handler queues a delayed sheet refresh only when a new trial starts or username data changes.
4. Subscription job processor runs the batched `refresh-sheet` job.
5. Google Sheets receives the latest active users.

For paid renewals:

1. Admin edits `Start Date` in Google Sheets.
2. Admin clicks `Update Subscription`.
3. Apps Script calls `/api/subscriptions/update`.
4. Bot syncs sheet values, recalculates subscription fields, unbans newly paid kicked users if needed, then rewrites the sheet.

## Error Handling

- Google Sheets failures should remain visible through the existing bot status health check.
- A failed delayed sheet refresh should use the existing subscription job retry behavior.
- Telegram unban failure after payment should fail the update visibly, so the admin knows the user may still be blocked.
- Telegram ban failure should continue to leave the job failed instead of marking the user removed when the group removal did not happen.

## Testing

Add focused tests for:

- New trial queues a delayed `refresh-sheet` job.
- Multiple new trials do not spam duplicate near-term sheet refresh jobs.
- Username update from search/callback schedules a sheet refresh.
- Overdue kick keeps the user banned instead of immediately unbanning.
- `Update Subscription` for a previously kicked user calls Telegram unban after applying a paid Start Date.
- Sheet sync still recalculates End Date, Days Remaining, and Status from Start Date.

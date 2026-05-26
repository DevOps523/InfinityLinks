# Telegram Subscription Access Design

Date: 2026-05-26

## Purpose

Add paid subscription access control to the standalone public search bot while keeping the admin workflow simple.

The group is now private. Users should still be able to interact with the public search bot, but non-subscribed users get only one day of free trial search access. After the trial expires, the bot must block search/download access and direct users to contact the admin for payment.

The system should also track paid users in Google Sheets, update usernames when Telegram usernames change, post subscription reminders to the private group announcement topic, and kick users who stay unpaid past the grace period.

## Approved Approach

Run two Telegram bots inside the existing standalone VPS service under `apps/public-search-bot/`.

- Public Search Bot: handles `/start`, `/search <movie or tv series>`, and TV season callback buttons.
- Subscription Bot: handles subscription tracking, Google Sheets synchronization, alert posting, and overdue group removal.
- Shared SQLite database: source of truth for trials, paid subscriptions, access decisions, and user history.
- Google Sheets: admin dashboard for manual payment/start-date updates.

This keeps deployment to one VPS service and one database while separating user search behavior from subscription/admin behavior.

## Existing Context

The current standalone public search bot already lives in `apps/public-search-bot/` and owns:

- Telegram long polling.
- Public catalog SQLite storage.
- `/start`, `/clear`, and `/search` command handling.
- TV season callback handling.
- Catalog sync API from the private local admin app.
- Message formatting and reply queue behavior.
- Rate limiting and status reporting.

The current search gate checks Telegram group membership before showing results. This design replaces that access gate with trial/subscription status from the shared subscription database.

## Access Flow

`/start` remains public and does not start the free trial.

`/start` returns a welcome/help message that includes the one-day free trial notice. The message should tell users they can search for movies and TV series, and that paid subscription is needed after the free trial expires.

The first valid `/search <title>` from an unknown, unsubscribed Telegram user starts their one-day trial automatically. The bot records:

- permanent Telegram user id
- latest known username
- trial start timestamp
- trial expiry timestamp
- status `Trial`

During the trial window, the user can receive normal search results and download links.

After the trial expires, if the user has no active subscription, `/search <title>` returns only:

```text
You need a subscription to view and access download links. Contact @seinen_illuminatiks to keep you going.
```

The same access check applies to TV season callback buttons. If the user is blocked, callback handling must not expose episode download links.

Subscribed users can search until their subscription reaches zero days remaining.

## Subscription Data

The database stores each Telegram user by permanent Telegram user id. Username is display metadata only and must not be used as the primary identity because users can change usernames.

The active Google Sheets `Users` tab uses these columns:

```text
User ID | Username | Start Date | End Date | Days Remaining | Status | Last Updated
```

The recommended status flow is:

```text
Trial -> Subscribe -> Needs Attention -> Unpaid -> Kicked
```

Status rules:

- `Trial`: user is inside the one-day free trial and has no active paid subscription.
- `Subscribe`: paid user has two or more days remaining.
- `Needs Attention`: paid user has one day remaining.
- `Unpaid`: paid user has zero or fewer days remaining, but has not passed the extra overdue day.
- `Kicked`: user stayed unpaid for one full extra day after reaching `Unpaid` and was removed from the private group.

Subscription calculation rules:

- Admin manually enters or updates `Start Date` after payment.
- `End Date` is automatically `Start Date + 31 days`.
- `Days Remaining` is calculated from the current date to `End Date`.
- When `Start Date` changes, `End Date`, `Days Remaining`, and `Status` are recalculated.
- A renewed paid user returns to `Subscribe` when the recalculated days remaining is two or more.
- Trial is never reset after payment, username change, kick, or rejoin.

## Google Sheets Flow

Google Sheets is an admin dashboard, not the access-control source of truth.

The shared SQLite database owns actual access decisions. Google Sheets mirrors and controls the subscription fields that the admin edits.

The workbook has two tabs:

```text
Users
History
```

`Users` contains active tracked users:

```text
User ID | Username | Start Date | End Date | Days Remaining | Status | Last Updated
```

`History` contains removed or kicked users:

```text
User ID | Username | Last Status | Kicked At | Last Start Date | Last End Date | Notes
```

The Google Sheet should provide two admin buttons:

- `Update Subscription`
- `Send Alert`

`Update Subscription` reads the `Users` sheet, sends manual `Start Date` changes to the VPS service, and refreshes calculated fields from the database response.

`Send Alert` asks the VPS service to post or update the current subscription reminder announcement.

The VPS service should also own a daily refresh. The daily refresh recalculates days remaining and status, performs overdue kicks, updates the database, updates the sheet, and updates the alert post. This avoids relying on the Google Sheet being open.

## Username Tracking

The bots update a user's latest known username whenever they see the user in:

- `/start`
- `/search`
- callback query interactions
- subscription bot group membership updates, where available

If a user changes their username, the database updates the display username for that Telegram user id. The next sheet sync updates the `Username` column.

If Telegram provides no username, the database keeps the latest known username when one exists, and the sheet can display a blank or fallback label for users without public usernames.

## Alert Announcement Flow

The subscription bot posts one persistent alert message in the private group's `SUBSCRIPTION ANNOUNCEMENT` topic.

Target topic:

```text
chat id: -1003963665033
message thread id: 46
```

When `Send Alert` is clicked:

- The service finds users with status `Needs Attention`.
- The service also includes `Unpaid` users who are not yet kicked.
- The subscription bot posts a new announcement if no current alert message exists.
- Otherwise, it edits the existing alert message.

Message format:

```text
🚨 Subscription Alert

Your subscription is unpaid or almost expired. Please renew to keep access.

@user1
@user2
@user3
```

When `Update Subscription` or the daily refresh changes users back to `Subscribe`, those users are removed from the alert message.

If no `Needs Attention` or `Unpaid` users remain, the subscription bot deletes the alert message and clears the stored alert message id.

## Overdue Kick Flow

When a user's `Days Remaining` reaches zero, their status becomes `Unpaid` and search access is blocked.

If the user remains `Unpaid` for one full extra day, the subscription bot removes them from the private group.

When the kick succeeds, the database updates:

- `status = Kicked`
- `kicked_at = current timestamp`
- `removed_from_group = true`
- latest known username remains stored
- subscription access stays blocked
- trial remains consumed

The Google Sheet should remove the user from `Users` after first writing a row to `History`.

The alert announcement should remove kicked users from the active reminder list. If no reminder users remain, the alert message is deleted.

The database should not delete kicked users. Keeping permanent user history prevents a kicked user from receiving another free trial by changing username or rejoining later.

## Bot Permissions And Configuration

The service needs two Telegram bot tokens:

- public search bot token
- subscription bot token

The public search bot continues to receive user search commands.

The subscription bot must have enough permission in the private group to:

- send messages to the subscription announcement topic
- edit/delete its own alert message
- remove/kick overdue users
- receive membership-related updates if Telegram sends them

New environment values should include:

```env
SUBSCRIPTION_BOT_TOKEN=replace_with_subscription_bot_token
SUBSCRIPTION_GROUP_CHAT_ID=-1003963665033
SUBSCRIPTION_ALERT_THREAD_ID=46
SUBSCRIPTION_ADMIN_CONTACT=@seinen_illuminatiks
SUBSCRIPTION_TRIAL_HOURS=24
SUBSCRIPTION_PERIOD_DAYS=31
SUBSCRIPTION_OVERDUE_GRACE_DAYS=1
SUBSCRIPTION_ADMIN_TOKEN=replace_with_subscription_admin_secret
GOOGLE_SHEETS_SPREADSHEET_ID=replace_with_sheet_id
GOOGLE_SHEETS_USERS_RANGE=Users!A:G
GOOGLE_SHEETS_HISTORY_RANGE=History!A:G
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/opt/infinitylinks-public-search-bot/google-service-account.json
```

Google Sheets access should use a Google Cloud service account JSON key stored on the VPS outside source control. The workbook must be shared with the service account email so the service can read and update the `Users` and `History` tabs during button actions and daily refreshes.

## API Flow For Google Sheets Buttons

The standalone VPS service should expose authenticated admin endpoints for Google Apps Script.

Recommended endpoints:

```text
POST /api/subscriptions/update
POST /api/subscriptions/send-alert
```

Both endpoints require a dedicated subscription admin token, separate from existing public search sync/status tokens.

`POST /api/subscriptions/update`:

- accepts active rows from the `Users` sheet
- applies manual `Start Date` changes
- recalculates subscription fields
- updates the shared SQLite database
- returns refreshed rows for Google Apps Script to write back
- updates the alert message if affected users no longer need attention

`POST /api/subscriptions/send-alert`:

- queries the database for `Needs Attention` and non-kicked `Unpaid` users
- posts, edits, deletes, or leaves the alert message as needed
- returns the current alert state

## Error Handling

Search access must fail closed for expired or unknown users, but should not block valid paid users because Google Sheets is temporarily unavailable. Since the database is the source of truth, the public search bot can continue working during Google Sheets outages.

If Telegram kick fails, the user stays `Unpaid` or moves to a `kick_failed` internal retry state while remaining blocked from search. The service should retry on the next daily refresh and expose enough status for logs/tests.

If alert edit/delete fails, the service should log and retain the stored alert message id so the next update can retry. If Telegram reports the message no longer exists, the service should clear the stored id and post a replacement when needed.

If Google Sheets update fails during daily refresh, the database changes still remain authoritative. The next successful sheet sync refreshes the sheet.

If a user has no public username, alert messages should use a safe fallback such as their numeric user id only if mentioning by username is impossible. Access tracking still works by user id.

## Testing

Add or update tests for:

- `/start` includes one-day trial text and does not start a trial.
- first valid `/search` starts trial for an unknown user.
- trial users receive normal movie and TV search results during the trial window.
- expired trial users receive the subscription-required message and no download links.
- TV season callbacks enforce the same trial/subscription gate.
- subscribed users receive results while active.
- days remaining transitions: `Subscribe`, `Needs Attention`, `Unpaid`, `Kicked`.
- manual `Start Date` renewal recalculates `End Date`, resets days remaining, and returns status to `Subscribe`.
- username updates are keyed by Telegram user id.
- changed usernames update the database and sheet output.
- `Send Alert` posts or edits one message with `Needs Attention` and non-kicked `Unpaid` users.
- paid users are removed from the alert after `Update Subscription`.
- alert message is deleted when the list becomes empty.
- overdue users are kicked after the extra one-day grace period.
- kicked users move from `Users` to `History` in sheet output.
- kicked users do not receive a second free trial.
- Google Sheets outages do not break public search access for already-known users.
- Telegram kick/alert failures are retried without exposing download links to blocked users.

## Rollout Notes

This is a behavior-changing update to the standalone public search bot service. Deployment requires:

- creating a second Telegram bot token for subscriptions
- adding the subscription bot to the private group with required permissions
- configuring Google Sheets service account authentication
- adding the new environment values on the VPS
- rebuilding and restarting the standalone service
- creating the `Users` and `History` tabs in the Google Sheet
- adding Google Apps Script buttons for `Update Subscription` and `Send Alert`

The old group-membership search gate is replaced in production by the subscription database gate. During migration it can stay behind tests or local fallback code, but the deployed access decision comes from trial/subscription status.

# Subscription Plan Months Design

## Summary

InfinityLinks public-search-bot currently treats every paid subscription as one fixed global period configured by `SUBSCRIPTION_PERIOD_DAYS=31`. The admin wants three paid options: 1 month, 3 months, and 6 months.

The selected design adds a `Plan` column to the Google Sheets `Users` tab. Admins will choose `1 Month`, `3 Months`, or `6 Months` for each paid user. The bot will calculate `End Date`, `Days Remaining`, and `Status` from the row's `Start Date` and `Plan` using calendar-month arithmetic.

## Goals

- Support per-user paid subscription durations of 1, 3, and 6 calendar months.
- Keep the Google Sheets workflow simple for the admin.
- Preserve the existing update flow: admin edits the sheet, then runs `Subscriptions > Update Subscription`.
- Keep public-search access behavior unchanged except for the paid user's calculated subscription end date.
- Avoid manual `End Date` entry as the source of truth.
- Keep existing rows compatible by treating a blank `Plan` as `1 Month` and writing `1 Month` back to the sheet on the next sync.

## Non-Goals

- No payment provider integration.
- No automatic plan selection from Telegram.
- No pricing, invoices, or receipt tracking.
- No changes to the 5-successful-search trial quota.
- No changes to group kick/alert policy beyond using each user's plan-specific end date.

## Sheet Shape

The `Users` sheet header becomes:

```text
User ID | Username | Start Date | Plan | End Date | Days Remaining | Status | Last Updated
```

Allowed `Plan` values:

- `1 Month`
- `3 Months`
- `6 Months`

The parser should also accept common admin-friendly variants and normalize them when writing back:

- `1`, `1 month`, `1 months`, `one month` -> `1 Month`
- `3`, `3 month`, `3 months`, `three months` -> `3 Months`
- `6`, `6 month`, `6 months`, `six months` -> `6 Months`

Blank `Plan` is valid for rows without a paid `Start Date` and for compatibility with old paid rows. If a row has a `Start Date` and blank `Plan`, the bot treats it as `1 Month` and writes `1 Month` back to the sheet during the same update. Rows without `Start Date` should keep a blank `Plan` when written back so trial/unpaid users do not look like paid subscribers.

## Calendar-Month Rules

Plans are calculated with calendar months, not fixed day counts.

Examples:

- `2026-05-27` + `1 Month` = `2026-06-27`
- `2026-05-27` + `3 Months` = `2026-08-27`
- `2026-05-27` + `6 Months` = `2026-11-27`

End-of-month dates should clamp to the last valid day in the target month:

- `2026-01-31` + `1 Month` = `2026-02-28`
- `2028-01-31` + `1 Month` = `2028-02-29`
- `2026-08-31` + `6 Months` = `2027-02-28`

`Days Remaining` continues to be calculated from the computed `End Date` and the current date.

## Data Model

Add a `subscription_plan_months` column to `subscription_users`.

Recommended shape:

```sql
subscription_plan_months INTEGER NOT NULL DEFAULT 1
```

Valid values are `1`, `3`, and `6`. Existing users migrate to `1`.

The existing `subscription_start_date`, `subscription_end_date`, `days_remaining`, and `status` fields remain. The stored plan months value becomes part of the paid subscription state. Trial users can keep the default value because it does not grant paid access without a `subscription_start_date`.

## Sync Behavior

During `Update Subscription`:

1. Read the `Users` sheet.
2. Parse `Start Date` and `Plan`.
3. For rows with no `Start Date`, do not create paid access. Preserve normal trial/unpaid handling.
4. For rows with a `Start Date`, calculate the paid end date using the row's plan months.
5. If either `Start Date` or `Plan` changed from the database state, update the subscription record.
6. Recalculate all paid rows using each user's stored plan months.
7. Write the normalized sheet back with `Plan`, recalculated `End Date`, `Days Remaining`, `Status`, and `Last Updated`. `Plan` is written for paid rows with `Start Date`; it stays blank for rows without paid access.

This means changing a user from `1 Month` to `3 Months` on the same `Start Date` extends the subscription on the next update. Changing from `6 Months` to `1 Month` shortens it on the next update.

## Daily Refresh Behavior

The daily subscription refresh should no longer use one global `periodDays` value. It should recalculate each paid user's end date from:

- that user's `subscription_start_date`
- that user's `subscription_plan_months`

Alert and kick behavior remain the same:

- `Needs Attention` at 1 day remaining
- `Unpaid` at 0 days remaining
- kick after the configured overdue grace period

## Configuration

`SUBSCRIPTION_PERIOD_DAYS` becomes obsolete for paid subscriptions.

Recommended behavior:

- Remove production use of `SUBSCRIPTION_PERIOD_DAYS`.
- Remove it from `.env.example` and README setup instructions.
- Let old deployment `.env` files keep the variable harmlessly; the config loader should ignore it as an unused value.

No new environment variable is needed because the allowed plans are fixed business rules: 1, 3, and 6 months.

## Error Handling

Invalid `Plan` values should fail `Update Subscription` with a clear validation error, such as:

```text
Invalid Plan in Users sheet row 4: 2 Months. Expected 1 Month, 3 Months, or 6 Months.
```

Invalid dates continue to use the existing date validation behavior.

The sheet header validator should require the new header. This is a deliberate breaking sheet-format change, but old row data remains compatible after the admin inserts the `Plan` column.

## Components To Change Later

- `apps/public-search-bot/src/subscriptions/date.ts`
  - Add calendar-month addition with end-of-month clamping.
- `apps/public-search-bot/src/subscriptions/sheet.mapper.ts`
  - Add `Plan` to the header, parser, and writer.
  - Normalize accepted plan aliases to canonical labels.
- `apps/public-search-bot/src/subscriptions/repository.ts`
  - Store `subscription_plan_months`.
  - Replace fixed `periodDays` calculations with per-user plan-month calculations.
- `apps/public-search-bot/src/db/schema.sql`
  - Add `subscription_plan_months`.
- `apps/public-search-bot/src/db/migrate.ts`
  - Add a safe migration for existing databases.
- `apps/public-search-bot/src/subscriptions/sync.service.ts`
  - Apply `Start Date` plus plan months from the sheet.
- `apps/public-search-bot/src/subscriptions/scheduler.ts`
  - Remove dependence on global period days.
- `apps/public-search-bot/src/config.ts` and `apps/public-search-bot/src/index.ts`
  - Remove paid-period config usage.
- `apps/public-search-bot/README.md` and `.env.example`
  - Document the new sheet header and plan values.
- Tests under `apps/public-search-bot/tests`
  - Cover parsing, normalization, migration, repository calculations, sync, daily refresh, and docs/config expectations.

## Testing Strategy

Add or update tests for:

- Plan parser accepts `1 Month`, `3 Months`, `6 Months`, common aliases, and blank compatibility values.
- Plan parser rejects unsupported values.
- Sheet header requires `Plan`.
- Sheet writer includes normalized `Plan`.
- Calendar-month addition handles normal dates and end-of-month clamping.
- Applying a subscription start date stores the selected plan and calculates the correct end date.
- Changing only `Plan` with the same `Start Date` updates the user.
- Daily refresh recalculates users with different plan months independently.
- Existing databases migrate `subscription_plan_months` to `1`.
- Public-search access still allows active paid users and blocks expired users according to the plan-specific end date.
- README and `.env.example` no longer document `SUBSCRIPTION_PERIOD_DAYS`.

## Rollout Notes

Before running the updated bot against the live sheet, insert the `Plan` column between `Start Date` and `End Date`:

```text
User ID | Username | Start Date | Plan | End Date | Days Remaining | Status | Last Updated
```

Existing paid rows can leave `Plan` blank before the first update. The bot will treat those rows as `1 Month` and write back the normalized `1 Month` value. Rows without a paid `Start Date` can keep the `Plan` cell blank.

After deployment, use `Subscriptions > Update Subscription` to rewrite the sheet with normalized plans and recalculated dates.

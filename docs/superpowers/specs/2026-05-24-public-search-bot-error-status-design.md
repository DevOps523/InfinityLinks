# Public Search Bot Error Status Design

Date: 2026-05-24

## Goal

Add a safe way for the local admin app to check whether the standalone public search bot on the VPS is working and whether it has recorded recent errors.

The feature must help the operator answer:

- Can my local admin app reach the VPS bot status API?
- Is the bot currently OK or in an error state?
- What was the latest safe error summary?
- When did the local admin app last successfully check the VPS?

Full logs, stack traces, provider URLs, Telegram payloads, user queries, and indexed post data must stay on the VPS and remain available only through SSH/systemd logs.

## Chosen Approach

Use a protected, errors-focused status endpoint on the standalone VPS bot and a small status card in the local admin app.

The VPS bot exposes `GET /api/status`, protected with a separate read-only token:

```text
Authorization: Bearer PUBLIC_SEARCH_STATUS_TOKEN
```

The local admin app calls this endpoint from its own backend using:

```text
PUBLIC_SEARCH_STATUS_URL=https://your-domain.example/api/status
PUBLIC_SEARCH_STATUS_TOKEN=replace-with-read-only-status-token
```

The browser never receives the status token.

## Status Data Scope

The status API records and returns only safe error status:

- `state`: `ok` or `error`
- `checkedAt`: current VPS status response timestamp
- `uptimeSeconds`: process uptime, useful for knowing whether the process restarted
- `lastError`: latest safe error summary or `null`
- `consecutiveErrorCount`: number of consecutive recorded runtime errors since the last successful operation that clears the error state

The latest safe error summary contains:

- `source`: a short controlled label such as `telegram_poll`, `sync`, `startup`, or `unknown`
- `at`: ISO timestamp
- `message`: sanitized one-line message

The status API must not include:

- bot tokens or sync/status tokens
- provider links
- Telegram update payloads
- user search queries
- channel post contents
- raw stack traces
- SQLite paths if they reveal local deployment details
- environment variable dumps

## Error Recording Behavior

The standalone bot will keep an in-memory error status tracker.

Recorded error sources:

- `startup`: startup failures before the bot begins normal operation
- `telegram_poll`: Telegram polling failures
- `sync`: failed catalog sync requests
- `status_api`: unexpected errors while serving status
- `unknown`: fallback for uncategorized failures

Successful operations can clear the error state where appropriate:

- a successful Telegram poll clears `telegram_poll` consecutive errors
- a successful sync clears `sync` consecutive errors
- startup errors are only visible if the process survives long enough to expose status; otherwise systemd logs remain the source of truth

Full error details continue to be written to normal application logs with `console.error`, which systemd captures in `journalctl`.

## VPS API Design

Add a standalone route:

```text
GET /api/status
```

Authentication:

- Require `Authorization: Bearer <PUBLIC_SEARCH_STATUS_TOKEN>`.
- Return `401` when the header is missing or wrong.
- Use a separate token from `PUBLIC_SEARCH_SYNC_TOKEN`.

Success response:

```json
{
  "state": "ok",
  "checkedAt": "2026-05-24T12:00:00.000Z",
  "uptimeSeconds": 3600,
  "consecutiveErrorCount": 0,
  "lastError": null
}
```

Error-state response:

```json
{
  "state": "error",
  "checkedAt": "2026-05-24T12:05:00.000Z",
  "uptimeSeconds": 3900,
  "consecutiveErrorCount": 3,
  "lastError": {
    "source": "telegram_poll",
    "at": "2026-05-24T12:04:30.000Z",
    "message": "Telegram request failed"
  }
}
```

The route is intended to be safe behind HTTPS because it returns only sanitized status, and the token is always required.

## Local Admin Design

Add local admin backend configuration for the remote status endpoint:

```text
PUBLIC_SEARCH_STATUS_URL=
PUBLIC_SEARCH_STATUS_TOKEN=
```

Add a local backend route that proxies the check:

```text
GET /api/public-search/status
```

Behavior:

- The local backend calls the VPS `PUBLIC_SEARCH_STATUS_URL`.
- The local backend adds `Authorization: Bearer PUBLIC_SEARCH_STATUS_TOKEN`.
- The browser receives only the sanitized VPS status plus local reachability metadata.
- If the VPS cannot be reached, the local route returns a safe unreachable status rather than exposing internal fetch details.

The browser-facing response will include:

- `reachable`: whether the local backend reached the VPS status API
- `lastSuccessfulCheckAt`: timestamp for the latest successful check during this local process lifetime
- `remote`: the sanitized VPS status when reachable
- `error`: safe local connection/auth failure message when unreachable

Add a Public Search Bot status card on the existing public search admin page.

The card shows:

- VPS check result: reachable or unreachable
- last successful local check time
- bot state: `OK` or `ERROR`
- latest error source
- latest error time
- latest safe error message
- refresh/check button

## Logging Model

The local status card is not a log viewer.

Detailed logs stay on the VPS and are checked with SSH:

```bash
ssh root@your-vps-ip "journalctl -u public-search-bot -n 100 --no-pager"
ssh root@your-vps-ip "journalctl -u public-search-bot -f"
```

The README will document:

- the difference between safe status and full logs
- the required status token variables
- how to check detailed VPS logs from the local machine
- that the status token is read-only and separate from the sync token

## Testing

Standalone bot tests:

- status route returns `401` with no token
- status route returns `401` with wrong token
- status route returns safe OK state with correct token
- recorded errors appear as sanitized status
- status response does not include forbidden fields such as provider links, raw payloads, or stack traces

Local admin/server tests:

- local status proxy sends the bearer token server-side
- reachable VPS status is returned to the browser without exposing the token
- unreachable VPS returns a safe unreachable result
- last successful local check time updates only after successful VPS checks

Client tests:

- status card renders reachable OK state
- status card renders remote error state
- status card renders unreachable state
- refresh button triggers a new status check

## Out Of Scope

- Streaming remote logs into the local admin app
- Telegram admin alerts
- Persisting historical error timelines
- Replacing systemd/journalctl logs
- Exposing user searches, provider links, channel post text, or raw Telegram data in status

## Deployment Notes

The standalone bot deployment must add:

```text
PUBLIC_SEARCH_STATUS_TOKEN=replace-with-long-random-token
```

The local admin deployment must add:

```text
PUBLIC_SEARCH_STATUS_URL=https://your-domain.example/api/status
PUBLIC_SEARCH_STATUS_TOKEN=same-read-only-status-token
```

For local testing against a VPS without a domain, the URL may point to the VPS IP or an SSH tunnel, as long as the status endpoint remains protected by the read-only token.

# Attack Path Analysis: TEL-JOB-AUTHZ-001

## Source

Any authenticated non-admin operator can trigger the route from the same-origin app or API client. The action is limited to retrying existing failed jobs, but those jobs represent privileged Telegram message operations.

## Broken Control

Telegram job routes are mounted after global authentication but do not check the caller role. The UI exposes Telegram Jobs to every authenticated role, while user-management routes have an admin check. A non-admin authenticated user can view failed job error details and move failed jobs back into the outbound queue.

## Sink / Impact

Authenticated non-admin session -> /api/telegram/jobs/:id/retry -> retryFailedTelegramJob status update -> processNextTelegramJob -> Telegram Bot API send/edit/delete action.

## Severity

medium: Medium because it crosses a role boundary and can trigger external Telegram side effects, though it cannot create arbitrary new jobs by itself. Severity would rise if failed job payloads include sensitive content or if lower-privileged roles are given broadly to untrusted users.

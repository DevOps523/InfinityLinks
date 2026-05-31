# Attack Path Analysis: AUTH-MUSTCHANGE-001

## Source

An attacker with a temporary password, reset password, or stolen session can bypass the browser gate by calling APIs directly from same-origin tooling or any request path that satisfies the admin API request guard.

## Broken Control

Temporary and reset credentials set mustChangePassword, and the React auth gate sends those users to the change-password screen. The server-side API middleware refreshes the DB user but does not deny API access while mustChangePassword remains true, so the sensitive state is only enforced by client navigation.

## Sink / Impact

Temporary/reset credential -> Auth.js credentials authorize -> session cookie -> /api middleware requireApiAuth -> res.locals.authUser -> protected admin routes.

## Severity

medium: Medium because exploitation requires a valid account credential or session and the app is intended for private administration, but it breaks a high-value account recovery boundary. Severity would rise if the admin app is exposed beyond a trusted operator network or if temporary passwords are distributed through weak channels.

# Attack Path Analysis: AUTH-LOGIN-RATE-001

## Source

Anyone who can reach the admin login endpoint can try repeated passwords. The admin request guard protects /api, not /auth, and no login-specific limiter was found in the credentials callback path.

## Broken Control

The Auth.js credentials provider checks email and password and returns null for failures, but there is no per-IP, per-account, or global failed-login limiter around the credential callback.

## Sink / Impact

Attacker-supplied email/password -> /auth/callback/credentials -> authorize -> findAuthUserByEmail and verifyPassword -> null response without throttle state.

## Severity

low: Low in the intended private-loopback deployment because network exposure should be limited, but it becomes medium if the admin login is reachable from the internet or a shared network. Severity would drop if upstream VPN or reverse-proxy throttling is guaranteed and tested.

# Attack Path Analysis: CAND-PSB-002

## Source

The routes are intended for VPS access from local status checks or Google Apps Script. Attackers need network access to the VPS endpoint and benefit most if token policy also allows weak secrets.

## Broken Control

The sync endpoint has a bad-auth limiter, but the status and subscription admin routes compare bearer tokens directly and return 401 for every bad attempt without throttling. This leaves the read-only status token and subscription admin token easier to brute force if deployed weakly.

## Sink / Impact

Internet request with Authorization header -> /api/status or /api/subscriptions/* -> direct token comparison -> unlimited 401 responses until the correct token is guessed.

## Severity

low: Low on its own because strong random tokens make guessing impractical, but the missing limiter compounds the weak-token startup policy. Severity would rise if endpoint logs show internet scanning or if deployed tokens are short.

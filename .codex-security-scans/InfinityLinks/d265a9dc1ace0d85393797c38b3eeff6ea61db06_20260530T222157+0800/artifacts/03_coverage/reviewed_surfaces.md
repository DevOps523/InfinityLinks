# Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
|---|---|---|---|
| Auth login, sessions, temporary-password flow | Credential theft, reset bypass, forced password-change bypass, browser credential exposure | Reported | AUTH-MUSTCHANGE-001 and AUTH-LOGIN-RATE-001 survived validation. Browser searches did not find secret values or credential persistence in client storage. |
| Admin request guard and user-management API | Cross-site API calls, stale/deleted user sessions, role checks | No issue found | Global /api guard checks custom header/origin/host; user-management router has an admin role check. |
| Public-search bot bearer-token configuration | Weak deployment secrets for sync/status/subscription APIs | Reported | CAND-PSB-001 survived validation; current local .env values appear long, but code permits weak or placeholder production values. |
| Public-search bot status and subscription routes | Token brute force and failed-auth throttling | Reported | CAND-PSB-002 survived validation; sync route has a bad-auth limiter but sibling status/subscription routes do not. |
| Private Telegram failed-job operations | Role bypass and external Telegram side effects | Reported | TEL-JOB-AUTHZ-001 survived validation; non-admin authenticated role can list and retry failed jobs. |
| Public Telegram bot season callbacks | Trial quota bypass and callback tampering | Rejected | CAND-PUBBOT-001 was ruled out as intended non-consuming callback behavior with tests denying exhausted/blocked users. |
| Deployment files and local secrets | Credential exposure in deployable source tree | Reported | DEPLOY-SECRETS-001 survived validation. .env files and the Google key are ignored and not tracked; the key still exists in the deployable app tree. |
| Media/TMDB/database repositories | SQL injection, SSRF, public URL validation, unsafe DB updates | No issue found | Reviewed queries use prepared statements and TMDB/public URL sources are configuration-driven. |
| Local public search sync/status UI | Token leakage to browser, unsafe status rendering, data exposure | No issue found | No secret tokens are returned to the browser; status output is whitelisted operational state. |

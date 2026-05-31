# Repository Coverage Ledger

Scan id: d265a9dc1ace0d85393797c38b3eeff6ea61db06_20260530T222157+0800

Ranked/deep-review rows closed: 114/114.

| Surface | Disposition | Candidate IDs | Closure Evidence |
|---|---|---|---|
| Auth login/session/password reset | reportable | AUTH-MUSTCHANGE-001, AUTH-LOGIN-RATE-001 | Source review plus validation artifacts under `05_findings`. |
| Admin request guard/user router | reviewed/no issue | none | Guard and role checks reviewed; no candidate survived. |
| Public bot bearer-token config | reportable | CAND-PSB-001 | Config accepts weak/placeholder tokens in validation artifact. |
| Public bot status/subscription auth | reportable | CAND-PSB-002 | Repeated invalid bearer attempts remain 401 without 429 in validation artifact. |
| Telegram failed-job control | reportable | TEL-JOB-AUTHZ-001 | Non-admin role validated for list/retry. |
| Public Telegram callback access | rejected | CAND-PUBBOT-001 | Existing tests and code show non-consuming callbacks are intended and blocked/exhausted users are denied. |
| Deployment credential handling | reportable | DEPLOY-SECRETS-001 | Redacted inspection confirms service account key in deployable app tree; git ignored/untracked but locally present. |
| Media/TMDB/DB query surfaces | reviewed/no issue | none | Prepared statements and configuration-owned URL controls reviewed. |
| Browser/client credential exposure | reviewed/no issue | none | No local secret values found in client or dist artifacts; temporary password is kept only in React state. |

See `02_discovery/work_ledger.jsonl` for per-file row closure.

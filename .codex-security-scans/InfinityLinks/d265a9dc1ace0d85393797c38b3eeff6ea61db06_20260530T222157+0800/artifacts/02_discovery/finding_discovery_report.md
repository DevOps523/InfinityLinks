# Finding Discovery Report

Repository-wide discovery covered 114 ranked/deep-review rows from `rank_input.csv` and `deep_review_input.csv`.

## Promoted Candidates

- DEPLOY-SECRETS-001: Google service account key is present in the deployable app tree (reportable)
- AUTH-MUSTCHANGE-001: Forced password-change state is enforced only in the browser UI (reportable)
- CAND-PSB-001: Public bot bearer tokens accept trivially weak or placeholder values (reportable)
- TEL-JOB-AUTHZ-001: Authenticated non-admin users can list and retry failed Telegram jobs (reportable)
- AUTH-LOGIN-RATE-001: Credentials login has no failed-attempt throttling (reportable)
- CAND-PSB-002: Status and subscription bearer endpoints do not throttle failed authentication (reportable)
- CAND-PUBBOT-001: Season callback trial-quota amplification (rejected)

## Coverage Notes

The work ledger closes every deep-review row as reviewed or not applicable. High-impact surfaces included authentication, password reset and temporary passwords, admin request guard, bearer-token public VPS APIs, Telegram job control, media/TMDB data handling, public Telegram bot callbacks, deployment secrets, and browser/client storage exposure.

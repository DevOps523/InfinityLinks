# Validation Summary

| Candidate | Disposition | Confidence | Evidence |
|---|---|---|---|
| DEPLOY-SECRETS-001 | survives | high | Redacted local inspection confirmed the file exists, has service_account structure, includes private key fields, is not git-tracked, and is ignored by .gitignore. Searches for the actual local secret values across client and dist output did not find browser exposure. |
| AUTH-MUSTCHANGE-001 | survives | high | A validation test created an admin user with must_change_password=1 and showed GET /api/admin/users still returns 200. The same test showed an existing signed-in admin session remains authorized after the database flips must_change_password to true. |
| CAND-PSB-001 | survives | high | A validation test loaded the public-search bot config with one-character and placeholder tokens and confirmed both cases were accepted. The current local .env uses long random-looking tokens, so this is a deployment guardrail weakness rather than proof that the live deployment is weak. |
| TEL-JOB-AUTHZ-001 | survives | high | A validation test signed in a non-admin superadmin-role user, inserted a failed Telegram job, and received 200 responses for both GET /api/telegram/jobs/failed and POST /api/telegram/jobs/:id/retry. |
| AUTH-LOGIN-RATE-001 | survives | high | A validation test sent fifteen wrong-password credentials callbacks for the same account and observed authentication failures without a 429 or lockout signal. |
| CAND-PSB-002 | survives | high | A validation test sent twenty invalid bearer requests to status and subscription endpoints and observed only 401 responses. The same source review found sync has a dedicated bad-auth limiter, demonstrating the intended control pattern exists for one sibling route but not the others. |
| CAND-PUBBOT-001 | rejected | medium | Existing behavior and tests show season callbacks are non-consuming by design, exhausted/blocked users are denied season details, and ordinary Telegram clients can only press callback buttons produced by the bot. |

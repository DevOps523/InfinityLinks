# Dedupe Report

Seven raw candidates were reconciled into six reportable findings and one rejected candidate.

| Raw candidate | Final disposition | Notes |
|---|---|---|
| DEPLOY-SECRETS-001 | reportable | Preserved as independently attackable source/control/sink tuple. |
| AUTH-MUSTCHANGE-001 | reportable | Preserved as independently attackable source/control/sink tuple. |
| CAND-PSB-001 | reportable | Preserved as independently attackable source/control/sink tuple. |
| TEL-JOB-AUTHZ-001 | reportable | Preserved as independently attackable source/control/sink tuple. |
| AUTH-LOGIN-RATE-001 | reportable | Preserved as independently attackable source/control/sink tuple. |
| CAND-PSB-002 | reportable | Preserved as independently attackable source/control/sink tuple. |
| CAND-PUBBOT-001 | rejected | Existing behavior and tests show season callbacks are non-consuming by design, exhausted/blocked users are denied season details, and ordinary Telegram clients can only press callback buttons produced by the bot. |

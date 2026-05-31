# Attack Path Analysis: CAND-PSB-001

## Source

If an operator follows the example but leaves short or placeholder tokens in production, internet clients reaching the VPS endpoints can brute force or guess tokens that authorize catalog sync, status reads, or subscription actions.

## Broken Control

The public VPS bot protects sync, status, and subscription admin APIs with bearer tokens, but requiredSecret only enforces a trimmed length of at least one character. Placeholder-looking or one-character tokens pass startup validation as long as the three values differ.

## Sink / Impact

VPS environment variable -> requiredSecret min(1) -> config.publicSearchSyncToken/statusToken/subscriptionAdminToken -> bearer comparison in public HTTP routes.

## Severity

medium: Medium because the affected APIs are intended to be public-network reachable behind Nginx and tokens are the main application-level control. Severity would drop if deployment automation always injects strong random secrets; it would rise if weak values are already deployed.

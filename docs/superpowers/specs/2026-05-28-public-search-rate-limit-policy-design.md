# Public Search Rate Limit Policy Design

## Goal

Make public-search-bot access fair for real subscribers while keeping trial, unpaid, kicked, and removed users from abusing bot replies or content access as the Telegram audience grows.

## Current Context

The public-search bot currently uses one fixed-window limiter with separate keys for message interactions and callback interactions. It is configured at 5 interactions per 60 seconds in `apps/public-search-bot/src/index.ts`.

The trial quota is separate from this anti-spam limiter. Trial quota is stored per subscription user and counts successful searches only. Season button callbacks do not increment the trial search quota.

## Recommended Policy

Paid users are users with status `Subscribe` or `Needs Attention`.

Paid users get:

- 10 `/search` requests per 60 seconds.
- 20 season button callbacks per 60 seconds.
- Continued access while the subscription is active.

Trial users get:

- 5 successful movie or TV searches total.
- 5 `/search` requests per 60 seconds for anti-spam protection.
- 10 season button callbacks per 60 seconds while trial quota remains available.
- No quota consumption for no-result searches.
- No quota consumption for season button callbacks.

Once a trial user has consumed all 5 successful searches, they are blocked from new search results and season detail/download link views. The bot should show the subscription/pricing message.

Unpaid, kicked, or removed users get:

- No search results.
- No season detail/download links.
- The subscription/pricing message only.
- A strict subscription-message throttle so repeated blocked actions do not spam Telegram.

## Access Classes

The handler should classify a user before choosing a rate limit bucket:

- `paid`: status is `Subscribe` or `Needs Attention`, and the user is not marked removed from the group.
- `trial-active`: status is `Trial`, not removed, and `trial_searches_used` is below the configured trial limit.
- `blocked`: no user, `Unpaid`, `Kicked`, removed from group, or trial quota exhausted.

This classification should be done without consuming trial quota. Successful search quota should still only be consumed after a valid private-chat search finds results with provider links.

## Rate Limit Buckets

Use separate buckets by user, access class, and action type:

- `paid:search:<user>`: 10 per 60 seconds.
- `paid:season:<user>`: 20 per 60 seconds.
- `trial:search:<user>`: 5 per 60 seconds.
- `trial:season:<user>`: 10 per 60 seconds.
- `blocked:message:<user>`: 3 subscription/pricing messages per 60 seconds.

When a blocked user exceeds the blocked-message throttle, the bot should use the existing wait-message behavior instead of sending the subscription/pricing message again.

## User Experience

Paid users should rarely hit rate limits during normal browsing. A subscriber can search several titles and browse seasons without seeing frequent wait messages.

Trial users should feel the product enough to decide whether to subscribe, but the quota boundary must be clear and firm. After the fifth successful search is consumed, every content request should return the subscription/pricing message.

Blocked users should receive the pricing message, not content. Repeated spam should receive either no repeated message or the existing "Please wait X seconds before trying again" response.

## Error Handling

If the bot cannot classify the user because Telegram did not provide a user id, treat the user as blocked.

If the catalog is unavailable, keep returning the unavailable message and do not consume trial quota.

If a search has no results, do not consume trial quota.

## Testing

Add or update tests for:

- Paid users can make up to 10 searches per minute.
- Paid users can make up to 20 season callbacks per minute.
- Trial users keep the 5 successful-search quota.
- Trial users are blocked from search results after the fifth successful search has been consumed.
- Trial users are blocked from season details after the quota is exhausted.
- Season callbacks do not increment trial search usage.
- Unpaid, kicked, and removed users do not receive search results or season details.
- Blocked users receive the subscription/pricing message, with repeated blocked responses throttled.

## Out Of Scope

This design does not change subscription plan pricing, Google Sheets subscription durations, Telegram group join tracking, or the public catalog sync behavior.

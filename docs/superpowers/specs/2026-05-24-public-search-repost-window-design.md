# Public Search Repost Window Design

## Context

Season reposts now delete the old Telegram channel post before sending the replacement post. This avoids duplicate channel posts, but it creates a short repost window where the season is still valid and has active episode provider links, while `seasons.telegram_message_id` is temporarily `NULL`.

The public search catalog currently exports TV seasons only when `seasons.post_status = 'posted'` and `seasons.telegram_message_id IS NOT NULL`. During the repost window, that removes the season from the public bot even though users could still use the provider links.

## Decision

Use option B: keep the season visible in public search during the repost window, but do not show an Original Post button until a valid Telegram channel post exists.

## Desired Behavior

The public search catalog should include a TV season when:

- The season `post_status` is `posted`.
- The season has at least one episode with at least one active provider link.

The catalog should not require `seasons.telegram_message_id IS NOT NULL` for TV seasons. If the message ID exists, the catalog includes `telegramMessageId` and `channelPostUrl`. If the message ID is `NULL`, the catalog keeps the season and provider links, but omits the channel post fields.

The public bot already supports this rendering shape:

- Season details with `channelPostUrl` show the Original Post inline button.
- Season details without `channelPostUrl` omit the Original Post button.
- Episode provider buttons remain visible either way.

Movies should keep the current behavior for now. A movie result is a direct search result, and showing a movie without a channel post would change a different user flow. This spec only changes TV season export behavior.

## Data Flow

1. Admin clicks Repost Season.
2. Local queue deletes the old Telegram message with `retainEntityState`.
3. On successful delete, local season remains `posted`, but `telegram_message_id` becomes `NULL`.
4. Public search sync exports the season because it is still posted and has active episode provider links.
5. Public bot search shows the TV show and season. Season details show episode provider buttons and no Original Post button.
6. After the replacement Telegram send succeeds, local season receives the new `telegram_message_id`.
7. Next public search sync includes the new `channelPostUrl`, and the Original Post button returns.

## Error Handling

If the retained delete fails, the old `telegram_message_id` is preserved by the queue. Public search continues to export the old Original Post link, which is correct because the old post still exists.

If the replacement send fails after the old post was deleted, the public bot still shows provider links without an Original Post button. This is better than hiding valid downloads or linking to a deleted Telegram post.

If a season has no active episode provider links, it remains excluded from public search even when posted.

## Testing

Add or update server catalog tests to cover:

- A posted season with `telegram_message_id = NULL` and active episode links is exported.
- That exported season has no `telegramMessageId` and no `channelPostUrl`.
- A posted season with a message ID still exports the Original Post URL.
- A season without active episode provider links remains excluded.

Add or confirm public bot formatter/search tests cover:

- Season details without `channelPostUrl` render provider buttons and no Original Post button.

## Out of Scope

- Automatic sync immediately after each Telegram queue job.
- Changing movie public-search behavior.
- Showing an in-bot warning such as "Original post is being refreshed."
- Reposting or editing public bot messages after sync.

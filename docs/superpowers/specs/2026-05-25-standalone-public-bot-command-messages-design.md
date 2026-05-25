# Standalone Public Bot Command Messages Design

Date: 2026-05-25

## Purpose

Improve standalone public search bot command behavior so users get clear validation and recovery messages in Telegram.

The current standalone bot returns the welcome/help message when `/search` is sent without a title. It also uses a vague retry-later message when channel membership cannot be verified. This design makes those responses clearer and adds a lightweight `/clear` command.

## Scope

This change applies only to the standalone VPS bot under `apps/public-search-bot/`.

In scope:

- Standalone bot command handling in `apps/public-search-bot/src/bot/handlers.ts`.
- Standalone bot message formatting in `apps/public-search-bot/src/bot/formatter.ts`.
- Standalone bot tests under `apps/public-search-bot/tests/`.

Out of scope:

- This change targeted only `apps/public-search-bot/`; the old root `src/public-search/` compatibility copy was not part of this design and rollout.
- Root `tests/public-search/` files were not part of this change; the old public-search copy is historical context only.
- Local admin app behavior.
- Telegram message deletion or persistent conversation history.
- Database schema changes.

## Command Behavior

### `/start`

`/start` remains a public help command and does not require membership verification.

It returns an emoji-enhanced welcome/help message:

```text
🎬 Welcome to InfinityLinks Search.

🔎 Use:
/search movie or tv show name

✨ Examples:
/search inception
/search breaking bad

📢 Channel: @infinitylinks65
👥 Group: @infinitylinks69
```

### `/search` Without A Title

`/search` with no movie or TV show title returns validation instead of the welcome/help message:

```text
⚠️ Please provide a movie or TV show title.

Example: /search inception
```

This response does not perform a membership check and does not search the database.

### `/search <title>`

`/search <title>` keeps the existing behavior:

- apply the per-user message rate limit
- verify channel membership
- return movie/TV search results when joined
- return no-results/unavailable messages where applicable

Users do not need to send `/start` before searching. They can directly send `/search inception`.

### `/clear`

`/clear` is a lightweight reset command.

It does not delete Telegram chat history and does not require membership verification. The bot currently stores no conversation state, so the command simply confirms that the user can start fresh:

```text
🧹 Cleared. Search anytime with /search movie or tv show name.
```

After `/clear`, the user can directly send `/search <movie or TV show>`.

## Membership Messages

For `/search <title>` and season callback buttons, the bot continues to enforce channel membership before exposing search results or provider links.

When a user has left the channel, is not a channel member, or Telegram membership verification fails, use this clearer message:

```text
We could not verify your channel membership right now. Please join the channel and try again.
```

For normal chat messages, include the channel/group footer with the join-required response:

```text
We could not verify your channel membership right now. Please join the channel and try again.

📢 Channel: @infinitylinks65
👥 Group: @infinitylinks69
```

For callback query answers, use a short alert text where needed, then send the full chat message when the callback has a chat id.

## Testing

Add or update standalone bot tests for:

- `/start` returns the emoji welcome/help message and does not check membership.
- `/search` with no title returns the validation message and does not check membership.
- `/clear` returns the cleared message and does not check membership.
- `/search <title>` still works without `/start` first.
- user-left-channel search returns the new membership verification message and does not leak provider links.
- Telegram membership API failure returns the new membership verification message and does not leak provider links.
- season callback membership failure paths use the new message and still avoid leaking provider links.

Formatter tests should assert the updated text for welcome, validation, clear, and join-required messages.

## Rollout Notes

Because the standalone VPS bot is a long-running process, deploying this change requires restarting the standalone public search bot service after code is updated.

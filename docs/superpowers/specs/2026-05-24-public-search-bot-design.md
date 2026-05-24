# Public Search Bot Design

## Purpose

Add a public Telegram search bot for InfinityLinks while keeping the admin app local and private. Users should not need to scroll through the Telegram channel to find media links. They can start the bot with `/start`, search with `/search <movie or tv show>`, and receive text-only results with active provider link buttons.

The public bot will run online on a VPS. The existing InfinityLinks admin app remains local and becomes the source of truth for the catalog. A one-click sync action publishes only the public-search catalog to the VPS.

## Selected Approach

Use a separate VPS-hosted public search service with a protected sync API.

- Local InfinityLinks continues to manage movies, TV shows, episodes, provider links, and channel posting.
- Local InfinityLinks adds a "Sync Public Search" action.
- The sync action sends a compact public catalog to the VPS.
- The VPS stores that catalog in its own SQLite database.
- The VPS runs the Telegram public search bot 24/7.
- The bot checks that each user has joined `@infinitylinks65` before returning search results.

This approach keeps the admin app private, avoids hosting the full InfinityLinks UI online, and still gives Telegram users an always-available search bot.

## Alternatives Considered

### Bot Only Links To Channel Posts

The VPS bot could store only titles and Telegram message IDs, then return links to original channel posts.

This is simpler and stores less sensitive data on the VPS, but it does not support active provider URL buttons or episode-specific TV results.

### VPS Reads Full SQLite Copy

The local app could copy the entire InfinityLinks SQLite database to the VPS.

This is simpler than building a dedicated catalog export, but it sends more data than the bot needs, including inactive or unrelated admin data unless filtered later.

### Host Entire App On VPS

The admin app, database, posting worker, and public bot could all run on the VPS.

This removes the sync step, but it makes the admin UI internet-hosted and requires authentication and broader production hardening.

## Architecture

### Local Admin App

The existing InfinityLinks app remains the source of truth and runs locally. It will add:

- A public catalog builder that reads the local SQLite database.
- A "Sync Public Search" action in the admin UI.
- Server-side sync logic that posts the catalog to the VPS.
- Sync status feedback in the UI.

The local app keeps the existing TMDB integration, Telegram channel-posting queue, and local SQLite database.

### VPS Public Search Service

The VPS service is a small Node/TypeScript service that owns:

- Telegram public search bot runtime.
- Public search SQLite database.
- Protected catalog sync endpoint.
- Per-user command and callback rate limiting.
- Global Telegram reply queue and retry handling.
- Channel membership checks.

The VPS bot uses long polling first. Long polling avoids requiring a Telegram webhook domain and TLS setup just to receive bot commands. The production sync API uses HTTPS because it receives provider URLs.

## Configuration

Local app additions:

```env
PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_secret_token
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
```

VPS service configuration:

```env
PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_same_secret_token
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
PUBLIC_SEARCH_PORT=3001
```

The public search bot uses its own bot token, separate from the existing channel-posting bot token. The public bot must be added as an admin in `@infinitylinks65` so it can check membership.

## Synced Catalog

The local app syncs only public-search data needed by the VPS bot.

### Movies

Each movie record includes:

- Local movie ID.
- Title.
- Year.
- Telegram message ID when available.
- Original channel post URL when available.
- Active provider links.

Movie provider links include:

- Provider name.
- Quality.
- URL.
- Sort order.

Inactive movie links are excluded.

### TV Shows

Each TV show record includes:

- Local TV show ID.
- Title.
- Year.
- Seasons with available active episode links.

Each season includes:

- Local season ID.
- Season number.
- Telegram message ID when available.
- Original channel post URL when available.
- Episodes that have active links.

Each episode includes:

- Episode number.
- Active provider links.

Episode provider links include:

- Provider name.
- Quality.
- URL.
- Sort order.

Inactive episode links are excluded. Episodes with no active links are excluded from the public catalog.

## Sync Behavior

The local admin app sends the full current public catalog to the VPS.

The VPS sync endpoint:

- Requires `PUBLIC_SEARCH_SYNC_TOKEN`.
- Rejects missing or invalid tokens.
- Applies request size limits.
- Applies rate limits.
- Validates the catalog payload.
- Replaces the current public catalog with the uploaded catalog in one transaction.
- Records the last successful sync time.

Replacing the catalog in one transaction prevents users from seeing partial updates.

The local UI reports:

- Sync in progress.
- Sync success with item counts.
- Sync failure with a clear error.
- Last successful sync time when known.

## Bot Commands

### `/start`

Replies with short usage instructions:

```text
Welcome to InfinityLinks Search.

Use:
/search movie or tv show name

Example:
/search inception
/search breaking bad

Channel: @infinitylinks65
Group: @infinitylinks69
```

### `/search <query>`

Before searching, the bot checks whether the user has joined `@infinitylinks65`.

If the user has not joined:

```text
Please join our channel first, then come back and use /search again.

Channel: @infinitylinks65
Group: @infinitylinks69
```

If the membership check succeeds, the bot searches movies and TV shows and returns up to 10 matching results.

If no catalog has been synced yet:

```text
Search is temporarily unavailable. Please try again later.
```

If no matches are found:

```text
No results found. Try checking the spelling or using fewer words.

Channel: @infinitylinks65
Group: @infinitylinks69
```

## Search Results

Search results are text-only. The bot does not send posters.

Matching supports case-insensitive partial title search. Results are limited to the top 10. Exact and prefix title matches rank ahead of looser substring matches.

### Movie Result

A movie result shows the title, year, provider URL buttons, channel handle, and group handle.

```text
Movie
Inception (2010)

Providers:

Channel: @infinitylinks65
Group: @infinitylinks69
```

Provider links are shown as inline URL buttons. Button labels use provider name and quality, such as `MixDrop HD` or `FileMoon 4K`.

### TV Result

A TV show result initially shows title, year, and season callback buttons.

```text
TV Show
Breaking Bad (2008)

Choose a season:

Channel: @infinitylinks65
Group: @infinitylinks69
```

Season buttons are inline callback buttons, such as `Season 1`, `Season 2`, and `Season 3`. They do not open websites. They ask the bot to show the selected season.

### TV Season Callback

When the user taps a season button, the bot checks channel membership again. If the user is still allowed, it shows the selected season.

```text
Breaking Bad (2008)
Season 1

Episode 1

Episode 2

Channel: @infinitylinks65
Group: @infinitylinks69
```

Provider links are shown as inline URL buttons under the correct episode. Button labels use provider name and quality.

If a season has too many episodes or provider buttons for one Telegram message, the bot splits the response into multiple messages while keeping episode links under the correct episode heading.

## Channel And Group Handles

Bot text displays:

- `Channel: @infinitylinks65`
- `Group: @infinitylinks69`

Internally, the bot may still use Telegram-compatible URLs for inline buttons or API calls where required. Public display text should use handles.

## Membership Gate

The bot requires users to join only `@infinitylinks65`. Joining `@infinitylinks69` is not required for `/search`.

The public bot must be an admin in `@infinitylinks65` so it can use Telegram membership checks for users.

Membership checks apply to:

- `/search`.
- TV season callbacks.

If Telegram membership checking fails due to an API problem, the bot asks the user to try again later and does not reveal provider links.

## Rate Limiting

Rate limiting protects the bot from abuse and reduces Telegram API rate-limit risk.

### Per-User Interaction Limit

Limit each Telegram user to a small number of `/search` commands and season callbacks per minute. If a user exceeds the limit, reply with a short "please wait" message.

### Global Telegram Reply Queue

Bot replies go through a small queue. The queue paces outgoing Telegram messages and respects Telegram retry delays when rate-limit responses occur.

### Sync Endpoint Limit

Limit sync attempts per time window, even when the token is valid. This prevents accidental repeated sync clicks or token misuse from overwhelming the VPS.

## Error Handling

- Invalid sync token returns an unauthorized response.
- Invalid sync payload returns validation errors without changing the current catalog.
- Failed sync leaves the last successful catalog available.
- Missing public catalog makes `/search` return a temporary unavailable message.
- Missing or inactive provider URLs are not shown.
- Telegram rate-limit responses pause sending until the retry delay passes.
- Telegram membership-check failures do not reveal provider links.
- Telegram callback data is validated before reading season data.

## Security

The VPS stores active provider URLs, so VPS access and backups must be treated as sensitive.

Security rules:

- Do not expose the local admin UI to the public internet.
- Do not sync inactive links.
- Do not sync TMDB API keys.
- Do not sync unrelated admin records.
- Keep the sync token out of source control.
- Keep bot tokens out of source control.
- Use HTTPS for the sync endpoint when deployed.
- Restrict sync payload size.
- Validate all synced data before replacing the catalog.

## Testing

Automated tests should cover:

- Public catalog export includes movies with active links.
- Public catalog export excludes inactive movie links.
- Public catalog export keeps TV episode links attached to the correct episode.
- Public catalog export excludes inactive episode links.
- Sync endpoint rejects missing and invalid tokens.
- Sync endpoint replaces catalog transactionally.
- `/start` returns usage instructions.
- `/search` blocks users who have not joined `@infinitylinks65`.
- `/search` returns up to 10 matches for joined users.
- Search ranks exact and prefix title matches ahead of loose matches.
- Movie provider buttons point to the correct URLs.
- TV search result shows season callback buttons.
- Season callback returns the correct season and episode provider buttons.
- Season callback checks channel membership again.
- Per-user rate limiting blocks repeated spam.
- Telegram rate-limit retry handling delays future sends.

Manual verification should cover:

- Deploying the VPS bot with a real Telegram bot token.
- Adding the bot as admin to `@infinitylinks65`.
- Running a local sync.
- Searching from a Telegram user who has joined the channel.
- Searching from a Telegram user who has not joined the channel.
- Opening provider URL buttons from movie and TV season results.

## Rollout Plan

1. Add the public catalog builder to the local app.
2. Add local sync configuration and the admin "Sync Public Search" action.
3. Build the VPS public search service database and protected sync endpoint.
4. Build `/start`, channel membership checks, and `/search`.
5. Build movie provider URL buttons.
6. Build TV season callback buttons and episode provider URL buttons.
7. Add message splitting for large TV seasons.
8. Add per-user, global send, and sync endpoint rate limiting.
9. Deploy the VPS service.
10. Add the bot as admin to `@infinitylinks65`.
11. Run end-to-end Telegram verification.

## Acceptance Criteria

- The admin app remains local and private.
- The VPS bot runs independently online.
- The local app can sync the current public catalog with one action.
- The VPS stores only active public-search links and metadata.
- `/start` shows usage instructions plus `@infinitylinks65` and `@infinitylinks69`.
- `/search` requires channel membership in `@infinitylinks65`.
- `/search` returns at most 10 matching movies and TV shows.
- Movie results include active provider URL buttons.
- TV results let users choose seasons with inline callback buttons.
- Season results show episodes with their own active provider URL buttons.
- Provider links are not shown to users who have not joined the channel.
- Bot text displays channel and group as handles, not `https://t.me` URLs.
- Rate limits protect user commands, season callbacks, Telegram replies, and sync requests.

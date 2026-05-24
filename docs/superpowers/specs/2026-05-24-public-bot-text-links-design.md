# Public Bot Text Links Design

## Context

Public search bot results currently place important links in inline keyboards: Original Post, provider download links, Channel, and Group. In Telegram this makes results feel scrambled because the message body says only "Providers:" while the actual links appear below the message as detached buttons. Channel and group buttons also clutter every result.

The desired behavior is a readable message body where download links appear next to their provider names. Inline buttons should be reserved for choosing a TV season.

## Decision

Use text links for movies, season details, Original Post, Channel, and Group. Keep inline buttons only for TV season selection.

## Message Rules

- Movie result messages must not include inline buttons.
- Season detail messages must not include inline buttons.
- TV show search result messages may include inline season buttons.
- Start, join-required, and no-results messages must not include inline channel/group buttons.
- Provider links must be printed in the message body under `🔗 Download Links:`.
- Provider lines must include provider name, quality, and URL: `📁 Filekeeper HD - https://...`.
- Original Post must be text only under `📌 Original Post:` when `channelPostUrl` exists.
- If `channelPostUrl` is missing during a repost window, omit the Original Post section.
- Channel and Group must be text only in every footer:
  - `📢 Channel: @infinitylinks65`
  - `👥 Group: @infinitylinks69`
- Telegram should make URLs and `@handles` active links automatically.

## Target Formats

Movie result:

```text
🎬 Movie
Title (2026)

🔗 Download Links:
📁 Filekeeper HD - https://filekeeper.example/movie
📁 Mixdrop HD - https://mixdrop.example/movie

📌 Original Post:
https://t.me/infinitylinks65/123

📢 Channel: @infinitylinks65
👥 Group: @infinitylinks69
```

TV show search result:

```text
📺 TV Show
Title (2026)

📂 Choose a season:

📢 Channel: @infinitylinks65
👥 Group: @infinitylinks69
```

The TV show search result keeps season inline buttons, for example `Season 1`, `Season 2`, and `Season 3`.

Season detail:

```text
📺 Title (2026)
📂 Season 1

🎞 Episode 1
🔗 Download Links:
📁 Filekeeper HD - https://filekeeper.example/s1e1
📁 Mixdrop HD - https://mixdrop.example/s1e1

🎞 Episode 2
🔗 Download Links:
📁 Mixdrop HD - https://mixdrop.example/s1e2

📌 Original Post:
https://t.me/infinitylinks65/456

📢 Channel: @infinitylinks65
👥 Group: @infinitylinks69
```

## Splitting And Limits

Provider links moving into text means message length, not inline keyboard size, becomes the main Telegram limit. Formatting must continue to split long movie and season results into multiple messages when needed.

Splitting rules:

- Keep the same title/header and footer on every split message.
- Keep each provider line intact.
- For season details, keep provider lines grouped under the correct episode.
- If an episode has many providers, it may continue into another message, but every split message must still show the episode heading before those provider lines.
- No message text should exceed `MAX_FORMATTED_MESSAGE_LENGTH`.
- Inline keyboard row/button limits still apply to TV season selection messages.

## Error Handling

If a provider URL is long, the bot should still include it as text and split messages before Telegram limits are exceeded.

If `channelPostUrl` is missing, the bot should omit the Original Post section rather than showing an empty label.

If there are no provider links, existing search/catalog behavior should prevent that result from being shown; formatter changes do not need to invent a no-provider state.

## Testing

Update formatter tests in both public-search code paths:

- `tests/public-search/public-search.formatter.test.ts`
- `apps/public-search-bot/tests/public-search.formatter.test.ts`

Coverage should prove:

- Start, join-required, and no-results messages have no inline keyboard.
- Movie results render provider links in text and no inline keyboard.
- Movie results render Original Post as text when present.
- TV show results still render season inline buttons, but no channel/group inline buttons.
- Season details render provider links in the correct episode block and no inline keyboard.
- Season details omit Original Post when `channelPostUrl` is missing.
- Long movie/season provider lists split into safe messages without separating provider links from their labels.

## Out Of Scope

- Changing the search commands.
- Changing search ranking.
- Changing catalog sync behavior.
- Changing provider names or qualities stored in the database.
- Making Channel or Group hidden; they remain visible as text active links.

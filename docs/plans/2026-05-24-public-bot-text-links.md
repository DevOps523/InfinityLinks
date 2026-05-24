# Public Bot Text Links Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make public search bot results readable by moving provider, Original Post, Channel, and Group links into message text while keeping inline buttons only for TV season selection.

**Architecture:** Update the duplicated public-search formatters in `src/public-search/bot/formatter.ts` and `apps/public-search-bot/src/bot/formatter.ts` with the same behavior. Message text becomes the source of truth for links; inline keyboards remain only for TV season callback buttons, so formatter tests in both code paths must be updated together.

**Tech Stack:** TypeScript, Telegram Bot API reply markup types, Vitest.

---

### Task 1: Remove Channel And Group Inline Buttons

**Files:**
- Modify: `src/public-search/bot/formatter.ts`
- Modify: `apps/public-search-bot/src/bot/formatter.ts`
- Modify: `tests/public-search/public-search.formatter.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.formatter.test.ts`

**Step 1: Write failing tests for non-result messages**

In both formatter test files, update `formats /start, join-required, no-result, and unavailable messages` so `/start`, join-required, and no-result messages expect emoji footer text and no `replyMarkup`.

Expected text footer:

```ts
[
  '📢 Channel: @infinitylinks65',
  '👥 Group: @infinitylinks69'
].join('\n')
```

For each of these messages, add:

```ts
expect(formatStartMessage(handles).replyMarkup).toBeUndefined();
expect(formatJoinRequiredMessage(handles).replyMarkup).toBeUndefined();
expect(formatNoResultsMessage(handles).replyMarkup).toBeUndefined();
```

Also update expected text strings to include:

```ts
'📢 Channel: @infinitylinks65',
'👥 Group: @infinitylinks69'
```

instead of:

```ts
'Channel: @infinitylinks65',
'Group: @infinitylinks69'
```

**Step 2: Write failing tests for TV show season selection**

In both formatter test files, update `formats TV results with season callback buttons` so it expects:

```ts
[
  '📺 TV Show',
  'Breaking Bad (2008)',
  '',
  '📂 Choose a season:',
  '',
  '📢 Channel: @infinitylinks65',
  '👥 Group: @infinitylinks69'
].join('\n')
```

and only season buttons in the inline keyboard:

```ts
expect(messages[0].replyMarkup).toEqual({
  inline_keyboard: [
    [
      { text: 'Season 1', callback_data: 'season:101' },
      { text: 'Season 2', callback_data: 'season:102' }
    ]
  ]
});
```

Update TV season keyboard split tests so they no longer expect `handleButtonRow` as the final row. They should still assert row/button limits for season buttons.

**Step 3: Update existing movie and season-detail tests for footer-only handle changes**

Still in both formatter test files, update any existing movie or season-detail assertion that currently expects:

```ts
'Channel: @infinitylinks65',
'Group: @infinitylinks69'
```

to expect:

```ts
'📢 Channel: @infinitylinks65',
'👥 Group: @infinitylinks69'
```

For Task 1 only, movie and season-detail provider links may still be inline buttons. Update their `replyMarkup` expectations so they no longer include `handleButtonRow`, but still include their current Original Post and provider rows. For example, before Task 2 changes movie providers to text, the movie result may still expect:

```ts
expect(messages[0].replyMarkup).toEqual({
  inline_keyboard: [
    [{ text: 'Original Post', url: 'https://t.me/infinitylinks65/101' }],
    [
      { text: 'MixDrop HD', url: 'https://providers.example/inception-hd' },
      { text: 'FileMoon 4K', url: 'https://providers.example/inception-4k' }
    ]
  ]
});
```

Do the same for season-detail provider-button assertions until Task 3 converts those provider rows to text.

**Step 4: Run focused tests and confirm failure**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts
```

Expected: fail because current formatter still returns channel/group inline buttons and old footer text.

**Step 5: Implement text-only handles and TV season-only buttons**

In both formatter files:

1. Change `formatStartMessage`, `formatJoinRequiredMessage`, and `formatNoResultsMessage` to omit `replyMarkup`.
2. Change `formatHandles` to:

```ts
function formatHandles(handles: PublicBotHandles) {
  return [`📢 Channel: ${handles.channelHandle}`, `👥 Group: ${handles.groupHandle}`].join('\n');
}
```

3. Remove `handleButtonRows` usage from `formatTvResult`.
4. Keep `formatTvResult` reply markup only for season buttons:

```ts
return splitKeyboardRows(seasonRows, [], []).map((keyboardRows) => ({
  text,
  replyMarkup: toReplyMarkup(keyboardRows)
}));
```

5. Remove `handleButtonRows` and `handleUrl` once no formatter code uses them.

**Step 6: Run focused tests**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts
```

Expected: pass.

**Step 7: Commit Task 1**

Run:

```bash
git add src/public-search/bot/formatter.ts apps/public-search-bot/src/bot/formatter.ts tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts
git commit -m "fix: remove public bot handle buttons"
```

Do not stage `apps/public-search-bot/.env.example`.

---

### Task 2: Render Movie Download Links In Text

**Files:**
- Modify: `src/public-search/bot/formatter.ts`
- Modify: `apps/public-search-bot/src/bot/formatter.ts`
- Modify: `tests/public-search/public-search.formatter.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.formatter.test.ts`

**Step 1: Update movie result tests**

In both formatter test files, update `formats movie results with provider URL buttons`.

Expected text:

```ts
[
  '🎬 Movie',
  'Inception (2010)',
  '',
  '🔗 Download Links:',
  '📁 MixDrop HD - https://providers.example/inception-hd',
  '📁 FileMoon 4K - https://providers.example/inception-4k',
  '',
  '📌 Original Post:',
  'https://t.me/infinitylinks65/101',
  '',
  '📢 Channel: @infinitylinks65',
  '👥 Group: @infinitylinks69'
].join('\n')
```

Expected reply markup:

```ts
expect(messages[0].replyMarkup).toBeUndefined();
```

Update `chunks many movie provider buttons into small rows` into a text test named `formats many movie providers as text download links`. It should assert provider lines are in `messages[0].text` and `replyMarkup` is undefined.

Update `splits movie result keyboards before Telegram limits are exceeded` into a text split test. Use long provider URLs or many providers and assert:

```ts
expect(messages.length).toBeGreaterThan(1);
expect(messages.every((message) => message.text.length <= MAX_FORMATTED_MESSAGE_LENGTH)).toBe(true);
expect(messages.every((message) => message.replyMarkup === undefined)).toBe(true);
expect(messages[0].text).toContain('🎬 Movie');
expect(messages[0].text).toContain('🔗 Download Links:');
```

**Step 2: Run focused tests and confirm failure**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts
```

Expected: fail because movie providers are still inline buttons.

**Step 3: Add provider text helpers**

In both formatter files, add helpers:

```ts
function formatProviderLine(provider: PublicProvider) {
  return `📁 ${provider.providerName} ${provider.quality} - ${provider.url}`;
}

function originalPostSection(channelPostUrl?: string) {
  return channelPostUrl ? ['📌 Original Post:', channelPostUrl] : [];
}
```

Add a generic text splitting helper for line blocks:

```ts
function splitTextSections(headerLines: string[], bodyLines: string[], footerLines: string[]) {
  const messages: string[] = [];
  let currentBody: string[] = [];

  const compose = (lines: string[]) => [headerLines.join('\n'), lines.join('\n'), footerLines.join('\n')]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');

  for (const line of bodyLines) {
    const candidate = [...currentBody, line];
    if (currentBody.length > 0 && compose(candidate).length > MAX_FORMATTED_MESSAGE_LENGTH) {
      messages.push(compose(currentBody));
      currentBody = [];
    }
    currentBody.push(line);
  }

  if (currentBody.length > 0 || bodyLines.length === 0) {
    messages.push(compose(currentBody));
  }

  return messages;
}
```

If a single provider URL line exceeds the Telegram length limit by itself, keep it intact and allow that one message to exceed the helper threshold; do not truncate URLs.

**Step 4: Implement movie text output**

Replace `formatMovieResult` in both formatter files with text-only output:

```ts
function formatMovieResult(result: Extract<PublicSearchResult, { type: 'movie' }>, handles: PublicBotHandles) {
  const headerLines = ['🎬 Movie', formatTitle(result.title, result.year)];
  const bodyLines = ['🔗 Download Links:', ...result.providers.map(formatProviderLine)];
  const footerLines = [...originalPostSection(result.channelPostUrl), ...formatHandles(handles).split('\n')];

  return splitTextSections(headerLines, bodyLines, footerLines).map((text) => ({ text }));
}
```

**Step 5: Remove now-unused movie inline helpers**

If `originalPostButtonRows`, `providerButtons`, or movie-specific button constants are unused after this task, remove them. If season details still use provider buttons before Task 3, leave shared helpers in place until Task 3.

**Step 6: Run focused tests**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts
```

Expected: pass.

**Step 7: Commit Task 2**

Run:

```bash
git add src/public-search/bot/formatter.ts apps/public-search-bot/src/bot/formatter.ts tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts
git commit -m "fix: render movie links in public bot text"
```

Do not stage `apps/public-search-bot/.env.example`.

---

### Task 3: Render Season Detail Download Links In Text

**Files:**
- Modify: `src/public-search/bot/formatter.ts`
- Modify: `apps/public-search-bot/src/bot/formatter.ts`
- Modify: `tests/public-search/public-search.formatter.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.formatter.test.ts`

**Step 1: Update season detail tests**

In both formatter test files, update `formats season details with provider buttons grouped by episode`.

Expected text:

```ts
[
  '📺 Breaking Bad (2008)',
  '📂 Season 1',
  '',
  '🎞 Episode 1',
  '🔗 Download Links:',
  '📁 MixDrop HD - https://providers.example/breaking-bad-s1e1-hd',
  '📁 FileMoon 4K - https://providers.example/breaking-bad-s1e1-4k',
  '',
  '🎞 Episode 2',
  '🔗 Download Links:',
  '📁 StreamTape HD - https://providers.example/breaking-bad-s1e2-hd',
  '',
  '📌 Original Post:',
  'https://t.me/infinitylinks65/301',
  '',
  '📢 Channel: @infinitylinks65',
  '👥 Group: @infinitylinks69'
].join('\n')
```

Expected reply markup:

```ts
expect(messages[0].replyMarkup).toBeUndefined();
```

Update `formats season details without an Original Post button when channel post url is missing` so it expects:

- Provider line in text.
- No `📌 Original Post:` in text.
- `replyMarkup` undefined.

Update repeated-provider and split tests so they inspect text instead of inline keyboard rows.

**Step 2: Add explicit split tests for long season text**

In both formatter test files, keep or add coverage that proves:

```ts
expect(messages.length).toBeGreaterThan(1);
expect(messages.every((message) => message.text.length <= MAX_FORMATTED_MESSAGE_LENGTH)).toBe(true);
expect(messages.every((message) => message.replyMarkup === undefined)).toBe(true);
```

For a long season with many episodes, assert a late episode still has its own heading and matching provider line:

```ts
const episode260Message = messages.find((message) => message.text.includes('🎞 Episode 260'));
expect(episode260Message?.text).toContain('📁 Host HD - https://providers.example/long-show-s1e260');
```

For one episode with many providers, assert every split message containing provider lines also contains that episode heading:

```ts
for (const message of messages) {
  if (message.text.includes('https://providers.example/big-episode')) {
    expect(message.text).toContain('🎞 Episode 1');
  }
}
```

**Step 3: Run focused tests and confirm failure**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts
```

Expected: fail because season details still use inline provider buttons.

**Step 4: Implement season text output**

In both formatter files, replace `formatSeasonDetails` with text-only output.

Use this shape:

```ts
export function formatSeasonDetails(details: PublicSeasonDetails, handles: PublicBotHandles): PublicBotMessage[] {
  const headerLines = [`📺 ${formatTitle(details.showTitle, details.showYear)}`, `📂 Season ${details.seasonNumber}`];
  const footerLines = [...originalPostSection(details.channelPostUrl), ...formatHandles(handles).split('\n')];
  const chunks = splitSeasonEpisodeSections(details.episodes, headerLines, footerLines);

  return chunks.map((text) => ({ text }));
}
```

Add a helper that emits episode sections:

```ts
function buildEpisodeLines(episode: PublicSeasonDetails['episodes'][number]) {
  return [
    `🎞 Episode ${episode.episodeNumber}`,
    '🔗 Download Links:',
    ...episode.providers.map(formatProviderLine)
  ];
}
```

Add a splitter that keeps episode headings with provider lines:

```ts
function splitSeasonEpisodeSections(
  episodes: PublicSeasonDetails['episodes'],
  headerLines: string[],
  footerLines: string[]
) {
  const messages: string[] = [];
  let currentLines: string[] = [];

  const compose = (lines: string[]) => [headerLines.join('\n'), lines.join('\n\n'), footerLines.join('\n')]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');

  for (const episode of episodes) {
    const episodeHeader = [`🎞 Episode ${episode.episodeNumber}`, '🔗 Download Links:'];
    let episodeLines = [...episodeHeader];

    for (const provider of episode.providers) {
      const nextEpisodeLines = [...episodeLines, formatProviderLine(provider)];
      const candidateLines = [...currentLines, nextEpisodeLines.join('\n')];

      if (currentLines.length > 0 && compose(candidateLines).length > MAX_FORMATTED_MESSAGE_LENGTH) {
        messages.push(compose(currentLines));
        currentLines = [];
        episodeLines = [...episodeHeader, formatProviderLine(provider)];
        continue;
      }

      if (episodeLines.length > episodeHeader.length && compose([nextEpisodeLines.join('\n')]).length > MAX_FORMATTED_MESSAGE_LENGTH) {
        if (currentLines.length > 0) {
          messages.push(compose(currentLines));
          currentLines = [];
        }
        messages.push(compose([episodeLines.join('\n')]));
        episodeLines = [...episodeHeader, formatProviderLine(provider)];
        continue;
      }

      episodeLines = nextEpisodeLines;
    }

    currentLines.push(episodeLines.join('\n'));
  }

  if (currentLines.length > 0) {
    messages.push(compose(currentLines));
  }

  return messages;
}
```

Adjust this helper as needed to satisfy tests, but keep these invariants:

- No `replyMarkup` from season details.
- Every provider remains under the right episode heading.
- No normal split message exceeds `MAX_FORMATTED_MESSAGE_LENGTH`.
- Long single provider URLs are not truncated.

**Step 5: Remove unused inline provider helpers and constants**

After movie and season details are text-only, remove unused items from both formatter files:

- `MOVIE_PROVIDER_BUTTONS_PER_ROW`
- `SEASON_PROVIDER_BUTTONS_PER_ROW`
- `providerButtons`
- `originalPostButtonRows`
- `handleButtonRows`
- `handleUrl`
- `countFittingRows`
- `composeSeasonDetailsText`

Keep helpers needed for TV season button splitting:

- `TV_SEASON_BUTTONS_PER_ROW`
- `splitKeyboardRows`
- `chunkButtons`
- `toReplyMarkup`
- `exceedsMessageLimits` if still used by `splitKeyboardRows`
- `countKeyboardButtons` if still used by `exceedsMessageLimits`

**Step 6: Run focused tests**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts
```

Expected: pass.

**Step 7: Commit Task 3**

Run:

```bash
git add src/public-search/bot/formatter.ts apps/public-search-bot/src/bot/formatter.ts tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts
git commit -m "fix: render season links in public bot text"
```

Do not stage `apps/public-search-bot/.env.example`.

---

### Task 4: Full Regression And Review

**Files:**
- No code files expected unless review finds an issue.

**Step 1: Run full tests**

Run:

```bash
npm.cmd test
```

Expected: all tests pass.

**Step 2: Run production build**

Run:

```bash
npm.cmd run build
```

Expected: TypeScript checks and Vite build pass.

**Step 3: Inspect working tree**

Run:

```bash
git status --short
```

Expected: only the pre-existing `D apps/public-search-bot/.env.example` may remain unstaged.

**Step 4: Request code review**

Use the requesting-code-review skill or a fresh reviewer subagent. Ask the reviewer to inspect the implementation range after this plan commit and verify:

- Only TV season selection uses inline buttons.
- Movie and season detail provider links are in text under `🔗 Download Links:`.
- Movie and season detail messages have no `replyMarkup`.
- Start, join-required, no-results, movie, and season detail messages have no channel/group inline buttons.
- TV search result messages still have season callback buttons and no channel/group buttons.
- Original Post is text-only when present and omitted when missing.
- Long text results split without separating provider lines from labels or episodes.
- Both duplicated formatter files behave consistently.

**Step 5: Fix review findings if any**

For each real finding:

1. Add or adjust a failing test.
2. Implement the minimal fix in both formatter copies if behavior is shared.
3. Run focused formatter tests.
4. Commit the fix.

**Step 6: Final verification**

Run again:

```bash
npm.cmd test
npm.cmd run build
```

Expected: both pass before merging or offering branch completion options.

# Public Search Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a VPS-hosted Telegram public search bot, plus a local one-click InfinityLinks sync action, so channel members can search movies and TV shows and receive active provider URL buttons.

**Architecture:** Keep the existing InfinityLinks admin app local. Add a local public-catalog export and sync endpoint under the current Express app, then add a separate `src/public-search` VPS service with its own config, SQLite database, protected sync API, Telegram bot runtime, membership gate, search, callbacks, and rate limiting.

**Tech Stack:** TypeScript, Node.js, Express, React, Vite, SQLite via `better-sqlite3`, Zod, Vitest, Telegram Bot API via `fetch`.

---

## Ground Rules

- Do not expose the existing admin UI publicly.
- Do not add a Telegram bot framework unless a task explicitly updates this plan first. Use `fetch` and small local modules.
- Store only active public-search links on the VPS.
- Keep the public bot token separate from the existing channel-posting token.
- Use TDD: write each failing test first, run it, implement the minimum, run it again, then commit.
- Use these verification commands unless a task says otherwise:
  - `npm.cmd test -- <test-file>`
  - `npm.cmd run build`
  - `npm.cmd test`

## Task 1: Add Local Public Search Config

**Files:**
- Modify: `src/server/config.ts`
- Modify: `.env.example`
- Test: `tests/server/config.test.ts`

**Step 1: Write the failing config test**

Add a test proving optional public search sync config is parsed without breaking existing local setup:

```ts
it('accepts optional public search sync configuration', () => {
  expect(
    loadConfig({
      TMDB_API_KEY: 'tmdb-key',
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      TELEGRAM_CHANNEL_ID: '@channel',
      PUBLIC_SEARCH_SYNC_URL: 'https://search.example.com/api/sync',
      PUBLIC_SEARCH_SYNC_TOKEN: 'sync-token',
      PUBLIC_SEARCH_CHANNEL_HANDLE: '@infinitylinks65',
      PUBLIC_SEARCH_GROUP_HANDLE: '@infinitylinks69'
    })
  ).toMatchObject({
    publicSearchSyncUrl: 'https://search.example.com/api/sync',
    publicSearchSyncToken: 'sync-token',
    publicSearchChannelHandle: '@infinitylinks65',
    publicSearchGroupHandle: '@infinitylinks69'
  });
});
```

Also add a test that an empty optional value becomes `undefined`, not an error.

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/server/config.test.ts`

Expected: FAIL because `AppConfig` does not include public search fields.

**Step 3: Implement config parsing**

In `src/server/config.ts`, extend `EnvSchema` with optional trimmed fields:

```ts
const OptionalTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional()
);
```

Add:

```ts
PUBLIC_SEARCH_SYNC_URL: OptionalTrimmedString,
PUBLIC_SEARCH_SYNC_TOKEN: OptionalTrimmedString,
PUBLIC_SEARCH_CHANNEL_HANDLE: OptionalTrimmedString.default('@infinitylinks65'),
PUBLIC_SEARCH_GROUP_HANDLE: OptionalTrimmedString.default('@infinitylinks69')
```

Extend `AppConfig` and `loadConfig` with camelCase fields.

Update `.env.example`:

```env
PUBLIC_SEARCH_SYNC_URL=https://your-vps.example.com/api/sync
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_secret_sync_token
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
```

**Step 4: Run the test to verify it passes**

Run: `npm.cmd test -- tests/server/config.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/config.ts .env.example tests/server/config.test.ts
git commit -m "feat: add public search sync config"
```

## Task 2: Build Local Public Catalog Export

**Files:**
- Create: `src/server/public-search/catalog.ts`
- Test: `tests/public-search/public-search.catalog.test.ts`

**Step 1: Write the failing catalog tests**

Create tests that seed an in-memory migrated database and call `buildPublicSearchCatalog(db, { channelHandle: '@infinitylinks65' })`.

Cover:

- Active movie links are included.
- Inactive movie links are excluded.
- Active episode links stay attached to the correct TV show, season, and episode.
- Episodes without active links are excluded.
- Channel post URLs use `https://t.me/infinitylinks65/<messageId>` when a Telegram message ID exists.

Example shape:

```ts
expect(catalog.movies).toEqual([
  {
    id: 1,
    title: 'Inception',
    year: 2010,
    telegramMessageId: 123,
    channelPostUrl: 'https://t.me/infinitylinks65/123',
    providers: [
      {
        providerName: 'MixDrop',
        quality: 'HD',
        url: 'https://mixdrop.example/movie',
        sortOrder: 1
      }
    ]
  }
]);
```

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/public-search/public-search.catalog.test.ts`

Expected: FAIL because the catalog module does not exist.

**Step 3: Implement the catalog builder**

Define exported types:

```ts
export type PublicSearchProvider = {
  providerName: string;
  quality: string;
  url: string;
  sortOrder: number;
};

export type PublicSearchMovie = {
  id: number;
  title: string;
  year?: number;
  telegramMessageId?: number;
  channelPostUrl?: string;
  providers: PublicSearchProvider[];
};

export type PublicSearchEpisode = {
  episodeNumber: number;
  providers: PublicSearchProvider[];
};

export type PublicSearchSeason = {
  id: number;
  seasonNumber: number;
  telegramMessageId?: number;
  channelPostUrl?: string;
  episodes: PublicSearchEpisode[];
};

export type PublicSearchTvShow = {
  id: number;
  title: string;
  year?: number;
  seasons: PublicSearchSeason[];
};

export type PublicSearchCatalog = {
  generatedAt: string;
  channelHandle: string;
  groupHandle: string;
  movies: PublicSearchMovie[];
  tvShows: PublicSearchTvShow[];
};
```

Implement SQL queries that fetch only `status = 'active'` links. Use structured grouping in TypeScript, not string parsing.

**Step 4: Run the test to verify it passes**

Run: `npm.cmd test -- tests/public-search/public-search.catalog.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/public-search/catalog.ts tests/public-search/public-search.catalog.test.ts
git commit -m "feat: export public search catalog"
```

## Task 3: Add Local Sync Service And API Route

**Files:**
- Create: `src/server/public-search/sync.service.ts`
- Create: `src/server/public-search/public-search.routes.ts`
- Modify: `src/server/app.ts`
- Test: `tests/public-search/public-search.sync-route.test.ts`

**Step 1: Write failing route tests**

Test the local route using `createApp({ db, config })`.

Cases:

- `POST /api/public-search/sync` returns 400 when `PUBLIC_SEARCH_SYNC_URL` or token is missing.
- With config present, it builds the catalog and sends it to the configured URL.
- The outbound request uses `Authorization: Bearer <token>`.
- A failed VPS response becomes a clear 502 response.

Example assertion:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  'https://search.example.com/api/sync',
  expect.objectContaining({
    method: 'POST',
    headers: expect.any(Headers),
    body: expect.stringContaining('"movies"')
  })
);
```

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/public-search/public-search.sync-route.test.ts`

Expected: FAIL because the route does not exist.

**Step 3: Implement the sync service**

In `sync.service.ts`, export:

```ts
export async function syncPublicSearchCatalog(
  db: AppDatabase,
  config: AppConfig,
  fetcher: typeof fetch = fetch
) {
  if (!config.publicSearchSyncUrl || !config.publicSearchSyncToken) {
    throw new PublicSearchSyncError(400, 'Public search sync is not configured');
  }

  const catalog = buildPublicSearchCatalog(db, {
    channelHandle: config.publicSearchChannelHandle,
    groupHandle: config.publicSearchGroupHandle
  });

  const response = await fetcher(config.publicSearchSyncUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.publicSearchSyncToken}`
    },
    body: JSON.stringify(catalog)
  });

  if (!response.ok) {
    throw new PublicSearchSyncError(502, 'Public search sync failed');
  }

  return {
    syncedAt: new Date().toISOString(),
    movies: catalog.movies.length,
    tvShows: catalog.tvShows.length
  };
}
```

Use a custom error with `statusCode`, matching the existing Express error handling pattern.

**Step 4: Implement the route**

Create `createPublicSearchRouter(db, config)` with:

```ts
router.post('/public-search/sync', async (_req, res, next) => {
  try {
    const result = await syncPublicSearchCatalog(db, config);
    res.json({ sync: result });
  } catch (error) {
    next(error);
  }
});
```

Mount it in `src/server/app.ts` under `/api` after media/TMDB routes.

**Step 5: Run the test to verify it passes**

Run: `npm.cmd test -- tests/public-search/public-search.sync-route.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/server/public-search/sync.service.ts src/server/public-search/public-search.routes.ts src/server/app.ts tests/public-search/public-search.sync-route.test.ts
git commit -m "feat: add local public search sync route"
```

## Task 4: Add Admin UI Sync Page

**Files:**
- Create: `src/client/pages/PublicSearchPage.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/Sidebar.tsx`
- Modify: `src/client/styles.css`
- Test: `tests/client/App.test.tsx`

**Step 1: Write failing UI tests**

Add tests that:

- The sidebar has a `Public Search` button.
- Clicking it renders a `Public Search` heading and sync button.
- Clicking the sync button posts to `/api/public-search/sync`.
- Success shows the returned counts.
- Failure shows the error message.

Example:

```ts
fireEvent.click(within(navigation).getByRole('button', { name: /^public search$/i }));
fireEvent.click(screen.getByRole('button', { name: /^sync public search$/i }));
await waitFor(() =>
  expect(fetchMock).toHaveBeenCalledWith('/api/public-search/sync', expect.objectContaining({ method: 'POST' }))
);
```

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/client/App.test.tsx`

Expected: FAIL because the page and navigation do not exist.

**Step 3: Implement the page**

Create `PublicSearchPage` with:

- Heading: `Public Search`
- Short status panel for last sync result.
- Primary button: `Sync Public Search`
- Loading state label: `Syncing...`
- Error rendering using existing `apiJson`.

Use the existing toast provider if convenient; keep the page usable without a toast.

**Step 4: Wire navigation**

In `Sidebar.tsx`:

- Add `Search` icon from `lucide-react`.
- Extend `PageKey` with `'public-search'`.
- Add navigation item `{ key: 'public-search', label: 'Public Search', icon: Search }`.

In `App.tsx`:

- Import and render `PublicSearchPage`.
- Clear selected movie/show/season state when navigating to `public-search`.

**Step 5: Add minimal CSS**

Use existing page/card/button classes where possible. Add only small layout rules if required, such as `.sync-panel`.

**Step 6: Run the test to verify it passes**

Run: `npm.cmd test -- tests/client/App.test.tsx`

Expected: PASS.

**Step 7: Commit**

```bash
git add src/client/pages/PublicSearchPage.tsx src/client/App.tsx src/client/components/Sidebar.tsx src/client/styles.css tests/client/App.test.tsx
git commit -m "feat: add public search sync page"
```

## Task 5: Add VPS Service Config And Database

**Files:**
- Create: `src/public-search/config.ts`
- Create: `src/public-search/db/database.ts`
- Create: `src/public-search/db/migrate.ts`
- Create: `src/public-search/db/schema.sql`
- Create: `tests/public-search/public-search.config.test.ts`
- Create: `tests/public-search/public-search.db.test.ts`

**Step 1: Write failing config tests**

Cover:

- Required `PUBLIC_BOT_TOKEN`.
- Required `PUBLIC_SEARCH_SYNC_TOKEN`.
- Default channel handle `@infinitylinks65`.
- Default group handle `@infinitylinks69`.
- Default database path `./data/public-search.sqlite`.
- Default port `3001`.

**Step 2: Write failing database tests**

Assert migration creates:

- `public_movies`
- `public_movie_providers`
- `public_tv_shows`
- `public_seasons`
- `public_episodes`
- `public_episode_providers`
- `public_sync_state`

Also assert foreign key cascades delete child rows.

**Step 3: Run tests to verify they fail**

Run: `npm.cmd test -- tests/public-search/public-search.config.test.ts tests/public-search/public-search.db.test.ts`

Expected: FAIL because modules do not exist.

**Step 4: Implement config and DB**

`config.ts` exports `loadPublicSearchConfig(env)`.

`schema.sql` defines normalized tables with local IDs from the synced catalog:

```sql
CREATE TABLE IF NOT EXISTS public_movies (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER,
  telegram_message_id INTEGER,
  channel_post_url TEXT
);
```

Use child tables for provider buttons. Enable indexes on searchable titles and parent IDs.

`database.ts` mirrors the existing `createDatabase` helper.

`migrate.ts` mirrors the existing server migrator but resolves `src/public-search/db/schema.sql`.

**Step 5: Run tests to verify they pass**

Run: `npm.cmd test -- tests/public-search/public-search.config.test.ts tests/public-search/public-search.db.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/public-search/config.ts src/public-search/db/database.ts src/public-search/db/migrate.ts src/public-search/db/schema.sql tests/public-search/public-search.config.test.ts tests/public-search/public-search.db.test.ts
git commit -m "feat: add public search service database"
```

## Task 6: Implement VPS Catalog Validation And Sync Endpoint

**Files:**
- Create: `src/public-search/catalog.schema.ts`
- Create: `src/public-search/catalog.repository.ts`
- Create: `src/public-search/sync.routes.ts`
- Create: `src/public-search/app.ts`
- Test: `tests/public-search/public-search.sync-endpoint.test.ts`

**Step 1: Write failing endpoint tests**

Use `supertest` with `createPublicSearchApp({ db, config })`.

Cover:

- Missing token returns 401.
- Wrong token returns 401.
- Invalid payload returns 400 and preserves old data.
- Valid payload replaces old catalog transactionally.
- Sync records `last_successful_sync_at`.

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/public-search/public-search.sync-endpoint.test.ts`

Expected: FAIL because app and routes do not exist.

**Step 3: Implement catalog schema**

Use Zod to validate the same catalog shape exported by the local app:

```ts
export const PublicSearchCatalogSchema = z.object({
  generatedAt: z.string().datetime(),
  channelHandle: z.string().trim().min(1),
  groupHandle: z.string().trim().min(1),
  movies: PublicSearchMovieSchema.array(),
  tvShows: PublicSearchTvShowSchema.array()
}).strict();
```

Provider URLs use `z.string().url()`. IDs and sort orders are positive integers.

**Step 4: Implement transactional replacement**

`replacePublicCatalog(db, catalog)`:

- Deletes existing rows in child-to-parent order.
- Inserts movies and providers.
- Inserts TV shows, seasons, episodes, and episode providers.
- Upserts one `public_sync_state` row.
- Runs all work in `db.transaction`.

**Step 5: Implement sync route and app**

`POST /api/sync`:

- Reads `Authorization: Bearer <token>`.
- Uses `express.json({ limit: '5mb' })`.
- Validates payload.
- Calls `replacePublicCatalog`.
- Responds with counts.

**Step 6: Run the test to verify it passes**

Run: `npm.cmd test -- tests/public-search/public-search.sync-endpoint.test.ts`

Expected: PASS.

**Step 7: Commit**

```bash
git add src/public-search/catalog.schema.ts src/public-search/catalog.repository.ts src/public-search/sync.routes.ts src/public-search/app.ts tests/public-search/public-search.sync-endpoint.test.ts
git commit -m "feat: add public search sync endpoint"
```

## Task 7: Implement VPS Search Repository

**Files:**
- Create: `src/public-search/search.repository.ts`
- Test: `tests/public-search/public-search.repository.test.ts`

**Step 1: Write failing search tests**

Seed `public_*` tables and test:

- Case-insensitive partial movie search.
- Case-insensitive partial TV search.
- Exact title matches rank before prefix matches.
- Prefix matches rank before loose substring matches.
- Results are limited to 10.
- Movie results include active providers.
- TV results include seasons that have episodes/providers.

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/public-search/public-search.repository.test.ts`

Expected: FAIL because repository does not exist.

**Step 3: Implement search**

Export:

```ts
export type PublicSearchResult =
  | { type: 'movie'; id: number; title: string; year?: number; providers: PublicProvider[] }
  | { type: 'tv'; id: number; title: string; year?: number; seasons: PublicSeasonSummary[] };

export function searchPublicCatalog(db: AppDatabase, query: string, limit = 10): PublicSearchResult[];
export function getPublicSeasonDetails(db: AppDatabase, seasonId: number): PublicSeasonDetails | undefined;
export function hasPublicCatalog(db: AppDatabase): boolean;
```

Normalize query with trim/lowercase. Use SQL `LOWER(title) LIKE ?`, then sort by computed rank:

- 0: exact match.
- 1: prefix match.
- 2: substring match.
- Tie-break by title, year, type.

**Step 4: Run the test to verify it passes**

Run: `npm.cmd test -- tests/public-search/public-search.repository.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/public-search/search.repository.ts tests/public-search/public-search.repository.test.ts
git commit -m "feat: search public catalog"
```

## Task 8: Add Telegram API Client

**Files:**
- Create: `src/public-search/telegram.client.ts`
- Test: `tests/public-search/public-search.telegram-client.test.ts`

**Step 1: Write failing client tests**

Mock `fetch` and cover:

- `sendMessage` sends `chat_id`, `text`, and `reply_markup`.
- `answerCallbackQuery` sends callback query ID.
- `getUpdates` passes offset and timeout.
- `getChatMember` returns membership status.
- Telegram 429 throws an error with `retryAfter`.
- Invalid JSON returns a clear error.

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/public-search/public-search.telegram-client.test.ts`

Expected: FAIL because client does not exist.

**Step 3: Implement the client**

Create `createPublicTelegramClient({ botToken }, fetcher = fetch)` with methods:

```ts
getUpdates(input: { offset?: number; timeout?: number }): Promise<TelegramUpdate[]>
sendMessage(input: { chatId: number; text: string; replyMarkup?: InlineKeyboardMarkup }): Promise<void>
answerCallbackQuery(input: { callbackQueryId: string; text?: string }): Promise<void>
getChatMember(input: { chatId: string; userId: number }): Promise<TelegramChatMember>
```

Implement `TelegramRateLimitError` like the existing server Telegram client.

**Step 4: Run the test to verify it passes**

Run: `npm.cmd test -- tests/public-search/public-search.telegram-client.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/public-search/telegram.client.ts tests/public-search/public-search.telegram-client.test.ts
git commit -m "feat: add public bot telegram client"
```

## Task 9: Add Bot Formatting And Callback Data

**Files:**
- Create: `src/public-search/bot/callback-data.ts`
- Create: `src/public-search/bot/formatter.ts`
- Test: `tests/public-search/public-search.formatter.test.ts`

**Step 1: Write failing formatter tests**

Cover:

- `/start` text includes usage plus `Channel: @infinitylinks65` and `Group: @infinitylinks69`.
- Not-joined text includes handles.
- Movie result creates provider URL buttons with labels like `MixDrop HD`.
- TV result creates season callback buttons.
- Season detail text groups provider buttons under the correct episode.
- Long season details split into multiple messages.

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/public-search/public-search.formatter.test.ts`

Expected: FAIL because formatter does not exist.

**Step 3: Implement callback data helpers**

Use compact callback data:

```ts
export function encodeSeasonCallback(seasonId: number) {
  return `season:${seasonId}`;
}

export function decodeSeasonCallback(value: string) {
  const match = /^season:(\d+)$/.exec(value);
  return match ? Number(match[1]) : undefined;
}
```

**Step 4: Implement formatter**

Export:

```ts
formatStartMessage(handles)
formatJoinRequiredMessage(handles)
formatNoResultsMessage(handles)
formatUnavailableMessage()
formatSearchResults(results, handles)
formatSeasonDetails(details, handles)
```

Use Telegram inline keyboard JSON:

```ts
{ inline_keyboard: [[{ text: 'MixDrop HD', url: 'https://example.com' }]] }
```

For season callback buttons:

```ts
{ text: 'Season 1', callback_data: 'season:123' }
```

Keep text display as handles, not `https://t.me` URLs.

**Step 5: Run the test to verify it passes**

Run: `npm.cmd test -- tests/public-search/public-search.formatter.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/public-search/bot/callback-data.ts src/public-search/bot/formatter.ts tests/public-search/public-search.formatter.test.ts
git commit -m "feat: format public search bot replies"
```

## Task 10: Add Rate Limiter And Telegram Reply Queue

**Files:**
- Create: `src/public-search/rate-limit.ts`
- Create: `src/public-search/telegram.reply-queue.ts`
- Test: `tests/public-search/public-search.rate-limit.test.ts`
- Test: `tests/public-search/public-search.reply-queue.test.ts`

**Step 1: Write failing rate limit tests**

Cover:

- A user can make the configured number of interactions per window.
- The next interaction is blocked.
- The same user is allowed again after the window expires.
- Different users do not block each other.

**Step 2: Write failing reply queue tests**

Cover:

- Messages are sent in order.
- A Telegram 429 retry delay pauses the queue before retrying.
- Non-rate-limit errors are surfaced and do not block future messages forever.

Use fake timers.

**Step 3: Run tests to verify they fail**

Run: `npm.cmd test -- tests/public-search/public-search.rate-limit.test.ts tests/public-search/public-search.reply-queue.test.ts`

Expected: FAIL because modules do not exist.

**Step 4: Implement the rate limiter**

Export:

```ts
export function createFixedWindowRateLimiter(options: { limit: number; windowMs: number; now?: () => number }) {
  return {
    check(key: string): { allowed: true } | { allowed: false; retryAfterMs: number }
  };
}
```

**Step 5: Implement the reply queue**

Export:

```ts
export function createTelegramReplyQueue(client: Pick<PublicTelegramClient, 'sendMessage' | 'answerCallbackQuery'>) {
  return {
    enqueueSendMessage(input: SendMessageInput): Promise<void>,
    enqueueAnswerCallbackQuery(input: AnswerCallbackQueryInput): Promise<void>,
    idle(): Promise<void>
  };
}
```

The queue processes one item at a time and respects `TelegramRateLimitError.retryAfter`.

**Step 6: Run tests to verify they pass**

Run: `npm.cmd test -- tests/public-search/public-search.rate-limit.test.ts tests/public-search/public-search.reply-queue.test.ts`

Expected: PASS.

**Step 7: Commit**

```bash
git add src/public-search/rate-limit.ts src/public-search/telegram.reply-queue.ts tests/public-search/public-search.rate-limit.test.ts tests/public-search/public-search.reply-queue.test.ts
git commit -m "feat: rate limit public bot replies"
```

## Task 11: Implement Bot Handlers

**Files:**
- Create: `src/public-search/bot/handlers.ts`
- Test: `tests/public-search/public-search.handlers.test.ts`

**Step 1: Write failing handler tests**

Use dependency injection for DB, Telegram client, reply queue, and rate limiter.

Cover:

- `/start` replies with usage without requiring membership.
- `/search` with no query replies with usage.
- `/search inception` blocks a user whose channel membership status is `left`.
- `/search inception` returns movie provider buttons for a member.
- `/search breaking` returns TV season callback buttons for a member.
- Search is limited to 10 results.
- Missing catalog returns the unavailable message.
- Invalid callback data is answered without leaking links.
- Season callback checks membership again.
- Season callback returns episode-specific provider buttons.
- Per-user rate limit blocks spam with a wait message.

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/public-search/public-search.handlers.test.ts`

Expected: FAIL because handlers do not exist.

**Step 3: Implement membership helper**

Treat these statuses as joined:

```ts
const JOINED_STATUSES = new Set(['creator', 'administrator', 'member']);
```

Any `left`, `kicked`, missing status, or Telegram API failure blocks provider links. API failure returns a try-again-later message.

**Step 4: Implement message handling**

Export:

```ts
export async function handleTelegramUpdate(deps: HandlerDeps, update: TelegramUpdate): Promise<void>
```

Message flow:

- Ignore non-message/non-callback updates.
- `/start`: send start message.
- `/search`: rate-limit, membership-check, search repository, format results.
- Unknown command: send short usage text.

Callback flow:

- Rate-limit.
- Decode `season:<id>`.
- Membership-check.
- Load season details.
- Format and send one or more messages.
- Answer callback query.

**Step 5: Run the test to verify it passes**

Run: `npm.cmd test -- tests/public-search/public-search.handlers.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/public-search/bot/handlers.ts tests/public-search/public-search.handlers.test.ts
git commit -m "feat: handle public search bot commands"
```

## Task 12: Add Polling Runtime And Build Scripts

**Files:**
- Create: `src/public-search/poller.ts`
- Create: `src/public-search/index.ts`
- Create: `tsconfig.public-search.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/public-search/public-search.poller.test.ts`

**Step 1: Write failing poller tests**

Cover:

- Poller calls `getUpdates` with the next offset.
- Each update is passed to `handleTelegramUpdate`.
- Handler errors are caught so polling continues.

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/public-search/public-search.poller.test.ts`

Expected: FAIL because poller does not exist.

**Step 3: Implement the poller**

Export:

```ts
export async function pollOnce(state: PollState, client: PublicTelegramClient, handleUpdate: UpdateHandler) {
  const updates = await client.getUpdates({ offset: state.nextOffset, timeout: 30 });
  for (const update of updates) {
    await handleUpdate(update);
    state.nextOffset = update.update_id + 1;
  }
}
```

`index.ts`:

- Loads `.env`.
- Loads public search config.
- Opens/migrates public search database.
- Creates Express sync app.
- Starts Telegram long polling loop.
- Listens on `PUBLIC_SEARCH_PORT`.

**Step 4: Add scripts**

In `package.json`:

```json
"public-search:dev": "tsx watch src/public-search/index.ts",
"public-search:start": "node dist/public-search/index.js",
"build:public-search": "tsc -p tsconfig.public-search.json"
```

Update `build` to run the public-search TypeScript build too:

```json
"build": "tsc --noEmit && tsc -p tsconfig.server.json && tsc -p tsconfig.public-search.json && vite build"
```

`tsconfig.public-search.json` should compile `src/public-search/**/*.ts` to `dist/public-search`.

**Step 5: Run tests and build**

Run: `npm.cmd test -- tests/public-search/public-search.poller.test.ts`

Expected: PASS.

Run: `npm.cmd run build`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/public-search/poller.ts src/public-search/index.ts tsconfig.public-search.json package.json package-lock.json tests/public-search/public-search.poller.test.ts
git commit -m "feat: add public search bot runtime"
```

## Task 13: Add Sync Endpoint Rate Limiting

**Files:**
- Modify: `src/public-search/sync.routes.ts`
- Modify: `src/public-search/rate-limit.ts`
- Test: `tests/public-search/public-search.sync-endpoint.test.ts`

**Step 1: Write the failing rate limit test**

Add a test that repeated valid sync requests from the same IP exceed the sync endpoint limit and return 429.

Example:

```ts
for (let index = 0; index < 5; index += 1) {
  await request(app).post('/api/sync').set('Authorization', 'Bearer token').send(validCatalog).expect(200);
}

await request(app).post('/api/sync').set('Authorization', 'Bearer token').send(validCatalog).expect(429);
```

**Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/public-search/public-search.sync-endpoint.test.ts`

Expected: FAIL because sync endpoint rate limiting is not active.

**Step 3: Implement sync rate limiting**

Use `createFixedWindowRateLimiter({ limit: 5, windowMs: 60_000 })` inside `createSyncRouter`.

Key by `req.ip` plus token fingerprint:

```ts
const key = `${req.ip}:${token.slice(0, 8)}`;
```

Return:

```json
{ "error": "Too many sync attempts. Please wait and try again." }
```

**Step 4: Run the test to verify it passes**

Run: `npm.cmd test -- tests/public-search/public-search.sync-endpoint.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/public-search/sync.routes.ts src/public-search/rate-limit.ts tests/public-search/public-search.sync-endpoint.test.ts
git commit -m "feat: rate limit public search sync"
```

## Task 14: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Create: `.env.public-search.example`
- Test: no automated test required

**Step 1: Update README**

Add a `Public Search Bot` section with:

- Local admin remains private.
- VPS service uses `npm.cmd run public-search:dev` for development.
- VPS service uses `npm.cmd run build:public-search` and `npm.cmd run public-search:start` for production build smoke.
- Public bot must be admin in `@infinitylinks65`.
- `/start` and `/search <query>` behavior.
- Search results require channel membership.
- Provider links are active-link-only.
- Sync button lives in the admin UI under `Public Search`.

**Step 2: Add public-search env example**

Create `.env.public-search.example`:

```env
PUBLIC_BOT_TOKEN=replace_with_public_search_bot_token
PUBLIC_SEARCH_SYNC_TOKEN=replace_with_secret_sync_token
PUBLIC_SEARCH_CHANNEL_HANDLE=@infinitylinks65
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=./data/public-search.sqlite
PUBLIC_SEARCH_PORT=3001
```

Confirm `.env.example` contains local sync env vars from Task 1.

**Step 3: Review docs**

Read the README section and examples for contradictions with the design spec.

**Step 4: Commit**

```bash
git add README.md .env.example .env.public-search.example
git commit -m "docs: document public search bot setup"
```

## Task 15: Final Verification

**Files:**
- No planned source edits

**Step 1: Run focused public-search tests**

Run: `npm.cmd test -- tests/public-search`

Expected: PASS.

**Step 2: Run all tests**

Run: `npm.cmd test`

Expected: PASS.

**Step 3: Run build**

Run: `npm.cmd run build`

Expected: PASS.

**Step 4: Smoke the local admin app**

Run: `npm.cmd run db:migrate`

Expected: `Database migrated`.

Run: `npm.cmd run dev`

Expected: local app starts at `http://127.0.0.1:3000`.

Open the admin UI and verify:

- Sidebar includes `Public Search`.
- The page shows a sync button.
- With missing sync config, clicking sync shows a clear configuration error.

Stop the dev server after verification.

**Step 5: Smoke the public-search service locally**

Create a local `.env.public-search.local` or set equivalent environment values with dummy tokens and a temp database.

Run: `npm.cmd run public-search:dev`

Expected:

- Service starts on `PUBLIC_SEARCH_PORT`.
- Sync endpoint rejects missing token with 401.

Stop the service after verification.

**Step 6: Commit any verification doc updates**

If verification reveals README corrections, commit them:

```bash
git add README.md
git commit -m "docs: record public search verification notes"
```

## Deployment Notes

- VPS needs Node.js compatible with the current project.
- VPS service process should be managed by a process manager such as `pm2` or a systemd service.
- Put the VPS behind HTTPS before using real provider URLs in sync.
- Add the public search bot as admin to `@infinitylinks65`.
- Keep the existing channel-posting bot local unless intentionally replacing it.
- Back up the VPS public-search SQLite database carefully because it contains active provider URLs.

# Public Search Repost Window Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep TV seasons searchable in the public bot during the repost window while hiding the Original Post button until the replacement Telegram post exists.

**Architecture:** Change only the local catalog export rule for TV seasons: posted seasons with active episode links should export even when `telegram_message_id` is `NULL`. The existing public bot schema, repository, and formatter already support missing `channelPostUrl`; add contract tests so that behavior is protected.

**Tech Stack:** TypeScript, Express, better-sqlite3, Zod, Vitest, Supertest.

---

### Task 1: Export Posted TV Seasons Without A Telegram Message ID

**Files:**
- Modify: `src/server/public-search/catalog.ts`
- Modify: `tests/public-search/public-search.catalog.test.ts`

**Step 1: Write the failing catalog export test**

Add this test to `tests/public-search/public-search.catalog.test.ts` near the other TV catalog export tests:

```ts
it('exports posted TV seasons with active episode links while a repost has no message id', () => {
  const db = createMigratedDatabase();

  try {
    const show = db.prepare("INSERT INTO tv_shows (title, year, quality) VALUES ('Repost Show', 2026, 'HD')").run();
    const season = db
      .prepare(
        "INSERT INTO seasons (tv_show_id, season_number, telegram_message_id, post_status) VALUES (?, 1, NULL, 'posted')"
      )
      .run(show.lastInsertRowid);
    const episode = db.prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)').run(season.lastInsertRowid);

    db.prepare(
      `INSERT INTO episode_links (episode_id, provider_name, quality, status, url, sort_order)
       VALUES (?, 'Filekeeper', 'HD', 'active', 'https://filekeeper.example/repost-show-s1e1', 1)`
    ).run(episode.lastInsertRowid);

    const catalog = buildPublicSearchCatalog(db, {
      channelHandle: '@infinitylinks65',
      groupHandle: '@infinitylinks69',
      now: () => new Date('2026-05-24T00:00:00.000Z')
    });

    expect(catalog.tvShows).toEqual([
      {
        id: 1,
        title: 'Repost Show',
        year: 2026,
        seasons: [
          {
            id: 1,
            seasonNumber: 1,
            episodes: [
              {
                episodeNumber: 1,
                providers: [
                  {
                    providerName: 'Filekeeper',
                    quality: 'HD',
                    url: 'https://filekeeper.example/repost-show-s1e1',
                    sortOrder: 1
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
  } finally {
    db.close();
  }
});
```

This test must prove two things: the season remains exported, and `telegramMessageId` / `channelPostUrl` are omitted when the message ID is missing.

**Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.catalog.test.ts
```

Expected: fail because `catalog.tvShows` is empty for the new test.

**Step 3: Implement the minimal catalog query change**

In `src/server/public-search/catalog.ts`, inside `buildTvShows`, change the `WHERE` block from:

```sql
WHERE episode_links.status = 'active'
  AND seasons.post_status = 'posted'
  AND seasons.telegram_message_id IS NOT NULL
```

to:

```sql
WHERE episode_links.status = 'active'
  AND seasons.post_status = 'posted'
```

Do not change the movie query. Movies still require `movies.telegram_message_id IS NOT NULL`.

**Step 4: Update the existing exclusion test**

In `tests/public-search/public-search.catalog.test.ts`, the test named `excludes active links for movies and seasons that are not posted public Telegram content` currently treats a posted TV season with `telegram_message_id = NULL` as excluded. Update it so only pending/deleted seasons are excluded.

Keep the missing-message movie assertion as-is. For TV seasons, either remove `missingMessageSeason` from that test or change the final expectation to include only that posted missing-message season. Prefer removing `missingMessageSeason` from this exclusion test because Task 1's new test covers the desired repost-window behavior directly.

**Step 5: Run the focused catalog test**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.catalog.test.ts
```

Expected: pass.

**Step 6: Commit Task 1**

Run:

```bash
git add src/server/public-search/catalog.ts tests/public-search/public-search.catalog.test.ts
git commit -m "fix: keep reposting seasons in public search"
```

Do not stage `apps/public-search-bot/.env.example` if it is still deleted in the working tree.

---

### Task 2: Lock Public Bot No-Original-Post Behavior

**Files:**
- Modify: `tests/public-search/public-search.formatter.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.formatter.test.ts`
- Modify: `tests/public-search/public-search.sync-endpoint.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.sync-endpoint.test.ts`

**Step 1: Add formatter tests for season details without `channelPostUrl`**

In both formatter test files, add a test near the existing `formatSeasonDetails` tests:

```ts
it('formats season details without an Original Post button when channel post url is missing', () => {
  const details: PublicSeasonDetails = {
    id: 301,
    showTitle: 'Repost Show',
    showYear: 2026,
    seasonNumber: 1,
    episodes: [
      {
        episodeNumber: 1,
        providers: [
          {
            providerName: 'Filekeeper',
            quality: 'HD',
            url: 'https://filekeeper.example/repost-show-s1e1',
            sortOrder: 1
          }
        ]
      }
    ]
  };

  const messages = formatSeasonDetails(details, handles);

  expect(messages).toHaveLength(1);
  expect(messages[0].text).toContain('Repost Show (2026)');
  expect(messages[0].text).toContain('Season 1');
  expect(messages[0].text).toContain('Episode 1');
  expect(messages[0].replyMarkup?.inline_keyboard).toEqual([
    [{ text: 'E1 Filekeeper HD', url: 'https://filekeeper.example/repost-show-s1e1' }],
    handleButtonRow
  ]);
  expect(messages[0].replyMarkup?.inline_keyboard.flat()).not.toContainEqual(
    expect.objectContaining({ text: 'Original Post' })
  );
});
```

**Step 2: Add sync endpoint tests for missing season channel post fields**

In both sync endpoint test files, add a test after the successful sync test or near `validCatalog()` coverage:

```ts
it('accepts and stores TV seasons without channel post fields during repost windows', async () => {
  const db = createMigratedDatabase();

  try {
    const catalog = validCatalog();
    catalog.tvShows[0].seasons[0] = {
      id: 30,
      seasonNumber: 1,
      episodes: catalog.tvShows[0].seasons[0].episodes
    };

    const app = createPublicSearchApp({ db, config: createConfig() });

    await request(app).post('/api/sync').set('Authorization', 'Bearer sync-token').send(catalog).expect(200);

    expect(
      db.prepare('SELECT telegram_message_id, channel_post_url FROM public_seasons WHERE id = 30').get()
    ).toEqual({
      telegram_message_id: null,
      channel_post_url: null
    });
  } finally {
    db.close();
  }
});
```

If TypeScript infers `catalog.tvShows[0].seasons[0]` too narrowly because `validCatalog()` is not typed, add a local `const season = catalog.tvShows[0].seasons[0];` and rebuild the object with `episodes: season.episodes`.

**Step 3: Run focused public bot tests**

Run:

```bash
npm.cmd test -- tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts tests/public-search/public-search.sync-endpoint.test.ts apps/public-search-bot/tests/public-search.sync-endpoint.test.ts
```

Expected: pass. The formatter tests should pass without source changes if the current formatter already omits `Original Post` when `channelPostUrl` is absent.

**Step 4: Commit Task 2**

Run:

```bash
git add tests/public-search/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.formatter.test.ts tests/public-search/public-search.sync-endpoint.test.ts apps/public-search-bot/tests/public-search.sync-endpoint.test.ts
git commit -m "test: cover repost-window public bot results"
```

Do not stage `apps/public-search-bot/.env.example`.

---

### Task 3: Full Regression And Review

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

- TV seasons with active links remain searchable when `telegram_message_id` is `NULL`.
- Movies still require a Telegram message ID.
- No Original Post button is rendered when `channelPostUrl` is absent.
- The standalone public-search sync endpoint accepts and stores missing season channel post fields as `NULL`.

**Step 5: Fix review findings if any**

For each real finding:

1. Add or adjust the failing test.
2. Implement the minimal fix.
3. Run the focused test.
4. Commit the fix.

**Step 6: Final verification**

Run again:

```bash
npm.cmd test
npm.cmd run build
```

Expected: both pass before merging or offering branch completion options.

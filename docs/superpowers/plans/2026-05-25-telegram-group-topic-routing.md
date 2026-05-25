# Telegram Group Topic Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add media topic selection to the admin app and route new Telegram posts into the correct public group topic.

**Architecture:** Store a validated `topicKey` on movies and TV shows, map topic keys to Telegram group `message_thread_id` values in one backend module, and include the thread id only on send jobs. Public-search catalog post links will use the public group handle while the standalone public-search bot remains unchanged.

**Tech Stack:** TypeScript, React, Express, SQLite via `better-sqlite3`, Zod, Vitest, React Testing Library, Supertest.

---

## File Structure

- Create `src/server/media/topics.ts`: topic key enums, labels, defaults, and Telegram routing map.
- Modify `src/server/db/schema.sql`: add `topic_key` columns and constraints for new databases.
- Modify `src/server/db/migrate.ts`: add idempotent migration/backfill for existing databases.
- Modify `tests/server/db.test.ts`: verify schema columns and legacy backfills.
- Modify `src/server/media/media.schemas.ts`: validate `topicKey` on movie/TV inputs.
- Modify `src/server/media/media.repository.ts`: persist and return `topicKey`.
- Modify `src/server/media/media.service.ts`: include topic thread ids in new send payloads.
- Modify `tests/server/media.movies.test.ts`: cover topic defaults, valid topics, invalid topics, and send payload thread id.
- Modify `tests/server/media.tv.test.ts`: cover TV topic defaults, valid topics, invalid topics, and season send payload thread id.
- Modify `src/server/telegram/telegram.queue.ts`: type send payloads with optional `messageThreadId` and pass it through.
- Modify `src/server/telegram/telegram.client.ts`: send `message_thread_id` in `sendPhoto`.
- Modify `tests/server/telegram.queue.test.ts`: cover queue/client thread id behavior.
- Modify `src/client/pages/MovieForm.tsx`: add movie topic dropdown after Quality and submit `topicKey`.
- Modify `src/client/pages/TvShowForm.tsx`: add TV topic dropdown after Quality and submit `topicKey`.
- Modify `tests/client/App.test.tsx`: cover dropdown rendering and request payloads.
- Modify `src/server/public-search/catalog.ts`: build post URLs from `groupHandle`.
- Modify `tests/public-search/public-search.catalog.test.ts`: assert `https://t.me/infinitylinks69/<messageId>` links.
- Modify `.env.example` and `README.md`: document that `TELEGRAM_CHANNEL_ID` now points at the public group chat id.

---

### Task 1: Topic Constants And Database Migration

**Files:**
- Create: `src/server/media/topics.ts`
- Modify: `src/server/db/schema.sql`
- Modify: `src/server/db/migrate.ts`
- Test: `tests/server/db.test.ts`

- [ ] **Step 1: Write failing schema/default tests**

Add these tests to `tests/server/db.test.ts` inside `describe('database migration', () => { ... })` after the public sync state columns test:

```ts
  it('creates topic keys on movies and tv shows with media defaults', () => {
    const db = createDatabase(':memory:');
    migrate(db);

    const movieColumns = db.prepare('PRAGMA table_info(movies)').all() as Array<{ name: string }>;
    const tvColumns = db.prepare('PRAGMA table_info(tv_shows)').all() as Array<{ name: string }>;

    expect(movieColumns.map((column) => column.name)).toContain('topic_key');
    expect(tvColumns.map((column) => column.name)).toContain('topic_key');

    const movie = db.prepare("INSERT INTO movies (title, quality) VALUES ('Movie', 'HD')").run();
    const show = db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Show', 'HD')").run();

    expect(db.prepare('SELECT topic_key FROM movies WHERE id = ?').get(movie.lastInsertRowid)).toEqual({
      topic_key: 'FOREIGN_MOVIES'
    });
    expect(db.prepare('SELECT topic_key FROM tv_shows WHERE id = ?').get(show.lastInsertRowid)).toEqual({
      topic_key: 'FOREIGN_TV_SERIES'
    });

    expect(() => {
      db.prepare("INSERT INTO movies (title, quality, topic_key) VALUES ('Bad Movie', 'HD', 'FOREIGN_TV_SERIES')").run();
    }).toThrow();
    expect(() => {
      db.prepare("INSERT INTO tv_shows (title, quality, topic_key) VALUES ('Bad Show', 'HD', 'PINOY_MOVIES')").run();
    }).toThrow();

    db.close();
  });

  it('adds and backfills topic keys on existing movie and tv show tables', () => {
    const db = createDatabase(':memory:');
    db.exec(`
      CREATE TABLE movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        quality TEXT NOT NULL
      );
      CREATE TABLE tv_shows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        quality TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO movies (title, quality) VALUES ('Legacy Movie', 'HD')").run();
    db.prepare("INSERT INTO tv_shows (title, quality) VALUES ('Legacy Show', 'HD')").run();

    migrate(db);

    expect(db.prepare("SELECT topic_key FROM movies WHERE title = 'Legacy Movie'").get()).toEqual({
      topic_key: 'FOREIGN_MOVIES'
    });
    expect(db.prepare("SELECT topic_key FROM tv_shows WHERE title = 'Legacy Show'").get()).toEqual({
      topic_key: 'FOREIGN_TV_SERIES'
    });

    db.close();
  });
```

- [ ] **Step 2: Run the failing DB tests**

Run:

```powershell
npm.cmd test -- tests/server/db.test.ts
```

Expected: FAIL because `topic_key` does not exist and invalid topic keys are not constrained.

- [ ] **Step 3: Create topic constants**

Create `src/server/media/topics.ts`:

```ts
export const MOVIE_TOPIC_KEYS = ['FOREIGN_MOVIES', 'PINOY_MOVIES', 'ANIME', 'VIVAMAX'] as const;
export const TV_TOPIC_KEYS = ['FOREIGN_TV_SERIES', 'PINOY_TV_SERIES', 'ANIME', 'VIVAMAX'] as const;

export type MovieTopicKey = (typeof MOVIE_TOPIC_KEYS)[number];
export type TvTopicKey = (typeof TV_TOPIC_KEYS)[number];
export type MediaTopicKey = MovieTopicKey | TvTopicKey;

export const DEFAULT_MOVIE_TOPIC_KEY: MovieTopicKey = 'FOREIGN_MOVIES';
export const DEFAULT_TV_TOPIC_KEY: TvTopicKey = 'FOREIGN_TV_SERIES';

export const MOVIE_TOPIC_OPTIONS: Array<{ key: MovieTopicKey; label: string }> = [
  { key: 'FOREIGN_MOVIES', label: 'FOREIGN MOVIES' },
  { key: 'PINOY_MOVIES', label: 'PINOY MOVIES' },
  { key: 'ANIME', label: 'ANIME' },
  { key: 'VIVAMAX', label: 'VIVAMAX' }
];

export const TV_TOPIC_OPTIONS: Array<{ key: TvTopicKey; label: string }> = [
  { key: 'FOREIGN_TV_SERIES', label: 'FOREIGN TV SERIES' },
  { key: 'PINOY_TV_SERIES', label: 'PINOY TV SERIES' },
  { key: 'ANIME', label: 'ANIME' },
  { key: 'VIVAMAX', label: 'VIVAMAX' }
];

const TELEGRAM_GROUP_CHAT_ID = '-1003963665033';

const TOPIC_ROUTES: Record<MediaTopicKey, { chatId: string; messageThreadId: number }> = {
  FOREIGN_MOVIES: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 20 },
  PINOY_MOVIES: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 27 },
  ANIME: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 24 },
  VIVAMAX: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 29 },
  FOREIGN_TV_SERIES: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 22 },
  PINOY_TV_SERIES: { chatId: TELEGRAM_GROUP_CHAT_ID, messageThreadId: 28 }
};

export function getTopicRoute(topicKey: MediaTopicKey | string | undefined, mediaType: 'movie' | 'tv') {
  const fallbackTopicKey = mediaType === 'movie' ? DEFAULT_MOVIE_TOPIC_KEY : DEFAULT_TV_TOPIC_KEY;
  const route = TOPIC_ROUTES[(topicKey ?? fallbackTopicKey) as MediaTopicKey] ?? TOPIC_ROUTES[fallbackTopicKey];

  if (!route) {
    throw new Error(`Telegram topic route is not configured for ${topicKey ?? fallbackTopicKey}`);
  }

  return route;
}
```

- [ ] **Step 4: Update schema for new databases**

In `src/server/db/schema.sql`, add `topic_key` after `quality` in `movies`:

```sql
  quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
  topic_key TEXT NOT NULL DEFAULT 'FOREIGN_MOVIES' CHECK (topic_key IN ('FOREIGN_MOVIES', 'PINOY_MOVIES', 'ANIME', 'VIVAMAX')),
  telegram_message_id INTEGER,
```

Add `topic_key` after `quality` in `tv_shows`:

```sql
  quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
  topic_key TEXT NOT NULL DEFAULT 'FOREIGN_TV_SERIES' CHECK (topic_key IN ('FOREIGN_TV_SERIES', 'PINOY_TV_SERIES', 'ANIME', 'VIVAMAX')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

- [ ] **Step 5: Update migration for existing databases**

In `src/server/db/migrate.ts`, update `migrate()`:

```ts
export function migrate(db: AppDatabase) {
  const schema = fs.readFileSync(resolveSchemaPath(), 'utf8');
  db.exec(schema);
  ensureColumn(db, 'movies', 'topic_key', "TEXT NOT NULL DEFAULT 'FOREIGN_MOVIES' CHECK (topic_key IN ('FOREIGN_MOVIES', 'PINOY_MOVIES', 'ANIME', 'VIVAMAX'))");
  ensureColumn(db, 'tv_shows', 'topic_key', "TEXT NOT NULL DEFAULT 'FOREIGN_TV_SERIES' CHECK (topic_key IN ('FOREIGN_TV_SERIES', 'PINOY_TV_SERIES', 'ANIME', 'VIVAMAX'))");
  ensureColumn(db, 'seasons', 'needs_repost', 'INTEGER NOT NULL DEFAULT 0 CHECK (needs_repost IN (0, 1))');
  db.prepare("UPDATE movies SET topic_key = 'FOREIGN_MOVIES' WHERE topic_key IS NULL OR TRIM(topic_key) = ''").run();
  db.prepare("UPDATE tv_shows SET topic_key = 'FOREIGN_TV_SERIES' WHERE topic_key IS NULL OR TRIM(topic_key) = ''").run();
}
```

- [ ] **Step 6: Run DB tests**

Run:

```powershell
npm.cmd test -- tests/server/db.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/server/media/topics.ts src/server/db/schema.sql src/server/db/migrate.ts tests/server/db.test.ts
git commit -m "feat: add media topic schema"
```

---

### Task 2: Media API Topic Persistence And Validation

**Files:**
- Modify: `src/server/media/media.schemas.ts`
- Modify: `src/server/media/media.repository.ts`
- Test: `tests/server/media.movies.test.ts`
- Test: `tests/server/media.tv.test.ts`

- [ ] **Step 1: Write failing Movie API tests**

In `tests/server/media.movies.test.ts`, update the first create request to include:

```ts
        topicKey: 'PINOY_MOVIES',
```

Update the first response assertion with:

```ts
      topicKey: 'PINOY_MOVIES',
```

Add this test after `returns 400 JSON for invalid movie bodies`:

```ts
  it('defaults movie topic and rejects TV-only movie topics', async () => {
    const defaultResponse = await request(app())
      .post('/api/movies')
      .send({
        title: 'Default Topic Movie',
        quality: 'HD',
        description: '',
        links: []
      })
      .expect(201);

    expect(defaultResponse.body.movie.topicKey).toBe('FOREIGN_MOVIES');

    const invalidResponse = await request(app())
      .post('/api/movies')
      .send({
        title: 'Invalid Topic Movie',
        quality: 'HD',
        topicKey: 'FOREIGN_TV_SERIES',
        description: '',
        links: []
      })
      .expect(400);

    expect(invalidResponse.body).toMatchObject({
      error: 'Validation failed',
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: 'topicKey'
        })
      ])
    });
  });
```

- [ ] **Step 2: Write failing TV API tests**

In `tests/server/media.tv.test.ts`, update the create TV show request to include:

```ts
        topicKey: 'PINOY_TV_SERIES',
```

Update its response assertion with:

```ts
      topicKey: 'PINOY_TV_SERIES',
```

Add this test after `creates a TV show`:

```ts
  it('defaults TV topic and rejects movie-only TV topics', async () => {
    const defaultResponse = await request(app())
      .post('/api/tv-shows')
      .send({
        title: 'Default Topic Show',
        quality: 'HD',
        description: ''
      })
      .expect(201);

    expect(defaultResponse.body.tvShow.topicKey).toBe('FOREIGN_TV_SERIES');

    const invalidResponse = await request(app())
      .post('/api/tv-shows')
      .send({
        title: 'Invalid Topic Show',
        quality: 'HD',
        topicKey: 'PINOY_MOVIES',
        description: ''
      })
      .expect(400);

    expect(invalidResponse.body).toMatchObject({
      error: 'Validation failed',
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: 'topicKey'
        })
      ])
    });
  });
```

- [ ] **Step 3: Run failing media tests**

Run:

```powershell
npm.cmd test -- tests/server/media.movies.test.ts tests/server/media.tv.test.ts
```

Expected: FAIL because `topicKey` is not accepted, returned, or stored.

- [ ] **Step 4: Update schemas**

In `src/server/media/media.schemas.ts`, import topic constants:

```ts
import { DEFAULT_MOVIE_TOPIC_KEY, DEFAULT_TV_TOPIC_KEY, MOVIE_TOPIC_KEYS, TV_TOPIC_KEYS } from './topics.js';
```

Add schemas after `LinkStatusSchema`:

```ts
export const MovieTopicKeySchema = z.enum(MOVIE_TOPIC_KEYS);
export const TvTopicKeySchema = z.enum(TV_TOPIC_KEYS);
```

Change the media input definitions:

```ts
export const MovieInputSchema = MediaInputBaseSchema.extend({
  topicKey: MovieTopicKeySchema.default(DEFAULT_MOVIE_TOPIC_KEY),
  links: z.array(LinkInputSchema).default([])
});

export const TvShowInputSchema = MediaInputBaseSchema.extend({
  topicKey: TvTopicKeySchema.default(DEFAULT_TV_TOPIC_KEY)
});
```

- [ ] **Step 5: Update repository types and row mapping**

In `src/server/media/media.repository.ts`, add `topicKey: string;` to `Movie`, `TvShow`, and `SeasonPostData`.

Add `topic_key: string;` to `MovieRow`, `TvShowRow`, and `SeasonPostRow`.

Update `mapMovie()`:

```ts
    quality: row.quality,
    topicKey: row.topic_key,
    telegramMessageId: row.telegram_message_id ?? undefined,
```

Update `mapTvShow()`:

```ts
    quality: row.quality,
    topicKey: row.topic_key,
    createdAt: row.created_at,
```

- [ ] **Step 6: Update movie SQL**

In every movie SELECT list, include `topic_key` immediately after `quality`.

Change movie insert SQL:

```ts
        `INSERT INTO movies (tmdb_id, title, year, poster_url, description, rating, quality, topic_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
```

Add `input.topicKey` to the `.run(...)` arguments after `input.quality`.

Change movie update SQL:

```ts
           quality = ?,
           topic_key = ?,
           updated_at = CURRENT_TIMESTAMP
```

Add `input.topicKey` to the `.run(...)` arguments after `input.quality`.

- [ ] **Step 7: Update TV SQL**

In every TV show SELECT list, include `topic_key` immediately after `quality`.

Change TV insert SQL:

```ts
      `INSERT INTO tv_shows (tmdb_id, title, year, poster_url, description, rating, quality, topic_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
```

Add `input.topicKey` to the `.run(...)` arguments after `input.quality`.

Change TV update SQL:

```ts
           quality = ?,
           topic_key = ?,
           updated_at = CURRENT_TIMESTAMP
```

Add `input.topicKey` after `input.quality`.

In `getSeasonPostData()`, include `tv_shows.topic_key` in the SELECT and return:

```ts
    topicKey: row.topic_key,
```

- [ ] **Step 8: Run media tests**

Run:

```powershell
npm.cmd test -- tests/server/media.movies.test.ts tests/server/media.tv.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit persistence work**

Run:

```powershell
git add src/server/media/media.schemas.ts src/server/media/media.repository.ts tests/server/media.movies.test.ts tests/server/media.tv.test.ts
git commit -m "feat: persist media topic selection"
```

---

### Task 3: Telegram Send Payload Topic Routing

**Files:**
- Modify: `src/server/media/media.service.ts`
- Modify: `src/server/telegram/telegram.queue.ts`
- Modify: `src/server/telegram/telegram.client.ts`
- Test: `tests/server/telegram.queue.test.ts`
- Test: `tests/server/media.movies.test.ts`
- Test: `tests/server/media.tv.test.ts`

- [ ] **Step 1: Add failing Telegram queue/client tests**

In `tests/server/telegram.queue.test.ts`, update the first queue test's enqueue payload:

```ts
      messageThreadId: 20
```

Update the `sendPhotoPost` assertion:

```ts
    expect(client.sendPhotoPost).toHaveBeenCalledWith({
      posterUrl: 'https://example.com/poster.jpg',
      caption: 'Inception (2010)',
      messageThreadId: 20
    });
```

Add this test inside `describe('telegram client', () => { ... })`:

```ts
  it('sends message_thread_id when sending a topic photo post', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, result: { message_id: 123 } }));
    const client = createTelegramClient(
      {
        botToken: 'test-token',
        channelId: '-1003963665033'
      },
      fetcher
    );

    await expect(
      client.sendPhotoPost({
        posterUrl: 'https://example.com/poster.jpg',
        caption: 'Topic post',
        messageThreadId: 27
      })
    ).resolves.toEqual({ messageId: 123 });

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      chat_id: '-1003963665033',
      photo: 'https://example.com/poster.jpg',
      caption: 'Topic post',
      message_thread_id: 27
    });
  });
```

In `tests/server/media.movies.test.ts`, update the first movie create job payload expectation with:

```ts
      messageThreadId: 27,
```

- [ ] **Step 2: Run failing Telegram/media tests**

Run:

```powershell
npm.cmd test -- tests/server/telegram.queue.test.ts tests/server/media.movies.test.ts tests/server/media.tv.test.ts
```

Expected: FAIL because `TelegramSendJobPayload` and `sendPhotoPost` do not include `messageThreadId`.

- [ ] **Step 3: Type and pass through send payloads**

In `src/server/telegram/telegram.queue.ts`, update `TelegramSendJobPayload`:

```ts
export type TelegramSendJobPayload = {
  posterUrl: string;
  caption: string;
  messageThreadId?: number;
};
```

Update the `runTelegramJob()` send cast:

```ts
    return client.sendPhotoPost(payload as TelegramSendJobPayload);
```

- [ ] **Step 4: Send Telegram topic id**

In `src/server/telegram/telegram.client.ts`, update `sendPhotoPost` input:

```ts
    async sendPhotoPost(input: { posterUrl: string; caption: string; messageThreadId?: number }): Promise<TelegramMessageResult> {
```

Build the body with conditional `message_thread_id`:

```ts
      const payload = await post('sendPhoto', {
        photo: input.posterUrl,
        caption: input.caption,
        ...(input.messageThreadId !== undefined ? { message_thread_id: input.messageThreadId } : {})
      });
```

- [ ] **Step 5: Add topic routes to media send jobs**

In `src/server/media/media.service.ts`, import the route helper:

```ts
import { getTopicRoute } from './topics.js';
```

Change `buildSeasonPayload()`:

```ts
function buildSeasonPayload(postData: SeasonPostData) {
  if (!postData.posterUrl) {
    return undefined;
  }

  const route = getTopicRoute(postData.topicKey, 'tv');

  return {
    posterUrl: postData.posterUrl,
    caption: formatSeasonCaption(postData),
    messageThreadId: route.messageThreadId
  };
}
```

In `syncMoviePostAfterContentChange()`, before enqueueing a send:

```ts
  const route = getTopicRoute(movie.topicKey, 'movie');
```

Use it in the send payload:

```ts
  upsertActiveTelegramSendJob(db, 'movie', movie.id, {
    posterUrl: movie.posterUrl,
    caption: formatMovieCaption(movie),
    messageThreadId: route.messageThreadId
  });
```

In `createMovie()`, before the send job:

```ts
      const route = getTopicRoute(movie.topicKey, 'movie');
```

Use it in the send payload:

```ts
      enqueueTelegramJob(db, 'send', 'movie', movie.id, {
        posterUrl: movie.posterUrl,
        caption: formatMovieCaption(movie),
        messageThreadId: route.messageThreadId
      });
```

- [ ] **Step 6: Update TV season send test for thread id**

In `tests/server/media.tv.test.ts`, add this test after `creates a season for a TV show`:

```ts
  it('queues new season sends with the parent TV topic thread id', async () => {
    const show = db
      .prepare(
        "INSERT INTO tv_shows (title, year, poster_url, quality, topic_key, description) VALUES ('Anime Show', 2026, 'https://example.com/anime.jpg', 'HD', 'ANIME', 'Anime season')"
      )
      .run();
    const season = db.prepare('INSERT INTO seasons (tv_show_id, season_number) VALUES (?, 1)').run(show.lastInsertRowid);
    const episode = db.prepare('INSERT INTO episodes (season_id, episode_number) VALUES (?, 1)').run(season.lastInsertRowid);

    await request(app())
      .post(`/api/episodes/${episode.lastInsertRowid}/links`)
      .send([
        {
          providerName: 'Anime Host',
          quality: 'HD',
          status: 'active',
          url: 'https://example.com/anime/s1/e1'
        }
      ])
      .expect(201);

    const jobs = getTelegramJobs();
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].payload)).toMatchObject({
      posterUrl: 'https://example.com/anime.jpg',
      caption: expect.stringContaining('Anime Show (2026) - Season 1'),
      messageThreadId: 24
    });
  });
```

- [ ] **Step 7: Run Telegram/media tests**

Run:

```powershell
npm.cmd test -- tests/server/telegram.queue.test.ts tests/server/media.movies.test.ts tests/server/media.tv.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Telegram routing work**

Run:

```powershell
git add src/server/media/media.service.ts src/server/telegram/telegram.queue.ts src/server/telegram/telegram.client.ts tests/server/telegram.queue.test.ts tests/server/media.movies.test.ts tests/server/media.tv.test.ts
git commit -m "feat: route telegram sends to topics"
```

---

### Task 4: Admin UI Topic Dropdowns

**Files:**
- Modify: `src/client/pages/MovieForm.tsx`
- Modify: `src/client/pages/TvShowForm.tsx`
- Test: `tests/client/App.test.tsx`

- [ ] **Step 1: Write failing Movie form test**

Add this test near the existing Add Movie form tests in `tests/client/App.test.tsx`:

```tsx
  it('submits the selected movie topic from the Add Movie form', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/movies' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            movie: {
              id: 1,
              title: 'Topic Movie',
              quality: 'HD',
              topicKey: 'PINOY_MOVIES',
              description: '',
              links: []
            }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add movie$/i }));

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Topic Movie' } });
    fireEvent.change(screen.getByLabelText(/^topic$/i), { target: { value: 'PINOY_MOVIES' } });
    fireEvent.click(screen.getByRole('button', { name: /^save movie$/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/movies' && init?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
        title: 'Topic Movie',
        quality: 'HD',
        topicKey: 'PINOY_MOVIES'
      });
    });
  });
```

- [ ] **Step 2: Write failing TV form test**

Add this test near the existing Add TV Show form tests:

```tsx
  it('submits the selected TV topic from the Add TV Show form', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/tv-shows' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            tvShow: {
              id: 2,
              title: 'Topic Show',
              quality: 'HD',
              topicKey: 'PINOY_TV_SERIES',
              description: ''
            }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({ movies: [] })
      };
    });

    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add tv show$/i }));

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Topic Show' } });
    fireEvent.change(screen.getByLabelText(/^topic$/i), { target: { value: 'PINOY_TV_SERIES' } });
    fireEvent.click(screen.getByRole('button', { name: /^save tv show$/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/tv-shows' && init?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
        title: 'Topic Show',
        quality: 'HD',
        topicKey: 'PINOY_TV_SERIES'
      });
    });
  });
```

- [ ] **Step 3: Run failing client tests**

Run:

```powershell
npm.cmd test -- tests/client/App.test.tsx
```

Expected: FAIL because the Topic dropdown does not exist.

- [ ] **Step 4: Update Movie form**

In `src/client/pages/MovieForm.tsx`, add topic options near `qualities`:

```tsx
const movieTopics = [
  { value: 'FOREIGN_MOVIES', label: 'FOREIGN MOVIES' },
  { value: 'PINOY_MOVIES', label: 'PINOY MOVIES' },
  { value: 'ANIME', label: 'ANIME' },
  { value: 'VIVAMAX', label: 'VIVAMAX' }
];
```

Add `topicKey` to `MoviePayload`:

```ts
  topicKey: string;
```

Add state:

```tsx
  const [topicKey, setTopicKey] = useState('FOREIGN_MOVIES');
```

Reset it in add mode:

```tsx
    setTopicKey('FOREIGN_MOVIES');
```

Load it in edit mode:

```tsx
        setTopicKey(movie.topicKey ?? 'FOREIGN_MOVIES');
```

Add it to the submit body:

```tsx
      topicKey,
```

Render this label directly after the Quality label:

```tsx
                <label>
                  Topic
                  <select value={topicKey} onChange={(event) => setTopicKey(event.target.value)}>
                    {movieTopics.map((topic) => (
                      <option key={topic.value} value={topic.value}>
                        {topic.label}
                      </option>
                    ))}
                  </select>
                </label>
```

- [ ] **Step 5: Update TV Show form**

In `src/client/pages/TvShowForm.tsx`, add topic options near `qualities`:

```tsx
const tvTopics = [
  { value: 'FOREIGN_TV_SERIES', label: 'FOREIGN TV SERIES' },
  { value: 'PINOY_TV_SERIES', label: 'PINOY TV SERIES' },
  { value: 'ANIME', label: 'ANIME' },
  { value: 'VIVAMAX', label: 'VIVAMAX' }
];
```

Add `topicKey` to `TvShowPayload`:

```ts
  topicKey: string;
```

Add state:

```tsx
  const [topicKey, setTopicKey] = useState('FOREIGN_TV_SERIES');
```

Reset it in add mode:

```tsx
    setTopicKey('FOREIGN_TV_SERIES');
```

Load it in edit mode:

```tsx
        setTopicKey(tvShow.topicKey ?? 'FOREIGN_TV_SERIES');
```

Add it to the submit body:

```tsx
      topicKey
```

Render this label directly after Quality:

```tsx
              <label>
                Topic
                <select value={topicKey} onChange={(event) => setTopicKey(event.target.value)}>
                  {tvTopics.map((topic) => (
                    <option key={topic.value} value={topic.value}>
                      {topic.label}
                    </option>
                  ))}
                </select>
              </label>
```

- [ ] **Step 6: Run client tests**

Run:

```powershell
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit UI work**

Run:

```powershell
git add src/client/pages/MovieForm.tsx src/client/pages/TvShowForm.tsx tests/client/App.test.tsx
git commit -m "feat: add media topic dropdowns"
```

---

### Task 5: Public Search Group Post Links

**Files:**
- Modify: `src/server/public-search/catalog.ts`
- Test: `tests/public-search/public-search.catalog.test.ts`

- [ ] **Step 1: Write failing catalog link expectations**

In `tests/public-search/public-search.catalog.test.ts`, replace expected movie/season `channelPostUrl` values like:

```ts
channelPostUrl: 'https://t.me/infinitylinks65/123'
```

with:

```ts
channelPostUrl: 'https://t.me/infinitylinks69/123'
```

Do the same for season URLs, for example:

```ts
channelPostUrl: 'https://t.me/infinitylinks69/201'
```

- [ ] **Step 2: Run failing public-search catalog tests**

Run:

```powershell
npm.cmd test -- tests/public-search/public-search.catalog.test.ts
```

Expected: FAIL because the catalog still builds post URLs from `channelHandle`.

- [ ] **Step 3: Update catalog URL helper naming and calls**

In `src/server/public-search/catalog.ts`, rename the helper:

```ts
function buildPublicPostUrl(groupHandle: string, messageId: number | null): string | undefined {
  if (messageId === null) {
    return undefined;
  }

  const publicHandle = groupHandle.trim().replace(/^@+/, '');
  return `https://t.me/${publicHandle}/${messageId}`;
}
```

Change `buildPublicSearchCatalog()` to pass `groupHandle` to builders:

```ts
    movies: buildMovies(db, groupHandle),
    tvShows: buildTvShows(db, groupHandle)
```

Update function parameters:

```ts
function buildMovies(db: AppDatabase, groupHandle: string): PublicSearchMovie[] {
```

```ts
function buildTvShows(db: AppDatabase, groupHandle: string): PublicSearchTvShow[] {
```

Update URL assignments:

```ts
movie.channelPostUrl = buildPublicPostUrl(groupHandle, row.telegram_message_id);
```

```ts
season.channelPostUrl = buildPublicPostUrl(groupHandle, row.telegram_message_id);
```

- [ ] **Step 4: Run public-search catalog tests**

Run:

```powershell
npm.cmd test -- tests/public-search/public-search.catalog.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit catalog link work**

Run:

```powershell
git add src/server/public-search/catalog.ts tests/public-search/public-search.catalog.test.ts
git commit -m "fix: use public group links in catalog"
```

---

### Task 6: Environment Docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.example`**

Change the Telegram destination line in `.env.example`:

```env
TELEGRAM_CHANNEL_ID=-1003963665033
```

Insert this comment directly above `TELEGRAM_CHANNEL_ID`:

```env
# Public Telegram group chat id used for topic posting.
```

- [ ] **Step 2: Update README local config examples**

In `README.md`, replace old local admin posting examples:

```env
TELEGRAM_CHANNEL_ID=-1003976784492
```

with:

```env
TELEGRAM_CHANNEL_ID=-1003963665033
```

Add this short note near the local `.env` example:

```md
`TELEGRAM_CHANNEL_ID` is the public group chat id. New media posts are routed to configured Telegram topic thread ids based on the Movie or TV Show topic dropdown.
```

- [ ] **Step 3: Commit docs**

Run:

```powershell
git add .env.example README.md
git commit -m "docs: document telegram group topic posting"
```

---

### Task 7: Full Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run targeted tests**

Run:

```powershell
npm.cmd test -- tests/server/db.test.ts tests/server/media.movies.test.ts tests/server/media.tv.test.ts tests/server/telegram.queue.test.ts tests/public-search/public-search.catalog.test.ts tests/client/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm.cmd test
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```powershell
npm.cmd run build
```

Expected: PASS with TypeScript and Vite build completing.

- [ ] **Step 4: Inspect staged/uncommitted state**

Run:

```powershell
git status --short
```

Expected: no uncommitted files. If verification caused generated files to change, inspect them and either commit intentional changes or remove generated artifacts that are not part of the feature.

---

## Spec Coverage Self-Review

- Data model: Tasks 1 and 2 add `topic_key`, defaults, API validation, and returned `topicKey`.
- Admin UI: Task 4 adds dropdowns after Quality on Add/Edit Movie and Add/Edit TV Show only.
- Telegram posting: Task 3 adds thread ids to send payloads and keeps edit/delete behavior unchanged.
- Public search links: Task 5 switches post URLs to `@infinitylinks69`.
- Config/docs: Task 6 documents `TELEGRAM_CHANNEL_ID=-1003963665033`.
- Testing: Tasks 1 through 5 add focused coverage; Task 7 runs targeted, full suite, and build verification.

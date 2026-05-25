# Telegram Group Topic Routing Design

Date: 2026-05-25

## Purpose

Move InfinityLinks publishing from one mixed Telegram channel feed into a public Telegram group organized by topics.

Admins choose the correct topic while adding or editing Movies and TV Shows. New Telegram posts are sent into the selected topic so Movies and TV Series stay organized for public users.

## Scope

In scope:

- Add topic selection to Add/Edit Movie.
- Add topic selection to Add/Edit TV Show.
- Store the selected topic on each movie and TV show.
- Default existing movies to `FOREIGN_MOVIES`.
- Default existing TV shows to `FOREIGN_TV_SERIES`.
- Send new Telegram photo posts to public group chat `-1003963665033` with the selected topic's `message_thread_id`.
- Build public-search post links using public group handle `@infinitylinks69`.
- Add focused tests for schema, validation, UI payloads, Telegram send payloads, and public-search link generation.

Out of scope:

- Topic selection on seasons, episodes, movie links, or episode links.
- Automatic genre inference from titles or TMDB metadata.
- Moving an already-posted Telegram message between topics by editing it.
- Changing the standalone public search bot membership requirement flow.

## Selected Approach

Store a `topic_key` on each media record and map that key to Telegram routing metadata.

This keeps the admin UI simple, avoids exposing raw Telegram thread IDs to the user, and gives the backend a stable value to validate and test. The topic map is fixed for this deployment:

| Topic key | Admin label | Chat ID | Message thread ID |
| --- | --- | --- | --- |
| `FOREIGN_MOVIES` | FOREIGN MOVIES | `-1003963665033` | `20` |
| `PINOY_MOVIES` | PINOY MOVIES | `-1003963665033` | `27` |
| `ANIME` | ANIME | `-1003963665033` | `24` |
| `VIVAMAX` | VIVAMAX | `-1003963665033` | `29` |
| `FOREIGN_TV_SERIES` | FOREIGN TV SERIES | `-1003963665033` | `22` |
| `PINOY_TV_SERIES` | PINOY TV SERIES | `-1003963665033` | `28` |

`ANIME` and `VIVAMAX` are shared choices for both Movies and TV Shows.

## Data Model

Add `topic_key` to `movies`:

- Required text value.
- Defaults to `FOREIGN_MOVIES`.
- Allowed movie values: `FOREIGN_MOVIES`, `PINOY_MOVIES`, `ANIME`, `VIVAMAX`.

Add `topic_key` to `tv_shows`:

- Required text value.
- Defaults to `FOREIGN_TV_SERIES`.
- Allowed TV values: `FOREIGN_TV_SERIES`, `PINOY_TV_SERIES`, `ANIME`, `VIVAMAX`.

Migration behavior:

- New databases get both columns from `schema.sql`.
- Existing databases get both columns via `migrate.ts`.
- Existing movie rows are backfilled to `FOREIGN_MOVIES`.
- Existing TV show rows are backfilled to `FOREIGN_TV_SERIES`.

Repository/API behavior:

- Movie create/update accepts and returns `topicKey`.
- TV show create/update accepts and returns `topicKey`.
- Movie list and TV show list return `topicKey`; this design does not require showing it as a table column.
- Server validation rejects invalid combinations, such as `FOREIGN_TV_SERIES` on a movie or `PINOY_MOVIES` on a TV show.
- If legacy data is somehow missing a topic key, backend posting logic falls back to the same default for that media type.

## Admin UI

Add a topic dropdown directly after `Quality` on the Movie form.

Movie options:

- FOREIGN MOVIES
- PINOY MOVIES
- ANIME
- VIVAMAX

New Movie default:

- FOREIGN MOVIES

Add a topic dropdown directly after `Quality` on the TV Show form.

TV options:

- FOREIGN TV SERIES
- PINOY TV SERIES
- ANIME
- VIVAMAX

New TV Show default:

- FOREIGN TV SERIES

Edit forms load the saved topic and send updates back as `topicKey`. The dropdown is not added to seasons, episodes, movie links, or episode links.

## Telegram Posting

The private admin app posts to public Telegram group chat `-1003963665033`.

When creating a send job:

- Movie send payload includes the movie topic's `messageThreadId`.
- Season send payload includes the parent TV show's topic `messageThreadId`.
- All seasons for a TV show use the TV show's selected topic.

Telegram client behavior:

- `sendPhoto` includes `message_thread_id` when the send payload has a topic thread id.
- `editMessageCaption` continues using only `message_id` and caption.
- `deleteMessage` continues using only `message_id`.

Topic changes after posting:

- Existing posted Telegram messages remain where they are.
- Future edits update the existing message in place.
- Future sends, including repost sends that create a new Telegram message, use the latest selected topic.

Config/error behavior:

- If a topic key has no configured `messageThreadId`, the send fails clearly instead of silently posting to the main group feed.
- Existing rate-limit, retry, and failure handling remains in the Telegram queue.

## Public Search Links

Public search catalog links point at the public group handle:

```text
https://t.me/infinitylinks69/<messageId>
```

The admin app uses `@infinitylinks69` as the public post handle for generated catalog links. Telegram sends still use numeric chat id `-1003963665033` and topic thread ids.

## Testing

Add or update tests for:

- Database migration adds `topic_key` to `movies` and `tv_shows`.
- Existing rows are defaulted to `FOREIGN_MOVIES` and `FOREIGN_TV_SERIES`.
- Movie create/update accepts valid movie topic keys and rejects TV-only topic keys.
- TV show create/update accepts valid TV topic keys and rejects movie-only topic keys.
- Movie form renders the topic dropdown after Quality and submits `topicKey`.
- TV Show form renders the topic dropdown after Quality and submits `topicKey`.
- Telegram client sends `message_thread_id` on `sendPhoto`.
- Telegram queue passes movie and season send payloads with the selected topic thread id.
- Public search catalog builds links with `https://t.me/infinitylinks69/<messageId>`.

## Rollout Notes

Before running the app after implementation:

- Ensure the posting bot is an admin in the public group.
- Set the posting destination to chat id `-1003963665033`.
- Run database migration so existing rows receive default topics.
- Review a small test post in each topic before publishing many records.

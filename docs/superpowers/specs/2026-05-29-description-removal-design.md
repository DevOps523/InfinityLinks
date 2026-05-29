# Description Removal Design

## Goal

Remove media descriptions cleanly from InfinityLinks. Movie and TV show descriptions should no longer appear in the admin UI, local Telegram captions, API payloads, database schema, TMDB search result mapping, or tests.

This is a hard removal. Existing description text in local SQLite databases will be discarded during migration.

## Scope

In scope:

- Add/Edit Movie and Add/Edit TV Show forms.
- Movies and TV Shows list tables.
- Media API request and response shapes.
- SQLite schema and migration behavior.
- TMDB search result normalization.
- Local Telegram movie and season caption formatting.
- Tests and fixtures that currently insert, submit, or assert descriptions.
- Windows release build compatibility through the existing `schema.sql` copy flow.

Out of scope:

- Adding IMDb or OMDb search.
- Changing public search bot search result content, because public search catalog data already excludes descriptions.
- Recovering or exporting old description text before migration.
- Changing provider links, quality, topics, ratings, posters, or duplicate detection.

## Current Behavior

Descriptions are stored in `movies.description` and `tv_shows.description`.

The admin UI exposes description textareas on movie and TV show forms and shows description columns in list tables.

TMDB search maps `overview` into `description`, then selected results fill the form field.

Telegram captions accept optional descriptions and insert them between title metadata and download links. The formatter also has special truncation logic to shrink long descriptions to fit Telegram photo caption limits.

The standalone public search bot does not use media descriptions in its synced catalog or user-facing search results.

## Data Model

Remove `description` from the canonical schema:

- `movies`
- `tv_shows`

For new databases, `schema.sql` should create both tables without `description`.

For existing databases, migration should rebuild each table without the column:

1. Detect whether the table has a `description` column.
2. Temporarily disable foreign keys before the rebuild transaction.
3. Create a replacement table with the current non-description columns and constraints.
4. Copy all non-description data into the replacement table.
5. Drop the old table.
6. Rename the replacement table to the original table name.
7. Commit the rebuild, re-enable foreign keys, and run `PRAGMA foreign_key_check`.

The migration must preserve:

- ids
- TMDB ids
- titles
- years
- poster URLs
- ratings
- quality
- topic keys
- Telegram message ids and post statuses
- timestamps
- movie links, seasons, episodes, and episode links

## Server API

`MovieInputSchema` and `TvShowInputSchema` should no longer accept or default `description`.

Repository types and row mappers should remove description fields from:

- `Movie`
- `MovieWithLinks`
- `TvShow`
- `SeasonPostData`
- SQL row types

SQL statements should stop selecting, inserting, and updating `description` for movies and TV shows.

Existing clients sending `description` should receive normal strict-schema validation behavior only if the relevant schema is strict. If the current schemas strip unknown keys, the server can ignore old `description` payloads without preserving them.

## TMDB Search

TMDB search should still call TMDB normally, but ignore the `overview` field.

The normalized result shape should be:

- `tmdbId`
- `title`
- `year`
- `posterUrl`
- `rating`

No `description` value should be returned to the client.

## Admin UI

Remove Description controls from:

- Add Movie
- Edit Movie
- Add TV Show
- Edit TV Show

Remove Description columns from:

- Movies list
- TV Shows list

Selection from TMDB search should fill only:

- TMDB ID
- title
- year
- poster URL
- rating

The poster preview stays unchanged.

## Telegram Captions

Remove description from Telegram caption input types and formatter internals.

Movie captions should contain:

- title and year
- rating, when present
- quality, when present
- download links
- search bot footer

Season captions should contain:

- title, year, and season number
- rating, when present
- quality, when present
- episode download links
- search bot footer

The description trimming logic can be deleted. Caption fitting should still protect required title, metadata, links, and footer from exceeding Telegram limits.

## Public Search Bot

No catalog schema change is expected for public search because descriptions are not part of the public catalog. Clean up only tests or fixtures that mention description as local admin data.

## Testing

Update focused tests for:

- TMDB result normalization without descriptions.
- Movie create, update, list, duplicate, delete, and Telegram queue behavior without descriptions.
- TV show create, update, list, season, and Telegram queue behavior without descriptions.
- Database migration preserves all non-description data and removes description columns.
- Client forms no longer render description textareas.
- Movies and TV Shows tables no longer render description columns.
- Telegram formatter captions no longer include descriptions and still fit within Telegram limits.
- Release build still passes because `schema.sql` remains the source copied into the Windows release folder.

## Deployment Notes

Local admin databases will lose stored description text after migration. This is intentional.

The public VPS bot database does not need a special description migration because the public catalog excludes descriptions already.

After implementation, run:

```sh
npm.cmd test
npm.cmd run build
npm.cmd run build:release:win
npm.cmd run verify:release:win
```

## Risks

The main risk is SQLite table rebuild logic. It must preserve related rows and post state. Tests should cover migration from a legacy schema that includes descriptions.

Another risk is stale failed Telegram edit jobs that were generated only because a description changed. Existing failed jobs can remain historical; new caption generation should stop producing description-only edits.

# Root Public Search Removal Design

## Goal

Remove the obsolete root public bot service under `src/public-search/` now that the deployable public bot lives in `apps/public-search-bot/`.

The cleanup should remove dead build and test wiring while preserving the local admin app's public-search integration under `src/server/public-search/`.

## Current State

The standalone bot app in `apps/public-search-bot/` owns the VPS public bot runtime, including its app, config, polling, Telegram client, sync/status routes, database schema, and tests.

The old root service under `src/public-search/` remains from the pre-standalone phase. It is still referenced by root package scripts, `tsconfig.public-search.json`, and root tests under `tests/public-search/`, but it is no longer the intended deployment target.

The local admin app still needs `src/server/public-search/` for catalog export, sync status, and status proxy behavior. That directory is not part of this removal.

## Removal Scope

Delete:

- `src/public-search/`
- `tsconfig.public-search.json`
- root tests that import `../../src/public-search/...`

Update:

- Root `package.json` scripts so the root build no longer compiles `tsconfig.public-search.json`.
- Root `package.json` scripts so old `public-search:dev`, `public-search:start`, and `build:public-search` commands are removed.
- Documentation references that describe `src/public-search/` as a temporary compatibility copy, if they would otherwise mislead future work.

Keep:

- `apps/public-search-bot/`
- `apps/public-search-bot/tests/`
- root standalone helper scripts such as `standalone-public-search:test`, `standalone-public-search:build`, and `standalone-public-search:start`
- `src/server/public-search/`
- root tests that exercise the local admin sync/export/status routes under `src/server/public-search/`

## Verification

Run root verification:

- `npm.cmd test`
- `npm.cmd run build`

Run standalone bot verification:

- `npm.cmd --prefix apps/public-search-bot test`
- `npm.cmd --prefix apps/public-search-bot run build`

The expected result is that the root project no longer references `src/public-search/`, while the standalone public bot still builds and tests independently.

## Risks

The main risk is deleting tests that still cover behavior not present in the standalone test suite. This is acceptable for this cleanup because the user chose removal over migration, and `apps/public-search-bot/tests/` already contains corresponding coverage for the standalone runtime.

The second risk is accidentally removing `src/server/public-search/`. The implementation must explicitly avoid that directory because it is still active local admin server code.

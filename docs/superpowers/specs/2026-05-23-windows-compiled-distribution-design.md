# Windows Compiled Distribution Design

## Goal

Distribute InfinityLinks to Windows customers as a compiled application, not as source code. Customers should be able to run the system locally and edit only their environment configuration, mainly TMDB and Telegram credentials.

This design raises the effort required to inspect or modify the codebase. It does not claim unbreakable encryption, because any software running on a customer's machine can eventually be reverse engineered by a skilled attacker.

## Distribution Model

The customer receives a Windows package containing:

- `InfinityLinks.exe`
- `.env.example`
- a writable `data/` directory for SQLite files
- a short setup/readme file
- optionally a `start.bat` shortcut or installer-created shortcut

The customer does not receive:

- `src/`
- `tests/`
- TypeScript files
- source maps
- `.git/`
- development-only documentation or planning files

The `.env` file remains external so each customer can set their own `TMDB_API_KEY`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHANNEL_ID` without modifying the executable.

## Recommended Packaging Approach

The first implementation target should use `@yao-pkg/pkg` for Windows executable packaging.

Reasons:

- It fits the current Node/Express application shape.
- It is easier to adopt than Node SEA for this app.
- It can package native `.node` assets, which matters because the app uses `better-sqlite3`.
- It lets the app keep external runtime files such as `.env` and `data/`.

The packaging flow should be:

1. Build the React client with Vite.
2. Build the TypeScript server.
3. Bundle production server code into a small runtime entry.
4. Obfuscate generated JavaScript.
5. Package the runtime entry as `InfinityLinks.exe`.
6. Copy required runtime assets beside the executable.
7. Verify the executable starts, reads `.env`, serves the UI, and writes to `data/`.

## Alternatives

### Bun `--compile`

Bun can produce standalone Windows executables and may be simpler for some Node-style applications. It should be treated as a secondary experiment because compatibility with `better-sqlite3`, Express runtime behavior, and existing Node-specific assumptions must be tested.

### Node SEA

Node single executable applications are the official Node path. This should be kept as a fallback or future hardening path, but it is more complex for this project because of ESM, static assets, SQLite native dependencies, and the need to embed or copy frontend output cleanly.

## Hardening Layers

The compiled distribution should include several layers:

- Production builds only.
- No source maps.
- JavaScript obfuscation after build.
- Minified client and server bundles.
- External `.env` for customer configuration.
- External `data/` directory for the database.
- No source files or repo metadata in the shipped folder.

The app should continue to avoid hardcoding customer secrets in source or generated artifacts.

## Runtime File Layout

The Windows release folder should look like:

```text
InfinityLinks/
  InfinityLinks.exe
  .env.example
  README.txt
  data/
```

After setup, the customer creates:

```text
InfinityLinks/
  .env
```

The app should resolve `.env` and `data/` relative to the executable working directory, not relative to the original development source tree.

## Error Handling And Logs

The packaged application should preserve the current terminal logging behavior for important errors:

- startup failures
- database migration failures
- TMDB API failures
- Telegram API failures
- Telegram rate limit retries
- unexpected API errors

For a Windows customer, logs can stay in the console for the first release. A later version may add a `logs/` directory if support cases require persistent log files.

## Testing Requirements

Before distributing a build, verify:

- `npm.cmd run build` passes.
- The generated executable starts on Windows.
- The UI opens locally.
- `.env` values are read from the release folder.
- SQLite creates and updates files in `data/`.
- TMDB search works with a real key.
- Telegram post, edit, and delete queue actions work with a real bot token and channel ID.
- The release folder does not contain `src/`, `tests/`, `.git/`, TypeScript files, or source maps.

## Future License Control

If commercial control becomes important, add a license activation layer later. The compiled-only package prevents casual editing, but it does not prevent unlimited copying by itself.

A future license system could validate:

- license key
- machine fingerprint
- expiry date or lifetime status
- allowed update channel

That license system would require a server controlled by the seller.

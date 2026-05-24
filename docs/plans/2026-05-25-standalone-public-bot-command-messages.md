# Standalone Public Bot Command Messages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the standalone VPS public search bot so `/search` without a title validates properly, `/clear` resets the conversation lightly, welcome text has emojis, and membership failures give a clearer join-and-try-again message.

**Architecture:** This is a standalone bot-only change under `apps/public-search-bot/`. The formatter owns message text, while the handler owns command routing and membership failure flow. No database/session storage is added because `/clear` is a lightweight message-only reset.

**Tech Stack:** TypeScript, Vitest, standalone Express/Telegram polling bot under `apps/public-search-bot`.

---

### Task 1: Update Standalone Formatter Messages

**Files:**
- Modify: `apps/public-search-bot/src/bot/formatter.ts`
- Modify: `apps/public-search-bot/tests/public-search.formatter.test.ts`

**Step 1: Write the failing formatter tests**

Update the formatter test that currently covers start/join/no-results/unavailable messages. Assert:

- `formatStartMessage(handles).text` equals the new emoji welcome message.
- `formatSearchValidationMessage().text` equals:

  ```text
  ⚠️ Please provide a movie or TV show title.

  Example: /search inception
  ```

- `formatClearMessage().text` equals:

  ```text
  🧹 Cleared. Search anytime with /search movie or tv show name.
  ```

- `formatJoinRequiredMessage(handles).text` equals:

  ```text
  We could not verify your channel membership right now. Please join the channel and try again.

  📢 Channel: @infinitylinks65
  👥 Group: @infinitylinks69
  ```

Keep `replyMarkup` expectations undefined.

**Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.formatter.test.ts
```

Expected: FAIL because `formatSearchValidationMessage` and `formatClearMessage` do not exist and old text still exists.

**Step 3: Implement formatter changes**

In `apps/public-search-bot/src/bot/formatter.ts`:

- Update `formatStartMessage` text to:

  ```ts
  [
    '🎬 Welcome to InfinityLinks Search.',
    '',
    '🔎 Use:',
    '/search movie or tv show name',
    '',
    '✨ Examples:',
    '/search inception',
    '/search breaking bad',
    '',
    formatHandles(handles)
  ].join('\n')
  ```

- Add:

  ```ts
  export function formatSearchValidationMessage(): PublicBotMessage {
    return {
      text: ['⚠️ Please provide a movie or TV show title.', '', 'Example: /search inception'].join('\n')
    };
  }
  ```

- Add:

  ```ts
  export function formatClearMessage(): PublicBotMessage {
    return {
      text: '🧹 Cleared. Search anytime with /search movie or tv show name.'
    };
  }
  ```

- Update `formatJoinRequiredMessage` to use the new membership verification message plus handles.

Do not change `src/public-search/bot/formatter.ts`.

**Step 4: Run test to verify it passes**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.formatter.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/public-search-bot/src/bot/formatter.ts apps/public-search-bot/tests/public-search.formatter.test.ts
git commit -m "feat: update standalone public bot messages"
```

Do not stage unrelated `README.md` or deleted `apps/public-search-bot/.env.example`.

---

### Task 2: Update Standalone Command Handling

**Files:**
- Modify: `apps/public-search-bot/src/bot/handlers.ts`
- Modify: `apps/public-search-bot/tests/public-search.handlers.test.ts`

**Step 1: Write the failing handler tests**

Update/add standalone handler tests:

- `/search` with no query returns the validation message and does not call `getChatMember`.
- `/clear` returns the clear message and does not call `getChatMember`.
- `/search inception` still works without calling `/start` first.
- user-left-channel search returns the new membership verification message and does not leak provider links.
- Telegram membership API failure during `/search` returns the same new message and does not leak provider links.
- season callback membership failure paths use the new text in the sent chat message and do not leak provider links.

For callback answer text, keep it short and user-facing. It may remain `Please join the channel first.` for not-joined callbacks and `Please try again later.` for unavailable callbacks, as long as the full chat message uses the new membership verification text.

**Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.handlers.test.ts
```

Expected: FAIL because `/search` no-query still sends welcome text and `/clear` is not handled.

**Step 3: Implement handler changes**

In `apps/public-search-bot/src/bot/handlers.ts`:

- Import `formatClearMessage` and `formatSearchValidationMessage`.
- Add `/clear` handling after `/start` and before `/search`:

  ```ts
  if (isCommand(text, 'clear')) {
    await sendBotMessage(deps, message.chat.id, formatClearMessage());
    return;
  }
  ```

- Change `/search` no-query branch:

  ```ts
  if (!query) {
    await sendBotMessage(deps, message.chat.id, formatSearchValidationMessage());
    return;
  }
  ```

- For membership unavailable during `/search`, use `formatJoinRequiredMessage(getHandles(deps))` instead of a raw retry-later text.

- For callback membership unavailable with a chat id, send `formatJoinRequiredMessage(getHandles(deps))` instead of raw retry-later text.

Do not change `src/public-search/bot/handlers.ts`.

**Step 4: Run test to verify it passes**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.handlers.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/public-search-bot/src/bot/handlers.ts apps/public-search-bot/tests/public-search.handlers.test.ts
git commit -m "feat: add standalone public bot clear command"
```

---

### Task 3: Standalone Verification And Scope Check

**Files:**
- No source files expected unless tests reveal an issue.

**Step 1: Run focused standalone tests**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- apps/public-search-bot/tests/public-search.formatter.test.ts apps/public-search-bot/tests/public-search.handlers.test.ts
```

Expected: PASS.

**Step 2: Run all standalone public bot tests**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test
```

Expected: PASS.

**Step 3: Run root full tests**

Run:

```bash
npm.cmd test
```

Expected: PASS.

**Step 4: Build standalone public bot**

Run:

```bash
npm.cmd --prefix apps/public-search-bot run build
```

Expected: PASS.

**Step 5: Check scope**

Run:

```bash
git diff --name-only master..HEAD
git status --short
```

Expected:

- Feature diff includes only `apps/public-search-bot/src/bot/formatter.ts`, `apps/public-search-bot/src/bot/handlers.ts`, standalone tests, and this plan/spec commits.
- No root `src/public-search/` or root `tests/public-search/` files changed.
- The pre-existing deleted `apps/public-search-bot/.env.example` remains unrelated unless the user explicitly asks to handle it.

**Step 6: Final review**

Request code review for the full standalone bot command-message feature. Verify:

- `/search` without title validates.
- `/clear` works without membership check.
- `/search <title>` does not require `/start`.
- membership failure text is updated and does not leak provider links.
- root public-search copy is untouched.

# Security Findings Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six validated Codex Security findings and add a concrete secure VPS deployment guide.

**Architecture:** Keep the fixes at the existing trust boundaries: Auth.js credential/session handling, Express API role guards, Zod environment validation, public bot bearer-token route middleware, and deployment documentation. Use focused regression tests that first reproduce the vulnerable behavior, then update the smallest server/client/docs control needed to make the tests pass.

**Tech Stack:** TypeScript, Express, Auth.js, Zod, Vitest, Supertest, React Testing Library, systemd, Nginx, Markdown.

---

## File Structure

- Modify `apps/public-search-bot/src/config.ts`: add strong token validation and reject service account key paths inside the app tree.
- Modify `apps/public-search-bot/tests/public-search.config.test.ts`: update token fixtures and add weak-token/path regression tests.
- Modify `apps/public-search-bot/.env.example`: point the service account key path at `/etc/infinitylinks/google-service-account.json`.
- Modify `src/server/auth/session.ts`: enforce `mustChangePassword` server-side and wire login failed-attempt tracking.
- Create `src/server/auth/login-attempt-limiter.ts`: small in-memory failed-login limiter keyed by client IP and normalized email.
- Modify `tests/server/auth.routes.test.ts`: add forced-password-change API denial and login throttling regression tests.
- Modify `src/server/telegram/telegram.admin.routes.ts`: require admin role for failed-job list/retry routes.
- Modify `src/client/components/Sidebar.tsx`: hide Telegram Jobs from non-admin users.
- Modify `src/client/App.tsx`: block direct navigation to Telegram Jobs for non-admin users.
- Modify `tests/server/telegram.admin.test.ts`: add non-admin denial and admin allow tests.
- Modify `tests/client/App.test.tsx`: add superadmin navigation/direct-route checks for Telegram Jobs.
- Modify `apps/public-search-bot/src/status.routes.ts`: add bad-auth throttling.
- Modify `apps/public-search-bot/src/subscriptions/routes.ts`: add bad-auth throttling.
- Modify `apps/public-search-bot/tests/public-search.status-endpoint.test.ts`: add status bad-auth throttling test and complete config fixture.
- Modify `apps/public-search-bot/tests/public-search.subscription-routes.test.ts`: add subscription bad-auth throttling test.
- Create `docs/deployment/secure-vps-deployment.md`: exact secure VPS deployment checklist and commands.
- Modify `README.md` and `apps/public-search-bot/README.md`: link the secure deployment guide and remove stale secret-in-app-tree guidance.

## Tasks

### Task 1: Harden Public Bot Token And Service Account Config

**Files:**
- Modify: `apps/public-search-bot/src/config.ts`
- Modify: `apps/public-search-bot/tests/public-search.config.test.ts`
- Modify: `apps/public-search-bot/.env.example`
- Verify: `apps/public-search-bot/google-service-account.json`

- [ ] **Step 1: Update config test fixtures to use production-shaped tokens**

In `apps/public-search-bot/tests/public-search.config.test.ts`, add these imports and constants near the top:

```ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PUBLIC_BOT_TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
const SUBSCRIPTION_BOT_TOKEN = '987654321:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
const SYNC_TOKEN = 'sync_token_abcdefghijklmnopqrstuvwxyz0123456789';
const STATUS_TOKEN = 'status_token_abcdefghijklmnopqrstuvwxyz0123456789';
const ADMIN_TOKEN = 'admin_token_abcdefghijklmnopqrstuvwxyz0123456789';
const SERVICE_ACCOUNT_KEY_FILE = '/etc/infinitylinks/google-service-account.json';
const APP_TREE_SERVICE_ACCOUNT_KEY_FILE = fileURLToPath(new URL('../google-service-account.json', import.meta.url));
```

Replace the existing `subscriptionEnv` constant with:

```ts
  const subscriptionEnv = {
    SUBSCRIPTION_BOT_TOKEN,
    SUBSCRIPTION_ADMIN_TOKEN: ADMIN_TOKEN,
    GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id',
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: SERVICE_ACCOUNT_KEY_FILE
  };
```

Then replace short token literals in the file:

```text
'bot-token' -> PUBLIC_BOT_TOKEN
'subscription-token' -> SUBSCRIPTION_BOT_TOKEN
'sync-token' -> SYNC_TOKEN
'status-token' -> STATUS_TOKEN
'admin-token' -> ADMIN_TOKEN
'/secure/google.json' -> SERVICE_ACCOUNT_KEY_FILE
```

Keep deliberately invalid shared-token tests as string literals so those tests still exercise token reuse.

- [ ] **Step 2: Add failing weak-token and unsafe-key-path tests**

Add these tests in `apps/public-search-bot/tests/public-search.config.test.ts` after the required-token tests:

```ts
  it.each([
    ['PUBLIC_BOT_TOKEN', 'short-token'],
    ['PUBLIC_SEARCH_SYNC_TOKEN', 'short-token'],
    ['PUBLIC_SEARCH_STATUS_TOKEN', 'short-token'],
    ['SUBSCRIPTION_BOT_TOKEN', 'short-token'],
    ['SUBSCRIPTION_ADMIN_TOKEN', 'short-token']
  ] as const)('rejects weak %s values', (name, value) => {
    expect(() =>
      loadPublicSearchConfig({
        ...subscriptionEnv,
        PUBLIC_BOT_TOKEN,
        PUBLIC_SEARCH_SYNC_TOKEN: SYNC_TOKEN,
        PUBLIC_SEARCH_STATUS_TOKEN: STATUS_TOKEN,
        [name]: value
      })
    ).toThrow(new RegExp(`${name} must be at least 32 characters`));
  });

  it.each([
    ['PUBLIC_SEARCH_SYNC_TOKEN', 'replace_with_secret_sync_token'],
    ['PUBLIC_SEARCH_STATUS_TOKEN', 'replace_with_read_only_status_token'],
    ['SUBSCRIPTION_ADMIN_TOKEN', 'replace_with_subscription_admin_secret']
  ] as const)('rejects example %s values', (name, value) => {
    expect(() =>
      loadPublicSearchConfig({
        ...subscriptionEnv,
        PUBLIC_BOT_TOKEN,
        PUBLIC_SEARCH_SYNC_TOKEN: SYNC_TOKEN,
        PUBLIC_SEARCH_STATUS_TOKEN: STATUS_TOKEN,
        [name]: value
      })
    ).toThrow(new RegExp(`${name} must be a generated secret`));
  });

  it('requires the Google service account key to live outside the public bot app tree', () => {
    expect(() =>
      loadPublicSearchConfig({
        ...subscriptionEnv,
        PUBLIC_BOT_TOKEN,
        PUBLIC_SEARCH_SYNC_TOKEN: SYNC_TOKEN,
        PUBLIC_SEARCH_STATUS_TOKEN: STATUS_TOKEN,
        GOOGLE_SERVICE_ACCOUNT_KEY_FILE: APP_TREE_SERVICE_ACCOUNT_KEY_FILE
      })
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY_FILE must be outside the public-search bot app directory/);
  });
```

- [ ] **Step 3: Run the targeted config tests and verify failure**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.config.test.ts
```

Expected: FAIL because short/example tokens and an app-tree service account path are still accepted.

- [ ] **Step 4: Implement strong token and service-account path validation**

In `apps/public-search-bot/src/config.ts`, add these imports at the top:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
```

Replace `requiredSecret` and add the helpers below it:

```ts
function requiredSecret(name: string) {
  return z.string({ required_error: `${name} is required` }).trim().min(1, `${name} is required`);
}

const generatedSecretMinimumLength = 32;
const exampleSecretFragments = [
  'replace_with',
  'replace-with',
  'change_me',
  'changeme',
  'example',
  'placeholder'
];

function generatedSecret(name: string) {
  return requiredSecret(name)
    .min(generatedSecretMinimumLength, `${name} must be at least ${generatedSecretMinimumLength} characters`)
    .refine((value) => !exampleSecretFragments.some((fragment) => value.toLowerCase().includes(fragment)), {
      message: `${name} must be a generated secret`
    });
}

const publicSearchBotAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function isInsideDirectory(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function serviceAccountKeyFile(name: string) {
  return requiredSecret(name)
    .refine((value) => path.isAbsolute(value), {
      message: `${name} must be an absolute path`
    })
    .refine((value) => !isInsideDirectory(publicSearchBotAppRoot, path.resolve(value)), {
      message: `${name} must be outside the public-search bot app directory`
    });
}
```

Update the schema fields:

```ts
const PublicSearchEnvSchema = z.object({
  PUBLIC_BOT_TOKEN: generatedSecret('PUBLIC_BOT_TOKEN'),
  PUBLIC_SEARCH_SYNC_TOKEN: generatedSecret('PUBLIC_SEARCH_SYNC_TOKEN'),
  PUBLIC_SEARCH_STATUS_TOKEN: generatedSecret('PUBLIC_SEARCH_STATUS_TOKEN'),
  PUBLIC_SEARCH_GROUP_HANDLE: trimmedStringWithDefault('@infinitylinks69'),
  PUBLIC_SEARCH_DATABASE_PATH: trimmedStringWithDefault('./data/public-search.sqlite'),
  PUBLIC_SEARCH_HOST: loopbackHostWithDefault('127.0.0.1'),
  PUBLIC_SEARCH_PORT: numberWithDefault(3001),
  SUBSCRIPTION_BOT_TOKEN: generatedSecret('SUBSCRIPTION_BOT_TOKEN'),
  SUBSCRIPTION_GROUP_CHAT_ID: integerWithDefault(-1003963665033),
  SUBSCRIPTION_ALERT_THREAD_ID: numberWithDefault(46),
  SUBSCRIPTION_ADMIN_CONTACT: trimmedStringWithDefault('@seinen_illuminatiks'),
  SUBSCRIPTION_TRIAL_SEARCH_LIMIT: numberWithDefault(5),
  SUBSCRIPTION_OVERDUE_GRACE_DAYS: numberWithDefault(1),
  SUBSCRIPTION_ADMIN_TOKEN: generatedSecret('SUBSCRIPTION_ADMIN_TOKEN'),
  GOOGLE_SHEETS_SPREADSHEET_ID: requiredSecret('GOOGLE_SHEETS_SPREADSHEET_ID'),
  GOOGLE_SHEETS_USERS_RANGE: trimmedStringWithDefault('Users!A:H'),
  GOOGLE_SHEETS_HISTORY_RANGE: trimmedStringWithDefault('History!A:G'),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: serviceAccountKeyFile('GOOGLE_SERVICE_ACCOUNT_KEY_FILE')
})
```

- [ ] **Step 5: Update the example service account path**

In `apps/public-search-bot/.env.example`, replace:

```env
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/opt/publicinfinity/google-service-account.json
```

with:

```env
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/etc/infinitylinks/google-service-account.json
```

- [ ] **Step 6: Verify the live key file is absent from the app tree**

Run:

```powershell
Test-Path apps\public-search-bot\google-service-account.json
```

Expected:

```text
False
```

If it returns `True`, remove that local secret file before committing. Do not print the file contents.

- [ ] **Step 7: Run targeted config tests**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.config.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the public bot config hardening**

Run:

```bash
git add apps/public-search-bot/src/config.ts apps/public-search-bot/tests/public-search.config.test.ts apps/public-search-bot/.env.example .gitignore apps/public-search-bot/.gitignore
git commit -m "fix: harden public bot secret configuration"
```

Expected: commit includes config, config tests, and `.env.example`. It must not include any real `.env`, SQLite database, or service account JSON.

### Task 2: Enforce Forced Password Change On Server APIs

**Files:**
- Modify: `src/server/auth/session.ts`
- Modify: `tests/server/auth.routes.test.ts`

- [ ] **Step 1: Add failing forced-password API denial tests**

In `tests/server/auth.routes.test.ts`, add these tests after `returns current user session without password hash`:

```ts
  it('blocks must-change-password users from privileged API routes', async () => {
    seedUser(db, 'admin@example.com', 'admin', { mustChangePassword: true });
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent.get('/api/admin/dashboard').expect(403);

    expect(response.body).toEqual({ error: 'Password change required.' });
  });

  it('allows must-change-password users to inspect their session and change password', async () => {
    seedUser(db, 'super@example.com', 'superadmin', { mustChangePassword: true });
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'super@example.com');

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user).toMatchObject({
      email: 'super@example.com',
      mustChangePassword: true
    });

    await agent
      .post('/api/auth/change-password')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({
        currentPassword: 'Password123456',
        newPassword: 'NewPassword123456'
      })
      .expect(200);

    const dashboard = await agent.get('/api/admin/dashboard').expect(200);
    expect(dashboard.body.dashboard).toMatchObject({ movies: 0, tvShows: 0 });
  });
```

- [ ] **Step 2: Run the targeted failing tests**

Run:

```bash
npm.cmd test -- tests/server/auth.routes.test.ts -t "must-change-password"
```

Expected: FAIL because `requireApiAuth` refreshes the DB user but still allows privileged APIs.

- [ ] **Step 3: Implement the server-side must-change rejection**

In `src/server/auth/session.ts`, add this constant near the top:

```ts
const PASSWORD_CHANGE_REQUIRED_RESPONSE = { error: 'Password change required.' };
```

Then update the refreshed-user branch of `requireApiAuth`:

```ts
        if (refreshedUser.mustChangePassword) {
          res.status(403).json(PASSWORD_CHANGE_REQUIRED_RESPONSE);
          return;
        }

        res.locals.authUser = toSafeSessionUser(refreshedUser);
        next();
        return;
```

Do not add exceptions inside `requireApiAuth`; `/api/auth/me` and `/api/auth/change-password` are mounted before `requireApiAuth` in `src/server/app.ts` and already perform their own session checks.

- [ ] **Step 4: Run auth route tests**

Run:

```bash
npm.cmd test -- tests/server/auth.routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit forced-password server enforcement**

Run:

```bash
git add src/server/auth/session.ts tests/server/auth.routes.test.ts
git commit -m "fix: enforce password change on protected apis"
```

Expected: commit includes only `session.ts` and auth route tests.

### Task 3: Restrict Telegram Failed-Job Operations To Admins

**Files:**
- Modify: `src/server/telegram/telegram.admin.routes.ts`
- Modify: `src/client/components/Sidebar.tsx`
- Modify: `src/client/App.tsx`
- Modify: `tests/server/telegram.admin.test.ts`
- Modify: `tests/client/App.test.tsx`

- [ ] **Step 1: Add server-side non-admin denial tests**

In `tests/server/telegram.admin.test.ts`, replace the fixed `testAuthUser` and `app` helper with:

```ts
const adminAuthUser = {
  id: '1',
  email: 'admin@example.com',
  role: 'admin' as const,
  mustChangePassword: false
};

const superadminAuthUser = {
  id: '2',
  email: 'super@example.com',
  role: 'superadmin' as const,
  mustChangePassword: false
};

function app(db: AppDatabase, testAuthUser = adminAuthUser) {
  const testApp = express();
  testApp.use((req, _res, next) => {
    req.headers['x-infinitylinks-request'] = 'fetch';
    next();
  });
  testApp.use(createApp({ db, config, testAuthUser }));
  return testApp;
}
```

Add these tests before `lists up to 50 failed Telegram jobs in newest order`:

```ts
  it('rejects non-admin users from listing failed Telegram jobs', async () => {
    const response = await request(app(db, superadminAuthUser)).get('/api/telegram/jobs/failed').expect(403);

    expect(response.body).toEqual({ error: 'You do not have permission to manage Telegram jobs.' });
  });

  it('rejects non-admin users from retrying failed Telegram jobs', async () => {
    const insert = db
      .prepare(
        `INSERT INTO telegram_jobs (
           job_type, entity_type, entity_id, payload, status, attempts, next_run_at, last_error
         )
         VALUES ('delete', 'season', 7, '{"messageId":123}', 'failed', 4, '2099-01-01 00:00:00', 'Telegram failed')`
      )
      .run();

    const response = await request(app(db, superadminAuthUser))
      .post(`/api/telegram/jobs/${insert.lastInsertRowid}/retry`)
      .expect(403);

    expect(response.body).toEqual({ error: 'You do not have permission to manage Telegram jobs.' });
    const job = db.prepare('SELECT status FROM telegram_jobs WHERE id = ?').get(insert.lastInsertRowid) as {
      status: string;
    };
    expect(job.status).toBe('failed');
  });
```

- [ ] **Step 2: Add client navigation tests**

In `tests/client/App.test.tsx`, update the existing `does not show Users navigation to superadmin users` test by adding:

```ts
    expect(within(navigation).queryByRole('button', { name: /^telegram jobs$/i })).not.toBeInTheDocument();
```

Add this test near the navigation tests:

```ts
  it('shows an authorization error if a superadmin opens Telegram Jobs from a saved hash', async () => {
    window.history.replaceState(null, '', '/#/telegram-jobs');
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/me') {
        return createSessionResponse('superadmin');
      }

      if (url === '/api/admin/dashboard') {
        return {
          ok: true,
          json: async () => ({
            dashboard: {
              movies: 0,
              tvShows: 0,
              activeLinks: 0,
              failedTelegramJobs: 0,
              pendingPublicSearchChanges: false
            }
          })
        };
      }

      return { ok: true, json: async () => ({ movies: [] }) };
    });

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to manage Telegram jobs.');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/telegram/jobs/failed', expect.anything());
  });
```

- [ ] **Step 3: Run targeted tests and verify failure**

Run:

```bash
npm.cmd test -- tests/server/telegram.admin.test.ts tests/client/App.test.tsx -t "Telegram Jobs|Telegram jobs|failed Telegram"
```

Expected: FAIL because non-admin users can still access the server routes and the sidebar still exposes Telegram Jobs.

- [ ] **Step 4: Add the Telegram job admin guard**

In `src/server/telegram/telegram.admin.routes.ts`, import Express types:

```ts
import type { NextFunction, Request, Response } from 'express';
```

Add this guard above `createTelegramAdminRouter`:

```ts
const TELEGRAM_JOBS_FORBIDDEN_RESPONSE = { error: 'You do not have permission to manage Telegram jobs.' };

function requireTelegramJobsAdmin(_req: Request, res: Response, next: NextFunction) {
  if (res.locals.authUser?.role !== 'admin') {
    res.status(403).json(TELEGRAM_JOBS_FORBIDDEN_RESPONSE);
    return;
  }

  next();
}
```

Then add the guard after creating the router:

```ts
  router.use('/telegram/jobs', requireTelegramJobsAdmin);
```

The start of `createTelegramAdminRouter` should become:

```ts
export function createTelegramAdminRouter(db: AppDatabase) {
  const router = Router();

  router.use('/telegram/jobs', requireTelegramJobsAdmin);

  router.get('/telegram/jobs/failed', (_req, res, next) => {
```

- [ ] **Step 5: Hide Telegram Jobs from non-admins and block direct route rendering**

In `src/client/components/Sidebar.tsx`, split the item arrays:

```ts
const items: Array<{ key: PageKey; label: string; icon: typeof Film }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'movies', label: 'Movies', icon: Film },
  { key: 'add-movie', label: 'Add Movie', icon: Plus },
  { key: 'tv-shows', label: 'TV Shows', icon: Tv },
  { key: 'add-tv-show', label: 'Add TV Show', icon: Clapperboard },
  { key: 'public-search', label: 'Public Search', icon: Search }
];

const adminItems: Array<{ key: PageKey; label: string; icon: typeof Film }> = [
  { key: 'telegram-jobs', label: 'Telegram Jobs', icon: Send },
  { key: 'users', label: 'Users', icon: Users }
];
```

Then update `visibleItems`:

```ts
  const visibleItems = userRole === 'admin' ? [...items, ...adminItems] : items;
```

In `src/client/App.tsx`, update the `telegram-jobs` page branch:

```tsx
  if (page === 'telegram-jobs') {
    if (user.role !== 'admin') {
      return (
        <div className="state-panel state-panel--error" role="alert">
          You do not have permission to manage Telegram jobs.
        </div>
      );
    }

    return <TelegramJobsPage onFailedJobCountChange={setFailedTelegramJobCount} />;
  }
```

- [ ] **Step 6: Run Telegram server and client tests**

Run:

```bash
npm.cmd test -- tests/server/telegram.admin.test.ts tests/client/App.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Telegram authorization**

Run:

```bash
git add src/server/telegram/telegram.admin.routes.ts src/client/components/Sidebar.tsx src/client/App.tsx tests/server/telegram.admin.test.ts tests/client/App.test.tsx
git commit -m "fix: restrict telegram job controls to admins"
```

Expected: commit includes server authz, UI alignment, and tests.

### Task 4: Add Failed-Login Throttling

**Files:**
- Create: `src/server/auth/login-attempt-limiter.ts`
- Modify: `src/server/auth/session.ts`
- Modify: `tests/server/auth.routes.test.ts`

- [ ] **Step 1: Add failed-login throttling tests**

In `tests/server/auth.routes.test.ts`, add this helper below `signIn`:

```ts
async function attemptSignIn(
  agent: request.Agent,
  email: string,
  password: string,
  forwardedFor = '203.0.113.10'
) {
  const csrf = await agent.get('/auth/csrf').expect(200);

  return agent
    .post('/auth/callback/credentials')
    .set('X-Forwarded-For', forwardedFor)
    .type('form')
    .send({
      csrfToken: csrf.body.csrfToken,
      email,
      password,
      redirect: 'false',
      json: 'true'
    })
    .expect((response) => {
      expect([200, 302]).toContain(response.status);
    });
}
```

Add this test after the existing sign-in/session tests:

```ts
  it('temporarily blocks a login bucket after repeated wrong passwords', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    seedUser(db, 'other@example.com', 'admin');
    const app = createApp({ db, config });
    const blockedAgent = request.agent(app);

    for (let index = 0; index < 10; index += 1) {
      await attemptSignIn(blockedAgent, 'admin@example.com', 'WrongPassword123456');
    }

    await attemptSignIn(blockedAgent, 'admin@example.com', 'Password123456');
    const blockedSession = await blockedAgent.get('/api/auth/me').expect(200);
    expect(blockedSession.body).toEqual({ user: null });

    const otherUserAgent = request.agent(app);
    await attemptSignIn(otherUserAgent, 'other@example.com', 'Password123456');
    const otherUserSession = await otherUserAgent.get('/api/auth/me').expect(200);
    expect(otherUserSession.body.user).toMatchObject({ email: 'other@example.com' });

    const otherIpAgent = request.agent(app);
    await attemptSignIn(otherIpAgent, 'admin@example.com', 'Password123456', '203.0.113.11');
    const otherIpSession = await otherIpAgent.get('/api/auth/me').expect(200);
    expect(otherIpSession.body.user).toMatchObject({ email: 'admin@example.com' });
  });
```

- [ ] **Step 2: Run the targeted failing login throttling test**

Run:

```bash
npm.cmd test -- tests/server/auth.routes.test.ts -t "temporarily blocks a login bucket"
```

Expected: FAIL because repeated bad attempts do not block a later correct password.

- [ ] **Step 3: Create the failed-attempt limiter**

Create `src/server/auth/login-attempt-limiter.ts`:

```ts
type LoginAttemptBucket = {
  failures: number;
  windowStart: number;
};

type LoginAttemptLimiterOptions = {
  limit?: number;
  windowMs?: number;
  now?: () => number;
};

export function createLoginAttemptLimiter(options: LoginAttemptLimiterOptions = {}) {
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, LoginAttemptBucket>();

  function getCurrentBucket(key: string, currentTime: number) {
    const existing = buckets.get(key);
    if (!existing || currentTime >= existing.windowStart + windowMs) {
      const fresh = { failures: 0, windowStart: currentTime };
      buckets.set(key, fresh);
      return fresh;
    }

    return existing;
  }

  return {
    isBlocked(key: string) {
      const bucket = getCurrentBucket(key, now());
      return bucket.failures >= limit;
    },

    recordFailure(key: string) {
      const bucket = getCurrentBucket(key, now());
      bucket.failures += 1;
    },

    clear(key: string) {
      buckets.delete(key);
    }
  };
}
```

- [ ] **Step 4: Wire the limiter into credentials authorization**

In `src/server/auth/session.ts`, add imports:

```ts
import { createLoginAttemptLimiter } from './login-attempt-limiter.js';
import { normalizeAuthEmail } from './users.repository.js';
```

Update the existing `users.repository.js` import so it includes `normalizeAuthEmail`:

```ts
import {
  findAuthUserByEmail,
  findAuthUserById,
  normalizeAuthEmail,
  toSafeSessionUser,
  updateAuthUserLastLogin,
  type AuthUserRole
} from './users.repository.js';
```

Add these helpers before `createAuthConfig`:

```ts
function getCredentialsClientIp(request: globalThis.Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || request.headers.get('x-real-ip') || 'unknown';
}

function loginAttemptKey(request: globalThis.Request, email: string) {
  return `${getCredentialsClientIp(request)}:${normalizeAuthEmail(email)}`;
}
```

Inside `createAuthConfig`, create the limiter:

```ts
  const loginAttemptLimiter = createLoginAttemptLimiter();

  return {
```

Change the credentials `authorize` signature and body:

```ts
        authorize(credentials, request) {
          const email = typeof credentials?.email === 'string' ? credentials.email : '';
          const password = typeof credentials?.password === 'string' ? credentials.password : '';
          const attemptKey = loginAttemptKey(request, email);

          if (loginAttemptLimiter.isBlocked(attemptKey)) {
            return null;
          }

          const user = findAuthUserByEmail(db, email);

          if (!user || !verifyPassword(password, user.passwordHash)) {
            loginAttemptLimiter.recordFailure(attemptKey);
            return null;
          }

          loginAttemptLimiter.clear(attemptKey);
          updateAuthUserLastLogin(db, user.id);
          return toSafeSessionUser(user);
        }
```

- [ ] **Step 5: Run auth route tests**

Run:

```bash
npm.cmd test -- tests/server/auth.routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit login throttling**

Run:

```bash
git add src/server/auth/login-attempt-limiter.ts src/server/auth/session.ts tests/server/auth.routes.test.ts
git commit -m "fix: throttle repeated credential failures"
```

Expected: commit contains only auth limiter, auth session wiring, and tests.

### Task 5: Throttle Failed Public Bearer Authentication

**Files:**
- Modify: `apps/public-search-bot/src/status.routes.ts`
- Modify: `apps/public-search-bot/src/subscriptions/routes.ts`
- Modify: `apps/public-search-bot/tests/public-search.status-endpoint.test.ts`
- Modify: `apps/public-search-bot/tests/public-search.subscription-routes.test.ts`

- [ ] **Step 1: Complete the status endpoint config fixture**

In `apps/public-search-bot/tests/public-search.status-endpoint.test.ts`, update `createConfig` so it returns a complete `PublicSearchConfig`:

```ts
function createConfig(overrides: Partial<PublicSearchConfig> = {}): PublicSearchConfig {
  return {
    publicBotToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
    publicSearchSyncToken: 'sync_token_abcdefghijklmnopqrstuvwxyz0123456789',
    publicSearchStatusToken: 'status_token_abcdefghijklmnopqrstuvwxyz0123456789',
    publicSearchGroupHandle: '@infinitylinks69',
    publicSearchDatabasePath: ':memory:',
    publicSearchHost: '127.0.0.1',
    publicSearchPort: 3001,
    subscriptionBotToken: '987654321:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
    subscriptionGroupChatId: -1003963665033,
    subscriptionAlertThreadId: 46,
    subscriptionAdminContact: '@seinen_illuminatiks',
    subscriptionTrialSearchLimit: 5,
    subscriptionOverdueGraceDays: 1,
    subscriptionAdminToken: 'admin_token_abcdefghijklmnopqrstuvwxyz0123456789',
    googleSheetsSpreadsheetId: 'sheet-id',
    googleSheetsUsersRange: 'Users!A:H',
    googleSheetsHistoryRange: 'History!A:G',
    googleServiceAccountKeyFile: '/etc/infinitylinks/google-service-account.json',
    ...overrides
  };
}
```

Replace `Bearer status-token` in that test file with:

```ts
Bearer status_token_abcdefghijklmnopqrstuvwxyz0123456789
```

- [ ] **Step 2: Add failing status bad-auth throttling test**

Add this test after `returns 401 with the wrong bearer token`:

```ts
  it('rate limits repeated invalid status bearer tokens', async () => {
    const db = createMigratedDatabase();

    try {
      const app = createPublicSearchApp({ db, config: createConfig(), statusTracker: createTracker() });

      for (let index = 0; index < 10; index += 1) {
        await request(app).get('/api/status').set('Authorization', 'Bearer wrong-token').expect(401);
      }

      const response = await request(app).get('/api/status').set('Authorization', 'Bearer wrong-token').expect(429);

      expect(response.headers['retry-after']).toBeDefined();
      expect(response.body).toEqual({
        error: 'Too many unauthorized status attempts. Please wait and try again.'
      });
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 3: Add failing subscription bad-auth throttling test**

Add this test in `apps/public-search-bot/tests/public-search.subscription-routes.test.ts` after `requires subscription admin bearer token`:

```ts
  it('rate limits repeated invalid subscription admin bearer tokens', async () => {
    const app = express();
    const syncFromSheet = vi.fn();
    const refreshAlert = vi.fn();
    app.use('/api', createSubscriptionRouter({ adminToken: 'admin-token', syncFromSheet, refreshAlert }));

    for (let index = 0; index < 10; index += 1) {
      await request(app).post('/api/subscriptions/update').set('Authorization', 'Bearer wrong').expect(401);
    }

    const response = await request(app)
      .post('/api/subscriptions/update')
      .set('Authorization', 'Bearer wrong')
      .expect(429);

    expect(response.headers['retry-after']).toBeDefined();
    expect(response.body).toEqual({
      error: 'Too many unauthorized subscription attempts. Please wait and try again.'
    });
    expect(syncFromSheet).not.toHaveBeenCalled();
    expect(refreshAlert).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run targeted public route tests and verify failure**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.status-endpoint.test.ts public-search.subscription-routes.test.ts
```

Expected: FAIL because status/subscription invalid bearer attempts are not rate-limited.

- [ ] **Step 5: Add throttling to status route**

In `apps/public-search-bot/src/status.routes.ts`, add the import:

```ts
import { createFixedWindowRateLimiter } from './rate-limit.js';
```

Create the limiter inside `createPublicSearchStatusRouter` before the route:

```ts
  const badAuthRateLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });
```

Replace the invalid-token block with:

```ts
    if (token !== config.publicSearchStatusToken) {
      const badAuthLimit = badAuthRateLimiter.check(req.ip ?? 'unknown');
      if (!badAuthLimit.allowed) {
        res.set('Retry-After', String(Math.max(1, Math.ceil(badAuthLimit.retryAfterMs / 1000))));
        res.status(429).json({ error: 'Too many unauthorized status attempts. Please wait and try again.' });
        return;
      }

      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
```

- [ ] **Step 6: Add throttling to subscription routes**

In `apps/public-search-bot/src/subscriptions/routes.ts`, add:

```ts
import { createFixedWindowRateLimiter } from '../rate-limit.js';
```

Inside `createSubscriptionRouter`, before `router.use('/subscriptions', ...)`, add:

```ts
  const badAuthRateLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });
```

Replace the invalid-token block with:

```ts
    if (token !== options.adminToken) {
      const badAuthLimit = badAuthRateLimiter.check(req.ip ?? 'unknown');
      if (!badAuthLimit.allowed) {
        res.set('Retry-After', String(Math.max(1, Math.ceil(badAuthLimit.retryAfterMs / 1000))));
        res.status(429).json({ error: 'Too many unauthorized subscription attempts. Please wait and try again.' });
        return;
      }

      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
```

- [ ] **Step 7: Run public route tests**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.status-endpoint.test.ts public-search.subscription-routes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit public bearer throttling**

Run:

```bash
git add apps/public-search-bot/src/status.routes.ts apps/public-search-bot/src/subscriptions/routes.ts apps/public-search-bot/tests/public-search.status-endpoint.test.ts apps/public-search-bot/tests/public-search.subscription-routes.test.ts
git commit -m "fix: throttle failed public bearer auth"
```

Expected: commit contains route throttling and tests.

### Task 6: Add The Secure VPS Deployment Guide

**Files:**
- Create: `docs/deployment/secure-vps-deployment.md`
- Modify: `README.md`
- Modify: `apps/public-search-bot/README.md`

- [ ] **Step 1: Create the deployment guide directory**

Run:

```powershell
New-Item -ItemType Directory -Force docs\deployment
```

Expected: `docs/deployment` exists.

- [ ] **Step 2: Write the guide**

Create `docs/deployment/secure-vps-deployment.md` with this content:

````markdown
# Secure VPS Deployment

Use this guide after the security-remediation tests pass and before production traffic reaches the public search bot.

## Stop Gates

Do not deploy when any command in this section prints a matching file:

```bash
find apps/public-search-bot -maxdepth 2 \( -name ".env" -o -name ".env.*" -o -name "google-service-account.json" \) -print
find apps/public-search-bot -maxdepth 3 \( -name "*.sqlite" -o -name "*.sqlite3" -o -name "node_modules" -o -name "dist" \) -print
```

Do not deploy until the old Google service account key has been revoked and replaced outside the repository.

## 1. Generate Fresh Secrets

Run these locally or on the VPS and save the values directly into the server secret store:

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
```

Use three different generated values for:

```text
PUBLIC_SEARCH_SYNC_TOKEN
PUBLIC_SEARCH_STATUS_TOKEN
SUBSCRIPTION_ADMIN_TOKEN
```

Create new Telegram bot tokens in BotFather if the old values were ever copied into shared files, chat, logs, or backups.

## 2. Create The VPS User And Directories

```bash
sudo adduser --system --group --home /opt/infinitylinks/public-search-bot --no-create-home infinitylinks
sudo install -d -o root -g root -m 755 /opt/infinitylinks
sudo install -d -o infinitylinks -g infinitylinks -m 755 /opt/infinitylinks/public-search-bot
sudo install -d -o root -g infinitylinks -m 750 /etc/infinitylinks
sudo install -d -o infinitylinks -g infinitylinks -m 750 /var/lib/infinitylinks
```

## 3. Place Secrets Outside The App Tree

Create `/etc/infinitylinks/public-search-bot.env`:

```bash
sudo nano /etc/infinitylinks/public-search-bot.env
sudo chown root:infinitylinks /etc/infinitylinks/public-search-bot.env
sudo chmod 640 /etc/infinitylinks/public-search-bot.env
```

The env file must include:

```env
PUBLIC_BOT_TOKEN=generated_or_botfather_value
PUBLIC_SEARCH_SYNC_TOKEN=generated_48_byte_value
PUBLIC_SEARCH_STATUS_TOKEN=different_generated_48_byte_value
PUBLIC_SEARCH_GROUP_HANDLE=@infinitylinks69
PUBLIC_SEARCH_DATABASE_PATH=/var/lib/infinitylinks/public-search.sqlite
PUBLIC_SEARCH_HOST=127.0.0.1
PUBLIC_SEARCH_PORT=3001
SUBSCRIPTION_BOT_TOKEN=generated_or_botfather_value
SUBSCRIPTION_GROUP_CHAT_ID=-1003963665033
SUBSCRIPTION_ALERT_THREAD_ID=46
SUBSCRIPTION_ADMIN_CONTACT=@seinen_illuminatiks
SUBSCRIPTION_TRIAL_SEARCH_LIMIT=5
SUBSCRIPTION_OVERDUE_GRACE_DAYS=1
SUBSCRIPTION_ADMIN_TOKEN=third_generated_48_byte_value
GOOGLE_SHEETS_SPREADSHEET_ID=spreadsheet_id
GOOGLE_SHEETS_USERS_RANGE=Users!A:H
GOOGLE_SHEETS_HISTORY_RANGE=History!A:G
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/etc/infinitylinks/google-service-account.json
```

Create the Google service account file directly on the VPS:

```bash
sudo nano /etc/infinitylinks/google-service-account.json
sudo chown root:infinitylinks /etc/infinitylinks/google-service-account.json
sudo chmod 640 /etc/infinitylinks/google-service-account.json
```

## 4. Upload Only Safe App Files

From the repo root on your workstation:

```bash
rsync -av --delete \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "google-service-account.json" \
  --exclude "data/" \
  --exclude "dist/" \
  --exclude "node_modules/" \
  --exclude "*.sqlite" \
  --exclude "*.sqlite3" \
  apps/public-search-bot/ root@your-vps-ip:/opt/infinitylinks/public-search-bot/
```

Verify the deploy tree is clean:

```bash
ssh root@your-vps-ip 'find /opt/infinitylinks/public-search-bot -maxdepth 3 \( -name ".env" -o -name ".env.*" -o -name "google-service-account.json" -o -name "*.sqlite" -o -name "*.sqlite3" \) -print'
```

The command should print nothing.

## 5. Install, Build, And Migrate

```bash
ssh root@your-vps-ip
cd /opt/infinitylinks/public-search-bot
npm ci --omit=dev
npm run build
sudo -u infinitylinks env $(sudo cat /etc/infinitylinks/public-search-bot.env | xargs) npm run db:migrate
sudo chown -R infinitylinks:infinitylinks /var/lib/infinitylinks
```

## 6. Install systemd Service

Create `/etc/systemd/system/public-search-bot.service`:

```ini
[Unit]
Description=InfinityLinks Public Search Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/infinitylinks/public-search-bot
EnvironmentFile=/etc/infinitylinks/public-search-bot.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=infinitylinks
Group=infinitylinks
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/infinitylinks

[Install]
WantedBy=multi-user.target
```

Start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable public-search-bot
sudo systemctl start public-search-bot
sudo systemctl status public-search-bot --no-pager
```

## 7. Configure Nginx And TLS

Use Nginx as the only public entry point. The Node app must keep `PUBLIC_SEARCH_HOST=127.0.0.1`.

```nginx
limit_req_zone $binary_remote_addr zone=public_search_api:10m rate=30r/m;

server {
  listen 80;
  server_name your-vps.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name your-vps.example.com;

  client_max_body_size 6m;

  location /api/ {
    limit_req zone=public_search_api burst=20 nodelay;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

Install TLS with Certbot or your existing certificate process, then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 8. Firewall And SSH

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Keep port `3001` closed to the public internet.

## 9. Post-Deploy Verification

On the VPS:

```bash
sudo systemctl status public-search-bot --no-pager
sudo journalctl -u public-search-bot -n 100 --no-pager
curl -i http://127.0.0.1:3001/api/status
curl -i -H "Authorization: Bearer $PUBLIC_SEARCH_STATUS_TOKEN" http://127.0.0.1:3001/api/status
find /opt/infinitylinks/public-search-bot -maxdepth 3 \( -name ".env" -o -name ".env.*" -o -name "google-service-account.json" -o -name "*.sqlite" -o -name "*.sqlite3" \) -print
```

The unauthenticated status request should return `401`. The authenticated localhost request should return safe JSON. The `find` command should print nothing.

From your workstation:

```bash
curl -i https://your-vps.example.com/api/status
curl -i -H "Authorization: Bearer status_token_value" https://your-vps.example.com/api/status
```

## 10. Backup, Rollback, And Rotation

Back up only `/var/lib/infinitylinks` and encrypt the backup before moving it off the VPS. Do not back up `/etc/infinitylinks` into the app release archive.

Before rollback, confirm the rollback package does not contain `.env`, SQLite files, or Google JSON.

Rotate all public bearer tokens after admin turnover, suspected log exposure, accidental upload, or support handoff.
````

- [ ] **Step 3: Link the guide from README files**

In `README.md`, after the sentence that links `apps/public-search-bot/README.md`, add:

```md
For production hardening, follow the step-by-step guide in [`docs/deployment/secure-vps-deployment.md`](docs/deployment/secure-vps-deployment.md) before exposing the VPS service.
```

In `apps/public-search-bot/README.md`, near the top after the first paragraph, add:

```md
For a hardened production rollout with `/etc` secrets, systemd sandboxing, Nginx/TLS, firewall rules, and verification gates, use [`../../docs/deployment/secure-vps-deployment.md`](../../docs/deployment/secure-vps-deployment.md).
```

- [ ] **Step 4: Search for stale secret-in-app-tree guidance**

Run:

```bash
rg -n "GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/opt|google-service-account\\.json|/opt/publicinfinity|/opt/infinitylinks-public-search-bot/google-service-account" README.md apps/public-search-bot/README.md docs
```

Expected: old `/opt/.../google-service-account.json` guidance is either gone or clearly marked as obsolete in favor of `/etc/infinitylinks/google-service-account.json`.

- [ ] **Step 5: Commit deployment documentation**

Run:

```bash
git add docs/deployment/secure-vps-deployment.md README.md apps/public-search-bot/README.md
git commit -m "docs: add secure vps deployment guide"
```

Expected: commit contains only documentation changes.

### Task 7: Final Verification And Security Closure

**Files:**
- Verify: all changed source, tests, and docs.
- Verify: `.codex-security-scans/InfinityLinks/.../validation_artifacts`

- [ ] **Step 1: Run focused root tests**

Run:

```bash
npm.cmd test -- tests/server/auth.routes.test.ts tests/server/telegram.admin.test.ts tests/client/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run focused public bot tests**

Run:

```bash
npm.cmd --prefix apps/public-search-bot test -- public-search.config.test.ts public-search.status-endpoint.test.ts public-search.subscription-routes.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full root test suite**

Run:

```bash
npm.cmd test
```

Expected: PASS.

- [ ] **Step 4: Run full public bot test suite**

Run:

```bash
npm.cmd run standalone-public-search:test
```

Expected: PASS.

- [ ] **Step 5: Run builds**

Run:

```bash
npm.cmd run build
npm.cmd run standalone-public-search:build
```

Expected: both commands PASS.

- [ ] **Step 6: Confirm no secrets are in the app tree**

Run:

```powershell
Test-Path apps\public-search-bot\google-service-account.json
Get-ChildItem apps\public-search-bot -Force -File -Include .env,.env.* -ErrorAction SilentlyContinue
```

Expected: first command prints `False`; second command prints no local secret files except `.env.example` if explicitly queried elsewhere.

- [ ] **Step 7: Re-run the original scan validation artifacts and update expectations if needed**

The old artifacts under `.codex-security-scans/.../validation_artifacts` intentionally assert vulnerable behavior. After fixes, update or supersede them only if you want the scan bundle to prove closure. The application tests above are the source-of-truth regression tests for this remediation.

If closure artifacts are desired, create new tests under `.codex-security-scans/InfinityLinks/<scan-id>/artifacts/06_fix_validation/` that assert:

```text
must-change users receive 403 on privileged APIs
non-admin Telegram job requests receive 403
weak public bot tokens fail config validation
wrong status/subscription bearer attempts eventually receive 429
repeated wrong credential attempts block the same login bucket
```

- [ ] **Step 8: Run the deep security scan after the fix branch is stable**

Run `codex-security:deep-security-scan` only after Tasks 1-7 pass. Deep Security Scan is a separate workflow with six independent discovery workers per completed round; do not claim it ran during this remediation unless its deep discovery and merge artifacts exist.

- [ ] **Step 9: Check working tree**

Run:

```bash
git status --short
```

Expected: only intentional security-remediation files are modified. No `.env`, SQLite, service account JSON, `dist`, `node_modules`, or scan artifact changes should be staged unless explicitly requested.


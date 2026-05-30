# Authentication User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Auth.js email/password login, role-based user management, generated temporary passwords, and forced password changes to the local InfinityLinks admin app.

**Architecture:** Auth.js owns session cookies through `/auth/*`, while InfinityLinks owns local SQLite users, roles, password hashes, bootstrap, and admin-only user-management APIs. The existing local API request guard remains in place, `/api/health` stays public, and all existing admin data APIs require a valid session. The standalone `apps/public-search-bot` must not be modified.

**Tech Stack:** Express, Auth.js `@auth/express`, React 19, Vite, TypeScript, SQLite via `better-sqlite3`, Node `crypto.scrypt`, Vitest, Testing Library, Supertest.

---

## File Structure

Create these focused server files:

- `src/server/auth/passwords.ts`: password generation, scrypt hashing, hash verification, and replacement password validation.
- `src/server/auth/users.repository.ts`: all `auth_users` SQL reads/writes.
- `src/server/auth/bootstrap.ts`: first-admin bootstrap from config.
- `src/server/auth/session.ts`: Auth.js configuration, session lookup, and Express auth middleware.
- `src/server/auth/auth.routes.ts`: `/api/auth/me` and `/api/auth/change-password`.
- `src/server/admin/users.routes.ts`: admin-only user listing, creation, and reset endpoints.

Modify these existing server files:

- `package.json` and `package-lock.json`: add `@auth/express`.
- `.env.example`: document `AUTH_SECRET` and `ADMIN_EMAIL`.
- `src/server/config.ts`: load auth config.
- `src/server/db/schema.sql`: create `auth_users`.
- `schema.sql`: keep root release schema copy aligned if the project still treats it as a release asset.
- `src/server/db/migrate.ts`: ensure `auth_users` exists for existing databases.
- `src/server/app.ts`: mount Auth.js, app auth routes, auth middleware, and admin users route.
- `src/server/index.ts`: run bootstrap after migration.

Create these focused client files:

- `src/client/auth/types.ts`: shared client auth types.
- `src/client/auth/auth-api.ts`: session, login, logout, change-password, users API calls.
- `src/client/auth/AuthGate.tsx`: loading, login, forced password-change, and authenticated app boundary.
- `src/client/pages/LoginPage.tsx`: modern responsive white login screen.
- `src/client/pages/ChangePasswordPage.tsx`: own-password change screen.
- `src/client/pages/UsersPage.tsx`: admin-only user management.
- `src/client/components/AccountMenu.tsx`: logged-in user display, change-password, and sign-out.

Modify these existing client files:

- `src/client/App.tsx`: wrap current shell with `AuthGate`, add `users` route, pass user/session actions.
- `src/client/components/Sidebar.tsx`: add Users navigation only for `admin`.
- `src/client/api/http.ts`: make cookie handling explicit with `credentials: 'same-origin'`.
- `src/client/styles.css`: login, account menu, users page, responsive table/card styles.

Create or modify these tests:

- `tests/server/auth.passwords.test.ts`
- `tests/server/auth.bootstrap.test.ts`
- `tests/server/auth.routes.test.ts`
- `tests/server/app.test.ts`
- `tests/server/config.test.ts`
- `tests/server/db.test.ts`
- `tests/client/App.test.tsx`

Do not create or modify files under `apps/public-search-bot/`.

---

### Task 1: Dependency, Config, And Schema Groundwork

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `src/server/config.ts`
- Modify: `src/server/db/schema.sql`
- Modify: `schema.sql`
- Modify: `src/server/db/migrate.ts`
- Modify: `tests/server/config.test.ts`
- Modify: `tests/server/db.test.ts`

- [ ] **Step 1: Install Auth.js Express dependency**

Run:

```powershell
npm.cmd install @auth/express
```

Expected: `package.json` and `package-lock.json` update with `@auth/express`.

- [ ] **Step 2: Add failing config tests**

In `tests/server/config.test.ts`, update the first test's expected object to include auth defaults:

```ts
expect(
  loadConfig({
    TMDB_API_KEY: 'tmdb-key',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHANNEL_ID: '@channel',
    HOST: 'localhost',
    PORT: '4321',
    DATABASE_PATH: './data/test.sqlite',
    AUTH_SECRET: 'a'.repeat(32),
    ADMIN_EMAIL: 'Admin@Example.COM'
  })
).toEqual({
  tmdbApiKey: 'tmdb-key',
  telegramBotToken: 'telegram-token',
  telegramChannelId: '@channel',
  host: 'localhost',
  port: 4321,
  databasePath: path.resolve(process.cwd(), './data/test.sqlite'),
  publicSearchSyncUrl: undefined,
  publicSearchSyncToken: undefined,
  publicSearchStatusUrl: undefined,
  publicSearchStatusToken: undefined,
  publicSearchGroupHandle: '@infinitylinks69',
  authSecret: 'a'.repeat(32),
  adminEmail: 'admin@example.com'
});
```

Add these tests to the same `describe('loadConfig')` block:

```ts
it('requires an Auth.js secret of at least 32 characters', () => {
  expect(() =>
    loadConfig({
      TMDB_API_KEY: 'tmdb-key',
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      TELEGRAM_CHANNEL_ID: '@channel',
      AUTH_SECRET: 'short'
    })
  ).toThrow(/AUTH_SECRET must be at least 32 characters/);
});

it('accepts missing ADMIN_EMAIL because bootstrap validates when needed', () => {
  expect(
    loadConfig({
      TMDB_API_KEY: 'tmdb-key',
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      TELEGRAM_CHANNEL_ID: '@channel',
      AUTH_SECRET: 'b'.repeat(32)
    })
  ).toMatchObject({
    authSecret: 'b'.repeat(32),
    adminEmail: undefined
  });
});

it('normalizes ADMIN_EMAIL when present', () => {
  expect(
    loadConfig({
      TMDB_API_KEY: 'tmdb-key',
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      TELEGRAM_CHANNEL_ID: '@channel',
      AUTH_SECRET: 'c'.repeat(32),
      ADMIN_EMAIL: '  Owner@Example.COM  '
    })
  ).toMatchObject({
    adminEmail: 'owner@example.com'
  });
});
```

- [ ] **Step 3: Add failing database tests**

In `tests/server/db.test.ts`, update the `creates every MVP table` expected table list to include `auth_users` first in alphabetical order:

```ts
expect(tables).toEqual([
  'api_logs',
  'auth_users',
  'episode_links',
  'episodes',
  'movie_links',
  'movies',
  'public_search_sync_state',
  'seasons',
  'telegram_jobs',
  'tmdb_cache',
  'tv_shows'
]);
```

Update the `uses autoincrement ids and indexes foreign key columns` length assertion from `10` to `11`:

```ts
expect(tableSql).toHaveLength(11);
```

Add this test:

```ts
it('creates auth users with role and password-change constraints', () => {
  const db = createDatabase(':memory:');
  migrate(db);

  const columns = columnNames(db, 'auth_users');
  expect(columns).toEqual([
    'id',
    'email',
    'role',
    'password_hash',
    'must_change_password',
    'created_at',
    'updated_at',
    'last_login_at'
  ]);

  db.prepare(
    "INSERT INTO auth_users (email, role, password_hash) VALUES ('admin@example.com', 'admin', 'hash')"
  ).run();

  expect(db.prepare('SELECT role, must_change_password FROM auth_users WHERE email = ?').get('admin@example.com')).toEqual({
    role: 'admin',
    must_change_password: 1
  });

  expect(() => {
    db.prepare(
      "INSERT INTO auth_users (email, role, password_hash) VALUES ('bad@example.com', 'owner', 'hash')"
    ).run();
  }).toThrow();

  expect(() => {
    db.prepare(
      "INSERT INTO auth_users (email, role, password_hash, must_change_password) VALUES ('bad2@example.com', 'admin', 'hash', 2)"
    ).run();
  }).toThrow();

  db.close();
});
```

- [ ] **Step 4: Run targeted tests and verify they fail**

Run:

```powershell
npm.cmd test -- tests/server/config.test.ts tests/server/db.test.ts
```

Expected: failures mention missing `authSecret`/`adminEmail` config fields and missing `auth_users`.

- [ ] **Step 5: Implement config fields**

In `src/server/config.ts`, add `AUTH_SECRET` and normalized optional `ADMIN_EMAIL` to `EnvSchema`:

```ts
const OptionalEmail = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
);

const EnvSchema = z.object({
  TMDB_API_KEY: requiredSecret('TMDB_API_KEY'),
  TELEGRAM_BOT_TOKEN: requiredSecret('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHANNEL_ID: requiredSecret('TELEGRAM_CHANNEL_ID'),
  AUTH_SECRET: requiredSecret('AUTH_SECRET').min(32, 'AUTH_SECRET must be at least 32 characters'),
  ADMIN_EMAIL: OptionalEmail,
  HOST: z
```

Extend `AppConfig`:

```ts
export type AppConfig = {
  tmdbApiKey: string;
  telegramBotToken: string;
  telegramChannelId: string;
  host: string;
  port: number;
  databasePath: string;
  authSecret: string;
  adminEmail?: string;
  publicSearchSyncUrl?: string;
  publicSearchSyncToken?: string;
  publicSearchStatusUrl?: string;
  publicSearchStatusToken?: string;
  publicSearchGroupHandle: string;
};
```

Return the new fields from `loadConfig`:

```ts
return {
  tmdbApiKey: parsed.TMDB_API_KEY,
  telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
  telegramChannelId: parsed.TELEGRAM_CHANNEL_ID,
  host: parsed.HOST,
  port: parsed.PORT,
  databasePath,
  authSecret: parsed.AUTH_SECRET,
  adminEmail: parsed.ADMIN_EMAIL,
  publicSearchSyncUrl: parsed.PUBLIC_SEARCH_SYNC_URL,
  publicSearchSyncToken: parsed.PUBLIC_SEARCH_SYNC_TOKEN,
  publicSearchStatusUrl: parsed.PUBLIC_SEARCH_STATUS_URL,
  publicSearchStatusToken: parsed.PUBLIC_SEARCH_STATUS_TOKEN,
  publicSearchGroupHandle: parsed.PUBLIC_SEARCH_GROUP_HANDLE
};
```

- [ ] **Step 6: Implement schema table**

Add this table to both `src/server/db/schema.sql` and the root `schema.sql` near the top after `PRAGMA foreign_keys = ON;`:

```sql
CREATE TABLE IF NOT EXISTS auth_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'superadmin')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);
```

No special migration code is needed beyond executing the updated schema because `CREATE TABLE IF NOT EXISTS` is safe for existing databases.

- [ ] **Step 7: Update `.env.example`**

Add:

```env
AUTH_SECRET=replace_with_at_least_32_random_characters
ADMIN_EMAIL=admin@example.com
```

- [ ] **Step 8: Run targeted tests and verify they pass**

Run:

```powershell
npm.cmd test -- tests/server/config.test.ts tests/server/db.test.ts
```

Expected: all tests in those files pass.

- [ ] **Step 9: Commit**

Run:

```powershell
git add package.json package-lock.json .env.example src/server/config.ts src/server/db/schema.sql schema.sql tests/server/config.test.ts tests/server/db.test.ts
git commit -m "feat: add auth config and user schema"
```

---

### Task 2: Password Generation And Hashing

**Files:**
- Create: `src/server/auth/passwords.ts`
- Create: `tests/server/auth.passwords.test.ts`

- [ ] **Step 1: Write failing password tests**

Create `tests/server/auth.passwords.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  generateTemporaryPassword,
  hashPassword,
  validateReplacementPassword,
  verifyPassword
} from '../../src/server/auth/passwords.js';

describe('auth password helpers', () => {
  it('generates high-entropy temporary passwords without whitespace', () => {
    const first = generateTemporaryPassword();
    const second = generateTemporaryPassword();

    expect(first).toHaveLength(24);
    expect(second).toHaveLength(24);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes and verifies passwords without storing plaintext', () => {
    const hash = hashPassword('Correct Horse Battery 42!');

    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain('Correct Horse Battery 42!');
    expect(verifyPassword('Correct Horse Battery 42!', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('rejects unsupported hash strings safely', () => {
    expect(verifyPassword('password', 'not-a-valid-hash')).toBe(false);
  });

  it('validates replacement password strength', () => {
    expect(validateReplacementPassword('short')).toEqual({
      valid: false,
      error: 'Password must be at least 12 characters.'
    });
    expect(validateReplacementPassword('abcdefghijkl')).toEqual({
      valid: false,
      error: 'Password must include at least one letter and one number.'
    });
    expect(validateReplacementPassword('123456789012')).toEqual({
      valid: false,
      error: 'Password must include at least one letter and one number.'
    });
    expect(validateReplacementPassword('abc123456789')).toEqual({ valid: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- tests/server/auth.passwords.test.ts
```

Expected: FAIL because `src/server/auth/passwords.ts` does not exist.

- [ ] **Step 3: Implement password helpers**

Create `src/server/auth/passwords.ts`:

```ts
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const TEMPORARY_PASSWORD_BYTES = 18;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

type PasswordValidationResult =
  | { valid: true }
  | { valid: false; error: string };

export function generateTemporaryPassword() {
  return randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');
}

export function hashPassword(password: string) {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const key = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION
  });

  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    key.toString('base64url')
  ].join('$');
}

export function verifyPassword(password: string, storedHash: string) {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, costText, blockSizeText, parallelizationText, saltText, keyText] = parts;
  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelization = Number(parallelizationText);

  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) {
    return false;
  }

  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expectedKey = Buffer.from(keyText, 'base64url');
    const actualKey = scryptSync(password, salt, expectedKey.length, {
      N: cost,
      r: blockSize,
      p: parallelization
    });

    return expectedKey.length === actualKey.length && timingSafeEqual(expectedKey, actualKey);
  } catch {
    return false;
  }
}

export function validateReplacementPassword(password: string): PasswordValidationResult {
  if (password.length < 12) {
    return { valid: false, error: 'Password must be at least 12 characters.' };
  }

  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { valid: false, error: 'Password must include at least one letter and one number.' };
  }

  return { valid: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- tests/server/auth.passwords.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/server/auth/passwords.ts tests/server/auth.passwords.test.ts
git commit -m "feat: add auth password helpers"
```

---

### Task 3: User Repository And Bootstrap

**Files:**
- Create: `src/server/auth/users.repository.ts`
- Create: `src/server/auth/bootstrap.ts`
- Create: `tests/server/auth.bootstrap.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write failing repository/bootstrap tests**

Create `tests/server/auth.bootstrap.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAdminUser } from '../../src/server/auth/bootstrap.js';
import {
  createAuthUser,
  findAuthUserByEmail,
  listAuthUsers,
  updateAuthUserPassword
} from '../../src/server/auth/users.repository.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

describe('auth users repository and bootstrap', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates and reads auth users with normalized emails', () => {
    const user = createAuthUser(db, {
      email: 'Admin@Example.COM',
      role: 'admin',
      passwordHash: 'hash-1',
      mustChangePassword: true
    });

    expect(user).toMatchObject({
      id: expect.any(Number),
      email: 'admin@example.com',
      role: 'admin',
      mustChangePassword: true,
      lastLoginAt: null
    });
    expect(findAuthUserByEmail(db, ' ADMIN@example.com ')).toMatchObject({
      email: 'admin@example.com',
      passwordHash: 'hash-1'
    });
  });

  it('lists users without password hashes', () => {
    createAuthUser(db, {
      email: 'admin@example.com',
      role: 'admin',
      passwordHash: 'hash-1',
      mustChangePassword: false
    });

    expect(listAuthUsers(db)).toEqual([
      {
        id: 1,
        email: 'admin@example.com',
        role: 'admin',
        mustChangePassword: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        lastLoginAt: null
      }
    ]);
  });

  it('updates password hash and marks password change required', () => {
    const user = createAuthUser(db, {
      email: 'super@example.com',
      role: 'superadmin',
      passwordHash: 'old-hash',
      mustChangePassword: false
    });

    updateAuthUserPassword(db, user.id, 'new-hash', true);

    expect(findAuthUserByEmail(db, 'super@example.com')).toMatchObject({
      passwordHash: 'new-hash',
      mustChangePassword: true
    });
  });

  it('bootstraps the first admin and prints the generated password once', () => {
    const logger = vi.fn();

    const result = bootstrapAdminUser(db, {
      adminEmail: 'Owner@Example.COM',
      logger
    });

    expect(result.created).toBe(true);
    expect(result.email).toBe('owner@example.com');
    expect(result.temporaryPassword).toHaveLength(24);
    expect(findAuthUserByEmail(db, 'owner@example.com')).toMatchObject({
      role: 'admin',
      mustChangePassword: true
    });
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('owner@example.com'));
    expect(logger).toHaveBeenCalledWith(expect.stringContaining(result.temporaryPassword));
  });

  it('does not bootstrap when an admin already exists', () => {
    createAuthUser(db, {
      email: 'admin@example.com',
      role: 'admin',
      passwordHash: 'hash-1',
      mustChangePassword: false
    });

    const result = bootstrapAdminUser(db, {
      adminEmail: 'owner@example.com',
      logger: vi.fn()
    });

    expect(result).toEqual({ created: false });
    expect(listAuthUsers(db)).toHaveLength(1);
  });

  it('fails clearly when bootstrap needs ADMIN_EMAIL', () => {
    expect(() => bootstrapAdminUser(db, { logger: vi.fn() })).toThrow(
      /ADMIN_EMAIL is required to bootstrap the first admin user/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- tests/server/auth.bootstrap.test.ts
```

Expected: FAIL because repository and bootstrap files do not exist.

- [ ] **Step 3: Implement repository**

Create `src/server/auth/users.repository.ts`:

```ts
import type { AppDatabase } from '../db/database.js';

export type AuthUserRole = 'admin' | 'superadmin';

export type AuthUser = {
  id: number;
  email: string;
  role: AuthUserRole;
  passwordHash: string;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type PublicAuthUser = Omit<AuthUser, 'passwordHash'>;

type AuthUserRow = {
  id: number;
  email: string;
  role: AuthUserRole;
  password_hash: string;
  must_change_password: 0 | 1;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export function normalizeAuthEmail(email: string) {
  return email.trim().toLowerCase();
}

function mapAuthUser(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  };
}

function toPublicAuthUser(user: AuthUser): PublicAuthUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

export function findAuthUserByEmail(db: AppDatabase, email: string): AuthUser | undefined {
  const row = db
    .prepare('SELECT * FROM auth_users WHERE email = ?')
    .get(normalizeAuthEmail(email)) as AuthUserRow | undefined;

  return row ? mapAuthUser(row) : undefined;
}

export function findAuthUserById(db: AppDatabase, id: number): AuthUser | undefined {
  const row = db.prepare('SELECT * FROM auth_users WHERE id = ?').get(id) as AuthUserRow | undefined;
  return row ? mapAuthUser(row) : undefined;
}

export function hasAdminUser(db: AppDatabase) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM auth_users WHERE role = 'admin'").get() as { count: number };
  return row.count > 0;
}

export function listAuthUsers(db: AppDatabase): PublicAuthUser[] {
  const rows = db
    .prepare('SELECT * FROM auth_users ORDER BY email ASC')
    .all() as AuthUserRow[];

  return rows.map(mapAuthUser).map(toPublicAuthUser);
}

export function createAuthUser(
  db: AppDatabase,
  input: { email: string; role: AuthUserRole; passwordHash: string; mustChangePassword: boolean }
): PublicAuthUser {
  const result = db
    .prepare(
      `INSERT INTO auth_users (email, role, password_hash, must_change_password)
       VALUES (?, ?, ?, ?)`
    )
    .run(normalizeAuthEmail(input.email), input.role, input.passwordHash, input.mustChangePassword ? 1 : 0);

  const user = findAuthUserById(db, Number(result.lastInsertRowid));
  if (!user) {
    throw new Error('Created user could not be loaded.');
  }

  return toPublicAuthUser(user);
}

export function updateAuthUserPassword(db: AppDatabase, id: number, passwordHash: string, mustChangePassword: boolean) {
  const result = db
    .prepare(
      `UPDATE auth_users
          SET password_hash = ?,
              must_change_password = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
    )
    .run(passwordHash, mustChangePassword ? 1 : 0, id);

  return result.changes > 0;
}

export function updateAuthUserLastLogin(db: AppDatabase, id: number) {
  db.prepare('UPDATE auth_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

export function toSafeSessionUser(user: AuthUser) {
  return {
    id: String(user.id),
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword
  };
}
```

- [ ] **Step 4: Implement bootstrap**

Create `src/server/auth/bootstrap.ts`:

```ts
import type { AppDatabase } from '../db/database.js';
import { generateTemporaryPassword, hashPassword } from './passwords.js';
import { createAuthUser, hasAdminUser, normalizeAuthEmail } from './users.repository.js';

type BootstrapOptions = {
  adminEmail?: string;
  logger?: (message: string) => void;
};

export type BootstrapResult =
  | { created: false }
  | { created: true; email: string; temporaryPassword: string };

export function bootstrapAdminUser(db: AppDatabase, options: BootstrapOptions): BootstrapResult {
  if (hasAdminUser(db)) {
    return { created: false };
  }

  if (!options.adminEmail) {
    throw new Error('ADMIN_EMAIL is required to bootstrap the first admin user.');
  }

  const email = normalizeAuthEmail(options.adminEmail);
  const temporaryPassword = generateTemporaryPassword();

  createAuthUser(db, {
    email,
    role: 'admin',
    passwordHash: hashPassword(temporaryPassword),
    mustChangePassword: true
  });

  const logger = options.logger ?? console.log;
  logger(`Bootstrap admin created for ${email}`);
  logger(`Temporary admin password: ${temporaryPassword}`);
  logger('Copy this password now. It will not be shown again.');

  return { created: true, email, temporaryPassword };
}
```

- [ ] **Step 5: Wire bootstrap into startup**

In `src/server/index.ts`, import and call bootstrap after `migrate(db)`:

```ts
import { bootstrapAdminUser } from './auth/bootstrap.js';
```

```ts
const db = createDatabase(config.databasePath);
migrate(db);
bootstrapAdminUser(db, {
  adminEmail: config.adminEmail,
  logger: (message) => console.log(message)
});
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- tests/server/auth.bootstrap.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/server/auth/users.repository.ts src/server/auth/bootstrap.ts src/server/index.ts tests/server/auth.bootstrap.test.ts
git commit -m "feat: bootstrap local auth users"
```

---

### Task 4: Auth.js Session Integration And API Protection

**Files:**
- Create: `src/server/auth/session.ts`
- Modify: `src/server/app.ts`
- Modify: `tests/server/app.test.ts`

- [ ] **Step 1: Add failing app protection tests**

In `tests/server/app.test.ts`, extend `guardConfig` with auth fields:

```ts
authSecret: 'test-auth-secret-test-auth-secret-123',
adminEmail: 'admin@example.com',
```

Add imports:

```ts
import { hashPassword } from '../../src/server/auth/passwords.js';
```

Add this helper near `createGuardDb`:

```ts
function seedAuthUser(db: AppDatabase, email: string, role: 'admin' | 'superadmin' = 'admin') {
  db.prepare(
    `INSERT INTO auth_users (email, role, password_hash, must_change_password)
     VALUES (?, ?, ?, 0)`
  ).run(email, role, hashPassword('Password123456'));
}

async function signIn(agent: request.Agent, email = 'admin@example.com') {
  const csrf = await agent.get('/auth/csrf').expect(200);
  const csrfToken = csrf.body.csrfToken;

  await agent
    .post('/auth/callback/credentials')
    .type('form')
    .send({
      csrfToken,
      email,
      password: 'Password123456',
      redirect: 'false',
      json: 'true'
    })
    .expect((response) => {
      expect([200, 302]).toContain(response.status);
    });
}
```

Add tests:

```ts
it('keeps health public while protecting admin API data', async () => {
  const db = createGuardDb();

  try {
    const guardedApp = createApp({ db, config: guardConfig, fetcher: vi.fn<typeof fetch>() });

    await request(guardedApp).get('/api/health').expect(200);

    const response = await request(guardedApp)
      .get('/api/admin/dashboard')
      .set('Host', '127.0.0.1:3000')
      .expect(401);

    expect(response.body).toEqual({ error: 'Authentication required.' });
  } finally {
    db.close();
  }
});

it('allows authenticated users to reach existing admin APIs', async () => {
  const db = createGuardDb();
  seedAuthUser(db, 'admin@example.com');

  try {
    const guardedApp = createApp({ db, config: guardConfig, fetcher: vi.fn<typeof fetch>() });
    const agent = request.agent(guardedApp);

    await signIn(agent);

    const response = await agent
      .get('/api/admin/dashboard')
      .set('Host', '127.0.0.1:3000')
      .expect(200);

    expect(response.body.dashboard).toMatchObject({
      movies: 0,
      tvShows: 0
    });
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
npm.cmd test -- tests/server/app.test.ts
```

Expected: FAIL because `/auth/csrf` does not exist and `/api/admin/dashboard` is not auth-protected.

- [ ] **Step 3: Implement Auth.js session module**

Create `src/server/auth/session.ts`:

```ts
import { ExpressAuth, getSession } from '@auth/express';
import Credentials from '@auth/express/providers/credentials';
import type { AuthConfig } from '@auth/core';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { verifyPassword } from './passwords.js';
import {
  findAuthUserByEmail,
  findAuthUserById,
  toSafeSessionUser,
  updateAuthUserLastLogin,
  type AuthUserRole
} from './users.repository.js';

export type SessionUser = {
  id: string;
  email: string;
  role: AuthUserRole;
  mustChangePassword: boolean;
};

declare module 'express-serve-static-core' {
  interface Locals {
    authUser?: SessionUser;
  }
}

declare module '@auth/core/types' {
  interface Session {
    user?: SessionUser;
  }

  interface User {
    role?: AuthUserRole;
    mustChangePassword?: boolean;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    role?: AuthUserRole;
    mustChangePassword?: boolean;
  }
}

export function createAuthConfig(db: AppDatabase, config: AppConfig): AuthConfig {
  return {
    secret: config.authSecret,
    trustHost: true,
    session: { strategy: 'jwt' },
    providers: [
      Credentials({
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' }
        },
        authorize(credentials) {
          const email = typeof credentials?.email === 'string' ? credentials.email : '';
          const password = typeof credentials?.password === 'string' ? credentials.password : '';
          const user = findAuthUserByEmail(db, email);

          if (!user || !verifyPassword(password, user.passwordHash)) {
            return null;
          }

          updateAuthUserLastLogin(db, user.id);
          return toSafeSessionUser(user);
        }
      })
    ],
    callbacks: {
      jwt({ token, user }) {
        if (user) {
          token.sub = user.id;
          token.email = user.email;
          token.role = user.role;
          token.mustChangePassword = Boolean(user.mustChangePassword);
        }
        return token;
      },
      session({ session, token }) {
        if (token.sub && token.email && token.role) {
          session.user = {
            id: token.sub,
            email: token.email,
            role: token.role,
            mustChangePassword: Boolean(token.mustChangePassword)
          };
        }
        return session;
      }
    }
  };
}

export function createAuthHandler(db: AppDatabase, config: AppConfig) {
  return ExpressAuth(createAuthConfig(db, config));
}

export async function getRequestSessionUser(req: Request, config: AuthConfig): Promise<SessionUser | undefined> {
  const session = await getSession(req, config);
  return session?.user;
}

export function requireApiAuth(authConfig: AuthConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await getRequestSessionUser(req, authConfig);

      if (!user) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      res.locals.authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (res.locals.authUser?.role !== 'admin') {
    res.status(403).json({ error: 'You do not have permission to manage users.' });
    return;
  }

  next();
}

export function refreshSessionUserFromDatabase(db: AppDatabase, sessionUser: SessionUser): SessionUser | undefined {
  const user = findAuthUserById(db, Number(sessionUser.id));
  return user ? toSafeSessionUser(user) : undefined;
}
```

- [ ] **Step 4: Wire Auth.js and protection into app**

In `src/server/app.ts`, import:

```ts
import { createAuthHandler, createAuthConfig, requireApiAuth } from './auth/session.js';
import { createAuthRouter } from './auth/auth.routes.js';
import { createAdminUsersRouter } from './admin/users.routes.js';
```

Inside `if (options.db && options.config)`, mount in this order:

```ts
  if (options.db && options.config) {
    const authConfig = createAuthConfig(options.db, options.config);

    app.use('/auth/*', createAuthHandler(options.db, options.config));
    app.use('/api', createAdminApiRequestGuard(getAdminApiRequestGuardOptions(options.config)));
    app.use('/api/auth', createAuthRouter(options.db, authConfig));
    app.use('/api', requireApiAuth(authConfig));
    app.use('/api/admin/users', createAdminUsersRouter(options.db));
    app.use('/api', createAdminRouter(options.db, options.config));
    app.use('/api', createMediaRouter(options.db));
    app.use('/api', createTelegramAdminRouter(options.db));
    app.use('/api/tmdb', createTmdbRouter(options.db, options.config, options.tmdbOptions));
    app.use('/api', createPublicSearchRouter(options.db, options.config, options.fetcher, options.publicSearchStatusOptions));
  }
```

Move the existing `app.use('/api', createAdminApiRequestGuard(...))` into this block so test apps without db/config still return JSON 404 for unknown API routes.

Task 5 creates `createAuthRouter` and `createAdminUsersRouter`; for this task, add temporary minimal files to satisfy imports:

```ts
// src/server/auth/auth.routes.ts
import { Router } from 'express';
import type { AuthConfig } from '@auth/core';
import type { AppDatabase } from '../db/database.js';

export function createAuthRouter(_db: AppDatabase, _authConfig: AuthConfig) {
  return Router();
}
```

```ts
// src/server/admin/users.routes.ts
import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export function createAdminUsersRouter(_db: AppDatabase) {
  return Router();
}
```

- [ ] **Step 5: Run tests and adjust Auth.js test helper if needed**

Run:

```powershell
npm.cmd test -- tests/server/app.test.ts
```

Expected: the two new auth tests pass, and existing request-guard tests still pass. If Auth.js returns `302` on credentials callback in this environment, keep the test helper accepting `200` or `302` and rely on the session cookie in the agent.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/server/auth/session.ts src/server/auth/auth.routes.ts src/server/admin/users.routes.ts src/server/app.ts tests/server/app.test.ts
git commit -m "feat: protect admin APIs with auth sessions"
```

---

### Task 5: Auth And Admin User API Routes

**Files:**
- Replace: `src/server/auth/auth.routes.ts`
- Replace: `src/server/admin/users.routes.ts`
- Create: `tests/server/auth.routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/server/auth.routes.test.ts`:

```ts
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/server/auth/passwords.js';
import { createApp } from '../../src/server/app.js';
import type { AppConfig } from '../../src/server/config.js';
import { createDatabase, type AppDatabase } from '../../src/server/db/database.js';
import { migrate } from '../../src/server/db/migrate.js';

const config: AppConfig = {
  tmdbApiKey: 'tmdb-token',
  telegramBotToken: 'telegram-token',
  telegramChannelId: '-1001',
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:',
  authSecret: 'test-auth-secret-test-auth-secret-123',
  adminEmail: 'admin@example.com',
  publicSearchGroupHandle: '@infinitylinks69'
};

async function signIn(agent: request.Agent, email: string, password = 'Password123456') {
  const csrf = await agent.get('/auth/csrf').expect(200);

  await agent
    .post('/auth/callback/credentials')
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

function seedUser(db: AppDatabase, email: string, role: 'admin' | 'superadmin', options: { mustChangePassword?: boolean } = {}) {
  db.prepare(
    `INSERT INTO auth_users (email, role, password_hash, must_change_password)
     VALUES (?, ?, ?, ?)`
  ).run(email, role, hashPassword('Password123456'), options.mustChangePassword ? 1 : 0);
}

describe('auth and admin user routes', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns current user session without password hash', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent.get('/api/auth/me').expect(200);

    expect(response.body.user).toEqual({
      id: '1',
      email: 'admin@example.com',
      role: 'admin',
      mustChangePassword: false
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('returns null current user when signed out', async () => {
    const app = createApp({ db, config });

    const response = await request(app).get('/api/auth/me').expect(200);

    expect(response.body).toEqual({ user: null });
  });

  it('allows admins to create users and returns the temporary password once', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent
      .post('/api/admin/users')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({ email: 'Team@Example.COM', role: 'superadmin' })
      .expect(201);

    expect(response.body).toEqual({
      user: {
        id: 2,
        email: 'team@example.com',
        role: 'superadmin',
        mustChangePassword: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        lastLoginAt: null
      },
      temporaryPassword: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/)
    });

    const row = db.prepare('SELECT password_hash, must_change_password FROM auth_users WHERE email = ?').get('team@example.com') as {
      password_hash: string;
      must_change_password: 0 | 1;
    };
    expect(row.password_hash).not.toContain(response.body.temporaryPassword);
    expect(verifyPassword(response.body.temporaryPassword, row.password_hash)).toBe(true);
    expect(row.must_change_password).toBe(1);
  });

  it('rejects duplicate user emails', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent
      .post('/api/admin/users')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({ email: 'ADMIN@example.com', role: 'admin' })
      .expect(409);

    expect(response.body).toEqual({ error: 'A user with that email already exists.' });
  });

  it('prevents superadmins from managing users', async () => {
    seedUser(db, 'super@example.com', 'superadmin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'super@example.com');

    const response = await agent.get('/api/admin/users').expect(403);

    expect(response.body).toEqual({ error: 'You do not have permission to manage users.' });
  });

  it('lets admins reset a superadmin password', async () => {
    seedUser(db, 'admin@example.com', 'admin');
    seedUser(db, 'super@example.com', 'superadmin');
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'admin@example.com');

    const response = await agent
      .post('/api/admin/users/2/reset-password')
      .set('X-InfinityLinks-Request', 'fetch')
      .expect(200);

    expect(response.body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const row = db.prepare('SELECT password_hash, must_change_password FROM auth_users WHERE id = 2').get() as {
      password_hash: string;
      must_change_password: 0 | 1;
    };
    expect(verifyPassword(response.body.temporaryPassword, row.password_hash)).toBe(true);
    expect(row.must_change_password).toBe(1);
  });

  it('changes own password and clears forced password change', async () => {
    seedUser(db, 'super@example.com', 'superadmin', { mustChangePassword: true });
    const app = createApp({ db, config });
    const agent = request.agent(app);

    await signIn(agent, 'super@example.com');

    await agent
      .post('/api/auth/change-password')
      .set('X-InfinityLinks-Request', 'fetch')
      .send({
        currentPassword: 'Password123456',
        newPassword: 'NewPassword123456'
      })
      .expect(200);

    const row = db.prepare('SELECT password_hash, must_change_password FROM auth_users WHERE email = ?').get('super@example.com') as {
      password_hash: string;
      must_change_password: 0 | 1;
    };
    expect(verifyPassword('NewPassword123456', row.password_hash)).toBe(true);
    expect(row.must_change_password).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
npm.cmd test -- tests/server/auth.routes.test.ts
```

Expected: FAIL because route handlers are still temporary shells.

- [ ] **Step 3: Implement app auth routes**

Replace `src/server/auth/auth.routes.ts` with:

```ts
import type { AuthConfig } from '@auth/core';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDatabase } from '../db/database.js';
import { validateReplacementPassword, hashPassword, verifyPassword } from './passwords.js';
import { getRequestSessionUser, refreshSessionUserFromDatabase } from './session.js';
import { findAuthUserById, updateAuthUserPassword } from './users.repository.js';

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(1, 'New password is required.')
});

export function createAuthRouter(db: AppDatabase, authConfig: AuthConfig) {
  const router = Router();

  router.get('/me', async (req, res, next) => {
    try {
      const sessionUser = await getRequestSessionUser(req, authConfig);
      if (!sessionUser) {
        res.json({ user: null });
        return;
      }

      const user = refreshSessionUserFromDatabase(db, sessionUser);
      res.json({ user: user ?? null });
    } catch (error) {
      next(error);
    }
  });

  router.post('/change-password', async (req, res, next) => {
    try {
      const sessionUser = await getRequestSessionUser(req, authConfig);
      if (!sessionUser) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      const input = ChangePasswordSchema.parse(req.body);
      const strength = validateReplacementPassword(input.newPassword);
      if (!strength.valid) {
        res.status(400).json({ error: strength.error });
        return;
      }

      const user = findAuthUserById(db, Number(sessionUser.id));
      if (!user || !verifyPassword(input.currentPassword, user.passwordHash)) {
        res.status(400).json({ error: 'Current password is incorrect.' });
        return;
      }

      updateAuthUserPassword(db, user.id, hashPassword(input.newPassword), false);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

- [ ] **Step 4: Implement admin users routes**

Replace `src/server/admin/users.routes.ts` with:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { generateTemporaryPassword, hashPassword } from '../auth/passwords.js';
import { requireAdmin } from '../auth/session.js';
import {
  createAuthUser,
  findAuthUserByEmail,
  findAuthUserById,
  listAuthUsers,
  normalizeAuthEmail,
  updateAuthUserPassword
} from '../auth/users.repository.js';
import type { AppDatabase } from '../db/database.js';

const RoleSchema = z.enum(['admin', 'superadmin']);

const CreateUserSchema = z.object({
  email: z.string().trim().email().transform((value) => normalizeAuthEmail(value)),
  role: RoleSchema
});

const IdParamSchema = z.object({
  id: z.preprocess((value) => {
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
      return value;
    }
    return Number(value);
  }, z.number().int().positive())
});

export function createAdminUsersRouter(db: AppDatabase) {
  const router = Router();

  router.use(requireAdmin);

  router.get('/', (_req, res, next) => {
    try {
      res.json({ users: listAuthUsers(db) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const input = CreateUserSchema.parse(req.body);

      if (findAuthUserByEmail(db, input.email)) {
        res.status(409).json({ error: 'A user with that email already exists.' });
        return;
      }

      const temporaryPassword = generateTemporaryPassword();
      const user = createAuthUser(db, {
        email: input.email,
        role: input.role,
        passwordHash: hashPassword(temporaryPassword),
        mustChangePassword: true
      });

      res.status(201).json({ user, temporaryPassword });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/reset-password', (req, res, next) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const user = findAuthUserById(db, id);

      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const temporaryPassword = generateTemporaryPassword();
      updateAuthUserPassword(db, id, hashPassword(temporaryPassword), true);

      res.json({ user: { ...user, mustChangePassword: true }, temporaryPassword });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

- [ ] **Step 5: Run route tests**

Run:

```powershell
npm.cmd test -- tests/server/auth.routes.test.ts tests/server/app.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/server/auth/auth.routes.ts src/server/admin/users.routes.ts tests/server/auth.routes.test.ts tests/server/app.test.ts
git commit -m "feat: add auth and user management APIs"
```

---

### Task 6: Client Auth API And Application Gate

**Files:**
- Create: `src/client/auth/types.ts`
- Create: `src/client/auth/auth-api.ts`
- Create: `src/client/auth/AuthGate.tsx`
- Create: `src/client/pages/LoginPage.tsx`
- Create: `src/client/pages/ChangePasswordPage.tsx`
- Modify: `src/client/api/http.ts`
- Modify: `src/client/App.tsx`
- Modify: `tests/client/App.test.tsx`

- [ ] **Step 1: Add failing client auth gate tests**

In `tests/client/App.test.tsx`, update the default `fetchMock.mockImplementation` in `beforeEach` so `/api/auth/me` returns an admin user:

```ts
if (url === '/api/auth/me') {
  return {
    ok: true,
    json: async () => ({
      user: {
        id: '1',
        email: 'admin@example.com',
        role: 'admin',
        mustChangePassword: false
      }
    })
  };
}
```

Add these tests near the top of `describe('App')`:

```ts
it('shows login when no session exists', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/auth/me') {
      return { ok: true, json: async () => ({ user: null }) };
    }

    return { ok: true, json: async () => ({}) };
  });

  render(<App />);

  expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  expect(screen.queryByText(/sign up/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /apple/i })).not.toBeInTheDocument();
});

it('submits login through Auth.js credentials flow', async () => {
  let authenticated = false;

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') {
      return {
        ok: true,
        json: async () => ({
          user: authenticated
            ? { id: '1', email: 'admin@example.com', role: 'admin', mustChangePassword: false }
            : null
        })
      };
    }

    if (url === '/auth/csrf') {
      return { ok: true, json: async () => ({ csrfToken: 'csrf-token' }) };
    }

    if (url === '/auth/callback/credentials') {
      authenticated = true;
      expect(init?.method).toBe('POST');
      expect(init?.body?.toString()).toContain('csrfToken=csrf-token');
      expect(init?.body?.toString()).toContain('email=admin%40example.com');
      return { ok: true, json: async () => ({ ok: true }) };
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

    return { ok: true, json: async () => ({}) };
  });

  render(<App />);

  fireEvent.change(await screen.findByLabelText(/^email$/i), { target: { value: 'admin@example.com' } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123456' } });
  fireEvent.click(screen.getByRole('button', { name: /^login$/i }));

  expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
});

it('forces password change when the session requires it', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/auth/me') {
      return {
        ok: true,
        json: async () => ({
          user: {
            id: '2',
            email: 'super@example.com',
            role: 'superadmin',
            mustChangePassword: true
          }
        })
      };
    }

    return { ok: true, json: async () => ({}) };
  });

  render(<App />);

  expect(await screen.findByRole('heading', { name: /^change password$/i })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: /media navigation/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
npm.cmd test -- tests/client/App.test.tsx
```

Expected: FAIL because the app does not load `/api/auth/me` or render login/change-password screens.

- [ ] **Step 3: Implement client auth types and API**

Create `src/client/auth/types.ts`:

```ts
export type UserRole = 'admin' | 'superadmin';

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
};

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signed-out'; user: null }
  | { status: 'signed-in'; user: SessionUser };
```

Create `src/client/auth/auth-api.ts`:

```ts
import { apiJson } from '../api/http';
import type { SessionUser } from './types';

type CurrentUserResponse = {
  user: SessionUser | null;
};

type TemporaryPasswordResponse = {
  temporaryPassword: string;
};

export async function fetchCurrentUser() {
  const payload = await apiJson<CurrentUserResponse>('/api/auth/me');
  return payload?.user ?? null;
}

export async function loginWithCredentials(email: string, password: string) {
  const csrfResponse = await fetch('/auth/csrf', {
    credentials: 'same-origin'
  });

  if (!csrfResponse.ok) {
    throw new Error('Login failed. Please try again.');
  }

  const csrf = (await csrfResponse.json()) as { csrfToken?: unknown };
  if (typeof csrf.csrfToken !== 'string') {
    throw new Error('Login failed. Please try again.');
  }

  const body = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email,
    password,
    redirect: 'false',
    json: 'true'
  });

  const response = await fetch('/auth/callback/credentials', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  if (!response.ok) {
    throw new Error('Invalid email or password.');
  }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  await apiJson('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export async function signOut() {
  const csrfResponse = await fetch('/auth/csrf', {
    credentials: 'same-origin'
  });
  const csrf = (await csrfResponse.json()) as { csrfToken?: unknown };
  const body = new URLSearchParams({
    csrfToken: typeof csrf.csrfToken === 'string' ? csrf.csrfToken : '',
    redirect: 'false',
    json: 'true'
  });

  await fetch('/auth/signout', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
}

export type { TemporaryPasswordResponse };
```

Modify `src/client/api/http.ts` fetch call:

```ts
const response = await fetch(url, {
  ...init,
  credentials: init.credentials ?? 'same-origin',
  headers
});
```

- [ ] **Step 4: Implement login and change-password pages**

Create `src/client/pages/LoginPage.tsx`:

```tsx
import { Lock, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';

type LoginPageProps = {
  onLogin: (email: string, password: string) => Promise<void>;
};

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await onLogin(email, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Invalid email or password.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-card__accent" />
        <div className="auth-card__body">
          <div className="auth-card__brand">
            <span className="auth-card__mark">IL</span>
            <div>
              <h1>Welcome Back</h1>
              <p>Sign in to manage InfinityLinks</p>
            </div>
          </div>
          {error ? <div className="state-panel state-panel--error auth-card__error">{error}</div> : null}
          <label>
            Email
            <span className="auth-input">
              <Mail aria-hidden="true" size={18} />
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
            </span>
          </label>
          <label>
            Password
            <span className="auth-input">
              <Lock aria-hidden="true" size={18} />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                required
              />
            </span>
          </label>
          <button className="button button--primary auth-card__submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Logging in...' : 'Login'}
          </button>
        </div>
      </form>
    </main>
  );
}
```

Create `src/client/pages/ChangePasswordPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import type { SessionUser } from '../auth/types';

type ChangePasswordPageProps = {
  user: SessionUser;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onSignOut: () => Promise<void>;
};

export function ChangePasswordPage({ user, onChangePassword, onSignOut }: ChangePasswordPageProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await onChangePassword(currentPassword, newPassword);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Password change failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-card__accent" />
        <div className="auth-card__body">
          <div className="auth-card__brand">
            <span className="auth-card__mark">IL</span>
            <div>
              <h1>Change Password</h1>
              <p>{user.email}</p>
            </div>
          </div>
          {error ? <div className="state-panel state-panel--error auth-card__error">{error}</div> : null}
          <label>
            Current password
            <input
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password
            <input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              required
            />
          </label>
          <div className="form-actions">
            <button className="button button--primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Password'}
            </button>
            <button className="button button--secondary" type="button" onClick={() => void onSignOut()}>
              Sign Out
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Implement AuthGate**

Create `src/client/auth/AuthGate.tsx`:

```tsx
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { changePassword, fetchCurrentUser, loginWithCredentials, signOut } from './auth-api';
import type { AuthState, SessionUser } from './types';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { LoginPage } from '../pages/LoginPage';

type AuthGateProps = {
  children: (props: {
    user: SessionUser;
    onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
    onSignOut: () => Promise<void>;
  }) => ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading', user: null });

  const refreshUser = useCallback(async () => {
    const user = await fetchCurrentUser();
    setAuthState(user ? { status: 'signed-in', user } : { status: 'signed-out', user: null });
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  async function handleLogin(email: string, password: string) {
    await loginWithCredentials(email, password);
    await refreshUser();
  }

  async function handleChangePassword(currentPassword: string, newPassword: string) {
    await changePassword(currentPassword, newPassword);
    await refreshUser();
  }

  async function handleSignOut() {
    await signOut();
    setAuthState({ status: 'signed-out', user: null });
  }

  if (authState.status === 'loading') {
    return <main className="auth-page"><div className="state-panel auth-loading">Loading session...</div></main>;
  }

  if (authState.status === 'signed-out') {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (authState.user.mustChangePassword) {
    return <ChangePasswordPage user={authState.user} onChangePassword={handleChangePassword} onSignOut={handleSignOut} />;
  }

  return <>{children({ user: authState.user, onChangePassword: handleChangePassword, onSignOut: handleSignOut })}</>;
}
```

- [ ] **Step 6: Wrap App with AuthGate**

In `src/client/App.tsx`, import:

```ts
import { AuthGate } from './auth/AuthGate';
import type { SessionUser } from './auth/types';
```

Move the current shell JSX into an inner component:

```tsx
function AuthenticatedApp({
  user,
  onChangePassword,
  onSignOut
}: {
  user: SessionUser;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  // existing App state and renderPage logic moves here
}
```

Then make `App`:

```tsx
export function App() {
  return (
    <ToastProvider>
      <AuthGate>
        {({ user, onChangePassword, onSignOut }) => (
          <AuthenticatedApp user={user} onChangePassword={onChangePassword} onSignOut={onSignOut} />
        )}
      </AuthGate>
    </ToastProvider>
  );
}
```

Keep `ToastProvider` at the top so login/change-password screens can later use toasts if needed.

- [ ] **Step 7: Run client tests**

Run:

```powershell
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS for new auth gate tests and existing app tests after the default `/api/auth/me` mock is added.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/client/auth src/client/pages/LoginPage.tsx src/client/pages/ChangePasswordPage.tsx src/client/api/http.ts src/client/App.tsx tests/client/App.test.tsx
git commit -m "feat: add client auth gate"
```

---

### Task 7: Users Page, Sidebar Role Gating, And Account Controls

**Files:**
- Create: `src/client/pages/UsersPage.tsx`
- Create: `src/client/components/AccountMenu.tsx`
- Modify: `src/client/auth/auth-api.ts`
- Modify: `src/client/components/Sidebar.tsx`
- Modify: `src/client/App.tsx`
- Modify: `tests/client/App.test.tsx`

- [ ] **Step 1: Add failing users UI tests**

In `tests/client/App.test.tsx`, add tests:

```ts
it('shows Users navigation only for admins', async () => {
  render(<App />);

  const navigation = await screen.findByRole('navigation', { name: /media navigation/i });
  expect(within(navigation).getByRole('button', { name: /^users$/i })).toBeInTheDocument();
});

it('hides Users navigation for superadmins', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/auth/me') {
      return {
        ok: true,
        json: async () => ({
          user: {
            id: '2',
            email: 'super@example.com',
            role: 'superadmin',
            mustChangePassword: false
          }
        })
      };
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

  const navigation = await screen.findByRole('navigation', { name: /media navigation/i });
  expect(within(navigation).queryByRole('button', { name: /^users$/i })).not.toBeInTheDocument();
});

it('creates a user and shows the generated password once', async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') {
      return {
        ok: true,
        json: async () => ({
          user: {
            id: '1',
            email: 'admin@example.com',
            role: 'admin',
            mustChangePassword: false
          }
        })
      };
    }

    if (url === '/api/admin/users' && !init?.method) {
      return { ok: true, json: async () => ({ users: [] }) };
    }

    if (url === '/api/admin/users' && init?.method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          user: {
            id: 2,
            email: 'team@example.com',
            role: 'superadmin',
            mustChangePassword: true,
            createdAt: '2026-05-30 10:00:00',
            updatedAt: '2026-05-30 10:00:00',
            lastLoginAt: null
          },
          temporaryPassword: 'generated-password-123'
        })
      };
    }

    return { ok: true, json: async () => ({}) };
  });

  render(<App />);

  const navigation = await screen.findByRole('navigation', { name: /media navigation/i });
  fireEvent.click(within(navigation).getByRole('button', { name: /^users$/i }));

  fireEvent.click(await screen.findByRole('button', { name: /^add user$/i }));
  fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'team@example.com' } });
  fireEvent.change(screen.getByLabelText(/^role$/i), { target: { value: 'superadmin' } });
  fireEvent.click(screen.getByRole('button', { name: /^create user$/i }));

  expect(await screen.findByText('generated-password-123')).toBeInTheDocument();
  expect(screen.getByText('team@example.com')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
npm.cmd test -- tests/client/App.test.tsx
```

Expected: FAIL because Users UI and role-gated nav do not exist.

- [ ] **Step 3: Extend client auth API for users**

In `src/client/auth/auth-api.ts`, add:

```ts
import type { UserRole } from './types';

export type ManagedUser = {
  id: number;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export async function fetchUsers() {
  const payload = await apiJson<{ users: ManagedUser[] }>('/api/admin/users');
  return payload?.users ?? [];
}

export async function createUser(input: { email: string; role: UserRole }) {
  return apiJson<{ user: ManagedUser; temporaryPassword: string }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function resetUserPassword(id: number) {
  return apiJson<{ user: ManagedUser; temporaryPassword: string }>(`/api/admin/users/${id}/reset-password`, {
    method: 'POST'
  });
}
```

- [ ] **Step 4: Implement AccountMenu**

Create `src/client/components/AccountMenu.tsx`:

```tsx
import { KeyRound, LogOut } from 'lucide-react';
import type { SessionUser } from '../auth/types';

type AccountMenuProps = {
  user: SessionUser;
  onChangePassword: () => void;
  onSignOut: () => Promise<void>;
};

export function AccountMenu({ user, onChangePassword, onSignOut }: AccountMenuProps) {
  return (
    <div className="account-menu">
      <div className="account-menu__identity">
        <strong>{user.email}</strong>
        <span>{user.role === 'admin' ? 'Admin' : 'Superadmin'}</span>
      </div>
      <button className="icon-button" type="button" aria-label="Change password" onClick={onChangePassword}>
        <KeyRound aria-hidden="true" size={17} />
      </button>
      <button className="icon-button" type="button" aria-label="Sign out" onClick={() => void onSignOut()}>
        <LogOut aria-hidden="true" size={17} />
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Implement UsersPage**

Create `src/client/pages/UsersPage.tsx` with this behavior:

```tsx
import { Copy, RotateCcw, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { createUser, fetchUsers, resetUserPassword, type ManagedUser } from '../auth/auth-api';
import type { UserRole } from '../auth/types';
import { useToast } from '../components/ToastProvider';

type GeneratedPasswordState = {
  email: string;
  password: string;
};

export function UsersPage() {
  const { showToast } = useToast();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('superadmin');
  const [generated, setGenerated] = useState<GeneratedPasswordState | null>(null);

  async function loadUsers() {
    setIsLoading(true);
    setError('');
    try {
      setUsers(await fetchUsers());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Users failed to load.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleCreateUser(event: FormEvent) {
    event.preventDefault();
    const response = await createUser({ email, role });
    if (!response) {
      return;
    }
    setUsers((current) => [...current.filter((user) => user.id !== response.user.id), response.user].sort((a, b) => a.email.localeCompare(b.email)));
    setGenerated({ email: response.user.email, password: response.temporaryPassword });
    setEmail('');
    setRole('superadmin');
    setIsAddOpen(false);
  }

  async function handleResetPassword(user: ManagedUser) {
    const response = await resetUserPassword(user.id);
    if (!response) {
      return;
    }
    setUsers((current) => current.map((item) => (item.id === response.user.id ? response.user : item)));
    setGenerated({ email: response.user.email, password: response.temporaryPassword });
  }

  async function copyPassword() {
    if (!generated) {
      return;
    }
    await navigator.clipboard?.writeText(generated.password);
    showToast('Password copied.');
  }

  return (
    <section className="page-section">
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p>Create accounts, assign roles, and reset temporary passwords.</p>
        </div>
        <button className="button button--primary" type="button" onClick={() => setIsAddOpen(true)}>
          <UserPlus aria-hidden="true" size={18} />
          Add User
        </button>
      </header>

      {generated ? (
        <section className="generated-password-panel">
          <div>
            <strong>Temporary password for {generated.email}</strong>
            <code>{generated.password}</code>
          </div>
          <button className="button button--secondary" type="button" onClick={() => void copyPassword()}>
            <Copy aria-hidden="true" size={16} />
            Copy
          </button>
        </section>
      ) : null}

      {isLoading ? <div className="state-panel table-card">Loading users...</div> : null}
      {error ? <div className="state-panel state-panel--error table-card">{error}</div> : null}

      {!isLoading && !error ? (
        <section className="table-card users-table">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{user.role === 'admin' ? 'Admin' : 'Superadmin'}</td>
                    <td>{user.mustChangePassword ? 'Must change password' : 'Active'}</td>
                    <td>
                      <button className="button button--secondary" type="button" onClick={() => void handleResetPassword(user)}>
                        <RotateCcw aria-hidden="true" size={16} />
                        Reset
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {isAddOpen ? (
        <div className="modal-backdrop">
          <form className="modal modal--narrow modal-form" onSubmit={handleCreateUser}>
            <div className="modal__header">
              <h2>Add User</h2>
              <button className="button button--secondary" type="button" onClick={() => setIsAddOpen(false)}>
                Cancel
              </button>
            </div>
            <label>
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
            </label>
            <label>
              Role
              <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
                <option value="superadmin">Superadmin</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button className="button button--primary" type="submit">
              Create User
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 6: Add Users route and role-gated navigation**

In `src/client/components/Sidebar.tsx`, add `Users` icon import and prop:

```ts
import { Clapperboard, Film, LayoutDashboard, Plus, Search, Send, Tv, Users } from 'lucide-react';
import type { UserRole } from '../auth/types';
```

Extend `PageKey` with `'users'`.

Add prop:

```ts
userRole: UserRole;
```

Build visible items with:

```ts
const visibleItems = userRole === 'admin'
  ? [...items, { key: 'users' as const, label: 'Users', icon: Users }]
  : items;
```

Render `visibleItems.map(...)`.

In `src/client/App.tsx`, import `UsersPage` and `AccountMenu`, add `'users'` to `refreshSafePages`, render the Users page only for admins:

```tsx
if (page === 'users') {
  if (currentUser.role !== 'admin') {
    return <div className="state-panel state-panel--error">You do not have permission to manage users.</div>;
  }
  return <UsersPage />;
}
```

Pass `userRole={user.role}` to `Sidebar`.

Render `AccountMenu` near the top of `.content-shell`:

```tsx
<div className="content-shell__topbar">
  <AccountMenu
    user={user}
    onChangePassword={() => setPage('change-password')}
    onSignOut={onSignOut}
  />
</div>
```

If using a dedicated `change-password` page inside the authenticated app, add it as a non-refresh-safe `PageKey` and render `ChangePasswordPage` with the current user and `onChangePassword`.

- [ ] **Step 7: Run client tests**

Run:

```powershell
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/client/auth/auth-api.ts src/client/components/AccountMenu.tsx src/client/components/Sidebar.tsx src/client/pages/UsersPage.tsx src/client/App.tsx tests/client/App.test.tsx
git commit -m "feat: add admin user management UI"
```

---

### Task 8: Modern Responsive Styling

**Files:**
- Modify: `src/client/styles.css`
- Modify: `tests/client/App.test.tsx`

- [ ] **Step 1: Add login UI regression assertions**

In the login test from Task 6, add:

```ts
expect(screen.getByRole('main')).toHaveClass('auth-page');
expect(screen.getByRole('button', { name: /^login$/i })).toHaveClass('auth-card__submit');
```

- [ ] **Step 2: Run client test and verify it fails**

Run:

```powershell
npm.cmd test -- tests/client/App.test.tsx
```

Expected: FAIL until the final class names and styles are in place.

- [ ] **Step 3: Add responsive auth and user styles**

Append focused styles to `src/client/styles.css`:

```css
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #f6f8fb;
  padding: 20px;
}

.auth-card {
  width: min(100%, 420px);
  overflow: hidden;
  border: 1px solid #dbe4ef;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgb(15 23 42 / 12%);
}

.auth-card__accent {
  height: 6px;
  background: linear-gradient(90deg, #2563eb, #0ea5e9, #14b8a6);
}

.auth-card__body {
  display: grid;
  gap: 18px;
  padding: 26px;
}

.auth-card__brand {
  display: grid;
  place-items: center;
  gap: 12px;
  text-align: center;
}

.auth-card__brand h1 {
  margin: 0;
  color: #0f172a;
  font-size: 1.45rem;
  letter-spacing: 0;
}

.auth-card__brand p {
  margin: 4px 0 0;
  color: #64748b;
}

.auth-card__mark {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border: 1px solid #d8e9ff;
  border-radius: 8px;
  background: #eef6ff;
  color: #1d4ed8;
  font-weight: 900;
}

.auth-card__error {
  padding: 12px;
}

.auth-input {
  position: relative;
  display: block;
}

.auth-input svg {
  position: absolute;
  left: 12px;
  top: 50%;
  color: #94a3b8;
  transform: translateY(-50%);
}

.auth-input input {
  background: #ffffff;
  padding-left: 40px;
}

.auth-card__submit {
  width: 100%;
  min-height: 46px;
  box-shadow: 0 10px 24px rgb(37 99 235 / 24%);
}

.auth-loading {
  width: min(100%, 420px);
  background: #ffffff;
}

.content-shell__topbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 14px;
}

.account-menu {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.account-menu__identity {
  display: grid;
  gap: 1px;
  min-width: 0;
  text-align: right;
}

.account-menu__identity strong {
  color: #0f172a;
  overflow-wrap: anywhere;
}

.account-menu__identity span {
  color: #64748b;
  font-size: 0.82rem;
  font-weight: 750;
}

.generated-password-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  padding: 14px;
}

.generated-password-panel strong,
.generated-password-panel code {
  display: block;
}

.generated-password-panel code {
  margin-top: 6px;
  color: #0f172a;
  overflow-wrap: anywhere;
  font-size: 0.95rem;
}

.users-table td:last-child,
.users-table th:last-child {
  width: 1%;
  white-space: nowrap;
}

@media (max-width: 559px) {
  .auth-page {
    padding: 14px;
  }

  .auth-card__body {
    padding: 22px;
  }

  .content-shell__topbar {
    justify-content: stretch;
  }

  .account-menu {
    width: 100%;
    justify-content: space-between;
  }

  .account-menu__identity {
    text-align: left;
  }
}
```

- [ ] **Step 4: Run client tests**

Run:

```powershell
npm.cmd test -- tests/client/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/client/styles.css tests/client/App.test.tsx
git commit -m "style: polish responsive auth UI"
```

---

### Task 9: Build Fixes, End-To-End Auth Verification, And Public Bot Guardrail

**Files:**
- Modify only files under `src/`, `tests/`, root config/docs if verification exposes issues.
- Do not modify: `apps/public-search-bot/**`

- [ ] **Step 1: Run full test suite**

Run:

```powershell
npm.cmd test
```

Expected: PASS.

If failures occur because tests call protected APIs without signing in, update those tests to create a session using the Auth.js CSRF + credentials helper from Task 4 instead of disabling auth middleware.

- [ ] **Step 2: Run TypeScript and production build**

Run:

```powershell
npm.cmd run build
```

Expected: PASS.

Common expected fixes:

- Auth.js type augmentation may need small import path corrections.
- Auth.js Express types may require using `AuthConfig` from `@auth/core`.
- Client tests may need one more `/api/auth/me` mock in branches that replace `fetchMock.mockImplementation`.

- [ ] **Step 3: Verify public-search-bot is untouched**

Run:

```powershell
git diff --name-only HEAD -- apps/public-search-bot
```

Expected: no output.

- [ ] **Step 4: Optional release verification if package/build behavior changed**

Because this implementation adds an Auth.js dependency and updates schema assets, run:

```powershell
npm.cmd run build:release:win
npm.cmd run verify:release:win
```

Expected: both commands pass. If the release build fails because the packager misses Auth.js dynamic files, fix the release build script in `scripts/build-windows-release.ts` and verify again.

- [ ] **Step 5: Manual local smoke**

Start the app:

```powershell
npm.cmd run dev
```

Use a local test `.env` containing:

```env
AUTH_SECRET=local_auth_secret_32_chars_minimum_value
ADMIN_EMAIL=admin@example.com
```

Expected terminal output includes the one-time bootstrap password if the database has no admin. Open `http://127.0.0.1:3000`, log in, change the forced password, open Users, create a `superadmin`, sign out, sign in as the `superadmin`, confirm Users is hidden, sign back in as `admin`, reset the `superadmin` password, and confirm the reset password can log in.

- [ ] **Step 6: Commit final verification fixes**

If Step 1-5 required code changes, commit them:

```powershell
git add src tests package.json package-lock.json .env.example schema.sql
git commit -m "fix: complete auth verification"
```

Skip this commit if there were no changes after the prior task commits.

---

## Self-Review

Spec coverage:

- Auth.js Credentials login: Tasks 1, 4, 5, and 6.
- Session endpoint and logout: Tasks 4, 5, 6, and 7.
- Protect existing admin APIs: Task 4.
- React shell login gate: Task 6.
- Bootstrap first admin: Task 3.
- Admin-only user management: Tasks 5 and 7.
- Generated temporary passwords: Tasks 2, 3, 5, and 7.
- Forced password change: Tasks 5 and 6.
- Own-password change: Tasks 5, 6, and 7.
- Modern responsive UI: Task 8.
- Public-search-bot unaffected: File Structure and Task 9.

Placeholder scan:

- No red-flag marker strings or intentionally vague future-work steps are present.
- Steps that change code include concrete code blocks or exact code shapes.

Type consistency:

- Server role type is `AuthUserRole = 'admin' | 'superadmin'`.
- Client role type is `UserRole = 'admin' | 'superadmin'`.
- Session property is consistently `mustChangePassword` on API/client and `must_change_password` in SQLite.
- Generated password response is consistently `temporaryPassword`.

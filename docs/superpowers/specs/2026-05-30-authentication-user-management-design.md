# Authentication And User Management Design

## Goal

Add Auth.js-based email/password login to the local InfinityLinks admin app.

The app should support two roles:

- `admin`: can use all existing InfinityLinks pages and manage users.
- `superadmin`: can use all existing InfinityLinks pages and change their own password, but cannot add users or reset passwords.

There is no public signup and no Apple, Google, or X login. Accounts are created only by an `admin`.

## Selected Approach

Use Auth.js for authenticated session handling and keep InfinityLinks-specific user management in local SQLite tables.

Auth.js will provide the session cookie and Credentials login flow. InfinityLinks will own:

- User records.
- Roles.
- Password hashing and verification.
- Generated temporary password lifecycle.
- Forced password-change state.
- User-management API authorization.

This keeps the current Express + React + SQLite app structure intact while still using Auth.js for the session layer.

The implementation should use the official Express integration, `@auth/express`, with a Credentials provider mounted at `/auth/*`. The official docs currently mark `@auth/express` as experimental, so Auth.js-specific code should be isolated in a small auth module rather than spread through the app.

## Scope

In scope:

- Auth.js Credentials login.
- Session endpoint and logout behavior.
- Protecting existing admin API routes behind a valid session.
- Protecting the React admin shell behind login.
- Bootstrap creation of the first `admin` account.
- Admin-only user management page.
- Creating users with generated temporary passwords.
- Resetting user passwords with generated temporary passwords.
- Forced password-change flow after generated passwords.
- Own-password change flow for logged-in users.
- Server and client tests for auth, roles, and UI gating.
- Modern responsive login screen based on the approved white UI direction.

Out of scope:

- Public signup.
- OAuth providers.
- Email delivery.
- Forgot-password email flow.
- Account deletion.
- Fine-grained permissions for Movies, TV Shows, Public Search, or Telegram Jobs.
- Remote multi-tenant deployment.

## Environment Configuration

Add authentication environment variables:

```env
AUTH_SECRET=replace_with_at_least_32_random_characters
ADMIN_EMAIL=admin@example.com
```

`AUTH_SECRET` is required for Auth.js session signing and must be a random value of at least 32 characters.

`ADMIN_EMAIL` is used only for bootstrap. On startup, if no `admin` user exists, the app creates one with this email and prints a generated temporary password to the terminal. If no users exist and `ADMIN_EMAIL` is missing, startup should fail with a clear error.

The generated bootstrap password is shown once in the terminal. It is not stored in plain text.

## Data Model

Add an `auth_users` table:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `email TEXT NOT NULL UNIQUE`
- `role TEXT NOT NULL CHECK (role IN ('admin', 'superadmin'))`
- `password_hash TEXT NOT NULL`
- `must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1))`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `last_login_at TEXT`

For existing databases, migration should create the new table without changing existing media, Telegram, TMDB, or public-search tables.

Password hashes should use a server-side password hashing helper built on Node's `crypto.scrypt` with a unique random salt per password. This avoids adding a native dependency. Hash strings should include the algorithm, parameters, salt, and derived key so future migrations are possible.

Generated temporary passwords should use `crypto.randomBytes` or `crypto.randomInt` and be high entropy. They should be returned only once from create/reset responses or printed once during bootstrap.

## Backend Architecture

Add a focused auth module:

- `auth.repository`: reads and writes `auth_users`.
- `auth.passwords`: generates temporary passwords, hashes passwords, verifies passwords, and validates replacement password strength.
- `auth.bootstrap`: creates the first `admin` user when needed.
- `auth.config` or `auth.authjs`: builds the Auth.js Express configuration and Credentials provider.
- `auth.middleware`: loads the session user and enforces authenticated/role-specific access.
- `auth.routes`: app-owned auth endpoints such as current user and change password.
- `admin.users.routes`: admin-only user management endpoints.

Auth.js should be mounted before protected `/api` routes. Existing API routes should continue to use the current local request guard, then also require an authenticated session.

Routes:

- `GET /api/auth/me`: returns the current user session shape for the React app.
- `POST /api/auth/change-password`: changes the logged-in user's password and clears `must_change_password`.
- Auth.js Credentials endpoints under `/auth/*` for sign-in, sign-out, CSRF, and session handling.
- `GET /api/admin/users`: lists users; `admin` only.
- `POST /api/admin/users`: creates a user; `admin` only.
- `POST /api/admin/users/:id/reset-password`: resets a user's password; `admin` only.

The Auth.js session user should include only safe fields:

- `id`
- `email`
- `role`
- `mustChangePassword`

It must not include password hashes or generated passwords.

## Authorization Rules

Authenticated `admin` users can:

- Access all existing InfinityLinks admin pages.
- View users.
- Create `admin` or `superadmin` users.
- Reset any user's password, including a `superadmin`.
- Change their own password.

Authenticated `superadmin` users can:

- Access all existing InfinityLinks admin pages.
- Change their own password.

Authenticated `superadmin` users cannot:

- View the Users page.
- Create users.
- Reset user passwords.

Unauthenticated users cannot access existing app pages or `/api/*` admin data.

## Client UI

The login screen should follow the approved modern responsive direction:

- White page/card treatment.
- White email and password fields with light borders.
- InfinityLinks branding.
- No signup copy.
- No Apple, Google, or X buttons.
- Clear generic error message for failed login.
- Mobile-friendly card sizing and spacing.

The React shell should load the current session before rendering protected content:

- No session: show login screen.
- Session with `mustChangePassword`: show password-change screen.
- Session without forced password change: show the app.

Add a Users page visible only to `admin` users. It should include:

- Responsive header with Add User button.
- User list with email, role, password status, and reset action.
- Mobile card layout when table columns would become cramped.
- Add User dialog with email and role selector.
- One-time generated password success panel with a copy action.
- Reset Password flow with confirmation and one-time generated password display.

Add account controls to the shell:

- Show logged-in email and role.
- Change Password action.
- Sign Out action.

## Data Flow

### Bootstrap

1. Server starts and runs migrations.
2. Bootstrap checks whether an `admin` user exists.
3. If no `admin` exists, it requires `ADMIN_EMAIL`.
4. It generates a temporary password, hashes it, inserts the `admin` user, marks `must_change_password = 1`, and prints the password once.

### Login

1. User enters email and password.
2. Auth.js Credentials `authorize` handler normalizes the email.
3. The backend looks up the user by email.
4. Password verification runs against the stored hash.
5. On success, Auth.js creates the session and returns safe user fields.
6. The client refreshes current session state.

Failed login should return a generic invalid-credentials message. It should not reveal whether the email exists.

### Create User

1. `admin` opens Users and chooses Add User.
2. They enter email and choose `admin` or `superadmin`.
3. Backend validates role and duplicate email.
4. Backend generates a temporary password, hashes it, inserts the user, and marks `must_change_password = 1`.
5. UI displays the generated password once.

### Reset Password

1. `admin` selects Reset Password for a user.
2. Backend generates a temporary password, hashes it, updates the user, and marks `must_change_password = 1`.
3. UI displays the generated password once.
4. The reset user can log in with the temporary password and change it.

### Change Password

1. Logged-in user enters current password and new password.
2. Backend verifies the current password.
3. Backend validates replacement password strength.
4. Backend stores the new hash and clears `must_change_password`.
5. Client returns to the main app.

## Error Handling

Return clear, safe errors:

- Invalid login: `Invalid email or password.`
- Duplicate user email: `A user with that email already exists.`
- Forbidden user management: `You do not have permission to manage users.`
- Missing session: `Authentication required.`
- Weak password: explain the password rule without exposing internals.
- Missing bootstrap config: explain that `ADMIN_EMAIL` is required when no admin user exists.

Never log generated passwords after the one-time bootstrap print. Never log password hashes.

## Security Notes

The current local request guard should stay in place. Auth adds identity and role enforcement on top of the existing same-origin/loopback guard.

Session cookies should use Auth.js defaults appropriate for the local HTTP app. The implementation should avoid weakening cookie settings beyond what local development requires.

All mutating auth and user-management routes should keep using the app's fetch header conventions where applicable.

Generated passwords should be temporary operational secrets. The UI should make it clear that the Admin must copy them immediately.

## Testing

Server tests should cover:

- Migration creates `auth_users`.
- Bootstrap creates the first `admin` when no admin exists.
- Bootstrap fails clearly if no admin exists and `ADMIN_EMAIL` is missing.
- Credentials login succeeds with a valid password.
- Credentials login fails generically with an invalid email or password.
- Protected existing API routes reject unauthenticated requests.
- Protected existing API routes allow authenticated requests.
- `admin` can list and create users.
- `superadmin` cannot list or create users.
- `admin` can reset a `superadmin` password.
- Password reset marks `must_change_password`.
- Change password clears `must_change_password`.
- Password hashes never equal generated/plain passwords.

Client tests should cover:

- App shows login when no session exists.
- App shows forced password-change screen when required.
- App shows main shell after authenticated login state.
- Users navigation is visible to `admin`.
- Users navigation is hidden from `superadmin`.
- Add User displays a generated password once.
- Reset Password displays a generated password once.
- Login screen has no signup or social provider buttons.

After implementation, run:

```sh
npm.cmd test
npm.cmd run build
```

If release packaging is touched by Auth.js dependencies or schema copying, also run:

```sh
npm.cmd run build:release:win
npm.cmd run verify:release:win
```

## Acceptance Criteria

- The local app requires login before showing admin content.
- The login UI is white, modern, responsive, and excludes signup/social login options.
- The first `admin` can be bootstrapped from `.env`.
- Passwords are stored only as hashes.
- Generated passwords are shown only once.
- `admin` users can create users and reset passwords.
- `superadmin` users cannot manage users.
- Both roles can use the existing InfinityLinks pages.
- Users with generated passwords are prompted to change their password after login.
- A `superadmin` whose password was reset can log in again and change it.
- Tests cover auth, role enforcement, generated password lifecycle, and UI gating.

## Risks

`@auth/express` is currently experimental, so API changes are possible. Keeping the integration isolated reduces future maintenance cost.

Auth.js Credentials flows require CSRF-aware client calls. The implementation should follow the official Auth.js REST flow instead of bypassing CSRF protections.

Adding auth to a previously local-only app can accidentally break test setup or API smoke tests. Tests should create authenticated sessions through helpers rather than disabling middleware.

The Windows release build may need verification if Auth.js introduces packaging constraints. Release verification should be included if dependency behavior affects the packaged executable.

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
  const row = db.prepare("SELECT COUNT(*) AS count FROM auth_users WHERE role = 'admin'").get() as {
    count: number;
  };
  return row.count > 0;
}

export function countAdminUsers(db: AppDatabase) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM auth_users WHERE role = 'admin'").get() as {
    count: number;
  };
  return row.count;
}

export function listAuthUsers(db: AppDatabase): PublicAuthUser[] {
  const rows = db.prepare('SELECT * FROM auth_users ORDER BY email ASC').all() as AuthUserRow[];

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

export function updateAuthUserPassword(
  db: AppDatabase,
  id: number,
  passwordHash: string,
  mustChangePassword: boolean
) {
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

export function updateAuthUser(
  db: AppDatabase,
  id: number,
  input: { email: string; role: AuthUserRole }
): PublicAuthUser | undefined {
  const result = db
    .prepare(
      `UPDATE auth_users
          SET email = ?,
              role = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
    )
    .run(normalizeAuthEmail(input.email), input.role, id);

  if (result.changes === 0) {
    return undefined;
  }

  const user = findAuthUserById(db, id);
  return user ? toPublicAuthUser(user) : undefined;
}

export function deleteAuthUser(db: AppDatabase, id: number) {
  const result = db.prepare('DELETE FROM auth_users WHERE id = ?').run(id);
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

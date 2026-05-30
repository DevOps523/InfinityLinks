import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, type AppDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { resolveRuntimePath } from '../runtime/paths.js';
import { generateTemporaryPassword, hashPassword } from './passwords.js';
import {
  findFirstAdminUser,
  findAuthUserByEmail,
  normalizeAuthEmail,
  updateAuthUserPassword
} from './users.repository.js';

type ResetAdminPasswordOptions = {
  email?: string;
};

type ResetAdminPasswordResult = {
  email: string;
  temporaryPassword: string;
};

export function resetAdminPassword(db: AppDatabase, options: ResetAdminPasswordOptions): ResetAdminPasswordResult {
  const email = options.email ? normalizeAuthEmail(options.email) : undefined;
  const user = email ? findAuthUserByEmail(db, email) : findFirstAdminUser(db);

  if (!user) {
    throw new Error(email ? `Admin user not found: ${email}` : 'No admin users found.');
  }

  if (user.role !== 'admin') {
    throw new Error('Only admin users can be reset with this command.');
  }

  const temporaryPassword = generateTemporaryPassword();
  const updated = updateAuthUserPassword(db, user.id, hashPassword(temporaryPassword), true);

  if (!updated) {
    throw new Error(`Admin password reset failed for ${user.email}.`);
  }

  return {
    email: user.email,
    temporaryPassword
  };
}

function getArgValue(name: string) {
  const prefix = `${name}=`;
  const inlineValue = process.argv.find((arg) => arg.startsWith(prefix));

  if (inlineValue) {
    return inlineValue.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  if (index !== -1) {
    return process.argv[index + 1];
  }

  return undefined;
}

function resolveDatabasePath() {
  const databasePath = process.env.DATABASE_PATH ?? './data/infinitylinks.sqlite';

  if (databasePath === ':memory:' || path.isAbsolute(databasePath)) {
    return databasePath;
  }

  return resolveRuntimePath(databasePath);
}

function runCli() {
  const db = createDatabase(resolveDatabasePath());

  try {
    migrate(db);
    const result = resetAdminPassword(db, { email: getArgValue('--email') });
    console.log(`Admin password reset for ${result.email}`);
    console.log(`Temporary admin password: ${result.temporaryPassword}`);
    console.log('Copy this password now. It will not be shown again.');
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}

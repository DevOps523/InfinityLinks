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

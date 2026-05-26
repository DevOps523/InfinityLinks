import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicSearchDatabase, type PublicSearchDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolvePublicSearchSchemaPath() {
  const candidates = [
    path.join(__dirname, 'schema.sql'),
    path.resolve(process.cwd(), 'src/db/schema.sql')
  ];

  const schemaPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!schemaPath) {
    throw new Error(`Unable to find public search schema.sql. Checked: ${candidates.join(', ')}`);
  }

  return schemaPath;
}

export function migratePublicSearchDatabase(db: PublicSearchDatabase) {
  const schema = fs.readFileSync(resolvePublicSearchSchemaPath(), 'utf8');
  db.exec(schema);
  rebuildSubscriptionUsersBooleanConstraintIfNeeded(db);
  rebuildSubscriptionJobsLeaseShapeIfNeeded(db);
  db.exec(schema);
}

function rebuildSubscriptionUsersBooleanConstraintIfNeeded(db: PublicSearchDatabase) {
  const row = db
    .prepare(
      `SELECT sql
       FROM sqlite_schema
       WHERE type = 'table'
         AND name = 'subscription_users'`
    )
    .get() as { sql: string } | undefined;

  if (!row || row.sql.includes('CHECK (removed_from_group IN (0, 1))')) {
    return;
  }

  const previousForeignKeys = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');

  try {
    db.exec(`
      DROP TABLE IF EXISTS subscription_users_new;

      CREATE TABLE subscription_users_new (
        telegram_user_id INTEGER PRIMARY KEY,
        username TEXT,
        trial_started_at TEXT,
        trial_expires_at TEXT,
        subscription_start_date TEXT,
        subscription_end_date TEXT,
        days_remaining INTEGER,
        status TEXT NOT NULL DEFAULT 'Unpaid'
          CHECK (status IN ('Trial', 'Subscribe', 'Needs Attention', 'Unpaid', 'Kicked')),
        unpaid_since TEXT,
        kicked_at TEXT,
        removed_from_group INTEGER NOT NULL DEFAULT 0 CHECK (removed_from_group IN (0, 1)),
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO subscription_users_new (
        telegram_user_id,
        username,
        trial_started_at,
        trial_expires_at,
        subscription_start_date,
        subscription_end_date,
        days_remaining,
        status,
        unpaid_since,
        kicked_at,
        removed_from_group,
        last_seen_at,
        created_at,
        updated_at
      )
      SELECT
        telegram_user_id,
        username,
        trial_started_at,
        trial_expires_at,
        subscription_start_date,
        subscription_end_date,
        days_remaining,
        status,
        unpaid_since,
        kicked_at,
        CASE WHEN removed_from_group = 1 THEN 1 ELSE 0 END,
        last_seen_at,
        created_at,
        updated_at
      FROM subscription_users;

      DROP TABLE subscription_users;
      ALTER TABLE subscription_users_new RENAME TO subscription_users;
    `);
  } finally {
    db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
  }
}

function rebuildSubscriptionJobsLeaseShapeIfNeeded(db: PublicSearchDatabase) {
  const row = db
    .prepare(
      `SELECT sql
       FROM sqlite_schema
       WHERE type = 'table'
         AND name = 'subscription_jobs'`
    )
    .get() as { sql: string } | undefined;

  if (!row || (row.sql.includes('claimed_at') && row.sql.includes('json_valid(payload_json)'))) {
    return;
  }

  const columns = db.pragma('table_info(subscription_jobs)') as Array<{ name: string }>;
  const hasClaimedAt = columns.some((column) => column.name === 'claimed_at');
  const claimedAtSelect = hasClaimedAt ? 'claimed_at' : 'NULL AS claimed_at';
  const previousForeignKeys = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');

  try {
    db.exec(`
      DROP TABLE IF EXISTS subscription_jobs_new;

      CREATE TABLE subscription_jobs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('refresh-alert', 'kick-user', 'refresh-sheet')),
        payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        run_after TEXT NOT NULL,
        claimed_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO subscription_jobs_new (
        id,
        type,
        payload_json,
        status,
        attempts,
        run_after,
        claimed_at,
        last_error,
        created_at,
        updated_at
      )
      SELECT
        id,
        type,
        CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,
        status,
        attempts,
        run_after,
        ${claimedAtSelect},
        last_error,
        created_at,
        updated_at
      FROM subscription_jobs;

      DROP TABLE subscription_jobs;
      ALTER TABLE subscription_jobs_new RENAME TO subscription_jobs;
    `);
  } finally {
    db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = createPublicSearchDatabase(process.env.PUBLIC_SEARCH_DATABASE_PATH ?? './data/public-search.sqlite');
  migratePublicSearchDatabase(db);
  db.close();
  console.log('Public search database migrated');
}

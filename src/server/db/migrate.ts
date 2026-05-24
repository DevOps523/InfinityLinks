import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, type AppDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveSchemaPath() {
  const candidates = [
    path.join(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../../../src/server/db/schema.sql'),
    path.resolve(process.cwd(), 'src/server/db/schema.sql')
  ];

  const schemaPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!schemaPath) {
    throw new Error(`Unable to find schema.sql. Checked: ${candidates.join(', ')}`);
  }

  return schemaPath;
}

export function migrate(db: AppDatabase) {
  const schema = fs.readFileSync(resolveSchemaPath(), 'utf8');
  db.exec(schema);
  ensureColumn(db, 'seasons', 'needs_repost', 'INTEGER NOT NULL DEFAULT 0 CHECK (needs_repost IN (0, 1))');
}

function ensureColumn(db: AppDatabase, tableName: string, columnName: string, columnDefinition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = createDatabase(process.env.DATABASE_PATH ?? './data/infinitylinks.sqlite');
  migrate(db);
  db.close();
  console.log('Database migrated');
}

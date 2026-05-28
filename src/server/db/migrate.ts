import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPackagedRuntime, resolveSchemaAssetPath } from '../runtime/paths.js';
import { createDatabase, type AppDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveSchemaPath() {
  if (isPackagedRuntime()) {
    const schemaPath = resolveSchemaAssetPath();

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Missing packaged schema.sql. Expected ${schemaPath}`);
    }

    return schemaPath;
  }

  const sourceOrBuildCandidates = [
    path.join(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../../../src/server/db/schema.sql'),
    path.resolve(process.cwd(), 'src/server/db/schema.sql')
  ];
  const candidates = [...sourceOrBuildCandidates, resolveSchemaAssetPath()];

  const schemaPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!schemaPath) {
    throw new Error(`Unable to find schema.sql. Checked: ${candidates.join(', ')}`);
  }

  return schemaPath;
}

export function migrate(db: AppDatabase) {
  const schema = fs.readFileSync(resolveSchemaPath(), 'utf8');
  db.exec(schema);
  ensureColumn(db, 'movies', 'topic_key', "TEXT NOT NULL DEFAULT 'FOREIGN_MOVIES' CHECK (topic_key IN ('FOREIGN_MOVIES', 'PINOY_MOVIES', 'ANIME', 'VIVAMAX'))");
  ensureColumn(db, 'tv_shows', 'topic_key', "TEXT NOT NULL DEFAULT 'FOREIGN_TV_SERIES' CHECK (topic_key IN ('FOREIGN_TV_SERIES', 'PINOY_TV_SERIES', 'ANIME', 'VIVAMAX'))");
  ensureColumn(db, 'seasons', 'needs_repost', 'INTEGER NOT NULL DEFAULT 0 CHECK (needs_repost IN (0, 1))');
  db.prepare("UPDATE movies SET topic_key = 'FOREIGN_MOVIES' WHERE topic_key IS NULL OR TRIM(topic_key) = ''").run();
  db.prepare("UPDATE tv_shows SET topic_key = 'FOREIGN_TV_SERIES' WHERE topic_key IS NULL OR TRIM(topic_key) = ''").run();
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

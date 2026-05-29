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
  removeDescriptionColumns(db);
}

function ensureColumn(db: AppDatabase, tableName: string, columnName: string, columnDefinition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

function hasColumn(db: AppDatabase, tableName: string, columnName: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function getForeignKeysEnabled(db: AppDatabase) {
  const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: 0 | 1 };
  return row.foreign_keys === 1;
}

function assertNoForeignKeyViolations(db: AppDatabase) {
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    throw new Error(`Foreign key check failed after description removal migration: ${JSON.stringify(violations)}`);
  }
}

function rebuildMoviesWithoutDescription(db: AppDatabase) {
  db.exec(`
    CREATE TABLE movies_without_description (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER,
      title TEXT NOT NULL,
      year INTEGER,
      poster_url TEXT,
      rating REAL,
      quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
      topic_key TEXT NOT NULL DEFAULT 'FOREIGN_MOVIES' CHECK (topic_key IN ('FOREIGN_MOVIES', 'PINOY_MOVIES', 'ANIME', 'VIVAMAX')),
      telegram_message_id INTEGER,
      post_status TEXT NOT NULL DEFAULT 'pending' CHECK (post_status IN ('pending', 'posted', 'failed', 'deleted')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO movies_without_description (
      id, tmdb_id, title, year, poster_url, rating, quality, topic_key,
      telegram_message_id, post_status, created_at, updated_at
    )
    SELECT
      id, tmdb_id, title, year, poster_url, rating, quality, topic_key,
      telegram_message_id, post_status, created_at, updated_at
    FROM movies;
    DROP TABLE movies;
    ALTER TABLE movies_without_description RENAME TO movies;
  `);
}

function rebuildTvShowsWithoutDescription(db: AppDatabase) {
  db.exec(`
    CREATE TABLE tv_shows_without_description (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER,
      title TEXT NOT NULL,
      year INTEGER,
      poster_url TEXT,
      rating REAL,
      quality TEXT NOT NULL CHECK (quality IN ('SD', 'HD', 'Full HD', '2K', '4K')),
      topic_key TEXT NOT NULL DEFAULT 'FOREIGN_TV_SERIES' CHECK (topic_key IN ('FOREIGN_TV_SERIES', 'PINOY_TV_SERIES', 'ANIME', 'VIVAMAX')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tv_shows_without_description (
      id, tmdb_id, title, year, poster_url, rating, quality, topic_key, created_at, updated_at
    )
    SELECT
      id, tmdb_id, title, year, poster_url, rating, quality, topic_key, created_at, updated_at
    FROM tv_shows;
    DROP TABLE tv_shows;
    ALTER TABLE tv_shows_without_description RENAME TO tv_shows;
  `);
}

function removeDescriptionColumns(db: AppDatabase) {
  const shouldRebuildMovies = hasColumn(db, 'movies', 'description');
  const shouldRebuildTvShows = hasColumn(db, 'tv_shows', 'description');
  if (!shouldRebuildMovies && !shouldRebuildTvShows) {
    return;
  }

  const restoreForeignKeys = getForeignKeysEnabled(db);
  db.pragma('foreign_keys = OFF');

  try {
    db.transaction(() => {
      if (shouldRebuildMovies) {
        rebuildMoviesWithoutDescription(db);
      }
      if (shouldRebuildTvShows) {
        rebuildTvShowsWithoutDescription(db);
      }
    })();
    assertNoForeignKeyViolations(db);
  } finally {
    if (restoreForeignKeys) {
      db.pragma('foreign_keys = ON');
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = createDatabase(process.env.DATABASE_PATH ?? './data/infinitylinks.sqlite');
  migrate(db);
  db.close();
  console.log('Database migrated');
}

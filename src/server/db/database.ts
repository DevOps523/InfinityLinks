import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type AppDatabase = Database.Database;

export function createDatabase(databasePath: string): AppDatabase {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  return db;
}

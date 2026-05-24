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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = createPublicSearchDatabase(process.env.PUBLIC_SEARCH_DATABASE_PATH ?? './data/public-search.sqlite');
  migratePublicSearchDatabase(db);
  db.close();
  console.log('Public search database migrated');
}

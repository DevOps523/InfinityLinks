import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/database.js';
import { migrate } from './db/migrate.js';

const config = loadConfig(process.env);
const db = createDatabase(config.databasePath);
migrate(db);

createApp({ db, config }).listen(config.port, config.host, () => {
  console.log(`InfinityLinks admin running at http://${config.host}:${config.port}`);
});

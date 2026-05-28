import dotenv from 'dotenv';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/database.js';
import { migrate } from './db/migrate.js';
import { resolveClientDistPath, resolveRuntimePath } from './runtime/paths.js';
import { createTelegramClient } from './telegram/telegram.client.js';
import { processNextTelegramJob } from './telegram/telegram.queue.js';

dotenv.config({ path: resolveRuntimePath('.env') });

const config = loadConfig(process.env);
resolveClientDistPath();

const db = createDatabase(config.databasePath);
migrate(db);

const app = createApp({ db, config });
const telegramClient = createTelegramClient({
  botToken: config.telegramBotToken,
  channelId: config.telegramChannelId
});

let isProcessingTelegramJob = false;

setInterval(() => {
  if (isProcessingTelegramJob) {
    return;
  }

  isProcessingTelegramJob = true;
  processNextTelegramJob(db, telegramClient)
    .catch((error: unknown) => {
      console.error('Telegram queue worker failed', error);
    })
    .finally(() => {
      isProcessingTelegramJob = false;
    });
}, 1500);

app.listen(config.port, config.host, () => {
  console.log(`InfinityLinks admin running at http://${config.host}:${config.port}`);
});

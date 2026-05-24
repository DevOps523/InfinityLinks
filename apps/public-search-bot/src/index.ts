import 'dotenv/config';
import { createPublicSearchApp } from './app.js';
import { loadPublicSearchConfig } from './config.js';
import { createPublicSearchDatabase } from './db/database.js';
import { migratePublicSearchDatabase } from './db/migrate.js';
import { createFixedWindowRateLimiter } from './rate-limit.js';
import { createPublicTelegramClient } from './telegram.client.js';
import { createTelegramReplyQueue } from './telegram.reply-queue.js';
import { handleTelegramUpdate } from './bot/handlers.js';
import { pollOnce, type PollState } from './poller.js';

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  const config = loadPublicSearchConfig(process.env);
  const db = createPublicSearchDatabase(config.publicSearchDatabasePath);
  migratePublicSearchDatabase(db);

  const app = createPublicSearchApp({ db, config });
  app.listen(config.publicSearchPort, config.publicSearchHost, () => {
    console.log(
      `Public search sync API listening on http://${config.publicSearchHost}:${config.publicSearchPort}`
    );
  });

  const telegram = createPublicTelegramClient({ botToken: config.publicBotToken });
  const replies = createTelegramReplyQueue(telegram);
  const rateLimiter = createFixedWindowRateLimiter({
    limit: 5,
    windowMs: 60_000
  });
  const pollState: PollState = {};

  while (true) {
    try {
      await pollOnce(pollState, telegram, (update) =>
        handleTelegramUpdate(
          {
            db,
            telegram,
            replies,
            rateLimiter,
            channelHandle: config.publicSearchChannelHandle,
            groupHandle: config.publicSearchGroupHandle
          },
          update
        )
      );
    } catch (error) {
      console.error('Public search polling failed', error);
      await delay(1_000);
    }
  }
}

main().catch((error) => {
  console.error('Public search service failed to start', error);
  process.exitCode = 1;
});

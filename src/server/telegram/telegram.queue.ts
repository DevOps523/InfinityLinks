import type { AppDatabase } from '../db/database.js';
import { TelegramRateLimitError, type createTelegramClient } from './telegram.client.js';

export type TelegramJobType = 'send' | 'edit' | 'delete';
export type TelegramEntityType = 'movie' | 'season';

export type TelegramJobPayload =
  | {
      photo: string;
      caption: string;
    }
  | {
      messageId: number;
      caption: string;
    }
  | {
      messageId: number;
    };

type TelegramClient = ReturnType<typeof createTelegramClient>;

type TelegramJobRow = {
  id: number;
  job_type: TelegramJobType;
  payload: string;
};

function formatSqliteTimestamp(date: Date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function enqueueTelegramJob(
  db: AppDatabase,
  jobType: TelegramJobType,
  entityType: TelegramEntityType,
  entityId: number,
  payload: TelegramJobPayload
) {
  return db
    .prepare(
      `INSERT INTO telegram_jobs (job_type, entity_type, entity_id, payload, status)
       VALUES (?, ?, ?, ?, 'queued')`
    )
    .run(jobType, entityType, entityId, JSON.stringify(payload));
}

async function runTelegramJob(client: TelegramClient, job: TelegramJobRow) {
  const payload = JSON.parse(job.payload) as TelegramJobPayload;

  if (job.job_type === 'send') {
    await client.sendPhotoPost(payload as { photo: string; caption: string });
    return;
  }

  if (job.job_type === 'edit') {
    await client.editPhotoCaption(payload as { messageId: number; caption: string });
    return;
  }

  await client.deleteMessage(payload as { messageId: number });
}

export async function processNextTelegramJob(db: AppDatabase, client: TelegramClient): Promise<boolean> {
  const job = db.transaction(() => {
    const selected = db
      .prepare(
        `SELECT id, job_type, payload
         FROM telegram_jobs
         WHERE status IN ('queued', 'waiting_retry')
           AND next_run_at <= CURRENT_TIMESTAMP
         ORDER BY next_run_at ASC, created_at ASC, id ASC
         LIMIT 1`
      )
      .get() as TelegramJobRow | undefined;

    if (!selected) {
      return undefined;
    }

    db.prepare(
      `UPDATE telegram_jobs
       SET status = 'running',
           attempts = attempts + 1,
           last_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(selected.id);

    return selected;
  })();

  if (!job) {
    return false;
  }

  try {
    await runTelegramJob(client, job);
    db.prepare(
      `UPDATE telegram_jobs
       SET status = 'succeeded',
           last_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(job.id);
    return true;
  } catch (error) {
    const message = getErrorMessage(error);

    if (error instanceof TelegramRateLimitError) {
      db.prepare(
        `UPDATE telegram_jobs
         SET status = 'waiting_retry',
             next_run_at = ?,
             last_error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(formatSqliteTimestamp(new Date(Date.now() + error.retryAfter * 1000)), message, job.id);
      return false;
    }

    db.prepare(
      `UPDATE telegram_jobs
       SET status = 'failed',
           last_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(message, job.id);
    return false;
  }
}

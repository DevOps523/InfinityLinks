import type Database from 'better-sqlite3';
import type { AppDatabase } from '../db/database.js';
import type { TelegramClient } from './telegram.client.js';

export type TelegramJobType = 'send' | 'edit' | 'delete';
export type TelegramEntityType = 'movie' | 'season';
export const TELEGRAM_JOB_LEASE_MS = 5 * 60 * 1000;

export type TelegramSendJobPayload = {
  posterUrl: string;
  caption: string;
};

export type TelegramEditJobPayload = {
  messageId: number;
  caption: string;
};

export type TelegramDeleteJobPayload = {
  messageId: number;
};

export type TelegramJobInput =
  | {
      jobType: 'send';
      payload: TelegramSendJobPayload;
    }
  | {
      jobType: 'edit';
      payload: TelegramEditJobPayload;
    }
  | {
      jobType: 'delete';
      payload: TelegramDeleteJobPayload;
    };

export type TelegramJobPayload = TelegramJobInput['payload'];

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

function getRetryAfter(error: unknown) {
  if (typeof error !== 'object' || error === null || !('retryAfter' in error)) {
    return undefined;
  }

  const retryAfter = (error as { retryAfter: unknown }).retryAfter;
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
}

function failOrphanedMovieSendJobs(db: AppDatabase) {
  return db
    .prepare(
      `UPDATE telegram_jobs
       SET status = 'failed',
           last_error = 'Entity no longer exists',
           updated_at = CURRENT_TIMESTAMP
       WHERE job_type = 'send'
         AND entity_type = 'movie'
         AND status IN ('queued', 'waiting_retry', 'running')
         AND NOT EXISTS (
           SELECT 1
           FROM movies
           WHERE movies.id = telegram_jobs.entity_id
         )`
    )
    .run();
}

export function recoverStaleRunningTelegramJobs(db: AppDatabase, leaseMs = TELEGRAM_JOB_LEASE_MS) {
  failOrphanedMovieSendJobs(db);

  const cutoff = formatSqliteTimestamp(new Date(Date.now() - leaseMs));

  return db
    .prepare(
      `UPDATE telegram_jobs
       SET status = 'queued',
           next_run_at = CURRENT_TIMESTAMP,
           last_error = 'Recovered stale running job after queue worker lease expired',
           updated_at = CURRENT_TIMESTAMP
       WHERE status = 'running'
         AND updated_at <= ?`
    )
    .run(cutoff);
}

export function enqueueTelegramJob(
  db: AppDatabase,
  jobType: 'send',
  entityType: TelegramEntityType,
  entityId: number,
  payload: TelegramSendJobPayload
): Database.RunResult;
export function enqueueTelegramJob(
  db: AppDatabase,
  jobType: 'edit',
  entityType: TelegramEntityType,
  entityId: number,
  payload: TelegramEditJobPayload
): Database.RunResult;
export function enqueueTelegramJob(
  db: AppDatabase,
  jobType: 'delete',
  entityType: TelegramEntityType,
  entityId: number,
  payload: TelegramDeleteJobPayload
): Database.RunResult;
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

export function upsertActiveTelegramSendJob(
  db: AppDatabase,
  entityType: TelegramEntityType,
  entityId: number,
  payload: TelegramSendJobPayload
) {
  const editableJobs = db
    .prepare(
      `SELECT id
       FROM telegram_jobs
       WHERE job_type = 'send'
         AND entity_type = ?
         AND entity_id = ?
         AND status IN ('queued', 'waiting_retry')
       ORDER BY created_at ASC, id ASC`
    )
    .all(entityType, entityId) as Array<{ id: number }>;

  if (editableJobs.length === 0) {
    return enqueueTelegramJob(db, 'send', entityType, entityId, payload);
  }

  const [jobToUpdate, ...duplicateJobs] = editableJobs;
  const result = db
    .prepare(
      `UPDATE telegram_jobs
       SET payload = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(JSON.stringify(payload), jobToUpdate.id);

  if (duplicateJobs.length > 0) {
    const placeholders = duplicateJobs.map(() => '?').join(', ');
    db.prepare(`DELETE FROM telegram_jobs WHERE id IN (${placeholders})`).run(...duplicateJobs.map((job) => job.id));
  }

  return result;
}

export function cancelPendingTelegramSendJobs(db: AppDatabase, entityType: TelegramEntityType, entityId: number) {
  return db
    .prepare(
      `DELETE FROM telegram_jobs
       WHERE job_type = 'send'
         AND entity_type = ?
         AND entity_id = ?
         AND status IN ('queued', 'waiting_retry')`
    )
    .run(entityType, entityId);
}

async function runTelegramJob(client: TelegramClient, job: TelegramJobRow) {
  const payload = JSON.parse(job.payload) as TelegramJobPayload;

  if (job.job_type === 'send') {
    await client.sendPhotoPost(payload as { posterUrl: string; caption: string });
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
    failOrphanedMovieSendJobs(db);
    recoverStaleRunningTelegramJobs(db);

    const selected = db
      .prepare(
        `SELECT id, job_type, payload
         FROM telegram_jobs
         WHERE status IN ('queued', 'waiting_retry')
           AND next_run_at <= CURRENT_TIMESTAMP
         ORDER BY created_at ASC, id ASC
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
    const retryAfter = getRetryAfter(error);

    if (retryAfter !== undefined) {
      db.prepare(
        `UPDATE telegram_jobs
         SET status = 'waiting_retry',
             next_run_at = ?,
             last_error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(formatSqliteTimestamp(new Date(Date.now() + retryAfter * 1000)), message, job.id);
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

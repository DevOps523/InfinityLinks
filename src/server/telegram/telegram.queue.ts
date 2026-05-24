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
  retainEntityState?: boolean;
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
  entity_type: TelegramEntityType;
  entity_id: number;
  payload: string;
};

type EntityPostStatusUpdate = {
  messageId?: number | null;
  postStatus: string;
};

type SendPostState = {
  exists: boolean;
  canPublish: boolean;
};

const ENTITY_NO_LONGER_PUBLISHABLE_ERROR = 'Entity no longer publishable after send completed';

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

export function updateEntityPostStatus(
  db: AppDatabase,
  entityType: TelegramEntityType,
  entityId: number,
  values: EntityPostStatusUpdate
) {
  const tableName = entityType === 'movie' ? 'movies' : 'seasons';

  if ('messageId' in values) {
    return db
      .prepare(
        `UPDATE ${tableName}
         SET telegram_message_id = ?,
             post_status = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(values.messageId, values.postStatus, entityId);
  }

  return db
    .prepare(
      `UPDATE ${tableName}
       SET post_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(values.postStatus, entityId);
}

function getPostStatusForJobType(jobType: TelegramJobType) {
  if (jobType === 'delete') {
    return 'deleted';
  }

  return 'posted';
}

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getSendPostState(db: AppDatabase, entityType: TelegramEntityType, entityId: number): SendPostState {
  if (entityType === 'movie') {
    const row = db
      .prepare(
        `SELECT post_status, poster_url,
                EXISTS (
                  SELECT 1
                  FROM movie_links
                  WHERE movie_links.movie_id = movies.id
                ) AS has_links
         FROM movies
         WHERE id = ?`
      )
      .get(entityId) as { post_status: string; poster_url: string | null; has_links: 0 | 1 } | undefined;

    if (!row) {
      return { exists: false, canPublish: false };
    }

    return {
      exists: true,
      canPublish: row.post_status !== 'deleted' && hasText(row.poster_url) && row.has_links === 1
    };
  }

  const row = db
    .prepare(
      `SELECT seasons.post_status,
              tv_shows.poster_url,
              EXISTS (
                SELECT 1
                FROM episodes
                JOIN episode_links ON episode_links.episode_id = episodes.id
                WHERE episodes.season_id = seasons.id
              ) AS has_links
       FROM seasons
       JOIN tv_shows ON tv_shows.id = seasons.tv_show_id
       WHERE seasons.id = ?`
    )
    .get(entityId) as { post_status: string; poster_url: string | null; has_links: 0 | 1 } | undefined;

  if (!row) {
    return { exists: false, canPublish: false };
  }

  return {
    exists: true,
    canPublish: row.post_status !== 'deleted' && hasText(row.poster_url) && row.has_links === 1
  };
}

function getLatestActiveSendPayload(db: AppDatabase, job: TelegramJobRow) {
  const row = db
    .prepare(
      `SELECT payload
       FROM telegram_jobs
       WHERE job_type = 'send'
         AND entity_type = ?
         AND entity_id = ?
         AND status IN ('queued', 'waiting_retry', 'running')
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    )
    .get(job.entity_type, job.entity_id) as { payload: string } | undefined;

  return (row ? JSON.parse(row.payload) : JSON.parse(job.payload)) as TelegramSendJobPayload;
}

function hasBlockingRetainedDelete(db: AppDatabase, job: TelegramJobRow) {
  if (job.job_type !== 'send') {
    return false;
  }

  const rows = db
    .prepare(
      `SELECT payload
       FROM telegram_jobs
       WHERE job_type = 'delete'
         AND entity_type = ?
         AND entity_id = ?
         AND status IN ('queued', 'waiting_retry', 'running')`
    )
    .all(job.entity_type, job.entity_id) as Array<{ payload: string }>;

  return rows.some((row) => {
    const payload = JSON.parse(row.payload) as TelegramDeleteJobPayload;
    return payload.retainEntityState === true;
  });
}

function cancelOtherActiveSendJobs(db: AppDatabase, job: TelegramJobRow) {
  return db
    .prepare(
      `DELETE FROM telegram_jobs
       WHERE job_type = 'send'
         AND entity_type = ?
         AND entity_id = ?
         AND id <> ?
         AND status IN ('queued', 'waiting_retry')`
    )
    .run(job.entity_type, job.entity_id, job.id);
}

function failOtherActiveSendJobs(db: AppDatabase, job: TelegramJobRow, message: string) {
  return db
    .prepare(
      `UPDATE telegram_jobs
       SET status = 'failed',
           last_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE job_type = 'send'
         AND entity_type = ?
         AND entity_id = ?
         AND id <> ?
         AND status IN ('queued', 'waiting_retry')`
    )
    .run(message, job.entity_type, job.entity_id, job.id);
}

function failOrphanedSendJobs(db: AppDatabase) {
  const failOrphanedMovies = db
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
  const failOrphanedSeasons = db
    .prepare(
      `UPDATE telegram_jobs
       SET status = 'failed',
           last_error = 'Entity no longer exists',
           updated_at = CURRENT_TIMESTAMP
       WHERE job_type = 'send'
         AND entity_type = 'season'
         AND status IN ('queued', 'waiting_retry', 'running')
         AND NOT EXISTS (
           SELECT 1
           FROM seasons
           WHERE seasons.id = telegram_jobs.entity_id
         )`
    )
    .run();

  return failOrphanedMovies.changes + failOrphanedSeasons.changes;
}

export function recoverStaleRunningTelegramJobs(db: AppDatabase, leaseMs = TELEGRAM_JOB_LEASE_MS) {
  failOrphanedSendJobs(db);

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
      `SELECT id, status
       FROM telegram_jobs
       WHERE job_type = 'send'
         AND entity_type = ?
         AND entity_id = ?
         AND status IN ('queued', 'waiting_retry', 'running')
       ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END,
                created_at ASC,
                id ASC`
    )
    .all(entityType, entityId) as Array<{ id: number; status: string }>;

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
    db.prepare(`DELETE FROM telegram_jobs WHERE id IN (${placeholders}) AND status IN ('queued', 'waiting_retry')`).run(
      ...duplicateJobs.map((job) => job.id)
    );
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

export function cancelPendingTelegramDeleteJobs(db: AppDatabase, entityType: TelegramEntityType, entityId: number) {
  return db
    .prepare(
      `DELETE FROM telegram_jobs
       WHERE job_type = 'delete'
         AND entity_type = ?
         AND entity_id = ?
         AND status IN ('queued', 'waiting_retry')`
    )
    .run(entityType, entityId);
}

export function cancelPendingTelegramEditJobs(db: AppDatabase, entityType: TelegramEntityType, entityId: number) {
  return db
    .prepare(
      `DELETE FROM telegram_jobs
       WHERE job_type = 'edit'
         AND entity_type = ?
         AND entity_id = ?
         AND status IN ('queued', 'waiting_retry')`
    )
    .run(entityType, entityId);
}

export function upsertPendingTelegramDeleteJob(
  db: AppDatabase,
  entityType: TelegramEntityType,
  entityId: number,
  payload: TelegramDeleteJobPayload
) {
  const editableJobs = db
    .prepare(
      `SELECT id
       FROM telegram_jobs
       WHERE job_type = 'delete'
         AND entity_type = ?
         AND entity_id = ?
         AND status IN ('queued', 'waiting_retry')
       ORDER BY created_at ASC, id ASC`
    )
    .all(entityType, entityId) as Array<{ id: number }>;

  if (editableJobs.length === 0) {
    return enqueueTelegramJob(db, 'delete', entityType, entityId, payload);
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

async function runTelegramJob(client: TelegramClient, job: TelegramJobRow) {
  const payload = JSON.parse(job.payload) as TelegramJobPayload;

  if (job.job_type === 'send') {
    return client.sendPhotoPost(payload as { posterUrl: string; caption: string });
  }

  if (job.job_type === 'edit') {
    await client.editPhotoCaption(payload as { messageId: number; caption: string });
    return;
  }

  await client.deleteMessage(payload as { messageId: number });
}

export async function processNextTelegramJob(db: AppDatabase, client: TelegramClient): Promise<boolean> {
  const job = db.transaction(() => {
    failOrphanedSendJobs(db);
    recoverStaleRunningTelegramJobs(db);

    const jobs = db
      .prepare(
        `SELECT id, job_type, entity_type, entity_id, payload
         FROM telegram_jobs
         WHERE status IN ('queued', 'waiting_retry')
           AND next_run_at <= CURRENT_TIMESTAMP
         ORDER BY created_at ASC, id ASC`
      )
      .all() as TelegramJobRow[];

    const selected = jobs.find((candidate) => !hasBlockingRetainedDelete(db, candidate));

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
    const result = await runTelegramJob(client, job);

    if (job.job_type === 'send' && result?.messageId !== undefined) {
      const state = getSendPostState(db, job.entity_type, job.entity_id);

      if (!state.canPublish) {
        try {
          await client.deleteMessage({ messageId: result.messageId });
        } catch (cleanupError) {
          const cleanupMessage = `${ENTITY_NO_LONGER_PUBLISHABLE_ERROR}; cleanup failed: ${getErrorMessage(cleanupError)}`;
          const retryAfter = getRetryAfter(cleanupError);
          db.transaction(() => {
            if (state.exists) {
              updateEntityPostStatus(db, job.entity_type, job.entity_id, {
                messageId: null,
                postStatus: 'failed'
              });
            }

            db.prepare(
              `UPDATE telegram_jobs
               SET status = 'failed',
                   last_error = ?,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`
            ).run(cleanupMessage, job.id);
            failOtherActiveSendJobs(db, job, cleanupMessage);
            const deleteJob = enqueueTelegramJob(db, 'delete', job.entity_type, job.entity_id, {
              messageId: result.messageId
            });

            if (retryAfter !== undefined) {
              db.prepare(
                `UPDATE telegram_jobs
                 SET status = 'waiting_retry',
                     next_run_at = ?,
                     last_error = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`
              ).run(
                formatSqliteTimestamp(new Date(Date.now() + retryAfter * 1000)),
                getErrorMessage(cleanupError),
                deleteJob.lastInsertRowid
              );
            }
          })();
          return false;
        }

        db.transaction(() => {
          if (state.exists) {
            updateEntityPostStatus(db, job.entity_type, job.entity_id, {
              messageId: null,
              postStatus: 'deleted'
            });
          }
          db.prepare(
            `UPDATE telegram_jobs
             SET status = 'failed',
                 last_error = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).run(ENTITY_NO_LONGER_PUBLISHABLE_ERROR, job.id);
          failOtherActiveSendJobs(db, job, ENTITY_NO_LONGER_PUBLISHABLE_ERROR);
        })();
        return true;
      }

      const sentPayload = JSON.parse(job.payload) as TelegramSendJobPayload;
      const latestPayload = getLatestActiveSendPayload(db, job);

      db.transaction(() => {
        updateEntityPostStatus(db, job.entity_type, job.entity_id, {
          messageId: result.messageId,
          postStatus: 'posted'
        });
        cancelOtherActiveSendJobs(db, job);
        db.prepare(
          `UPDATE telegram_jobs
           SET status = 'succeeded',
               last_error = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(job.id);

        if (latestPayload.caption !== sentPayload.caption) {
          enqueueTelegramJob(db, 'edit', job.entity_type, job.entity_id, {
            messageId: result.messageId,
            caption: latestPayload.caption
          });
        }
      })();
      return true;
    }

    const completedPayload = JSON.parse(job.payload) as TelegramJobPayload;

    db.transaction(() => {
      if (!(job.job_type === 'delete' && (completedPayload as TelegramDeleteJobPayload).retainEntityState)) {
        updateEntityPostStatus(db, job.entity_type, job.entity_id, {
          ...(job.job_type === 'delete' ? { messageId: null } : {}),
          ...(result?.messageId !== undefined ? { messageId: result.messageId } : {}),
          postStatus: getPostStatusForJobType(job.job_type)
        });
      }
      db.prepare(
        `UPDATE telegram_jobs
         SET status = 'succeeded',
             last_error = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(job.id);
    })();
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

    db.transaction(() => {
      const failedPayload = JSON.parse(job.payload) as TelegramJobPayload;
      updateEntityPostStatus(db, job.entity_type, job.entity_id, {
        postStatus: 'failed'
      });
      db.prepare(
        `UPDATE telegram_jobs
         SET status = 'failed',
             last_error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(message, job.id);

      if (job.job_type === 'delete' && (failedPayload as TelegramDeleteJobPayload).retainEntityState) {
        failOtherActiveSendJobs(db, job, message);
      }
    })();
    return false;
  }
}

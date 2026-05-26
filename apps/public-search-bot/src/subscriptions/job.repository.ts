import type { PublicSearchDatabase } from '../db/database.js';

export type SubscriptionJobType = 'refresh-alert' | 'kick-user' | 'refresh-sheet';
export type SubscriptionJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type SubscriptionJob = {
  id: number;
  type: SubscriptionJobType;
  payload: Record<string, unknown>;
  status: SubscriptionJobStatus;
  attempts: number;
  runAfter: string;
  lastError?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

type SubscriptionJobRow = {
  id: number;
  type: SubscriptionJobType;
  payloadJson: string;
  status: SubscriptionJobStatus;
  attempts: number;
  runAfter: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export function enqueueSubscriptionJob(
  db: PublicSearchDatabase,
  type: SubscriptionJobType,
  payload: Record<string, unknown>,
  runAfter: Date
): SubscriptionJob {
  const nowIso = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO subscription_jobs (
         type,
         payload_json,
         status,
         attempts,
         run_after,
         created_at,
         updated_at
       )
       VALUES (@type, @payloadJson, 'pending', 0, @runAfter, @nowIso, @nowIso)`
    )
    .run({
      type,
      payloadJson: JSON.stringify(payload),
      runAfter: runAfter.toISOString(),
      nowIso
    });

  return requireSubscriptionJob(db, Number(result.lastInsertRowid));
}

export function getSubscriptionJob(db: PublicSearchDatabase, id: number): SubscriptionJob | undefined {
  const row = db
    .prepare(
      `SELECT
         id,
         type,
         payload_json AS payloadJson,
         status,
         attempts,
         run_after AS runAfter,
         last_error AS lastError,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM subscription_jobs
       WHERE id = ?`
    )
    .get(id) as SubscriptionJobRow | undefined;

  return row ? mapSubscriptionJob(row) : undefined;
}

export function listSubscriptionJobs(db: PublicSearchDatabase): SubscriptionJob[] {
  const rows = db
    .prepare(
      `SELECT
         id,
         type,
         payload_json AS payloadJson,
         status,
         attempts,
         run_after AS runAfter,
         last_error AS lastError,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM subscription_jobs
       ORDER BY id ASC`
    )
    .all() as SubscriptionJobRow[];

  return rows.map(mapSubscriptionJob);
}

export function claimNextSubscriptionJob(db: PublicSearchDatabase, now: Date): SubscriptionJob | undefined {
  const claim = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id
         FROM subscription_jobs
         WHERE status = 'pending'
           AND run_after <= @nowIso
         ORDER BY run_after ASC, id ASC
         LIMIT 1`
      )
      .get({ nowIso: now.toISOString() }) as { id: number } | undefined;

    if (!row) {
      return undefined;
    }

    const result = db
      .prepare(
        `UPDATE subscription_jobs
         SET status = 'running',
             updated_at = @nowIso
         WHERE id = @id
           AND status = 'pending'`
      )
      .run({
        id: row.id,
        nowIso: now.toISOString()
      });

    return result.changes === 1 ? requireSubscriptionJob(db, row.id) : undefined;
  });

  return claim();
}

export function markSubscriptionJobSucceeded(db: PublicSearchDatabase, id: number, now: Date): SubscriptionJob {
  const result = db
    .prepare(
      `UPDATE subscription_jobs
       SET status = 'succeeded',
           last_error = NULL,
           updated_at = @nowIso
       WHERE id = @id`
    )
    .run({
      id,
      nowIso: now.toISOString()
    });

  if (result.changes !== 1) {
    throw new Error(`Subscription job not found: ${id}`);
  }

  return requireSubscriptionJob(db, id);
}

export function markSubscriptionJobFailed(
  db: PublicSearchDatabase,
  id: number,
  error: unknown,
  runAfter: Date,
  now: Date
): SubscriptionJob {
  const result = db
    .prepare(
      `UPDATE subscription_jobs
       SET status = 'pending',
           attempts = attempts + 1,
           run_after = @runAfter,
           last_error = @lastError,
           updated_at = @nowIso
       WHERE id = @id`
    )
    .run({
      id,
      runAfter: runAfter.toISOString(),
      lastError: errorMessage(error),
      nowIso: now.toISOString()
    });

  if (result.changes !== 1) {
    throw new Error(`Subscription job not found: ${id}`);
  }

  return requireSubscriptionJob(db, id);
}

function requireSubscriptionJob(db: PublicSearchDatabase, id: number): SubscriptionJob {
  const job = getSubscriptionJob(db, id);

  if (!job) {
    throw new Error(`Subscription job not found: ${id}`);
  }

  return job;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  const parsed = JSON.parse(payloadJson) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Subscription job payload must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function mapSubscriptionJob(row: SubscriptionJobRow): SubscriptionJob {
  return {
    id: row.id,
    type: row.type,
    payload: parsePayload(row.payloadJson),
    status: row.status,
    attempts: row.attempts,
    runAfter: row.runAfter,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

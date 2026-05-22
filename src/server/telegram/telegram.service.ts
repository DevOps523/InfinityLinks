import type { AppDatabase } from '../db/database.js';
import { enqueueTelegramJob, type TelegramEntityType } from './telegram.queue.js';

export function queueSendPost(
  db: AppDatabase,
  entityType: TelegramEntityType,
  entityId: number,
  payload: { posterUrl: string; caption: string }
) {
  return enqueueTelegramJob(db, 'send', entityType, entityId, payload);
}

export function queueEditPost(
  db: AppDatabase,
  entityType: TelegramEntityType,
  entityId: number,
  payload: { messageId: number; caption: string }
) {
  return enqueueTelegramJob(db, 'edit', entityType, entityId, payload);
}

export function queueDeletePost(
  db: AppDatabase,
  entityType: TelegramEntityType,
  entityId: number,
  payload: { messageId: number }
) {
  return enqueueTelegramJob(db, 'delete', entityType, entityId, payload);
}

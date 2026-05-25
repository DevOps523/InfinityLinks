import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { getPublicSearchSyncStatus } from '../public-search/sync.service.js';
import { getAdminDashboardCounts } from './admin.repository.js';

export function getAdminDashboard(db: AppDatabase, config: AppConfig) {
  const counts = getAdminDashboardCounts(db);
  const syncStatus = getPublicSearchSyncStatus(db, config);

  return {
    ...counts,
    pendingPublicSearchChanges: syncStatus.hasPendingChanges
  };
}

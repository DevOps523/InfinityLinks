import type { AppDatabase } from '../db/database.js';

export type AdminDashboardCounts = {
  movies: number;
  tvShows: number;
  activeLinks: number;
  failedTelegramJobs: number;
};

function getCount(db: AppDatabase, sql: string) {
  const row = db.prepare(sql).get() as { count: number };
  return row.count;
}

export function getAdminDashboardCounts(db: AppDatabase): AdminDashboardCounts {
  return {
    movies: getCount(db, `SELECT COUNT(*) AS count FROM movies`),
    tvShows: getCount(db, `SELECT COUNT(*) AS count FROM tv_shows`),
    activeLinks: getCount(
      db,
      `SELECT COUNT(*) AS count
         FROM (
           SELECT id FROM movie_links WHERE status = 'active'
           UNION ALL
           SELECT id FROM episode_links WHERE status = 'active'
         ) active_links`
    ),
    failedTelegramJobs: getCount(db, `SELECT COUNT(*) AS count FROM telegram_jobs WHERE status = 'failed'`)
  };
}

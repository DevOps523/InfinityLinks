const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(value: string) {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error(`Invalid date-only value: ${value}`);
  }

  const parts = value.split('-').map(Number);
  const [year, month, day] = parts;

  if (parts.length !== 3 || year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid date-only value: ${value}`);
  }

  return Date.UTC(year, month - 1, day);
}

export function todayDateString(now: Date = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function addDateDays(dateOnly: string, days: number) {
  const date = new Date(parseDateOnly(dateOnly) + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

export function calculateDaysRemaining(endDate: string, today: string) {
  return Math.max(0, Math.floor((parseDateOnly(endDate) - parseDateOnly(today)) / DAY_MS));
}

export function dateDifferenceDays(fromDate: string, toDate: string) {
  return Math.floor((parseDateOnly(toDate) - parseDateOnly(fromDate)) / DAY_MS);
}

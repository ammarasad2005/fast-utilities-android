/**
 * Semester calendar helpers — derived from the web app's
 * src/lib/dates.ts semester functions.
 */

import type { KeyDate, SemesterCalendar } from './types';

export function getSemesterStartDate(cal: SemesterCalendar): string | null {
  const start = cal.keyDates.find((k) =>
    k.label.toLowerCase().includes('first day of classes')
  );
  return start?.date ?? null;
}

export function getSemesterEndDate(cal: SemesterCalendar): string | null {
  const end = cal.keyDates.find((k) =>
    k.label.toLowerCase().includes('final examination')
  );
  return end?.date ?? null;
}

/** Returns the next N upcoming key dates from today (ISO-sorted). */
export function getUpcomingKeyDates(
  cal: SemesterCalendar,
  count = 5,
  now: Date = new Date()
): KeyDate[] {
  if (!cal?.keyDates) return [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().slice(0, 10);
  return cal.keyDates
    .filter((k) => k.date >= todayISO)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, count);
}

/** ISO date → "Mon 17 Aug". */
export function formatISODate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.toLocaleString('en', { weekday: 'short' });
  const dd = d.getDate();
  const month = d.toLocaleString('en', { month: 'short' });
  return `${day} ${dd} ${month}`;
}

/** "Mon 17 Aug" style for a single date or "17 Aug – 20 Aug" for a range. */
export function formatKeyDateRange(kd: KeyDate): string {
  if (kd.endDate && kd.endDate !== kd.date) {
    return `${shortDay(kd.date)} – ${shortDay(kd.endDate)}`;
  }
  return shortDay(kd.date);
}

function shortDay(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  const dd = d.getDate();
  const month = d.toLocaleString('en', { month: 'short' });
  return `${dd} ${month}`;
}

export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

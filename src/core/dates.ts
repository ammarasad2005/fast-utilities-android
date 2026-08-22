/**
 * Date/time helpers — ported from src/lib/dates.ts.
 */

/** Parse "DD/MM/YYYY" → Date object */
export function parseExamDate(dateStr: string): Date | null {
  const [d, m, y] = dateStr.split('/').map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

/** Days from today to exam date (negative if passed). */
export function getDaysUntil(dateStr: string): number | null {
  const examDate = parseExamDate(dateStr);
  if (!examDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = examDate.getTime() - today.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

/** "12/05/2025" → "12 May 2025" */
export function formatDate(dateStr: string): string {
  const [d, m, y] = dateStr.split('/');
  const month = new Date(2000, parseInt(m) - 1, 1).toLocaleString('en', {
    month: 'long',
  });
  return `${parseInt(d)} ${month} ${y}`;
}

/** "09:00 AM" → minutes from midnight */
export function parseTime(timeStr: string): number {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/**
 * Parse "HH:MM" (24-hour) or "HH:MM AM/PM" → minutes from midnight.
 * FAST University classes run 8:30 AM – 5:15 PM; hours 1–7 are PM.
 */
export function parseTime24(timeStr: string): number {
  if (!timeStr) return 0;

  const amPmMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (amPmMatch) {
    let h = parseInt(amPmMatch[1], 10);
    const m = parseInt(amPmMatch[2], 10);
    const p = amPmMatch[3].toUpperCase();
    if (p === 'PM' && h < 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }

  const parts = timeStr.split(':');
  if (parts.length < 2) return 0;
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (h >= 1 && h <= 7) h += 12;
  return (h || 0) * 60 + (m || 0);
}

/** "HH:MM - HH:MM" → { start, end } in minutes */
export function parseTimeRange(range: string): { start: number; end: number } {
  if (!range) return { start: 0, end: 0 };
  const delimiters = [' - ', ' to ', '-'];
  let parts: string[] = [];
  for (const del of delimiters) {
    if (range.includes(del)) {
      parts = range.split(del).map((s) => s.trim());
      break;
    }
  }
  if (parts.length < 2) return { start: 0, end: 0 };
  return { start: parseTime24(parts[0]), end: parseTime24(parts[1]) };
}

/** ISO date ("2026-08-17") → "Mon 17 Aug" */
export function formatISODate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.toLocaleString('en', { weekday: 'short' });
  const dd = d.getDate();
  const month = d.toLocaleString('en', { month: 'short' });
  return `${day} ${dd} ${month}`;
}

/** ISO date ("2026-08-17") → "17 Aug" (context already shows the weekday). */
export function formatISODateShort(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

/** Days from today to an ISO date (positive = future). */
export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Effective-today logic (ported from the web app's src/lib/dates.ts) ──────

/** Last BS class of the day ends ~5:15–5:20 PM; at 5:30 PM the day is "over". */
const DAY_END_MINUTES = 17 * 60 + 30;

function toISOLocal(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * From 5:30 PM to 11:59 PM the EFFECTIVE day is tomorrow (all BS classes are
 * done for the day — the user is looking at what comes next, like the web app).
 */
export function getEffectiveToday(now: Date = new Date()): { isoDate: string; dayName: string } {
  const d = new Date(now);
  if (now.getHours() * 60 + now.getMinutes() >= DAY_END_MINUTES) {
    d.setDate(d.getDate() + 1);
  }
  const isoDate = toISOLocal(d);
  return { isoDate, dayName: d.toLocaleString('en', { weekday: 'long' }) };
}

/**
 * Whether the "effective today" has already rolled over to tomorrow
 * (5:30 PM–11:59 PM) — labels should say "TOMORROW" instead of "TODAY".
 */
export function isTomorrowPreview(now: Date = new Date()): boolean {
  return now.getHours() * 60 + now.getMinutes() >= DAY_END_MINUTES;
}

/**
 * Week resolution — an exact port of the web app's `resolvedData` logic from
 * src/app/timetable/page.tsx (and the identical copy in timetable/custom/page.tsx).
 *
 * The sheet's `__meta__.days[].isoDate` reflects the week the sheet was
 * GENERATED. The web does not trust those dates: it re-dates the six undated
 * day columns onto the calendar week containing the EFFECTIVE today (17:30
 * cutoff), clamps the reference Monday to the semester-start week, parses
 * dated (makeup) sheets separately, pins today first, and only highlights
 * today when the semester has started. Keeping this file behaviour-identical
 * to the web is the contract.
 */

import type { TimetableSheetMeta } from './types';
import { DAYS_ORDER } from './types';

const DAY_END_MINUTES = 17 * 60 + 30; // 5:30 PM — after this, "today" rolls to tomorrow

export interface ResolvedSheet {
  /** Calendar day name, e.g. "Monday" */
  day: string;
  /** Raw sheet key, e.g. "Monday" or "Monday (May 5)" for makeup sheets */
  sheetName: string;
  /** Resolved rolling date YYYY-MM-DD */
  isoDate: string;
  /** Display date like "17 Aug" */
  dateStr: string;
  isMakeup: boolean;
  /** True when this sheet maps onto the effective today (suppressed pre-semester) */
  isToday: boolean;
}

export interface WeekPlan {
  /** Ordered for display: today first (if any), then chronological. */
  sheets: ResolvedSheet[];
  /** Dated makeup sheets beyond the current week (within 30 days). */
  upcomingMakeupDays: ResolvedSheet[];
  todayISO: string;
  todayDayName: string;
  tomorrowPreview: boolean;
  beforeSemesterStart: boolean;
}

/** Timezone-safe ISO date for a local Date. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Effective-today as a midnight Date (port of web getEffectiveToday):
 * 12:00 AM – 5:29 PM → actual today; 5:30 PM – 11:59 PM → tomorrow.
 */
export function getEffectiveTodayDate(now: Date = new Date()): Date {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (currentMinutes >= DAY_END_MINUTES) {
    today.setDate(today.getDate() + 1);
  }
  return today;
}

/** True 5:30 PM – 11:59 PM: label should read "TOMORROW". */
export function isTomorrowPreview(now: Date = new Date()): boolean {
  return now.getHours() * 60 + now.getMinutes() >= DAY_END_MINUTES;
}

/**
 * Actual (not effective) today is before the semester's first day of classes.
 * Suppresses "today" highlighting during orientation week etc.
 */
export function isBeforeSemesterStartISO(semesterStartISO: string | null | undefined, now: Date = new Date()): boolean {
  if (!semesterStartISO) return false;
  const start = new Date(semesterStartISO + 'T00:00:00');
  if (isNaN(start.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today < start;
}

/**
 * Clamp the reference Monday to the Monday of the semester-start week when it
 * would otherwise fall before "First Day of Classes" — day labels must never
 * show pre-semester dates (port of web clampMondayToSemesterStart).
 */
export function clampMondayToSemesterStart(monday: Date, semesterStartISO: string | null | undefined): Date {
  if (!semesterStartISO) return monday;
  const start = new Date(semesterStartISO + 'T00:00:00');
  if (isNaN(start.getTime())) return monday;
  if (monday >= start) return monday;
  const ssDayOfWeek = start.getDay();
  const ssDaysToMonday = ssDayOfWeek === 0 ? 6 : ssDayOfWeek - 1;
  const clamped = new Date(start);
  clamped.setDate(start.getDate() - ssDaysToMonday);
  clamped.setHours(0, 0, 0, 0);
  return clamped;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Parse an explicit date out of a sheet name like "Monday (May 5)" or
 * "Thursday (21/08/2026)". Year-less dates assume the effective-today year.
 * Returns null when the sheet name carries no date (regular weekly sheet).
 */
export function parseExplicitSheetDate(sheetName: string, currentYear: number): Date | null {
  const match = sheetName.match(/\(([^)]+)\)/);
  if (!match) return null;

  const dateStr = match[1];
  const parsed = Date.parse(dateStr);
  if (isNaN(parsed)) {
    const cleanStr = dateStr.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const parts = cleanStr.split(/\s+/).filter(Boolean);

    let dayNum = 1;
    let monthIndex = -1;

    for (const part of parts) {
      const dayVal = parseInt(part, 10);
      if (!isNaN(dayVal) && dayVal >= 1 && dayVal <= 31) {
        dayNum = dayVal;
      } else {
        const mIdx = MONTHS.findIndex((m) => part.startsWith(m));
        if (mIdx !== -1) monthIndex = mIdx;
      }
    }

    if (monthIndex !== -1) {
      return new Date(currentYear, monthIndex, dayNum);
    }
    return null;
  }

  const d = new Date(parsed);
  if (!/\d{4}/.test(dateStr)) {
    d.setFullYear(currentYear);
  }
  return d;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "19 Aug" — deterministic (Hermes-safe), matching formatISODateShort. */
export function formatShortDate(d: Date): string {
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/**
 * Resolve the displayable week from sheet metadata.
 *
 * @param metaDays          `__meta__.days` from the timetable JSON (undefined-safe)
 * @param semesterStartISO  ISO date of "First Day of Classes" (null-safe)
 * @param now               injectable clock (tests)
 */
export function resolveWeekPlan(
  metaDays: TimetableSheetMeta[] | undefined | null,
  opts: { semesterStartISO?: string | null; now?: Date } = {}
): WeekPlan {
  const now = opts.now ?? new Date();
  const semesterStartISO = opts.semesterStartISO ?? null;

  const rawDaysList: TimetableSheetMeta[] =
    Array.isArray(metaDays) && metaDays.length
      ? metaDays
      : DAYS_ORDER.map((day) => ({ day, sheetName: day, date: '', isoDate: '', isMakeup: false }));

  const today = getEffectiveTodayDate(now);
  const currentYear = today.getFullYear();
  const currentDayOfWeek = today.getDay();
  const daysToMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;

  const beforeSemesterStart = isBeforeSemesterStartISO(semesterStartISO, now);

  let monday = new Date(today);
  monday.setDate(today.getDate() - daysToMonday);
  monday.setHours(0, 0, 0, 0);
  monday = clampMondayToSemesterStart(monday, semesterStartISO);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const thirtyDaysLater = new Date(today);
  thirtyDaysLater.setDate(today.getDate() + 30);

  const mondayISO = toISODate(monday);
  const sundayISO = toISODate(sunday);
  const todayISO = toISODate(today);
  const todayDayName = today.toLocaleDateString('en-US', { weekday: 'long' });

  // Separate dated (makeup) sheets from regular weekly ones
  const undatedSheets = rawDaysList.filter((d) => !parseExplicitSheetDate(d.sheetName, currentYear));
  const datedSheets = rawDaysList.filter((d) => !!parseExplicitSheetDate(d.sheetName, currentYear));

  const currentWeekDatedDays = new Set<string>();
  const resolvedSheets: ResolvedSheet[] = [];
  const upcomingMakeupDays: ResolvedSheet[] = [];

  // Dated sheets: keep only today..today+30; current-week ones join the grid,
  // later ones go to the upcoming-makeup list.
  for (const s of datedSheets) {
    const dateObj = parseExplicitSheetDate(s.sheetName, currentYear);
    if (!dateObj) continue;
    dateObj.setHours(0, 0, 0, 0);
    if (dateObj < today || dateObj > thirtyDaysLater) continue;

    const isoDate = toISODate(dateObj);
    const isCurrentWeek = isoDate >= mondayISO && isoDate <= sundayISO;

    const res: ResolvedSheet = {
      day: s.day,
      sheetName: s.sheetName,
      isoDate,
      isMakeup: true,
      dateStr: formatShortDate(dateObj),
      isToday: false, // computed below
    };

    if (isCurrentWeek) {
      currentWeekDatedDays.add(s.day.toLowerCase());
      resolvedSheets.push(res);
    } else {
      upcomingMakeupDays.push(res);
    }
  }

  // Undated sheets: date them onto the effective-today week. If a dated sheet
  // already occupies this day in the current week, the regular sheet belongs
  // to NEXT week.
  for (const s of undatedSheets) {
    const dayIndex = DAYS_ORDER.indexOf(s.day);
    if (dayIndex === -1) continue;
    const targetDate = new Date(monday);
    targetDate.setDate(monday.getDate() + dayIndex);
    targetDate.setHours(0, 0, 0, 0);

    if (currentWeekDatedDays.has(s.day.toLowerCase())) {
      targetDate.setDate(targetDate.getDate() + 7);
    }

    resolvedSheets.push({
      day: s.day,
      sheetName: s.sheetName,
      isoDate: toISODate(targetDate),
      isMakeup: false,
      dateStr: formatShortDate(targetDate),
      isToday: false, // computed below
    });
  }

  // Today matching: suppressed before the semester starts; iso-match wins,
  // day-name is the fallback for un-resolvable sheets.
  const todayMatch = (s: { isoDate: string; day: string }): boolean => {
    if (beforeSemesterStart) return false;
    return s.isoDate
      ? s.isoDate === todayISO
      : s.day.toLowerCase() === todayDayName.toLowerCase();
  };

  for (const s of resolvedSheets) s.isToday = todayMatch(s);

  // Today first, then chronological (iso), falling back to day order.
  resolvedSheets.sort((a, b) => {
    if (a.isToday) return -1;
    if (b.isToday) return 1;
    if (a.isoDate && b.isoDate) return a.isoDate.localeCompare(b.isoDate);
    const ai = DAYS_ORDER.indexOf(a.day);
    const bi = DAYS_ORDER.indexOf(b.day);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  upcomingMakeupDays.sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  return {
    sheets: resolvedSheets,
    upcomingMakeupDays,
    todayISO,
    todayDayName,
    tomorrowPreview: isTomorrowPreview(now),
    beforeSemesterStart,
  };
}

/**
 * Attach timetable entries (keyed by day name, as flattenTimetable produces)
 * to the resolved sheets, mirroring the web's `reorderedGrouped` filter:
 * the today-sheet is kept even when empty (so the app can say "No classes
 * scheduled for today"); every other sheet is shown only if it has entries.
 * A makeup duplicate of a day never steals the regular day's entries.
 */
export function attachEntries<T>(
  plan: WeekPlan,
  entriesByDay: Map<string, T[]>
): (ResolvedSheet & { entries: T[] })[] {
  const claimed = new Set<string>();
  const out: (ResolvedSheet & { entries: T[] })[] = [];
  for (const s of plan.sheets) {
    let entries: T[] = [];
    if (!s.isMakeup && !claimed.has(s.day)) {
      entries = entriesByDay.get(s.day) ?? [];
      claimed.add(s.day);
    } else if (s.isMakeup) {
      entries = entriesByDay.get(s.sheetName) ?? [];
    }
    if (s.isToday || entries.length > 0) out.push({ ...s, entries });
  }
  return out;
}

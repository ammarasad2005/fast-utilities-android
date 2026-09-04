/**
 * Next-class / ongoing-class engine — a port of the web app's DesktopTicker
 * status logic (src/components/DesktopTicker.tsx "Timetable Logic" + status
 * memo), driven by the same WeekPlan that powers the timetable screens.
 *
 * Semantics preserved from the web:
 *  - Ongoing wins over upcoming; ongoing is suppressed before semester start.
 *  - "Today" is the EFFECTIVE today from the plan (17:30 rollover), so after
 *    classes end the card already previews tomorrow's first class.
 *  - Cancelled classes are never ongoing and never upcoming.
 *  - A makeup-dated class uses its concrete ISO date; regular classes use the
 *    plan's rolling isoDate and roll +7 days once passed this week.
 *  - Classes that start at the exact same time on the same date are grouped
 *    (that's how the web surfaces parallel/conflicting classes).
 */

import { parseTimeRange } from './dates';
import type { TimetableEntry } from './types';
import type { WeekPlan } from './weekPlan';

export interface LiveClassEntry extends TimetableEntry {
  /** minutes left before it ends (ongoing) */
  remaining: number;
  /** minutes until it starts (next) */
  until: number;
  /** occurrence date YYYY-MM-DD */
  dateISO: string;
}

export type ClassStatus =
  | { type: 'ongoing'; classes: LiveClassEntry[] }
  | { type: 'next'; classes: LiveClassEntry[] };

const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function toISOLocal(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface DayMeta {
  isoDate: string;
  isMakeup: boolean;
}

/**
 * day → meta. The flatten layer identifies entries by canonical day name, so
 * when a day carries a makeup sheet AND the displaced regular sheet we take
 * the regular (non-makeup) resolution — makeup weeks are rare and makeup
 * entries keep working through the makeup-only fallback.
 */
/**
 * day-key → meta. Port of the web ticker's `sheetToMeta` (DesktopTicker):
 * an entry's `day` is the RAW sheet key from the JSON — a plain weekday name
 * for regular sheets, or a full dated name like "Saturday (Sep. 05, 2026)"
 * for makeup sheets. Both must resolve: an exact sheetName hit wins (it
 * carries the makeup isoDate, so dated-makeup classes land THIS Saturday);
 * a plain weekday key falls back to the regular (undated) sheet for that
 * weekday — including when a makeup sheet displaced it to next week (the web
 * resolves the undated sheet to the +7 date identically).
 *
 * Failure mode this prevents: a Saturday makeup sheet ("Saturday (Sep. 05,
 * 2026)", 250+ entries) coexisting with a regular standing "Saturday" sheet.
 * The old code keyed only by canonical weekday, so makeup-keyed classes
 * never matched any WEEKDAY_INDEX/sheet and silently vanished from the live
 * engine — the website showed them, the app and widgets did not.
 */
function buildDayMeta(plan: WeekPlan): Map<string, DayMeta> {
  const map = new Map<string, DayMeta>();
  const sheets = [...plan.sheets, ...plan.upcomingMakeupDays];

  // Pass 1: exact sheet-name keys (covers dated makeup names verbatim).
  for (const s of sheets) {
    map.set(s.sheetName, { isoDate: s.isoDate, isMakeup: s.isMakeup });
  }

  // Pass 2: canonical weekday fallback for entries keyed by plain day name.
  // The undated sheet for a weekday claims its own name (sheetName === day);
  // a dated sheet must never claim the plain weekday key (its dated name is
  // already registered above).
  for (const s of sheets) {
    const existing = map.get(s.day);
    if (!existing || s.sheetName === s.day) {
      map.set(s.day, { isoDate: s.isoDate, isMakeup: s.isMakeup });
    }
  }

  return map;
}

/** The web drops entries without a parseable time range from live tracking. */
function hasTimeRange(e: TimetableEntry): boolean {
  return !!e.time && (e.time.includes('-') || e.time.includes(' to '));
}

export function computeClassStatus(
  myEntries: TimetableEntry[],
  plan: WeekPlan,
  now: Date = new Date()
): ClassStatus | null {
  const entries = myEntries.filter(hasTimeRange);
  if (entries.length === 0) return null;

  const dayMeta = buildDayMeta(plan);
  const todayISO = plan.todayISO; // effective today (17:30 rollover)
  const todayDayName = plan.todayDayName;
  const currentMins = now.getHours() * 60 + now.getMinutes();

  const isEffectiveToday = (e: TimetableEntry): boolean => {
    const meta = dayMeta.get(e.day);
    if (meta?.isoDate) return meta.isoDate === todayISO;
    return e.day === todayDayName;
  };

  // ── Ongoing (suppressed pre-semester, like the web) ─────────────────────
  if (!plan.beforeSemesterStart) {
    const ongoing: LiveClassEntry[] = entries
      .filter((e) => {
        if (e.cancelled) return false;
        if (!isEffectiveToday(e)) return false;
        const { start, end } = parseTimeRange(e.time);
        return currentMins >= start && currentMins < end;
      })
      .map((e) => ({ ...e, remaining: parseTimeRange(e.time).end - currentMins, until: 0, dateISO: todayISO }));

    if (ongoing.length > 0) return { type: 'ongoing', classes: ongoing };
  }

  // ── Next occurrence per entry ────────────────────────────────────────────
  const getNextOccurrence = (e: TimetableEntry): { minsUntil: number; dateISO: string } | null => {
    if (e.cancelled) return null;
    const meta = dayMeta.get(e.day);
    const { start, end } = parseTimeRange(e.time);

    if (meta?.isMakeup) {
      const isoDate = meta.isoDate;
      if (!isoDate) return null;
      if (isoDate < todayISO) return null;
      if (isoDate === todayISO && currentMins >= end) return null;
      const [ny, nm, nd] = isoDate.split('-').map(Number);
      const targetDate = new Date(ny, nm - 1, nd, Math.floor(start / 60), start % 60, 0);
      const minsUntil = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 60000));
      return { minsUntil, dateISO: isoDate };
    }

    const isoDate = meta?.isoDate ?? '';
    if (isoDate) {
      let targetDate = new Date(
        Number(isoDate.split('-')[0]),
        Number(isoDate.split('-')[1]) - 1,
        Number(isoDate.split('-')[2]),
        Math.floor(start / 60),
        start % 60,
        0
      );
      // Already happened this week → next week (web rule)
      if (targetDate.getTime() <= now.getTime()) {
        targetDate = new Date(targetDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      }
      const minsUntil = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 60000));
      return { minsUntil, dateISO: toISOLocal(targetDate) };
    }

    // Fallback: canonical weekday arithmetic (no meta date)
    const targetDayIdx = WEEKDAY_INDEX[e.day];
    if (targetDayIdx === undefined) return null;
    let daysDiff = (targetDayIdx - now.getDay() + 7) % 7;
    if (daysDiff === 0 && currentMins >= end) daysDiff = 7;
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + daysDiff);
    targetDate.setHours(Math.floor(start / 60), start % 60, 0, 0);
    const minsUntil = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 60000));
    return { minsUntil, dateISO: toISOLocal(targetDate) };
  };

  const upcoming = entries
    .map((e): { entry: TimetableEntry; minsUntil: number; dateISO: string } | null => {
      // Currently-ongoing entries are not "upcoming" (web rule)
      const { start, end } = parseTimeRange(e.time);
      if (isEffectiveToday(e) && currentMins >= start && currentMins < end) return null;
      const occ = getNextOccurrence(e);
      return occ ? { entry: e, ...occ } : null;
    })
    .filter(Boolean) as { entry: TimetableEntry; minsUntil: number; dateISO: string }[];

  if (upcoming.length === 0) return null;

  upcoming.sort((a, b) => (a.dateISO !== b.dateISO ? a.dateISO.localeCompare(b.dateISO) : a.minsUntil - b.minsUntil));
  const first = upcoming[0];

  // Group all classes starting at the same time on the same date (parallel
  // lectures/labs — the web surfaces these together as a conflict situation)
  const allNext = upcoming.filter(
    (u) => u.entry.day === first.entry.day && u.dateISO === first.dateISO && u.minsUntil === first.minsUntil
  );

  return {
    type: 'next',
    classes: allNext.map((u) => ({ ...u.entry, remaining: 0, until: u.minsUntil, dateISO: u.dateISO })),
  };
}

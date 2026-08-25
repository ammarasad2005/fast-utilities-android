/**
 * Semester calendar + timeline helpers — ported from the web app's
 * src/lib/dates.ts (semester functions) and src/app/semester/page.tsx.
 */

import type { KeyDate, SemesterCalendar } from './types';

export function getSemesterStartDate(cal: SemesterCalendar | null | undefined): string | null {
  const start = cal?.keyDates?.find((k) =>
    k.label.toLowerCase().includes('first day of classes')
  );
  return start?.date ?? null;
}

/** Returns the "Last Day of Classes" ISO date, or null. */
export function getSemesterEndDate(cal: SemesterCalendar): string | null {
  const lastDay = cal.keyDates?.find((k) =>
    k.label.toLowerCase().includes('last day of classes')
  );
  return lastDay?.date ?? null;
}

/** Returns the "Final Examinations" start ISO date, or null. */
export function getFinalExamsStartDate(cal: SemesterCalendar): string | null {
  const finals = cal.keyDates?.find((k) =>
    k.label.toLowerCase().includes('final examination')
  );
  return finals?.date ?? null;
}

/** Returns the "Final Examinations" end ISO date, or null. */
export function getFinalExamsEndDate(cal: SemesterCalendar): string | null {
  const finals = cal.keyDates?.find((k) =>
    k.label.toLowerCase().includes('final examination')
  );
  return finals?.endDate ?? finals?.date ?? null;
}

/** 1-based week number (week 1 = first day of classes). Null before/after. */
export function getSemesterWeekNumber(
  cal: SemesterCalendar,
  now: Date = new Date()
): number | null {
  const startISO = getSemesterStartDate(cal);
  const endISO = getSemesterEndDate(cal);
  if (!startISO || !endISO) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = new Date(startISO + 'T00:00:00');
  if (today < start) return null;
  const diffMs = today.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

/**
 * Semester progress as a float 0-100 (timeline extends from First Day of
 * Classes to the end of Final Examinations). Null if dates unavailable.
 */
export function getSemesterProgress(
  cal: SemesterCalendar,
  now: Date = new Date()
): number | null {
  const startISO = getSemesterStartDate(cal);
  const endISO = getSemesterEndDate(cal);
  const finalsEndISO = getFinalExamsEndDate(cal);
  if (!startISO || !endISO) return null;
  const timelineEndISO = finalsEndISO || endISO;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = new Date(startISO + 'T00:00:00');
  const end = new Date(timelineEndISO + 'T00:00:00');
  const total = end.getTime() - start.getTime();
  if (total <= 0) return null;
  const elapsed = today.getTime() - start.getTime();
  return (elapsed / total) * 100;
}

export interface SemesterMilestone {
  label: string;
  shortLabel: string;
  date: string;
  progressPercent: number;
}

/** S1 / S2 / FE milestone markers for the timeline bar. */
export function getSemesterMilestones(cal: SemesterCalendar): SemesterMilestone[] {
  const startISO = getSemesterStartDate(cal);
  const endISO = getSemesterEndDate(cal);
  const finalsEndISO = getFinalExamsEndDate(cal);
  if (!cal?.keyDates || !startISO || !endISO) return [];

  const timelineEndISO = finalsEndISO || endISO;
  const start = new Date(startISO + 'T00:00:00').getTime();
  const end = new Date(timelineEndISO + 'T00:00:00').getTime();
  const total = end - start;
  if (total <= 0) return [];

  const findKeyDate = (needle: string) =>
    cal.keyDates.find((k) => k.label.toLowerCase().includes(needle));

  const sessional1 = findKeyDate('first sessional');
  const sessional2 = findKeyDate('second sessional');
  const finals = findKeyDate('final examination');

  const milestones: SemesterMilestone[] = [];
  for (const [kd, short] of [
    [sessional1, 'S1'],
    [sessional2, 'S2'],
    [finals, 'FE'],
  ] as [KeyDate | undefined, string][]) {
    if (kd?.date) {
      const d = new Date(kd.date + 'T00:00:00').getTime();
      const pct = ((d - start) / total) * 100;
      milestones.push({
        label: kd.label,
        shortLabel: short,
        date: kd.date,
        progressPercent: Math.max(0, Math.min(100, pct)),
      });
    }
  }
  return milestones;
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

/** "17 Aug" for a single date, "17 Aug – 20 Aug" for a range. */
export function formatKeyDateRange(kd: { date: string; endDate?: string }): string {
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

/* ------------------------------------------------------------------ *
 * Semester pulse — "what stage is the semester in right now, and what
 * comes next?" Used by the home timeline card + the semester screen
 * hero. Holidays are first-class: an active holiday wins over any
 * class-phase description and holidays appear as upcoming events.
 * ------------------------------------------------------------------ */

export type PulseKind =
  | 'holiday'
  | 'exam'        // sessionals / finals windows
  | 'classes'     // ordinary teaching weeks
  | 'pre-semester'
  | 'post-semester';

export interface PulsePhase {
  kind: PulseKind;
  label: string;
  /** Formatted date range, e.g. "17 Aug – 24 Aug". */
  dates: string;
  /** Context line, e.g. "Week 7 of 16" or "Ends in 3d". */
  context?: string;
}

export interface PulseNext {
  label: string;
  dates: string;
  daysUntil: number;
  kind: PulseKind;
}

export interface SemesterPulse {
  current: PulsePhase;
  next: PulseNext | null;
}

interface RangeEvent {
  label: string;
  start: string;
  end: string;
  kind: PulseKind;
  type?: string;
}

function toRangeEvents(cal: SemesterCalendar): RangeEvent[] {
  const events: RangeEvent[] = [];
  for (const h of cal.holidays ?? []) {
    if (!h.date) continue;
    events.push({
      label: h.label,
      start: h.date,
      end: h.endDate ?? h.date,
      kind: 'holiday',
      type: h.type,
    });
  }
  for (const k of cal.keyDates ?? []) {
    if (!k.date) continue;
    const low = k.label.toLowerCase();
    const kind: PulseKind =
      low.includes('sessional') || low.includes('examination') || k.type === 'exam'
        ? 'exam'
        : 'classes';
    events.push({
      label: k.label,
      start: k.date,
      end: k.endDate ?? k.date,
      kind,
      type: k.type,
    });
  }
  return events;
}

export function computeCurrentPhase(
  cal: SemesterCalendar,
  now: Date = new Date()
): SemesterPulse | null {
  const startISO = getSemesterStartDate(cal);
  const classesEndISO = getSemesterEndDate(cal);
  const finalsEndISO = getFinalExamsEndDate(cal) ?? classesEndISO;
  if (!startISO || !finalsEndISO) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;

  const events = toRangeEvents(cal);

  // Active events: today inside [start, end]. A holiday beats anything else.
  const active = events
    .filter((e) => e.start <= todayISO && e.end >= todayISO)
    .sort((a, b) => (a.kind === 'holiday' ? -1 : b.kind === 'holiday' ? 1 : 0));

  // Week context during teaching weeks.
  const weekNow = getSemesterWeekNumber(cal, now);
  const weekTotal =
    startISO && classesEndISO
      ? Math.max(
          1,
          Math.round(
            (new Date(classesEndISO + 'T00:00:00').getTime() -
              new Date(startISO + 'T00:00:00').getTime()) /
              (7 * 24 * 60 * 60 * 1000)
          ) + 1
        )
      : null;

  let current: PulsePhase;
  if (active.length > 0) {
    const a = active[0];
    const daysLeft = daysUntil(a.end, now);
    current = {
      kind: a.kind,
      label: a.label,
      dates: formatKeyDateRange({ date: a.start, endDate: a.end }),
      context: daysLeft === 0 ? 'Ends today' : `Ends in ${daysLeft}d`,
    };
  } else if (todayISO < startISO) {
    current = {
      kind: 'pre-semester',
      label: 'Before classes begin',
      dates: `Classes start ${formatISODate(startISO)}`,
      context: `${daysUntil(startISO, now)}d to go`,
    };
  } else if (todayISO > finalsEndISO) {
    current = {
      kind: 'post-semester',
      label: 'Semester concluded',
      dates: `Finals ended ${formatISODate(finalsEndISO)}`,
    };
  } else {
    // ordinary teaching time (or a gap between exams)
    current = {
      kind: 'classes',
      label: 'Regular classes',
      dates: `${formatISODate(startISO)} – ${formatISODate(classesEndISO ?? finalsEndISO)}`,
      context:
        weekNow && weekTotal
          ? `Week ${Math.min(weekNow, weekTotal)} of ${weekTotal}`
          : weekNow
            ? `Week ${weekNow}`
            : undefined,
    };
  }

  // Next: earliest event that hasn't ended yet, excluding what's active now.
  const activeLabels = new Set(active.map((a) => `${a.label}|${a.start}`));
  const upcoming = events
    .filter((e) => e.start > todayISO && !activeLabels.has(`${e.label}|${e.start}`))
    .sort((a, b) => a.start.localeCompare(b.start));
  const n = upcoming[0];
  const next: PulseNext | null = n
    ? {
        label: n.label,
        dates: formatKeyDateRange({ date: n.start, endDate: n.end }),
        daysUntil: daysUntil(n.start, now),
        kind: n.kind,
      }
    : null;

  return { current, next };
}

/**
 * Exam-window gating for class tracking (home card + home-screen widget).
 *
 * During a sessional/finals exam window no regular classes run for anyone,
 * so showing timetable classes then is misleading. The gate has two signals:
 *
 *  - The currently PUBLISHED exam schedule (cached `data:regular_schedule`) —
 *    when the admin has turned exam visibility on, its own earliest exam day
 *    through its overall last exam end define the window. These dates win over
 *    the semester calendar on any mismatch (the calendar is the safety net for
 *    the rare slippage case, never the other way round).
 *
 *  - The semester calendar's sessional/examination key-date ranges (finals
 *    included) — authoritative on their own only while no schedule is
 *    published (visibility off / empty cache); they then hold for the whole
 *    tenure, start day to end day inclusive.
 *
 * Phase semantics while a window is active:
 *
 *  - 'exams':   until the student's LAST personal exam has passed, classes are
 *               irrelevant → hold state ("Exams ongoing." / "Stay tuned for
 *               update"). Untagged students (or a tag that resolves to no
 *               rows) hold until the OVERALL last exam of the schedule.
 *  - 'resume':  the student's exams are done but the window is still open →
 *               preview their classes from the day AFTER the window ends
 *               (timetable sheet is persistent ground truth, edited or not).
 *
 * Pure — the I/O (AsyncStorage cache reads) lives in @/widgets/examPhase.
 */

import { parseExamDate } from './dates';
import { parseExamTimeRange } from './exams';
import type { ExamEntry, SemesterCalendar } from './types';

/** What class tracking should display right now. */
export type ExamPhase =
  /** Normal next/ongoing class tracking. */
  | { kind: 'classes' }
  /**
   * Window active, student's exams not finished: hold state.
   * `untilEpochMs` — exact instant the hold should lift (last relevant exam's
   * end, or the window's day-end in calendar-only mode).
   * `anchorISO` — first day after the window (the resume-preview anchor).
   */
  | { kind: 'exams'; untilEpochMs: number; anchorISO: string }
  /** Student's exams done, window still open: probe classes at `anchorISO`. */
  | { kind: 'resume'; anchorISO: string };

export interface ExamPhaseInput {
  calendar: SemesterCalendar | null;
  /** ALL currently published exam schedule rows (regular schedule cache). */
  rows: ExamEntry[];
  /**
   * The student's own resolved exams; null when no exam tag exists or the tag
   * resolves to nothing usable — the untagged rule then applies.
   */
  personal: ExamEntry[] | null;
  /** Admin exam-visibility flag (defaults true when the cache is missing). */
  visibilityOn: boolean;
  now: Date;
}

/** Exam day owning instant: its local-midnight epoch + the exact end time. */
interface RowWindow {
  dayMs: number;
  endMs: number;
}

/** Exact end of one exam row; null when date or time is unparseable. */
function examRowWindow(e: ExamEntry): RowWindow | null {
  const day = parseExamDate(e.date);
  if (!day) return null;
  const { start, end } = parseExamTimeRange(e.time);
  if (!start && !end) return null;
  const dayMs = day.getTime();
  return { dayMs, endMs: dayMs + end * 60_000 };
}

function addDays(dayMs: number, n: number): number {
  const d = new Date(dayMs);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** 23:59:59.999 of the given local day. */
function dayEndMs(dayMs: number): number {
  return addDays(dayMs, 1) - 1;
}

/** "YYYY-MM-DD" of a local-midnight epoch. */
function isoOfDay(dayMs: number): string {
  const d = new Date(dayMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Exam days further apart than this belong to different sessional clusters. */
const CLUSTER_GAP_MS = 10 * 24 * 60 * 60 * 1000;

interface ExamCluster {
  startDayMs: number; // first exam day of the cluster
  lastDayMs: number; // last exam day of the cluster
  lastEndMs: number; // exact end instant of the cluster's overall last exam
}

/**
 * Group exam rows into sessional clusters (gaps >10 days split). A dump that
 * mixes TWO sessionals would otherwise stretch one absurd months-long window;
 * clustering keeps each sessional its own window. Returns the earliest cluster
 * whose last day hasn't fully passed, or null when everything is over.
 */
function pickCluster(rows: RowWindow[], nowMs: number): ExamCluster | null {
  const sorted = [...rows].sort((a, b) => a.dayMs - b.dayMs || a.endMs - b.endMs);
  let startDayMs = sorted[0].dayMs;
  let lastDayMs = sorted[0].dayMs;
  let lastEndMs = sorted[0].endMs;
  const flush = (): ExamCluster => ({ startDayMs, lastDayMs, lastEndMs });
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.dayMs - lastDayMs > CLUSTER_GAP_MS) {
      if (dayEndMs(lastDayMs) >= nowMs) return flush();
      startDayMs = r.dayMs;
      lastDayMs = r.dayMs;
      lastEndMs = r.endMs;
      continue;
    }
    if (r.dayMs > lastDayMs) lastDayMs = r.dayMs;
    if (r.endMs > lastEndMs) lastEndMs = r.endMs;
  }
  return dayEndMs(lastDayMs) >= nowMs ? flush() : null;
}

/**
 * End day of the calendar exam range (sessional / examinations, finals
 * included) containing today, as a local-midnight epoch — or null. Labels
 * like "Readmission Test" are deliberately NOT matched: only real windows.
 */
function activeCalendarExamEndDay(cal: SemesterCalendar | null, now: Date): number | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayISO = isoOfDay(today.getTime());
  for (const k of cal?.keyDates ?? []) {
    if (!k.date) continue;
    const low = (k.label ?? '').toLowerCase();
    if (!low.includes('sessional') && !low.includes('examination')) continue;
    const end = k.endDate ?? k.date;
    if (k.date <= todayISO && todayISO <= end) {
      const endDay = new Date(end + 'T00:00:00');
      if (!Number.isNaN(endDay.getTime())) return endDay.getTime();
    }
  }
  return null;
}

/**
 * Resolve which phase class tracking is in. Pure — unit-test target.
 *
 * Priority ladder (per spec):
 *  1. Published schedule (visibility on + usable rows): its own earliest day →
 *     overall last exam end define the window; the calendar is ignored even if
 *     it disagrees. Within it: 'exams' until the personal-last (or overall-last
 *     for untagged) exam end, then 'resume' until the window's day ends.
 *  2. Otherwise the semester calendar's ranges hold for their whole tenure:
 *     'exams' with day-end `until`, and no resume phase.
 *  3. Else: 'classes'.
 */
export function resolveExamPhase(input: ExamPhaseInput): ExamPhase {
  const nowMs = input.now.getTime();
  const rows = input.rows
    .map(examRowWindow)
    .filter((w): w is RowWindow => w !== null);

  if (input.visibilityOn && rows.length) {
    const cluster = pickCluster(rows, nowMs);
    if (!cluster) return { kind: 'classes' }; // schedule fully past: it wins
    const windowStartMs = cluster.startDayMs; // first exam day, 00:00 local
    const windowEndMs = dayEndMs(cluster.lastDayMs); // last exam day, 23:59:59.999
    if (nowMs < windowStartMs || nowMs > windowEndMs) return { kind: 'classes' };

    const anchorISO = isoOfDay(addDays(cluster.lastDayMs, 1));
    // Untagged / unresolvable tag: hold until the OVERALL last exam passes.
    let until = cluster.lastEndMs;
    if (input.personal?.length) {
      const personalEnds = input.personal
        .map(examRowWindow)
        .filter((w): w is RowWindow => w !== null)
        .map((w) => w.endMs);
      if (personalEnds.length) {
        // Clamp: a stray personal row from a LATER cluster must never push the
        // hold beyond this window's own last exam.
        until = Math.min(Math.max(...personalEnds), cluster.lastEndMs);
      }
    }
    return nowMs < until
      ? { kind: 'exams', untilEpochMs: until, anchorISO }
      : { kind: 'resume', anchorISO };
  }

  const calEndDay = activeCalendarExamEndDay(input.calendar, input.now);
  if (calEndDay != null) {
    return {
      kind: 'exams',
      untilEpochMs: dayEndMs(calEndDay),
      anchorISO: isoOfDay(addDays(calEndDay, 1)),
    };
  }
  return { kind: 'classes' };
}

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
 * EVERY phase carries `exclude`: the date ranges of the current + all upcoming
 * exam windows. Consumers filter those dates out of the class pipeline, so the
 * day BEFORE a window (and the 17:30 tomorrow-roll the evening before it) can
 * never surface a phantom class dated INSIDE a window — the lookahead simply
 * skips to the first teaching day after the window. The same shield quietly
 * covers the December finals window all semester long.
 *
 * Pure — the I/O (AsyncStorage cache reads) lives in @/widgets/examPhase.
 */

import { parseExamDate } from './dates';
import { parseExamTimeRange } from './exams';
import type { ExamEntry, SemesterCalendar } from './types';
import type { WeekPlan } from './weekPlan';

/** Inclusive local-date range, both endpoints "YYYY-MM-DD". */
export interface DateRange {
  startISO: string;
  endISO: string;
}

/** What class tracking should display right now. */
export type ExamPhase =
  /**
   * Normal next/ongoing class tracking. `upcoming` — when the NEXT window is
   * already known — carries the hold timing it would use, so consumers can
   * switch to the hold EARLY once the lookahead starts pointing into it.
   */
  | { kind: 'classes'; exclude: DateRange[]; upcoming?: { untilEpochMs: number; anchorISO: string } }
  /**
   * Window active, student's exams not finished: hold state.
   * `untilEpochMs` — exact instant the hold should lift (last relevant exam's
   * end, or the window's day-end in calendar-only mode).
   * `anchorISO` — first day after the window (the resume-preview anchor).
   */
  | { kind: 'exams'; untilEpochMs: number; anchorISO: string; exclude: DateRange[] }
  /** Student's exams done, window still open: probe classes at `anchorISO`. */
  | { kind: 'resume'; anchorISO: string; exclude: DateRange[] };

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

/** Local-midnight epoch an ISO date, null when garbled. */
function dayMsOfISO(iso: string): number | null {
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Exam days further apart than this belong to different sessional clusters. */
const CLUSTER_GAP_MS = 10 * 24 * 60 * 60 * 1000;

interface ExamCluster {
  startDayMs: number; // first exam day of the cluster
  lastDayMs: number; // last exam day of the cluster
  lastEndMs: number; // exact end instant of the cluster's overall last exam
}

/**
 * Group exam rows into sessional clusters (gaps >10 days split), sorted by
 * first day. A dump that mixes TWO sessionals would otherwise stretch one
 * absurd months-long window; clustering keeps each sessional its own window —
 * and each cluster becomes one exclusion range (the lookahead shield).
 */
function clusterAll(rows: RowWindow[]): ExamCluster[] {
  const sorted = [...rows].sort((a, b) => a.dayMs - b.dayMs || a.endMs - b.endMs);
  const out: ExamCluster[] = [];
  let startDayMs = sorted[0].dayMs;
  let lastDayMs = sorted[0].dayMs;
  let lastEndMs = sorted[0].endMs;
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.dayMs - lastDayMs > CLUSTER_GAP_MS) {
      out.push({ startDayMs, lastDayMs, lastEndMs });
      startDayMs = r.dayMs;
      lastDayMs = r.dayMs;
      lastEndMs = r.endMs;
      continue;
    }
    if (r.dayMs > lastDayMs) lastDayMs = r.dayMs;
    if (r.endMs > lastEndMs) lastEndMs = r.endMs;
  }
  out.push({ startDayMs, lastDayMs, lastEndMs });
  return out;
}

/**
 * All calendar exam ranges (sessional / examinations, finals included) whose
 * end day hasn't passed, sorted by start. Labels like "Readmission Test" are
 * deliberately NOT matched: only real windows.
 */
function calendarExamRanges(cal: SemesterCalendar | null, now: Date): DateRange[] {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const out: DateRange[] = [];
  for (const k of cal?.keyDates ?? []) {
    if (!k.date) continue;
    const low = (k.label ?? '').toLowerCase();
    if (!low.includes('sessional') && !low.includes('examination')) continue;
    const end = k.endDate ?? k.date;
    const sMs = dayMsOfISO(k.date);
    const eMs = dayMsOfISO(end);
    if (sMs == null || eMs == null) continue;
    if (eMs >= todayStart.getTime()) out.push({ startISO: k.date, endISO: end });
  }
  return out.sort((a, b) => a.startISO.localeCompare(b.startISO));
}

/**
 * Drops every resolved timetable sheet dated inside an exam window, so
 * "next class" / follow-up chains / the home card can never surface a
 * phantom class on an exam day (e.g. the evening before the window opens).
 * Sheets with an unresolvable date are kept — they are rare and harmless.
 */
export function filterExamWindowSheets(
  plan: WeekPlan | null,
  ranges: DateRange[] | undefined
): WeekPlan | null {
  if (!plan || !ranges?.length) return plan;
  const inRange = (iso: string) => ranges.some((r) => r.startISO <= iso && iso <= r.endISO);
  return {
    ...plan,
    sheets: plan.sheets.filter((s) => !s.isoDate || !inRange(s.isoDate)),
    upcomingMakeupDays: plan.upcomingMakeupDays.filter((s) => !s.isoDate || !inRange(s.isoDate)),
  };
}

/**
 * Resolve which phase class tracking is in. Pure — unit-test target.
 *
 * Priority ladder (per spec):
 *  1. Published schedule (visibility on + usable rows): its own clustered
 *     ranges both gate the day AND supply `exclude`; the cluster containing
 *     today (or the next upcoming one) decides the window bounds. Within it:
 *     'exams' until the personal-last (or overall-last for untagged) exam end,
 *     then 'resume' until the window's day ends.
 *  2. Otherwise the semester calendar's ranges hold for their whole tenure:
 *     'exams' with day-end `until`, and no resume phase.
 *  3. Else: 'classes'.
 */
/** Hold-lift instant for one cluster: personal-last rule, clamped to it. */
function clusterUntil(cluster: ExamCluster, personal: ExamEntry[] | null): number {
  // Untagged / unresolvable tag: hold until the OVERALL last exam passes.
  let until = cluster.lastEndMs;
  if (personal?.length) {
    const personalEnds = personal
      .map(examRowWindow)
      .filter((w): w is RowWindow => w !== null)
      .map((w) => w.endMs);
    if (personalEnds.length) {
      // Clamp: a stray personal row from a LATER cluster must never push the
      // hold beyond this window's own last exam.
      until = Math.min(Math.max(...personalEnds), cluster.lastEndMs);
    }
  }
  return until;
}

export function resolveExamPhase(input: ExamPhaseInput): ExamPhase {
  const nowMs = input.now.getTime();
  const todayStart = new Date(input.now);
  todayStart.setHours(0, 0, 0, 0);
  const rows = input.rows
    .map(examRowWindow)
    .filter((w): w is RowWindow => w !== null);

  if (input.visibilityOn && rows.length) {
    const clusters = clusterAll(rows);
    const exclude: DateRange[] = clusters
      .filter((c) => c.lastDayMs >= todayStart.getTime())
      .map((c) => ({ startISO: isoOfDay(c.startDayMs), endISO: isoOfDay(c.lastDayMs) }));
    // The relevant cluster is the earliest whose last day hasn't passed —
    // the active window, or the next one coming.
    const cluster = clusters.find((c) => dayEndMs(c.lastDayMs) >= nowMs) ?? null;
    if (!cluster) return { kind: 'classes', exclude };

    const windowStartMs = cluster.startDayMs; // first exam day, 00:00 local
    const windowEndMs = dayEndMs(cluster.lastDayMs); // last exam day, 23:59:59.999
    const anchorISO = isoOfDay(addDays(cluster.lastDayMs, 1));

    // Before the first exam day's midnight: classes track normally, with
    // `exclude` masking window days and `upcoming` carrying the hold timing
    // for the EARLY-hold handoff (lookahead touching the window).
    if (nowMs < windowStartMs) {
      return {
        kind: 'classes',
        exclude,
        upcoming: { untilEpochMs: clusterUntil(cluster, input.personal), anchorISO },
      };
    }

    return nowMs < clusterUntil(cluster, input.personal)
      ? { kind: 'exams', untilEpochMs: clusterUntil(cluster, input.personal), anchorISO, exclude }
      : { kind: 'resume', anchorISO, exclude };
  }

  const ranges = calendarExamRanges(input.calendar, input.now);
  const todayISO = isoOfDay(todayStart.getTime());
  const active = ranges.find((r) => r.startISO <= todayISO && todayISO <= r.endISO) ?? null;
  if (active) {
    const endDay = dayMsOfISO(active.endISO)!;
    return {
      kind: 'exams',
      untilEpochMs: dayEndMs(endDay),
      anchorISO: isoOfDay(addDays(endDay, 1)),
      exclude: ranges,
    };
  }
  // Calendar-only upcoming: first pending range supplies early-hold timing.
  const next = ranges[0];
  if (next) {
    const endDay = dayMsOfISO(next.endISO)!;
    return {
      kind: 'classes',
      exclude: ranges,
      upcoming: { untilEpochMs: dayEndMs(endDay), anchorISO: isoOfDay(addDays(endDay, 1)) },
    };
  }
  return { kind: 'classes', exclude: ranges };
}

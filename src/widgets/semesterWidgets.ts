/**
 * Semester widget publisher — snapshot consumed by ALL semester widget
 * variants (Milestone countdown, live Timeline, Month card).
 *
 * JS ships only absolute epochs (timeline span, milestone positions, personal
 * exam days); the native side derives day-index, countdown text and the
 * current month's grid per render — correct across midnight with no JS.
 */

import { cacheGet } from '@/api/cache';
import {
  getFinalExamsEndDate,
  getSemesterEndDate,
  getSemesterMilestones,
  getSemesterStartDate,
} from '@/core/semester';
import type { ExamEntry, SemesterCalendar } from '@/core/types';
import { loadExamBundles, type ExamCustomBundle } from '@/prefs/examBundles';
import { getSavedExams, type SavedExams } from '@/prefs/savedExams';
import { examDayEpochSet } from './examWidgets';
import {
  getWidgetStore,
  type SemesterWidgetMilestone,
  type SemesterWidgetSnapshot,
} from '../../modules/widget-store/src/WidgetStoreModule';

/** ms/day for day-aligning. */
const DAY = 86_400_000;

/** Local-midnight epoch for an ISO date. */
export function isoDayEpochMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * Build the semester snapshot. Pure (except updatedAt). Milestones include
 * START/END pins around the S1/S2/FE markers so the native timeline can label
 * the ends; `pct` is precomputed exactly like the in-app timeline.
 */
export function buildSemesterWidgetSnapshot(
  cal: SemesterCalendar | null | undefined,
  personalExams: ExamEntry[],
  pref: SavedExams | null,
  bundles: ExamCustomBundle[],
  now: Date
): SemesterWidgetSnapshot {
  const updatedAt = now.getTime();
  const startISO = cal ? getSemesterStartDate(cal) : null;
  const endISO = cal ? getFinalExamsEndDate(cal) ?? getSemesterEndDate(cal!) : null;
  if (!cal || !startISO || !endISO) {
    return { state: 'empty', name: '', startEpochMs: 0, endEpochMs: 0, milestones: [], examDays: [], updatedAt };
  }

  const startMs = isoDayEpochMs(startISO);
  const endMs = isoDayEpochMs(endISO);
  const span = endMs - startMs;

  const milestones: SemesterWidgetMilestone[] = [
    { label: 'Semester starts', shortLabel: 'START', epochMs: startMs, pct: 0 },
  ];
  for (const m of cal ? getSemesterMilestones(cal) : []) {
    const eMs = isoDayEpochMs(m.date);
    milestones.push({
      label: m.label,
      shortLabel: m.shortLabel,
      epochMs: eMs,
      pct: span > 0 ? Math.max(0, Math.min(100, ((eMs - startMs) / span) * 100)) : 0,
    });
  }
  milestones.push({
    label: getFinalExamsEndDate(cal) ? 'Final exams end' : 'Semester ends',
    shortLabel: 'END',
    epochMs: endMs,
    pct: 100,
  });

  // Day-aligned personal exam days for the month card (empty when untagged).
  const examDays = examDayEpochSet(personalExams, pref, bundles);

  return {
    state: 'ok',
    name: cal.semester ?? '',
    startEpochMs: startMs,
    endEpochMs: endMs,
    milestones: milestones.sort((a, b) => a.epochMs - b.epochMs),
    examDays,
    updatedAt,
  };
}

/** Avoid re-poking the widget manager when content is unchanged. */
let lastJson: string | null = null;

/** Push a snapshot natively; no-ops everywhere the native module is absent. */
export function publishSemesterWidget(snapshot: SemesterWidgetSnapshot): boolean {
  try {
    const json = JSON.stringify(snapshot);
    if (json === lastJson) return false;
    lastJson = json;
    const store = getWidgetStore();
    if (!store) return false;
    return store.setSemesterSnapshot(json);
  } catch {
    return false;
  }
}

/**
 * Recompute + publish from persisted state alone (background task / app start
 * / after exam-tag or schedule changes). Never throws.
 */
export async function syncSemesterWidgetFromCache(now: Date = new Date()): Promise<void> {
  try {
    const [calEntry, pref, bundles, scheduleEntry] = await Promise.all([
      cacheGet<SemesterCalendar>('data:semester'),
      getSavedExams(),
      loadExamBundles(),
      cacheGet<ExamEntry[]>('data:regular_schedule'),
    ]);
    publishSemesterWidget(
      buildSemesterWidgetSnapshot(
        calEntry?.data ?? null,
        scheduleEntry?.data ?? [],
        pref,
        bundles,
        now
      )
    );
  } catch {
    // best-effort
  }
}

/** Days until a day-aligned epoch (0 = today) — used in tests. */
export function daysUntilEpoch(now: Date, epochMs: number): number {
  const t = new Date(now);
  t.setHours(0, 0, 0, 0);
  return Math.round((epochMs - t.getTime()) / DAY);
}

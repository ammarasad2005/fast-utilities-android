/**
 * Exam widget publisher — builds the snapshot consumed by ALL exam widget
 * variants (Countdown, Next-exam status, My-exams list).
 *
 * "Your exams" resolve from the SEPARATE exam preference
 * (@/prefs/savedExams): a saved custom exam schedule, or a default
 * school/batch/dept selection. The snapshot ships the chronological upcoming
 * list; the native renderer derives next/ongoing from the absolute epochs,
 * so the widgets stay correct across midnight with no JS running.
 *
 * Mirrors nextClassWidget.ts' safety contract: pure builders are unit-test
 * targets; publishers no-op without the native module and never throw.
 */

import { cacheGet } from '@/api/cache';
import { matchExamRows, parseExamTimeRange } from '@/core/exams';
import { parseExamDate } from '@/core/dates';
import type { ExamEntry } from '@/core/types';
import { loadExamBundles, type ExamCustomBundle } from '@/prefs/examBundles';
import { getSavedExams, type SavedExams } from '@/prefs/savedExams';
import {
  getWidgetStore,
  type ExamWidgetItem,
  type ExamWidgetSnapshot,
} from '../../modules/widget-store/src/WidgetStoreModule';

/** Upcoming exams the snapshot carries (widgets show at most ~6). */
const MAX_ITEMS = 8;

/** Local-midnight epoch of an exam's DD/MM/YYYY date (null when unparseable). */
export function examDayEpochMs(e: ExamEntry): number | null {
  const d = parseExamDate(e.date);
  return d ? d.getTime() : null;
}

/** Start/end epochs (local) for an exam row; null when date/time unparseable. */
export function examWindowEpochMs(e: ExamEntry): { start: number; end: number } | null {
  const day = parseExamDate(e.date);
  if (!day) return null;
  const { start, end } = parseExamTimeRange(e.time);
  if (!start || !end) return null;
  return { start: day.getTime() + start * 60_000, end: day.getTime() + end * 60_000 };
}

/** "Mon 12 Jan" for the list row. */
export function examItemDateLabel(e: ExamEntry): string {
  const d = parseExamDate(e.date);
  if (!d) return e.date;
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday} ${d.getDate()} ${month}`;
}

/**
 * Resolve the entries that are "my exams" for the given preference.
 * Pure — widget + app share it. Bundle refs that no longer resolve → [].
 */
export function resolvePersonalExams(
  allExams: ExamEntry[],
  pref: SavedExams,
  bundles: ExamCustomBundle[]
): ExamEntry[] {
  if (pref.kind === 'bundle') {
    const b = bundles.find((x) => x.id === pref.bundleId);
    if (!b) return [];
    return matchExamRows(allExams, b.rows, b.school);
  }
  return allExams.filter(
    (e) => e.school === pref.school && e.batch === pref.batch && e.department === pref.dept
  );
}

/**
 * Build the exam widget snapshot. Pure (except updatedAt).
 * - needsTag: no exam preference saved.
 * - hidden: admin visibility flag off (mirrors the in-app gate).
 * - empty: preference resolves but nothing is upcoming.
 */
export function buildExamWidgetSnapshot(
  allExams: ExamEntry[],
  pref: SavedExams | null,
  bundles: ExamCustomBundle[],
  opts: { visible: boolean; now: Date }
): ExamWidgetSnapshot {
  const updatedAt = opts.now.getTime();
  if (!pref) return { state: 'needsTag', updatedAt };
  if (!opts.visible) return { state: 'hidden', updatedAt };

  const personal = resolvePersonalExams(allExams, pref, bundles);
  const nowMs = opts.now.getTime();
  const items: ExamWidgetItem[] = [];
  for (const e of personal) {
    const win = examWindowEpochMs(e);
    if (!win || win.end < nowMs) continue; // fully past
    items.push({
      course: e.courseName,
      code: e.courseCode,
      dateLabel: examItemDateLabel(e),
      timeLabel: e.time,
      startEpochMs: win.start,
      endEpochMs: win.end,
      ...(e.room ? { room: e.room } : {}),
    });
  }
  items.sort((a, b) => a.startEpochMs - b.startEpochMs);
  if (!items.length) return { state: 'empty', updatedAt };
  return { state: 'ok', items: items.slice(0, MAX_ITEMS), updatedAt };
}

/** Day-aligned epochs of ALL personal exams (month-card dots), pure. */
export function examDayEpochSet(
  allExams: ExamEntry[],
  pref: SavedExams | null,
  bundles: ExamCustomBundle[]
): number[] {
  if (!pref) return [];
  const days = new Set<number>();
  for (const e of resolvePersonalExams(allExams, pref, bundles)) {
    const d = examDayEpochMs(e);
    if (d) days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

/** Avoid re-poking the widget manager when content is unchanged. */
let lastJson: string | null = null;

/** Push a snapshot natively; no-ops everywhere the native module is absent. */
export function publishExamWidget(snapshot: ExamWidgetSnapshot): boolean {
  try {
    const json = JSON.stringify(snapshot);
    if (json === lastJson) return false;
    lastJson = json;
    const store = getWidgetStore();
    if (!store) return false;
    return store.setExamSnapshot(json);
  } catch {
    return false;
  }
}

interface ExamVisibilityCache {
  show_exams?: boolean;
}

/**
 * Recompute + publish from persisted state alone (background task / app start
 * / after tag or schedule changes). Never throws.
 */
export async function syncExamWidgetsFromCache(now: Date = new Date()): Promise<void> {
  try {
    const [pref, bundles, scheduleEntry, visEntry] = await Promise.all([
      getSavedExams(),
      loadExamBundles(),
      cacheGet<ExamEntry[]>('data:regular_schedule'),
      cacheGet<ExamVisibilityCache>('data:exam_visibility'),
    ]);
    const visible = visEntry?.data?.show_exams !== false; // missing cache = assume visible
    if (!pref) {
      publishExamWidget({ state: 'needsTag', updatedAt: now.getTime() });
      return;
    }
    publishExamWidget(
      buildExamWidgetSnapshot(scheduleEntry?.data ?? [], pref, bundles, { visible, now })
    );
  } catch {
    // best-effort
  }
}

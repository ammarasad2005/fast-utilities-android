/**
 * Loads the exam-window gate state (@/core/examWindow) from persisted caches
 * alone — never touches the network. Shared by the home screen and the
 * background widget sync so widget and app can never disagree.
 *
 * Data parity note: mirrors the exam widgets' own consumption —
 * `data:regular_schedule` + `data:exam_visibility` (regular semester is the
 * app's published-schedule convention; the summer schedule carries no window
 * semantics in the widgets today).
 */

import { cacheGet } from '@/api/cache';
import { resolveExamPhase, type ExamPhase } from '@/core/examWindow';
import type { ExamEntry, SemesterCalendar } from '@/core/types';
import { loadExamBundles } from '@/prefs/examBundles';
import { getSavedExams } from '@/prefs/savedExams';
import { resolvePersonalExams } from './examWidgets';

interface ExamVisibilityCache {
  show_exams?: boolean;
}

/** Best-effort; any failure degrades to 'classes' (gate simply doesn't fire). */
export async function loadExamPhase(now: Date = new Date()): Promise<ExamPhase> {
  try {
    const [calEntry, rowsEntry, visEntry, pref, bundles] = await Promise.all([
      cacheGet<SemesterCalendar>('data:semester'),
      cacheGet<ExamEntry[]>('data:regular_schedule'),
      cacheGet<ExamVisibilityCache>('data:exam_visibility'),
      getSavedExams(),
      loadExamBundles(),
    ]);
    const rows = rowsEntry?.data ?? [];
    const visibilityOn = visEntry?.data?.show_exams !== false; // missing = visible
    let personal: ExamEntry[] | null = null;
    if (pref && rows.length) {
      const resolved = resolvePersonalExams(rows, pref, bundles);
      // A tag that resolves to nothing behaves as untagged (overall-last rule).
      personal = resolved.length ? resolved : null;
    }
    return resolveExamPhase({
      calendar: calEntry?.data ?? null,
      rows,
      personal,
      visibilityOn,
      now,
    });
  } catch {
    return { kind: 'classes', exclude: [] };
  }
}

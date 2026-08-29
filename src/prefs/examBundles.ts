import AsyncStorage from '@react-native-async-storage/async-storage';

import { departmentSchool } from '@/core/exams';
import { clearSavedExams, getSavedExams } from './savedExams';

/**
 * Custom exam schedule storage (single-slot), the exam-side mirror of
 * @/prefs/bundles.
 *
 * User-facing model: exactly ONE custom exam schedule ("My exam schedule").
 * Same storage key the legacy multi-bundle screen used, so existing installs
 * keep their data through the one-time migration below.
 */

export interface ExamBundleRow {
  id: string;
  batch: string;
  dept: string;
  /**
   * "Course Name | CODE" (same shape as the timetable's "Course | Section").
   * Exams have no sections — a course is examined once per batch/dept — so
   * the "section" slot carries the course code for disambiguation. Legacy
   * rows (pre-parity) carried only `code`; loadExamBundles normalizes them
   * to `| CODE`, which the matcher resolves by code alone.
   */
  selection: string;
  /** Legacy field on pre-parity rows: the bare course code. */
  code?: string;
}

export interface ExamCustomBundle {
  id: string;
  name: string;
  school: string; // 'FSC' | 'FSM' | 'FSE'
  rows: ExamBundleRow[];
}

export const EXAM_BUNDLES_KEY = 'custom:exam_bundles';

/** Display name no longer user-chosen (naming was part of the bundle UX). */
export const CUSTOM_EXAMS_NAME = 'My exam schedule';

/** Normalize one row to the current shape (legacy code → selection). */
function normalizeRow(r: ExamBundleRow): ExamBundleRow {
  if (r.selection) return r;
  if (r.code) return { ...r, selection: `| ${r.code}` };
  return { ...r, selection: '' };
}

export async function loadExamBundles(): Promise<ExamCustomBundle[]> {
  try {
    const raw = await AsyncStorage.getItem(EXAM_BUNDLES_KEY);
    let list: ExamCustomBundle[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    return list.map((b) => ({
      ...b,
      // Pre-parity bundles had no school field; derive from the first row's
      // department (every old row is one school in practice).
      school: b.school ?? departmentSchool(b.rows?.[0]?.dept ?? '') ?? 'FSC',
      rows: (b.rows ?? []).map(normalizeRow),
    }));
  } catch {
    return [];
  }
}

export async function saveExamBundles(list: ExamCustomBundle[]): Promise<void> {
  await AsyncStorage.setItem(EXAM_BUNDLES_KEY, JSON.stringify(list)).catch(() => {});
}

/**
 * One-time migration: multi-bundle lists collapse to a single custom exam
 * schedule. Keeps the bundle the exam tag points at if any (tag must not
 * silently die); otherwise the most recently saved — the legacy screen
 * appended, so that is the LAST element. Everything else is deleted, and a
 * dangling exam tag pointing at a deleted bundle is cleared. Idempotent.
 */
export async function migrateExamBundlesToSingle(): Promise<void> {
  try {
    const list = await loadExamBundles();
    if (list.length <= 1) return;
    const saved = await getSavedExams();
    const taggedId =
      saved?.kind === 'bundle' && list.some((b) => b.id === saved.bundleId)
        ? saved.bundleId
        : null;
    const fallback = list[list.length - 1]; // legacy screen appended (newest last)
    const keep = list.filter((b) => b.id === (taggedId ?? fallback?.id));
    await saveExamBundles(keep);
    if (saved?.kind === 'bundle' && !keep.some((b) => b.id === saved.bundleId)) {
      await clearSavedExams();
    }
  } catch {
    // Migration is best-effort; the single-slot writer re-normalizes anyway.
  }
}

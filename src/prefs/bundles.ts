import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearSavedSchedule, getSavedSchedule } from './savedSchedule';

/**
 * Custom timetable storage (shared loader).
 * Lives here (not in the screen) so the Home next-class card can resolve a
 * custom-tagged "my timetable" without importing UI code.
 *
 * User-facing model: exactly ONE custom timetable ("my custom timetable").
 * The storage shape still carries the legacy `CustomBundle` record so saved
 * preferences (`SavedSchedule { kind: 'bundle' }`) and the Home card keep
 * working untouched — the multi-bundle UX is gone, the row format stayed.
 */

export interface BundleRow {
  id: string;
  batch: string;
  dept: string;
  category: string;
  selection: string; // "Course Name | Section"
}

export interface CustomBundle {
  id: string;
  name: string;
  school: string; // 'FSC' | 'FSM'
  rows: BundleRow[];
}

export const BUNDLES_KEY = 'custom:timetable_bundles';

/** Display name no longer user-chosen (naming was part of the bundle UX). */
export const CUSTOM_TIMETABLE_NAME = 'My timetable';

/**
 * One-time migration (per locked product decision): multi-bundle lists are
 * collapsed to a single custom timetable. Keeps the TAGGED bundle if any
 * (tag must not silently die); otherwise the most recently saved (list is
 * newest-first). Everything else is deleted, and a dangling tag pointing at a
 * deleted bundle is cleared. Idempotent.
 */
export async function migrateBundlesToSingle(): Promise<void> {
  try {
    const list = await loadBundles();
    if (list.length <= 1) return;
    const saved = await getSavedSchedule();
    const taggedId =
      saved?.kind === 'bundle' && list.some((b) => b.id === saved.bundleId)
        ? saved.bundleId
        : null;
    const keep = list.filter((b) => b.id === (taggedId ?? list[0]?.id));
    await saveBundles(keep);
    if (saved?.kind === 'bundle' && !keep.some((b) => b.id === saved.bundleId)) {
      await clearSavedSchedule();
    }
  } catch {
    // Migration is best-effort; the single-slot writer re-normalizes anyway.
  }
}

export async function loadBundles(): Promise<CustomBundle[]> {
  try {
    const raw = await AsyncStorage.getItem(BUNDLES_KEY);
    let list: CustomBundle[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    // Migrate pre-school bundles: default to FSC.
    return list.map((b) => ({ ...b, school: b.school ?? 'FSC' }));
  } catch {
    return [];
  }
}

export async function saveBundles(list: CustomBundle[]): Promise<void> {
  await AsyncStorage.setItem(BUNDLES_KEY, JSON.stringify(list)).catch(() => {});
}

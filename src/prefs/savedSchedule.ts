import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Saved schedule preference — the single "my timetable" tag.
 *
 * Exactly ONE collection of classes can hold the tag at a time (mirrors and
 * extends the web app's saved-preferences model):
 *
 *   - a DEFAULT configuration  (school + batch + department + section), or
 *   - ONE of the user's saved custom-timetable bundles.
 *
 * To appoint the tag to another configuration, it must first be removed from
 * the current holder — callers are expected to surface that instead of
 * silently replacing.
 */

export interface DefaultSchedulePref {
  kind: 'default';
  school: string; // 'FSC' | 'FSM'
  batch: string;
  dept: string;
  section: string;
}

export interface BundleSchedulePref {
  kind: 'bundle';
  bundleId: string;
}

export type SavedSchedule = DefaultSchedulePref | BundleSchedulePref;

const KEY = 'pref:saved_schedule';

export async function getSavedSchedule(): Promise<SavedSchedule | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.kind === 'default' || parsed.kind === 'bundle')) return parsed as SavedSchedule;
    return null;
  } catch {
    return null;
  }
}

export async function setSavedSchedule(value: SavedSchedule): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(value)).catch(() => {});
}

export async function clearSavedSchedule(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

/** Human-readable label for a saved schedule (used in conflicts/alerts). */
export function describeSavedSchedule(pref: SavedSchedule | null, bundleName?: string): string {
  if (!pref) return 'none';
  if (pref.kind === 'bundle') return `bundle “${bundleName ?? pref.bundleId}”`;
  return `${pref.school} · ${pref.dept} ${pref.batch} · Sec ${pref.section}`;
}

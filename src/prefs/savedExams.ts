import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Saved EXAMS preference — the "my exams" tag.
 *
 * Managed SEPARATELY from the timetable preference (@/prefs/savedSchedule):
 * each widget family reads only its own tag, so tagging an exam schedule
 * never disturbs a tagged timetable and vice versa. Exactly ONE holder at a
 * time on each side:
 *
 *   - a DEFAULT exam selection (school + batch + department), or
 *   - the user's saved custom exam schedule (single-slot; stored kind stays
 *     'bundle', mirroring the timetable model).
 *
 * To appoint the tag to another selection, it must first be removed from the
 * current holder — callers surface that instead of silently replacing.
 */

export interface DefaultExamsPref {
  kind: 'default';
  school: string; // 'FSC' | 'FSM' | 'FSE'
  batch: string;
  dept: string;
}

export interface BundleExamsPref {
  kind: 'bundle';
  bundleId: string;
}

export type SavedExams = DefaultExamsPref | BundleExamsPref;

const KEY = 'pref:saved_exams';

export async function getSavedExams(): Promise<SavedExams | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.kind === 'default' || parsed.kind === 'bundle')) {
      return parsed as SavedExams;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setSavedExams(value: SavedExams): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(value)).catch(() => {});
}

export async function clearSavedExams(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

/** Human-readable label for a saved exam preference (conflict prompts). */
export function describeSavedExams(pref: SavedExams | null): string {
  if (!pref) return 'none';
  if (pref.kind === 'bundle') return 'your custom exam schedule';
  return `${pref.school} · ${pref.dept} ${pref.batch}`;
}

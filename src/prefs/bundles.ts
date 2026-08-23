import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Custom-timetable bundles (shared loader).
 * Lives here (not in the screen) so the Home next-class card can resolve a
 * bundle-tagged "my timetable" without importing UI code.
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

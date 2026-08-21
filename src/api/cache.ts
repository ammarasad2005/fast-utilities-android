import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Minimal TTL cache built on AsyncStorage.
 *
 * Used for the read-heavy, relatively static campus data (timetables, exam
 * schedules, faculty, semester calendar, events). Each entry stores the payload
 * plus a fetchedAt timestamp; readers get the cached copy immediately and the
 * caller decides whether to revalidate in the background.
 */

export interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export async function cacheGet<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.fetchedAt !== 'number' || parsed.data === undefined) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, fetchedAt: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Cache writes are best-effort; never throw.
  }
}

export function isStale<T>(entry: CacheEntry<T>, ttlMs: number): boolean {
  return Date.now() - entry.fetchedAt > ttlMs;
}

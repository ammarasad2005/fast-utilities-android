/**
 * Sideload self-update check (the app is distributed as a direct APK, not on
 * Play), modeled on the standard release-manifest pattern:
 *
 *   app fetches version.json (raw GitHub, cache-busted) → compares its
 *   versionCode against the build's own → if newer, Home shows an update
 *   banner → user taps Download & Install → expo-file-system (legacy API) downloads the
 *   APK from the GitHub Releases asset URL → the native AppUpdater module
 *   hands it to the system package installer (same-signature update prompt).
 *
 * Checked at most once per CHECK_THROTTLE_MS so cold starts stay fast.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const VERSION_JSON_URL =
  'https://raw.githubusercontent.com/ammarasad2005/fast-utilities-android/main/version.json';
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours
const LAST_CHECK_KEY = 'updater:last_check';
const TIMEOUT_MS = 8000;

export interface RemoteVersion {
  versionCode: number;
  apkUrl: string;
  notes?: string;
  publishedAt?: string;
}

export function localVersionCode(): number {
  return Constants.expoConfig?.android?.versionCode ?? 0;
}

export function isUpdateAvailable(remote: RemoteVersion | null): remote is RemoteVersion {
  return !!remote && remote.versionCode > localVersionCode() && !!remote.apkUrl;
}

/** Pure — unit-testable fetch/shape validation. */
export function parseRemoteVersion(raw: unknown): RemoteVersion | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.versionCode !== 'number' || typeof v.apkUrl !== 'string') return null;
  return {
    versionCode: v.versionCode,
    apkUrl: v.apkUrl,
    notes: typeof v.notes === 'string' ? v.notes : undefined,
    publishedAt: typeof v.publishedAt === 'string' ? v.publishedAt : undefined,
  };
}

export async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`${VERSION_JSON_URL}?t=${Date.now()}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return parseRemoteVersion(await res.json());
  } catch {
    return null;
  }
}

/** Throttled check — call from a screen mount; resolves null when nothing new. */
export async function checkForUpdateNow(): Promise<RemoteVersion | null> {
  try {
    const last = Number((await AsyncStorage.getItem(LAST_CHECK_KEY)) ?? 0);
    if (Date.now() - last < CHECK_THROTTLE_MS) return null;
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // throttle bookkeeping is best-effort
  }
  const remote = await fetchRemoteVersion();
  return isUpdateAvailable(remote) ? remote : null;
}

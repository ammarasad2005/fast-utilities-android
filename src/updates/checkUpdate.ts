/**
 * Sideload self-update check (the app is distributed as a direct APK, not on
 * Play), modeled on the standard release-manifest pattern:
 *
 *   app fetches version.json (GitHub release manifest, cache-busted) →
 *   compares its versionCode against the build's own → if newer, Home shows
 *   an update banner → user taps Download & Install → expo-file-system
 *   (legacy API) downloads the APK from the GitHub Releases asset URL → the
 *   native AppUpdater module hands it to the system package installer
 *   (same-signature update prompt).
 *
 * Reliability design (v1.9.4 hardening):
 *  · Multiple manifest endpoints, tried in order — raw.githubusercontent is
 *    intermittently unreachable on some Pakistani ISPs, so the GitHub API
 *    contents endpoint and the jsDelivr mirror are fallbacks.
 *  · The check throttle is only committed AFTER a successful fetch. A failed
 *    check no longer consumes the window — the next launch retries at once.
 *  · The last valid manifest is persisted. While throttled, a cached manifest
 *    that still advertises a newer build re-surfaces the banner, so tapping
 *    "Later" can't hide an update for hours.
 *  · Dismissing snoozes the banner per-version for DISMISS_SNOOZE_MS; a new
 *    build always re-alerts regardless of prior dismissals.
 *  · About screen exposes a force check (bypasses throttle + snooze) so the
 *    update path is always manually reachable.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours between network checks
export const DISMISS_SNOOZE_MS = 12 * 60 * 60 * 1000; // 12h per-version snooze
const TIMEOUT_MS = 6000; // per endpoint
const LAST_CHECK_KEY = 'updater:last_check';
const LAST_REMOTE_KEY = 'updater:last_remote';
const DISMISS_KEY = 'updater:dismissed';

export interface RemoteVersion {
  versionCode: number;
  apkUrl: string;
  notes?: string;
  publishedAt?: string;
}

/** Last valid manifest as persisted (adds fetch timestamp). */
export interface CachedRemote extends RemoteVersion {
  fetchedAt: number;
}

export interface DismissRecord {
  versionCode: number;
  at: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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

/**
 * Manifest endpoints in preference order. Raw raw.githubusercontent comes
 * first (fast, cache-busted); the GitHub API contents endpoint second;
 * jsDelivr's mirror last (it can lag a few minutes behind main).
 */
export function buildManifestEndpoints(now: number): { url: string; headers?: Record<string, string> }[] {
  return [
    {
      url: `https://raw.githubusercontent.com/ammarasad2005/fast-utilities-android/main/version.json?t=${now}`,
    },
    {
      url: 'https://api.github.com/repos/ammarasad2005/fast-utilities-android/contents/version.json',
      headers: { Accept: 'application/vnd.github.raw' },
    },
    { url: 'https://cdn.jsdelivr.net/gh/ammarasad2005/fast-utilities-android@main/version.json' },
  ];
}

/** Try each endpoint until one yields a valid manifest; null if all fail. */
export async function fetchRemoteVersion(fetchImpl?: FetchLike): Promise<RemoteVersion | null> {
  const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  for (const ep of buildManifestEndpoints(Date.now())) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await doFetch(ep.url, { signal: ctrl.signal, headers: ep.headers });
      clearTimeout(timer);
      if (!res.ok) continue;
      const parsed = parseRemoteVersion(await res.json());
      if (parsed) return parsed; // first valid manifest wins
    } catch {
      // endpoint unreachable/timeout/invalid JSON → try next
    }
  }
  return null;
}

/** Pure banner-visibility decision. */
export function shouldShowUpdate(
  remote: RemoteVersion | null,
  dismissed: DismissRecord | null,
  now: number
): boolean {
  if (!isUpdateAvailable(remote)) return false;
  if (!dismissed) return true;
  if (dismissed.versionCode !== remote.versionCode) return true; // new build → always alert
  return now - dismissed.at >= DISMISS_SNOOZE_MS; // snooze expired → alert again
}

export async function dismissUpdate(versionCode: number): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISS_KEY, JSON.stringify({ versionCode, at: Date.now() }));
  } catch {
    // best-effort
  }
}

export async function readCachedRemote(): Promise<CachedRemote | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_REMOTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rv = parseRemoteVersion(parsed);
    if (!rv || typeof parsed.fetchedAt !== 'number') return null;
    return { ...rv, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

export interface UpdateDiagnostics {
  lastCheckAt: number | null;
  cached: CachedRemote | null;
  dismissed: DismissRecord | null;
}

export async function readUpdateDiagnostics(): Promise<UpdateDiagnostics> {
  const cached = await readCachedRemote();
  let lastCheckAt: number | null = null;
  let dismissed: DismissRecord | null = null;
  try {
    const last = await AsyncStorage.getItem(LAST_CHECK_KEY);
    lastCheckAt = last ? Number(last) : null;
  } catch {}
  try {
    const raw = await AsyncStorage.getItem(DISMISS_KEY);
    if (raw) {
      const d = JSON.parse(raw) as DismissRecord;
      if (typeof d.versionCode === 'number' && typeof d.at === 'number') dismissed = d;
    }
  } catch {}
  return { lastCheckAt, cached, dismissed };
}

/**
 * Automatic check — call from a screen mount / app foreground.
 * Resolves the update to show, or null. Failure-safe: network failures do NOT
 * consume the throttle window, and while throttled a cached manifest that
 * still advertises a newer build is returned (so "Later" can't bury it).
 */
export async function checkForUpdateNow(opts?: {
  force?: boolean;
  fetchImpl?: FetchLike;
}): Promise<RemoteVersion | null> {
  const now = Date.now();

  if (!opts?.force) {
    let last = 0;
    try {
      last = Number((await AsyncStorage.getItem(LAST_CHECK_KEY)) ?? 0);
    } catch {}
    if (now - last < CHECK_THROTTLE_MS) {
      // Within the window: re-derive from cache so the banner survives "Later".
      const cached = await readCachedRemote();
      if (!isUpdateAvailable(cached)) return null;
      const { dismissed } = await readUpdateDiagnostics();
      return shouldShowUpdate(cached, dismissed, now) ? cached : null;
    }
  }

  const remote = await fetchRemoteVersion(opts?.fetchImpl);
  if (!remote) return null; // failed check: throttle NOT committed → retry next launch

  try {
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(now));
    await AsyncStorage.setItem(LAST_REMOTE_KEY, JSON.stringify({ ...remote, fetchedAt: now }));
  } catch {
    // bookkeeping best-effort
  }

  if (!isUpdateAvailable(remote)) return null;
  if (opts?.force) return remote; // explicit user request → ignore snooze
  const { dismissed } = await readUpdateDiagnostics();
  return shouldShowUpdate(remote, dismissed, now) ? remote : null;
}

export type ForceCheckResult =
  | { kind: 'update'; remote: RemoteVersion }
  | { kind: 'current'; remote: RemoteVersion }
  | { kind: 'unreachable' };

/** Manual "Check now" (About screen) — bypasses throttle and snooze. */
export async function forceCheckNow(fetchImpl?: FetchLike): Promise<ForceCheckResult> {
  const remote = await checkForUpdateNow({ force: true, fetchImpl });
  if (remote) return { kind: 'update', remote };
  // Distinguish "up to date" from "couldn't fetch": re-read what the attempt stored.
  const { lastCheckAt } = await readUpdateDiagnostics();
  if (lastCheckAt && Date.now() - lastCheckAt < 60_000) {
    const cached = await readCachedRemote();
    if (cached) return { kind: 'current', remote: cached };
  }
  return { kind: 'unreachable' };
}

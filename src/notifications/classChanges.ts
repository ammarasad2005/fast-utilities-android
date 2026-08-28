/**
 * Class-change notifications — orchestrator.
 *
 * Pure client-side design (no push infra): every run fetches the timetable
 * JSON fresh, resolves the entries for the user's TAGGED schedule only,
 * diffs them against the last-seen snapshot in AsyncStorage, and posts a
 * local notification for what's new. Runs from two places:
 *   1. the 15-min headless background sync task (even when the app is killed)
 *   2. opportunistically when the timetable tab gets focus (cheap, throttled)
 *
 * Design properties:
 *  - First run after install SEEDS the baseline silently — no "everything is
 *    new" notification blast.
 *  - The baseline advances even when alerts are disabled, so enabling the
 *    toggle later only alerts on changes that happen afterwards.
 *  - A 7-day signature ledger de-dupes across overlapping runs (background
 *    task and foreground check are separate JS instances sharing storage).
 *  - Fail-closed: any fetch/parse error leaves the baseline untouched.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DATA_ENDPOINTS } from '@/api/config';
import { fetchJson } from '@/api/client';
import { computeDisplayedEntries, flattenTimetable, matchCustomRows } from '@/core/timetable';
import type { RawTimetableJSON, TimetableEntry } from '@/core/types';
import {
  changeKey,
  diffTimetable,
  summarize,
  type ClassChange,
} from '@/core/timetableDiff';
import { loadBundles } from '@/prefs/bundles';
import { getSavedSchedule } from '@/prefs/savedSchedule';
import {
  getNotifier,
  hasNotificationsPermission,
  notifyClassChange,
} from '../../modules/widget-store/src/NotifierModule';

const PREF_ENABLED = 'pref:notif:class_changes';
const BASELINE_PREFIX = 'notif:timetableBaseline:';
const LEDGER_KEY = 'notif:sentChangeKeys';
const LEDGER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Foreground focus triggers at most one real check per cooldown. */
const FOREGROUND_COOLDOWN_MS = 10 * 60 * 1000;
const COOLDOWN_KEY = 'notif:lastCheckAt';
/** ≥2 changes land in one merged summary notification. */
const MERGE_THRESHOLD = 2;

export async function isClassChangeAlertsEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREF_ENABLED)) === '1';
  } catch {
    return false;
  }
}

export async function setClassChangeAlertsEnabled(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_ENABLED, on ? '1' : '0');
  } catch {
    // best-effort
  }
}

/** What the tagged schedule is diffing against, keyed per tag identity. */
function baselineKey(school: string, scope: string): string {
  return `${BASELINE_PREFIX}${school}:${scope}`;
}

interface CheckResult {
  status: 'ok' | 'seeded' | 'skipped' | 'error';
  changes: ClassChange[];
  notified: boolean;
}

async function resolveTaggedEntries(raw: RawTimetableJSON, saved: NonNullable<Awaited<ReturnType<typeof getSavedSchedule>>>): Promise<TimetableEntry[] | null> {
  const entries = flattenTimetable(raw);
  if (saved.kind === 'bundle') {
    const bundles = await loadBundles();
    const bundle = bundles.find((b) => b.id === saved.bundleId);
    if (!bundle) return null;
    return matchCustomRows(entries, bundle.rows);
  }
  let prefs = { sectionByCourse: {} as Record<string, string>, pickedElectives: [] as string[] };
  try {
    const scope = `${saved.school}:${saved.batch}:${saved.dept}:${saved.section}`;
    const rawRaw = await AsyncStorage.getItem(`pref:resultprefs:${scope}`);
    const parsed = rawRaw ? JSON.parse(rawRaw) : null;
    prefs = {
      sectionByCourse: parsed?.sectionByCourse ?? {},
      pickedElectives: parsed?.pickedElectives ?? [],
    };
  } catch {
    // defaults suffice
  }
  return computeDisplayedEntries(
    entries,
    { batch: saved.batch, department: saved.dept, section: saved.section },
    prefs,
  );
}

/** Ledger of already-notified change signatures (7-day TTL). */
async function filterUnnotified(changes: ClassChange[]): Promise<ClassChange[]> {
  let ledger: Record<string, number> = {};
  try {
    ledger = JSON.parse((await AsyncStorage.getItem(LEDGER_KEY)) ?? '{}') ?? {};
  } catch {
    ledger = {};
  }
  const now = Date.now();
  // prune + filter
  for (const k of Object.keys(ledger)) {
    if (now - ledger[k] > LEDGER_TTL_MS) delete ledger[k];
  }
  const fresh = changes.filter((c) => {
    const key = changeKey(c);
    if (ledger[key]) return false;
    ledger[key] = now;
    return true;
  });
  try {
    await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // losing the ledger means a duplicate alert next run — tolerable
  }
  return fresh;
}

/**
 * Run one change check. `foreground` applies the focus-spam cooldown and
 * native-module availability guard (the background task always succeeds it).
 * Pass `rawOverride` with an already-fetched payload (per school) to skip the
 * network read; on absent/failed override (or foreground mode) we fetch fresh.
 */
export async function checkTimetableChanges(opts?: {
  foreground?: boolean;
  rawOverride?: Partial<Record<'FSC' | 'FSM', RawTimetableJSON | undefined>>;
}): Promise<CheckResult> {
  try {
    if (!getNotifier()) return { status: 'skipped', changes: [], notified: false };

    if (opts?.foreground) {
      try {
        const last = Number((await AsyncStorage.getItem(COOLDOWN_KEY)) ?? 0);
        if (Date.now() - last < FOREGROUND_COOLDOWN_MS) {
          return { status: 'skipped', changes: [], notified: false };
        }
        await AsyncStorage.setItem(COOLDOWN_KEY, String(Date.now()));
      } catch {
        // proceed
      }
    }

    const saved = await getSavedSchedule();
    if (!saved) return { status: 'skipped', changes: [], notified: false };

    // Tagged timetable's school. A bundle's school lives in the bundle def.
    const school =
      saved.kind === 'bundle'
        ? (await loadBundles()).find((b) => b.id === saved.bundleId)?.school ?? null
        : saved.school;
    if (!school) return { status: 'skipped', changes: [], notified: false };

    // Data source: prefer the payload the caller just pulled (background sync
    // path — zero extra traffic). Otherwise fetch fresh with 5-minute
    // edge-cache buckets: timely diffs without every client slamming origin.
    let raw: RawTimetableJSON | undefined =
      school === 'FSM' ? opts?.rawOverride?.FSM : opts?.rawOverride?.FSC;
    if (!raw || typeof raw !== 'object') {
      const url = school === 'FSM' ? DATA_ENDPOINTS.timetableFSM : DATA_ENDPOINTS.timetableFSC;
      const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
      raw = await fetchJson<RawTimetableJSON>(`${url}?notif_ts=${bucket}`);
    }
    if (!raw || typeof raw !== 'object') return { status: 'error', changes: [], notified: false };

    const scope =
      saved.kind === 'bundle' ? `bundle:${saved.bundleId}` : `${saved.batch}:${saved.dept}:${saved.section}`;
    const key = baselineKey(school, scope);

    const mine = await resolveTaggedEntries(raw, saved);
    if (!mine) return { status: 'skipped', changes: [], notified: false };

    let prevEntries: TimetableEntry[] | null = null;
    try {
      const prevRaw = await AsyncStorage.getItem(key);
      prevEntries = prevRaw ? (JSON.parse(prevRaw) as TimetableEntry[]) : null;
    } catch {
      prevEntries = null;
    }

    if (!prevEntries) {
      // First run: seed silently, never notify.
      try {
        await AsyncStorage.setItem(key, JSON.stringify(mine));
      } catch {
        // ignore
      }
      return { status: 'seeded', changes: [], notified: false };
    }

    const changes = diffTimetable(prevEntries, mine);

    // Advance the baseline regardless of the alert toggle, so diff timing is
    // anchored to data freshness, not to when the user opted in.
    try {
      await AsyncStorage.setItem(key, JSON.stringify(mine));
    } catch {
      // ignore — worst case we re-diff the same pair next run; ledger dedupes
    }

    if (!changes.length) return { status: 'ok', changes, notified: false };

    const fresh = await filterUnnotified(changes);
    if (!fresh.length) return { status: 'ok', changes: [], notified: false };

    const enabled = await isClassChangeAlertsEnabled();
    if (!enabled || !hasNotificationsPermission()) {
      return { status: 'ok', changes: fresh, notified: false };
    }

    const { title, body } = summarize(fresh);
    const dedupeId = fresh.length >= MERGE_THRESHOLD
      ? `multi:${changeKey(fresh[0])}:${fresh.length}`
      : changeKey(fresh[0]);
    const posted = notifyClassChange(title, body, dedupeId);
    return { status: 'ok', changes: fresh, notified: posted };
  } catch (err) {
    console.warn('[class-change-notif] check failed:', err);
    return { status: 'error', changes: [], notified: false };
  }
}

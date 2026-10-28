/**
 * Home-screen widget publisher.
 *
 * The Android AppWidgetProvider (modules/widget-store) renders whatever JSON
 * snapshot we last pushed into SharedPreferences. This module builds that
 * snapshot from the SAME ClassStatus the in-app NextClassCard renders, so the
 * widget shows exactly what the app shows — and the provider recomputes the
 * countdown text from the absolute target timestamp on every OS render tick,
 * so it drifts at most one tick (~30 min) minus app-side pokes.
 *
 * Two publishers:
 *  - publishNextClassWidget(): cheap, called from the Home screen whenever the
 *    live status changes (every 30s tick at most a no-op string compare).
 *  - syncNextClassWidgetFromCache(): recomputes the full pipeline from
 *    AsyncStorage alone; called by the background sync task so the widget
 *    stays fresh even when the app has been killed.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { cacheGet } from '@/api/cache';
import { parseTimeRange, formatISODateShort } from '@/core/dates';
import { computeClassStatus, type ClassStatus } from '@/core/liveClass';
import { getSemesterStartDate } from '@/core/semester';
import {
  computeDisplayedEntries,
  EMPTY_DISPLAY_PREFS,
  flattenTimetable,
  formatSlotEnd,
  formatSlotStart,
  matchCustomRows,
} from '@/core/timetable';
import {
  TIMETABLE_META_KEY,
  type RawTimetableJSON,
  type SemesterCalendar,
  type TimetableEntry,
  type TimetableSheetMeta,
} from '@/core/types';
import { resolveWeekPlan, type WeekPlan } from '@/core/weekPlan';
import { loadBundles } from '@/prefs/bundles';
import { getSavedSchedule } from '@/prefs/savedSchedule';
import {
  getWidgetStore,
  type NextClassWidgetSnapshot,
} from '../../modules/widget-store/src/WidgetStoreModule';
import { type ExamPhase } from '@/core/examWindow';
import { toISODate } from '@/core/dates';
import { loadExamPhase } from './examPhase';

/** Local-time epoch for `hh:MM` (minutes past midnight) on an ISO date. */
export function epochFor(dateISO: string, minutes: number): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0).getTime();
}

/** "Sec B · Lab · C-301" — mirrors the in-app card's meta line. */
function metaLine(primary: TimetableEntry): string {
  return `Sec ${primary.section}${primary.type === 'lab' ? ' · Lab' : ''}${
    primary.room && primary.room !== 'TBA' ? ` · ${primary.room}` : ''
  }`;
}

/**
 * Build the widget snapshot. Pure (except updatedAt) — unit-tested in
 * __tests__/core.test.ts. Text lines mirror NextClassCard's copy exactly.
 */
export function buildSnapshot(
  status: ClassStatus | null,
  plan: WeekPlan | null,
  needsTag: boolean,
  now: Date = new Date(),
  chainSource?: WidgetChainSource,
  /**
   * ISO date the occurrence label compares against. Defaults to the plan's
   * own today — pass the REAL today when probing synthetic future times (the
   * resume preview), so a class 3 days out is labelled with its date.
   */
  displayTodayISO?: string
): NextClassWidgetSnapshot {
  const updatedAt = now.getTime();
  if (needsTag) return { state: 'needsTag', updatedAt };

  const primary = status?.classes[0];
  if (!status || !primary) return { state: 'none', updatedAt };

  const extra = status.classes.length - 1;
  const { start, end } = parseTimeRange(primary.time);

  if (status.type === 'ongoing') {
    const out: NextClassWidgetSnapshot = {
      state: 'ongoing',
      course: primary.courseName,
      meta: metaLine(primary),
      targetEpochMs: epochFor(primary.dateISO, end),
      totalMin: Math.max(1, end - start),
      extra,
      sub: `ends ${formatSlotEnd(primary.time)}`,
      subTime: `ends ${formatSlotEnd(primary.time)}`,
      updatedAt,
    };
    if (chainSource) out.followup = buildFollowupChain(chainSource, snapshotEndMs(out), [], displayTodayISO);
    return out;
  }

  // occurrence-date label when the next class isn't on the displayed today
  const occLabel =
    primary.dateISO !== (displayTodayISO ?? plan?.todayISO)
      ? (() => {
          const d = new Date(primary.dateISO + 'T00:00:00');
          const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
          return `${weekday} · ${formatISODateShort(primary.dateISO)}`;
        })()
      : null;

  const out: NextClassWidgetSnapshot = {
    state: 'next',
    course: primary.courseName,
    meta: metaLine(primary),
    targetEpochMs: epochFor(primary.dateISO, start),
    totalMin: Math.max(1, end - start),
    extra,
    sub: occLabel
      ? `${occLabel} · ${formatSlotStart(primary.time)}`
      : `starts ${formatSlotStart(primary.time)}`,
    subTime: `starts ${formatSlotStart(primary.time)}`,
    updatedAt,
  };
  if (chainSource) out.followup = buildFollowupChain(chainSource, snapshotEndMs(out), [], displayTodayISO);
  return out;
}

/** Inputs needed to recompute the class status at arbitrary future times. */
export interface WidgetChainSource {
  entries: TimetableEntry[];
  metaDays: TimetableSheetMeta[] | undefined | null;
  semesterStartISO: string | null;
}

/**
 * Snapshots for the classes that come AFTER the primary one (up to 3),
 * computed by probing the live pipeline at synthetic future times. The
 * Android renderer walks this queue JS-free: when the primary class ends it
 * adopts the first follow-up, and so on — so the widget always shows the
 * real next class instead of a frozen "0m left" / "starting now".
 */
export function buildFollowupChain(
  source: WidgetChainSource | null | undefined,
  afterMs: number,
  chain: NextClassWidgetSnapshot[] = [],
  displayTodayISO?: string
): NextClassWidgetSnapshot[] | undefined {
  if (!source || !source.entries.length || chain.length >= 3) {
    return chain.length ? chain : undefined;
  }
  // probe just past the current class end
  let probe = new Date(afterMs + 61_000);
  let dayHops = 0;
  while (chain.length < 3 && dayHops < 6) {
    const plan = resolveWeekPlan(source.metaDays, {
      semesterStartISO: source.semesterStartISO,
      now: probe,
    });
    const status = computeClassStatus(source.entries, plan, probe);
    const snap = buildSnapshot(status, plan, false, probe, undefined, displayTodayISO);
    if (snap.state === 'next' || snap.state === 'ongoing') {
      chain.push(snap);
      // next probe: just past THIS class's end
      const total = snap.totalMin ?? 0;
      const start =
        snap.state === 'next' ? snap.targetEpochMs ?? probe.getTime()
          : (snap.targetEpochMs ?? probe.getTime()) - total * 60_000;
      probe = new Date(start + total * 60_000 + 61_000);
    } else {
      // nothing left this effective day — hop to the next day, 08:00
      dayHops += 1;
      probe = new Date(probe.getFullYear(), probe.getMonth(), probe.getDate() + 1, 8, 0, 0);
    }
  }
  return chain.length ? chain : undefined;
}

/** Primary class end epoch for a built (ongoing|next) snapshot. */
export function snapshotEndMs(snap: NextClassWidgetSnapshot): number {
  const total = snap.totalMin ?? 0;
  if (snap.state === 'next') return (snap.targetEpochMs ?? 0) + total * 60_000;
  return snap.targetEpochMs ?? 0;
}

/** Inputs the phase-aware builder needs regardless of phase. */
export interface PhaseSnapshotInputs {
  status: ClassStatus | null;
  plan: WeekPlan | null;
  needsTag: boolean;
  now: Date;
  chain: WidgetChainSource;
}

/** First probe instant of a resume-anchor day (08:00 local). */
function anchorProbe(anchorISO: string): Date {
  return new Date(anchorISO + 'T08:00:00');
}

/**
 * Phase-aware snapshot — the SINGLE builder both the Home screen and the
 * background sync use, so widget and app never disagree during exam windows:
 *
 *  - needsTag wins outright (set-up prompt stays reachable);
 *  - exams  → 'examBreak' hold ("Exams ongoing." / "Stay tuned for update")
 *             carrying untilEpochMs + a followup queue pre-rolled from the day
 *             AFTER the window, so the native renderer lifts the hold and lands
 *             on real resume classes by itself — no JS needed at the flip;
 *  - resume → the regular pipeline probed at the anchor day 08:00, with labels
 *             computed against the REAL today (a class 3 days out shows its
 *             weekday+date, as it should);
 *  - classes → the untouched normal path.
 */
export function buildPhaseSnapshot(
  phase: ExamPhase,
  opts: PhaseSnapshotInputs
): NextClassWidgetSnapshot {
  const updatedAt = opts.now.getTime();
  if (opts.needsTag) return { state: 'needsTag', updatedAt };

  if (phase.kind === 'exams') {
    const probe = anchorProbe(phase.anchorISO);
    const out: NextClassWidgetSnapshot = {
      state: 'examBreak',
      course: 'Exams ongoing.',
      sub: 'Stay tuned for update',
      untilEpochMs: phase.untilEpochMs,
      updatedAt,
    };
    const chain = buildFollowupChain(opts.chain, probe.getTime() - 61_000, [], toISODate(opts.now));
    if (chain) out.followup = chain;
    return out;
  }

  if (phase.kind === 'resume') {
    const probe = anchorProbe(phase.anchorISO);
    const plan = resolveWeekPlan(opts.chain.metaDays, {
      semesterStartISO: opts.chain.semesterStartISO,
      now: probe,
    });
    const status = computeClassStatus(opts.chain.entries, plan, probe);
    return buildSnapshot(status, plan, false, probe, opts.chain, toISODate(opts.now));
  }

  return buildSnapshot(opts.status, opts.plan, false, opts.now, opts.chain);
}

/** Avoid re-poking the widget manager when the rendered content is unchanged. */
let lastJson: string | null = null;

/**
 * Push a snapshot to the native widget. Safe everywhere: no-ops in Expo Go,
 * in tests, and on any platform without the native module. Returns whether a
 * native write happened.
 */
export function publishNextClassWidget(snapshot: NextClassWidgetSnapshot): boolean {
  try {
    const json = JSON.stringify(snapshot);
    if (json === lastJson) return false;
    lastJson = json;
    const store = getWidgetStore();
    if (!store) return false;
    return store.setSnapshot(json);
  } catch {
    return false;
  }
}

/**
 * Rebuild the snapshot from persisted state (used by the background sync task,
 * which runs headless — no React, no hooks; AsyncStorage and native modules
 * both work there). Never throws; failures just leave the previous snapshot.
 */
export async function syncNextClassWidgetFromCache(now: Date = new Date()): Promise<void> {
  try {
    const saved = await getSavedSchedule();
    if (!saved) {
      publishNextClassWidget({ state: 'needsTag', updatedAt: now.getTime() });
      return;
    }

    const bundles = await loadBundles();
    const school =
      saved.kind === 'bundle'
        ? bundles.find((b) => b.id === saved.bundleId)?.school ?? null
        : saved.school;
    if (!school) return;

    const [rawEntry, calendarEntry] = await Promise.all([
      cacheGet<RawTimetableJSON>(`data:timetable:${school}`),
      cacheGet<SemesterCalendar>('data:semester'),
    ]);
    const raw = rawEntry?.data;
    if (!raw) return;

    const entries = flattenTimetable(raw);
    let myEntries: TimetableEntry[];
    if (saved.kind === 'bundle') {
      const bundle = bundles.find((b) => b.id === saved.bundleId);
      if (!bundle) return;
      myEntries = matchCustomRows(entries, bundle.rows);
    } else {
      let prefs = EMPTY_DISPLAY_PREFS;
      try {
        const scope = `${saved.school}:${saved.batch}:${saved.dept}:${saved.section}`;
        const rawRaw = await AsyncStorage.getItem(`pref:resultprefs:${scope}`);
        const parsed = rawRaw ? JSON.parse(rawRaw) : null;
        prefs = {
          sectionByCourse: parsed?.sectionByCourse ?? {},
          pickedElectives: parsed?.pickedElectives ?? [],
        };
      } catch {
        prefs = EMPTY_DISPLAY_PREFS;
      }
      myEntries = computeDisplayedEntries(
        entries,
        { batch: saved.batch, department: saved.dept, section: saved.section },
        prefs
      );
    }

    const semesterStartISO = getSemesterStartDate(calendarEntry?.data ?? null);
    const plan = resolveWeekPlan(raw[TIMETABLE_META_KEY]?.days, { semesterStartISO });
    const status = computeClassStatus(myEntries, plan, now);

    // Exam-window gate: holds classes / previews the post-window resume
    // exactly like the Home card (same builder). Fails open to 'classes'.
    const phase = await loadExamPhase(now);
    publishNextClassWidget(
      buildPhaseSnapshot(phase, {
        status,
        plan,
        needsTag: false,
        now,
        chain: {
          entries: myEntries,
          metaDays: raw[TIMETABLE_META_KEY]?.days,
          semesterStartISO,
        },
      })
    );
  } catch {
    // best-effort
  }
}

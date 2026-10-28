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
import { type ExamPhase, type DateRange, filterExamWindowSheets } from '@/core/examWindow';
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
  /** Exam-window date ranges masked out of every plan resolution. */
  exclude?: DateRange[];
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
    // Mask exam-window days: chains must never carry a phantom class dated
    // inside a window (the pre-window evening peek is the classic case).
    const maskedPlan = filterExamWindowSheets(plan, source.exclude) ?? plan;
    const status = computeClassStatus(source.entries, maskedPlan, probe);
    const snap = buildSnapshot(status, maskedPlan, false, probe, undefined, displayTodayISO);
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
  needsTag: boolean;
  now: Date;
  chain: WidgetChainSource;
}

/** First probe instant of a resume-anchor day (08:00 local). */
function anchorProbe(anchorISO: string): Date {
  return new Date(anchorISO + 'T08:00:00');
}

/** What class tracking should show — shared verdict for Home card + widget. */
export interface ClassViewResolution {
  /** Show the exam-hold lines ("Exams ongoing." / "Stay tuned for update"). */
  hold: boolean;
  /** When the hold lifts (exact exam-end instant, or window day-end). */
  untilEpochMs: number | null;
  /** First day after the relevant window (followup/resume probe anchor). */
  anchorISO: string | null;
  /** When !hold: the live (or resume-probed) status; null = nothing at all. */
  status: ClassStatus | null;
  /** Plan matching `status`, label-ready (todayISO is ALWAYS the real today). */
  plan: WeekPlan | null;
}

/**
 * The single authority that decides what the class card/widget displays.
 * Both the Home screen and the widget snapshot builder call this, so the
 * surfaces can never disagree.
 *
 * The EARLY-HOLD rule: outside a window, classes track normally on the masked
 * plan — but the instant nothing teachable remains AND the engine's natural
 * next class lands INSIDE a window, the hold engages right away (e.g. the
 * evening before the first exam day, or the Friday before a Monday window).
 * It then runs the exact same lifecycle as the in-window hold.
 */
export function resolveClassView(
  phase: ExamPhase,
  opts: {
    entries: TimetableEntry[];
    metaDays: TimetableSheetMeta[] | undefined | null;
    semesterStartISO: string | null;
    now: Date;
  }
): ClassViewResolution {
  const now = opts.now;
  const realTodayISO = toISODate(now);

  const probeAt = (anchorISO: string): { status: ClassStatus | null; plan: WeekPlan } => {
    const at08 = anchorProbe(anchorISO);
    const raw = resolveWeekPlan(opts.metaDays, { semesterStartISO: opts.semesterStartISO, now: at08 });
    const masked = filterExamWindowSheets(raw, phase.exclude) ?? raw;
    // Relabel against the REAL today: a class 3 days out must show its date.
    return { status: computeClassStatus(opts.entries, masked, at08), plan: { ...masked, todayISO: realTodayISO } };
  };

  if (phase.kind === 'exams') {
    return { hold: true, untilEpochMs: phase.untilEpochMs, anchorISO: phase.anchorISO, status: null, plan: null };
  }
  if (phase.kind === 'resume') {
    const { status, plan } = probeAt(phase.anchorISO);
    return { hold: false, untilEpochMs: null, anchorISO: phase.anchorISO, status, plan };
  }

  // classes: EARLY HOLD FIRST. The engine's natural (unmasked) next class is
  // the oracle: if it lands INSIDE a window, the hold engages from this very
  // moment — the day-before-evening case, or the Friday before a Monday
  // window. (Check via the RAW plan: the masked plan would just roll past the
  // window and quietly skip the very signal we're looking for.)
  const inRangeISO = (iso: string | undefined): boolean =>
    !!iso && phase.exclude.some((r) => r.startISO <= iso && iso <= r.endISO);

  const rawPlan = resolveWeekPlan(opts.metaDays, { semesterStartISO: opts.semesterStartISO, now });
  const rawNext = computeClassStatus(opts.entries, rawPlan, now)?.classes[0] ?? null;
  if (rawNext && inRangeISO(rawNext.dateISO)) {
    const hit = phase.exclude.find((r) => r.startISO <= rawNext.dateISO && rawNext.dateISO <= r.endISO)!;
    const endDay = new Date(hit.endISO + 'T00:00:00');
    const nextDay = new Date(endDay);
    nextDay.setDate(nextDay.getDate() + 1);
    return {
      hold: true,
      untilEpochMs: phase.upcoming?.untilEpochMs ?? endDay.getTime() + 24 * 60 * 60 * 1000 - 1,
      anchorISO: phase.upcoming?.anchorISO ?? toISODate(nextDay),
      status: null,
      plan: null,
    };
  }

  const maskedPlan = filterExamWindowSheets(rawPlan, phase.exclude) ?? rawPlan;
  const maskedStatus = computeClassStatus(opts.entries, maskedPlan, now);
  const first = maskedStatus?.classes[0] ?? null;
  // never accept a window-dated occurrence that leaked through the roll/fallback
  if (first && !inRangeISO(first.dateISO)) {
    return { hold: false, untilEpochMs: null, anchorISO: null, status: maskedStatus, plan: maskedPlan };
  }
  // Genuinely nothing to show (dead semester gaps etc.).
  return { hold: false, untilEpochMs: null, anchorISO: null, status: null, plan: maskedPlan };
}

/**
 * Phase-aware snapshot — the SINGLE builder both the Home screen and the
 * background sync use, so widget and app never disagree during exam windows.
 * It is a thin shell over resolveClassView():
 *
 *  - needsTag wins outright (set-up prompt stays reachable);
 *  - hold (in-window 'exams' OR early: lookahead pointing into an upcoming
 *    window) → 'examBreak' snapshot ("Exams ongoing." / "Stay tuned for
 *    update") carrying untilEpochMs + a followup queue pre-rolled from the
 *    day AFTER the window, so the native renderer lifts the hold and lands
 *    on real resume classes by itself — no JS needed at the flip;
 *  - resume/live → plain next/ongoing snapshots, labels computed against the
 *    REAL today (a class 3 days out shows its weekday+date, as it should).
 */
export function buildPhaseSnapshot(
  phase: ExamPhase,
  opts: PhaseSnapshotInputs
): NextClassWidgetSnapshot {
  const updatedAt = opts.now.getTime();
  if (opts.needsTag) return { state: 'needsTag', updatedAt };

  // Every followup chain this builder emits masks all exam-window days.
  const chain: WidgetChainSource = { ...opts.chain, exclude: phase.exclude };
  const view = resolveClassView(phase, {
    entries: chain.entries,
    metaDays: chain.metaDays,
    semesterStartISO: chain.semesterStartISO,
    now: opts.now,
  });

  if (view.hold && view.untilEpochMs != null && view.anchorISO) {
    const probe = anchorProbe(view.anchorISO);
    const out: NextClassWidgetSnapshot = {
      state: 'examBreak',
      course: 'Exams ongoing.',
      sub: 'Stay tuned for update',
      untilEpochMs: view.untilEpochMs,
      updatedAt,
    };
    const queue = buildFollowupChain(chain, probe.getTime() - 61_000, [], toISODate(opts.now));
    if (queue) out.followup = queue;
    return out;
  }

  return buildSnapshot(view.status, view.plan, false, opts.now, chain, toISODate(opts.now));
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

    // Exam-window gate: holds classes (in-window AND early pre-window) and
    // previews the post-window resume exactly like the Home card — the same
    // builder, which masks window days before resolving anything. Fails open
    // to 'classes'.
    const phase = await loadExamPhase(now);
    publishNextClassWidget(
      buildPhaseSnapshot(phase, {
        needsTag: false,
        now,
        chain: {
          entries: myEntries,
          metaDays: raw[TIMETABLE_META_KEY]?.days,
          semesterStartISO,
          exclude: phase.exclude,
        },
      })
    );
  } catch {
    // best-effort
  }
}

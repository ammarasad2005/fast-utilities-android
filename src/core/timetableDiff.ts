/**
 * Pure timetable-diff engine (class-change notifications).
 *
 * Compares two snapshots of the user's resolved timetable entries (from two
 * successive `timetable.json` fetches) and produces a small list of semantic
 * changes — cancelled, restored, rescheduled, time-changed, venue-changed,
 * added, removed.
 *
 * Sessions are canonicalized first (course+type+day identity, parsed slot
 * minutes, trimmed rooms) so housekeeping JSON rewrites (reordering,
 * reformatting, whitespace) never surface as false changes. The diff runs
 * three passes:
 *   1. same-day pairing  — flag flips (cancel / restore), slot moves, room moves
 *   2. cross-day pairing — a leftover old session paired with a leftover new
 *      session of the same course becomes a full "rescheduled"
 *   3. leftovers          — plain "added" / "removed"
 *
 * No I/O, no React, no globals — trivially unit-testable.
 */
import type { TimetableEntry } from './types';
import { formatSlotStart, parseTimeRange } from './timetable';

// ─── Canonical session ────────────────────────────────────────────────────────

export interface CanonicalSession {
  /** Identity across sheet rewrites: course + type + day. */
  key: string;
  courseName: string;
  type: 'lecture' | 'lab';
  day: string; // full day name, e.g. "Monday"
  startMin: number;
  endMin: number;
  time: string; // raw slot string, kept for display
  room: string;
  cancelled: boolean;
  rescheduled: boolean;
}

const norm = (s: string | undefined | null): string => (s ?? '').trim().toLowerCase();

export function canonicalize(entries: TimetableEntry[]): CanonicalSession[] {
  const out: CanonicalSession[] = [];
  for (const e of entries) {
    // Reserved rooms are seats set aside for other batches, not the user's
    // classes — comparing them would flood the diff with null diff noise.
    if (e.reserved) continue;
    const [startMin, endMin] = parseTimeRange(e.time ?? '');
    out.push({
      key: `${norm(e.courseName)}|${e.type}|${norm(e.day)}`,
      courseName: (e.courseName ?? '').trim(),
      type: e.type,
      day: (e.day ?? '').trim(),
      startMin,
      endMin,
      time: (e.time ?? '').trim(),
      room: (e.room ?? '').trim(),
      cancelled: e.cancelled === true,
      rescheduled: e.rescheduled === true,
    });
  }
  // Stable order independent of JSON object ordering.
  out.sort((a, b) => a.key === b.key ? a.startMin - b.startMin : a.key < b.key ? -1 : 1);
  return out;
}

// ─── Change model ─────────────────────────────────────────────────────────────

export type ChangeKind =
  | 'cancelled'      // session flagged cancelled
  | 'restored'       // previously-cancelled session is back
  | 'rescheduled'    // session moved across days (or old-cancelled + new-makeup)
  | 'time_changed'   // same day, different slot
  | 'venue'          // same day+slot, different room
  | 'added'          // brand-new session
  | 'removed';       // session gone

export interface ClassChange {
  kind: ChangeKind;
  courseName: string;
  classType: 'lecture' | 'lab';
  /** For single-day events: the day. For reschedules: the FROM day. */
  fromDay: string;
  fromTime: string;
  fromRoom: string;
  /** Rescheduled/time-changed targets (empty otherwise). */
  toDay?: string;
  toTime?: string;
  toRoom?: string;
}

// ─── Diff ─────────────────────────────────────────────────────────────────────

const sameSlot = (a: CanonicalSession, b: CanonicalSession): boolean =>
  a.startMin === b.startMin && a.endMin === b.endMin;

/** Pair two pools greedily: exact slot first, otherwise closest slot pair. */
function pairBySlot(
  olds: CanonicalSession[],
  news: CanonicalSession[],
): { pairs: [CanonicalSession, CanonicalSession][]; oldLeft: CanonicalSession[]; newLeft: CanonicalSession[] } {
  const usedNew = new Set<CanonicalSession>();
  const pairs: [CanonicalSession, CanonicalSession][] = [];
  // Pass 1: exact slot
  for (const o of olds) {
    const n = news.find((c) => !usedNew.has(c) && sameSlot(o, c));
    if (n) { usedNew.add(n); pairs.push([o, n]); }
  }
  // Pass 2: closest remaining slot (min |Δstart|)
  for (const o of olds) {
    if (pairs.some(([p]) => p === o)) continue;
    let best: CanonicalSession | null = null;
    let bestDist = Infinity;
    for (const c of news) {
      if (usedNew.has(c)) continue;
      const d = Math.abs(c.startMin - o.startMin);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    if (best) { usedNew.add(best); pairs.push([o, best]); }
  }
  const oldLeft = olds.filter((o) => !pairs.some(([p]) => p === o));
  const newLeft = news.filter((n) => !usedNew.has(n));
  return { pairs, oldLeft, newLeft };
}

export function diffTimetable(
  oldEntries: TimetableEntry[],
  newEntries: TimetableEntry[],
): ClassChange[] {
  const olds = canonicalize(oldEntries);
  const news = canonicalize(newEntries);

  const groupBy = (list: CanonicalSession[]): Map<string, CanonicalSession[]> => {
    const m = new Map<string, CanonicalSession[]>();
    for (const s of list) {
      const g = m.get(s.key) ?? [];
      g.push(s);
      m.set(s.key, g);
    }
    return m;
  };
  const oldG = groupBy(olds);
  const newG = groupBy(news);

  const changes: ClassChange[] = [];
  let oldLeft: CanonicalSession[] = [];
  let newLeft: CanonicalSession[] = [];

  // ── Pass 1: same-day groups ────────────────────────────────────────────────
  const allKeys = new Set([...oldG.keys(), ...newG.keys()]);
  for (const key of allKeys) {
    const { pairs, oldLeft: ol, newLeft: nl } = pairBySlot(oldG.get(key) ?? [], newG.get(key) ?? []);
    oldLeft = oldLeft.concat(ol);
    newLeft = newLeft.concat(nl);

    for (const [o, n] of pairs) {
      if (o.cancelled && !n.cancelled) {
        // Restored to life (possibly moved — reschedule fold-in handles slot).
        if (sameSlot(o, n)) {
          changes.push({ kind: 'restored', courseName: n.courseName, classType: n.type, fromDay: n.day, fromTime: n.time, fromRoom: n.room });
        } else {
          changes.push({ kind: 'rescheduled', courseName: n.courseName, classType: n.type, fromDay: o.day, fromTime: o.time, fromRoom: o.room, toDay: n.day, toTime: n.time, toRoom: n.room });
        }
        continue;
      }
      if (!o.cancelled && n.cancelled) {
        changes.push({ kind: 'cancelled', courseName: n.courseName, classType: n.type, fromDay: n.day, fromTime: n.time, fromRoom: n.room });
        continue; // slot/room drift on a dead session is noise
      }
      if (n.cancelled && o.cancelled) continue; // stayed cancelled
      if (!sameSlot(o, n)) {
        changes.push({ kind: 'time_changed', courseName: n.courseName, classType: n.type, fromDay: n.day, fromTime: o.time, fromRoom: n.room, toTime: n.time, toRoom: n.room });
        continue; // slot moved; room diff bundled as noise on the move
      }
      if (norm(o.room) !== norm(n.room)) {
        changes.push({ kind: 'venue', courseName: n.courseName, classType: n.type, fromDay: n.day, fromTime: n.time, fromRoom: o.room, toRoom: n.room });
      }
    }
  }

  // ── Pass 2: cross-day reschedules (pair leftovers of the same course) ───────
  const courseKey = (s: CanonicalSession): string => `${norm(s.courseName)}|${s.type}`;
  const usedOldL = new Set<CanonicalSession>();
  const usedNewL = new Set<CanonicalSession>();
  const oldsByCourse = new Map<string, CanonicalSession[]>();
  for (const o of oldLeft) {
    const k = courseKey(o);
    oldsByCourse.set(k, [...(oldsByCourse.get(k) ?? []), o]);
  }
  for (const n of newLeft) {
    const k = courseKey(n);
    const candidates = (oldsByCourse.get(k) ?? []).filter((o) => !usedOldL.has(o));
    if (!candidates.length) continue;
    // Closest-slot pairing; prefer an old session that reads as "moved"
    // (old cancelled, or new marked as a rescheduled makeup, or plain move).
    candidates.sort((a, b) => Math.abs(a.startMin - n.startMin) - Math.abs(b.startMin - n.startMin));
    const o = candidates[0];
    usedOldL.add(o);
    usedNewL.add(n);
    changes.push({
      kind: 'rescheduled',
      courseName: n.courseName,
      classType: n.type,
      fromDay: o.day, fromTime: o.time, fromRoom: o.room,
      toDay: n.day, toTime: n.time, toRoom: n.room,
    });
  }

  // ── Pass 3: leftovers ───────────────────────────────────────────────────────
  for (const o of oldLeft) {
    if (usedOldL.has(o)) continue;
    if (o.cancelled) continue; // cancelled session dropped from the sheet = noise
    changes.push({ kind: 'removed', courseName: o.courseName, classType: o.type, fromDay: o.day, fromTime: o.time, fromRoom: o.room });
  }
  for (const n of newLeft) {
    if (usedNewL.has(n)) continue;
    changes.push({ kind: 'added', courseName: n.courseName, classType: n.type, fromDay: n.day, fromTime: n.time, fromRoom: n.room });
  }

  // ── Merge: sheet-modeled reschedule = "cancel the old row + add a makeup
  //    row elsewhere". Fold each cancel+add pair of the same course into ONE
  //    rescheduled event so the user sees "X moved A → B", not two alerts.
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (c.kind !== 'cancelled') continue;
    const j = changes.findIndex(
      (x) => x.kind === 'added' && norm(x.courseName) === norm(c.courseName) && x.classType === c.classType,
    );
    if (j === -1) continue;
    const a = changes[j];
    changes.splice(j, 1);
    changes[i] = {
      kind: 'rescheduled',
      courseName: c.courseName,
      classType: c.classType,
      fromDay: c.fromDay, fromTime: c.fromTime, fromRoom: c.fromRoom,
      toDay: a.fromDay, toTime: a.fromTime, toRoom: a.fromRoom,
    };
  }

  // Stable presentation order: course → day → slot.
  const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  changes.sort((a, b) =>
    a.courseName.localeCompare(b.courseName) ||
    dayOrder.indexOf(norm(a.fromDay)) - dayOrder.indexOf(norm(b.fromDay)) ||
    parseTimeRange(a.fromTime)[0] - parseTimeRange(b.fromTime)[0]);
  return changes;
}

// ─── Presentation ─────────────────────────────────────────────────────────────

const shortDay = (day: string): string => (day ?? '').trim().slice(0, 3);
const slot = (time: string): string => formatSlotStart(time);
const withRoom = (room: string): string => (room ? ` (${room})` : '');

export function changeTitle(kind: ChangeKind): string {
  switch (kind) {
    case 'cancelled': return 'Class cancelled';
    case 'restored': return 'Class back on';
    case 'rescheduled': return 'Class rescheduled';
    case 'time_changed': return 'Class time changed';
    case 'venue': return 'Venue changed';
    case 'added': return 'New class added';
    case 'removed': return 'Class removed';
  }
}

/** One-line human detail for a single change (body of a notification). */
export function changeLine(c: ClassChange): string {
  const course = c.courseName;
  switch (c.kind) {
    case 'cancelled':
      return `${course} · ${shortDay(c.fromDay)} ${slot(c.fromTime)}${withRoom(c.fromRoom)}`;
    case 'restored':
      return `${course} · ${shortDay(c.fromDay)} ${slot(c.fromTime)}${withRoom(c.fromRoom)}`;
    case 'rescheduled':
      return `${course} · ${shortDay(c.fromDay)} ${slot(c.fromTime)} → ${shortDay(c.toDay ?? '')} ${slot(c.toTime ?? '')}${withRoom(c.toRoom ?? '')}`;
    case 'time_changed':
      return `${course} · ${shortDay(c.fromDay)}: ${slot(c.fromTime)} → ${slot(c.toTime ?? '')}${withRoom(c.toRoom ?? '')}`;
    case 'venue':
      return `${course} · ${shortDay(c.fromDay)} ${slot(c.fromTime)}: ${c.fromRoom || '?'} → ${c.toRoom || '?'}`;
    case 'added':
      return `${course} · ${shortDay(c.fromDay)} ${slot(c.fromTime)}${withRoom(c.fromRoom)}`;
    case 'removed':
      return `${course} · ${shortDay(c.fromDay)} ${slot(c.fromTime)}${withRoom(c.fromRoom)}`;
  }
}

/**
 * Stable identity used to de-dupe notifications across overlapping runs
 * (background task + foreground focus check can race separate JS instances
 * against the same stored baseline).
 */
export function changeKey(c: ClassChange): string {
  return [
    c.kind, norm(c.courseName), c.classType,
    norm(c.fromDay), norm(c.fromTime), norm(c.fromRoom),
    norm(c.toDay ?? ''), norm(c.toTime ?? ''), norm(c.toRoom ?? ''),
  ].join('|');
}

/** Fold multiple changes into one summary notification. */
export function summarize(changes: ClassChange[]): { title: string; body: string } {
  if (changes.length === 1) {
    const c = changes[0];
    return { title: changeTitle(c.kind), body: changeLine(c) };
  }
  const title = `${changes.length} timetable changes`;
  const body = changes
    .map((c) => `${changeTitle(c.kind)} — ${changeLine(c)}`)
    .join('\n');
  return { title, body };
}

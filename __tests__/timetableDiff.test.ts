/**
 * Unit tests for the class-change diff engine (notification source of truth).
 *
 * The engine compares two resolved-entry snapshots extracted from successive
 * timetable.json versions. Noise immunity (reordering, refetch rewrites) and
 * correct per-kind event shapes are what keep alerts trustworthy — a single
 * false "cancelled" alert erodes user trust fast.
 */
import {
  canonicalize,
  changeKey,
  changeLine,
  changeTitle,
  diffTimetable,
  summarize,
} from '@/core/timetableDiff';
import type { TimetableEntry } from '@/core/types';

/** Minimal entry factory — fields beyond identity don't affect the diff. */
function ent(over: Partial<TimetableEntry> & Pick<TimetableEntry, 'courseName' | 'day' | 'time'>): TimetableEntry {
  return {
    batch: '2024',
    department: 'CS',
    section: 'A',
    room: 'CR-01',
    type: 'lecture',
    category: 'regular',
    ...over,
  };
}

const la = (day: string, time: string, over: Partial<TimetableEntry> = {}) =>
  ent({ courseName: 'Linear Algebra (MT-101)', day, time, ...over });
const dp = (day: string, time: string, over: Partial<TimetableEntry> = {}) =>
  ent({ courseName: 'Discrete Structures (CS-102)', day, time, ...over });

// ─── Noise immunity ───────────────────────────────────────────────────────────

describe('noise immunity', () => {
  test('identical lists → no changes', () => {
    const base = [la('Monday', '08:30 - 10:00'), dp('Tuesday', '11:00 - 12:30')];
    expect(diffTimetable(base, base.map((e) => ({ ...e })))).toEqual([]);
  });

  test('reordering + whitespace/object-key noise → no changes', () => {
    const old = [la('Monday', '08:30 - 10:00'), dp('Tuesday', '11:00 - 12:30', { room: 'CR-02' })];
    const next = [
      dp('Tuesday ', ' 11:00 - 12:30  ', { room: '  CR-02 ' }),
      la('Monday', '08:30 - 10:00'),
    ];
    // note: time/room parse ignores surrounding whitespace? room compare trims,
    // day compare trims; slot minutes come from regex parse → immune.
    expect(diffTimetable(old, next)).toEqual([]);
  });

  test('reserved entries ignored (seats set aside for other batches)', () => {
    const old = [la('Monday', '08:30 - 10:00'), ent({ courseName: 'HS for Others', day: 'Monday', time: '10:00 - 11:30', reserved: true })];
    const next = [la('Monday', '08:30 - 10:00')];
    expect(diffTimetable(old, next)).toEqual([]);
  });

  test('both-still-cancelled is not a change', () => {
    const old = [la('Monday', '08:30 - 10:00', { cancelled: true })];
    const next = [la('Monday', '08:30 - 10:00', { cancelled: true })];
    expect(diffTimetable(old, next)).toEqual([]);
  });
});

// ─── Per-kind events ─────────────────────────────────────────────────────────

describe('event kinds', () => {
  test('cancelled flag flip → cancelled', () => {
    const old = [la('Monday', '08:30 - 10:00')];
    const next = [la('Monday', '08:30 - 10:00', { cancelled: true })];
    const out = diffTimetable(old, next);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('cancelled');
    expect(out[0].courseName).toContain('Linear Algebra');
    expect(out[0].fromDay).toBe('Monday');
  });

  test('cancel flag cleared → restored', () => {
    const old = [la('Monday', '08:30 - 10:00', { cancelled: true })];
    const next = [la('Monday', '08:30 - 10:00')];
    const out = diffTimetable(old, next);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('restored');
  });

  test('same day, different slot → time_changed', () => {
    const old = [la('Monday', '08:30 - 10:00')];
    const next = [la('Monday', '11:00 - 12:30')];
    const out = diffTimetable(old, next);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('time_changed');
    expect(out[0].toTime).toBe('11:00 - 12:30');
  });

  test('same day/slot, different room → venue', () => {
    const old = [la('Monday', '08:30 - 10:00', { room: 'C-301' })];
    const next = [la('Monday', '08:30 - 10:00', { room: 'D-415' })];
    const out = diffTimetable(old, next);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('venue');
    expect(out[0].fromRoom).toBe('C-301');
    expect(out[0].toRoom).toBe('D-415');
  });

  test('cross-day move (cancel old + add makeup) → single rescheduled', () => {
    // How FAST sheets actually model a reschedule: old row flagged cancelled,
    // a new row (often flagged rescheduled) appears on another day.
    const old = [la('Monday', '08:30 - 10:00')];
    const next = [
      la('Monday', '08:30 - 10:00', { cancelled: true }),
      la('Wednesday', '09:30 - 11:00', { rescheduled: true }),
    ];
    const out = diffTimetable(old, next);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('rescheduled');
    expect(out[0].fromDay).toBe('Monday');
    expect(out[0].toDay).toBe('Wednesday');
  });

  test('plain cross-day move without flags → rescheduled', () => {
    const old = [la('Monday', '08:30 - 10:00')];
    const next = [la('Thursday', '08:30 - 10:00')];
    const out = diffTimetable(old, next);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('rescheduled');
  });

  test('brand-new session → added', () => {
    const old = [la('Monday', '08:30 - 10:00')];
    const next = [la('Monday', '08:30 - 10:00'), dp('Friday', '13:00 - 14:30')];
    const out = diffTimetable(old, next);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('added');
    expect(out[0].courseName).toContain('Discrete');
  });

  test('gone session → removed', () => {
    const old = [la('Monday', '08:30 - 10:00'), dp('Friday', '13:00 - 14:30')];
    const next = [la('Monday', '08:30 - 10:00')];
    const out = diffTimetable(old, next);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('removed');
  });

  test('lab vs lecture do not cross-pair (different type identity)', () => {
    const old = [la('Monday', '08:30 - 10:00', { type: 'lab' })];
    const next = [la('Monday', '11:00 - 12:30', { type: 'lecture' })];
    const out = diffTimetable(old, next);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.kind).sort()).toEqual(['added', 'removed']);
  });
});

// ─── Composite scenarios ──────────────────────────────────────────────────────

describe('composite batches', () => {
  test('one course cancelled + another venue-changed → two ordered events', () => {
    const old = [
      la('Monday', '08:30 - 10:00'),
      dp('Tuesday', '11:00 - 12:30', { room: 'C-301' }),
    ];
    const next = [
      la('Monday', '08:30 - 10:00', { cancelled: true }),
      dp('Tuesday', '11:00 - 12:30', { room: 'D-415' }),
    ];
    const out = diffTimetable(old, next);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.kind).sort()).toEqual(['cancelled', 'venue']);
  });

  test('signature is stable across identical re-diffs; detector-side dedupe relies on it', () => {
    const old = [la('Monday', '08:30 - 10:00')];
    const next = [la('Monday', '08:30 - 10:00', { cancelled: true })];
    const a = diffTimetable(old, next)[0];
    const b = diffTimetable(old.map((e) => ({ ...e })), next)[0];
    expect(changeKey(a)).toBe(changeKey(b));
    expect(changeKey(a)).toContain('cancelled');
  });
});

// ─── Presentation helpers ─────────────────────────────────────────────────────

describe('presentation', () => {
  test('single change → kind title + one-line body', () => {
    const out = diffTimetable([la('Monday', '08:30 - 10:00')], [la('Monday', '08:30 - 10:00', { cancelled: true })]);
    const s = summarize(out);
    expect(s.title).toBe(changeTitle('cancelled'));
    expect(s.body).toContain('Linear Algebra');
    expect(s.body).toContain('Mon');
    expect(s.body).toContain('08:30 AM');
  });

  test('reschedule line renders from → to', () => {
    const out = diffTimetable([la('Monday', '08:30 - 10:00')], [la('Wednesday', '09:30 - 11:00')]);
    const line = changeLine(out[0]);
    expect(line).toContain('Mon 08:30 AM');
    expect(line).toContain('Wed 09:30 AM');
    expect(line).toContain('→');
  });

  test('multiple changes merge into a counted summary with one line each', () => {
    const old = [la('Monday', '08:30 - 10:00'), dp('Tuesday', '11:00 - 12:30')];
    const next = [la('Monday', '08:30 - 10:00', { cancelled: true }), dp('Tuesday', '11:00 - 12:30', { room: 'D-415' })];
    const s = summarize(diffTimetable(old, next));
    expect(s.title).toBe('2 timetable changes');
    expect(s.body.split('\n')).toHaveLength(2);
    expect(s.body).toContain('Class cancelled');
    expect(s.body).toContain('Venue changed');
  });

  test('canonicalize is order-insensitive', () => {
    const a = canonicalize([la('Monday', '08:30 - 10:00'), la('Monday', '11:00 - 12:30')].map((e) => ({ ...e })));
    const b = canonicalize([la('Monday', '11:00 - 12:30'), la('Monday', '08:30 - 10:00')].map((e) => ({ ...e })));
    expect(a).toEqual(b);
  });
});

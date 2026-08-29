/**
 * Exam + semester widget snapshot builders:
 *  · exam window parsing across schedule formats (en dash, "to", shared AM/PM)
 *  · personal-exam resolution from the SEPARATE exam tag (bundle | default)
 *  · snapshot states (needsTag / hidden / empty / ok) + upcoming-only + cap
 *  · semester milestones (START/END pins, pct) + month-card exam days
 */
import { parseExamTimeRange } from '@/core/exams';
import type { ExamEntry, SemesterCalendar } from '@/core/types';
import type { ExamCustomBundle } from '@/prefs/examBundles';
import type { SavedExams } from '@/prefs/savedExams';
import {
  buildExamWidgetSnapshot,
  examDayEpochSet,
  examWindowEpochMs,
  resolvePersonalExams,
} from '@/widgets/examWidgets';
import { buildSemesterWidgetSnapshot, isoDayEpochMs } from '@/widgets/semesterWidgets';

const ex = (partial: Partial<ExamEntry>): ExamEntry => ({
  date: '12/01/2026',
  day: 'Monday',
  time: '09:00 AM – 11:00 AM',
  courseCode: 'CS2001',
  courseName: 'Database Systems',
  batch: '2023',
  department: 'CS',
  school: 'FSC',
  ...partial,
});

describe('parseExamTimeRange', () => {
  it('parses the canonical en-dash window', () => {
    expect(parseExamTimeRange('09:00 AM – 11:00 AM')).toEqual({ start: 540, end: 660 });
  });
  it('parses "H:MM to H:MM PM" with shared meridiem', () => {
    expect(parseExamTimeRange('2:00 to 5:00 PM')).toEqual({ start: 840, end: 1020 });
    expect(parseExamTimeRange('9:00 to 12:00 PM')).toEqual({ start: 540, end: 720 });
  });
  it('parses hyphen ranges with explicit meridiems', () => {
    expect(parseExamTimeRange('10:00 AM - 01:00 PM')).toEqual({ start: 600, end: 780 });
  });
  it('adds 12h when the end bound omits PM', () => {
    // "9:30 to 11:30" — no meridiems at all; end must not wrap backwards
    const { start, end } = parseExamTimeRange('9:00 to 1:00');
    expect(start).toBe(540);
    expect(end).toBe(780); // 13:00
  });
  it('rejects junk', () => {
    expect(parseExamTimeRange('')).toEqual({ start: 0, end: 0 });
    expect(parseExamTimeRange('09:00 AM')).toEqual({ start: 0, end: 0 });
  });
});

describe('examWindowEpochMs', () => {
  it('combines DD/MM/YYYY with the window into local epochs', () => {
    const win = examWindowEpochMs(ex({}))!;
    expect(win.start).toBe(new Date(2026, 0, 12, 9, 0).getTime());
    expect(win.end).toBe(new Date(2026, 0, 12, 11, 0).getTime());
  });
});

describe('resolvePersonalExams', () => {
  const data = [
    ex({}),
    ex({ courseCode: 'EE1001', courseName: 'Circuits', department: 'EE', school: 'FSE' }),
  ];
  const bundles: ExamCustomBundle[] = [
    { id: 'b1', name: 'My exam schedule', school: 'FSC', rows: [{ id: 'r', batch: '2023', dept: 'CS', selection: 'Database Systems | CS2001' }] },
  ];

  it('default pref filters by school+batch+dept', () => {
    const got = resolvePersonalExams(data, { kind: 'default', school: 'FSE', batch: '2023', dept: 'EE' }, bundles);
    expect(got.map((e) => e.courseCode)).toEqual(['EE1001']);
  });
  it('bundle pref matches via the bundle rows', () => {
    const got = resolvePersonalExams(data, { kind: 'bundle', bundleId: 'b1' }, bundles);
    expect(got.map((e) => e.courseCode)).toEqual(['CS2001']);
  });
  it('dangling bundle ref → empty (never leaks other exams)', () => {
    expect(resolvePersonalExams(data, { kind: 'bundle', bundleId: 'nope' }, bundles)).toEqual([]);
  });
});

describe('buildExamWidgetSnapshot', () => {
  const now = new Date(2026, 0, 10, 12, 0); // Jan 10, noon
  const pref: SavedExams = { kind: 'default', school: 'FSC', batch: '2023', dept: 'CS' };

  it('needsTag when there is no exam preference', () => {
    expect(buildExamWidgetSnapshot([], null, [], { visible: true, now }).state).toBe('needsTag');
  });
  it('hidden mirrors the admin visibility gate', () => {
    expect(buildExamWidgetSnapshot([ex({})], pref, [], { visible: false, now }).state).toBe('hidden');
  });
  it('empty when everything is in the past', () => {
    const past = [ex({ date: '01/01/2026' })];
    expect(buildExamWidgetSnapshot(past, pref, [], { visible: true, now }).state).toBe('empty');
  });
  it('ok: upcoming only, chronological, labels and epochs', () => {
    const data = [
      ex({ courseName: 'Later Course', date: '20/01/2026' }),
      ex({}), // Jan 12
      ex({ courseName: 'Past Course', date: '01/01/2026' }),
    ];
    const snap = buildExamWidgetSnapshot(data, pref, [], { visible: true, now });
    expect(snap.state).toBe('ok');
    expect(snap.items!.map((i) => i.course)).toEqual(['Database Systems', 'Later Course']);
    expect(snap.items![0].dateLabel).toBe(
      `${new Date(2026, 0, 12).toLocaleDateString('en-US', { weekday: 'short' })} 12 Jan`
    );
    expect(snap.items![0].startEpochMs).toBe(new Date(2026, 0, 12, 9, 0).getTime());
  });
  it('an ongoing exam (now inside its window) is kept', () => {
    const ongoing = ex({ time: '10:00 AM – 01:00 PM' }); // noon is inside
    const snap = buildExamWidgetSnapshot([ongoing], pref, [], { visible: true, now: new Date(2026, 0, 12, 12, 0) });
    expect(snap.state).toBe('ok');
    expect(snap.items!).toHaveLength(1);
  });
  it('caps the list at 8 items', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      ex({ courseName: `Course ${i}`, date: `${String(12 + i).padStart(2, '0')}/01/2026` })
    );
    const snap = buildExamWidgetSnapshot(many, pref, [], { visible: true, now });
    expect(snap.items).toHaveLength(8);
  });
});

describe('examDayEpochSet (month dots)', () => {
  it('day-aligns, dedupes and sorts; empty without a tag', () => {
    const data = [ex({}), ex({ courseName: 'Same Day', date: '12/01/2026' }), ex({ courseName: 'Other', date: '14/01/2026' })];
    const pref: SavedExams = { kind: 'default', school: 'FSC', batch: '2023', dept: 'CS' };
    expect(examDayEpochSet(data, null, [])).toEqual([]);
    const days = examDayEpochSet(data, pref, []);
    expect(days).toEqual([new Date(2026, 0, 12).getTime(), new Date(2026, 0, 14).getTime()]);
  });
});

describe('buildSemesterWidgetSnapshot', () => {
  const cal: SemesterCalendar = {
    semester: 'Spring 2026',
    keyDates: [
      { label: 'First Day of Classes', date: '2026-01-05', type: 'academic' },
      { label: 'First Sessional Examinations', date: '2026-02-16', type: 'exam' },
      { label: 'Second Sessional Examinations', date: '2026-03-23', type: 'exam' },
      { label: 'Last Day of Classes', date: '2026-04-24', type: 'academic' },
      { label: 'Final Examinations', date: '2026-05-04', endDate: '2026-05-15', type: 'exam' },
    ],
  };
  const now = new Date(2026, 0, 10);

  it('empty when the calendar is missing', () => {
    expect(buildSemesterWidgetSnapshot(null, [], null, [], now).state).toBe('empty');
  });

  it('ships START/END pins around S1/S2/FE with the finals-end span', () => {
    const snap = buildSemesterWidgetSnapshot(cal, [], null, [], now);
    expect(snap.state).toBe('ok');
    expect(snap.name).toBe('Spring 2026');
    expect(snap.startEpochMs).toBe(isoDayEpochMs('2026-01-05'));
    expect(snap.endEpochMs).toBe(isoDayEpochMs('2026-05-15')); // finals end wins
    const shorts = snap.milestones.map((m) => m.shortLabel);
    expect(shorts[0]).toBe('START');
    expect(shorts[shorts.length - 1]).toBe('END');
    expect(shorts).toEqual(['START', 'S1', 'S2', 'FE', 'END']);
    expect(snap.milestones[0].pct).toBe(0);
    expect(snap.milestones[shorts.length - 1].pct).toBe(100);
    const s1 = snap.milestones.find((m) => m.shortLabel === 'S1')!;
    expect(s1.epochMs).toBe(isoDayEpochMs('2026-02-16'));
    expect(s1.pct).toBeGreaterThan(0);
    expect(s1.pct).toBeLessThan(100);
    expect(snap.examDays).toEqual([]); // untagged → no dots
  });

  it('carries personal exam days when tagged', () => {
    const pref: SavedExams = { kind: 'default', school: 'FSC', batch: '2023', dept: 'CS' };
    const snap = buildSemesterWidgetSnapshot(cal, [ex({})], pref, [], now);
    expect(snap.examDays).toEqual([new Date(2026, 0, 12).getTime()]);
  });
});

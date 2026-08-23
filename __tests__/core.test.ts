/**
 * Unit tests for the ported business logic.
 *
 * These functions are pure TypeScript ports of the FAST Exam Table web app's
 * src/lib modules, so the mobile client reproduces identical data semantics.
 */

import { flattenTimetable, filterTimetable, formatTime, formatTimeRange, getAvailableSections, extractTimeFromCourseName, detectConflicts, makeKey } from '@/core/timetable';
import { filterExams, filterSummerExams, matchesSummerCourse, groupByDay, sortByChronological } from '@/core/exams';
import { buildRoomCalendar, getAvailableRooms, STANDARD_SLOTS, groupRoomsByBlock, mergeRoomCalendars } from '@/core/roomLogic';
import { flattenFaculty, searchFaculty, getFacultyRank } from '@/core/faculty';
import { getCalendarCells, parseEventDate } from '@/core/events';
import { resolveWeekPlan, attachEntries, getEffectiveTodayDate, isTomorrowPreview } from '@/core/weekPlan';
import { getSemesterProgress, getSemesterMilestones, getSemesterStartDate, getSemesterEndDate, getFinalExamsEndDate, getSemesterWeekNumber } from '@/core/semester';
import type { RawTimetableJSON, ExamEntry, RawFacultyDepartment, TimetableEntry, SemesterCalendar } from '@/core/types';

// ─── Timetable ────────────────────────────────────────────────────────────────

const rawTimetable: RawTimetableJSON = {
  '2024': {
    CS: {
      regular: {
        'Database Systems': {
          A: {
            Monday: [{ room: 'CR-01', time: '08:30 - 10:00' }],
          },
          A1: {
            Monday: [{ room: 'CR-02', time: '08:30 - 10:00' }],
          },
        },
        'OS Lab': {
          B: {
            Tuesday: [{ room: 'LAB-1', time: '14:00 - 15:30' }],
          },
        },
      },
      repeat: {
        'Repeated Course': {
          A: {
            Wednesday: [{ room: 'CR-05', time: '10:00 - 11:30' }],
          },
        },
      },
    },
  },
  System: {
    CS: { regular: {}, repeat: {} },
  },
  __meta__: { days: [] },
} as unknown as RawTimetableJSON;

describe('flattenTimetable', () => {
  it('flattens nested structure and skips System/meta batches', () => {
    const entries = flattenTimetable(rawTimetable);
    expect(entries.length).toBe(4); // 3 regular + 1 repeat (System batch contributes 0)
    expect(entries.every((e) => e.batch === '2024')).toBe(true);
  });

  it('infers lab type from course name', () => {
    const entries = flattenTimetable(rawTimetable);
    const lab = entries.find((e) => e.courseName === 'OS Lab');
    expect(lab?.type).toBe('lab');
  });
});

describe('filterTimetable', () => {
  const entries = flattenTimetable(rawTimetable);

  it('filters by batch/dept/section and excludes repeats by default', () => {
    const out = filterTimetable(entries, { batch: '2024', department: 'CS', section: 'A', query: '' });
    expect(out.every((e) => e.category === 'regular')).toBe(true);
    expect(out.every((e) => e.section.startsWith('A'))).toBe(true);
  });

  it('normalises A1 to section A', () => {
    const out = filterTimetable(entries, { batch: '2024', department: 'CS', section: 'A', query: '' });
    const sections = out.map((e) => e.section).sort();
    expect(sections).toEqual(['A', 'A1']);
  });

  it('can include repeats when requested', () => {
    const out = filterTimetable(entries, { batch: '2024', department: 'CS', section: 'A', query: '', includeRepeats: true });
    expect(out.some((e) => e.category === 'repeat')).toBe(true);
  });
});

describe('getAvailableSections', () => {
  it('returns non-elective sections sorted by length then alpha', () => {
    const entries = flattenTimetable(rawTimetable);
    const sections = getAvailableSections(entries, '2024', 'CS');
    expect(sections).toContain('A');
    expect(sections).toContain('B');
  });
});

describe('time formatting', () => {
  it('applies the FAST PM heuristic (hours 1–7 are PM) and zero-pads hours', () => {
    expect(formatTime('08:30')).toBe('08:30 AM');
    expect(formatTime('14:00')).toBe('02:00 PM');
    expect(formatTime('01:00')).toBe('01:00 PM');
  });

  it('formats a range with zero-padded hours', () => {
    expect(formatTimeRange('08:30 - 10:00')).toBe('08:30 AM – 10:00 AM');
  });

  it('extracts time embedded in a course name', () => {
    const { cleanName, time } = extractTimeFromCourseName('DB (08:30-10:00)');
    expect(cleanName).toBe('DB');
    expect(time).toBe('08:30-10:00');
  });
});

describe('detectConflicts', () => {
  it('detects overlapping classes in the same section', () => {
    const entries = flattenTimetable(rawTimetable);
    // CR-01 (DB, sec A) and CR-02 (DB, sec A1) both run Monday 08:30-10:00,
    // same normalized section "A" → conflict.
    const conflicts = detectConflicts(entries);
    expect(conflicts.size).toBeGreaterThan(0);
  });

  it('returns an empty set when nothing overlaps', () => {
    const noConflict: TimetableEntry[] = [
      { courseName: 'A', batch: '2024', department: 'CS', section: 'A', day: 'Monday', time: '08:30 - 10:00', room: 'CR-01', type: 'lecture', category: 'regular' },
      { courseName: 'B', batch: '2024', department: 'CS', section: 'A', day: 'Monday', time: '10:00 - 11:20', room: 'CR-02', type: 'lecture', category: 'regular' },
    ];
    expect(detectConflicts(noConflict).size).toBe(0);
  });

  it('makeKey format matches day|time|course|section', () => {
    const e: TimetableEntry = { courseName: 'DB', batch: '2024', department: 'CS', section: 'A', day: 'Monday', time: '08:30 - 10:00', room: 'CR-01', type: 'lecture', category: 'regular' };
    expect(makeKey(e)).toBe('Monday|08:30 - 10:00|DB|A');
  });
});

// ─── Exams ────────────────────────────────────────────────────────────────────

const exams: ExamEntry[] = [
  { date: '18/05/2026', day: 'Monday', time: '9:00 to 12:00 PM', courseCode: 'CS2005', courseName: 'Database Systems', batch: '2024', department: 'CS', school: 'FSC' },
  { date: '19/05/2026', day: 'Tuesday', time: '9:00 to 12:00 PM', courseCode: 'CS2001', courseName: 'Operating Systems', batch: '2024', department: 'CS', school: 'FSC' },
  { date: '18/05/2026', day: 'Monday', time: '2:00 to 5:00 PM', courseCode: 'CS2005', courseName: 'Database Systems', batch: '2024', department: 'AI', school: 'FSC' },
  { date: '20/05/2026', day: 'Wednesday', time: '9:00 to 12:00 PM', courseCode: 'AF1001', courseName: 'Financial Accounting', batch: '2024', department: 'AF', school: 'FSM' },
];

describe('filterExams', () => {
  it('filters by batch + school + dept', () => {
    const out = filterExams(exams, { batch: '2024', school: 'FSC', department: 'CS', query: '' });
    expect(out.length).toBe(2);
    expect(out.every((e) => e.department === 'CS' && e.school === 'FSC')).toBe(true);
  });

  it('filters by free-text query', () => {
    const out = filterExams(exams, { batch: '2024', school: 'FSC', department: 'CS', query: 'operating' });
    expect(out.length).toBe(1);
    expect(out[0].courseName).toBe('Operating Systems');
  });
});

describe('sortByChronological', () => {
  it('sorts by date then time', () => {
    const out = sortByChronological(exams);
    expect(out[0].courseName).toBe('Database Systems');
    expect(out[out.length - 1].courseCode).toBe('AF1001');
  });
});

describe('groupByDay', () => {
  it('groups by date and formats a MON DD MMM header', () => {
    const grouped = groupByDay(filterExams(exams, { batch: '2024', school: 'FSC', department: 'CS', query: '' }));
    expect(grouped.length).toBe(2);
    expect(grouped[0].label).toBe('MON 18 MAY');
  });
});

describe('summer course matching', () => {
  it('resolves known aliases', () => {
    expect(matchesSummerCourse('oop', 'Object Oriented Programming')).toBe(true);
    expect(matchesSummerCourse('pf', 'Programming Fundamentals')).toBe(true);
    expect(matchesSummerCourse('calculus', 'Calculus and Analytical Geometry')).toBe(true);
  });

  it('disambiguates Calculus vs Multivariable Calculus', () => {
    expect(matchesSummerCourse('calculus', 'Multivariable Calculus')).toBe(false);
    expect(matchesSummerCourse('mv calculus', 'Multivariable Calculus')).toBe(true);
  });

  it('matches acronyms', () => {
    expect(matchesSummerCourse('DLD', 'Digital Logic Design')).toBe(true);
  });

  it('does not leak Lab variants via substring', () => {
    expect(matchesSummerCourse('oop', 'Object Oriented Programming Lab')).toBe(false);
  });

  it('filters summer exams by selected courses', () => {
    const out = filterSummerExams(exams, { query: '', selectedCourses: ['oop'] });
    expect(out.length).toBe(0);
    const withOop = filterSummerExams(
      [{ ...exams[0], courseName: 'Object Oriented Programming' }],
      { query: '', selectedCourses: ['oop'] }
    );
    expect(withOop.length).toBe(1);
  });
});

// ─── Free rooms ───────────────────────────────────────────────────────────────

describe('room logic', () => {
  it('builds a room calendar and reports vacancy', () => {
    const calendar = buildRoomCalendar(rawTimetable);
    expect(Object.keys(calendar).sort()).toEqual(['CR-01', 'CR-02', 'CR-05', 'LAB-1']);

    const free = getAvailableRooms(calendar, 'Monday', '10:00-11:20');
    expect(free.fullyVacant).toContain('LAB-1');

    const busy = getAvailableRooms(calendar, 'Monday', '08:30-09:50');
    expect(busy.fullyVacant).not.toContain('CR-01');
  });

  it('has 6 standard slots', () => {
    expect(STANDARD_SLOTS.length).toBe(6);
  });

  it('groups rooms by block', () => {
    const groups = groupRoomsByBlock(['A-101', 'A-102', 'B-201', 'CR-01', 'LAB-1']);
    expect(groups['Block A']).toEqual(['A-101', 'A-102']);
    expect(groups['Block B']).toEqual(['B-201']);
    expect(groups['Labs & Other']).toContain('CR-01');
    expect(groups['Labs & Other']).toContain('LAB-1');
  });
});

// ─── Faculty ──────────────────────────────────────────────────────────────────

const rawFaculty: RawFacultyDepartment[] = [
  {
    department: 'Department of Computer Science',
    faculty: [
      { name: 'Dr. A', status: 'HoD (CS) & Professor', email: 'a@nu.edu.pk', office_room: 'A-101', linkedin_profile: null, profile_url: '', image_url: '' },
      { name: 'Ms. B', status: 'Lecturer', email: 'b@nu.edu.pk', office_room: null, linkedin_profile: null, profile_url: '', image_url: '' },
      { name: 'Dr. C', status: 'Associate Professor', email: 'c@nu.edu.pk', office_room: 'A-102', linkedin_profile: null, profile_url: '', image_url: '' },
    ],
  },
];

describe('faculty', () => {
  it('sorts by rank (HoD before Associate before Lecturer)', () => {
    const flat = flattenFaculty(rawFaculty);
    expect(flat.map((f) => f.name)).toEqual(['Dr. A', 'Dr. C', 'Ms. B']);
  });

  it('ranks HoD above lecturer', () => {
    expect(getFacultyRank('HoD (CS) & Professor')).toBe(2);
    expect(getFacultyRank('Lecturer')).toBe(6);
  });

  it('searches by name/email/office', () => {
    const flat = flattenFaculty(rawFaculty);
    expect(searchFaculty(flat, 'a@nu').length).toBe(1);
    expect(searchFaculty(flat, 'A-10').length).toBe(2);
  });
});

// ─── Events ───────────────────────────────────────────────────────────────────

describe('events calendar', () => {
  it('parses an event date and infers the year', () => {
    const ref = new Date(2026, 7, 15); // Aug 2026
    const parsed = parseEventDate('August 21', ref);
    expect(parsed).toEqual({ day: 21, month: 7, year: 2026 });
  });

  it('builds a full 7-column grid', () => {
    const cells = getCalendarCells(7, 2026); // August 2026
    expect(cells.length % 7).toBe(0);
    expect(cells.length).toBeGreaterThanOrEqual(28);
    expect(cells.some((c) => c.inCurrentMonth)).toBe(true);
  });
});

// ─── Semester timeline ────────────────────────────────────────────────────────

const semesterCal: SemesterCalendar = {
  semester: 'Fall 2026',
  keyDates: [
    { label: 'First Day of Classes', date: '2026-08-17', type: 'academic' },
    { label: 'First Sessional Examination', date: '2026-09-19', type: 'exam' },
    { label: 'Second Sessional Examination', date: '2026-10-29', type: 'exam' },
    { label: 'Last Day of Classes', date: '2026-12-04', type: 'academic' },
    { label: 'Final Examinations', date: '2026-12-14', endDate: '2027-01-08', type: 'exam' },
  ],
  holidays: [
    { label: 'Independence Day', date: '2026-08-14', type: 'national' },
    { label: 'Eid Milad Nabi', date: '2026-08-26', type: 'religious' },
  ],
};

describe('semester timeline', () => {
  it('finds start and end dates', () => {
    expect(getSemesterStartDate(semesterCal)).toBe('2026-08-17');
    expect(getSemesterEndDate(semesterCal)).toBe('2026-12-04');
    expect(getFinalExamsEndDate(semesterCal)).toBe('2027-01-08');
  });

  it('computes week number', () => {
    const week = getSemesterWeekNumber(semesterCal, new Date('2026-08-24T12:00:00'));
    expect(week).toBe(2);
  });

  it('computes progress between 0 and 100 mid-semester', () => {
    const progress = getSemesterProgress(semesterCal, new Date('2026-10-01T12:00:00'));
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(100);
  });

  it('returns S1/S2/FE milestones positioned within 0-100', () => {
    const milestones = getSemesterMilestones(semesterCal);
    expect(milestones.map((m) => m.shortLabel)).toEqual(['S1', 'S2', 'FE']);
    for (const m of milestones) {
      expect(m.progressPercent).toBeGreaterThanOrEqual(0);
      expect(m.progressPercent).toBeLessThanOrEqual(100);
    }
  });
});

// ─── Room calendar merge ──────────────────────────────────────────────────────

describe('mergeRoomCalendars', () => {
  it('merges two calendars without losing rooms or slots', () => {
    const a = buildRoomCalendar(rawTimetable); // CR-01, CR-02, CR-05, LAB-1
    const b: ReturnType<typeof buildRoomCalendar> = {
      'CR-01': { Monday: [{ start: 600, end: 680 }] },
      'B-201': { Monday: [{ start: 600, end: 680 }] },
    };
    const merged = mergeRoomCalendars(a, b);
    expect(Object.keys(merged).sort()).toEqual(['B-201', 'CR-01', 'CR-02', 'CR-05', 'LAB-1'].sort());
    expect(merged['CR-01'].Monday.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Week plan (today/tomorrow + rolling dates, web parity) ──────────────────

const metaWeek1 = [
  { day: 'Monday', sheetName: 'Monday', date: '', isoDate: '2026-08-17', isMakeup: false },
  { day: 'Tuesday', sheetName: 'Tuesday', date: '', isoDate: '2026-08-18', isMakeup: false },
  { day: 'Wednesday', sheetName: 'Wednesday', date: '', isoDate: '2026-08-19', isMakeup: false },
  { day: 'Thursday', sheetName: 'Thursday', date: '', isoDate: '2026-08-20', isMakeup: false },
  { day: 'Friday', sheetName: 'Friday', date: '', isoDate: '2026-08-21', isMakeup: false },
  { day: 'Saturday', sheetName: 'Saturday', date: '', isoDate: '2026-08-22', isMakeup: false },
];

const at = (iso: string) => new Date(iso);

describe('weekPlan: effective today & tomorrow preview', () => {
  test('before 5:30 PM the effective day is today', () => {
    expect(getEffectiveTodayDate(at('2026-08-19T17:29:00')).toISOString?.() || '').toContain?.('');
    const eff = getEffectiveTodayDate(at('2026-08-19T17:29:00'));
    expect(eff.getDate()).toBe(19);
    expect(isTomorrowPreview(at('2026-08-19T17:29:00'))).toBe(false);
  });
  test('at/after 5:30 PM the effective day rolls to tomorrow', () => {
    const eff = getEffectiveTodayDate(at('2026-08-19T17:30:00'));
    expect(eff.getDate()).toBe(20);
    expect(isTomorrowPreview(at('2026-08-19T17:30:00'))).toBe(true);
  });
});

describe('weekPlan: rolling dates (web re-dates onto the effective week)', () => {
  test('Wednesday mid-week: dates land on current week, Wednesday pinned first', () => {
    const plan = resolveWeekPlan(metaWeek1, { semesterStartISO: '2026-08-17', now: at('2026-08-19T10:00:00') });
    expect(plan.sheets[0].day).toBe('Wednesday');
    expect(plan.sheets[0].isToday).toBe(true);
    expect(plan.sheets[0].isoDate).toBe('2026-08-19');
    expect(plan.tomorrowPreview).toBe(false);
    expect(plan.sheets.map((s) => s.isoDate)).toEqual([
      '2026-08-19', // today first
      '2026-08-17', '2026-08-18', '2026-08-20', '2026-08-21', '2026-08-22',
    ]);
    expect(plan.sheets.map((s) => s.dateStr)).toEqual([
      '19 Aug', '17 Aug', '18 Aug', '20 Aug', '21 Aug', '22 Aug',
    ]);
  });

  test('Sunday morning: previous week shown, no today badge (matches web)', () => {
    const plan = resolveWeekPlan(metaWeek1, { semesterStartISO: '2026-08-17', now: at('2026-08-23T09:00:00') });
    expect(plan.sheets.every((s) => !s.isToday)).toBe(true);
    expect(plan.sheets[0].day).toBe('Monday');
    expect(plan.sheets[0].isoDate).toBe('2026-08-17');
    expect(plan.sheets[5].isoDate).toBe('2026-08-22');
  });

  test('Sunday evening: whole grid rolls to next week, Monday pinned as tomorrow-preview', () => {
    const plan = resolveWeekPlan(metaWeek1, { semesterStartISO: '2026-08-17', now: at('2026-08-23T18:00:00') });
    expect(plan.tomorrowPreview).toBe(true);
    expect(plan.sheets[0].day).toBe('Monday');
    expect(plan.sheets[0].isToday).toBe(true);
    expect(plan.sheets[0].isoDate).toBe('2026-08-24');
    expect(plan.sheets[5].isoDate).toBe('2026-08-29');
  });

  test('Friday evening: Saturday becomes the pinned day (tomorrow preview)', () => {
    const plan = resolveWeekPlan(metaWeek1, { semesterStartISO: '2026-08-17', now: at('2026-08-21T18:00:00') });
    expect(plan.sheets[0].day).toBe('Saturday');
    expect(plan.sheets[0].isToday).toBe(true);
    expect(plan.sheets[0].isoDate).toBe('2026-08-22');
  });
});

describe('weekPlan: semester-start handling', () => {
  test('before the semester starts, highlight is suppressed and the week clamps to the start week', () => {
    const plan = resolveWeekPlan(metaWeek1, { semesterStartISO: '2026-08-24', now: at('2026-08-19T10:00:00') });
    expect(plan.beforeSemesterStart).toBe(true);
    expect(plan.sheets.every((s) => !s.isToday)).toBe(true);
    // reference Monday clamped to the semester start week (week of the 24th)
    expect(plan.sheets[0].isoDate).toBe('2026-08-24');
    expect(plan.sheets[5].isoDate).toBe('2026-08-29');
  });
});

describe('weekPlan: makeup (dated) sheets', () => {
  test('current-week makeup displaces the regular day to next week', () => {
    const meta = [
      { day: 'Monday', sheetName: 'Monday (August 18)', date: '', isoDate: '2026-08-18', isMakeup: true },
      ...metaWeek1,
    ];
    const plan = resolveWeekPlan(meta, { semesterStartISO: '2026-08-17', now: at('2026-08-17T10:00:00') });
    const makeup = plan.sheets.find((s) => s.isMakeup);
    expect(makeup?.isoDate).toBe('2026-08-18');
    expect(makeup?.dateStr).toBe('18 Aug');
    const regularMonday = plan.sheets.find((s) => !s.isMakeup && s.day === 'Monday');
    expect(regularMonday?.isoDate).toBe('2026-08-24'); // pushed to next week
  });

  test('makeup beyond the current week goes to the upcoming list', () => {
    const meta = [
      ...metaWeek1,
      { day: 'Wednesday', sheetName: 'Wednesday (August 27)', date: '', isoDate: '2026-08-27', isMakeup: true },
    ];
    const plan = resolveWeekPlan(meta, { semesterStartISO: '2026-08-17', now: at('2026-08-19T10:00:00') });
    expect(plan.sheets.some((s) => s.isMakeup)).toBe(false);
    expect(plan.upcomingMakeupDays[0]?.isoDate).toBe('2026-08-27');
    // regular Wednesday stays in place and is today
    const wed = plan.sheets.find((s) => s.day === 'Wednesday');
    expect(wed?.isoDate).toBe('2026-08-19');
    expect(wed?.isToday).toBe(true);
  });

  test('stale or far-future makeup sheets are dropped', () => {
    const meta = [
      ...metaWeek1,
      { day: 'Thursday', sheetName: 'Thursday (July 30)', date: '', isoDate: '2026-07-30', isMakeup: true },
      { day: 'Friday', sheetName: 'Friday (October 30)', date: '', isoDate: '2026-10-30', isMakeup: true },
    ];
    const plan = resolveWeekPlan(meta, { semesterStartISO: '2026-08-17', now: at('2026-08-19T10:00:00') });
    expect(plan.sheets.every((s) => !s.isMakeup)).toBe(true);
    expect(plan.upcomingMakeupDays).toHaveLength(0);
  });
});

describe('weekPlan: attachEntries filtering', () => {
  test('today is kept even with no classes; empty other days are dropped', () => {
    const plan = resolveWeekPlan(metaWeek1, { semesterStartISO: '2026-08-17', now: at('2026-08-19T10:00:00') });
    const entries = new Map<string, string[]>([
      ['Monday', ['CS101']],
      ['Friday', ['CS102', 'CS103']],
      ['Saturday', []],
    ]);
    const items = attachEntries(plan, entries);
    expect(items[0].day).toBe('Wednesday');
    expect(items[0].isToday).toBe(true);
    expect(items[0].entries).toEqual([]); // empty today survives → "No classes scheduled"
    const days = items.map((i) => i.day);
    expect(days).toContain('Monday');
    expect(days).toContain('Friday');
    expect(days).not.toContain('Tuesday');  // no entries → dropped
    expect(days).not.toContain('Saturday'); // empty array → dropped
  });
});

// ─── Scenario flags (cancelled / rescheduled / exam / elective passthrough) ──

describe('scenario flags: web parity (identification layer)', () => {
  const withFlags: RawTimetableJSON = {
    '2024': {
      CS: {
        repeat: {},
        regular: {
          DB: {
            A: {
              Monday: [
                { room: 'ReSch D-414', time: '02:30-03:50', rescheduled: true, exam: false },
              ],
              Friday: [],
            },
            B: { Monday: [], Friday: [] },
          },
          'OS Lab': {
            A: {
              Monday: [],
              Friday: [
                { room: 'Margala 4 (C-212', time: '08:30-11:15', rescheduled: false, exam: false, cancelled: true },
              ],
            },
          },
        },
      },
    },
  };

  test('flatten carries rescheduled verbatim (incl. location-shift room text)', () => {
    const entries = flattenTimetable(withFlags);
    const db = entries.find((e) => e.courseName === 'DB');
    expect(db?.rescheduled).toBe(true);
    expect(db?.room).toBe('ReSch D-414'); // shift marker stays visible, like the web
    expect(db?.cancelled).toBe(false); // missing flag defaults to false — web does the same
  });

  test('flatten carries cancelled verbatim', () => {
    const entries = flattenTimetable(withFlags);
    const osLab = entries.find((e) => e.courseName === 'OS Lab');
    expect(osLab?.cancelled).toBe(true);
    expect(osLab?.rescheduled).toBe(false);
  });

  test('rescheduled and cancelled slots are exempt from conflict tagging (web rule)', () => {
    const clash: RawTimetableJSON = {
      '2024': {
        CS: {
          repeat: {},
          regular: {
            X: { A: { Monday: [{ room: 'ReSch', time: '08:30-09:50', rescheduled: true, exam: false }], Friday: [] } },
            Y: { A: { Monday: [{ room: 'C-201', time: '09:00-10:20', rescheduled: false, exam: false }], Friday: [] } },
          },
        },
      },
    };
    const entries = flattenTimetable(clash);
    expect(detectConflicts(entries).size).toBe(0); // rescheduled slot never flags a clash
  });

  test('cancelled slots do not occupy a room (free-rooms parity)', () => {
    expect(Object.keys(buildRoomCalendar(withFlags)).sort()).toEqual(['ReSch D-414'.trim()].filter(Boolean).length ? ['ReSch D-414'] : []);
    // The cancelled "Margala 4 (C-212" slot must not appear as occupied
    const cal = buildRoomCalendar(withFlags);
    expect(Object.keys(cal)).not.toContain('Margala 4 (C-212');
    expect(Object.keys(cal)).toContain('ReSch D-414');
  });
});

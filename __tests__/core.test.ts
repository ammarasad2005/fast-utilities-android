/**
 * Unit tests for the ported business logic.
 *
 * These functions are pure TypeScript ports of the FAST Exam Table web app's
 * src/lib modules, so the mobile client reproduces identical data semantics.
 */

import { flattenTimetable, filterTimetable, formatTime, formatTimeRange, getAvailableSections, extractTimeFromCourseName } from '@/core/timetable';
import { filterExams, filterSummerExams, matchesSummerCourse, groupByDay, sortByChronological } from '@/core/exams';
import { buildRoomCalendar, getAvailableRooms, STANDARD_SLOTS, groupRoomsByBlock } from '@/core/roomLogic';
import { flattenFaculty, searchFaculty, getFacultyRank } from '@/core/faculty';
import { getCalendarCells, parseEventDate } from '@/core/events';
import type { RawTimetableJSON, ExamEntry, RawFacultyDepartment } from '@/core/types';

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
  it('applies the FAST PM heuristic (hours 1–7 are PM)', () => {
    expect(formatTime('08:30')).toBe('8:30 AM');
    expect(formatTime('14:00')).toBe('2:00 PM');
    expect(formatTime('01:00')).toBe('1:00 PM');
  });

  it('formats a range', () => {
    expect(formatTimeRange('08:30 - 10:00')).toBe('8:30 AM – 10:00 AM');
  });

  it('extracts time embedded in a course name', () => {
    const { cleanName, time } = extractTimeFromCourseName('DB (08:30-10:00)');
    expect(cleanName).toBe('DB');
    expect(time).toBe('08:30-10:00');
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

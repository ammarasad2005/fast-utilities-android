/**
 * Custom exam schedule parity suite:
 *  · school-aware course grouping (course NAME first, codes inline)
 *  · matchExamRows — full "Name | CODE" rows + legacy "| CODE" rows, school isolation
 *  · single-slot storage migration (multi-bundle → one schedule, tag-safe)
 *  · the separate exam preference store (pref:saved_exams)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  courseGroupsForExams,
  departmentSchool,
  matchExamRows,
} from '@/core/exams';
import type { ExamEntry } from '@/core/types';
import {
  CUSTOM_EXAMS_NAME,
  EXAM_BUNDLES_KEY,
  loadExamBundles,
  migrateExamBundlesToSingle,
  saveExamBundles,
  type ExamCustomBundle,
} from '@/prefs/examBundles';
import {
  clearSavedExams,
  describeSavedExams,
  getSavedExams,
  setSavedExams,
} from '@/prefs/savedExams';

const ex = (partial: Partial<ExamEntry>): ExamEntry => ({
  date: '12/01/2026',
  day: 'Monday',
  time: '09:00 AM – 11:00 AM',
  courseCode: 'CS1004',
  courseName: 'Object Oriented Programming',
  batch: '2023',
  department: 'CS',
  school: 'FSC',
  ...partial,
});

const DATA: ExamEntry[] = [
  ex({}),
  ex({ courseCode: 'CS2001', courseName: 'Database Systems', date: '14/01/2026' }),
  // same NAME, different code variants (rare) → grouped under one name
  ex({ courseCode: 'CS1004L', courseName: 'Object Oriented Programming', date: '13/01/2026' }),
  ex({ courseCode: 'BBA2003', courseName: 'Financial Accounting', department: 'BBA', school: 'FSM', batch: '2024', date: '15/01/2026' }),
  ex({ courseCode: 'EE1001', courseName: 'Circuit Analysis', department: 'EE', school: 'FSE', batch: '2023', date: '16/01/2026' }),
];

const bundle = (id: string, rows: any[], school = 'FSC'): ExamCustomBundle => ({
  id,
  name: CUSTOM_EXAMS_NAME,
  school,
  rows,
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('departmentSchool', () => {
  it('maps departments to schools, unknown → null', () => {
    expect(departmentSchool('CS')).toBe('FSC');
    expect(departmentSchool('BBA')).toBe('FSM');
    expect(departmentSchool('EE')).toBe('FSE');
    expect(departmentSchool('NOPE')).toBeNull();
  });
});

describe('courseGroupsForExams', () => {
  it('groups by course NAME with codes inline, sorted', () => {
    const groups = courseGroupsForExams(DATA, 'FSC', '2023', 'CS');
    expect(groups).toHaveLength(2);
    const oop = groups.find((g) => g.courseName === 'Object Oriented Programming')!;
    expect(oop.sections).toEqual(['CS1004', 'CS1004L']);
    expect(groups[0].courseName).toBe('Database Systems'); // alphabetical
  });

  it('scopes strictly to school + batch + department', () => {
    expect(courseGroupsForExams(DATA, 'FSM', '2023', 'CS')).toHaveLength(0);
    expect(courseGroupsForExams(DATA, 'FSC', '2024', 'CS')).toHaveLength(0);
    expect(courseGroupsForExams(DATA, 'FSM', '2024', 'BBA')).toHaveLength(1);
    expect(courseGroupsForExams(DATA, 'FSE', '2023', 'EE')[0].courseName).toBe('Circuit Analysis');
  });
});

describe('matchExamRows', () => {
  it('matches a full "Name | CODE" row within its school', () => {
    const got = matchExamRows(
      DATA,
      [{ batch: '2023', dept: 'CS', selection: 'Database Systems | CS2001' }],
      'FSC'
    );
    expect(got).toHaveLength(1);
    expect(got[0].courseCode).toBe('CS2001');
  });

  it('resolves legacy code-only rows ("| CODE")', () => {
    const got = matchExamRows(DATA, [{ batch: '2023', dept: 'CS', selection: '| CS1004' }], 'FSC');
    expect(got).toHaveLength(1);
    expect(got[0].courseName).toBe('Object Oriented Programming');
  });

  it('never leaks other schools, even when batch/dept coincide', () => {
    const got = matchExamRows(DATA, [{ batch: '2024', dept: 'BBA', selection: 'Financial Accounting | BBA2003' }], 'FSC');
    expect(got).toHaveLength(0);
  });

  it('skips incomplete rows and returns chronological order', () => {
    const got = matchExamRows(
      DATA,
      [
        { batch: '', dept: 'CS', selection: 'Database Systems | CS2001' },
        { batch: '2023', dept: 'CS', selection: 'Database Systems | CS2001' },
        { batch: '2023', dept: 'CS', selection: 'Object Oriented Programming | CS1004' },
      ],
      'FSC'
    );
    expect(got.map((e) => e.courseCode)).toEqual(['CS1004', 'CS2001']); // 12th before 14th
  });
});

describe('exam bundle store + single-slot migration', () => {
  it('round-trips and normalizes legacy code rows', async () => {
    await saveExamBundles([
      bundle('b1', [{ id: 'r1', batch: '2023', dept: 'CS', code: 'CS1004' } as any], undefined as any),
    ]);
    const [b] = await loadExamBundles();
    expect(b.rows[0].selection).toBe('| CS1004');
    expect(b.school).toBe('FSC'); // derived from dept
  });

  it('≤1 bundle: migration is a no-op', async () => {
    await saveExamBundles([bundle('only', [{ id: 'r', batch: '2023', dept: 'CS', selection: 'A | B' }])]);
    await migrateExamBundlesToSingle();
    expect(await loadExamBundles()).toHaveLength(1);
  });

  it('multi-bundle collapse keeps the MOST RECENT (legacy screen appended)', async () => {
    await saveExamBundles([
      bundle('old', []),
      bundle('mid', []),
      bundle('newest', [{ id: 'r', batch: '2023', dept: 'CS', selection: 'Database Systems | CS2001' }]),
    ]);
    await migrateExamBundlesToSingle();
    const list = await loadExamBundles();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('newest');
  });

  it('the exam tag protects its bundle from deletion', async () => {
    await saveExamBundles([bundle('tagged', []), bundle('newest', [])]);
    await setSavedExams({ kind: 'bundle', bundleId: 'tagged' });
    await migrateExamBundlesToSingle();
    const list = await loadExamBundles();
    expect(list.map((b) => b.id)).toEqual(['tagged']);
    expect((await getSavedExams())?.kind).toBe('bundle');
  });

  it('a dangling exam tag on a deleted bundle is cleared', async () => {
    await saveExamBundles([bundle('stayed', []), bundle('newest', [])]);
    await setSavedExams({ kind: 'bundle', bundleId: 'gone' });
    await migrateExamBundlesToSingle();
    expect(await getSavedExams()).toBeNull();
  });

  it('a default-style exam tag survives the migration', async () => {
    await saveExamBundles([bundle('a', []), bundle('b', [])]);
    await setSavedExams({ kind: 'default', school: 'FSC', batch: '2023', dept: 'CS' });
    await migrateExamBundlesToSingle();
    expect(await getSavedExams()).toEqual({ kind: 'default', school: 'FSC', batch: '2023', dept: 'CS' });
  });
});

describe('savedExams preference store', () => {
  it('round-trips, describes, clears — independent of the timetable store', async () => {
    expect(await getSavedExams()).toBeNull();
    await setSavedExams({ kind: 'default', school: 'FSM', batch: '2024', dept: 'BBA' });
    expect(describeSavedExams(await getSavedExams())).toBe('FSM · BBA 2024');
    await setSavedExams({ kind: 'bundle', bundleId: 'b1' });
    expect(describeSavedExams(await getSavedExams())).toBe('your custom exam schedule');
    // timetable store untouched
    expect(await AsyncStorage.getItem('pref:saved_schedule')).toBeNull();
    await clearSavedExams();
    expect(await getSavedExams()).toBeNull();
  });
});

/**
 * Regression: Saturday as an official standing day AND as a dated makeup sheet
 * in the same week.
 *
 * Live sheet of 4 Sep 2026 carried BOTH:
 *   {day:'Saturday', sheetName:'Saturday (Sep. 05, 2026)', isMakeup:true}  ← 250+ classes
 *   {day:'Saturday', sheetName:'Saturday', isMakeup:false}                 ← 14 standing classes
 *
 * Before the fix the engine only resolved plain weekday names, so every class
 * keyed under the dated sheet was silently dropped from the next/ongoing
 * engine — and with it from the Home card and the home-screen widgets, while
 * the website (keyed per sheetName) showed them correctly.
 */
import { flattenTimetable } from '../src/core/timetable';
import { resolveWeekPlan } from '../src/core/weekPlan';
import { computeClassStatus } from '../src/core/liveClass';
import { buildSnapshot } from '../src/widgets/nextClassWidget';

const META_DAYS = [
  { day: 'Monday', sheetName: 'Monday', date: '', isoDate: '2026-08-31', isMakeup: false },
  { day: 'Tuesday', sheetName: 'Tuesday', date: '', isoDate: '2026-09-01', isMakeup: false },
  { day: 'Wednesday', sheetName: 'Wednesday', date: '', isoDate: '2026-09-02', isMakeup: false },
  { day: 'Thursday', sheetName: 'Thursday', date: '', isoDate: '2026-09-03', isMakeup: false },
  { day: 'Friday', sheetName: 'Friday', date: '', isoDate: '2026-09-04', isMakeup: false },
  { day: 'Saturday', sheetName: 'Saturday (Sep. 05, 2026)', date: '05 Sep', isoDate: '2026-09-05', isMakeup: true },
  { day: 'Saturday', sheetName: 'Saturday', date: '', isoDate: '2026-09-05', isMakeup: false },
];

const slot = (time: string) => ({ room: 'C-301', time, rescheduled: false, is_elective: false, elective_group: null, exam: false });

const RAW = {
  __meta__: { days: META_DAYS },
  '2026': {
    SE: {
      regular: {
        AP: { E: { 'Saturday (Sep. 05, 2026)': [slot('08:30-09:50')] } },
        PF: { E: { Saturday: [slot('09:30-10:50')] } },
        Calculus: { E: { Monday: [slot('08:30-09:50')] } },
      },
      repeat: {},
    },
  },
} as any;

function status(now: Date) {
  const entries = flattenTimetable(RAW);
  const plan = resolveWeekPlan(RAW.__meta__.days, { semesterStartISO: '2026-08-17', now });
  return { st: computeClassStatus(entries, plan, now), plan };
}

describe('Saturday makeup + standing Saturday coexistence', () => {
  it('after Friday classes, tomorrow’s dated makeup-Saturday class is NEXT', () => {
    const { st } = status(new Date(2026, 8, 4, 17, 0));
    expect(st?.type).toBe('next');
    expect(st?.classes[0].courseName).toBe('AP');
    expect(st?.classes[0].dateISO).toBe('2026-09-05');
  });

  it('makeup-Saturday class is ONGOING on that day', () => {
    const { st } = status(new Date(2026, 8, 5, 9, 0));
    expect(st?.type).toBe('ongoing');
    expect(st?.classes[0].courseName).toBe('AP');
  });

  it('widget snapshot for a dated Saturday shows Sat + date + time', () => {
    const { st, plan } = status(new Date(2026, 8, 4, 17, 0));
    const snap = buildSnapshot(st, plan, false, new Date(2026, 8, 4, 17, 0));
    expect(snap.state).toBe('next');
    expect((snap as any).sub).toContain('Sat');
    expect((snap as any).sub).toContain('5 Sep');
  });

  it('a day with no classes is a plain off day: Sat evening points past it', () => {
    const { st } = status(new Date(2026, 8, 5, 17, 0));
    expect(st?.type).toBe('next');
    expect(st?.classes[0].courseName).toBe('Calculus');
    expect(st?.classes[0].dateISO).toBe('2026-09-07');
  });

  it('the displaced standing-Saturday sheet reappears next week (web parity)', () => {
    const { st } = status(new Date(2026, 8, 11, 20, 0));
    expect(st?.type).toBe('next');
    expect(st?.classes[0].courseName).toBe('PF');
    expect(st?.classes[0].dateISO).toBe('2026-09-12');
  });
});

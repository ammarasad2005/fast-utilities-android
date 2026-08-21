/**
 * Exam schedule filtering / grouping — ported from src/lib/filter.ts.
 */

import type { ExamEntry, FilterState } from './types';

export function filterExams(entries: ExamEntry[], filter: FilterState): ExamEntry[] {
  const q = filter.query.toLowerCase().trim();
  return entries.filter((e) => {
    if (e.batch !== filter.batch) return false;
    if (e.school !== filter.school) return false;
    if (e.department !== filter.department) return false;
    if (q && !e.courseCode.toLowerCase().includes(q) && !e.courseName.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

// ─── Summer exam matching ─────────────────────────────────────────────────────

const SUMMER_COURSE_ALIASES: Record<string, string[]> = {
  ap: ['applied physics'],
  calculus: ['calculus and analytical geometry'],
  dld: ['digital logic design'],
  'dld lab': ['digital logic design lab'],
  la: ['linear algebra'],
  'mv calculus': ['multivariable calculus'],
  oop: ['object oriented programming'],
  'oop lab': ['object oriented programming lab'],
  pf: ['programming fundamental', 'programming fundamentals'],
  'pf lab': ['programming fundamental lab'],
  'prob & stats': ['probability and satistics'], // typo matches source xlsx
  'generative ai': ['generative ai'],
  'discrete st': [],
};

export function matchesSummerCourse(selectedName: string, examName: string): boolean {
  const sel = selectedName.toLowerCase().trim();
  const exam = examName.toLowerCase().trim();

  if (!sel || !exam) return false;

  const aliases = SUMMER_COURSE_ALIASES[sel];
  if (aliases !== undefined) {
    return aliases.some((a) => exam === a);
  }

  if (sel === exam) return true;

  // Acronym match — "DLD" → "Digital Logic Design"
  if (
    /^[a-z]{2,5}$/.test(sel) &&
    selectedName.trim() === selectedName.trim().toUpperCase()
  ) {
    const examWords = exam.split(/\s+/).filter((w) => w.length > 0 && /[a-z]/.test(w));
    const acronym = examWords.map((w) => w[0]).join('');
    if (acronym === sel) return true;
  }

  // Significant word overlap (≥4 chars)
  const selWords = sel.split(/[\s&]+/).filter((w) => w.length > 3);
  const examWords = exam.split(/[\s&]+/).filter((w) => w.length > 3);
  if (selWords.length > 0) {
    const hasOverlap = selWords.some((sw) =>
      examWords.some((ew) => ew.startsWith(sw) || sw.startsWith(ew))
    );
    if (hasOverlap) return true;
  }

  return false;
}

export function filterSummerExams(
  entries: ExamEntry[],
  filter: { query: string; selectedCourses?: string[] }
): ExamEntry[] {
  const q = filter.query.toLowerCase().trim();
  const courses = filter.selectedCourses ?? [];

  return entries.filter((e) => {
    if (courses.length > 0) {
      const matches = courses.some((course) => matchesSummerCourse(course, e.courseName));
      if (!matches) return false;
    }
    if (q && !e.courseCode.toLowerCase().includes(q) && !e.courseName.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

// ─── Grouping / sorting ───────────────────────────────────────────────────────

export function groupByDay(
  entries: ExamEntry[]
): { label: string; entries: ExamEntry[] }[] {
  const map = new Map<string, ExamEntry[]>();
  for (const e of entries) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date)!.push(e);
  }
  return [...map.entries()].map(([date, dayEntries]) => ({
    label: formatDayHeader(date, dayEntries[0].day),
    entries: dayEntries,
  }));
}

// "12/05/2025" + "Monday" → "MON 12 MAY"
export function formatDayHeader(date: string, day: string): string {
  const [d, m] = date.split('/');
  const monthNames = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  return `${day.slice(0, 3).toUpperCase()} ${d} ${monthNames[parseInt(m) - 1]}`;
}

/** Sort chronologically by "DD/MM/YYYY" then by start time. */
export function sortByChronological(entries: ExamEntry[]): ExamEntry[] {
  return [...entries].sort((a, b) => {
    const [da, ma, ya] = a.date.split('/').map(Number);
    const [db, mb, yb] = b.date.split('/').map(Number);
    const ta = ya * 10000 + ma * 100 + da;
    const tb = yb * 10000 + mb * 100 + db;
    if (ta !== tb) return ta - tb;
    return timeStart(a.time) - timeStart(b.time);
  });
}

function timeStart(time: string): number {
  const m = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 0;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const p = m[3].toUpperCase();
  if (p === 'PM' && h < 12) h += 12;
  if (p === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

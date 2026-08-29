/**
 * Exam schedule filtering / grouping — ported from src/lib/filter.ts.
 */

import { SCHOOL_DEPARTMENTS, type ExamEntry, type FilterState } from './types';
import { parseTime24 } from './dates';

/**
 * "09:00 AM – 11:00 AM" / "2:00 to 5:00 PM" → { start, end } minutes past
 * midnight. Handles en/em dashes, "to", and a shared trailing meridiem
 * ("9:00 to 12:00 PM"). If the end parses before the start (AM/PM omitted on
 * the later bound), +12h is added. Unparseable → {0,0}.
 */
export function parseExamTimeRange(range: string): { start: number; end: number } {
  if (!range) return { start: 0, end: 0 };
  const parts = range
    .split(/\s+[–—-]\s+|\s+to\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return { start: 0, end: 0 };
  const start = parseTime24(parts[0]);
  let end = parseTime24(parts[1]);
  if (end <= start) end += 12 * 60;
  return { start, end };
}

/** Department → owning school ('ALL' summer rows default to FSC). */
export function departmentSchool(dept: string): string | null {
  for (const [school, depts] of Object.entries(SCHOOL_DEPARTMENTS)) {
    if (depts.includes(dept)) return school;
  }
  return null;
}

/** Subset of a custom-exam builder row the matcher needs. */
export interface ExamMatchRow {
  batch: string;
  dept: string;
  selection: string; // "Course Name | CODE" (name may be '' for legacy rows)
}

/**
 * Courses for a batch/dept within one school, grouped by NAME with the
 * course codes inline (mirrors the timetable picker's course→section
 * groups; exams have no sections, so the chip slot carries the code —
 * usually exactly one).
 */
export function courseGroupsForExams(
  entries: ExamEntry[],
  school: string,
  batch: string,
  dept: string
): { courseName: string; sections: string[] }[] {
  if (!batch || !dept) return [];
  const map = new Map<string, Set<string>>();
  for (const e of entries) {
    if (e.school !== school || e.batch !== batch || e.department !== dept) continue;
    if (!map.has(e.courseName)) map.set(e.courseName, new Set());
    map.get(e.courseName)!.add(e.courseCode);
  }
  return [...map.entries()]
    .map(([courseName, codes]) => ({
      courseName,
      sections: [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    }))
    .sort((a, b) => a.courseName.localeCompare(b.courseName));
}

/**
 * Match a set of builder rows against the exam schedule → concrete exams.
 * A row participates only when fully specified (batch + dept + selection).
 * Selection "Name | CODE" matches both fields; a leading empty name
 * (legacy `| CODE` rows) matches by code alone. Rows are school-scoped:
 * entries from other schools never leak in.
 */
export function matchExamRows(
  entries: ExamEntry[],
  rows: ExamMatchRow[],
  school: string
): ExamEntry[] {
  const out: ExamEntry[] = [];
  for (const r of rows) {
    if (!r.batch || !r.dept || !r.selection) continue;
    // Legacy code-only rows are normalized to "| CODE" (no leading name part).
    let name: string;
    let code: string;
    if (r.selection.startsWith('| ')) {
      name = '';
      code = r.selection.slice(2);
    } else {
      const sep = r.selection.lastIndexOf(' | ');
      name = sep >= 0 ? r.selection.slice(0, sep) : r.selection;
      code = sep >= 0 ? r.selection.slice(sep + 3) : '';
    }
    for (const e of entries) {
      if (e.school !== school) continue;
      if (e.batch !== r.batch || e.department !== r.dept) continue;
      if (name && e.courseName !== name) continue;
      if (code && e.courseCode !== code) continue;
      out.push(e);
    }
  }
  return sortByChronological(out);
}

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

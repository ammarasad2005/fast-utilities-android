/**
 * Timetable flattening / filtering / formatting — ported from
 * src/lib/timetable-filter.ts and src/lib/types.ts.
 */

import type {
  RawTimetableJSON,
  TimetableBatchMap,
  TimetableEntry,
  TimetableSlot,
} from './types';
import { DAYS_ORDER, TIMETABLE_META_KEY } from './types';

/** Extract a "(HH:MM-HH:MM)" time embedded in a course name. */
export function extractTimeFromCourseName(
  courseName: string
): { cleanName: string; time: string | null } {
  const timeRegex = /(?:\()?([0-2]?\d:[0-5]\d)\s*[-–]\s*([0-2]?\d:[0-5]\d)(?:\))?/;
  const match = courseName.match(timeRegex);
  if (match) {
    const time = `${match[1]}-${match[2]}`;
    const cleanName = courseName.replace(timeRegex, '').replace(/\s+/g, ' ').trim();
    return { cleanName, time };
  }
  return { cleanName: courseName, time: null };
}

/** Flatten the nested Python timetable JSON into a flat TimetableEntry[]. */
export function flattenTimetable(raw: RawTimetableJSON): TimetableEntry[] {
  const entries: TimetableEntry[] = [];

  for (const [batch, deptMap] of Object.entries(raw)) {
    if (batch === TIMETABLE_META_KEY || batch === 'System' || batch === 'Reserved') {
      continue;
    }
    const typedDeptMap = deptMap as unknown as TimetableBatchMap;
    for (const dept of Object.keys(typedDeptMap)) {
      const cats = typedDeptMap[dept];
      for (const category of ['regular', 'repeat'] as const) {
        const courseMap = cats[category] ?? {};
        for (const courseName of Object.keys(courseMap)) {
          const { cleanName, time: extractedTime } = extractTimeFromCourseName(courseName);
          const sectionMap = courseMap[courseName];
          for (const section of Object.keys(sectionMap)) {
            const dayMap = sectionMap[section];
            for (const day of Object.keys(dayMap)) {
              const slots: TimetableSlot[] = dayMap[day];
              for (const slot of slots) {
                entries.push({
                  courseName: cleanName,
                  batch,
                  department: dept,
                  section,
                  day,
                  time: (extractedTime || slot.time) ?? 'TBA',
                  room: slot.room ?? 'TBA',
                  type: cleanName.toLowerCase().endsWith('lab') ? 'lab' : 'lecture',
                  category,
                  rescheduled: slot.rescheduled ?? false,
                  exam: slot.exam ?? false,
                  isElective: (slot as any).is_elective ?? false,
                  electiveGroup: slot.elective_group ?? null,
                  cancelled: slot.cancelled ?? false,
                  reserved: slot.reserved ?? false,
                });
              }
            }
          }
        }
      }
    }
  }

  return entries;
}

// ─── Filtering ────────────────────────────────────────────────────────────────

export interface TimetableFilter {
  batch: string;
  department: string;
  section: string;
  query: string;
  includeRepeats?: boolean;
}

export function isDepartmentMatch(entryDept: string, filterDept: string): boolean {
  if (entryDept === filterDept) return true;
  const depts = entryDept.split('/').map((d) => d.trim());
  return depts.includes(filterDept);
}

export function filterTimetable(
  entries: TimetableEntry[],
  filter: TimetableFilter
): TimetableEntry[] {
  const q = filter.query.toLowerCase().trim();
  const includeRepeats = filter.includeRepeats ?? false;
  return entries.filter((e) => {
    if (e.batch !== filter.batch) return false;
    if (!isDepartmentMatch(e.department, filter.department)) return false;
    if (!includeRepeats && e.category === 'repeat') return false;
    if (e.isElective) return false;

    const normalizedSection = e.section.replace(/\d+$/, '');
    if (normalizedSection !== filter.section) return false;

    if (
      q &&
      !e.courseName.toLowerCase().includes(q) &&
      !e.room.toLowerCase().includes(q) &&
      !e.section.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
}

// ─── Grouping / sections ──────────────────────────────────────────────────────

export function groupByDayTimetable(
  entries: TimetableEntry[]
): { day: string; entries: TimetableEntry[] }[] {
  const map = new Map<string, TimetableEntry[]>();
  for (const e of entries) {
    if (!map.has(e.day)) map.set(e.day, []);
    map.get(e.day)!.push(e);
  }
  for (const dayEntries of map.values()) {
    dayEntries.sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
  }
  // Preserve canonical day order, then any extra days
  return [...map.entries()]
    .map(([day, dayEntries]) => ({ day, entries: dayEntries }))
    .sort((a, b) => {
      const ia = DAYS_ORDER.indexOf(a.day);
      const ib = DAYS_ORDER.indexOf(b.day);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
}

export function getAvailableSections(
  entries: TimetableEntry[],
  batch: string,
  department: string
): string[] {
  const allSections = new Set<string>();
  const nonElectiveSections = new Set<string>();

  for (const e of entries) {
    if (e.batch === batch && isDepartmentMatch(e.department, department)) {
      if (e.section === '') continue;
      const normalized = e.section.replace(/\d+$/, '');
      allSections.add(normalized);
      if (!e.isElective) nonElectiveSections.add(normalized);
    }
  }

  const filtered = [...allSections].filter((s) => nonElectiveSections.has(s));
  return filtered.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });
}

export function getAvailableBatchesForTimetable(entries: TimetableEntry[]): string[] {
  return [...new Set(entries.map((e) => e.batch))].sort().reverse();
}

export function getAvailableDepartments(
  entries: TimetableEntry[],
  batch: string
): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    if (e.batch === batch) set.add(e.department);
  }
  return [...set].sort();
}

// ─── Time parsing / formatting ────────────────────────────────────────────────

export function parseTimeToMinutes(t: string): number {
  if (!t || t === 'TBA' || t === 'Unknown Time') return 0;

  const amPmMatch = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (amPmMatch) {
    let h = parseInt(amPmMatch[1], 10);
    const min = parseInt(amPmMatch[2], 10);
    const p = amPmMatch[3].toUpperCase();
    if (p === 'PM' && h < 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }

  const h24Match = t.match(/(\d{1,2}):(\d{2})/);
  if (h24Match) {
    let h = parseInt(h24Match[1], 10);
    const min = parseInt(h24Match[2], 10);
    if (h >= 1 && h <= 7) h += 12;
    return h * 60 + min;
  }

  return 0;
}

/** "08:30" → "8:30 AM" */
export function formatTime(t: string): string {
  if (!t || t === 'TBA' || t === 'Unknown Time') return t;
  if (/AM|PM/i.test(t)) return t;

  const match = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return t;

  let h = parseInt(match[1], 10);
  const min = match[2];
  if (h >= 1 && h <= 7) h += 12;

  const period = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  // Zero-pad the hour so single-digit times ("8:30 AM") align with
  // double-digit times ("10:00 AM") in fixed-width list layouts.
  return `${String(h).padStart(2, '0')}:${min} ${period}`;
}

/** Split a raw slot string ("08:30 - 10:00" or "08:30 to 10:00") into its ends. */
export function slotParts(time: string): string[] {
  const del = time.includes(' to ') ? ' to ' : '-';
  return time.split(del).map((s) => s.trim());
}

/** "08:30 - 10:00" → "08:30 AM" */
export function formatSlotStart(time: string): string {
  const parts = slotParts(time);
  return parts.length >= 2 ? formatTime(parts[0]) : time;
}

/** "08:30 - 10:00" → "10:00 AM" */
export function formatSlotEnd(time: string): string {
  const parts = slotParts(time);
  return parts.length >= 2 ? formatTime(parts[parts.length - 1]) : time;
}

/** "08:30 - 10:00" → "08:30 – 10:00 AM" */
export function formatTimeRange(t: string): string {
  if (!t || t === 'TBA' || t === 'Unknown Time') return t;
  const parts = t.split('-').map((s) => s.trim());
  if (parts.length === 2) {
    return `${formatTime(parts[0])} – ${formatTime(parts[1])}`;
  }
  return formatTime(t);
}

// ─── Conflict detection (custom timetable) ────────────────────────────────────
// Ported from the web app's src/lib/timetable-filter.ts.

/** "08:30 - 10:00" → [startMin, endMin] (90-min fallback for single times). */
export function parseTimeRange(t: string): [number, number] {
  const parts = t.split('-').map((s) => s.trim());
  if (parts.length >= 2) {
    return [parseTimeToMinutes(parts[0]), parseTimeToMinutes(parts[parts.length - 1])];
  }
  const start = parseTimeToMinutes(t);
  return [start, start + 90];
}

export function makeKey(e: TimetableEntry): string {
  return `${e.day}|${e.time}|${e.courseName}|${e.section}`;
}

function overlaps(a: TimetableEntry, b: TimetableEntry): boolean {
  const [aStart, aEnd] = parseTimeRange(a.time);
  const [bStart, bEnd] = parseTimeRange(b.time);
  return aStart < bEnd && bStart < aEnd;
}

/** Returns the keys of entries that overlap in time on the same day. */
export function detectConflicts(entries: TimetableEntry[], includeRepeats = true): Set<string> {
  const conflicting = new Set<string>();
  const byDay = new Map<string, TimetableEntry[]>();

  for (const e of entries) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(e);
  }

  for (const dayEntries of byDay.values()) {
    for (let i = 0; i < dayEntries.length; i++) {
      for (let j = i + 1; j < dayEntries.length; j++) {
        const a = dayEntries[i];
        const b = dayEntries[j];

        if (a.rescheduled || b.rescheduled || a.exam || b.exam) continue;
        if (a.day === 'Saturday' || b.day === 'Saturday') continue;
        if (!includeRepeats && (a.category === 'repeat' || b.category === 'repeat')) continue;

        const aNorm = a.section.replace(/\d+$/, '');
        const bNorm = b.section.replace(/\d+$/, '');
        if (aNorm !== bNorm) continue;

        if (overlaps(a, b)) {
          conflicting.add(makeKey(a));
          conflicting.add(makeKey(b));
        }
      }
    }
  }

  return conflicting;
}

// ─── "My schedule" selection model (shared by Timetable tab + Home card) ─────

/** `${department}|${category}|${courseName}` — stable identity for a course. */
export function courseKeyOf(e: Pick<TimetableEntry, 'department' | 'category' | 'courseName'>): string {
  return `${e.department}|${e.category}|${e.courseName}`;
}

export interface DisplayConfig {
  batch: string;
  department: string;
  section: string;
}

export interface DisplayPrefs {
  /** courseKey → manually chosen section */
  sectionByCourse: Record<string, string>;
  /** `${courseKey}|${section}` — electives/repeats picked into view */
  pickedElectives: string[];
}

export const EMPTY_DISPLAY_PREFS: DisplayPrefs = { sectionByCourse: {}, pickedElectives: [] };

/**
 * The exact set of entries a configured user sees as "their" schedule —
 * extracted verbatim from the Timetable tab so the Home next-class card works
 * on the identical class list (mirrors the web's getLiveTimetableEntries):
 * own-section courses with per-course section overrides, plus picked
 * electives/repeats, deduplicated.
 */
export function computeDisplayedEntries(
  entries: TimetableEntry[],
  cfg: DisplayConfig,
  prefs: DisplayPrefs = EMPTY_DISPLAY_PREFS
): TimetableEntry[] {
  const base = filterTimetable(entries, {
    batch: cfg.batch,
    department: cfg.department,
    section: cfg.section,
    query: '',
  });

  const defaultSectionByCourse = new Map<string, string>();
  for (const e of base) {
    const key = courseKeyOf(e);
    if (!defaultSectionByCourse.has(key)) defaultSectionByCourse.set(key, e.section);
  }

  const out: TimetableEntry[] = [];
  const seen = new Set<string>();

  // Main: chosen section per course (manual override or own-section default).
  for (const e of entries) {
    if (e.batch !== cfg.batch || !isDepartmentMatch(e.department, cfg.department)) continue;
    if (e.isElective || e.category === 'repeat') continue;
    const key = courseKeyOf(e);
    const chosen = prefs.sectionByCourse[key] ?? defaultSectionByCourse.get(key);
    if (chosen == null || e.section !== chosen) continue;
    const k = makeKey(e);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }

  // Picked electives/repeats.
  for (const e of entries) {
    if (e.batch !== cfg.batch || !isDepartmentMatch(e.department, cfg.department)) continue;
    if (!(e.isElective || e.category === 'repeat')) continue;
    const pickKey = `${courseKeyOf(e)}|${e.section}`;
    if (!prefs.pickedElectives.includes(pickKey)) continue;
    const k = makeKey(e);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }

  return out;
}

/** Minimal shape of a custom-timetable row needed for matching. */
export interface CustomRowLike {
  batch: string;
  dept: string;
  category: string;
  selection: string; // "Course Name | Section"
}

/**
 * Resolve custom-timetable rows against a school's entries — identical to the
 * Custom Timetable screen's matcher (batch + dept + category + course +
 * section, deduplicated per slot).
 */
export function matchCustomRows(entries: TimetableEntry[], rows: CustomRowLike[]): TimetableEntry[] {
  const seen = new Set<string>();
  const out: TimetableEntry[] = [];
  for (const r of rows) {
    if (!r.batch || !r.dept || !r.category || !r.selection) continue;
    const [courseName, section] = r.selection.split(' | ');
    for (const e of entries) {
      if (
        e.batch === r.batch &&
        e.department === r.dept &&
        e.category === r.category &&
        e.courseName === courseName &&
        e.section === section
      ) {
        const key = `${e.day}|${e.time}|${e.courseName}|${e.section}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(e);
        }
      }
    }
  }
  return out;
}

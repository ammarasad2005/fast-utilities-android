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

function isDepartmentMatch(entryDept: string, filterDept: string): boolean {
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
  return `${h}:${min} ${period}`;
}

/** "08:30 - 10:00" → "8:30 – 10:00 AM" */
export function formatTimeRange(t: string): string {
  if (!t || t === 'TBA' || t === 'Unknown Time') return t;
  const parts = t.split('-').map((s) => s.trim());
  if (parts.length === 2) {
    return `${formatTime(parts[0])} – ${formatTime(parts[1])}`;
  }
  return formatTime(t);
}

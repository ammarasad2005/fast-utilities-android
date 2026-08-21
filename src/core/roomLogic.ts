/**
 * Free-room availability logic — ported from src/lib/room-logic.ts.
 */

import type { RawTimetableJSON, TimetableBatchMap } from './types';
import { TIMETABLE_META_KEY } from './types';

export interface BusySlot {
  start: number;
  end: number;
}

export type RoomCalendar = Record<string, Record<string, BusySlot[]>>;

export interface RoomAvailability {
  fullyVacant: string[];
  partiallyVacant: string[];
}

function toMinutes(t: string): number {
  const match = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h >= 1 && h <= 7) h += 12; // FAST PM convention
  return h * 60 + m;
}

function parseSlot(timeStr: string): BusySlot | null {
  if (!timeStr || timeStr === 'TBA' || timeStr === 'Unknown Time') return null;
  const parts = timeStr.split('-').map((s) => s.trim());
  if (parts.length < 2) return null;
  const start = toMinutes(parts[0]);
  const end = toMinutes(parts[parts.length - 1]);
  if (!start && !end) return null;
  return { start, end: end > start ? end : start + 90 };
}

export interface TimeSlot {
  label: string;
  raw: string;
  start: number;
  end: number;
}

export const STANDARD_SLOTS: TimeSlot[] = [
  { label: '8:30 AM – 9:50 AM', raw: '08:30-09:50', start: 510, end: 590 },
  { label: '10:00 AM – 11:20 AM', raw: '10:00-11:20', start: 600, end: 680 },
  { label: '11:30 AM – 12:50 PM', raw: '11:30-12:50', start: 690, end: 770 },
  { label: '1:00 PM – 2:20 PM', raw: '13:00-14:20', start: 780, end: 860 },
  { label: '2:30 PM – 3:50 PM', raw: '14:30-15:50', start: 870, end: 950 },
  { label: '3:55 PM – 5:15 PM', raw: '15:55-17:15', start: 955, end: 1035 },
];

export const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function buildRoomCalendar(raw: RawTimetableJSON): RoomCalendar {
  const calendar: RoomCalendar = {};

  const addSlot = (room: string, day: string, timeStr: string) => {
    if (!room || room === 'TBA' || room === 'Unknown') return;
    const slot = parseSlot(timeStr);
    if (!slot) return;
    if (!calendar[room]) calendar[room] = {};
    if (!calendar[room][day]) calendar[room][day] = [];
    calendar[room][day].push(slot);
  };

  for (const [batch, deptMap] of Object.entries(raw)) {
    if (batch === TIMETABLE_META_KEY) continue;
    const typedDeptMap = deptMap as unknown as TimetableBatchMap;
    for (const dept of Object.keys(typedDeptMap)) {
      const cats = typedDeptMap[dept];
      for (const category of ['regular', 'repeat'] as const) {
        const courseMap = cats[category] ?? {};
        for (const courseName of Object.keys(courseMap)) {
          const sectionMap = courseMap[courseName];
          for (const section of Object.keys(sectionMap)) {
            const dayMap = sectionMap[section];
            for (const day of Object.keys(dayMap)) {
              const slots = dayMap[day];
              for (const slot of slots) {
                if ((slot as any).cancelled) continue;
                addSlot(slot.room, day, slot.time);
              }
            }
          }
        }
      }
    }
  }

  return calendar;
}

export function getAvailableRooms(
  calendar: RoomCalendar,
  day: string,
  targetRaw: string
): RoomAvailability {
  const target = parseSlot(targetRaw);
  if (!target) return { fullyVacant: [], partiallyVacant: [] };

  const targetDuration = target.end - target.start;
  const fullyVacant: string[] = [];
  const partiallyVacant: string[] = [];

  for (const room of Object.keys(calendar).sort()) {
    const daySlots = calendar[room][day] ?? [];

    const totalOverlap = daySlots.reduce((acc, busy) => {
      const overlapStart = Math.max(target.start, busy.start);
      const overlapEnd = Math.min(target.end, busy.end);
      return acc + Math.max(0, overlapEnd - overlapStart);
    }, 0);

    const freeMinutes = targetDuration - totalOverlap;

    if (totalOverlap === 0) {
      fullyVacant.push(room);
    } else if (freeMinutes >= 30) {
      partiallyVacant.push(room);
    }
  }

  return { fullyVacant, partiallyVacant };
}

export function groupRoomsByBlock(rooms: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {
    'Block A': [],
    'Block B': [],
    'Block C': [],
    'Block D': [],
    'Labs & Other': [],
  };

  rooms.forEach((r) => {
    const firstUpper = r.split('-')[0].toUpperCase();
    if (firstUpper === 'A') groups['Block A'].push(r);
    else if (firstUpper === 'B') groups['Block B'].push(r);
    else if (firstUpper === 'C') groups['Block C'].push(r);
    else if (firstUpper === 'D') groups['Block D'].push(r);
    else groups['Labs & Other'].push(r);
  });

  return Object.fromEntries(
    Object.entries(groups).filter(([, list]) => list.length > 0)
  );
}

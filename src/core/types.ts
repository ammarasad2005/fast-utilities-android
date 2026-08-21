/**
 * Shared domain types — ported from the FAST Exam Table web app
 * (src/lib/types.ts) so the mobile client reproduces identical data semantics.
 */

export interface ExamEntry {
  date: string; // "DD/MM/YYYY"
  day: string; // "Monday"
  time: string; // "09:00 AM – 11:00 AM" (or "9:00 to 12:00 PM")
  courseCode: string; // "CS1004"
  courseName: string;
  batch: string; // "2023" or "Summer"
  department: string; // "CS" or "ALL" (summer)
  school: string; // "FSC", "FSM", or "FSE"
  room?: string; // summer only
  sections?: string; // summer only
}

export const SCHOOLS = ['FSC', 'FSM', 'FSE'] as const;
export type School = (typeof SCHOOLS)[number];

export const SCHOOL_DEPARTMENTS: Record<string, string[]> = {
  FSC: ['CS', 'AI', 'DS', 'CY', 'SE'],
  FSM: ['BBA', 'AF', 'BA', 'FT'],
  FSE: ['EE', 'CE'],
};

export const DEPARTMENTS: string[] = [
  'CS',
  'AI',
  'DS',
  'CY',
  'SE',
  'BBA',
  'AF',
  'BA',
  'FT',
  'EE',
  'CE',
];

export const DEPARTMENT_LABELS: Record<string, string> = {
  CS: 'Computer Science',
  AI: 'Artificial Intelligence',
  DS: 'Data Science',
  CY: 'Cyber Security',
  SE: 'Software Engineering',
  BBA: 'Bachelor of Business Admin',
  AF: 'Accounting and Finance',
  BA: 'Business Analytics',
  FT: 'FinTech',
  EE: 'Electrical Engineering',
  CE: 'Computer Engineering',
};

export interface FilterState {
  batch: string;
  department: string;
  school: string;
  query: string;
}

export function getAvailableBatches(entries: ExamEntry[]): string[] {
  return [...new Set(entries.map((e) => e.batch))].sort().reverse();
}

// ─── Timetable types ──────────────────────────────────────────────────────────

export interface TimetableEntry {
  courseName: string;
  batch: string;
  department: string;
  section: string;
  day: string;
  time: string; // "08:30 - 10:00"
  room: string; // "CR-01", "TBA"
  type: 'lecture' | 'lab';
  category: 'regular' | 'repeat';
  rescheduled?: boolean;
  exam?: boolean;
  isElective?: boolean;
  electiveGroup?: string | null;
  cancelled?: boolean;
  reserved?: boolean;
}

export const TIMETABLE_META_KEY = '__meta__';

export interface TimetableSheetMeta {
  day: string;
  sheetName: string;
  date?: string;
  isoDate?: string;
  isMakeup?: boolean;
}

export interface TimetableMetadata {
  days: TimetableSheetMeta[];
}

export type TimetableSlot = {
  room: string;
  time: string;
  rescheduled?: boolean;
  exam?: boolean;
  isElective?: boolean;
  elective_group?: string | null;
  cancelled?: boolean;
  reserved?: boolean;
};

export type TimetableDayMap = Record<string, TimetableSlot[]>;
export type TimetableSectionMap = Record<string, TimetableDayMap>;
export type TimetableCourseMap = Record<string, TimetableSectionMap>;

export interface TimetableDepartmentMap {
  regular: TimetableCourseMap;
  repeat: TimetableCourseMap;
}

export type TimetableBatchMap = Record<string, TimetableDepartmentMap>;

export const DAYS_ORDER: string[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export type RawTimetableJSON = Record<string, TimetableBatchMap> & {
  [TIMETABLE_META_KEY]?: TimetableMetadata;
};

// ─── Faculty types ────────────────────────────────────────────────────────────

export interface FacultyMember {
  name: string;
  status: string;
  email: string;
  office_room: string | null;
  linkedin_profile: string | null;
  profile_url: string;
  image_url: string;
}

export interface RawFacultyDepartment {
  department: string;
  faculty: FacultyMember[];
}

// ─── Events types ─────────────────────────────────────────────────────────────

export interface StudentEvent {
  id?: number;
  event_name: string;
  date: string;
  time: string;
  event_location: string;
  from?: string;
}

export interface StudentEventsPayload {
  filtered_at?: string;
  date_range?: string;
  total_original?: number;
  total_filtered?: number;
  events: StudentEvent[];
}

// ─── Semester calendar types ──────────────────────────────────────────────────

export interface KeyDate {
  label: string;
  date: string; // ISO "2026-08-17"
  endDate?: string;
  type: string; // 'academic' | 'deadline' | 'exam' | ...
  icon?: string;
}

export interface SemesterCalendar {
  semester: string;
  academicYear?: string;
  generatedAt?: string;
  keyDates: KeyDate[];
}

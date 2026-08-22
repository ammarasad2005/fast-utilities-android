import type {
  ExamEntry,
  FacultyMember,
  RawFacultyDepartment,
  RawTimetableJSON,
  SemesterCalendar,
  StudentEventsPayload,
} from '@/core/types';
import { API_BASE_URL, DATA_ENDPOINTS } from './config';
import { fetchJson } from './client';

/** FSC timetable (FAST School of Computing). */
export function fetchFSCTimetable(): Promise<RawTimetableJSON> {
  return fetchJson<RawTimetableJSON>(DATA_ENDPOINTS.timetableFSC);
}

/** FSM timetable (FAST School of Management). */
export function fetchFSMTimetable(): Promise<RawTimetableJSON> {
  return fetchJson<RawTimetableJSON>(DATA_ENDPOINTS.timetableFSM);
}

export function fetchRegularSchedule(): Promise<ExamEntry[]> {
  return fetchJson<ExamEntry[]>(DATA_ENDPOINTS.regularSchedule);
}

export function fetchSummerSchedule(): Promise<ExamEntry[]> {
  return fetchJson<ExamEntry[]>(DATA_ENDPOINTS.summerSchedule);
}

export function fetchFaculty(): Promise<RawFacultyDepartment[]> {
  return fetchJson<RawFacultyDepartment[]>(DATA_ENDPOINTS.faculty);
}

export function fetchSemesterCalendar(): Promise<SemesterCalendar> {
  return fetchJson<SemesterCalendar>(DATA_ENDPOINTS.semesterCalendar);
}

export function fetchStudentEvents(): Promise<StudentEventsPayload> {
  return fetchJson<StudentEventsPayload>(DATA_ENDPOINTS.studentEvents);
}

export interface ExamVisibility {
  show_exams: boolean;
  semester_type: 'regular' | 'summer';
  semester_name: string | null;
}

/**
 * Fetch the admin-controlled exam-finder visibility flag from the existing
 * backend (`/api/exam-visibility`). No Supabase credentials are shipped in the
 * app — the flag is resolved server-side.
 */
export function fetchExamVisibility(): Promise<ExamVisibility> {
  return fetchJson<ExamVisibility>(`${API_BASE_URL}/api/exam-visibility`);
}

/** Extract a flat faculty list from the raw grouped payload. */
export function extractFacultyMembers(raw: RawFacultyDepartment[]): FacultyMember[] {
  const out: FacultyMember[] = [];
  for (const dept of raw) {
    for (const m of dept.faculty ?? []) out.push(m);
  }
  return out;
}

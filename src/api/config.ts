import Constants from 'expo-constants';

/**
 * Public client-side configuration only.
 *
 * The API base URL points at the EXISTING production backend (Vercel). No
 * secrets live here — everything private (Supabase service roles, LLM keys)
 * stays server-side in the existing web app's environment.
 */
export const API_BASE_URL: string =
  (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined) ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'https://fast-nuces-isb.vercel.app';

/** Static data files served by the existing Vercel CDN. */
export const DATA_ENDPOINTS = {
  timetableFSC: `${API_BASE_URL}/data/timetable.json`,
  timetableFSM: `${API_BASE_URL}/data/fsm_timetable.json`,
  regularSchedule: `${API_BASE_URL}/data/regular_schedule.json`,
  summerSchedule: `${API_BASE_URL}/data/summer_schedule.json`,
  faculty: `${API_BASE_URL}/data/faculty/faculty_data.json`,
  semesterCalendar: `${API_BASE_URL}/data/semester_calendar.json`,
  studentEvents: `${API_BASE_URL}/data/student_events.json`,
  slateEvents: `${API_BASE_URL}/data/slate_calendar_events.json`,
} as const;

/** Cache TTLs (ms). Static campus data refreshes lazily; cached copy is served first. */
export const CACHE_TTL = {
  timetable: 6 * 60 * 60 * 1000, // 6h
  schedule: 6 * 60 * 60 * 1000, // 6h
  faculty: 24 * 60 * 60 * 1000, // 24h
  semester: 24 * 60 * 60 * 1000, // 24h
  events: 6 * 60 * 60 * 1000, // 6h
} as const;

/** Preferences persisted locally (non-sensitive user selections). */
export const PREF_KEYS = {
  examSchool: 'pref:exam:school',
  examBatch: 'pref:exam:batch',
  examDept: 'pref:exam:dept',
  timetableSchool: 'pref:timetable:school',
  timetableBatch: 'pref:timetable:batch',
  timetableDept: 'pref:timetable:dept',
  timetableSection: 'pref:timetable:section',
} as const;

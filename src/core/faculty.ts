/**
 * Faculty helpers — ported from src/lib/faculty.ts.
 */

import type { FacultyMember, RawFacultyDepartment } from './types';

export type DeptFileKey =
  | 'AIDS'
  | 'AF'
  | 'CE'
  | 'CS'
  | 'CY'
  | 'EE'
  | 'MS'
  | 'SE'
  | 'SH';

export const DEPT_LABELS: Record<DeptFileKey, string> = {
  AIDS: 'AI & Data Science',
  AF: 'Accounting & Finance',
  CE: 'Computer Engineering',
  CS: 'Computer Science',
  CY: 'Cyber Security',
  EE: 'Electrical Engineering',
  MS: 'Management Sciences',
  SE: 'Software Engineering',
  SH: 'Sciences & Humanities',
};

export const DEPT_KEY_FROM_GROUP: Record<string, DeptFileKey> = {
  'Department of Artificial Intelligence & Data Science': 'AIDS',
  'Department of Accounting and Finance': 'AF',
  'Department of Computer Engineering': 'CE',
  'Department of Computer Science': 'CS',
  'Department of Cyber Security': 'CY',
  'Department of Electrical Engineering': 'EE',
  'Department of Management Sciences': 'MS',
  'Department of Sciences & Humanities': 'SH',
  'Department of Software Engineering': 'SE',
};

export const DEPT_ORDER: DeptFileKey[] = [
  'CS',
  'AIDS',
  'SE',
  'CY',
  'EE',
  'CE',
  'SH',
  'AF',
  'MS',
];

function norm(s?: string | null) {
  return (s || '').toLowerCase();
}

export function getFacultyRank(status: string): number {
  const lowerStatus = status.toLowerCase();
  if (lowerStatus.includes('director') || lowerStatus.includes('dean')) return 1;
  if (
    lowerStatus.includes('hod') ||
    lowerStatus.includes('incharge') ||
    lowerStatus.includes('hos') ||
    lowerStatus.includes('head')
  ) {
    return 2;
  }
  if (
    lowerStatus.includes('professor') &&
    !lowerStatus.includes('assistant') &&
    !lowerStatus.includes('associate') &&
    !lowerStatus.includes('adjunct')
  ) {
    return 3;
  }
  if (lowerStatus.includes('associate professor')) return 4;
  if (lowerStatus.includes('assistant professor')) return 5;
  if (lowerStatus.includes('lecturer')) return 6;
  if (lowerStatus.includes('instructor') || lowerStatus.includes('lab engineer')) return 7;
  return 8;
}

export function searchFaculty<T extends FacultyMember>(members: T[], query: string): T[] {
  if (!query.trim()) return members;
  const q = norm(query.trim());
  return members.filter(
    (m) =>
      norm(m.name).includes(q) ||
      norm(m.status).includes(q) ||
      norm(m.email).includes(q) ||
      norm(m.office_room).includes(q)
  );
}

export function flattenFaculty(
  data: RawFacultyDepartment[]
): (FacultyMember & { deptKey: DeptFileKey })[] {
  const out: (FacultyMember & { deptKey: DeptFileKey })[] = [];

  const deptMap: Record<string, FacultyMember[]> = {};
  for (const item of data) {
    const key = DEPT_KEY_FROM_GROUP[item.department];
    if (key) deptMap[key] = item.faculty;
  }

  for (const key of DEPT_ORDER) {
    const faculty = deptMap[key];
    if (faculty) {
      for (const m of faculty) {
        out.push({ ...m, deptKey: key });
      }
    }
  }

  out.sort((a, b) => {
    const rankA = getFacultyRank(a.status);
    const rankB = getFacultyRank(b.status);
    if (rankA !== rankB) return rankA - rankB;
    const deptA = DEPT_ORDER.indexOf(a.deptKey);
    const deptB = DEPT_ORDER.indexOf(b.deptKey);
    return deptA - deptB;
  });

  return out;
}

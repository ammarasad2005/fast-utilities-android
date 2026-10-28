/** Snapshot published to the native home-screen widget. */
export type NextClassWidgetSnapshot = {
  /**
   * Widget display state. 'examBreak' = an exam window is active: render the
   * hold text (course/sub) instead of any timetable class until
   * `untilEpochMs`, then auto-advance into the followup queue (pre-rolled to
   * the first classes after the window).
   */
  state: 'ongoing' | 'next' | 'needsTag' | 'none' | 'examBreak';
  /** Course name (ongoing/next); hold title line e.g. "Exams ongoing." (examBreak). */
  course?: string;
  /** "Sec B · C-301" style line. */
  meta?: string;
  /** Absolute target instant: slot start (next) or slot end (ongoing), ms since epoch. */
  targetEpochMs?: number;
  /** Full slot length in minutes (ongoing only, for the progress bar). */
  totalMin?: number;
  /** Extra classes grouped at the same time ("+N more"). */
  extra?: number;
  /** Secondary line: date label for next, end time for ongoing, hold sub line for examBreak. */
  sub?: string;
  /** Time-only variant of `sub` for the compact widget (day/date dropped). */
  subTime?: string;
  /** examBreak only: absolute instant the hold lifts — renderer walks into followups at this time (0 = never auto-advance). */
  untilEpochMs?: number;
  /**
   * Snapshots of the next ~3 classes after this one. The native renderer walks
   * this queue JS-free so a class ending never leaves a stale "0m left".
   */
  followup?: NextClassWidgetSnapshot[];
  /** When the snapshot was computed (ms). */
  updatedAt: number;
};

/** One personal exam row as the native exam widgets render it. */
export type ExamWidgetItem = {
  course: string;
  code: string;
  /** "Mon 12 Jan" */
  dateLabel: string;
  /** Raw schedule window, e.g. "09:00 AM – 11:00 AM". */
  timeLabel: string;
  startEpochMs: number;
  endEpochMs: number;
  room?: string;
};

/**
 * Snapshot for ALL exam widget variants (countdown / next-exam status / exam
 * list). Chronological `items` is the single source of truth: the native
 * renderer picks the next-or-ongoing exam itself by comparing epochs to now,
 * so it self-heals across midnight without any JS.
 */
export type ExamWidgetSnapshot = {
  state: 'ok' | 'needsTag' | 'hidden' | 'empty';
  items?: ExamWidgetItem[];
  updatedAt: number;
};

/** One milestone dot on the semester timeline widget. */
export type SemesterWidgetMilestone = {
  label: string;
  shortLabel: string; // S1 / S2 / FE / START / END
  /** Day-aligned epoch (local midnight). */
  epochMs: number;
  /** Position on the timeline, 0–100. */
  pct: number;
};

/**
 * Snapshot for ALL semester widget variants (timeline / milestone countdown /
 * month card). The native side derives day-index, countdowns and the current
 * month grid; JS only ships absolute epochs so midnight rollover is JS-free.
 */
export type SemesterWidgetSnapshot = {
  state: 'ok' | 'empty';
  name: string; // "Fall 2025"
  startEpochMs: number;
  endEpochMs: number; // timeline end (finals end if present, else semester end)
  milestones: SemesterWidgetMilestone[];
  /** Day-aligned epochs of the user's personal exams (month-card dots). */
  examDays: number[];
  updatedAt: number;
};

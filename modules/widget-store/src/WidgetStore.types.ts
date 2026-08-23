/** Snapshot published to the native home-screen widget. */
export type NextClassWidgetSnapshot = {
  /** Widget display state. */
  state: 'ongoing' | 'next' | 'needsTag' | 'none';
  /** Course name (ongoing/next only). */
  course?: string;
  /** "Sec B · C-301" style line. */
  meta?: string;
  /** Absolute target instant: slot start (next) or slot end (ongoing), ms since epoch. */
  targetEpochMs?: number;
  /** Full slot length in minutes (ongoing only, for the progress bar). */
  totalMin?: number;
  /** Extra classes grouped at the same time ("+N more"). */
  extra?: number;
  /** Secondary line: date label for next, end time for ongoing. */
  sub?: string;
  /** When the snapshot was computed (ms). */
  updatedAt: number;
};

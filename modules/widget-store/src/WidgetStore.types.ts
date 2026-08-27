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
  /** Time-only variant of `sub` for the compact widget (day/date dropped). */
  subTime?: string;
  /**
   * Snapshots of the next ~3 classes after this one. The native renderer walks
   * this queue JS-free so a class ending never leaves a stale "0m left".
   */
  followup?: NextClassWidgetSnapshot[];
  /** When the snapshot was computed (ms). */
  updatedAt: number;
};

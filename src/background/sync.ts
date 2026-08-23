import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { cacheSet } from '@/api/cache';
import { syncNextClassWidgetFromCache } from '@/widgets/nextClassWidget';
import {
  fetchFaculty,
  fetchFSCTimetable,
  fetchFSMTimetable,
  fetchRegularSchedule,
  fetchSemesterCalendar,
  fetchStudentEvents,
  fetchSummerSchedule,
} from '@/api/endpoints';

/**
 * Background auto-sync.
 *
 * When the app is backgrounded/killed, Android's WorkManager periodically runs
 * this headless task (min interval 15 min, but the OS decides the actual timing
 * to save battery). It refreshes the read-heavy campus data and writes it back
 * to AsyncStorage, so the app already has fresh data the next time the user
 * opens it — no manual pull-to-refresh required, and without the app running
 * continuously in the foreground.
 *
 * This is opportunistic (best-effort, OS-scheduled), NOT a guaranteed timer.
 * For prompt "your class was cancelled / room shifted" alerts, push
 * notifications are the right mechanism and will be layered on top of this.
 */

export const BACKGROUND_SYNC_TASK = 'fast-utilities-background-sync';

// Define the task at module scope (required — must be registered before any
// component mounts, and runs in a headless JS context).
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    // Fetch and persist each dataset independently so one failure doesn't
    // abort the rest. cache keys must match useCachedData()'s keys exactly.
    await Promise.allSettled([
      fetchFSCTimetable().then((d) => cacheSet('data:timetable:FSC', d)),
      fetchFSMTimetable().then((d) => cacheSet('data:timetable:FSM', d)),
      fetchRegularSchedule().then((d) => cacheSet('data:regular_schedule', d)),
      fetchSummerSchedule().then((d) => cacheSet('data:summer_schedule', d)),
      fetchFaculty().then((d) => cacheSet('data:faculty', d)),
      fetchSemesterCalendar().then((d) => cacheSet('data:semester', d)),
      fetchStudentEvents().then((d) => cacheSet('data:student_events', d)),
    ]);
    // Refresh the home-screen widget from the data we just cached, so it stays
    // current even when the app isn't running (native modules work headless).
    await syncNextClassWidgetFromCache();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    console.error('[background-sync] failed:', err);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Register the background task. Idempotent — safe to call on every app start.
 * No-op where background tasks are restricted (e.g. Expo Go / web).
 */
export async function registerBackgroundSyncAsync(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      console.warn('[background-sync] background tasks unavailable in this environment');
      return;
    }
    const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (!alreadyRegistered) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
        minimumInterval: 15, // minutes — minimum allowed; OS may defer further
      });
    }
  } catch (err) {
    console.error('[background-sync] registration failed:', err);
  }
}

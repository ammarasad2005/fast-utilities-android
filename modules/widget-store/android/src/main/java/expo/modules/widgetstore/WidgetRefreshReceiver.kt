package expo.modules.widgetstore

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import expo.modules.backgroundtask.BackgroundTaskWork

/**
 * Manual refresh trigger fired by tapping the ↻ icon in the widget's header.
 *
 * Two stages, deliberately ordered:
 *
 *  1. INSTANT — WidgetRenderer.refresh() re-paints every placed widget from
 *     the stored snapshot. The countdown is recomputed from the absolute
 *     target epoch, so the tap shows ground-truth time immediately, even
 *     offline, even with the app dead.
 *
 *  2. AUTHORITATIVE — a one-off WorkManager job reuses expo-background-task's
 *     own BackgroundTaskWork so our registered JS headless task runs exactly
 *     as it does for the periodic background sync: it refetches the campus
 *     datasets, recomputes the class status from the persisted timetable
 *     state (tagged schedule, bundles, result prefs, caches) — i.e. the SAME
 *     inputs the in-app card renders from — publishes the new snapshot and
 *     re-renders the widget. Within a few seconds of the tap, the widget
 *     shows precisely what the app would show. appScopeKey for standalone
 *     apps is the application package name (expo-constants source).
 *
 * REPLACE + a unique name unrelated to the scheduler's own identifier means
 * we neither disturb the periodic chain nor stack repeated manual taps.
 *
 * exported=false is correct: the PendingIntent belongs to this app, so the
 * broadcast is delivered as coming from our uid; a custom (non-protected)
 * action must NOT be exported or other apps could fire it.
 */
class WidgetRefreshReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return

    // Stage 1: instant repaint (rolls every family from absolute epochs)
    WidgetRenderer.refresh(context)
    ExamWidgetRenderer.refresh(context)
    SemesterWidgetRenderer.refresh(context)

    // Stage 2: authoritative re-sync through the JS headless task
    enqueueSync(context)
  }

  companion object {
    const val ACTION = "expo.modules.widgetstore.action.MANUAL_REFRESH"
    private const val UNIQUE_WORK = "fast-utilities-widget-manual-sync"

    /**
     * Enqueue the one-off JS sync (same work name as a manual refresh, so
     * repeated kicks dedupe into a single pending job). Safe to call from
     * any code path; failures are swallowed — the paint already happened.
     */
    fun enqueueSync(context: Context) {
      try {
        val data = Data.Builder()
          .putString("appScopeKey", context.packageName)
          .build()
        val constraints = Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build()
        val request = OneTimeWorkRequestBuilder<BackgroundTaskWork>()
          .setInputData(data)
          .setConstraints(constraints)
          // Expedited: a manual tap is a foreground intent from the user's
          // perspective — without this, battery-heavy OEMs (Xiaomi/Oppo/Vivo,
          // Samsung deep-sleep) can defer the JS sync for tens of minutes, so
          // the widget looks "stale despite refresh" on exactly those devices.
          // If the daily expedited quota is exhausted, it silently degrades to
          // the previous plain one-off behavior (never crashes, never drops).
          .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
          .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
          UNIQUE_WORK,
          ExistingWorkPolicy.REPLACE,
          request
        )
      } catch (e: Exception) {
        // non-fatal: rendering never depends on the enqueue succeeding
      }
    }
  }
}

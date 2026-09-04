package expo.modules.widgetstore

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Server-driven "campus data changed" pings (FCM data-only, high priority,
 * topic `campus_updates`, fanned out by the scheduled Cloud Function).
 *
 * onMessageReceived runs even when the process was dead — high-priority data
 * messages wake the app through Doze and OEM battery restrictions, which is
 * exactly the gap behind "notifications only appear when I open the app".
 *
 * Handling mirrors a manual widget refresh tap, deliberately:
 *  1. Repaint every placed widget from the current snapshot (instant, offline-
 *     safe — countdowns recompute from absolute epochs).
 *  2. enqueueSync → expedited one-off BackgroundTaskWork → the existing JS
 *     headless task refetches all datasets, runs the SAME tagged-only, merged-
 *     summary diff (unchanged behavior) and republishes the widgets.
 *
 * The `keys` payload is informational; the local diff remains the authority on
 * what reaches the user. No token ever leaves the device — subscriptions are
 * topic-based only.
 */
class PushMessagingService : FirebaseMessagingService() {

  override fun onMessageReceived(message: RemoteMessage) {
    try {
      Log.i(TAG, "campus update ping: keys=${message.data["keys"]} at=${message.data["at"]}")
      WidgetRenderer.refresh(this)
      ExamWidgetRenderer.refresh(this)
      SemesterWidgetRenderer.refresh(this)
      WidgetRefreshReceiver.enqueueSync(this)
    } catch (e: Exception) {
      Log.w(TAG, "ping handling failed", e)
    }
  }

  override fun onNewToken(token: String) {
    // Tokens are transport details (no server storage of them anywhere);
    // re-ensure the topic subscription after rotation / reinstall.
    PushSetupModule.ensureTopicSubscription()
  }

  private companion object {
    const val TAG = "PushMessaging"
  }
}

package expo.modules.widgetstore

import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * One-call push bootstrap: idempotent subscription to the single broadcast
 * topic `campus_updates` (the Cloud Function fans dataset-change pings there).
 *
 * No per-user topics, no token upload — nothing identifying ever leaves the
 * device, which keeps the privacy story one line long.
 */
class PushSetupModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PushSetup")

    Function("ensureSetup") {
      ensureTopicSubscription()
      true
    }
  }

  companion object {
    const val TOPIC = "campus_updates"
    private const val TAG = "PushSetup"

    /**
     * Safe everywhere: if Firebase isn't configured yet (no
     * google-services.json in the build), the call throws and is swallowed —
     * the app simply falls back to its periodic client-side sync.
     */
    fun ensureTopicSubscription() {
      try {
        FirebaseMessaging.getInstance().subscribeToTopic(TOPIC)
          .addOnCompleteListener { task ->
            if (!task.isSuccessful) Log.w(TAG, "topic subscribe failed", task.exception)
          }
      } catch (e: IllegalStateException) {
        Log.d(TAG, "Firebase not configured in this build; skipping push setup")
      } catch (e: Exception) {
        Log.w(TAG, "push setup failed", e)
      }
    }
  }
}

package expo.modules.widgetstore

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
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

    /** True when the app is already excluded from battery optimization. */
    Function("isBatteryExempt") {
      val ctx = appContext.reactContext ?: return@Function false
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
      pm?.isIgnoringBatteryOptimizations(ctx.packageName) == true
    }

    /**
     * Opens the system "allow unrestricted battery" dialog for this app.
     * Only ever fired from an explicit user tap (More → Fix delayed
     * notifications) — never nagged at startup. Some ROMs reject the direct
     * dialog; those fall back to the app's details page.
     */
    Function("requestBatteryExemption") {
      val ctx = appContext.reactContext ?: return@Function false
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (pm?.isIgnoringBatteryOptimizations(ctx.packageName) == true) return@Function true
      try {
        ctx.startActivity(
          Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:" + ctx.packageName))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        true
      } catch (e: Exception) {
        Log.w(TAG, "direct battery dialog rejected, opening app details", e)
        try {
          ctx.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
              .setData(Uri.parse("package:" + ctx.packageName))
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          )
          true
        } catch (inner: Exception) {
          Log.w(TAG, "battery settings open failed", inner)
          false
        }
      }
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

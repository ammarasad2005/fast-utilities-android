package expo.modules.widgetstore

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Local-notification bridge for class-change alerts.
 *
 * Kept in this local module (instead of pulling in expo-notifications) to keep
 * the dependency set — and APK size — down. It does three things: owns the
 * single "class_changes" notification channel, shows a launcher-tap
 * notification, and asks for POST_NOTIFICATIONS on Android 13+ using the expo
 * permissions runtime (same behavior as the rest of the app's modules).
 */
class NotifierModule : Module() {

  private val channelId = "class_changes"

  /** Lazily create the channel; channel settings are user-owned after creation. */
  private fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(channelId) == null) {
        val channel = NotificationChannel(
          channelId,
          "Class changes",
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          description = "Alerts when your tagged timetable changes — cancellations, reschedules, room moves"
          enableVibration(true)
        }
        manager.createNotificationChannel(channel)
      }
    }
  }

  private fun notificationsAllowed(ctx: Context): Boolean {
    return if (Build.VERSION.SDK_INT >= 33) {
      ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    } else {
      NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    }
  }

  override fun definition() = ModuleDefinition {
    Name("Notifier")

    AsyncFunction("requestNotificationsPermission") { promise: expo.modules.kotlin.Promise ->
      if (Build.VERSION.SDK_INT < 33) {
        val ctx = appContext.reactContext
        val granted = ctx != null && notificationsAllowed(ctx)
        promise.resolve(mapOf("granted" to granted, "status" to if (granted) "granted" else "denied"))
        return@AsyncFunction
      }
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        android.Manifest.permission.POST_NOTIFICATIONS,
      )
    }

    Function("hasNotificationsPermission") {
      val ctx = appContext.reactContext ?: return@Function false
      notificationsAllowed(ctx)
    }

    /**
     * Show a class-change notification. `body` may be multi-line; tapping
     * opens the app's launcher activity. `dedupeId` lets the post replace a
     * still-shown alert for the same change instead of stacking copies.
     */
    Function("notifyClassChange") { title: String, body: String, dedupeId: String ->
      val ctx = appContext.reactContext ?: return@Function false
      if (!notificationsAllowed(ctx)) return@Function false
      ensureChannel(ctx)

      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      val pending = PendingIntent.getActivity(
        ctx,
        dedupeId.hashCode(),
        (launch ?: Intent()).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        },
        PendingIntent.FLAG_UPDATE_CURRENT or
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0,
      )

      val notification = NotificationCompat.Builder(ctx, channelId)
        .setSmallIcon(R.drawable.ic_notification_bell)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setAutoCancel(true)
        .setContentIntent(pending)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .build()

      try {
        NotificationManagerCompat.from(ctx).notify(dedupeId.hashCode(), notification)
        true
      } catch (_: SecurityException) {
        // Race: permission revoked between check and post.
        false
      }
    }
  }
}

package expo.modules.widgetstore

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Manual refresh trigger fired by tapping the ↻ icon in the widget's header.
 *
 * Instantly re-renders every placed variant from the stored snapshot — the
 * countdown is recomputed from the absolute target timestamp, so the tap shows
 * ground-truth time with zero battery/memory overhead between taps.
 *
 * exported=false is correct here: the PendingIntent belongs to this app, so
 * the broadcast is delivered as coming from our uid; a custom (non-protected)
 * action must NOT be exported or it could be spoofed by other apps.
 */
class WidgetRefreshReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == ACTION) WidgetRenderer.refresh(context)
  }

  companion object {
    const val ACTION = "expo.modules.widgetstore.action.MANUAL_REFRESH"
  }
}

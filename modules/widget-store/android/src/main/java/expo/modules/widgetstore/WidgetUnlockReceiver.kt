package expo.modules.widgetstore

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Refresh-on-unlock trigger.
 *
 * ACTION_USER_PRESENT fires whenever the keyguard is dismissed — fingerprint,
 * face, PIN, pattern, or a plain swipe with no security — and is one of the
 * implicit broadcasts Android still delivers to manifest receivers, so this
 * works even when the app process is completely dead (no service, no battery
 * cost beyond one cheap re-render).
 *
 * Each refresh recomputes the countdown from the absolute target timestamp,
 * so a single render instantly shows exact, current truth. The phone's most
 * natural "eyes on home screen" moment therefore always meets a fresh widget.
 *
 * exported="true" is safe here: USER_PRESENT is a *protected* broadcast —
 * only the system can send it; third-party senders get a SecurityException.
 */
class WidgetUnlockReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_USER_PRESENT) {
      WidgetRenderer.refresh(context)
      ExamWidgetRenderer.refresh(context)
      SemesterWidgetRenderer.refresh(context)
    }
  }
}

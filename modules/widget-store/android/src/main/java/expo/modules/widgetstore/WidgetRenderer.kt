package expo.modules.widgetstore

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Renders the last-published JS snapshot into RemoteViews for any placed
 * instance of any widget variant.
 *
 * The countdown text is recomputed from the absolute target timestamp on
 * every render, so between OS ticks (30 min) and app pokes the widget shows
 * the freshest value of the last render — never a wrong value.
 *
 * IMPORTANT: RemoteViews actions targeting a view id that does not exist in
 * the layout throw at apply-time in the launcher. Compact layout therefore
 * only receives the ids it declares (root/header/course/countdown).
 */
object WidgetRenderer {

  // Picker/launcher data
  private const val PREFS = "fastutilities_widget"
  private const val KEY_SNAPSHOT = "next_class_snapshot"

  // ── Palette (navy glass surface) ──────────────────────────────────────────
  private const val C_HEADER_NEXT = 0xFFFFC24B.toInt() // amber
  private const val C_HEADER_ONGOING = 0xFF6EE7B7.toInt() // emerald
  private const val C_COURSE = 0xFFFFFFFF.toInt()
  private const val C_META = 0xFFB9C6D8.toInt()
  private const val C_COUNTDOWN_NEXT = 0xFFA9CCFF.toInt() // light brand blue
  private const val C_COUNTDOWN_ONGOING = 0xFF6EE7B7.toInt()
  private const val C_SUB = 0xFF93A5BF.toInt()
  private const val C_EXTRA = 0xFFFFC24B.toInt()
  private const val C_EMPTY_TITLE = 0xFFE8EDF5.toInt()
  private const val C_EMPTY_SUB = 0xFF93A5BF.toInt()

  /** Re-render every placed instance of every variant (called after each publish). */
  fun refresh(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    for (cls in BaseNextClassWidgetProvider.PROVIDERS) {
      val ids = manager.getAppWidgetIds(ComponentName(context, cls))
      for (id in ids) {
        val opts = manager.getAppWidgetOptions(id)
        val w = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
        val h = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
        val fallback = layoutFor(cls)
        render(context, manager, id, layoutFor(w, h, fallback))
      }
    }
  }

  private fun layoutFor(cls: Class<*>): Int = when (cls) {
    NextClassWidgetCompactProvider::class.java -> R.layout.widget_compact
    NextClassWidgetWideProvider::class.java -> R.layout.widget_next_class
    NextClassWidgetLargeProvider::class.java -> R.layout.widget_large
    else -> R.layout.widget_next_class
  }

  /**
   * Size-class bucketing (grid dp: 2 cols ≈ 110dp, 3 ≈ 180, 4 ≈ 250;
   * 4 rows ≈ 250dp tall). Under ~3 columns → compact; 4 cols + 4 rows → large.
   */
  fun layoutFor(minWidthDp: Int, minHeightDp: Int, fallback: Int): Int {
    if (minWidthDp in 1..159) return R.layout.widget_compact
    if (minWidthDp >= 230 && minHeightDp >= 200) return R.layout.widget_large
    return fallback
  }

  fun render(context: Context, manager: AppWidgetManager, widgetId: Int, layoutId: Int) {
    val views = RemoteViews(context.packageName, layoutId)
    val full = layoutId != R.layout.widget_compact

    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SNAPSHOT, null)
    val snap = raw?.let { runCatching { JSONObject(it) }.getOrNull() }

    if (snap == null) {
      renderEmpty(views, full, "No class data yet", "Open the app once to start tracking.")
    } else {
      when (snap.optString("state")) {
        "ongoing" -> renderClass(views, full, snap, ongoing = true)
        "next" -> renderClass(views, full, snap, ongoing = false)
        "needsTag" -> renderEmpty(views, full, "Tag your timetable", "Home → Timetable tab → Tag as my timetable.")
        else -> renderEmpty(views, full, "No upcoming classes", "Nothing scheduled for your tagged timetable.")
      }
    }

    // Tap anywhere → open the app
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launchIntent ->
      launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val pi = PendingIntent.getActivity(
        context, 0, launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      views.setOnClickPendingIntent(R.id.widget_root, pi)
    }

    // ↻ icon → instant manual refresh (re-render in place, no app launch)
    val refreshIntent = Intent(WidgetRefreshReceiver.ACTION)
      .setComponent(ComponentName(context, WidgetRefreshReceiver::class.java))
    val refreshPi = PendingIntent.getBroadcast(
      context, 1, refreshIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    views.setOnClickPendingIntent(R.id.widget_refresh, refreshPi)

    manager.updateAppWidget(widgetId, views)
  }

  private fun renderClass(views: RemoteViews, full: Boolean, snap: JSONObject, ongoing: Boolean) {
    val now = System.currentTimeMillis()
    val target = snap.optLong("targetEpochMs", 0L)
    val deltaMin = ((target - now) / 60000L).toInt()

    views.setTextViewText(R.id.widget_header, if (ongoing) "ONGOING NOW" else "NEXT UP")
    views.setTextColor(R.id.widget_header, if (ongoing) C_HEADER_ONGOING else C_HEADER_NEXT)
    views.setTextViewText(R.id.widget_course, snap.optString("course", "—"))
    views.setTextColor(R.id.widget_course, C_COURSE)

    val countdown: String
    if (ongoing) {
      countdown = "${formatDuration(deltaMin.coerceAtLeast(0))} left"
    } else {
      countdown = if (deltaMin <= 0) "starting now" else "in ${formatDuration(deltaMin)}"
    }
    views.setTextViewText(R.id.widget_countdown, countdown)
    views.setTextColor(R.id.widget_countdown, if (ongoing) C_COUNTDOWN_ONGOING else C_COUNTDOWN_NEXT)

    // meta + sub exist in every layout; compact uses the time-only sub
    views.setTextViewText(R.id.widget_meta, snap.optString("meta", ""))
    views.setTextColor(R.id.widget_meta, C_META)
    views.setTextViewText(
      R.id.widget_sub,
      if (full) snap.optString("sub", "") else snap.optString("subTime", snap.optString("sub", ""))
    )
    views.setTextColor(R.id.widget_sub, C_SUB)

    if (full) {
      if (ongoing) {
        val totalMin = snap.optInt("totalMin", 0).coerceAtLeast(1)
        val donePct = (((totalMin - deltaMin.coerceAtLeast(0)).toFloat() / totalMin) * 100)
          .toInt().coerceIn(0, 100)
        views.setProgressBar(R.id.widget_progress, 100, donePct, false)
        views.setViewVisibility(R.id.widget_progress, View.VISIBLE)
      } else {
        views.setViewVisibility(R.id.widget_progress, View.GONE)
      }

      val extra = snap.optInt("extra", 0)
      if (extra > 0) {
        views.setTextViewText(R.id.widget_extra, "+$extra more at this time")
        views.setTextColor(R.id.widget_extra, C_EXTRA)
        views.setViewVisibility(R.id.widget_extra, View.VISIBLE)
      } else {
        views.setViewVisibility(R.id.widget_extra, View.GONE)
      }
    }
  }

  private fun renderEmpty(views: RemoteViews, full: Boolean, title: String, subtitle: String) {
    views.setTextViewText(R.id.widget_header, "CLASSES")
    views.setTextColor(R.id.widget_header, C_EMPTY_SUB)
    views.setTextViewText(R.id.widget_course, title)
    views.setTextColor(R.id.widget_course, C_EMPTY_TITLE)
    views.setTextViewText(R.id.widget_countdown, "")
    views.setTextViewText(R.id.widget_meta, "")
    views.setTextViewText(R.id.widget_sub, subtitle)
    views.setTextColor(R.id.widget_sub, C_EMPTY_SUB)
    if (full) {
      views.setViewVisibility(R.id.widget_progress, View.GONE)
      views.setViewVisibility(R.id.widget_extra, View.GONE)
    }
  }

  /** "Xm" / "Xh Ym" / "Xd Yh" — same shape as the app's formatDuration. */
  private fun formatDuration(totalMin: Int): String {
    var mins = totalMin
    if (mins < 0) mins = 0
    val d = mins / (24 * 60)
    val h = (mins % (24 * 60)) / 60
    val m = mins % 60
    return when {
      d > 0 -> if (m == 0) "${d}d ${h}h" else "${d}d ${h}h ${m}m"
      h > 0 -> if (m == 0) "${h}h" else "${h}h ${m}m"
      else -> "${m}m"
    }
  }
}

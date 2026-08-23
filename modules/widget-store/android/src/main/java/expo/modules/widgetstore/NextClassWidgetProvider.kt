package expo.modules.widgetstore

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Home-screen widget: next / ongoing class tracker.
 *
 * JS computes the authoritative status (the same engine as the in-app card)
 * and publishes a small JSON snapshot into SharedPreferences. This provider
 * renders it with RemoteViews and recomputes the countdown from the absolute
 * target timestamp at every render, so between OS update ticks the text stays
 * as fresh as the last render (OS tick = 30 min; the app also pokes us on
 * every foreground compute and background data sync).
 */
class NextClassWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) updateOne(context, appWidgetManager, id)
  }

  companion object {
    private const val PREFS = "fastutilities_widget"
    private const val KEY_SNAPSHOT = "next_class_snapshot"

    /** Re-render all placed widgets (called by the module after each publish). */
    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, NextClassWidgetProvider::class.java))
      for (id in ids) updateOne(context, manager, id)
    }

    private fun updateOne(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val views = RemoteViews(context.packageName, R.layout.widget_next_class)

      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SNAPSHOT, null)
      val snap = raw?.let { runCatching { JSONObject(it) }.getOrNull() }

      if (snap == null) {
        renderEmpty(context, views, "No class data yet", "Open the app once to start tracking.")
      } else {
        when (snap.optString("state")) {
          "ongoing" -> renderClass(context, views, snap, ongoing = true)
          "next" -> renderClass(context, views, snap, ongoing = false)
          "needsTag" -> renderEmpty(context, views, "Tag your timetable", "Home → Timetable tab → Tag as my timetable.")
          else -> renderEmpty(context, views, "No upcoming classes", "Nothing scheduled for your tagged timetable.")
        }
      }

      // Tap anywhere → open the app
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      if (launchIntent != null) {
        launchIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pi = PendingIntent.getActivity(
          context, 0, launchIntent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, pi)
      }

      manager.updateAppWidget(widgetId, views)
    }

    private fun renderClass(context: Context, views: RemoteViews, snap: JSONObject, ongoing: Boolean) {
      val now = System.currentTimeMillis()
      val target = snap.optLong("targetEpochMs", 0L)
      val deltaMin = ((target - now) / 60000L).toInt()

      views.setTextViewText(R.id.widget_header, if (ongoing) "ONGOING NOW" else "NEXT UP")
      views.setTextColor(R.id.widget_header, if (ongoing) 0xFF059669.toInt() else 0xFFB45309.toInt())
      views.setTextViewText(R.id.widget_course, snap.optString("course", "—"))
      views.setTextViewText(R.id.widget_meta, snap.optString("meta", ""))

      val countdown: String
      if (ongoing) {
        countdown = "${formatDuration(deltaMin.coerceAtLeast(0))} left"
        val totalMin = snap.optInt("totalMin", 0).coerceAtLeast(1)
        val donePct = (((totalMin - deltaMin.coerceAtLeast(0)).toFloat() / totalMin) * 100).toInt().coerceIn(0, 100)
        views.setProgressBar(R.id.widget_progress, 100, donePct, false)
        views.setViewVisibility(R.id.widget_progress, View.VISIBLE)
      } else {
        countdown = if (deltaMin <= 0) "starting now" else "in ${formatDuration(deltaMin)}"
        views.setViewVisibility(R.id.widget_progress, View.GONE)
      }
      views.setTextViewText(R.id.widget_countdown, countdown)
      views.setTextColor(R.id.widget_countdown, if (ongoing) 0xFF059669.toInt() else 0xFF073366.toInt())
      views.setTextViewText(R.id.widget_sub, snap.optString("sub", ""))

      val extra = snap.optInt("extra", 0)
      if (extra > 0) {
        views.setTextViewText(R.id.widget_extra, "+$extra more at this time")
        views.setViewVisibility(R.id.widget_extra, View.VISIBLE)
      } else {
        views.setViewVisibility(R.id.widget_extra, View.GONE)
      }
    }

    private fun renderEmpty(context: Context, views: RemoteViews, title: String, subtitle: String) {
      views.setTextViewText(R.id.widget_header, "CLASSES")
      views.setTextColor(R.id.widget_header, 0xFF8A8A82.toInt())
      views.setTextViewText(R.id.widget_course, title)
      views.setTextViewText(R.id.widget_meta, "")
      views.setTextViewText(R.id.widget_countdown, "")
      views.setTextViewText(R.id.widget_sub, subtitle)
      views.setViewVisibility(R.id.widget_progress, View.GONE)
      views.setViewVisibility(R.id.widget_extra, View.GONE)
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
}

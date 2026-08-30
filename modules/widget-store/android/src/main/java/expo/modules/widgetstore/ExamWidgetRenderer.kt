package expo.modules.widgetstore

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

/**
 * Renders the exam snapshot ("exam_snapshot") into the exam widget layout
 * (Next Exam — the countdown is an inherent part of it, user decision).
 *
 * The snapshot ships a CHRONOLOGICAL list of upcoming personal exams with
 * absolute start/end epochs. Every render derives next-vs-ongoing from
 * `System.currentTimeMillis()` directly, so the widget rolls across midnight
 * and across exams with zero JS — same self-healing contract as the
 * next-class widget. Stale snapshots (>15 min) kick the JS re-sync the same
 * way (deduped unique work).
 *
 * Category identity (user decision): EXAMS = AMBER — bronze/amber glass
 * background (@drawable/widget_bg_exam) with amber accents, distinct from
 * timetable (blue) and semester (emerald).
 */
object ExamWidgetRenderer {

  private const val PREFS = "fastutilities_widget"
  private const val KEY_SNAPSHOT = "exam_snapshot"
  private const val STALE_MS = 15L * 60L * 1000L

  // ── Palette (amber identity on the bronze glass surface) ─────────────────
  private const val C_ACCENT = 0xFFFFC24B.toInt() // amber — category color
  private const val C_ACCENT_SOFT = 0xFFFFD98A.toInt() // lighter gold (ongoing countdown)
  private const val C_COURSE = 0xFFFFFFFF.toInt()
  private const val C_META = 0xFFB9C6D8.toInt()
  private const val C_SUB = 0xFF93A5BF.toInt()
  private const val C_EMPTY_TITLE = 0xFFE8EDF5.toInt()
  private const val C_EMPTY_SUB = 0xFF93A5BF.toInt()

  private class Item {
    var course: String = ""
    var code: String = ""
    var dateLabel: String = ""
    var timeLabel: String = ""
    var startMs: Long = 0
    var endMs: Long = 0
    var room: String = ""

    constructor(j: JSONObject) {
      course = j.optString("course")
      code = j.optString("code")
      dateLabel = j.optString("dateLabel")
      timeLabel = j.optString("timeLabel")
      startMs = j.optLong("startEpochMs", 0L)
      endMs = j.optLong("endEpochMs", 0L)
      room = j.optString("room")
    }
  }

  /** Re-render every placed exam widget (called after each publish + refresh taps). */
  fun refresh(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    for (cls in BaseExamWidgetProvider.PROVIDERS) {
      val ids = manager.getAppWidgetIds(ComponentName(context, cls))
      for (id in ids) {
        render(context, manager, id, BaseExamWidgetProvider.layoutFor(cls))
      }
    }
  }

  fun render(context: Context, manager: AppWidgetManager, widgetId: Int, layoutId: Int) {
    val views = RemoteViews(context.packageName, layoutId)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val raw = prefs.getString(KEY_SNAPSHOT, null)
    val snap = raw?.let { runCatching { JSONObject(it) }.getOrNull() }

    if (snap == null) {
      renderEmpty(views, "No exam data yet", "Open the app once to start tracking.")
    } else {
      val updatedAt = snap.optLong("updatedAt", 0L)
      if (updatedAt > 0 && System.currentTimeMillis() - updatedAt > STALE_MS) {
        WidgetRefreshReceiver.enqueueSync(context)
      }
      val now = System.currentTimeMillis()
      when (snap.optString("state")) {
        "ok" -> {
          val items = parseItems(snap)
          val cur = items.firstOrNull { it.endMs >= now }
          if (cur == null) {
            renderEmpty(views, "All exams done", "Nothing left this schedule. 🎓")
          } else {
            renderOk(views, cur, now)
          }
        }
        "needsTag" -> renderEmpty(
          views, "Tag your exams",
          "Exams tab → bookmark a selection, or keep a custom exam schedule as preference."
        )
        "hidden" -> renderEmpty(
          views, "Exams not published",
          "The exam schedule is currently hidden."
        )
        else -> renderEmpty(
          views, "No upcoming exams",
          "Nothing upcoming for your tagged exams."
        )
      }
    }

    // Tap anywhere → open the app
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launchIntent ->
      launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val pi = PendingIntent.getActivity(
        context, 10, launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      views.setOnClickPendingIntent(R.id.widget_root, pi)
    }

    // ↻ icon → instant manual refresh
    val refreshIntent = Intent(WidgetRefreshReceiver.ACTION)
      .setComponent(ComponentName(context, WidgetRefreshReceiver::class.java))
    val refreshPi = PendingIntent.getBroadcast(
      context, 11, refreshIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    views.setOnClickPendingIntent(R.id.widget_refresh, refreshPi)

    manager.updateAppWidget(widgetId, views)
  }

  private fun parseItems(snap: JSONObject): List<Item> {
    val out = ArrayList<Item>()
    val arr: JSONArray? = snap.optJSONArray("items")
    if (arr != null) for (i in 0 until arr.length()) {
      arr.optJSONObject(i)?.let { out.add(Item(it)) }
    }
    out.sortBy { it.startMs }
    return out
  }

  // ── Next Exam rendering ──────────────────────────────────────────────────

  private fun renderOk(views: RemoteViews, cur: Item, now: Long) {
    val ongoing = now >= cur.startMs
    views.setTextViewText(R.id.exam_header, if (ongoing) "ONGOING EXAM" else "NEXT EXAM")
    views.setTextColor(R.id.exam_header, C_ACCENT)
    views.setTextViewText(R.id.exam_course, cur.course.ifEmpty { cur.code })
    views.setTextColor(R.id.exam_course, C_COURSE)
    val meta = buildString {
      append(cur.code)
      if (cur.room.isNotEmpty() && cur.room != "TBA") append(" · ").append(cur.room)
    }
    views.setTextViewText(R.id.exam_meta, meta)
    views.setTextColor(R.id.exam_meta, C_META)
    if (ongoing) {
      val rem = (((cur.endMs - now) / 60_000L).toInt()).coerceAtLeast(0)
      views.setTextViewText(R.id.exam_countdown, "${formatDuration(rem)} left")
      views.setTextColor(R.id.exam_countdown, C_ACCENT_SOFT)
      val total = (cur.endMs - cur.startMs).coerceAtLeast(1)
      val pct = (((now - cur.startMs).toFloat() / total) * 100).toInt().coerceIn(0, 100)
      views.setProgressBar(R.id.exam_progress, 100, pct, false)
      views.setViewVisibility(R.id.exam_progress, View.VISIBLE)
    } else {
      val delta = ((cur.startMs - now) / 60_000L).toInt()
      views.setTextViewText(
        R.id.exam_countdown,
        if (delta <= 0) "starting now" else "in ${formatDuration(delta)}"
      )
      views.setTextColor(R.id.exam_countdown, C_ACCENT)
      views.setViewVisibility(R.id.exam_progress, View.GONE)
    }
    views.setTextViewText(R.id.exam_sub, "${cur.dateLabel} · ${cur.timeLabel}")
    views.setTextColor(R.id.exam_sub, C_SUB)
  }

  private fun renderEmpty(views: RemoteViews, title: String, subtitle: String) {
    views.setTextViewText(R.id.exam_header, "EXAMS")
    views.setTextColor(R.id.exam_header, C_EMPTY_SUB)
    views.setTextViewText(R.id.exam_course, title)
    views.setTextColor(R.id.exam_course, C_EMPTY_TITLE)
    views.setTextViewText(R.id.exam_meta, "")
    views.setTextViewText(R.id.exam_countdown, "")
    views.setTextViewText(R.id.exam_sub, subtitle)
    views.setTextColor(R.id.exam_sub, C_EMPTY_SUB)
    views.setViewVisibility(R.id.exam_progress, View.GONE)
  }

  /** "Xm" / "Xh Ym" / "Xd Yh" — same shape as WidgetRenderer's. */
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

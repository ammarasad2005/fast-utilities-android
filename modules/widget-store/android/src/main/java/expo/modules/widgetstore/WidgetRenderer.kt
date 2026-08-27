package expo.modules.widgetstore

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/**
 * Renders the last-published JS snapshot into RemoteViews for any placed
 * instance of any widget variant.
 *
 * The snapshot carries absolute epochs plus a `followup` queue (the ~3
 * classes after the primary). Every render — OS tick, unlock, manual ↻ —
 * walks that queue JS-free:
 *
 *   • class ended      → adopt the next follow-up (real next class shown,
 *                        never a frozen "0m left")
 *   • next started     → shown as ongoing with remaining time and progress
 *                        (never a frozen "starting now")
 *   • nothing left     → neutral "updating…" while a background re-sync is
 *                        kicked (deduped by WorkManager's unique-work name)
 *
 * IMPORTANT: RemoteViews actions targeting a view id that does not exist in
 * the layout throw at apply-time in the launcher. Compact layout therefore
 * only receives the ids it declares (root/header/course/meta/sub/countdown).
 */
object WidgetRenderer {

  // Picker/launcher data
  private const val PREFS = "fastutilities_widget"
  private const val KEY_SNAPSHOT = "next_class_snapshot"
  /** Re-kick the JS sync when the snapshot is older than this. */
  private const val STALE_MS = 15L * 60L * 1000L

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

  private class Snapshot {
    var state: String = "none"
    var course: String = ""
    var meta: String = ""
    var sub: String = ""
    var subTime: String = ""
    var targetMs: Long = 0 // ongoing: class end; next: class start
    var totalMin: Int = 0
    var extra: Int = 0

    constructor()

    constructor(j: JSONObject) {
      state = j.optString("state")
      course = j.optString("course")
      meta = j.optString("meta")
      sub = j.optString("sub")
      subTime = j.optString("subTime", j.optString("sub"))
      targetMs = j.optLong("targetEpochMs", 0L)
      // legacy snapshots only carried totalMin on ongoing; default keeps parity
      totalMin = j.optInt("totalMin", 1).coerceAtLeast(1)
      extra = j.optInt("extra", 0)
    }

    val isClass: Boolean get() = state == "next" || state == "ongoing"
    val startMs: Long get() = if (state == "next") targetMs else targetMs - totalMin * 60_000L
    val endMs: Long get() = if (state == "next") targetMs + totalMin * 60_000L else targetMs
  }

  /** Re-render every placed instance of every variant (called after each publish). */
  fun refresh(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    for (cls in BaseNextClassWidgetProvider.PROVIDERS) {
      val ids = manager.getAppWidgetIds(ComponentName(context, cls))
      for (id in ids) {
        val opts = manager.getAppWidgetOptions(id)
        val w = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
        val h = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
        // The host may hand an empty options bundle while cold (launcher
        // restart / long idle) — fall back to the bucket persisted on the
        // last render so the layout can never silently shrink classes.
        val persisted = prefs.getInt("bucket_$id", 0)
        val fallback = if (persisted != 0) persisted else layoutFor(cls)
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

  /** Current on-screen choice for the fragment of the snapshot chain in view. */
  private fun rollForward(snap: JSONObject, now: Long): Snapshot {
    var cur = Snapshot(snap)
    fun pushQueue(): ArrayDeque<Snapshot> {
      val q = ArrayDeque<Snapshot>()
      val arr: JSONArray? = snap.optJSONArray("followup")
      if (arr != null) for (i in 0 until arr.length()) {
        arr.optJSONObject(i)?.let { q.add(Snapshot(it)) }
      }
      return q
    }
    val queue = pushQueue()
    var guard = 0
    while (cur.isClass && now >= cur.endMs && queue.isNotEmpty() && guard < 8) {
      cur = queue.removeFirst()
      guard++
    }
    return cur
  }

  fun render(context: Context, manager: AppWidgetManager, widgetId: Int, layoutId: Int) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit().putInt("bucket_$widgetId", layoutId).apply()

    val views = RemoteViews(context.packageName, layoutId)
    val full = layoutId != R.layout.widget_compact

    val raw = prefs.getString(KEY_SNAPSHOT, null)
    val snap = raw?.let { runCatching { JSONObject(it) }.getOrNull() }

    if (snap == null) {
      renderEmpty(views, full, "No class data yet", "Open the app once to start tracking.")
    } else {
      // Proactively re-arm the JS sync when the snapshot looks old — the
      // widget then self-heals even if the periodic chain is device-throttled.
      val updatedAt = snap.optLong("updatedAt", 0L)
      if (updatedAt > 0 && System.currentTimeMillis() - updatedAt > STALE_MS) {
        WidgetRefreshReceiver.enqueueSync(context)
      }
      val now = System.currentTimeMillis()
      when (snap.optString("state")) {
        "ongoing", "next" -> {
          val rolled = rollForward(snap, now)
          val expired = rolled.isClass && now >= rolled.endMs
          when {
            rolled.state == "needsTag" ->
              renderEmpty(views, full, "Tag your timetable", "Home → Timetable tab → Tag as my timetable.")
            !rolled.isClass ->
              renderEmpty(views, full, "No upcoming classes", "Nothing scheduled for your tagged timetable.")
            expired -> {
              // primary + follow-ups all passed and JS hasn't republished yet
              WidgetRefreshReceiver.enqueueSync(context)
              renderClass(
                views, full, rolled, ongoing = true, now = now, subOverride = null, updating = true
              )
            }
            rolled.state == "ongoing" ->
              renderClass(views, full, rolled, ongoing = true, now = now, subOverride = null)
            now < rolled.startMs ->
              renderClass(views, full, rolled, ongoing = false, now = now, subOverride = null)
            else -> renderClass(
              views, full, rolled, ongoing = true, now = now,
              subOverride = "ends " + fmt12(rolled.endMs)
            )
          }
        }
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

  private fun renderClass(
    views: RemoteViews,
    full: Boolean,
    s: Snapshot,
    ongoing: Boolean,
    now: Long,
    subOverride: String?,
    updating: Boolean = false
  ) {
    views.setTextViewText(R.id.widget_header, if (ongoing) "ONGOING NOW" else "NEXT UP")
    views.setTextColor(R.id.widget_header, if (ongoing) C_HEADER_ONGOING else C_HEADER_NEXT)
    views.setTextViewText(R.id.widget_course, s.course.ifEmpty { "—" })
    views.setTextColor(R.id.widget_course, C_COURSE)

    val countdown: String
    if (updating) {
      countdown = "updating…"
    } else if (ongoing) {
      val rem = (((s.endMs - now) / 60000L).toInt()).coerceAtLeast(0)
      countdown = "${formatDuration(rem)} left"
    } else {
      val delta = ((s.targetMs - now) / 60000L).toInt()
      countdown = if (delta <= 0) "starting now" else "in ${formatDuration(delta)}"
    }
    views.setTextViewText(R.id.widget_countdown, countdown)
    views.setTextColor(R.id.widget_countdown, if (ongoing || updating) C_COUNTDOWN_ONGOING else C_COUNTDOWN_NEXT)

    // meta + sub exist in every layout; compact uses the time-only sub
    views.setTextViewText(R.id.widget_meta, s.meta)
    views.setTextColor(R.id.widget_meta, C_META)
    views.setTextViewText(R.id.widget_sub, subOverride ?: (if (full) s.sub else s.subTime))
    views.setTextColor(R.id.widget_sub, C_SUB)

    if (full) {
      if (ongoing && !updating) {
        val totalMin = s.totalMin.coerceAtLeast(1)
        val rem = (((s.endMs - now) / 60000L).toInt()).coerceAtLeast(0)
        val donePct = (((totalMin - rem).toFloat() / totalMin) * 100).toInt().coerceIn(0, 100)
        views.setProgressBar(R.id.widget_progress, 100, donePct, false)
        views.setViewVisibility(R.id.widget_progress, View.VISIBLE)
      } else {
        views.setViewVisibility(R.id.widget_progress, View.GONE)
      }

      if (s.extra > 0) {
        views.setTextViewText(R.id.widget_extra, "+${s.extra} more at this time")
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

  /** "hh:mm a" local — matches JS formatSlotEnd/formatSlotStart. */
  private fun fmt12(epochMs: Long): String =
    SimpleDateFormat("hh:mm a", Locale.US).format(Date(epochMs))

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

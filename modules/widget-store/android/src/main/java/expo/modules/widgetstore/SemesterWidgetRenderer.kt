package expo.modules.widgetstore

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/**
 * Renders the semester snapshot ("semester_snapshot") into the three semester
 * widget layouts (milestone countdown / live timeline / month card).
 *
 * Timeline and Month are painted with a software Canvas → Bitmap → ImageView:
 * RemoteViews can't draw arbitrary dot timelines or calendar grids, but a
 * bitmap can carry any composition the data needs. RGB_565 keeps the binder
 * budget in check (~250KB per paint, well under the limit).
 *
 * All countdowns/positions derive from absolute epochs at render time, so the
 * widgets cross midnight JS-free (unlock/hourly/manual re-render).
 */
object SemesterWidgetRenderer {

  private const val PREFS = "fastutilities_widget"
  private const val KEY_SNAPSHOT = "semester_snapshot"
  private const val STALE_MS = 15L * 60L * 1000L
  private const val DAY_MS = 86_400_000L

  // ── Palette (navy-glass, shared with the other families) ─────────────────
  private const val C_TEXT = 0xFFFFFFFF.toInt()
  private const val C_META = 0xFFB9C6D8.toInt()
  private const val C_SUB = 0xFF93A5BF.toInt()
  private const val C_BRAND = 0xFFA9CCFF.toInt()
  private const val C_AMBER = 0xFFFFC24B.toInt()
  private const val C_EMERALD = 0xFF6EE7B7.toInt()
  private const val C_TRACK = 0xFF33415C.toInt()
  private const val C_EMPTY_TITLE = 0xFFE8EDF5.toInt()
  private const val C_EMPTY_SUB = 0xFF93A5BF.toInt()

  private class Milestone {
    var label: String = ""
    var shortLabel: String = ""
    var epochMs: Long = 0
    var pct: Double = 0.0

    constructor(j: JSONObject) {
      label = j.optString("label")
      shortLabel = j.optString("shortLabel")
      epochMs = j.optLong("epochMs", 0L)
      pct = j.optDouble("pct", 0.0)
    }
  }

  /** Re-render every placed semester widget (called after each publish + refresh taps). */
  fun refresh(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    for (cls in BaseSemesterWidgetProvider.PROVIDERS) {
      val ids = manager.getAppWidgetIds(ComponentName(context, cls))
      for (id in ids) {
        render(context, manager, id, BaseSemesterWidgetProvider.layoutFor(cls))
      }
    }
  }

  fun render(context: Context, manager: AppWidgetManager, widgetId: Int, layoutId: Int) {
    val views = RemoteViews(context.packageName, layoutId)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val raw = prefs.getString(KEY_SNAPSHOT, null)
    val snap = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
    val now = System.currentTimeMillis()

    if (snap == null || snap.optString("state") != "ok") {
      renderEmpty(views, layoutId, "No semester data", "Open the app once to load the calendar.")
    } else {
      val updatedAt = snap.optLong("updatedAt", 0L)
      if (updatedAt > 0 && now - updatedAt > STALE_MS) {
        WidgetRefreshReceiver.enqueueSync(context)
      }
      val name = snap.optString("name")
      val startMs = snap.optLong("startEpochMs", 0L)
      val endMs = snap.optLong("endEpochMs", 0L)
      val milestones = parseMilestones(snap)
      val examDays = parseExamDays(snap)
      when (layoutId) {
        R.layout.widget_semester_countdown ->
          renderCountdown(views, milestones, name, now)
        R.layout.widget_semester_timeline ->
          renderTimeline(views, name, startMs, endMs, milestones, now)
        else ->
          renderMonth(views, examDays, now)
      }
    }

    // Tap anywhere → open the app
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launchIntent ->
      launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val pi = PendingIntent.getActivity(
        context, 20, launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      views.setOnClickPendingIntent(R.id.widget_root, pi)
    }

    // ↻ icon → instant manual refresh
    val refreshIntent = Intent(WidgetRefreshReceiver.ACTION)
      .setComponent(ComponentName(context, WidgetRefreshReceiver::class.java))
    val refreshPi = PendingIntent.getBroadcast(
      context, 21, refreshIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    views.setOnClickPendingIntent(R.id.widget_refresh, refreshPi)

    manager.updateAppWidget(widgetId, views)
  }

  private fun parseMilestones(snap: JSONObject): List<Milestone> {
    val out = ArrayList<Milestone>()
    val arr: JSONArray? = snap.optJSONArray("milestones")
    if (arr != null) for (i in 0 until arr.length()) {
      arr.optJSONObject(i)?.let { out.add(Milestone(it)) }
    }
    out.sortBy { it.epochMs }
    return out
  }

  private fun parseExamDays(snap: JSONObject): Set<Long> {
    val out = HashSet<Long>()
    val arr: JSONArray? = snap.optJSONArray("examDays")
    if (arr != null) for (i in 0 until arr.length()) out.add(arr.optLong(i, 0L))
    out.remove(0L)
    return out
  }

  // ── Milestone countdown ──────────────────────────────────────────────────

  private fun renderCountdown(views: RemoteViews, milestones: List<Milestone>, name: String, now: Long) {
    views.setTextViewText(R.id.sem_header, "SEMESTER")
    views.setTextColor(R.id.sem_header, C_AMBER)
    val next = milestones.firstOrNull { it.epochMs >= todayAligned(now) }
    if (next == null) {
      views.setTextViewText(R.id.sem_big, "DONE")
      views.setTextColor(R.id.sem_big, C_EMERALD)
      views.setTextViewText(R.id.sem_unit, "semester complete 🎓")
      views.setTextViewText(R.id.sem_milestone, name)
      views.setTextViewText(R.id.sem_date, "")
      return
    }
    val days = ((next.epochMs - todayAligned(now)) / DAY_MS).toInt()
    when {
      days <= 0 -> {
        views.setTextViewText(R.id.sem_big, "TODAY")
        views.setTextColor(R.id.sem_big, C_EMERALD)
        views.setTextViewText(R.id.sem_unit, "")
      }
      days == 1 -> {
        views.setTextViewText(R.id.sem_big, "1")
        views.setTextColor(R.id.sem_big, C_BRAND)
        views.setTextViewText(R.id.sem_unit, "day until")
      }
      else -> {
        views.setTextViewText(R.id.sem_big, days.toString())
        views.setTextColor(R.id.sem_big, C_BRAND)
        views.setTextViewText(R.id.sem_unit, "days until")
      }
    }
    views.setTextViewText(R.id.sem_milestone, next.label.ifEmpty { next.shortLabel })
    views.setTextColor(R.id.sem_milestone, C_TEXT)
    views.setTextViewText(R.id.sem_date, fmtDay(next.epochMs))
    views.setTextColor(R.id.sem_date, C_SUB)
  }

  // ── Live timeline (canvas) ───────────────────────────────────────────────

  private fun renderTimeline(
    views: RemoteViews,
    name: String,
    startMs: Long,
    endMs: Long,
    milestones: List<Milestone>,
    now: Long
  ) {
    val span = (endMs - startMs).coerceAtLeast(1)
    val pctNow = (((now - startMs).toDouble() / span) * 100.0).coerceIn(0.0, 100.0)
    val dayIdx = (((todayAligned(now) - startMs) / DAY_MS) + 1).coerceAtLeast(1)
    val totalDays = ((span / DAY_MS) + 1).coerceAtLeast(1)

    val bmp = drawTimeline(720, 190, milestones, pctNow, now)
    views.setImageViewBitmap(R.id.sem_timeline, bmp)
    views.setViewVisibility(R.id.sem_timeline, View.VISIBLE)

    views.setTextViewText(R.id.sem_header, "SEMESTER TIMELINE")
    views.setTextColor(R.id.sem_header, C_AMBER)
    views.setTextViewText(R.id.sem_progress_pct, "${pctNow.toInt()}%")
    views.setTextColor(R.id.sem_progress_pct, C_BRAND)
    views.setTextViewText(
      R.id.sem_status,
      if (name.isEmpty()) "Day $dayIdx of $totalDays" else "Day $dayIdx of $totalDays · $name"
    )
    views.setTextColor(R.id.sem_status, C_META)
  }

  private fun drawTimeline(w: Int, h: Int, milestones: List<Milestone>, pctNow: Double, now: Long): Bitmap {
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565)
    val c = Canvas(bmp)
    c.drawColor(Color.TRANSPARENT)

    val margin = 64f
    val midY = h * 0.46f
    val trackW = w - 2 * margin

    val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = C_TRACK; strokeWidth = 7f; strokeCap = Paint.Cap.ROUND
    }
    val progress = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = C_BRAND; strokeWidth = 7f; strokeCap = Paint.Cap.ROUND
    }
    val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = C_META; textSize = 21f; textAlign = Paint.Align.CENTER
    }
    val textSmall = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = C_SUB; textSize = 18f; textAlign = Paint.Align.CENTER
    }

    // Track + progress (progress only when the semester window is active)
    c.drawLine(margin, midY, w - margin, midY, track)
    if (pctNow > 0.0) {
      val px = margin + (trackW * (pctNow / 100.0).toFloat())
      c.drawLine(margin, midY, px.coerceAtMost(w - margin), midY, progress)
    }

    // Milestone dots + labels
    val today = todayAligned(now)
    for (m in milestones) {
      val rawX = margin + trackW * (m.pct / 100.0).toFloat()
      val x = rawX.coerceIn(margin - 14f, w - margin + 14f)
      val passed = m.epochMs <= today
      val dot = Paint(Paint.ANTI_ALIAS_FLAG)
      if (passed) {
        dot.color = C_EMERALD
        dot.style = Paint.Style.FILL
        c.drawCircle(x, midY, 9f, dot)
      } else {
        dot.color = C_AMBER
        dot.style = Paint.Style.STROKE
        dot.strokeWidth = 4f
        c.drawCircle(x, midY, 9f, dot)
      }
      // END pin: pull the label inward so it never clips the right edge
      val labelX = when {
        m.pct >= 99.0 -> x - 18f
        m.pct <= 1.0 -> x + 14f
        else -> x
      }
      c.drawText(m.shortLabel, labelX.coerceIn(margin, w - margin), midY + 34f, text)
    }

    // Today marker
    if (pctNow in 0.0..100.0) {
      val tx = (margin + trackW * (pctNow / 100.0).toFloat()).coerceIn(margin, w - margin)
      val tick = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = C_TEXT }
      c.drawCircle(tx, midY, 13f, tick)
      val inner = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = C_BRAND }
      c.drawCircle(tx, midY, 7f, inner)
      val today = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = C_EMPTY_TITLE; textSize = 19f; textAlign = Paint.Align.CENTER
      }
      c.drawText("TODAY", tx, midY - 26f, today)
      val pct = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = C_BRAND; textSize = 19f; textAlign = Paint.Align.CENTER
      }
      c.drawText("${pctNow.toInt()}%", tx, h - 10f, pct)
    }
    return bmp
  }

  // ── Month card (canvas) ──────────────────────────────────────────────────

  private fun renderMonth(views: RemoteViews, examDays: Set<Long>, now: Long) {
    val cal = Calendar.getInstance()
    views.setTextViewText(
      R.id.sem_header,
      SimpleDateFormat("MMMM yyyy", Locale.US).format(Date(now)).uppercase(Locale.US)
    )
    views.setTextColor(R.id.sem_header, C_AMBER)
    val bmp = drawMonth(760, 560, cal, examDays)
    views.setImageViewBitmap(R.id.sem_month, bmp)
    views.setViewVisibility(R.id.sem_month, View.VISIBLE)
    views.setTextViewText(R.id.sem_legend, "● exam day   ◉ today")
    views.setTextColor(R.id.sem_legend, C_SUB)
  }

  private fun drawMonth(w: Int, h: Int, monthCal: Calendar, examDays: Set<Long>): Bitmap {
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565)
    val c = Canvas(bmp)
    c.drawColor(Color.TRANSPARENT)

    val headerH = 46f
    val cols = 7
    val cellW = w / cols.toFloat()

    // Monday-first weekday header
    val weekdays = arrayOf("M", "T", "W", "T", "F", "S", "S")
    val headPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = C_TRACK; textSize = 24f; textAlign = Paint.Align.CENTER
    }
    for (i in weekdays.indices) {
      c.drawText(weekdays[i], cellW * i + cellW / 2, headerH - 14f, headPaint)
    }

    // First day of the month, remapped to Monday-first column (0..6)
    val first = monthCal.clone() as Calendar
    first.set(Calendar.DAY_OF_MONTH, 1)
    val dow = (first.get(Calendar.DAY_OF_WEEK) - Calendar.MONDAY + 7) % 7
    val daysInMonth = first.getActualMaximum(Calendar.DAY_OF_MONTH)

    val year = first.get(Calendar.YEAR)
    val month = first.get(Calendar.MONTH)
    val todayCal = Calendar.getInstance()
    val isThisMonth =
      todayCal.get(Calendar.YEAR) == year && todayCal.get(Calendar.MONTH) == month
    val todayNum = todayCal.get(Calendar.DAY_OF_MONTH)

    val rows = ((dow + daysInMonth + 6) / 7)
    val gridTop = headerH
    val cellH = (h - gridTop) / rows

    val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = C_META; textSize = 22f; textAlign = Paint.Align.CENTER
    }
    val todayText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE; textSize = 22f; textAlign = Paint.Align.CENTER
      style = Paint.Style.FILL
      isFakeBoldText = true
    }
    val todayCircle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = C_BRAND }
    val examDot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = C_AMBER }

    for (day in 1..daysInMonth) {
      val idx = dow + day - 1
      val col = idx % 7
      val row = idx / 7
      val cx = cellW * col + cellW / 2
      val cy = gridTop + cellH * row + cellH / 2

      val dayStart = Calendar.getInstance()
      dayStart.set(year, month, day, 0, 0, 0)
      dayStart.set(Calendar.MILLISECOND, 0)
      val isExam = examDays.contains(dayStart.timeInMillis)
      val isToday = isThisMonth && day == todayNum

      if (isToday) {
        c.drawCircle(cx, cy - 2f, cellH.coerceAtMost(cellW) * 0.34f, todayCircle)
        c.drawText(day.toString(), cx, cy + 6f, todayText)
      } else {
        c.drawText(day.toString(), cx, cy + 6f, text)
      }
      if (isExam) {
        c.drawCircle(cx, cy + cellH * 0.26f, 5.5f, examDot)
      }
    }
    return bmp
  }

  // ── Empty states ─────────────────────────────────────────────────────────

  private fun renderEmpty(views: RemoteViews, layoutId: Int, title: String, subtitle: String) {
    when (layoutId) {
      R.layout.widget_semester_countdown -> {
        views.setTextViewText(R.id.sem_header, "SEMESTER")
        views.setTextColor(R.id.sem_header, C_EMPTY_SUB)
        views.setTextViewText(R.id.sem_big, "—")
        views.setTextColor(R.id.sem_big, C_EMPTY_TITLE)
        views.setTextViewText(R.id.sem_unit, "")
        views.setTextViewText(R.id.sem_milestone, title)
        views.setTextColor(R.id.sem_milestone, C_EMPTY_TITLE)
        views.setTextViewText(R.id.sem_date, subtitle)
        views.setTextColor(R.id.sem_date, C_EMPTY_SUB)
      }
      R.layout.widget_semester_timeline -> {
        views.setTextViewText(R.id.sem_header, "SEMESTER TIMELINE")
        views.setTextColor(R.id.sem_header, C_EMPTY_SUB)
        views.setTextViewText(R.id.sem_progress_pct, "")
        views.setViewVisibility(R.id.sem_timeline, View.GONE)
        views.setTextViewText(R.id.sem_status, "$title — $subtitle")
        views.setTextColor(R.id.sem_status, C_EMPTY_TITLE)
      }
      else -> {
        views.setTextViewText(R.id.sem_header, "MONTH")
        views.setTextColor(R.id.sem_header, C_EMPTY_SUB)
        views.setViewVisibility(R.id.sem_month, View.GONE)
        views.setTextViewText(R.id.sem_legend, "$title — $subtitle")
        views.setTextColor(R.id.sem_legend, C_EMPTY_TITLE)
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private fun fmtDay(epochMs: Long): String =
    SimpleDateFormat("EEE d MMM", Locale.US).format(Date(epochMs))

  /** Local-midnight epoch of `now` (day-aligned comparisons vs snapshot epochs). */
  private fun todayAligned(now: Long): Long {
    val cal = Calendar.getInstance()
    cal.timeInMillis = now
    cal.set(Calendar.HOUR_OF_DAY, 0)
    cal.set(Calendar.MINUTE, 0)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    return cal.timeInMillis
  }
}

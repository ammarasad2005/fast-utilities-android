package expo.modules.widgetstore

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/**
 * Renders the semester snapshot ("semester_snapshot") into the two semester
 * widget layouts (milestone countdown / live timeline).
 *
 * Category identity (user decision): SEMESTER = EMERALD — teal/emerald glass
 * background (@drawable/widget_bg_semester) with emerald accents, distinct
 * from timetable (blue) and exams (amber).
 *
 * The timeline is painted with a software Canvas → Bitmap → ImageView as a
 * JOURNEY RAIL (user-approved concept): transparent ARGB_8888 canvas so the
 * rail floats directly on the glass background — ARGB, not RGB_565: a 565
 * bitmap has no alpha channel, so the old "transparent" clear became an
 * opaque BLACK box on the navy background (the "black foreground, looks
 * weird" bug the user reported).
 *
 * All countdowns/positions derive from absolute epochs at render time, so the
 * widgets cross midnight JS-free (unlock/hourly/manual re-render).
 */
object SemesterWidgetRenderer {

  private const val PREFS = "fastutilities_widget"
  private const val KEY_SNAPSHOT = "semester_snapshot"
  private const val STALE_MS = 15L * 60L * 1000L
  private const val DAY_MS = 86_400_000L

  // ── Palette (emerald identity on the teal glass surface) ─────────────────
  private const val C_TEXT = 0xFFFFFFFF.toInt()
  private const val C_META = 0xFFB9C6D8.toInt()
  private const val C_SUB = 0xFF93A5BF.toInt()
  private const val C_ACCENT = 0xFF6EE7B7.toInt() // emerald — category color
  private const val C_ACCENT_DEEP = 0xFF10B981.toInt() // rail gradient start
  private const val C_SURFACE = 0xFF0B2E26.toInt() // pin centers, matches bg mid-tone
  private const val C_TRACK = 0x29FFFFFF.toInt() // glass rail (12% white)
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
      when (layoutId) {
        R.layout.widget_semester_countdown ->
          renderCountdown(views, milestones, name, now)
        else ->
          renderTimeline(views, name, startMs, endMs, milestones, now)
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

  // ── Milestone countdown ──────────────────────────────────────────────────

  private fun renderCountdown(views: RemoteViews, milestones: List<Milestone>, name: String, now: Long) {
    views.setTextViewText(R.id.sem_header, "SEMESTER")
    views.setTextColor(R.id.sem_header, C_ACCENT)
    val next = milestones.firstOrNull { it.epochMs >= todayAligned(now) }
    if (next == null) {
      views.setTextViewText(R.id.sem_big, "DONE")
      views.setTextColor(R.id.sem_big, C_ACCENT)
      views.setTextViewText(R.id.sem_unit, "semester complete 🎓")
      views.setTextViewText(R.id.sem_milestone, name)
      views.setTextViewText(R.id.sem_date, "")
      return
    }
    val days = ((next.epochMs - todayAligned(now)) / DAY_MS).toInt()
    when {
      days <= 0 -> {
        views.setTextViewText(R.id.sem_big, "TODAY")
        views.setTextColor(R.id.sem_big, C_ACCENT)
        views.setTextViewText(R.id.sem_unit, "")
      }
      days == 1 -> {
        views.setTextViewText(R.id.sem_big, "1")
        views.setTextColor(R.id.sem_big, C_ACCENT)
        views.setTextViewText(R.id.sem_unit, "day until")
      }
      else -> {
        views.setTextViewText(R.id.sem_big, days.toString())
        views.setTextColor(R.id.sem_big, C_ACCENT)
        views.setTextViewText(R.id.sem_unit, "days until")
      }
    }
    views.setTextViewText(R.id.sem_milestone, next.label.ifEmpty { next.shortLabel })
    views.setTextColor(R.id.sem_milestone, C_TEXT)
    views.setTextViewText(R.id.sem_date, fmtDay(next.epochMs))
    views.setTextColor(R.id.sem_date, C_SUB)
  }

  // ── Live timeline: journey rail (transparent canvas) ─────────────────────

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
    val active = now >= startMs && now <= endMs

    val bmp = drawTimelineRail(720, 190, milestones, pctNow, dayIdx, active, now)
    views.setImageViewBitmap(R.id.sem_timeline, bmp)
    views.setViewVisibility(R.id.sem_timeline, View.VISIBLE)

    views.setTextViewText(R.id.sem_header, "SEMESTER TIMELINE")
    views.setTextColor(R.id.sem_header, C_ACCENT)
    views.setTextViewText(R.id.sem_progress_pct, "${pctNow.toInt()}%")
    views.setTextColor(R.id.sem_progress_pct, C_ACCENT)
    views.setTextViewText(
      R.id.sem_status,
      if (name.isEmpty()) "Day $dayIdx of $totalDays" else "Day $dayIdx of $totalDays · $name"
    )
    views.setTextColor(R.id.sem_status, C_META)
  }

  /**
   * Journey rail: a slim glass track with an emerald gradient fill up to a
   * glowing TODAY node; milestones are pins on the rail whose labels
   * alternate above/below so they never collide; the next upcoming pin is
   * highlighted with a double ring and a bright label.
   */
  private fun drawTimelineRail(
    w: Int,
    h: Int,
    milestones: List<Milestone>,
    pctNow: Double,
    dayIdx: Long,
    active: Boolean,
    now: Long
  ): Bitmap {
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    c.drawColor(Color.TRANSPARENT) // true transparency — needs ARGB (see header doc)

    val margin = 56f
    val railY = h * 0.58f
    val trackW = w - 2 * margin

    // ── Rail: glass track + gradient progress ────────────────────────────
    val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = C_TRACK; strokeWidth = 10f; strokeCap = Paint.Cap.ROUND; style = Paint.Style.STROKE
    }
    c.drawLine(margin, railY, w - margin, railY, track)

    if (active && pctNow > 0.0) {
      val px = (margin + trackW * (pctNow / 100.0).toFloat()).coerceIn(margin, w - margin)
      // soft halo under the progress line
      val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x146EE7B7; strokeWidth = 18f; strokeCap = Paint.Cap.ROUND; style = Paint.Style.STROKE
      }
      c.drawLine(margin, railY, px, railY, halo)
      val prog = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeWidth = 10f; strokeCap = Paint.Cap.ROUND; style = Paint.Style.STROKE
        shader = LinearGradient(
          margin, railY, px.coerceAtLeast(margin + 1f), railY,
          C_ACCENT_DEEP, C_ACCENT, Shader.TileMode.CLAMP
        )
      }
      c.drawLine(margin, railY, px, railY, prog)
    }

    // ── Milestone pins + lane-alternating labels ─────────────────────────
    val today = todayAligned(now)
    val nextIdx = milestones.indexOfFirst { it.epochMs > today }
    val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = C_META; textSize = 21f; textAlign = Paint.Align.CENTER
    }
    val labelPaintNext = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = C_TEXT; textSize = 21f; textAlign = Paint.Align.CENTER; isFakeBoldText = true
    }
    val baseAbove = railY - 30f
    val baseBelow = railY + 42f
    var lastEdgeAbove = Float.NEGATIVE_INFINITY
    var lastEdgeBelow = Float.NEGATIVE_INFINITY
    val gap = 12f

    for ((i, m) in milestones.withIndex()) {
      val x = (margin + trackW * (m.pct / 100.0).toFloat()).coerceIn(margin, w - margin)
      val passed = m.epochMs <= today
      val isNext = i == nextIdx

      val centerFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = C_SURFACE }
      if (passed) {
        val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = C_ACCENT }
        c.drawCircle(x, railY, 9.5f, dot)
        c.drawCircle(x, railY, 3.5f, centerFill)
      } else {
        c.drawCircle(x, railY, 9f, centerFill)
        val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = if (isNext) C_ACCENT else C_SUB
          style = Paint.Style.STROKE; strokeWidth = if (isNext) 4f else 3f
        }
        c.drawCircle(x, railY, 9f, ring)
        if (isNext) {
          val outer = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0x556EE7B7; style = Paint.Style.STROKE; strokeWidth = 2.5f
          }
          c.drawCircle(x, railY, 14.5f, outer)
        }
      }

      // Label — pick the lane (above/below) with enough room at this x
      val p = if (isNext) labelPaintNext else labelPaint
      val tw = p.measureText(m.shortLabel)
      val cx = x.coerceIn(6f + tw / 2, w - 6f - tw / 2)
      val left = cx - tw / 2
      val right = cx + tw / 2
      val fitsAbove = left >= lastEdgeAbove + gap
      val fitsBelow = left >= lastEdgeBelow + gap
      val laneAbove = when {
        fitsAbove && fitsBelow -> i % 2 == 0 // both free: alternate for rhythm
        fitsAbove -> true
        fitsBelow -> false
        else -> i % 2 == 0 // dense cluster: alternate anyway (best effort)
      }
      if (laneAbove) {
        c.drawText(m.shortLabel, cx, baseAbove, p)
        lastEdgeAbove = right
      } else {
        c.drawText(m.shortLabel, cx, baseBelow, p)
        lastEdgeBelow = right
      }
    }

    // ── TODAY: pill + connector + glowing node on the rail ───────────────
    if (active) {
      val tx = (margin + trackW * (pctNow / 100.0).toFloat()).coerceIn(margin, w - margin)

      val pillText = "DAY $dayIdx"
      val pillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = C_ACCENT; textSize = 20f; textAlign = Paint.Align.CENTER; isFakeBoldText = true
      }
      val pw = pillPaint.measureText(pillText) + 30f
      val ph = 32f
      val pillCx = tx.coerceIn(margin - 14f + pw / 2, w - margin + 14f - pw / 2)
      val pillTop = 6f
      val rect = RectF(pillCx - pw / 2, pillTop, pillCx + pw / 2, pillTop + ph)
      val pillBg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x2E6EE7B7 }
      c.drawRoundRect(rect, ph / 2, ph / 2, pillBg)
      val pillEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x996EE7B7; style = Paint.Style.STROKE; strokeWidth = 2f
      }
      c.drawRoundRect(rect, ph / 2, ph / 2, pillEdge)
      c.drawText(pillText, pillCx, pillTop + ph - 9f, pillPaint)

      // hairline connector from the pill down to the node
      val stem = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x40FFFFFF; strokeWidth = 2f
      }
      c.drawLine(tx, pillTop + ph + 2f, tx, railY - 12f, stem)

      // glowing node
      val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x22FFFFFF }
      c.drawCircle(tx, railY, 18f, glow)
      val glow2 = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x44FFFFFF }
      c.drawCircle(tx, railY, 12f, glow2)
      val core = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = C_TEXT }
      c.drawCircle(tx, railY, 8f, core)
      val inner = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = C_ACCENT }
      c.drawCircle(tx, railY, 4.5f, inner)
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
      else -> {
        views.setTextViewText(R.id.sem_header, "SEMESTER TIMELINE")
        views.setTextColor(R.id.sem_header, C_EMPTY_SUB)
        views.setTextViewText(R.id.sem_progress_pct, "")
        views.setViewVisibility(R.id.sem_timeline, View.GONE)
        views.setTextViewText(R.id.sem_status, "$title — $subtitle")
        views.setTextColor(R.id.sem_status, C_EMPTY_TITLE)
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

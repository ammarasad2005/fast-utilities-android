package expo.modules.widgetstore

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/**
 * Exam widget — ONE widget, two curated sizes (user trimmed the family in
 * v2.1.0: the standalone Countdown and My Exams widgets were removed; the
 * countdown is an inherent part of Next Exam, the same way the timetable
 * widget shows the next class's coming-when):
 *
 *   · "Exams · Next exam"   standard 3x2 + wide 4x2  (one flexible layout)
 *
 * Each variant is its own manifest receiver (one receiver = one picker
 * entry). All rendering lives in [ExamWidgetRenderer]; resize just stretches
 * the layout (resizeMode h|v) — no mid-resize layout swap.
 */

/** "Exams · Next exam" — standard 3x2 entry. */
class ExamNextWidgetProvider : BaseExamWidgetProvider() {
  override val defaultLayout = R.layout.widget_exam_next
}

/** "Exams · Next exam" — wide 4x2 entry. */
class ExamNextWidgetWideProvider : BaseExamWidgetProvider() {
  override val defaultLayout = R.layout.widget_exam_next
}

abstract class BaseExamWidgetProvider : AppWidgetProvider() {

  abstract val defaultLayout: Int

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) {
      ExamWidgetRenderer.render(context, appWidgetManager, id, defaultLayout)
    }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle?
  ) {
    ExamWidgetRenderer.render(context, appWidgetManager, appWidgetId, defaultLayout)
  }

  companion object {
    /** All receivers — used to re-render every placed widget after a publish. */
    @JvmField
    val PROVIDERS: List<Class<out AppWidgetProvider>> = listOf(
      ExamNextWidgetProvider::class.java,
      ExamNextWidgetWideProvider::class.java,
    )

    @JvmStatic
    fun layoutFor(cls: Class<*>): Int = R.layout.widget_exam_next
  }
}

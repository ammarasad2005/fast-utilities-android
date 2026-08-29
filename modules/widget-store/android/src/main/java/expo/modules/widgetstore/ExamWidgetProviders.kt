package expo.modules.widgetstore

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/**
 * Exam widget family — three widgets, curated sizes (user decision):
 *
 *   · "Exams · Countdown"   compact 2x2 + standard 3x2  (one flexible layout)
 *   · "Exams · Next exam"   standard 3x2 + wide 4x2     (one flexible layout)
 *   · "Exams · My exams"    wide 4x2 + large 4x4        (row-list layout)
 *
 * Each variant is its own manifest receiver (one receiver = one picker entry).
 * They share ALL rendering logic in [ExamWidgetRenderer]; unlike the
 * next-class family there is no mid-resize layout swap — each layout was
 * sized for its size class and resize just stretches it (resizeMode h|v).
 */

/** "Exams · Countdown" — compact 2x2 entry. */
class ExamCountdownWidgetCompactProvider : BaseExamWidgetProvider() {
  override val defaultLayout = R.layout.widget_exam_countdown
}

/** "Exams · Countdown" — standard 3x2 entry. */
class ExamCountdownWidgetProvider : BaseExamWidgetProvider() {
  override val defaultLayout = R.layout.widget_exam_countdown
}

/** "Exams · Next exam" — standard 3x2 entry. */
class ExamNextWidgetProvider : BaseExamWidgetProvider() {
  override val defaultLayout = R.layout.widget_exam_next
}

/** "Exams · Next exam" — wide 4x2 entry. */
class ExamNextWidgetWideProvider : BaseExamWidgetProvider() {
  override val defaultLayout = R.layout.widget_exam_next
}

/** "Exams · My exams" — wide 4x2 entry. */
class ExamListWidgetWideProvider : BaseExamWidgetProvider() {
  override val defaultLayout = R.layout.widget_exam_list
}

/** "Exams · My exams" — large 4x4 entry. */
class ExamListWidgetLargeProvider : BaseExamWidgetProvider() {
  override val defaultLayout = R.layout.widget_exam_list
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
      ExamCountdownWidgetCompactProvider::class.java,
      ExamCountdownWidgetProvider::class.java,
      ExamNextWidgetProvider::class.java,
      ExamNextWidgetWideProvider::class.java,
      ExamListWidgetWideProvider::class.java,
      ExamListWidgetLargeProvider::class.java,
    )

    @JvmStatic
    fun layoutFor(cls: Class<*>): Int = when (cls) {
      ExamCountdownWidgetCompactProvider::class.java,
      ExamCountdownWidgetProvider::class.java -> R.layout.widget_exam_countdown
      ExamNextWidgetProvider::class.java,
      ExamNextWidgetWideProvider::class.java -> R.layout.widget_exam_next
      else -> R.layout.widget_exam_list
    }
  }
}

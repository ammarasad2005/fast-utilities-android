package expo.modules.widgetstore

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/**
 * Semester widget family — three widgets, curated sizes:
 *
 *   · "Semester · Next milestone" compact 2x2 + standard 3x2 (one layout)
 *   · "Semester · Timeline"       wide 4x2 + large 4x4       (canvas layout)
 *   · "Semester · Month"          large 4x4                  (canvas layout)
 *
 * Timeline and Month render through [SemesterWidgetRenderer]'s software
 * Canvas into an ImageView — RemoteViews alone can't draw a dot timeline or
 * a calendar grid.
 */

/** "Semester · Next milestone" — compact 2x2 entry. */
class SemesterCountdownWidgetCompactProvider : BaseSemesterWidgetProvider() {
  override val defaultLayout = R.layout.widget_semester_countdown
}

/** "Semester · Next milestone" — standard 3x2 entry. */
class SemesterCountdownWidgetProvider : BaseSemesterWidgetProvider() {
  override val defaultLayout = R.layout.widget_semester_countdown
}

/** "Semester · Timeline" — wide 4x2 entry. */
class SemesterTimelineWidgetWideProvider : BaseSemesterWidgetProvider() {
  override val defaultLayout = R.layout.widget_semester_timeline
}

/** "Semester · Timeline" — large 4x4 entry. */
class SemesterTimelineWidgetLargeProvider : BaseSemesterWidgetProvider() {
  override val defaultLayout = R.layout.widget_semester_timeline
}

/** "Semester · Month" — large 4x4 entry. */
class SemesterMonthWidgetProvider : BaseSemesterWidgetProvider() {
  override val defaultLayout = R.layout.widget_semester_month
}

abstract class BaseSemesterWidgetProvider : AppWidgetProvider() {

  abstract val defaultLayout: Int

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) {
      SemesterWidgetRenderer.render(context, appWidgetManager, id, defaultLayout)
    }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle?
  ) {
    SemesterWidgetRenderer.render(context, appWidgetManager, appWidgetId, defaultLayout)
  }

  companion object {
    /** All receivers — used to re-render every placed widget after a publish. */
    @JvmField
    val PROVIDERS: List<Class<out AppWidgetProvider>> = listOf(
      SemesterCountdownWidgetCompactProvider::class.java,
      SemesterCountdownWidgetProvider::class.java,
      SemesterTimelineWidgetWideProvider::class.java,
      SemesterTimelineWidgetLargeProvider::class.java,
      SemesterMonthWidgetProvider::class.java,
    )

    @JvmStatic
    fun layoutFor(cls: Class<*>): Int = when (cls) {
      SemesterCountdownWidgetCompactProvider::class.java,
      SemesterCountdownWidgetProvider::class.java -> R.layout.widget_semester_countdown
      SemesterTimelineWidgetWideProvider::class.java,
      SemesterTimelineWidgetLargeProvider::class.java -> R.layout.widget_semester_timeline
      else -> R.layout.widget_semester_month
    }
  }
}

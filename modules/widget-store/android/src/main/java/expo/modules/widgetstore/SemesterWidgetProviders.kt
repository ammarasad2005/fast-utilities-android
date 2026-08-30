package expo.modules.widgetstore

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/**
 * Semester widget family — two widgets, curated sizes (user trimmed the
 * family in v2.1.0: Month card removed, Timeline 4x4 removed keeping 4x2,
 * Timeline redesigned as a journey rail on a transparent canvas):
 *
 *   · "Semester · Next milestone" compact 2x2 + standard 3x2 (one layout)
 *   · "Semester · Timeline"       wide 4x2                   (canvas layout)
 *
 * Timeline renders through [SemesterWidgetRenderer]'s software Canvas into an
 * ImageView — RemoteViews alone can't draw the rail/pins composition.
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
    )

    @JvmStatic
    fun layoutFor(cls: Class<*>): Int = when (cls) {
      SemesterTimelineWidgetWideProvider::class.java -> R.layout.widget_semester_timeline
      else -> R.layout.widget_semester_countdown
    }
  }
}

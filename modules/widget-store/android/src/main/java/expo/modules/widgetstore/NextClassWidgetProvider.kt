package expo.modules.widgetstore

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/**
 * Home-screen widget: next / ongoing class tracker — size variants.
 *
 * Each variant is its own manifest receiver (that is how Android exposes
 * multiple picker entries for one app). They share all rendering logic in
 * [WidgetRenderer]; only the default layout differs. The class named
 * `NextClassWidgetProvider` is the ORIGINAL 3x2 receiver — do not rename it,
 * already-placed widgets are bound to that ComponentName.
 */
class NextClassWidgetProvider : BaseNextClassWidgetProvider() {
  override val defaultLayout = R.layout.widget_next_class
}

/** Compact 2x2. */
class NextClassWidgetCompactProvider : BaseNextClassWidgetProvider() {
  override val defaultLayout = R.layout.widget_compact
}

/** Wide 4x2 (same content layout as standard, wider footprint). */
class NextClassWidgetWideProvider : BaseNextClassWidgetProvider() {
  override val defaultLayout = R.layout.widget_next_class
}

/** Large 4x4 — roomier type, all rows. */
class NextClassWidgetLargeProvider : BaseNextClassWidgetProvider() {
  override val defaultLayout = R.layout.widget_large
}

abstract class BaseNextClassWidgetProvider : AppWidgetProvider() {

  abstract val defaultLayout: Int

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) WidgetRenderer.render(context, appWidgetManager, id, defaultLayout)
  }

  /**
   * Live resize: the host reports new grid bounds; we swap to the size-appropriate
   * layout (compact / standard / large) and re-render from the stored snapshot.
   */
  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle?
  ) {
    val w = newOptions?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
    val h = newOptions?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
    WidgetRenderer.render(context, appWidgetManager, appWidgetId, WidgetRenderer.layoutFor(w, h, defaultLayout))
  }

  companion object {
    /** All receivers — used to re-render every placed widget after a publish. */
    @JvmField
    val PROVIDERS: List<Class<out AppWidgetProvider>> = listOf(
      NextClassWidgetProvider::class.java,
      NextClassWidgetCompactProvider::class.java,
      NextClassWidgetWideProvider::class.java,
      NextClassWidgetLargeProvider::class.java,
    )
  }
}

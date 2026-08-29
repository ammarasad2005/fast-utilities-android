package expo.modules.widgetstore

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridge between JS and the home-screen widget. JS publishes a small JSON
 * snapshot (same data the in-app NextClassCard shows); the AppWidgetProvider
 * reads it when rendering. After each publish we poke the widget manager so
 * the home screen updates immediately.
 */
class WidgetStoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WidgetStore")

    Function("setSnapshot") { json: String ->
      val ctx = appContext.reactContext ?: return@Function false
      ctx.getSharedPreferences("fastutilities_widget", Context.MODE_PRIVATE)
        .edit()
        .putString("next_class_snapshot", json)
        .apply()
      WidgetRenderer.refresh(ctx)
      true
    }

    Function("setExamSnapshot") { json: String ->
      val ctx = appContext.reactContext ?: return@Function false
      ctx.getSharedPreferences("fastutilities_widget", Context.MODE_PRIVATE)
        .edit()
        .putString("exam_snapshot", json)
        .apply()
      ExamWidgetRenderer.refresh(ctx)
      true
    }

    Function("setSemesterSnapshot") { json: String ->
      val ctx = appContext.reactContext ?: return@Function false
      ctx.getSharedPreferences("fastutilities_widget", Context.MODE_PRIVATE)
        .edit()
        .putString("semester_snapshot", json)
        .apply()
      SemesterWidgetRenderer.refresh(ctx)
      true
    }
  }
}

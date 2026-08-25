package expo.modules.widgetstore

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Sideload in-app update: launches the system installer for a downloaded APK.
 *
 * The APK must sit somewhere our FileProvider (@xml/app_updater_paths: app
 * cache/files dirs) can expose — JS downloads it via expo-file-system to
 * its cacheDirectory and passes the local path here. The installer shows the
 * standard Android "Update app?" prompt; because every CI build is signed
 * with the same key, the update installs in place, preserving user data.
 *
 * REQUEST_INSTALL_PACKAGES is declared in app.json. On Android 8+ the user
 * must also have granted "Install unknown apps" for us — canInstallUnknownApps
 * lets JS nudge them to the setting when needed.
 */
class AppUpdaterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppUpdater")

    Function("canInstallUnknownApps") {
      val ctx = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) true
      else ctx.packageManager.canRequestPackageInstalls()
    }

    /** path may be a filesystem path or a file:// URI */
    Function("installApk") { path: String ->
      val ctx = appContext.reactContext ?: return@Function false
      val clean = path.removePrefix("file://")
      val file = File(clean)
      if (!file.exists() || file.length() == 0L) return@Function false

      // API 26+: unknown-app-sources gate for our app id — if not granted,
      // take the user straight to the setting and report false so JS can
      // ask them to allow and tap Install again.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        !ctx.packageManager.canRequestPackageInstalls()
      ) {
        val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
          .setData(Uri.parse("package:${ctx.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(settings)
        return@Function false
      }

      val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.appupdater.provider", file)
      val install = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      ctx.startActivity(install)
      true
    }
  }
}

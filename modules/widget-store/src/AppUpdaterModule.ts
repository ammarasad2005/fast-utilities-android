import { NativeModule, requireNativeModule } from 'expo';

declare class AppUpdaterModule extends NativeModule {
  /** false if the user first needs to allow "install unknown apps" (we deep-link the setting). */
  installApk(path: string): boolean;
  canInstallUnknownApps(): boolean;
}

let cached: AppUpdaterModule | null | undefined;

/** Null in Expo Go / Jest — callers must tolerate it. */
export function getAppUpdater(): AppUpdaterModule | null {
  if (cached === undefined) {
    try {
      cached = requireNativeModule<AppUpdaterModule>('AppUpdater');
    } catch {
      cached = null;
    }
  }
  return cached;
}

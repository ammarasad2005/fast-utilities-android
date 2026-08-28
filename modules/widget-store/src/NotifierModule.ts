import { NativeModule, requireNativeModule } from 'expo';

export interface NotificationPermissionResult {
  granted: boolean;
  /** 'granted' | 'denied' | 'undetermined' (mirrors the expo permissions enum). */
  status: string;
  canAskAgain?: boolean;
}

declare class NotifierModule extends NativeModule {
  /** Android 13+: runtime POST_NOTIFICATIONS prompt. Older: resolves granted. */
  requestNotificationsPermission(): Promise<Record<string, unknown>>;
  hasNotificationsPermission(): boolean;
  /** Posts (or replaces) a class-change alert; tapping it opens the app. */
  notifyClassChange(title: string, body: string, dedupeId: string): boolean;
}

let cached: NotifierModule | null | undefined;

/**
 * Native module lives only in dev-client/production APKs (absent in Expo Go
 * and Jest) — every caller must tolerate null.
 */
export function getNotifier(): NotifierModule | null {
  if (cached === undefined) {
    try {
      cached = requireNativeModule<NotifierModule>('Notifier');
    } catch {
      cached = null;
    }
  }
  return cached;
}

export async function requestNotificationsPermission(): Promise<NotificationPermissionResult> {
  const mod = getNotifier();
  if (!mod) return { granted: false, status: 'unavailable' };
  try {
    const res = (await mod.requestNotificationsPermission()) as Record<string, unknown>;
    const granted = res.granted === true || res.status === 'granted';
    return {
      granted,
      status: typeof res.status === 'string' ? res.status : granted ? 'granted' : 'denied',
      canAskAgain: res.canAskAgain === undefined ? undefined : res.canAskAgain === true,
    };
  } catch {
    return { granted: false, status: 'error' };
  }
}

export function hasNotificationsPermission(): boolean {
  try {
    return getNotifier()?.hasNotificationsPermission() ?? false;
  } catch {
    return false;
  }
}

export function notifyClassChange(title: string, body: string, dedupeId: string): boolean {
  try {
    return getNotifier()?.notifyClassChange(title, body, dedupeId) ?? false;
  } catch {
    return false;
  }
}

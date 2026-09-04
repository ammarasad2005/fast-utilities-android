import { NativeModule, requireNativeModule } from 'expo';

import type {
  ExamWidgetItem,
  ExamWidgetSnapshot,
  NextClassWidgetSnapshot,
  SemesterWidgetMilestone,
  SemesterWidgetSnapshot,
} from './WidgetStore.types';

declare class WidgetStoreModule extends NativeModule {
  setSnapshot(json: string): boolean;
  setExamSnapshot(json: string): boolean;
  setSemesterSnapshot(json: string): boolean;
}

let cached: WidgetStoreModule | null | undefined;

/**
 * The native module only exists in a dev-client/production APK built with the
 * local module. In Expo Go (and in Jest) it is absent — callers must tolerate
 * a null return.
 */
export function getWidgetStore(): WidgetStoreModule | null {
  if (cached === undefined) {
    try {
      cached = requireNativeModule<WidgetStoreModule>('WidgetStore');
    } catch {
      cached = null;
    }
  }
  return cached;
}

export type {
  NextClassWidgetSnapshot,
  ExamWidgetSnapshot,
  ExamWidgetItem,
  SemesterWidgetSnapshot,
  SemesterWidgetMilestone,
};

declare class PushSetupModule extends NativeModule {
  ensureSetup(): boolean;
}

let pushCached: PushSetupModule | null | undefined;

/**
 * Native push bootstrap (FCM topic subscription). Absent in Expo Go/tests,
 * and a no-op in builds without google-services.json — always safe to call.
 */
export function getPushSetup(): PushSetupModule | null {
  if (pushCached === undefined) {
    try {
      pushCached = requireNativeModule<PushSetupModule>('PushSetup');
    } catch {
      pushCached = null;
    }
  }
  return pushCached;
}

/** Fire-and-forget: subscribe the device to the campus-updates FCM topic. */
export function ensurePushSetup(): void {
  try {
    getPushSetup()?.ensureSetup();
  } catch {
    // never blocks app start
  }
}

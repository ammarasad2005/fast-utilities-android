import { NativeModule, requireNativeModule } from 'expo';

import type { NextClassWidgetSnapshot } from './WidgetStore.types';

declare class WidgetStoreModule extends NativeModule {
  setSnapshot(json: string): boolean;
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

export type { NextClassWidgetSnapshot };

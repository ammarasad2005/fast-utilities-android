import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persisted string preference backed by AsyncStorage.
 * Returns [value, setValue]; setValue persists asynchronously.
 */
export function usePref(key: string, initial: string): [string, (v: string) => void] {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key)
      .then((stored) => {
        if (active && stored != null) setValue(stored);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [key]);

  const set = (v: string) => {
    setValue(v);
    AsyncStorage.setItem(key, v).catch(() => {});
  };

  return [value, set];
}

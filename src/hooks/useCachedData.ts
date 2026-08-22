import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { cacheGet, cacheSet, isStale } from '@/api/cache';

/**
 * Generic stale-while-revalidate data hook.
 *
 * - Serves the cached copy instantly (so the app is usable offline).
 * - Revalidates in the background when the cache is stale or missing.
 * - With `revalidateOnFocus` (default true), also revalidates whenever the
 *   screen regains focus OR the app returns to the foreground — throttled by
 *   `minRevalidateIntervalMs` so we don't hammer the network. This keeps the
 *   on-device cache fresh (e.g. a daily timetable update) without the user
 *   having to pull-to-refresh manually.
 * - Reports `isRefreshing`, `isFromCache`, and `error` so the UI can label
 *   cached/offline data honestly rather than pretending it's live.
 *
 * `fetcher` is expected to throw on network failure; the hook swallows the
 * error and keeps any cached data.
 */
export interface UseCachedDataOptions {
  /** Revalidate in the background on screen focus / app foreground. Default true. */
  revalidateOnFocus?: boolean;
  /** Minimum ms between background revalidations (throttle). Default 60s. */
  minRevalidateIntervalMs?: number;
}

export interface UseCachedDataResult<T> {
  data: T | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isFromCache: boolean;
  error: string | null;
  refresh: () => void;
}

export function useCachedData<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
  options: UseCachedDataOptions = {}
): UseCachedDataResult<T> {
  const { revalidateOnFocus = true, minRevalidateIntervalMs = 60_000 } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFromCache, setIsFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards: prevent overlapping fetches, and throttle background revalidation.
  const inFlightRef = useRef(false);
  const lastFetchAtRef = useRef(0);

  const load = useCallback(
    async (background: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      if (background) setIsRefreshing(true);
      else setIsLoading(true);

      try {
        const cached = await cacheGet<T>(cacheKey);
        if (cached && !background) {
          // Serve the cached copy instantly; skip the network only if still
          // fresh — a focus/foreground revalidation will pick up changes soon.
          setData(cached.data);
          setIsFromCache(true);
          setIsLoading(false);
          if (!isStale(cached, ttlMs)) {
            return; // fresh cache — nothing to fetch on mount
          }
          setIsRefreshing(true); // stale cache — revalidate in background
        }

        const fresh = await fetcher();
        setData(fresh);
        setIsFromCache(false);
        setError(null);
        await cacheSet(cacheKey, fresh);
        lastFetchAtRef.current = Date.now();
      } catch (err) {
        const cached = await cacheGet<T>(cacheKey);
        if (cached) {
          setData(cached.data);
          setIsFromCache(true);
        }
        setError((err as Error)?.message ?? 'Failed to load data');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        inFlightRef.current = false;
      }
    },
    [cacheKey, ttlMs, fetcher]
  );

  // Initial load on mount.
  useEffect(() => {
    // Data-fetching hooks legitimately trigger async state updates here;
    // the load itself is async and reads cache before any setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
  }, [load]);

  // Throttled background revalidation (stale-while-revalidate).
  const revalidate = useCallback(() => {
    if (Date.now() - lastFetchAtRef.current < minRevalidateIntervalMs) return;
    load(true);
  }, [load, minRevalidateIntervalMs]);

  // Revalidate when the screen regains focus (tab switch, back navigation).
  useFocusEffect(
    useCallback(() => {
      if (!revalidateOnFocus) return;
      // Small delay so we don't fetch mid-transition.
      const t = setTimeout(revalidate, 250);
      return () => clearTimeout(t);
    }, [revalidateOnFocus, revalidate])
  );

  // Revalidate when the app returns to the foreground.
  useEffect(() => {
    if (!revalidateOnFocus) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') revalidate();
    });
    return () => sub.remove();
  }, [revalidateOnFocus, revalidate]);

  const refresh = useCallback(() => load(true), [load]);

  return { data, isLoading, isRefreshing, isFromCache, error, refresh };
}

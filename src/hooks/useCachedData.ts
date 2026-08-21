import { useCallback, useEffect, useState } from 'react';
import { cacheGet, cacheSet, isStale } from '@/api/cache';

/**
 * Generic stale-while-revalidate data hook.
 *
 * - Serves the cached copy instantly (so the app is usable offline).
 * - Revalidates in the background when the cache is stale or missing.
 * - Reports `isRefreshing`, `isFromCache`, and `error` so the UI can label
 *   cached/offline data honestly rather than pretending it's live.
 *
 * `fetcher` is expected to throw on network failure; the hook swallows the
 * error and keeps any cached data.
 */
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
  ttlMs: number
): UseCachedDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFromCache, setIsFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (background: boolean) => {
      if (background) setIsRefreshing(true);
      else setIsLoading(true);

      try {
        const cached = await cacheGet<T>(cacheKey);
        if (cached && !background) {
          setData(cached.data);
          setIsFromCache(true);
          setIsLoading(false);
          if (!isStale(cached, ttlMs)) {
            return; // Fresh cache — nothing to do.
          }
          setIsRefreshing(true); // Stale cache — revalidate in background.
        }

        const fresh = await fetcher();
        setData(fresh);
        setIsFromCache(false);
        setError(null);
        await cacheSet(cacheKey, fresh);
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
      }
    },
    [cacheKey, ttlMs, fetcher]
  );

  useEffect(() => {
    // Data-fetching hooks legitimately trigger async state updates here;
    // the load itself is async and reads cache before any setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { data, isLoading, isRefreshing, isFromCache, error, refresh };
}

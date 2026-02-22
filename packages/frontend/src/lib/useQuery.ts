import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';
import { getErrorMessage } from './error-messages';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

const DEFAULT_STALE_TIME = 30_000; // 30 seconds
const DEFAULT_CACHE_TIME = 5 * 60_000; // 5 minutes

// Clean up expired cache entries periodically
let cleanupScheduled = false;
function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  setTimeout(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.timestamp > DEFAULT_CACHE_TIME) {
        cache.delete(key);
      }
    }
    cleanupScheduled = false;
    if (cache.size > 0) scheduleCleanup();
  }, DEFAULT_CACHE_TIME);
}

export interface UseQueryOptions {
  /** Time in ms before cached data is considered stale (default: 30s) */
  staleTime?: number;
  /** Whether to fetch on mount (default: true) */
  enabled?: boolean;
}

export interface UseQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string;
  refetch: () => Promise<void>;
  invalidate: () => void;
}

/**
 * Lightweight data-fetching hook with in-memory caching.
 * Caches GET requests by URL and returns stale data instantly while revalidating.
 */
export function useQuery<T>(
  path: string | null,
  options: UseQueryOptions = {},
): UseQueryResult<T> {
  const { staleTime = DEFAULT_STALE_TIME, enabled = true } = options;

  const [data, setData] = useState<T | null>(() => {
    if (!path) return null;
    const cached = cache.get(path) as CacheEntry<T> | undefined;
    return cached ? cached.data : null;
  });
  const [loading, setLoading] = useState(() => {
    if (!path || !enabled) return false;
    const cached = cache.get(path);
    return !cached;
  });
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(
    async (force = false) => {
      if (!path || !enabled) return;

      const cached = cache.get(path) as CacheEntry<T> | undefined;

      // If we have cached data and it's fresh, skip fetching
      if (!force && cached && Date.now() - cached.timestamp < staleTime) {
        if (mountedRef.current) {
          setData(cached.data);
          setLoading(false);
          setError('');
        }
        return;
      }

      // If we have stale cached data, show it immediately but still refetch
      if (cached) {
        if (mountedRef.current) {
          setData(cached.data);
        }
      } else {
        if (mountedRef.current) {
          setLoading(true);
        }
      }

      try {
        const result = await api<T>(path);
        const entry: CacheEntry<T> = { data: result, timestamp: Date.now() };
        cache.set(path, entry as CacheEntry<unknown>);
        scheduleCleanup();

        if (mountedRef.current) {
          setData(result);
          setError('');
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(getErrorMessage(err));
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [path, enabled, staleTime],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => fetchData(true), [fetchData]);

  const invalidate = useCallback(() => {
    if (path) {
      cache.delete(path);
    }
  }, [path]);

  return { data, loading, error, refetch, invalidate };
}

/**
 * Invalidate all cache entries matching a prefix.
 * Useful after mutations (e.g., after creating a contact, invalidate '/contacts').
 */
export function invalidateQueries(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

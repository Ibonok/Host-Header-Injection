import { useCallback, useEffect, useMemo, useState } from "react";

export type UseAsyncOptions = {
  autoRefreshMs?: number;
  immediate?: boolean;
};

export function useAsyncData<T>(fetcher: () => Promise<T>, deps: unknown[] = [], options: UseAsyncOptions = {}) {
  const { autoRefreshMs, immediate = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    if (!immediate) {
      return;
    }
    refresh();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoRefreshMs) {
      return;
    }
    const id = setInterval(() => {
      refresh();
    }, autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefreshMs, refresh]);

  return useMemo(
    () => ({
      data,
      loading,
      error,
      refresh,
    }),
    [data, loading, error, refresh],
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

// Loads data whenever the screen gains focus; exposes reload for pull-to-refresh.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  const run = useCallback(async (silent = false) => {
    const id = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const d = await fn();
      if (id === seq.current) { setData(d); setError(null); }
    } catch (e: any) {
      if (id === seq.current) setError(e.message || 'Something went wrong');
    } finally {
      if (id === seq.current) { setLoading(false); setRefreshing(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useFocusEffect(useCallback(() => { void run(data !== null); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]));

  const refresh = useCallback(() => { setRefreshing(true); void run(true); }, [run]);
  return { data, error, loading, refreshing, reload: run, refresh, setData };
}

export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

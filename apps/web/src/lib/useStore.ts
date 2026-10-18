import { useCallback, useSyncExternalStore } from 'react';
import { readStore, subscribeStore, writeStore } from './storage';

/** A localStorage-backed value that re-renders on change. Reads are raw strings so the snapshot is stable. */
export function useStore<T>(key: string, fallback: T): [T, (v: T | undefined) => void] {
  const subscribe = useCallback((cb: () => void) => subscribeStore(key, cb), [key]);
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  let value = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  const set = useCallback((v: T | undefined) => writeStore(key, v), [key]);
  return [value, set];
}

export { readStore, writeStore };

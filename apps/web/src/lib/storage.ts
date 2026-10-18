/** localStorage that never throws (private windows, blocked storage, previews), with change notifications for hooks. */
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStore(key: string, value: unknown): void {
  try {
    if (value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep working in memory */
  }
  listeners.get(key)?.forEach((l) => l());
}

export function subscribeStore(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  return () => void set?.delete(listener);
}

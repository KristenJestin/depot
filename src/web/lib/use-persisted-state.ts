import * as React from "react";

/**
 * State backed by `localStorage` so a preference survives reloads. Reads the
 * stored value lazily on first render and falls back to `initial` when the key
 * is absent or storage is unavailable (SSR, private mode, parse failure).
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = React.useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore quota/availability errors — persistence is best-effort.
    }
  }, [key, value]);

  return [value, setValue];
}

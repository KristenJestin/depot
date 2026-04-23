let _debug = false;
let _jsonMode = false;

// ── Debug flag ───────────────────────────────────────────────────────────────

export function setDebug(enabled: boolean): void {
  _debug = enabled;
}

export function isDebug(): boolean {
  return _debug;
}

// ── JSON mode flag ───────────────────────────────────────────────────────────

export function setJsonMode(enabled: boolean): void {
  _jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return _jsonMode;
}

// ── log ──────────────────────────────────────────────────────────────────────

export const log = {
  /** Write to stdout. */
  info(...args: unknown[]): void {
    console.log(...args);
  },

  /** Write to stderr. */
  error(...args: unknown[]): void {
    console.error(...args);
  },

  /**
   * Write to stderr with a `[debug]` prefix.
   * No-op unless `setDebug(true)` has been called.
   */
  debug(...args: unknown[]): void {
    if (_debug) {
      console.error("[debug]", ...args);
    }
  },

  /**
   * Print aligned key-value pairs to stdout.
   * Entries whose value is `null` or `undefined` are skipped automatically.
   *
   * @example
   * log.fields([["ID", id], ["Title", title], ["Context", null]]); // Context skipped
   */
  fields(entries: [string, unknown][]): void {
    const visible = entries.filter(([, v]) => v != null);
    if (visible.length === 0) return;

    // Align colons using the longest visible key
    const maxLen = Math.max(...visible.map(([k]) => k.length));
    for (const [key, value] of visible) {
      console.log(`${key.padEnd(maxLen)} : ${value}`);
    }
  },
};

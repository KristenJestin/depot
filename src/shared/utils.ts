import { monotonicFactory } from "ulid";

// ── IDs ───────────────────────────────────────────────────────────────────────

const _ulid = monotonicFactory();

export function generateId(): string {
  return _ulid();
}

// ── Paths ─────────────────────────────────────────────────────────────────────

export function normalizeWorkspacePath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function formatPathForDisplay(input: string): string {
  const normalizedInput = normalizeWorkspacePath(input);
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const normalizedHome = home ? normalizeWorkspacePath(home) : "";

  if (!normalizedHome) {
    return normalizedInput;
  }

  if (normalizedInput === normalizedHome) {
    return "~";
  }

  if (normalizedInput.startsWith(normalizedHome + "/")) {
    return `~${normalizedInput.slice(normalizedHome.length)}`;
  }

  return normalizedInput;
}

// ── Format ────────────────────────────────────────────────────────────────────

/**
 * Format a Date for human-readable CLI and context output.
 * Produces UTC timestamps in the form "2026-04-21 20:34:09Z".
 * Returns "—" for null/undefined dates.
 */
export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toISOString().slice(0, 19).replace("T", " ") + "Z";
}

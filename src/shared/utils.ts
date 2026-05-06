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

/**
 * Format a Date as a relative timestamp (e.g. "3h22m ago", "5d ago").
 * Returns "—" for null/undefined dates.
 */
export function formatRelativeTime(date: Date | null | undefined, now: Date = new Date()): string {
  if (!date) return "—";
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "in the future";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes - hours * 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h${remMinutes}m ago` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format an absolute date with a relative tag, e.g. "2026-04-30 21:21:04Z (3h22m ago)".
 */
export function formatDateWithRelative(date: Date | null | undefined): string {
  if (!date) return "—";
  return `${formatDate(date)} (${formatRelativeTime(date)})`;
}

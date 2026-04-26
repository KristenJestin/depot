export function relativeDate(ms: number | null): string | null {
  if (!ms) return null;
  const diff = Date.now() - ms;
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function parseDesc(
  raw: string,
): { intent?: string; scope?: string; nongoals?: string } | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

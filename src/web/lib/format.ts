export function relativeDate(value: number | string | Date | null | undefined): string | null {
  if (value == null) return null;
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? new Date(value).getTime()
        : value;
  if (!ms || isNaN(ms)) return null;

  const now = new Date();
  const d = new Date(ms);
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const itemMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const calendarDays = Math.round((todayMidnight - itemMidnight) / 86_400_000);

  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");

  if (calendarDays === 0) return `today at ${hh}:${mm}`;
  if (calendarDays === 1) return `yesterday at ${hh}:${mm}`;
  return `${calendarDays} days ago`;
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

import { cn } from "#/web/lib/utils";

const CIRCUMFERENCE = 31.41592653589793;

export function KanbanProgressRing({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  const dash = (clamped / 100) * CIRCUMFERENCE;

  return (
    <span className={cn("inline-flex items-center gap-1 font-medium text-foreground", className)}>
      <svg className="size-3" viewBox="0 0 12 12" aria-hidden="true">
        <circle
          cx="6"
          cy="6"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-border"
        />
        <circle
          cx="6"
          cy="6"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
          strokeDashoffset={CIRCUMFERENCE / 4}
          strokeLinecap="round"
          className="text-primary"
        />
      </svg>
      {clamped}%
    </span>
  );
}

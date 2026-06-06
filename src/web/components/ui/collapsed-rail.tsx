import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "#/web/lib/utils";

/**
 * Thin vertical re-open button pinned to either edge of a collapsed side
 * pane. Renders a chevron pointing inward, an optional badge (typically a
 * count), and a vertically-set title (`writing-mode: vertical-rl`). Shared
 * across `ThreePane` (Tasks / Activity rails on the PRD detail page) and the
 * prototype workspace feedback panel so the collapsed affordance and its
 * hover treatment stay identical wherever a side pane is closed.
 */
export function CollapsedRail({
  side,
  title,
  badge,
  onOpen,
  className,
}: {
  side: "left" | "right";
  title: string;
  badge?: React.ReactNode;
  onOpen: () => void;
  className?: string;
}) {
  const Chevron = side === "left" ? ChevronRightIcon : ChevronLeftIcon;
  const borderSide = side === "left" ? "border-r" : "border-l";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Show ${title.toLowerCase()}`}
      title={`Show ${title.toLowerCase()}`}
      className={cn(
        "flex shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5",
        "px-1.5 py-2",
        "border-card-border bg-sidebar text-muted-foreground",
        borderSide,
        "transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <Chevron className="size-3.5" aria-hidden />
      {badge ?? null}
      <span
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ writingMode: "vertical-rl" }}
      >
        {title}
      </span>
    </button>
  );
}

import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "#/web/lib/utils";

/**
 * PRD 0026 / S3 — generic list primitive shared by the three sidebar
 * widgets (Tags, Milestone, Dependencies). It imposes the leading-icon
 * slot, the row/pill hover and the position + size of the remove button;
 * the caller stays in charge of the item's own content via render props.
 *
 * Pure presentational primitive: no fetching, no React Query.
 *
 * - `layout: "pills"` → flex-wrap of badge-like items (used by Tags and by
 *   Milestone in read mode).
 * - `layout: "rows"` → vertical stack of card-like rows (used by
 *   Dependencies).
 */
export type SidebarItemListProps<T> = {
  items: T[];
  emptyLabel: string;
  layout: "pills" | "rows";
  renderIcon: (item: T) => ReactNode;
  renderLabel: (item: T) => ReactNode;
  getKey: (item: T) => string;
  onRemove?: (item: T) => void;
  pending?: boolean;
};

export function SidebarItemList<T>({
  items,
  emptyLabel,
  layout,
  renderIcon,
  renderLabel,
  getKey,
  onRemove,
  pending,
}: SidebarItemListProps<T>) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className={cn(layout === "pills" ? "flex flex-wrap gap-1.5" : "flex flex-col gap-1.5")}>
      {items.map((item) => {
        const key = getKey(item);
        const removeLabel = `Remove ${key}`;
        return (
          <li
            key={key}
            className={cn(
              layout === "pills"
                ? "inline-flex items-center gap-1 rounded-md border border-transparent bg-muted px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                : "flex items-center justify-between gap-2 rounded-md border border-card-border bg-card px-2 py-1.5 text-xs transition-colors hover:bg-accent",
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground">
                {renderIcon(item)}
              </span>
              <span className="min-w-0 flex-1 truncate">{renderLabel(item)}</span>
            </span>
            {onRemove ? (
              <button
                type="button"
                aria-label={removeLabel}
                onClick={() => onRemove(item)}
                disabled={pending}
                className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XIcon className="size-2.5" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

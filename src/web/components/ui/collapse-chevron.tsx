import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";

import { CollapsibleTrigger } from "#/web/components/ui/collapsible";
import { cn } from "#/web/lib/utils";

/**
 * Animated chevron paired with a base-ui Collapsible or Accordion trigger.
 *
 * Picks up the trigger's `data-panel-open` via the `group` modifier — the
 * parent trigger element MUST carry the `group` class for the rotation to
 * fire. base-ui sets `data-panel-open` only on the trigger itself, not on
 * its children, so descendant selectors won't work without `group`.
 */
export function CollapseChevron({
  direction = "down",
  size = "md",
  className,
}: {
  /** "down" rotates 180° on open. "right" rotates 90° on open (tree style). */
  direction?: "down" | "right";
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = direction === "right" ? ChevronRightIcon : ChevronDownIcon;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        size === "sm" ? "size-3" : "size-4",
        "shrink-0 transition-transform duration-200 ease-out",
        direction === "right"
          ? "group-data-[panel-open]:rotate-90"
          : "group-data-[panel-open]:rotate-180",
        className,
      )}
    />
  );
}

/**
 * Standalone toggle button: a Collapsible.Trigger styled as a small icon
 * button with hover affordance, containing a CollapseChevron. Use when the
 * trigger is meant to be just the icon (e.g. card header toggle), not a
 * clickable row.
 */
export function CollapseToggleButton({
  ariaLabel,
  className,
  ...props
}: { ariaLabel: string } & Omit<
  React.ComponentPropsWithoutRef<typeof CollapsibleTrigger>,
  "children" | "aria-label"
>) {
  return (
    <CollapsibleTrigger
      aria-label={ariaLabel}
      className={cn(
        "group inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
      {...props}
    >
      <CollapseChevron />
    </CollapsibleTrigger>
  );
}

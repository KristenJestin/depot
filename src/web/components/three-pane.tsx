import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";

import { CollapsedRail } from "#/web/components/ui/collapsed-rail";
import { cn } from "#/web/lib/utils";

/**
 * `three-pane` working layout (coss-ui): a left rail, a flexible center pane,
 * and a right rail. Both side rails are collapsible — they slide to zero
 * content width while keeping a thin vertical re-open tab pinned to the edge
 * (chevron + vertical title) so the user always has a way back without
 * leaving the layout.
 */

type PaneSide = "left" | "right";

function PaneRail({
  side,
  open,
  title,
  width,
  badge,
  onOpen,
  onClose,
  children,
}: {
  side: PaneSide;
  open: boolean;
  title: string;
  width: string;
  badge?: React.ReactNode;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const borderSide = side === "left" ? "border-r" : "border-l";
  const CloseIcon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <>
      {!open ? <CollapsedRail side={side} title={title} badge={badge} onOpen={onOpen} /> : null}
      <aside
        aria-hidden={!open}
        inert={!open ? true : undefined}
        className={cn(
          "flex shrink-0 flex-col overflow-hidden bg-card transition-[width,opacity,border-color] duration-200 ease-out",
          open
            ? cn(width, borderSide, "border-card-border opacity-100")
            : cn("w-0", borderSide, "border-transparent opacity-0 pointer-events-none"),
        )}
      >
        <div className="flex items-center justify-between border-b border-card-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Close ${title.toLowerCase()}`}
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </aside>
    </>
  );
}

export function ThreePane({
  left,
  leftTitle,
  leftOpen,
  onLeftOpen,
  onLeftClose,
  leftWidth = "w-72",
  leftBadge,
  center,
  right,
  rightTitle,
  rightOpen,
  onRightOpen,
  onRightClose,
  rightWidth = "w-80",
  rightBadge,
}: {
  left: React.ReactNode;
  leftTitle: string;
  leftOpen: boolean;
  onLeftOpen: () => void;
  onLeftClose: () => void;
  leftWidth?: string;
  leftBadge?: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
  rightTitle: string;
  rightOpen: boolean;
  onRightOpen: () => void;
  onRightClose: () => void;
  rightWidth?: string;
  rightBadge?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <PaneRail
        side="left"
        open={leftOpen}
        title={leftTitle}
        width={leftWidth}
        badge={leftBadge}
        onOpen={onLeftOpen}
        onClose={onLeftClose}
      >
        {left}
      </PaneRail>

      <div className="flex min-w-0 flex-1 flex-col">{center}</div>

      <PaneRail
        side="right"
        open={rightOpen}
        title={rightTitle}
        width={rightWidth}
        badge={rightBadge}
        onOpen={onRightOpen}
        onClose={onRightClose}
      >
        {right}
      </PaneRail>
    </div>
  );
}

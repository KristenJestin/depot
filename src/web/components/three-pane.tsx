import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";

import { cn } from "#/web/lib/utils";

/**
 * `three-pane` working layout (coss-ui): a left rail, a flexible center pane,
 * and a right rail. Both side rails are collapsible — they slide to zero width
 * while keeping their toggle reachable from the center pane's top bar.
 */

type PaneSide = "left" | "right";

function PaneRail({
  side,
  open,
  title,
  width,
  onClose,
  children,
}: {
  side: PaneSide;
  open: boolean;
  title: string;
  width: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const borderSide = side === "left" ? "border-r" : "border-l";
  const CloseIcon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <aside
      aria-hidden={!open}
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
  );
}

export function ThreePane({
  left,
  leftTitle,
  leftOpen,
  onLeftClose,
  leftWidth = "w-72",
  center,
  right,
  rightTitle,
  rightOpen,
  onRightClose,
  rightWidth = "w-80",
}: {
  left: React.ReactNode;
  leftTitle: string;
  leftOpen: boolean;
  onLeftClose: () => void;
  leftWidth?: string;
  center: React.ReactNode;
  right: React.ReactNode;
  rightTitle: string;
  rightOpen: boolean;
  onRightClose: () => void;
  rightWidth?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <PaneRail
        side="left"
        open={leftOpen}
        title={leftTitle}
        width={leftWidth}
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
        onClose={onRightClose}
      >
        {right}
      </PaneRail>
    </div>
  );
}

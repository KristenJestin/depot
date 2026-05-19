import * as React from "react";
import { cn } from "#/web/lib/utils";

/**
 * Horizontal resizable split. Two children separated by a draggable divider.
 *
 * Width is persisted in localStorage when `storageKey` is provided. Falls back
 * to `defaultLeftWidth` (px) when no persisted value exists.
 *
 * Intentionally minimal — no library, no virtualization, just a draggable
 * divider that resizes the left pane in pixels. Right pane fills the rest.
 */
export interface ResizableSplitProps {
  left: React.ReactNode;
  right: React.ReactNode;
  storageKey?: string;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  className?: string;
}

export function ResizableSplit({
  left,
  right,
  storageKey,
  defaultLeftWidth = 320,
  minLeftWidth = 200,
  maxLeftWidth = 720,
  className,
}: ResizableSplitProps) {
  const [width, setWidth] = React.useState<number>(() => {
    if (storageKey && typeof window !== "undefined") {
      const stored = window.localStorage.getItem(storageKey);
      const parsed = stored ? Number(stored) : NaN;
      if (Number.isFinite(parsed) && parsed >= minLeftWidth && parsed <= maxLeftWidth) {
        return parsed;
      }
    }
    return defaultLeftWidth;
  });
  const dragging = React.useRef(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
  };

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = Math.min(maxLeftWidth, Math.max(minLeftWidth, e.clientX - rect.left));
      setWidth(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      if (storageKey) window.localStorage.setItem(storageKey, String(width));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [maxLeftWidth, minLeftWidth, storageKey, width]);

  return (
    <div ref={containerRef} className={cn("flex min-h-0 flex-1", className)}>
      <div style={{ width }} className="shrink-0 overflow-auto">
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        className="w-1 shrink-0 cursor-col-resize bg-card-border transition-colors hover:bg-primary/40"
      />
      <div className="min-w-0 flex-1 overflow-auto">{right}</div>
    </div>
  );
}

/**
 * Bottom-pinned floating toolbar. Renders above the page content with a
 * shadow so the buttons stay visible regardless of scroll position.
 */
export function FloatingToolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 flex items-center gap-2 border-t border-card-border bg-card/95 px-4 py-2 shadow-card-hover backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

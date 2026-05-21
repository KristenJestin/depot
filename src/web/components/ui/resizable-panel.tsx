import * as React from "react";

import { cn } from "#/web/lib/utils";

/**
 * Horizontal `split-resizable` layout: a fixed-width-but-draggable left pane
 * and a right pane that fills the remaining space.
 *
 * The left pane width is held in a ref during a drag so the pointer handlers
 * never re-bind mid-gesture (the earlier implementation kept `width` in the
 * effect deps, which captured a stale value on pointer-up). React state is
 * updated for rendering; `localStorage` persistence happens once on release.
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
  minLeftWidth = 220,
  maxLeftWidth = 640,
  className,
}: ResizableSplitProps) {
  const clamp = React.useCallback(
    (value: number) => Math.min(maxLeftWidth, Math.max(minLeftWidth, value)),
    [maxLeftWidth, minLeftWidth],
  );

  const [width, setWidth] = React.useState<number>(() => {
    if (storageKey && typeof window !== "undefined") {
      const stored = window.localStorage.getItem(storageKey);
      const parsed = stored ? Number(stored) : NaN;
      if (Number.isFinite(parsed)) return clamp(parsed);
    }
    return defaultLeftWidth;
  });

  const widthRef = React.useRef(width);
  widthRef.current = width;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);

  React.useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setWidth(clamp(event.clientX - rect.left));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, String(widthRef.current));
        } catch {
          // Persistence is best-effort — ignore quota / availability errors.
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [clamp, storageKey]);

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const nudge = (delta: number) => setWidth((current) => clamp(current + delta));

  return (
    <div ref={containerRef} className={cn("flex min-h-0 flex-1", className)}>
      <div style={{ width }} className="flex min-h-0 shrink-0 flex-col overflow-hidden">
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            nudge(-16);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            nudge(16);
          }
        }}
        className="w-1 shrink-0 cursor-col-resize bg-card-border transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{right}</div>
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

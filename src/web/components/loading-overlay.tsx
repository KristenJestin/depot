import type { ReactNode } from "react";

type Props = {
  /** When true, the overlay is rendered. Otherwise children render normally. */
  active: boolean;
  /** Content covered by the overlay. */
  children: ReactNode;
  /** Optional small label rendered next to the spinner. */
  label?: string;
  /** Tailwind classes to override container layout (default: relative). */
  className?: string;
};

/**
 * Wraps a region with a translucent veil + spinning loader when `active`.
 * Use to indicate "this whole zone is being processed".
 *
 * For a small inline indicator (next to a label or replacing an icon),
 * use `<Spinner />` directly instead.
 */
export function LoadingOverlay({ active, children, label, className }: Props) {
  return (
    <div className={["relative", className].filter(Boolean).join(" ")}>
      {children}
      {active ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] bg-card/55 backdrop-blur-[1px]"
          aria-hidden="true"
        >
          <div className="flex items-center gap-2 rounded-full bg-card/90 px-3 py-1.5 shadow-sm ring-1 ring-card-border">
            <Spinner />
            {label ? <span className="text-xs font-medium text-foreground">{label}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type SpinnerProps = {
  className?: string;
};

/**
 * Small circular spinner with a faint background ring + a rotating arc on top.
 * Default size is 3.5 (≈14px); pass `size-N` via `className` to override.
 */
export function Spinner({ className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={["relative inline-block", className ?? "size-3.5"].join(" ")}
    >
      <span className="absolute inset-0 rounded-full border-2 border-primary/25" />
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
    </span>
  );
}

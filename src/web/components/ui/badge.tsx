import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "#/web/lib/utils";

const badgeVariants = cva(
  cn(
    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium leading-none",
    "whitespace-nowrap transition-colors",
  ),
  {
    variants: {
      variant: {
        neutral: "border-border bg-secondary text-secondary-foreground",
        success: "border-success/30 bg-success-soft text-success-foreground",
        subtle: "border-transparent bg-muted text-muted-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        current: "border-transparent bg-secondary text-foreground",
        statusDraft: "border-transparent bg-status-draft-soft text-status-draft-foreground",
        statusReady: "border-transparent bg-status-ready-soft text-status-ready-foreground",
        statusInProgress:
          "border-transparent bg-status-in-progress-soft text-status-in-progress-foreground",
        statusDone: "border-transparent bg-status-done-soft text-status-done-foreground",
        statusCanceled:
          "border-transparent bg-status-canceled-soft text-status-canceled-foreground",
        severityCritical:
          "border-severity-critical/20 bg-severity-critical-soft text-severity-critical",
        severityMajor: "border-severity-major/20 bg-severity-major-soft text-severity-major",
        severityMinor: "border-severity-minor/20 bg-severity-minor-soft text-severity-minor",
        severityInfo: "border-severity-info/20 bg-severity-info-soft text-severity-info",
        // Triage axis (PRD 0020 / T1). `ready-for-agent` is the actionable
        // state — give it a distinct positive colour; the parked states reuse
        // the muted/info palette so they read as "not to take now".
        triageReady: "border-transparent bg-status-ready-soft text-status-ready-foreground",
        triageParked: "border-severity-info/20 bg-severity-info-soft text-severity-info",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };

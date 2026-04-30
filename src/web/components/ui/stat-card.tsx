import * as React from "react";

import { cn } from "#/web/lib/utils";

export interface StatCardProps {
  label: string;
  /**
   * The primary metric displayed in the card. Should use `text-3xl font-bold tabular-nums`
   * typography to match the design system contract (e.g. wrap in a `<span>` with those classes).
   */
  value: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

function StatCard({ label, value, children, className }: StatCardProps) {
  return (
    <div className={cn("rounded-xl border border-card-border bg-card p-4 shadow-card", className)}>
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">
        {label}
      </p>
      {value}
      {children}
    </div>
  );
}

export { StatCard };

import * as React from "react";

import { Card } from "#/web/components/ui/card";
import { cn } from "#/web/lib/utils";

export interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

function MetricCard({ icon, label, value, children, className }: MetricCardProps) {
  return (
    <Card className={cn("p-5 hover:border-primary/30 transition-colors", className)}>
      <div className="flex items-center gap-2 text-muted-foreground mb-3">
        <span className="shrink-0 [&_svg]:size-4">{icon}</span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      {children && <div className="mt-2">{children}</div>}
    </Card>
  );
}

export { MetricCard };

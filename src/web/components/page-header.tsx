import * as React from "react";

import { cn } from "#/web/lib/utils";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}

function PageHeader({ title, subtitle, children, className }: PageHeaderProps) {
  return (
    <header
      className={cn("flex flex-col md:flex-row md:items-center justify-between gap-4", className)}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </header>
  );
}

export { PageHeader };

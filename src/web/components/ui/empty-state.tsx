import * as React from "react";

import { cn } from "#/web/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  message: string;
  action?: React.ReactNode;
}

function EmptyState({ message, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      <p className="text-sm text-muted-foreground">{message}</p>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

export { EmptyState };

import * as React from "react";

import { cn } from "#/web/lib/utils";

export function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-w-0 flex-col">{children}</div>;
}

export function PageTopBar({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="border-b border-card-border px-3 py-3">
      <div className="flex h-9 items-center gap-4">
        <div className="min-w-0 flex-1">{children}</div>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function PageContent({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-auto", className)} {...props} />;
}

import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import * as React from "react";

import { cn } from "#/web/lib/utils";

export function CollapsibleRoot(
  props: React.ComponentPropsWithoutRef<typeof BaseCollapsible.Root>,
) {
  return <BaseCollapsible.Root {...props} />;
}

export function CollapsibleTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseCollapsible.Trigger>) {
  return <BaseCollapsible.Trigger className={cn(className)} {...props} />;
}

export function CollapsiblePanel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseCollapsible.Panel>) {
  return (
    <BaseCollapsible.Panel
      className={cn(
        "h-[var(--collapsible-panel-height)] overflow-hidden opacity-100 transition-[height,opacity] duration-250 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        className,
      )}
      keepMounted
      {...props}
    />
  );
}

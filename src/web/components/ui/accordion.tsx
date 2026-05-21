import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import * as React from "react";

import { CollapseChevron } from "#/web/components/ui/collapse-chevron";
import { cn } from "#/web/lib/utils";

export function AccordionRoot(props: React.ComponentPropsWithoutRef<typeof BaseAccordion.Root>) {
  return <BaseAccordion.Root {...props} />;
}

export function AccordionItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseAccordion.Item>) {
  return (
    <BaseAccordion.Item
      className={cn(
        "overflow-hidden rounded-xl border border-card-border bg-card shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function AccordionHeader({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseAccordion.Header>) {
  return <BaseAccordion.Header className={cn("contents", className)} {...props} />;
}

export function AccordionTrigger({
  className,
  children,
  trailing,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseAccordion.Trigger> & {
  trailing?: React.ReactNode;
}) {
  return (
    <BaseAccordion.Trigger
      className={cn(
        "group flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-panel-muted",
        "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <span className="flex items-center gap-3 text-muted-foreground">
        {trailing}
        <CollapseChevron />
      </span>
    </BaseAccordion.Trigger>
  );
}

export function AccordionPanel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseAccordion.Panel>) {
  return (
    <BaseAccordion.Panel
      className={cn(
        "h-[var(--accordion-panel-height)] overflow-hidden border-t border-card-border opacity-100 transition-[height,opacity] duration-250 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        className,
      )}
      keepMounted
      {...props}
    />
  );
}

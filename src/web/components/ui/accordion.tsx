import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { ChevronDownIcon } from "lucide-react";
import * as React from "react";

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
        "flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-panel-muted",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <span className="flex items-center gap-3 text-muted-foreground">
        {trailing}
        <ChevronDownIcon className="size-4 transition-transform data-[panel-open]:rotate-180" />
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
        "overflow-hidden border-t border-card-border data-[ending-style]:animate-out data-[starting-style]:animate-in",
        className,
      )}
      keepMounted
      {...props}
    />
  );
}

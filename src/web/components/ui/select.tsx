import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import * as React from "react";

import { cn } from "#/web/lib/utils";

export const Select = BaseSelect.Root;
export const SelectValue = BaseSelect.Value;
export const SelectGroup = BaseSelect.Group;
export const SelectLabel = BaseSelect.Label;
export const SelectGroupLabel = BaseSelect.GroupLabel;
export const SelectSeparator = BaseSelect.Separator;

type SelectTriggerProps = React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger> & {
  size?: "sm" | "default" | "lg";
};

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  function SelectTrigger({ className, size = "default", children, ...props }, ref) {
    return (
      <BaseSelect.Trigger
        ref={ref}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background text-left text-foreground shadow-sm transition-colors",
          "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
          size === "sm" && "min-h-8 px-2.5 py-1.5 text-xs",
          size === "default" && "min-h-9 px-3 py-2 text-sm",
          size === "lg" && "min-h-10 px-3.5 py-2.5 text-sm",
          className,
        )}
        {...props}
      >
        <span className="min-w-0 flex-1 truncate">{children}</span>
        <BaseSelect.Icon>
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
    );
  },
);

type SelectPopupProps = React.ComponentPropsWithoutRef<typeof BaseSelect.Popup> & {
  alignItemWithTrigger?: boolean;
  sideOffset?: number;
};

export const SelectPopup = React.forwardRef<HTMLDivElement, SelectPopupProps>(function SelectPopup(
  { className, children, alignItemWithTrigger = false, sideOffset = 4, ...props },
  ref,
) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        align="start"
        sideOffset={sideOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="z-50"
      >
        <BaseSelect.Popup
          ref={ref}
          className={cn(
            "max-h-72 min-w-[var(--anchor-width)] overflow-auto rounded-md border border-input bg-popover p-1 text-popover-foreground shadow-xl",
            "origin-[var(--transform-origin)] data-[ending-style]:animate-out data-[starting-style]:animate-in",
            className,
          )}
          {...props}
        >
          {children}
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
});

export const SelectItem = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <BaseSelect.Item
      ref={ref}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded py-1.5 pl-8 pr-2 text-sm outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemIndicator className="absolute left-2 flex size-3.5 items-center justify-center text-primary">
        <CheckIcon className="size-3.5" />
      </BaseSelect.ItemIndicator>
      <BaseSelect.ItemText className="min-w-0 flex-1 truncate">{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
});

export const SelectContent = SelectPopup;

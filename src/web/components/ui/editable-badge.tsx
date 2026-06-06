import { PencilIcon } from "lucide-react";

import { Badge, type BadgeProps } from "#/web/components/ui/badge";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "#/web/components/ui/select";
import { cn } from "#/web/lib/utils";

type BadgeVariant = BadgeProps["variant"];

/**
 * PRD 0026 / S2 — `EditableBadge` makes a `Badge` itself the trigger of a
 * base-ui `Select`. The badge displays the current value; clicking it opens
 * the option list anchored to the badge; hovering reveals a small pencil
 * hint (overlay-positioned so the badge width never shifts).
 *
 * Pure presentational primitive: no data fetching, no React Query — the
 * caller wires `onChange` to its own mutation.
 */
export type EditableBadgeProps<T extends string> = {
  value: T;
  variant: BadgeVariant;
  options: readonly T[];
  onChange: (next: T) => void;
  ariaLabel: string;
  pending?: boolean;
};

export function EditableBadge<T extends string>({
  value,
  variant,
  options,
  onChange,
  ariaLabel,
  pending,
}: EditableBadgeProps<T>) {
  return (
    <Select
      value={value}
      disabled={pending}
      onValueChange={(next) => {
        if (next !== null && next !== undefined && next !== value) {
          onChange(next as T);
        }
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        size="sm"
        className="group/editable-badge relative inline-flex h-auto min-h-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 shadow-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
        render={
          <Badge
            variant={variant}
            className={cn("relative pr-6", pending && "cursor-not-allowed opacity-60")}
          />
        }
      >
        <span className="relative inline-flex items-center">
          <span>{value}</span>
          <PencilIcon
            data-testid="editable-badge-pencil"
            aria-hidden
            className="pointer-events-none absolute right-[-1rem] top-1/2 size-3 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/editable-badge:opacity-70 group-focus-visible/editable-badge:opacity-70 group-data-[popup-open]/editable-badge:opacity-70"
          />
        </span>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

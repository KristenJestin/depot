import { Input as BaseInput } from "@base-ui/react/input";
import * as React from "react";

import { cn } from "#/web/lib/utils";

type InputProps = React.ComponentPropsWithoutRef<typeof BaseInput>;

function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput
      className={cn(
        "w-full rounded-lg border border-card-border bg-input px-3 py-2 text-sm text-foreground shadow-sm",
        "placeholder:text-muted-foreground",
        "focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "transition-shadow",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
export type { InputProps };

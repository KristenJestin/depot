import { Input as BaseInput } from "@base-ui/react/input";
import * as React from "react";

import { cn } from "#/web/lib/utils";

type InputProps = React.ComponentPropsWithoutRef<typeof BaseInput>;

function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput
      className={cn(
        "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        "aria-invalid:border-destructive/50 aria-invalid:ring-destructive/20",
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

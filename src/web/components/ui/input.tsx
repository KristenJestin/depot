import { Input as BaseInput } from "@base-ui/react/input";
import * as React from "react";

import { cn } from "#/web/lib/utils";

type InputProps = React.ComponentPropsWithoutRef<typeof BaseInput>;

function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput
      className={cn(
        "w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground",
        "placeholder:text-muted-foreground",
        "focus:outline-none focus:ring-1 focus:ring-ring",
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

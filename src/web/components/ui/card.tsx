import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "#/web/lib/utils";

const cardVariants = cva("rounded-xl border border-border bg-card text-card-foreground", {
  variants: {
    size: {
      default: "p-6",
      sm: "p-4",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

function CardRoot({ className, size, ...props }: CardProps) {
  return <div className={cn(cardVariants({ size }), className)} {...props} />;
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center justify-between gap-2 mb-4", className)} {...props} />
  );
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-display text-base font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 mt-4 pt-4 border-t border-border",
        className,
      )}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ml-auto flex items-center gap-2", className)} {...props} />;
}

const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Content: CardContent,
  Footer: CardFooter,
  Action: CardAction,
});

export { Card, cardVariants };

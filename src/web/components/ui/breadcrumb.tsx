import * as React from "react";
import { ChevronRightIcon, EllipsisIcon } from "lucide-react";

import { cn } from "#/web/lib/utils";

function Breadcrumb({ className, ...props }: React.ComponentPropsWithoutRef<"nav">) {
  return <nav aria-label="breadcrumb" className={cn(className)} {...props} />;
}

function BreadcrumbList({ className, ...props }: React.ComponentPropsWithoutRef<"ol">) {
  return (
    <ol
      className={cn("flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: React.ComponentPropsWithoutRef<"li">) {
  return <li className={cn("inline-flex items-center gap-1.5", className)} {...props} />;
}

function BreadcrumbLink({
  render,
  children,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"a"> & {
  render?: React.ReactElement<{ className?: string; children?: React.ReactNode }>;
}) {
  const cls = cn("hover:text-foreground transition-colors", className);
  if (render) {
    return React.cloneElement(render, { className: cls, children });
  }
  return (
    <a className={cls} {...props}>
      {children}
    </a>
  );
}

function BreadcrumbPage({ className, ...props }: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("font-medium text-foreground", className)}
      {...props}
    />
  );
}

function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"li">) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cn("text-muted-foreground/50", className)}
      {...props}
    >
      {children ?? <ChevronRightIcon className="size-3.5" />}
    </li>
  );
}

function BreadcrumbEllipsis({ className, ...props }: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={cn("flex h-9 w-9 items-center justify-center", className)}
      {...props}
    >
      <EllipsisIcon className="size-4" />
      <span className="sr-only">More</span>
    </span>
  );
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};

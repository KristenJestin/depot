import { ArrowRightIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Badge } from "#/web/components/ui/badge";

export function PrdNoticeBanner({
  variant,
  message,
  targetRevisionId,
}: {
  variant: "superseded" | "canceled";
  message: string;
  targetRevisionId?: string;
}) {
  return (
    <div
      className={[
        "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm",
        variant === "superseded"
          ? "border-warning/20 bg-warning-soft text-warning-foreground"
          : "border-card-border bg-status-canceled-soft text-status-canceled-foreground",
      ].join(" ")}
    >
      <Badge variant={variant === "superseded" ? "statusInProgress" : "statusCanceled"}>
        {variant}
      </Badge>
      <span className="flex-1">{message}</span>
      {targetRevisionId ? (
        <Link
          to="/prds/$id"
          params={{ id: targetRevisionId }}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View current
          <ArrowRightIcon className="size-3" />
        </Link>
      ) : null}
    </div>
  );
}

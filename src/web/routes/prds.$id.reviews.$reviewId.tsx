import * as React from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { reviewsQuery } from "../lib/queries";
import { relativeDate } from "../lib/format";
import { cn } from "../lib/utils";
import { StatusBadge } from "../components/ui/status-badge";
import { EmptyState } from "../components/ui/empty-state";
import { FindingsTable } from "../components/findings-table";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb";

export const Route = createFileRoute("/prds/$id/reviews/$reviewId")({
  loader: async ({ params }) => {
    const data = await reviewsQuery.detail.ensureQueryData(params.id, params.reviewId);
    if (!data?.review) throw notFound();
  },
  component: ReviewDetailPage,
});

const severityColor: Record<string, string> = {
  critical: "text-destructive",
  major: "text-chart-4",
  minor: "text-chart-3",
  info: "text-muted-foreground",
};

function ReviewDetailPage() {
  const { id, reviewId } = Route.useParams();
  const { data } = reviewsQuery.detail.useSuspense(id, reviewId);
  const { review, prd, findings } = data;
  const [tab, setTab] = React.useState<"findings" | "details">("findings");

  const countBySeverity = (sev: string) => findings.filter((f) => f.severity === sev).length;

  const tabClass = (t: string) =>
    t === tab
      ? "pb-3 border-b-2 border-primary text-foreground font-medium text-sm cursor-pointer"
      : "pb-3 border-b-2 border-transparent text-muted-foreground hover:text-foreground text-sm cursor-pointer";

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-10 flex flex-col gap-8 max-w-screen-2xl mx-auto">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link to="/" className="hover:text-foreground transition-colors">
                Dashboard
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <Link
                to="/prds/$id"
                params={{ id: prd.id }}
                className="hover:text-foreground transition-colors font-mono"
              >
                {prd.id}
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Review</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <h1 className="text-3xl font-bold tracking-tight capitalize">{review.type} Review</h1>
            <span
              className={cn(
                "text-2xs uppercase tracking-wider px-2 py-0.5 rounded-sm font-bold",
                review.type === "agent"
                  ? "bg-chart-1/15 text-chart-1"
                  : "bg-primary/10 text-primary",
              )}
            >
              {review.type}
            </span>
            <StatusBadge status={review.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            <Link to="/prds/$id" params={{ id: prd.id }} className="font-mono hover:underline">
              {prd.title}
            </Link>
            {" · "}
            {relativeDate(review.createdAt)}
            {review.doneAt && (
              <>
                {" · "}
                {relativeDate(review.doneAt)}
              </>
            )}
          </p>
        </div>

        {/* Tab strip */}
        <div className="flex gap-6 border-b border-border">
          <button className={tabClass("findings")} onClick={() => setTab("findings")}>
            Findings
          </button>
          <button className={tabClass("details")} onClick={() => setTab("details")}>
            Details
          </button>
        </div>

        {/* Tab content */}
        {tab === "findings" && (
          <div>
            {findings.length === 0 ? (
              <EmptyState message="No findings for this review." />
            ) : (
              <FindingsTable findings={findings} prdId={prd.id} />
            )}
          </div>
        )}

        {tab === "details" && (
          <div className="space-y-4 max-w-xl">
            {/* Severity breakdown */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h4 className="font-semibold text-sm mb-3">Findings breakdown</h4>
              <div className="divide-y divide-border">
                {(["critical", "major", "minor", "info"] as const).map((label) => (
                  <div key={label} className="flex items-center justify-between py-2 text-sm">
                    <span
                      className={cn(
                        "font-mono text-xs uppercase tracking-wider",
                        severityColor[label],
                      )}
                    >
                      {label}
                    </span>
                    <span className="font-medium tabular-nums">{countBySeverity(label)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Metadata */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h4 className="font-semibold text-sm mb-3">Metadata</h4>
              <div className="divide-y divide-border">
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">{relativeDate(review.createdAt) ?? "—"}</span>
                </div>
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-muted-foreground">Completed</span>
                  <span className="font-medium">{relativeDate(review.doneAt) ?? "—"}</span>
                </div>
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-medium">
                    <StatusBadge status={review.status} />
                  </span>
                </div>
              </div>
            </div>

            {/* User feedback */}
            {review.userFeedback && (
              <div className="bg-card border border-border rounded-xl p-5">
                <h4 className="font-semibold text-sm mb-3">Feedback</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {review.userFeedback}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

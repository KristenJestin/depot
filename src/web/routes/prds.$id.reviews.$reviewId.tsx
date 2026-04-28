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

  const countBySeverity = (sev: string) => findings.filter((f) => f.severity === sev).length;

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

        <div className="flex flex-col xl:flex-row gap-8 items-start">
          {/* Left — task list */}
          <div className="flex-1 min-w-0 space-y-6">
            <header className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
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
              <h1 className="text-3xl font-bold tracking-tight">Review</h1>
              <p className="text-sm text-muted-foreground font-mono">{prd.title}</p>
            </header>

            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h3 className="text-xl font-semibold">Findings</h3>
                <span className="text-sm font-medium text-muted-foreground">
                  {findings.length} finding{findings.length !== 1 ? "s" : ""}
                </span>
              </div>
              {findings.length === 0 ? (
                <EmptyState message="No findings for this review." />
              ) : (
                <FindingsTable findings={findings} prdId={prd.id} />
              )}
            </section>
          </div>

          {/* Right — sidebar */}
          <div className="w-full xl:w-80 shrink-0 space-y-6">
            {/* Severity breakdown */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
              <h4 className="font-semibold text-sm">Findings breakdown</h4>
              <div className="space-y-1 text-sm">
                {(["critical", "major", "minor", "info"] as const).map((label) => (
                  <div key={label} className="flex items-center justify-between py-1">
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
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
              <h4 className="font-semibold text-sm">Details</h4>
              <div className="space-y-0 text-sm divide-y divide-border">
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">{relativeDate(review.createdAt) ?? "—"}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">Completed</span>
                  <span className="font-medium">{relativeDate(review.doneAt) ?? "—"}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">Status</span>
                  <StatusBadge status={review.status} />
                </div>
              </div>
            </div>

            {/* User feedback */}
            {review.userFeedback && (
              <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
                <h4 className="font-semibold text-sm">Feedback</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {review.userFeedback}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

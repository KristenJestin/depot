import { Badge } from "#/web/components/ui/badge";
import { StatusBadge } from "#/web/components/ui/status-badge";
import { StatusDot } from "#/web/components/ui/status-dot";
import {
  SideDrawer,
  SideDrawerCloseButton,
  SideDrawerTitle,
} from "#/web/components/ui/side-drawer";
import { Markdown } from "#/web/components/markdown";
import type { PrdDetailResponse } from "#/web/lib/api-types";
import { formatMetaDate } from "#/web/lib/view-format";

type DetailReview = PrdDetailResponse["reviews"][number];
type FindingTask = DetailReview["findings"][number];

export function ReviewDrawer({
  review,
  open,
  index,
  onClose,
  onSelectFinding,
}: {
  review: DetailReview | null;
  open: boolean;
  index: number;
  onClose: () => void;
  onSelectFinding?: (taskId: string) => void;
}) {
  if (!review) {
    return (
      <SideDrawer open={open} onOpenChange={(o) => !o && onClose()} ariaLabel="Review">
        <div />
      </SideDrawer>
    );
  }

  return (
    <SideDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      ariaLabel={`Review #${index}`}
    >
      <header className="flex items-start justify-between gap-4 border-b border-card-border px-6 py-5">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Review
          </p>
          <SideDrawerTitle className="text-xl font-semibold text-foreground">
            {`Review #${index}`}
          </SideDrawerTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={review.type === "human" ? "severityInfo" : "subtle"}>
              {review.type}
            </Badge>
            {review.status === "done" ? (
              <Badge variant="statusDone">Closed</Badge>
            ) : (
              <StatusBadge status={review.status} />
            )}
            <span className="text-xs text-muted-foreground">
              {review.findings.length} finding{review.findings.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <SideDrawerCloseButton />
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
        {review.userFeedback ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">User feedback</h3>
            <div className="rounded-xl border border-card-border bg-panel-muted px-4 py-3 text-sm">
              <Markdown source={review.userFeedback} />
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Details</h3>
          <div className="space-y-3 rounded-xl border border-card-border bg-card p-4 text-sm">
            <MetaRow label="Created" value={formatMetaDate(review.createdAt)} />
            <MetaRow label="Closed" value={review.doneAt ? formatMetaDate(review.doneAt) : "—"} />
            <MetaRow label="Type" value={review.type} />
            <MetaRow label="Status" value={<StatusBadge status={review.status} />} />
            {review.phaseNumber !== null && review.phaseNumber !== undefined ? (
              <MetaRow label="Phase" value={`#${review.phaseNumber}`} />
            ) : null}
          </div>
        </section>

        {review.findings.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Findings</h3>
            <div className="space-y-2">
              {review.findings.map((finding) => (
                <FindingRow key={finding.id} finding={finding} onSelect={onSelectFinding} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </SideDrawer>
  );
}

function FindingRow({
  finding,
  onSelect,
}: {
  finding: FindingTask;
  onSelect?: (taskId: string) => void;
}) {
  const Component = onSelect ? "button" : "div";
  return (
    <Component
      type={onSelect ? "button" : undefined}
      onClick={onSelect ? () => onSelect(finding.id) : undefined}
      className={[
        "flex w-full items-start gap-2 rounded-lg border border-card-border bg-card p-3 text-left",
        onSelect ? "transition-colors hover:bg-panel-muted" : "",
      ].join(" ")}
    >
      <StatusDot
        tone={
          finding.status === "done"
            ? "done"
            : finding.status === "in_progress"
              ? "active"
              : finding.status === "blocked"
                ? "blocked"
                : finding.status === "skipped"
                  ? "skipped"
                  : "pending"
        }
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm leading-5 text-secondary-foreground">{finding.title}</p>
        <div className="flex items-center gap-2">
          {finding.severity ? (
            <Badge
              variant={
                finding.severity === "critical"
                  ? "severityCritical"
                  : finding.severity === "major"
                    ? "severityMajor"
                    : finding.severity === "minor"
                      ? "severityMinor"
                      : "severityInfo"
              }
            >
              {finding.severity}
            </Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">{finding.status.replace("_", " ")}</span>
        </div>
      </div>
    </Component>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-card-border pb-3 last:border-b-0 last:pb-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-secondary-foreground">{value}</span>
    </div>
  );
}

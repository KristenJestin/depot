import { StatusDot } from "#/web/components/ui/status-dot";

type TaskIndicatorStatus = "pending" | "in_progress" | "blocked" | "done" | "skipped" | "stopped";

const toneByStatus: Record<TaskIndicatorStatus, React.ComponentProps<typeof StatusDot>["tone"]> = {
  pending: "pending",
  in_progress: "active",
  blocked: "blocked",
  done: "done",
  skipped: "skipped",
  stopped: "stopped",
};

export function TaskIndicator({ status }: { status: TaskIndicatorStatus }) {
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      {status === "in_progress" ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-spin rounded-full border border-primary/20 border-t-primary"
        />
      ) : null}
      <StatusDot tone={toneByStatus[status]} className="mt-0" />
    </span>
  );
}

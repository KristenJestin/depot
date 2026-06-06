import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Badge } from "#/web/components/ui/badge";
import { EditableBadge } from "#/web/components/ui/editable-badge";
import { cn } from "#/web/lib/utils";
import { VALID_PRD_PRIORITIES, type PrdPriority } from "#/shared/validator";

/**
 * Visual mapping for the 4 priority levels (PRD 0019 / T5). Reuses the
 * severity palette so the page palette stays consistent: critical = red,
 * high = orange (severity-major), normal = neutral, low = subtle/grey.
 */
function priorityVariant(priority: PrdPriority): React.ComponentProps<typeof Badge>["variant"] {
  switch (priority) {
    case "critical":
      return "severityCritical";
    case "high":
      return "severityMajor";
    case "normal":
      return "neutral";
    case "low":
      return "subtle";
  }
}

export function PrdPriorityBadge({
  priority,
  className,
}: {
  priority: PrdPriority;
  className?: string;
}) {
  return (
    <Badge variant={priorityVariant(priority)} className={cn(className)}>
      {priority}
    </Badge>
  );
}

/**
 * PRD 0026 / S2 — Editable priority badge. The badge itself is the trigger of
 * a base-ui `Select`; clicking it opens the four priority options. The actual
 * mutation lives here so consumers stay one-line: `PATCH /api/prds/:id/priority`
 * is invoked on selection, and both the list (`["prds"]`) and the detail
 * (`["prds", prdId]`) queries are invalidated so the UI reflects the new
 * value and its matching activity_log entry without a full reload.
 *
 * Replaces the older `PrdPriorityDropdown` (label + standalone `Select`)
 * that lived next to a read-only `PrdPriorityBadge` — those two are now one
 * piece, the badge is the dropdown.
 */
export function PrdPriorityBadgeEditable({
  prdId,
  priority,
}: {
  prdId: string;
  priority: PrdPriority;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (next: PrdPriority) => {
      const res = await fetch(`/api/prds/${prdId}/priority`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priority: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["prds", prdId] });
      void queryClient.invalidateQueries({ queryKey: ["prds"] });
    },
  });

  return (
    <EditableBadge<PrdPriority>
      value={priority}
      variant={priorityVariant(priority)}
      options={VALID_PRD_PRIORITIES}
      onChange={(next) => mutation.mutate(next)}
      ariaLabel="PRD priority"
      pending={mutation.isPending}
    />
  );
}

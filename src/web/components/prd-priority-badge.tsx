import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Badge } from "#/web/components/ui/badge";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";
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
 * Editable priority dropdown — shown on the PRD detail page header. Posts
 * to `PATCH /api/prds/:id/priority` and invalidates the detail query so the
 * page picks up the new value (and the matching activity_log entry) without
 * a full reload.
 */
export function PrdPriorityDropdown({ prdId, priority }: { prdId: string; priority: PrdPriority }) {
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
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <span>Priority:</span>
      <Select
        value={priority}
        disabled={mutation.isPending}
        onValueChange={(value) => {
          if (value) mutation.mutate(value as PrdPriority);
        }}
      >
        <SelectTrigger
          aria-label="PRD priority"
          className="min-h-7 w-24 px-2 py-1 text-xs"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {VALID_PRD_PRIORITIES.map((p) => (
            <SelectItem key={p} value={p}>
              {p}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  );
}

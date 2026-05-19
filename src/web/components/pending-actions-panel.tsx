import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { Button } from "#/web/components/ui/button";
import { Badge } from "#/web/components/ui/badge";
import { OpenInChatButton } from "#/web/components/open-in-chat-button";

type PendingItem = {
  id: string;
  kind: string;
  slashCommand: string;
  humanReadableLabel: string;
  status: string;
  createdAt: string;
  sourcePrdId: string | null;
};

export function PendingActionsPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const pendingQ = useQuery({
    queryKey: ["projects", projectId, "pending-actions"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/pending-actions?status=pending`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: PendingItem[] };
    },
    refetchInterval: 8000,
  });

  const dismissM = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/projects/${projectId}/pending-actions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "pending-actions"],
      });
    },
  });

  if (pendingQ.isLoading) return null;
  const items = pendingQ.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border border-card-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Pending actions</h2>
        <Badge variant="subtle">{items.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Open your claude-code or opencode session — the SessionStart hook will surface these. Or
        copy the slash command directly.
      </p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 rounded-md border border-card-border/60 bg-background p-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{item.humanReadableLabel}</p>
              <p className="truncate text-xs text-muted-foreground">{item.slashCommand}</p>
            </div>
            <OpenInChatButton slashCommand={item.slashCommand} label="Copy" />
            <Button variant="ghost" size="sm" onClick={() => dismissM.mutate(item.id)}>
              Dismiss
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

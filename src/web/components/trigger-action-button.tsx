import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { Button } from "#/web/components/ui/button";

export type PendingActionKind =
  | "advance-phase"
  | "resume-with-review"
  | "run-doc-sync"
  | "run-ship"
  | "submit-review"
  | "custom";

export interface TriggerActionButtonProps {
  projectId: string;
  kind: PendingActionKind;
  slashCommand: string;
  humanReadableLabel: string;
  sourcePrdId?: string;
  payload?: Record<string, unknown>;
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg";
  children: React.ReactNode;
}

/**
 * Queues a pending action on the project. The "open in chat" fallback is
 * always available via the secondary action so users without the SessionStart
 * hook can still copy/paste the slash command into their terminal.
 */
export function TriggerActionButton({
  projectId,
  kind,
  slashCommand,
  humanReadableLabel,
  sourcePrdId,
  payload,
  variant = "primary",
  size = "sm",
  children,
}: TriggerActionButtonProps) {
  const queryClient = useQueryClient();
  const [toast, setToast] = React.useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const pushM = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/pending-actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          slashCommand,
          humanReadableLabel,
          sourcePrdId,
          payload,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { item: { id: string } };
    },
    onSuccess: () => {
      setToast({ kind: "success", message: "Action queued — open your chat to pick it up." });
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "pending-actions"],
      });
      setTimeout(() => setToast(null), 4000);
    },
    onError: (err) => {
      setToast({ kind: "error", message: (err as Error).message });
      setTimeout(() => setToast(null), 4000);
    },
  });

  const copy = () => {
    void navigator.clipboard.writeText(slashCommand);
    setToast({ kind: "success", message: `Copied: ${slashCommand}` });
    setTimeout(() => setToast(null), 1800);
  };

  return (
    <span className="relative inline-flex items-center gap-2">
      <Button
        variant={variant}
        size={size}
        onClick={() => pushM.mutate()}
        disabled={pushM.isPending}
        title={humanReadableLabel}
      >
        {children}
      </Button>
      <Button variant="ghost" size="sm" onClick={copy} title="Copy slash command">
        Copy
      </Button>
      {toast && (
        <span
          className={
            toast.kind === "success"
              ? "absolute left-0 top-full mt-1 whitespace-nowrap rounded bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-200"
              : "absolute left-0 top-full mt-1 whitespace-nowrap rounded bg-destructive/20 px-2 py-1 text-[11px] text-destructive"
          }
        >
          {toast.message}
        </span>
      )}
    </span>
  );
}

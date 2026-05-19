import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { Button } from "#/web/components/ui/button";

type GitStatus = {
  ok: true;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: Array<{ path: string; status: string; staged: boolean }>;
};

export function PushButton({ prdId }: { prdId: string }) {
  const queryClient = useQueryClient();
  const statusQ = useQuery({
    queryKey: ["prds", prdId, "git-status"],
    queryFn: async () => {
      const res = await fetch(`/api/prds/${prdId}/git-status`);
      if (!res.ok) return null;
      return (await res.json()) as GitStatus;
    },
  });

  const pushM = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/prds/${prdId}/push`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { branch: string; commitsPushed: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["prds", prdId, "git-status"] });
    },
  });

  const ahead = statusQ.data?.ahead ?? 0;
  if (ahead === 0) return null;

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => pushM.mutate()}
      disabled={pushM.isPending}
      title={pushM.error ? (pushM.error as Error).message : `Push ${ahead} commit(s)`}
    >
      {pushM.isPending ? "Pushing…" : `Push (${ahead})`}
    </Button>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@base-ui/react/dialog";
import * as React from "react";

import { Button } from "#/web/components/ui/button";
import { Checkbox } from "#/web/components/ui/checkbox";
import { Textarea } from "#/web/components/ui/textarea";

type GitStatus = {
  ok: true;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: Array<{ path: string; status: string; staged: boolean }>;
};

export function CommitForm({
  prdId,
  suggestedCommitMessage,
  onCommitted,
}: {
  prdId: string;
  suggestedCommitMessage?: string | null;
  onCommitted?: (sha: string) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [unchecked, setUnchecked] = React.useState<Set<string>>(new Set());

  const statusQ = useQuery({
    queryKey: ["prds", prdId, "git-status"],
    queryFn: async () => {
      const res = await fetch(`/api/prds/${prdId}/git-status`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as GitStatus;
    },
    enabled: open,
  });

  const commitM = useMutation({
    mutationFn: async () => {
      const files = (statusQ.data?.files ?? []).map((f) => f.path).filter((p) => !unchecked.has(p));
      const res = await fetch(`/api/prds/${prdId}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, files }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { sha: string; message: string; filesChanged: number };
    },
    onSuccess: ({ sha }) => {
      setOpen(false);
      setMessage("");
      onCommitted?.(sha);
      void queryClient.invalidateQueries({ queryKey: ["prds", prdId] });
    },
  });

  const toggle = (path: string) => {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const fileCount = statusQ.data?.files.length ?? 0;
  const selectedCount = fileCount - unchecked.size;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button variant="primary" size="sm" />}>
        Commit reviewed parts
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(640px,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-card-border bg-card p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Commit working tree</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">
            {statusQ.data?.branch ? `Branch: ${statusQ.data.branch}` : "Resolving git status…"}
          </Dialog.Description>

          <label className="mt-4 block text-xs font-medium text-muted-foreground">
            Commit message
          </label>
          {suggestedCommitMessage && (
            <div className="mt-1 rounded-md border border-input bg-background p-3 text-xs">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-medium text-muted-foreground">Suggested message</span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  onClick={() => setMessage(suggestedCommitMessage)}
                >
                  Use suggestion
                </Button>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
                {suggestedCommitMessage}
              </pre>
            </div>
          )}
          <Textarea
            className="mt-1"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="feat(scope): description"
          />

          <label className="mt-4 block text-xs font-medium text-muted-foreground">
            Files ({selectedCount}/{fileCount} selected)
          </label>
          <div className="mt-1 max-h-48 overflow-auto rounded-md border border-card-border bg-background p-2 text-xs">
            {statusQ.isLoading && <span className="text-muted-foreground">Loading…</span>}
            {statusQ.error && (
              <span className="text-destructive">{(statusQ.error as Error).message}</span>
            )}
            {statusQ.data?.files.length === 0 && (
              <span className="text-muted-foreground">Working tree is clean.</span>
            )}
            {statusQ.data?.files.map((f) => (
              <label key={f.path} className="flex items-center gap-2 py-0.5">
                <Checkbox checked={!unchecked.has(f.path)} onCheckedChange={() => toggle(f.path)} />
                <span className="font-mono">{f.path}</span>
                <span className="ml-auto text-[10px] uppercase text-muted-foreground">
                  {f.status}
                </span>
              </label>
            ))}
          </div>

          {commitM.error && (
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
              {(commitM.error as Error).message}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => commitM.mutate()}
              disabled={!message.trim() || selectedCount === 0 || commitM.isPending}
            >
              {commitM.isPending ? "Committing…" : "Commit"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

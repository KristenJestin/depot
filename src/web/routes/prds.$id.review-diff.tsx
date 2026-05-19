import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, FolderTreeIcon, ListTreeIcon } from "lucide-react";
import * as React from "react";

import { CommitForm } from "#/web/components/commit-form";
import { DiffTree, type DiffTreeFile } from "#/web/components/diff-tree";
import { DiffViewer, type DiffAnnotation } from "#/web/components/diff-viewer";
import { OpenInChatButton } from "#/web/components/open-in-chat-button";
import { PrdContextPanel, type PrdContextPanelData } from "#/web/components/prd-context-panel";
import { PushButton } from "#/web/components/push-button";
import { PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { Button } from "#/web/components/ui/button";
import { DotLoader } from "#/web/components/ui/dot-loader";
import { FloatingToolbar } from "#/web/components/ui/resizable-panel";
import { prdsQuery } from "#/web/lib/queries";
import { cn } from "#/web/lib/utils";

type DiffResponse = {
  mode: "working-tree" | "phase" | "full";
  since: string | null;
  until: string | null;
  diff: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
};

export const Route = createFileRoute("/prds/$id/review-diff")({
  component: ReviewDiffRoute,
});

function ReviewDiffRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [annotations, setAnnotations] = React.useState<DiffAnnotation[]>([]);
  const [phase, setPhase] = React.useState<number | null>(null);
  const [treeOpen, setTreeOpen] = React.useState(false);
  const [contextOpen, setContextOpen] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null);

  const prdQ = prdsQuery.detail.useSuspense(id);

  const diffQ = useQuery({
    queryKey: ["prds", id, "diff", phase],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (phase !== null) params.set("phase", String(phase));
      const url = `/api/prds/${id}/diff${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DiffResponse;
    },
  });

  const treeQ = useQuery({
    queryKey: ["prds", id, "diff-tree", phase],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (phase !== null) params.set("phase", String(phase));
      const url = `/api/prds/${id}/diff-tree${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { files: DiffTreeFile[] };
    },
    enabled: treeOpen,
  });

  const contextQ = useQuery({
    queryKey: ["prds", id, "context-panel", phase],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (phase !== null) params.set("phase", String(phase));
      const res = await fetch(
        `/api/prds/${id}/context-panel${params.toString() ? `?${params}` : ""}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PrdContextPanelData;
    },
    enabled: contextOpen,
  });

  const commitSuggestionQ = useQuery({
    queryKey: ["prds", id, "commit-suggestion", phase],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (phase !== null) params.set("phase", String(phase));
      const res = await fetch(
        `/api/prds/${id}/commit-suggestion${params.toString() ? `?${params}` : ""}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as {
        phase: number | null;
        phaseSuggestedCommitMessage: string | null;
        prdSuggestedCommitMessage: string | null;
        suggestedCommitMessage: string | null;
      };
    },
  });

  const submitReview = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/prds/${id}/reviews/human-diff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          annotations: annotations.map((a) => ({
            filePath: a.filePath,
            startLine: a.startLine,
            endLine: a.endLine,
            text: a.text,
            kind: a.kind,
            diffSha: diffQ.data?.until ?? undefined,
          })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { reviewId: string };
    },
    onSuccess: ({ reviewId }) => {
      void queryClient.invalidateQueries({ queryKey: ["prds", id] });
      void navigate({ to: "/prds/$id/reviews/$reviewId", params: { id, reviewId } });
    },
  });

  const onCommitted = () => {
    void queryClient.invalidateQueries({ queryKey: ["prds", id, "diff"] });
    void queryClient.invalidateQueries({ queryKey: ["prds", id, "diff-tree"] });
    void queryClient.invalidateQueries({ queryKey: ["prds", id, "git-status"] });
  };

  const onSelectFile = (path: string) => {
    setSelectedFile(path);
    // Scroll the chosen file's header into view.
    const el = document.querySelector(`[data-file-path="${CSS.escape(path)}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const prd = prdQ.data.prd;
  const phases = React.useMemo(() => {
    if (!prd.currentPhase) return [];
    const all = new Set<number>();
    for (const t of prdQ.data.tasks) if (t.phaseNumber !== null) all.add(t.phaseNumber);
    return [...all].sort((a, b) => a - b);
  }, [prd.currentPhase, prdQ.data.tasks]);

  return (
    <PageShell>
      <PageTopBar
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTreeOpen((o) => !o)}
              title={treeOpen ? "Hide file tree" : "Show file tree"}
            >
              <FolderTreeIcon className="size-3.5" />
              <span className="ml-1.5">Files</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setContextOpen((o) => !o)}
              title={contextOpen ? "Hide PRD context" : "Show PRD context"}
            >
              <ListTreeIcon className="size-3.5" />
              <span className="ml-1.5">Context</span>
            </Button>
          </>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link to="/" className="transition-colors hover:text-foreground">
                PRDs
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <Link
                to="/prds/$id"
                params={{ id }}
                className="transition-colors hover:text-foreground"
              >
                {prd.title}
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Review diff</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>

      <div className="flex min-h-0 flex-1">
        <aside
          aria-hidden={!treeOpen}
          className={cn(
            "flex shrink-0 flex-col overflow-hidden border-card-border bg-card transition-[width,opacity,border-color] duration-200 ease-out",
            treeOpen
              ? "w-64 border-r opacity-100"
              : "w-0 border-r border-transparent opacity-0 pointer-events-none",
          )}
        >
          <div className="flex items-center justify-between border-b border-card-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Files
            </span>
            <button
              type="button"
              onClick={() => setTreeOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close file tree"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {treeQ.isLoading && <div className="p-3 text-xs text-muted-foreground">Loading…</div>}
            {treeQ.data && (
              <DiffTree
                files={treeQ.data.files}
                selectedPath={selectedFile}
                onSelect={onSelectFile}
              />
            )}
          </div>
        </aside>

        {/* Center — diff */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto bg-background p-4">
            {phases.length > 0 && (
              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span>View:</span>
                <Button
                  variant={phase === null ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setPhase(null)}
                >
                  Working tree
                </Button>
                {phases.map((p) => (
                  <Button
                    key={p}
                    variant={phase === p ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setPhase(p)}
                  >
                    Phase {p}
                  </Button>
                ))}
              </div>
            )}
            {diffQ.isLoading && (
              <div className="flex h-full items-center justify-center">
                <DotLoader preset="thinking" label="Loading diff..." />
              </div>
            )}
            {diffQ.error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                {(diffQ.error as Error).message}
              </div>
            )}
            {diffQ.data && (
              <DiffViewer
                diff={diffQ.data.diff}
                annotations={annotations}
                onAnnotationsChange={setAnnotations}
              />
            )}
          </div>
          <FloatingToolbar>
            <CommitForm
              prdId={id}
              suggestedCommitMessage={commitSuggestionQ.data?.suggestedCommitMessage}
              onCommitted={onCommitted}
            />
            <PushButton prdId={id} />
            {annotations.length > 0 && (
              <>
                <Button
                  size="sm"
                  onClick={() => submitReview.mutate()}
                  disabled={submitReview.isPending}
                >
                  Submit review ({annotations.length})
                </Button>
                <OpenInChatButton slashCommand={`/depot-dev ${id}`} label="Open in chat" />
              </>
            )}
          </FloatingToolbar>
        </div>

        <aside
          aria-hidden={!contextOpen}
          className={cn(
            "flex shrink-0 flex-col overflow-hidden border-card-border bg-card transition-[width,opacity,border-color] duration-200 ease-out",
            contextOpen
              ? "w-80 border-l opacity-100"
              : "w-0 border-l border-transparent opacity-0 pointer-events-none",
          )}
        >
          <div className="flex items-center justify-between border-b border-card-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Context
            </span>
            <button
              type="button"
              onClick={() => setContextOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close PRD context"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {contextQ.isLoading && (
              <div className="p-3 text-xs text-muted-foreground">Loading…</div>
            )}
            {contextQ.data && (
              <PrdContextPanel data={contextQ.data} className="w-full border-r-0" />
            )}
          </div>
        </aside>
      </div>
    </PageShell>
  );
}

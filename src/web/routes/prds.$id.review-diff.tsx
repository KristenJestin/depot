import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, MessageSquareIcon } from "lucide-react";
import * as React from "react";

import { CommitForm } from "#/web/components/commit-form";
import { DiffAnnotationsPanel } from "#/web/components/diff-annotations-panel";
import { DiffTreeGrouped } from "#/web/components/diff-tree";
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
import { FloatingToolbar, ResizableSplit } from "#/web/components/ui/resizable-panel";
import { usePersistedState } from "#/web/lib/use-persisted-state";
import { prdsQuery } from "#/web/lib/queries";
import { cn } from "#/web/lib/utils";

type DiffFile = { path: string; additions: number; deletions: number };

type RepoDiff = {
  repoName: string;
  repoPath: string;
  sha: string | null;
  diff: string;
  files: DiffFile[];
};

type DiffResponse = {
  mode: "working-tree" | "phase" | "full";
  since: string | null;
  until: string | null;
  diff: string;
  files: DiffFile[];
  repos: RepoDiff[];
};

const SPLIT_STORAGE_KEY = "depot.review-diff.split";

export const Route = createFileRoute("/prds/$id/review-diff")({
  component: ReviewDiffRoute,
});

function ReviewDiffRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [annotations, setAnnotations] = React.useState<DiffAnnotation[]>([]);
  const [phase, setPhase] = React.useState<number | null>(null);
  const [contextOpen, setContextOpen] = usePersistedState("depot.review-diff.context", false);
  const [annotationsOpen, setAnnotationsOpen] = usePersistedState(
    "depot.review-diff.annotations",
    true,
  );
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null);
  const [activeRepo, setActiveRepo] = React.useState<string | null>(null);

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
    void queryClient.invalidateQueries({ queryKey: ["prds", id, "git-status"] });
  };

  const removeAnnotation = (target: DiffAnnotation) => {
    setAnnotations((current) => current.filter((a) => a !== target));
  };

  const discardAnnotations = () => {
    if (annotations.length === 0) return;
    if (window.confirm(`Discard ${annotations.length} unsaved annotation(s)?`)) {
      setAnnotations([]);
    }
  };

  // The sidebar tree keys files by `repoName:path` so two repos that change a
  // same-named file (e.g. `package.json`) stay distinct. Selecting a file in
  // a repo other than the active one switches to that repo's diff first.
  const onSelectFile = (key: string) => {
    setSelectedFile(key);
    const repoName = key.slice(0, key.indexOf(":"));
    if (repoName && repoName !== activeRepo) setActiveRepo(repoName);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-file-path="${CSS.escape(key)}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const scrollToFile = (filePath: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-file-path="${CSS.escape(filePath)}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const prd = prdQ.data.prd;
  const phases = React.useMemo(() => {
    if (!prd.currentPhase) return [];
    const all = new Set<number>();
    for (const t of prdQ.data.tasks) if (t.phaseNumber !== null) all.add(t.phaseNumber);
    return [...all].sort((a, b) => a - b);
  }, [prd.currentPhase, prdQ.data.tasks]);

  const repos = diffQ.data?.repos ?? [];
  const reposWithChanges = repos.filter((r) => r.diff.trim().length > 0);
  const isMultiRepo = repos.length > 1;

  // Keep the selected repo tab valid as the diff response changes.
  React.useEffect(() => {
    if (repos.length === 0) {
      if (activeRepo !== null) setActiveRepo(null);
      return;
    }
    if (!activeRepo || !repos.some((r) => r.repoName === activeRepo)) {
      setActiveRepo((reposWithChanges[0] ?? repos[0])!.repoName);
    }
  }, [repos, reposWithChanges, activeRepo]);

  const treeGroups = React.useMemo(
    () =>
      repos.map((r) => ({
        repoName: r.repoName,
        files: r.files.map((f) => ({
          path: f.path,
          key: `${r.repoName}:${f.path}`,
          status: f.deletions > 0 && f.additions === 0 ? "D" : "M",
        })),
      })),
    [repos],
  );

  const shownRepo = isMultiRepo
    ? (repos.find((r) => r.repoName === activeRepo) ?? null)
    : (repos[0] ?? null);

  // Left pane of the `split-resizable` layout: the file tree on top, the PRD
  // context panel below. Both share the resizable column; the diff fills the
  // rest and reflows freely (the `@pierre/diffs` viewer is set to wrap).
  const leftPane = (
    <div className="flex min-h-0 flex-1 flex-col border-r border-card-border bg-card">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-card-border">
        <div className="border-b border-card-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Files
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {diffQ.isLoading && <div className="p-3 text-xs text-muted-foreground">Loading…</div>}
          {diffQ.data && (
            <DiffTreeGrouped
              groups={treeGroups}
              selectedPath={selectedFile}
              onSelect={onSelectFile}
            />
          )}
        </div>
      </div>
      <div
        className={cn(
          "flex flex-col overflow-hidden transition-[max-height] duration-200",
          contextOpen ? "min-h-0 flex-1" : "max-h-9 shrink-0",
        )}
      >
        <button
          type="button"
          onClick={() => setContextOpen((o) => !o)}
          aria-expanded={contextOpen}
          className="flex w-full items-center justify-between px-3 py-2 text-left"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            PRD context
          </span>
          <ChevronRightIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              contextOpen && "rotate-90",
            )}
          />
        </button>
        {contextOpen && (
          <div className="min-h-0 flex-1 overflow-auto">
            {contextQ.isLoading && (
              <div className="p-3 text-xs text-muted-foreground">Loading…</div>
            )}
            {contextQ.data && (
              <PrdContextPanel data={contextQ.data} className="w-full border-l-0" />
            )}
          </div>
        )}
      </div>
    </div>
  );

  const centerPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
        {isMultiRepo && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Repo:</span>
            {repos.map((r) => (
              <Button
                key={r.repoName}
                variant={activeRepo === r.repoName ? "primary" : "secondary"}
                size="sm"
                onClick={() => setActiveRepo(r.repoName)}
              >
                {r.repoName}
                <span className="ml-1.5 font-mono text-[10px] opacity-70">{r.files.length}</span>
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
        {diffQ.data && shownRepo && (
          <div data-file-path={`${shownRepo.repoName}:`}>
            {isMultiRepo && (
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-foreground">{shownRepo.repoName}</h2>
                {shownRepo.sha && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {shownRepo.sha.slice(0, 10)}
                  </span>
                )}
              </div>
            )}
            {shownRepo.diff.trim().length === 0 ? (
              <div className="rounded-lg border border-card-border bg-card p-4 text-sm text-muted-foreground">
                No changes in this repo.
              </div>
            ) : (
              <DiffViewer
                diff={shownRepo.diff}
                annotations={annotations}
                onAnnotationsChange={setAnnotations}
              />
            )}
          </div>
        )}
        {diffQ.data && !shownRepo && (
          <div className="rounded-lg border border-card-border bg-card p-4 text-sm text-muted-foreground">
            No changes to review.
          </div>
        )}
      </div>
      <FloatingToolbar>
        <CommitForm
          prdId={id}
          suggestedCommitMessage={commitSuggestionQ.data?.suggestedCommitMessage}
          repos={isMultiRepo ? repos.map((r) => r.repoName) : undefined}
          onCommitted={onCommitted}
        />
        <PushButton prdId={id} repo={isMultiRepo ? shownRepo?.repoName : undefined} />
        <Button
          size="sm"
          onClick={() => submitReview.mutate()}
          disabled={submitReview.isPending || annotations.length === 0}
        >
          Submit review{annotations.length > 0 ? ` (${annotations.length})` : ""}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={discardAnnotations}
          disabled={annotations.length === 0}
        >
          Discard
        </Button>
        {annotations.length > 0 && (
          <OpenInChatButton slashCommand={`/depot-dev ${id}`} label="Open in chat" />
        )}
      </FloatingToolbar>
    </div>
  );

  return (
    <PageShell>
      <PageTopBar
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAnnotationsOpen((o) => !o)}
            title={annotationsOpen ? "Hide annotations" : "Show annotations"}
          >
            <MessageSquareIcon className="size-3.5" />
            <span className="ml-1.5">
              Annotations{annotations.length > 0 ? ` (${annotations.length})` : ""}
            </span>
          </Button>
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
        <ResizableSplit
          storageKey={SPLIT_STORAGE_KEY}
          left={leftPane}
          right={centerPane}
          className="min-w-0"
        />

        <aside
          aria-hidden={!annotationsOpen}
          className={cn(
            "flex shrink-0 flex-col overflow-hidden border-card-border bg-card transition-[width,opacity,border-color] duration-200 ease-out",
            annotationsOpen
              ? "w-80 border-l opacity-100"
              : "w-0 border-l border-transparent opacity-0 pointer-events-none",
          )}
        >
          <div className="flex items-center justify-between border-b border-card-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Annotations
            </span>
            <button
              type="button"
              onClick={() => setAnnotationsOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close annotations"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <DiffAnnotationsPanel
              annotations={annotations}
              onRemove={removeAnnotation}
              onJump={scrollToFile}
            />
          </div>
        </aside>
      </div>
    </PageShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { Markdown } from "#/web/components/markdown";
import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { Badge } from "#/web/components/ui/badge";
import { EmptyState } from "#/web/components/ui/empty-state";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";
import { VALID_IDEA_STATUSES, type IdeaStatus } from "#/shared/validator";

type LinkedPrd = { revisionId: string; prdId: string; title: string };

type Idea = {
  id: string;
  projectId: string;
  title: string;
  body: string | null;
  tag: string | null;
  status: IdeaStatus;
  promotedPrdId: string | null;
  promotedPrdRevisionId: string | null;
  linkedPrds: LinkedPrd[];
  droppedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type IdeaListResponse = { ideas: Idea[]; openCount: number };

type MappingFilter = "all" | "mapped" | "unmapped";

const STATUS_BADGE: Record<IdeaStatus, "triageReady" | "statusDone" | "subtle"> = {
  open: "triageReady",
  promoted: "statusDone",
  dropped: "subtle",
};

/**
 * Render a coarse "age" relative to now — enough to flag a stale idea without
 * implying precision. Mirrors the spirit of the CLI `idea list` age column.
 */
function formatAge(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export const Route = createFileRoute("/projects/$id/ideas/")({
  component: IdeasListRoute,
});

function IdeasListRoute() {
  const { id } = Route.useParams();
  const [status, setStatus] = React.useState<IdeaStatus | "all">("open");
  const [tag, setTag] = React.useState("");
  const [mapping, setMapping] = React.useState<MappingFilter>("all");

  const query = useQuery({
    queryKey: ["projects", id, "ideas", { status, tag, mapping }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (tag.trim() !== "") params.set("tag", tag.trim());
      if (mapping === "mapped") params.set("mapped", "true");
      else if (mapping === "unmapped") params.set("mapped", "false");
      const qs = params.toString();
      const res = await fetch(`/api/projects/${id}/ideas${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as IdeaListResponse;
    },
  });

  return (
    <PageShell>
      <PageTopBar>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link to="/" className="transition-colors hover:text-foreground">
                Dashboard
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Ideas</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>
      <PageContent className="mx-auto w-full max-w-4xl space-y-6 p-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">Ideas</h1>
            {query.data && query.data.openCount > 0 && (
              <Badge variant="triageReady" className="text-[10px]">
                {query.data.openCount} open
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Read-only backlog of uncommitted ideas. Capture, promote, or drop with{" "}
            <code className="rounded bg-secondary px-1 py-0.5">depot idea</code>.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="block text-muted-foreground">Status</span>
            <Select
              value={status}
              onValueChange={(value) => setStatus((value as IdeaStatus | "all") ?? "open")}
            >
              <SelectTrigger className="mt-1 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">all</SelectItem>
                {VALID_IDEA_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">Mapping</span>
            <Select
              value={mapping}
              onValueChange={(value) => setMapping((value as MappingFilter) ?? "all")}
            >
              <SelectTrigger className="mt-1 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="mapped">mapped</SelectItem>
                <SelectItem value="unmapped">unmapped</SelectItem>
              </SelectPopup>
            </Select>
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">Tag</span>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="(any)"
              className="mt-1 h-9 w-64 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
            />
          </label>
        </div>

        {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {query.error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {(query.error as Error).message}
          </p>
        )}
        {query.data &&
          (query.data.ideas.length === 0 ? (
            <EmptyState message="No ideas here yet. Capture one from the CLI with `depot idea add`." />
          ) : (
            <ul className="space-y-2">
              {query.data.ideas.map((idea) => (
                <IdeaRow key={idea.id} projectId={id} idea={idea} />
              ))}
            </ul>
          ))}
      </PageContent>
    </PageShell>
  );
}

function IdeaRow({ projectId, idea }: { projectId: string; idea: Idea }) {
  return (
    <li className="rounded-md border border-card-border bg-card p-3 text-sm">
      <div className="flex items-baseline gap-2">
        {/* Only the title navigates to the idea detail page. The body toggle and
            the PRD chips below are siblings (never nested inside this link), so
            there is no invalid nested-anchor / click conflict. */}
        <Link
          to="/projects/$id/ideas/$ideaId"
          params={{ id: projectId, ideaId: idea.id }}
          className="min-w-0 flex-1 truncate font-medium no-underline text-current hover:text-primary"
        >
          {idea.title}
        </Link>
        {idea.tag && (
          <Badge variant="outline" className="text-[10px]">
            {idea.tag}
          </Badge>
        )}
        <Badge variant={STATUS_BADGE[idea.status]} className="text-[10px]">
          {idea.status}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatAge(idea.createdAt)}
        {idea.status === "promoted" && idea.promotedPrdRevisionId && (
          <>
            {" · "}
            <Link
              to="/prds/$id"
              params={{ id: idea.promotedPrdRevisionId }}
              className="text-primary hover:underline"
            >
              ↳ promoted PRD
            </Link>
          </>
        )}
        {idea.status === "dropped" && idea.droppedReason && <> · dropped: {idea.droppedReason}</>}
      </p>
      {idea.linkedPrds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {idea.linkedPrds.map((prd) => (
            <Link
              key={prd.revisionId}
              to="/prds/$id"
              params={{ id: prd.revisionId }}
              title={`Linked PRD: ${prd.title}`}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground no-underline transition-colors hover:border-primary/40 hover:text-primary"
            >
              <span aria-hidden="true">↪</span>
              <span className="truncate">{prd.title}</span>
            </Link>
          ))}
        </div>
      )}
      {idea.body && idea.body.trim() !== "" && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Body</summary>
          <div className="mt-2 rounded-md border border-card-border bg-muted/20 p-3">
            <Markdown source={idea.body} className="text-xs leading-5 text-secondary-foreground" />
          </div>
        </details>
      )}
    </li>
  );
}

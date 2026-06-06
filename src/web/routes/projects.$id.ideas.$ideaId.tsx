import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";

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
import type { IdeaStatus } from "#/shared/validator";

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

type IdeaDetailResponse = { idea: Idea };

const STATUS_BADGE: Record<IdeaStatus, "triageReady" | "statusDone" | "subtle"> = {
  open: "triageReady",
  promoted: "statusDone",
  dropped: "subtle",
};

/**
 * Coarse "age" relative to now — mirrors the list page and the CLI `idea list`
 * age column. Enough to flag a stale idea without implying precision.
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

export const Route = createFileRoute("/projects/$id/ideas/$ideaId")({
  component: IdeaDetailRoute,
});

function IdeaDetailRoute() {
  const { id, ideaId } = Route.useParams();

  const query = useQuery({
    queryKey: ["ideas", ideaId],
    queryFn: async () => {
      const res = await fetch(`/api/ideas/${ideaId}`);
      if (res.status === 404) throw new Error("Idea not found");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as IdeaDetailResponse;
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
              <Link
                to="/projects/$id/ideas"
                params={{ id }}
                className="transition-colors hover:text-foreground"
              >
                Ideas
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{query.data ? query.data.idea.title : "…"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>
      <PageContent className="mx-auto w-full max-w-4xl space-y-6 p-6">
        {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {query.error && <EmptyState message={(query.error as Error).message} />}
        {query.data && <IdeaDetailView idea={query.data.idea} />}
      </PageContent>
    </PageShell>
  );
}

function IdeaDetailView({ idea }: { idea: Idea }) {
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h1 className="min-w-0 flex-1 text-xl font-semibold">{idea.title}</h1>
          {idea.tag && (
            <Badge variant="outline" className="text-[10px]">
              {idea.tag}
            </Badge>
          )}
          <Badge variant={STATUS_BADGE[idea.status]} className="text-[10px]">
            {idea.status}
          </Badge>
        </div>
        <dl className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <Relation label="Captured">
            <span>{formatAge(idea.createdAt)}</span>
          </Relation>
          <Relation label="Updated">
            <span>{formatAge(idea.updatedAt)}</span>
          </Relation>
          <Relation label="Promoted PRD">
            {idea.status === "promoted" && idea.promotedPrdRevisionId ? (
              <Link
                to="/prds/$id"
                params={{ id: idea.promotedPrdRevisionId }}
                className="text-primary hover:underline"
              >
                ↳ promoted PRD
              </Link>
            ) : (
              <span>—</span>
            )}
          </Relation>
        </dl>
        {idea.status === "dropped" && idea.droppedReason && (
          <p className="text-xs text-muted-foreground">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
              Dropped
            </span>
            {" · "}
            {idea.droppedReason}
          </p>
        )}
      </header>

      {idea.linkedPrds.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
            Linked PRDs
          </h2>
          <ul className="space-y-1">
            {idea.linkedPrds.map((prd) => (
              <li key={prd.revisionId}>
                <Link
                  to="/prds/$id"
                  params={{ id: prd.revisionId }}
                  className="inline-flex max-w-full items-center gap-1 text-sm text-primary hover:underline"
                >
                  <span aria-hidden="true">↪</span>
                  <span className="truncate">{prd.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-md border border-card-border bg-card p-4">
        {idea.body && idea.body.trim() !== "" ? (
          <Markdown source={idea.body} />
        ) : (
          <p className="text-sm text-muted-foreground">No body captured for this idea.</p>
        )}
      </section>
    </article>
  );
}

function Relation({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">{label}</span>
      <span className="text-xs">{children}</span>
    </div>
  );
}
